import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pinecone } from '@pinecone-database/pinecone';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LOCAL_STORE_PATH = path.resolve(__dirname, '../../data/local-vectors.json');

/**
 * Computes cosine similarity between two numeric vectors.
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Creates a Pinecone namespace handle from runtime configuration.
 */
function getPineconeNamespace(config, clientFactory) {
  if (!config.pineconeApiKey) {
    throw new Error('Pinecone API key is required when vectorStoreProvider is "pinecone".');
  }
  if (!config.pineconeIndex) {
    throw new Error('Pinecone index name is required.');
  }

  const pc = clientFactory
    ? clientFactory(config.pineconeApiKey)
    : new Pinecone({ apiKey: config.pineconeApiKey });

  const index = pc.index(config.pineconeIndex);
  const namespace = config.pineconeNamespace || 'default';
  return index.namespace(namespace);
}

async function readLocalVectors(storePath = DEFAULT_LOCAL_STORE_PATH) {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeLocalVectors(vectors, storePath = DEFAULT_LOCAL_STORE_PATH) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(vectors), 'utf8');
}

/**
 * Upserts chunk vectors + metadata into Pinecone or the local vector store.
 */
export async function upsertChunks(chunks, embeddings, config, options = {}) {
  if (chunks.length !== embeddings.length) {
    throw new Error('Chunks count does not match generated embeddings count.');
  }
  if (chunks.length === 0) return { upsertedCount: 0 };

  const records = chunks.map((chunk, i) => ({
    id: chunk.id,
    values: embeddings[i],
    metadata: {
      documentId: chunk.documentId,
      filename: chunk.filename,
      pageNumber: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
      tokenEstimate: chunk.tokenEstimate,
      text: chunk.text,
    },
  }));

  const provider = config.vectorStoreProvider || 'pinecone';

  if (provider === 'local') {
    const storePath = options.localStorePath || DEFAULT_LOCAL_STORE_PATH;
    const existing = await readLocalVectors(storePath);
    const incomingIds = new Set(records.map((r) => r.id));
    const merged = existing.filter((item) => !incomingIds.has(item.id)).concat(records);
    await writeLocalVectors(merged, storePath);
    return { upsertedCount: records.length, provider: 'local' };
  }

  if (provider === 'pinecone') {
    const ns = getPineconeNamespace(config, options.pineconeClientFactory);
    const batchSize = 100;
    for (let i = 0; i < records.length; i += batchSize) {
      await ns.upsert(records.slice(i, i + batchSize));
    }
    return {
      upsertedCount: records.length,
      provider: 'pinecone',
      index: config.pineconeIndex,
      namespace: config.pineconeNamespace || 'default',
    };
  }

  throw new Error(`Unsupported vector store provider: ${provider}`);
}

/**
 * Queries top-K semantically similar chunks from Pinecone or local store.
 */
export async function querySimilarChunks(
  { vector, topK = 5, documentIds = [], config },
  options = {}
) {
  const provider = config.vectorStoreProvider || 'pinecone';
  const safeTopK = Math.max(1, Math.min(20, Number(topK) || 5));

  if (provider === 'local') {
    const storePath = options.localStorePath || DEFAULT_LOCAL_STORE_PATH;
    const allVectors = await readLocalVectors(storePath);
    const filterSet = documentIds.length > 0 ? new Set(documentIds) : null;

    const scored = allVectors
      .filter((item) => !filterSet || filterSet.has(item.metadata?.documentId))
      .map((item) => ({
        id: item.id,
        score: cosineSimilarity(vector, item.values),
        documentId: item.metadata?.documentId,
        filename: item.metadata?.filename,
        pageNumber: item.metadata?.pageNumber,
        chunkIndex: item.metadata?.chunkIndex,
        text: item.metadata?.text || '',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, safeTopK);

    return scored;
  }

  if (provider === 'pinecone') {
    const ns = getPineconeNamespace(config, options.pineconeClientFactory);

    let filter;
    if (documentIds.length === 1) {
      filter = { documentId: { $eq: documentIds[0] } };
    } else if (documentIds.length > 1) {
      filter = { documentId: { $in: documentIds } };
    }

    const queryPayload = {
      vector,
      topK: safeTopK,
      includeMetadata: true,
    };
    if (filter) {
      queryPayload.filter = filter;
    }

    const res = await ns.query(queryPayload);
    const matches = res?.matches || [];

    return matches.map((match) => ({
      id: match.id,
      score: typeof match.score === 'number' ? match.score : 0,
      documentId: match.metadata?.documentId || '',
      filename: match.metadata?.filename || 'Document',
      pageNumber: match.metadata?.pageNumber ?? 1,
      chunkIndex: match.metadata?.chunkIndex ?? 0,
      text: match.metadata?.text || '',
    }));
  }

  throw new Error(`Unsupported vector store provider: ${provider}`);
}

/**
 * Deletes all vectors belonging to a document.
 */
export async function deleteDocumentVectors({ documentId, vectorIds = [], config }, options = {}) {
  const provider = config.vectorStoreProvider || 'pinecone';

  if (provider === 'local') {
    const storePath = options.localStorePath || DEFAULT_LOCAL_STORE_PATH;
    const allVectors = await readLocalVectors(storePath);
    const remaining = allVectors.filter((item) => item.metadata?.documentId !== documentId);
    await writeLocalVectors(remaining, storePath);
    return { deletedCount: allVectors.length - remaining.length };
  }

  if (provider === 'pinecone') {
    const ns = getPineconeNamespace(config, options.pineconeClientFactory);
    if (Array.isArray(vectorIds) && vectorIds.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < vectorIds.length; i += batchSize) {
        await ns.deleteMany(vectorIds.slice(i, i + batchSize));
      }
      return { deletedCount: vectorIds.length };
    }
    await ns.deleteMany({ documentId: { $eq: documentId } });
    return { deletedCount: null };
  }

  throw new Error(`Unsupported vector store provider: ${provider}`);
}
