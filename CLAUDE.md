# RAG Demo

HSS AI Hub demo project showcasing Retrieval-Augmented Generation.
Live at: https://rag-demo.davidlarsen.ca
Deployed to: Railway (own project)

## Architecture
- **Frontend:** React + Vite (`artifacts/rag-demo/`)
- **Backend:** Express API server (`artifacts/api-server/`)
- **Database:** PostgreSQL (Railway Postgres plugin)
- **Embeddings:** @xenova/transformers + onnxruntime-node (runs in-process, no separate service)
- **AI:** OpenAI API
- **File handling:** PDF uploads via multer + pdf-parse

## Railway Services (keep only these two)
- @workspace/rag-demo — Vite frontend
- @workspace/api-server — Express backend

## Environment Variables (api-server)
- DATABASE_URL — auto-injected by Railway Postgres
- OPENAI_API_KEY — set manually in Railway dashboard

## Rules
- Do not modify railway.toml or nixpacks.toml without flagging it
- Do not add new Railway services — all libs stay as internal packages
- Frontend and backend are deployed as separate Railway services
