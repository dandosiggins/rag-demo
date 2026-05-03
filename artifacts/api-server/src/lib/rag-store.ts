import { randomUUID } from "crypto";
import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

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

const documents = new Map<string, StoredDocument>();
const chunks: StoredChunk[] = [];

let embedder: FeatureExtractionPipeline | null = null;
let embedderLoading: Promise<FeatureExtractionPipeline> | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder;
  if (embedderLoading) return embedderLoading;
  embedderLoading = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    quantized: true,
  }) as Promise<FeatureExtractionPipeline>;
  embedder = await embedderLoading;
  return embedder;
}

async function embed(text: string): Promise<number[]> {
  const model = await getEmbedder();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
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
    // Split on sentence-ending punctuation followed by whitespace / end
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
        // If a single sentence exceeds the limit, hard-split by words
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
      // Paragraph too large — flush current buffer, then split into sentences
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
      // Fits — accumulate
      currentParts.push(para);
      currentWords += wc;
    } else {
      // Would overflow — flush and start fresh
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

  documents.set(docId, doc);
  chunks.push(...newChunks);

  return { document: doc, newChunks };
}

export function listDocuments(): StoredDocument[] {
  return Array.from(documents.values());
}

export function getDocument(id: string): StoredDocument | undefined {
  return documents.get(id);
}

export function deleteDocument(id: string): boolean {
  if (!documents.has(id)) return false;
  documents.delete(id);
  const idxs = chunks.reduce<number[]>((acc, c, i) => {
    if (c.documentId === id) acc.push(i);
    return acc;
  }, []);
  for (let i = idxs.length - 1; i >= 0; i--) {
    chunks.splice(idxs[i], 1);
  }
  return true;
}

export function getChunksForDocument(docId: string): StoredChunk[] {
  return chunks.filter((c) => c.documentId === docId);
}

export async function retrieveTopK(
  query: string,
  topK = 3
): Promise<Array<StoredChunk & { score: number }>> {
  const queryEmbedding = await embed(query);
  return chunks
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function getStats() {
  return {
    documentCount: documents.size,
    chunkCount: chunks.length,
    totalWords: chunks.reduce((sum, c) => sum + c.wordCount, 0),
  };
}
