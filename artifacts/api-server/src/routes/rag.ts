import { Router } from "express";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  ingestDocument,
  listDocuments,
  getDocument,
  deleteDocument,
  clearAllDocuments,
  getChunksForDocument,
  retrieveTopK,
  getStats,
} from "../lib/rag-store.js";

const ragRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = ["application/pdf", "text/plain"];
    const extOk = /\.(pdf|txt)$/i.test(file.originalname);
    if (allowed.includes(file.mimetype) || extOk) cb(null, true);
    else cb(new Error("Only .pdf and .txt files are supported"));
  },
});

// ─── helpers ────────────────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function clampedInt(v: unknown, min: number, max: number, fallback: number): number | null {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

// ─── routes ─────────────────────────────────────────────────────────────────

ragRouter.get("/rag/documents", async (_req, res) => {
  res.json(await listDocuments());
});

ragRouter.post("/rag/documents", async (req, res) => {
  const { title, text, chunkSize } = req.body as {
    title: unknown;
    text: unknown;
    chunkSize?: unknown;
  };

  if (!isNonEmptyString(title)) {
    res.status(400).json({ error: "title must be a non-empty string" });
    return;
  }
  if (!isNonEmptyString(text)) {
    res.status(400).json({ error: "text must be a non-empty string" });
    return;
  }
  if (text.trim().split(/\s+/).length < 3) {
    res.status(400).json({ error: "text must contain at least 3 words" });
    return;
  }

  // chunkSize: integer in [20, 500]. Invalid value → 400 (no silent coercion).
  const size = clampedInt(chunkSize, 20, 500, 100);
  if (size === null) {
    res.status(400).json({ error: "chunkSize must be an integer between 20 and 500" });
    return;
  }

  const { document, newChunks } = await ingestDocument(title.trim(), text.trim(), size);

  res.json({
    document,
    chunks: newChunks.map(({ id, documentId, index, text: t, wordCount }) => ({
      id,
      documentId,
      index,
      text: t,
      wordCount,
    })),
  });
});

// ─── file upload endpoint ─────────────────────────────────────────────────────
ragRouter.post("/rag/upload", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "File exceeds the 20 MB limit" });
      } else {
        res.status(400).json({ error: err.message });
      }
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}, async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const rawTitle = req.body?.title as string | undefined;
  const rawChunkSize = req.body?.chunkSize;

  const isPdf =
    file.mimetype === "application/pdf" ||
    file.originalname.toLowerCase().endsWith(".pdf");

  let text: string;
  try {
    if (isPdf) {
      const parsed = await pdfParse(file.buffer);
      text = parsed.text;
    } else {
      text = file.buffer.toString("utf-8");
    }
  } catch {
    res.status(422).json({ error: "Failed to extract text from file" });
    return;
  }

  text = text.trim();
  if (text.split(/\s+/).length < 3) {
    res.status(400).json({ error: "Extracted text must contain at least 3 words" });
    return;
  }

  const title = rawTitle?.trim() || file.originalname.replace(/\.(pdf|txt)$/i, "");
  if (!title) {
    res.status(400).json({ error: "title must be a non-empty string" });
    return;
  }

  const size = clampedInt(rawChunkSize, 20, 500, 100);
  if (size === null) {
    res.status(400).json({ error: "chunkSize must be an integer between 20 and 500" });
    return;
  }

  const { document, newChunks } = await ingestDocument(title, text, size);

  res.json({
    document,
    chunks: newChunks.map(({ id, documentId, index, text: t, wordCount }) => ({
      id,
      documentId,
      index,
      text: t,
      wordCount,
    })),
  });
});

ragRouter.delete("/rag/documents", async (_req, res) => {
  const result = await clearAllDocuments();
  res.json({ success: true, ...result });
});

ragRouter.delete("/rag/documents/:documentId", async (req, res) => {
  const { documentId } = req.params;
  const success = await deleteDocument(documentId);
  if (!success) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json({ success: true, documentId });
});

