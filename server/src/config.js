import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from workspace root or server directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const runtimeConfig = {
  port: Number(process.env.PORT) || 5000,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  vectorStoreProvider: process.env.VECTOR_STORE_PROVIDER || 'pinecone',
  pineconeApiKey: process.env.PINECONE_API_KEY || '',
  pineconeIndex: process.env.PINECONE_INDEX || 'pdf-rag-index',
  pineconeNamespace: process.env.PINECONE_NAMESPACE || 'default',
  llmProvider: process.env.LLM_PROVIDER || 'openai',
  embeddingProvider: process.env.EMBEDDING_PROVIDER || 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiChatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
  geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
  chunkSize: Number(process.env.CHUNK_SIZE) || 1000,
  chunkOverlap: Number(process.env.CHUNK_OVERLAP) || 200,
  topK: Number(process.env.TOP_K) || 5,
  maxHistoryTurns: Number(process.env.MAX_HISTORY_TURNS) || 8,
};

/**
 * Returns the active runtime configuration object.
 */
export function getConfig() {
  return { ...runtimeConfig };
}

/**
 * Updates allowed runtime configuration values from the API settings panel.
 */
export function updateConfig(patch = {}) {
  const stringFields = [
    'vectorStoreProvider',
    'pineconeApiKey',
    'pineconeIndex',
    'pineconeNamespace',
    'llmProvider',
    'embeddingProvider',
    'openaiApiKey',
    'openaiChatModel',
    'openaiEmbeddingModel',
    'geminiApiKey',
    'geminiChatModel',
    'geminiEmbeddingModel',
  ];

  for (const field of stringFields) {
    if (typeof patch[field] === 'string') {
      runtimeConfig[field] = patch[field].trim();
    }
  }

  const numberFields = [
    { key: 'chunkSize', min: 200, max: 4000 },
    { key: 'chunkOverlap', min: 0, max: 1000 },
    { key: 'topK', min: 1, max: 20 },
    { key: 'maxHistoryTurns', min: 1, max: 30 },
  ];

  for (const { key, min, max } of numberFields) {
    if (patch[key] !== undefined && Number.isFinite(Number(patch[key]))) {
      const val = Math.round(Number(patch[key]));
      runtimeConfig[key] = Math.max(min, Math.min(max, val));
    }
  }

  if (runtimeConfig.chunkOverlap >= runtimeConfig.chunkSize) {
    runtimeConfig.chunkOverlap = Math.floor(runtimeConfig.chunkSize / 4);
  }

  return getPublicConfigStatus();
}

/**
 * Returns non-secret configuration status safe to expose to the React frontend.
 */
export function getPublicConfigStatus() {
  return {
    vectorStoreProvider: runtimeConfig.vectorStoreProvider,
    pineconeConfigured: Boolean(runtimeConfig.pineconeApiKey && runtimeConfig.pineconeIndex),
    pineconeIndex: runtimeConfig.pineconeIndex,
    pineconeNamespace: runtimeConfig.pineconeNamespace,
    llmProvider: runtimeConfig.llmProvider,
    embeddingProvider: runtimeConfig.embeddingProvider,
    openaiConfigured: Boolean(runtimeConfig.openaiApiKey),
    openaiChatModel: runtimeConfig.openaiChatModel,
    openaiEmbeddingModel: runtimeConfig.openaiEmbeddingModel,
    geminiConfigured: Boolean(runtimeConfig.geminiApiKey),
    geminiChatModel: runtimeConfig.geminiChatModel,
    geminiEmbeddingModel: runtimeConfig.geminiEmbeddingModel,
    chunkSize: runtimeConfig.chunkSize,
    chunkOverlap: runtimeConfig.chunkOverlap,
    topK: runtimeConfig.topK,
    maxHistoryTurns: runtimeConfig.maxHistoryTurns,
    readyForIngestion: isIngestionReady(runtimeConfig),
    readyForChat: isChatReady(runtimeConfig),
  };
}

export function isIngestionReady(cfg = runtimeConfig) {
  const vectorOk =
    cfg.vectorStoreProvider === 'local' ||
    (cfg.vectorStoreProvider === 'pinecone' && Boolean(cfg.pineconeApiKey && cfg.pineconeIndex));
  const embedOk =
    cfg.embeddingProvider === 'local' ||
    (cfg.embeddingProvider === 'openai' && Boolean(cfg.openaiApiKey)) ||
    (cfg.embeddingProvider === 'gemini' && Boolean(cfg.geminiApiKey));
  return vectorOk && embedOk;
}

export function isChatReady(cfg = runtimeConfig) {
  const llmOk =
    cfg.llmProvider === 'local' ||
    (cfg.llmProvider === 'openai' && Boolean(cfg.openaiApiKey)) ||
    (cfg.llmProvider === 'gemini' && Boolean(cfg.geminiApiKey));
  return isIngestionReady(cfg) && llmOk;
}
