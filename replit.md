# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: OpenAI via Replit AI Integrations (`@workspace/integrations-openai-ai-server`)

## Artifacts

### RAG Demo (`artifacts/rag-demo/`)
Interactive proof-of-concept web app demonstrating Retrieval-Augmented Generation (RAG).
- **Frontend**: React + Vite, dark-themed developer aesthetic
- **Backend**: Express API server with in-memory vector store
- **RAG Pipeline**: Semantic embedding retrieval (all-MiniLM-L6-v2, 384-dim, local via @xenova/transformers) + OpenAI GPT-5.4 for generation
- **Key components**: document ingestion, chunk visualizer, query engine, similarity score display, pipeline step timing

### API Server (`artifacts/api-server/`)
Shared Express backend.
- **RAG routes**: `POST /api/rag/documents`, `GET /api/rag/documents`, `DELETE /api/rag/documents/:id`, `GET /api/rag/documents/:id/chunks`, `POST /api/rag/query`, `GET /api/rag/stats`
- **RAG store**: `artifacts/api-server/src/lib/rag-store.ts` — in-memory semantic vector store using local all-MiniLM-L6-v2 embeddings (384-dim, via @xenova/transformers) and cosine similarity
- **First-run note**: on the first ingest call, model weights (~23 MB) are downloaded from HuggingFace Hub and cached. Expect ~20-60s warmup latency on cold start; subsequent requests load from disk and are fast.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
