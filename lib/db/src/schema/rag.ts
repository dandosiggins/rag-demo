import { pgTable, text, timestamp, integer, real, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ragDocuments = pgTable("rag_documents", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  chunkCount: integer("chunk_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertRagDocumentSchema = createInsertSchema(ragDocuments).omit({
  createdAt: true,
});

export type RagDocument = typeof ragDocuments.$inferSelect;
export type InsertRagDocument = z.infer<typeof insertRagDocumentSchema>;

export const ragChunks = pgTable("rag_chunks", {
  id: uuid("id").primaryKey(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => ragDocuments.id, { onDelete: "cascade" }),
  documentTitle: text("document_title").notNull(),
  index: integer("index").notNull(),
  text: text("text").notNull(),
  wordCount: integer("word_count").notNull(),
  embedding: real("embedding").array().notNull(),
});

export const insertRagChunkSchema = createInsertSchema(ragChunks);

export type RagChunk = typeof ragChunks.$inferSelect;
export type InsertRagChunk = z.infer<typeof insertRagChunkSchema>;
