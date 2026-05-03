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

// Combined retrieve + generate (non-streaming)
ragRouter.post("/rag/query", async (req, res) => {
  const { question, topK } = req.body as {
    question: string;
    topK?: number;
  };

  if (!question) {
    res.status(400).json({ error: "question is required" });
    return;
  }

  const steps: Array<{ step: string; description: string; durationMs: number }> = [];

  const t0 = Date.now();
  const retrieved = await retrieveTopK(question, topK ?? 3);
  const embedMs = Date.now() - t0;

  steps.push({
    step: "Embed Query",
    description: `Encoded query into a 384-dim semantic embedding vector using all-MiniLM-L6-v2`,
    durationMs: embedMs,
  });

  steps.push({
    step: "Retrieve",
    description: `Computed cosine similarity against ${getStats().chunkCount} stored embeddings; retrieved top ${retrieved.length} chunks`,
    durationMs: 0,
  });

  if (retrieved.length === 0) {
    res.json({
      question,
      retrievedChunks: [],
      answer:
        "No documents have been ingested yet. Please upload some documents first so I can answer your question.",
      processingSteps: steps,
    });
    return;
  }

  const context = retrieved
    .map((c, i) => `[Chunk ${i + 1} from "${c.documentTitle}"]\n${c.text}`)
    .join("\n\n");

  const t1 = Date.now();
  let answer = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that answers questions based strictly on the provided context chunks. Be concise and accurate. If the context doesn't fully answer the question, say so clearly. Do not use emojis.",
        },
        {
          role: "user",
          content: `Context:\n${context}\n\nQuestion: ${question}`,
        },
      ],
    });
    answer = completion.choices[0]?.message?.content ?? "No answer generated.";
  } catch (err) {
    answer = "Error generating answer. Please try again.";
    console.error("OpenAI error:", err);
  }
  const generateMs = Date.now() - t1;

  steps.push({
    step: "Generate",
    description: `Sent question + retrieved context to the language model to synthesize a grounded answer`,
    durationMs: generateMs,
  });

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
    answer,
    processingSteps: steps,
  });
});

// Streaming generate endpoint: accepts pre-retrieved chunks + question, streams LLM answer via SSE
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
      token: "No relevant chunks were provided. Please retrieve documents first.",
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
            "You are a helpful assistant that answers questions based strictly on the provided context chunks. Be concise and accurate. Do not use emojis.",
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
