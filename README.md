# DocuMind RAG — AI-Powered PDF Chat & Conversational RAG System

A full-stack **Retrieval-Augmented Generation (RAG)** application built with **React**, **Node.js (Express)**, **Pinecone**, and **LLM APIs** (OpenAI & Google Gemini) for conversational document intelligence over uploaded PDFs.

## Features

- **Document Processing Pipeline**: Extracts text page-by-page from uploaded PDFs (`pdf-parse`), normalizes whitespace, and splits content into overlapping sentence/paragraph-aware chunks with page and chunk metadata.
- **Vector Embeddings & Pinecone Semantic Search**: Generates dense vector embeddings via OpenAI (`text-embedding-3-small`) or Gemini (`text-embedding-004`) and upserts/queries/deletes vectors in **Pinecone** (`@pinecone-database/pinecone`) with per-document metadata filtering.
- **Conversational Memory & Multi-Turn Query Rewriting**: Retains chat history per session (`server/data/sessions.json`) within a configurable turn window and condenses follow-up questions into standalone retrieval queries before querying Pinecone.
- **Grounded LLM Synthesis & Streaming**: Streams context-aware responses via Server-Sent Events (SSE) using OpenAI or Google Gemini, with inline numbered citations (`[1]`) and an interactive **RAG Context Inspector** showing retrieved passages and similarity scores.
- **Offline Local Sandbox Mode**: Includes an optional local vector store + extractive responder toggle in Settings for testing the full upload/chunking/memory/RAG UI without external API keys.

## Project Structure

```text
├── .env.example
├── package.json
├── client/                  # React + Vite frontend
│   ├── src/
│   │   ├── api.js
│   │   ├── App.jsx
│   │   ├── styles.css
│   │   └── components/
│   │       ├── ChatPanel.jsx
│   │       ├── ContextInspector.jsx
│   │       ├── SettingsModal.jsx
│   │       └── Sidebar.jsx
└── server/                  # Node.js + Express RAG backend
    ├── src/
    │   ├── app.js
    │   ├── config.js
    │   ├── index.js
    │   ├── routes/
    │   │   ├── chat.js
    │   │   ├── config.js
    │   │   └── documents.js
    │   └── services/
    │       ├── documentRegistry.js
    │       ├── embeddings.js
    │       ├── llm.js
    │       ├── memory.js
    │       ├── pdfProcessor.js
    │       ├── ragPipeline.js
    │       └── vectorStore.js
    └── test/
        └── rag.test.js
```

## Setup & Running

1. **Install dependencies**:
   ```bash
   npm run install:all
   ```

2. **Configure environment variables**:
   Copy `.env.example` to `.env` and fill in your Pinecone and OpenAI/Gemini API keys (or configure them directly in the UI via **Settings**):
   ```bash
   cp .env.example .env
   ```

3. **Start development servers** (Express API on `:5000` + Vite React UI on `:5173`):
   ```bash
   npm run dev
   ```

4. **Run automated tests**:
   ```bash
   npm test
   ```

5. **Build frontend for production**:
   ```bash
   npm run build
   npm start
   ```
