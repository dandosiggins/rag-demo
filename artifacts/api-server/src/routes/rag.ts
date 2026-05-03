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

ragRouter.post("/rag/documents", (req, res) => {
  const { title, text, chunkSize } = req.body as {
    title: string;
    text: string;
    chunkSize?: number;
  };

  if (!title || !text) {
    res.status(400).json({ error: "title and text are required" });
    return;
  }

  const { document, newChunks } = ingestDocument(title, text, chunkSize ?? 100);

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
  const retrieved = retrieveTopK(question, topK ?? 3);
  const retrieveMs = Date.now() - t0;

  steps.push({
    step: "Vectorize Query",
    description: `Converted query into a TF-IDF vector and computed cosine similarity against ${getStats().chunkCount} stored chunks`,
    durationMs: retrieveMs,
  });

  steps.push({
    step: "Retrieve",
    description: `Retrieved top ${retrieved.length} most relevant chunks from the knowledge base`,
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
    .map(
      (c, i) =>
        `[Chunk ${i + 1} from "${c.documentTitle}"]\n${c.text}`
    )
    .join("\n\n");

  const systemPrompt = `You are a helpful assistant that answers questions based strictly on the provided context chunks. 
Be concise and accurate. If the context doesn't fully answer the question, say so clearly.
Do not use emojis.`;

  const userMessage = `Context:\n${context}\n\nQuestion: ${question}`;

  const t1 = Date.now();
  let answer = "";
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
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
    description: `Sent the question + retrieved context to the language model and generated a grounded answer`,
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

ragRouter.get("/rag/stats", (_req, res) => {
  res.json(getStats());
});

export default ragRouter;
