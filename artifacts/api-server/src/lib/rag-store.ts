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

export function chunkText(text: string, chunkSize = 100): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const result: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    result.push(words.slice(i, i + chunkSize).join(" "));
  }
  return result;
}

export async function ingestDocument(
  title: string,
  text: string,
  chunkSize = 100
): Promise<{ document: StoredDocument; newChunks: StoredChunk[] }> {
  const docId = randomUUID();
  const rawChunks = chunkText(text, chunkSize);

  const newChunks: StoredChunk[] = await Promise.all(
    rawChunks.map(async (chunkText, idx) => {
      const embedding = await embed(chunkText);
      return {
        id: randomUUID(),
        documentId: docId,
        documentTitle: title,
        index: idx,
        text: chunkText,
        wordCount: chunkText.split(/\s+/).length,
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
  const idx = chunks.reduce<number[]>((acc, c, i) => {
    if (c.documentId === id) acc.push(i);
    return acc;
  }, []);
  for (let i = idx.length - 1; i >= 0; i--) {
    chunks.splice(idx[i], 1);
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