ragRouter.get("/rag/documents/:documentId/chunks", async (req, res) => {
  const { documentId } = req.params;
  const doc = await getDocument(documentId);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const chunks = (await getChunksForDocument(documentId)).map(
    ({ id, documentId: dId, index, text, wordCount }) => ({
      id,
      documentId: dId,
      index,
      text,
      wordCount,
    })
  );
  res.json(chunks);
});

// Retrieval-only: embed the query and return the top-K matching chunks.
// Uses all-MiniLM-L6-v2 (384-dim) via @xenova/transformers (local, no API key).
// Does NOT call the LLM — generation is handled exclusively by /rag/generate.
ragRouter.post("/rag/query", async (req, res) => {
  const { question, topK } = req.body as { question: unknown; topK?: unknown };

  if (!isNonEmptyString(question)) {
    res.status(400).json({ error: "question must be a non-empty string" });
    return;
  }

  // topK: integer in [1, 20]
  const k = clampedInt(topK, 1, 20, 3);
  if (k === null) {
    res.status(400).json({ error: "topK must be an integer between 1 and 20" });
    return;
  }

  const stats = await getStats();

  const t0 = Date.now();
  const retrieved = await retrieveTopK(question.trim(), k);
  const embedMs = Date.now() - t0;

  res.json({
    question: question.trim(),
    retrievedChunks: retrieved.map(
      ({ id, documentId, documentTitle, index, text, score, wordCount }) => ({
        id,
        documentId,
        documentTitle,
        index,
        text,
        score,
        wordCount,
      })
    ),
    processingSteps: [
      {
        step: "Embed Query",
        description: `Encoded query into a 384-dim semantic embedding using all-MiniLM-L6-v2 (local model)`,
        durationMs: embedMs,
      },
      {
        step: "Retrieve",
        description: `Computed cosine similarity against ${stats.chunkCount} stored chunk embeddings; retrieved top ${retrieved.length} results`,
        durationMs: 0,
      },
    ],
  });
});

// Streaming generation: accepts question + pre-retrieved chunks, streams the grounded
// LLM answer token-by-token via Server-Sent Events. This is the only path that calls
// the LLM — /rag/query is purely a retrieval endpoint.
ragRouter.post("/rag/generate", async (req, res) => {
  const { question, retrievedChunks } = req.body as {
    question: unknown;
    retrievedChunks: unknown;
  };

  if (!isNonEmptyString(question)) {
    res.status(400).json({ error: "question must be a non-empty string" });
    return;
  }
  if (!Array.isArray(retrievedChunks)) {
    res.status(400).json({ error: "retrievedChunks must be an array" });
    return;
  }

  type ChunkInput = {
    id: string;
    documentId: string;
    documentTitle: string;
    index: number;
    text: string;
    score: number;
    wordCount: number;
  };

  const chunks = retrievedChunks as ChunkInput[];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  if (chunks.length === 0) {
    sendEvent("answer", {
      token:
        "No relevant chunks were provided. Please ingest some documents and run retrieval first.",
    });
    sendEvent("done", { generateMs: 0 });
    res.end();
    return;
  }

  const context = chunks
    .map((c, i) => `[Chunk ${i + 1} from "${c.documentTitle}"]\n${c.text}`)
    .join("\n\n");

  const t1 = Date.now();
  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      stream: true,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that answers questions based strictly on the provided context chunks. Be concise and accurate. If the context does not fully answer the question, say so.",
        },
        {
          role: "user",
          content: `Context:\n${context}\n\nQuestion: ${question.trim()}`,
        },
      ],
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) sendEvent("answer", { token });
    }
  } catch (err) {
    console.error("OpenAI streaming error:", err);
    sendEvent("answer", { token: "Error generating answer. Please try again." });
  }

  const generateMs = Date.now() - t1;
  sendEvent("done", { generateMs });
  res.end();
});

ragRouter.get("/rag/stats", async (_req, res) => {
  res.json(await getStats());
});

export default ragRouter;
