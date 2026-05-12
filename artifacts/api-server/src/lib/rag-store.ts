import { randomUUID } from "crypto";
import { pipeline, env } from "@xenova/transformers";
import { db, ragDocuments, ragChunks } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Allow both cached local models and remote downloads from HuggingFace Hub.
// On first run the model weights (~23 MB) are fetched and cached locally;
// subsequent runs load entirely from disk.
env.allowLocalModels = true;
env.allowRemoteModels = true;

// Singleton pipeline — cached as a Promise so concurrent callers share one load.
// Using a Promise (not the resolved value) ensures that if multiple embed()
// calls happen before the first load completes they all await the same work.
let _embedderPromise: ReturnType<typeof pipeline> | null = null;

function getEmbedder() {
  if (!_embedderPromise) {
    _embedderPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return _embedderPromise;
}

// Produce a mean-pooled, L2-normalised embedding (384-dim).
async function embed(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  // output.data is a Float32Array
  return Array.from(output.data as Float32Array);
}

export interface StoredChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  index: number;
  text: string;
  wordCount: number;
  embedding: number[];
}

export interface StoredDocument {
  id: string;
  title: string;
  chunkCount: number;
  createdAt: string;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Paragraph- and sentence-aware chunking.
 *
 * Strategy:
 * 1. Split text on blank lines (paragraph boundaries).
 * 2. Accumulate paragraphs into a chunk until the word limit is reached.
 * 3. If a single paragraph exceeds the limit, break it further on sentence
 *    boundaries (`.`, `!`, `?`) before falling back to a raw word window.
 */
export function chunkText(text: string, maxWords = 100): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter((p) => p.length > 0);

  const result: string[] = [];
  let currentParts: string[] = [];
  let currentWords = 0;

  const flush = () => {
    if (currentParts.length > 0) {
      result.push(currentParts.join(" ").trim());
      currentParts = [];
      currentWords = 0;
    }
  };

  const splitBySentences = (para: string): string[] => {
    const raw = para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) ?? [para];
    const sentences: string[] = [];
    let buf = "";
    let bufWords = 0;
    for (const s of raw) {
      const sw = s.trim().split(/\s+/).length;
      if (bufWords + sw <= maxWords) {
        buf += (buf ? " " : "") + s.trim();
        bufWords += sw;
      } else {
        if (buf) sentences.push(buf);
        if (sw > maxWords) {
          const words = s.trim().split(/\s+/);
          for (let i = 0; i < words.length; i += maxWords) {
            sentences.push(words.slice(i, i + maxWords).join(" "));
          }
          buf = "";
          bufWords = 0;
        } else {
          buf = s.trim();
          bufWords = sw;
        }
      }
    }
    if (buf) sentences.push(buf);
    return sentences;
  };

  for (const para of paragraphs) {
    const wc = para.split(/\s+/).length;

    if (wc > maxWords) {
      flush();
      const parts = splitBySentences(para);
      for (const part of parts) {
        const pw = part.split(/\s+/).length;
        if (currentWords + pw <= maxWords) {
          currentParts.push(part);
          currentWords += pw;
        } else {
          flush();
          currentParts.push(part);
          currentWords = pw;
        }
      }
    } else if (currentWords + wc <= maxWords) {
      currentParts.push(para);
      currentWords += wc;
    } else {
      flush();
      currentParts.push(para);
      currentWords = wc;
    }
  }

  flush();
  return result.length > 0 ? result : [text.trim()];
}

export async function ingestDocument(
  title: string,
  text: string,
  chunkSize = 100
): Promise<{ document: StoredDocument; newChunks: StoredChunk[] }> {
  const docId = randomUUID();
  const rawChunks = chunkText(text, chunkSize);

  const newChunks: StoredChunk[] = await Promise.all(
    rawChunks.map(async (chunkTxt, idx) => {
      const embedding = await embed(chunkTxt);
      return {
        id: randomUUID(),
        documentId: docId,
        documentTitle: title,
        index: idx,
        text: chunkTxt,
        wordCount: chunkTxt.split(/\s+/).filter((w) => w.length > 0).length,
        embedding,
      };
    })
  );

  const doc: StoredDocument = {
    id: docId,
    title,
    chunkCount: newChunks.length,
    createdAt: new Date().toISOString(),
  };

  await db.transaction(async (tx) => {
    await tx.insert(ragDocuments).values({
      id: docId,
      title,
      chunkCount: newChunks.length,
    });

    await tx.insert(ragChunks).values(
      newChunks.map((c) => ({
        id: c.id,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        index: c.index,
        text: c.text,
        wordCount: c.wordCount,
        embedding: c.embedding,
      }))
    );
  });

  return { document: doc, newChunks };
}

export async function listDocuments(): Promise<StoredDocument[]> {
  const rows = await db.select().from(ragDocuments).orderBy(ragDocuments.createdAt);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    chunkCount: r.chunkCount,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getDocument(id: string): Promise<StoredDocument | undefined> {
  const rows = await db.select().from(ragDocuments).where(eq(ragDocuments.id, id));
  if (rows.length === 0) return undefined;
  const r = rows[0];
  return {
    id: r.id,
    title: r.title,
    chunkCount: r.chunkCount,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function deleteDocument(id: string): Promise<boolean> {
  const existing = await db.select().from(ragDocuments).where(eq(ragDocuments.id, id));
  if (existing.length === 0) return false;
  await db.delete(ragDocuments).where(eq(ragDocuments.id, id));
  return true;
}

export async function clearAllDocuments(): Promise<{ deletedDocuments: number; deletedChunks: number }> {
  const [docResult, chunkResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(ragDocuments),
    db.select({ count: sql<number>`count(*)::int` }).from(ragChunks),
  ]);
  await db.delete(ragChunks);
  await db.delete(ragDocuments);
  return {
    deletedDocuments: docResult[0]?.count ?? 0,
    deletedChunks: chunkResult[0]?.count ?? 0,
  };
}

export async function getChunksForDocument(docId: string): Promise<StoredChunk[]> {
  const rows = await db
    .select()
    .from(ragChunks)
    .where(eq(ragChunks.documentId, docId))
    .orderBy(ragChunks.index);
  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    index: r.index,
    text: r.text,
    wordCount: r.wordCount,
    embedding: r.embedding as number[],
  }));
}

export async function retrieveTopK(
  query: string,
  topK = 3
): Promise<Array<StoredChunk & { score: number }>> {
  const queryEmbedding = await embed(query);
  const rows = await db.select().from(ragChunks);
  return rows
    .map((r) => ({
      id: r.id,
      documentId: r.documentId,
      documentTitle: r.documentTitle,
      index: r.index,
      text: r.text,
      wordCount: r.wordCount,
      embedding: r.embedding as number[],
      score: cosineSimilarity(queryEmbedding, r.embedding as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export async function getStats(): Promise<{
  documentCount: number;
  chunkCount: number;
  totalWords: number;
}> {
  const docResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ragDocuments);
  const chunkResult = await db
    .select({
      count: sql<number>`count(*)::int`,
      totalWords: sql<number>`coalesce(sum(word_count), 0)::int`,
    })
    .from(ragChunks);

  return {
    documentCount: docResult[0]?.count ?? 0,
    chunkCount: chunkResult[0]?.count ?? 0,
    totalWords: chunkResult[0]?.totalWords ?? 0,
  };
}
