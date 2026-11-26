import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

const LOCAL_EMBEDDING_DIM = 384;

/**
 * Generates deterministic unit-normalized embeddings locally using token + character n-gram hashing.
 * Intended only for offline sandbox testing or local demo mode without API keys.
 */
export function createLocalEmbedding(text, dimensions = LOCAL_EMBEDDING_DIM) {
  const vec = new Float32Array(dimensions);
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = normalized.split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    vec[0] = 1;
    return Array.from(vec);
  }

  const hashInto = (token, weight) => {
    let h1 = 2166136261;
    let h2 = 3735928559;
    for (let i = 0; i < token.length; i++) {
      const ch = token.charCodeAt(i);
      h1 ^= ch;
      h1 = Math.imul(h1, 16777619);
      h2 ^= ch + i;
      h2 = Math.imul(h2, 2246822519);
    }
    const idx = Math.abs(h1) % dimensions;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] += sign * weight;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    hashInto(tok, 1.0);
    if (i + 1 < tokens.length) {
      hashInto(`${tok}_${tokens[i + 1]}`, 0.75);
    }
    if (tok.length >= 4) {
      for (let j = 0; j <= tok.length - 3; j++) {
        hashInto(`ng_${tok.slice(j, j + 3)}`, 0.35);
      }
    }
  }

  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm) || 1;

  const out = new Array(dimensions);
  for (let i = 0; i < dimensions; i++) {
    out[i] = vec[i] / norm;
  }
  return out;
}

/**
 * Generates embeddings for an array of texts using the configured provider.
 */
export async function generateEmbeddings(texts, config) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const provider = config.embeddingProvider || 'openai';

  if (provider === 'local') {
    return texts.map((text) => createLocalEmbedding(text));
  }

  if (provider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error('OpenAI API key is required for OpenAI embeddings.');
    }
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const model = config.openaiEmbeddingModel || 'text-embedding-3-small';
    const batchSize = 64;
    const results = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response = await client.embeddings.create({
        model,
        input: batch,
      });
      for (const item of response.data) {
        results.push(item.embedding);
      }
    }
    return results;
  }

  if (provider === 'gemini') {
    if (!config.geminiApiKey) {
      throw new Error('Gemini API key is required for Gemini embeddings.');
    }
    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const modelName = config.geminiEmbeddingModel || 'text-embedding-004';
    const model = genAI.getGenerativeModel({ model: modelName });
    const results = [];

    // Process in modest batches to respect rate limits
    const batchSize = 20;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchEmbeddings = await Promise.all(
        batch.map(async (text) => {
          const res = await model.embedContent(text);
          return res.embedding.values;
        })
      );
      results.push(...batchEmbeddings);
    }
    return results;
  }

  throw new Error(`Unsupported embedding provider: ${provider}`);
}

/**
 * Generates a single embedding vector for a search query.
 */
export async function generateQueryEmbedding(query, config) {
  const [embedding] = await generateEmbeddings([query], config);
  return embedding;
}
