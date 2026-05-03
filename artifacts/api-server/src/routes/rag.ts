import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import {
  ingestDocument,
  listDocuments,
  getDocument,
  deleteDocument,
  getChunksForDocument,
  retrieveTopK,
  getStats,
} from "../lib/rag-store.js";

const ragRouter = Router();

ragRouter.get("/rag/documents", (_req, res) => {
  res.json(listDocuments());
});

ragRouter.post("/rag/documents", async (req, res) => {
  const { title, text, chunkSize } = req.body as {
    title: string;
    text: string;
    chunkSize?: number;
  };

  if (!title || !text) {
    res.status(400).json({ error: "title and text are required" });
    return;
  }

  const { document, newChunks } = await ingestDocument(title, text, chunkSize ?? 100);

  res.json({
    document,
    chunks: newChunks.map(({ id, documentId, index, text, wordCount }) => ({
      id,
      documentId,
      index,
      text,
      wordCount,
    })),
  });
});

ragRouter.delete("/rag/documents/:documentId", (req, res) => {
  const { documentId } = req.params;
  const success = deleteDocument(documentId);
  if (!success) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.json({ success: true, documentId });
});

ragRouter.get("/rag/documents/:documentId/chunks", (req, res) => {
  const { documentId } = req.params;
  const doc = getDocument(documentId);
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const chunks = getChunksForDocument(documentId).map(
    ({ id, documentId, index, text, wordCount }) => ({
      id,
      documentId,
      index,
      text,
      wordCount,
    })
  );
  res.json(chunks);
});

// Retrieval-only: embed the query and return the top-K matching chunks.
// Does NOT call the LLM — generation is handled exclusively by /rag/generate.
ragRouter.post("/rag/query", async (req, res) => {
  const { question, topK } = req.body as {
    question: string;
    topK?: number;
  };

  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const stats = getStats();

  const t0 = Date.now();
  const retrieved = await retrieveTopK(question, topK ?? 3);
  const embedMs = Date.now() - t0;

  res.json({
    question,
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
        description: `Encoded query into a 384-dim semantic embedding using all-MiniLM-L6-v2`,
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
    question: string;
    retrievedChunks: Array<{
      id: string;
      documentId: string;
      documentTitle: string;
      index: number;
      text: string;
      score: number;
      wordCount: number;
    }>;
  };

  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }
  if (!Array.isArray(retrievedChunks)) {
    res.status(400).json({ error: "retrievedChunks array is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  if (retrievedChunks.length === 0) {
    sendEvent("answer", {
      token: "No relevant chunks were provided. Please ingest some documents and run retrieval first.",
    });
    sendEvent("done", { generateMs: 0 });
    res.end();
    return;
  }

  const context = retrievedChunks
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
            "You are a helpful assistant that answers questions based strictly on the provided context chunks. Be concise and accurate. If the context doesn't fully answer the question, say so. Do not use emojis.",
        },
        {
          role: "user",
          content: `Context:\n${context}\n\nQuestion: ${question}`,
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

ragRouter.get("/rag/stats", (_req, res) => {
  res.json(getStats());
});

export default ragRouter;
