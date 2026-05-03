import { randomUUID } from "crypto";

export interface StoredChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  index: number;
  text: string;
  wordCount: number;
  tfidf: Map<string, number>;
}

export interface StoredDocument {
  id: string;
  title: string;
  chunkCount: number;
  createdAt: string;
}

const documents = new Map<string, StoredDocument>();
const chunks: StoredChunk[] = [];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "was", "are", "were", "be", "been",
  "has", "have", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "that", "this", "it", "its", "as", "not",
  "no", "if", "so", "up", "out", "about", "into", "through", "during",
  "each", "which", "who", "whom", "what", "when", "where", "how", "all",
  "both", "few", "more", "most", "other", "some", "such", "than", "then",
  "these", "those", "can", "after", "before", "also", "their", "they",
  "there", "them", "we", "our", "you", "your", "my", "me", "he", "she",
  "his", "her", "him", "us", "i", "any",
]);

function computeTF(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  const filtered = tokens.filter((t) => !STOP_WORDS.has(t));
  for (const token of filtered) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }
  const max = Math.max(1, ...freq.values());
  const tf = new Map<string, number>();
  for (const [term, count] of freq) {
    tf.set(term, count / max);
  }
  return tf;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [term, valA] of a) {
    dot += valA * (b.get(term) ?? 0);
    magA += valA * valA;
  }
  for (const valB of b.values()) {
    magB += valB * valB;
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

export function ingestDocument(
  title: string,
  text: string,
  chunkSize = 100
): { document: StoredDocument; newChunks: StoredChunk[] } {
  const docId = randomUUID();
  const rawChunks = chunkText(text, chunkSize);
  const newChunks: StoredChunk[] = rawChunks.map((chunkText, idx) => {
    const tokens = tokenize(chunkText);
    return {
      id: randomUUID(),
      documentId: docId,
      documentTitle: title,
      index: idx,
      text: chunkText,
      wordCount: chunkText.split(/\s+/).length,
      tfidf: computeTF(tokens),
    };
  });

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

export function retrieveTopK(query: string, topK = 3): Array<StoredChunk & { score: number }> {
  const queryTokens = tokenize(query);
  const queryTF = computeTF(queryTokens);
  return chunks
    .map((chunk) => ({ ...chunk, score: cosineSimilarity(queryTF, chunk.tfidf) }))
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
