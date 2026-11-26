import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { extractPdfPages, chunkPages } from './pdfProcessor.js';
import { generateEmbeddings, generateQueryEmbedding } from './embeddings.js';
import { upsertChunks, querySimilarChunks, deleteDocumentVectors } from './vectorStore.js';
import { condenseQuestion, generateGroundedAnswer } from './llm.js';
import { memoryStore } from './memory.js';
import { documentRegistry } from './documentRegistry.js';

/**
 * Executes the full PDF ingestion pipeline:
 * 1. Extract text per page
 * 2. Split into overlapping chunks
 * 3. Generate vector embeddings
 * 4. Upsert vectors to Pinecone (or configured vector store)
 * 5. Save document metadata in registry
 */
export async function ingestPdfDocument({
  buffer,
  filename,
  fileSize,
  storedFilePath,
  config,
  registry = documentRegistry,
  vectorOptions = {},
}) {
  const documentId = uuidv4();
  const startedAt = Date.now();

  // Stage 1: PDF text extraction
  const extracted = await extractPdfPages(buffer);

  // Stage 2: Chunking with overlap
  const chunks = chunkPages(extracted.pages, {
    documentId,
    filename,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
  });

  if (chunks.length === 0) {
    throw new Error('Could not generate text chunks from the uploaded PDF.');
  }

  // Stage 3: Embedding generation
  const embeddings = await generateEmbeddings(
    chunks.map((c) => c.text),
    config
  );

  // Stage 4: Store vector representations in Pinecone / vector store
  const upsertResult = await upsertChunks(chunks, embeddings, config, vectorOptions);

  // Stage 5: Save document record
  const docRecord = {
    id: documentId,
    filename,
    fileSize,
    storedFilePath: storedFilePath || null,
    pageCount: extracted.pageCount,
    chunkCount: chunks.length,
    totalCharacters: extracted.fullText.length,
    embeddingDimensions: embeddings[0]?.length || 0,
    vectorIds: chunks.map((c) => c.id),
    vectorStoreProvider: config.vectorStoreProvider,
    namespace: config.pineconeNamespace || 'default',
    embeddingProvider: config.embeddingProvider,
    processingMs: Date.now() - startedAt,
    uploadedAt: new Date().toISOString(),
  };

  await registry.addDocument(docRecord);

  return {
    document: docRecord,
    upsertResult,
    sampleChunks: chunks.slice(0, 3).map((c) => ({
      id: c.id,
      pageNumber: c.pageNumber,
      charCount: c.charCount,
      preview: c.text.slice(0, 160),
    })),
  };
}

/**
 * Deletes a document from the registry, vector store, and disk.
 */
export async function deletePdfDocument({
  documentId,
  config,
  registry = documentRegistry,
  vectorOptions = {},
}) {
  const doc = await registry.getDocument(documentId);
  if (!doc) return null;

  await deleteDocumentVectors(
    {
      documentId,
      vectorIds: doc.vectorIds || [],
      config,
    },
    vectorOptions
  );

  await registry.removeDocument(documentId);

  if (doc.storedFilePath) {
    try {
      await fs.unlink(doc.storedFilePath);
    } catch {
      // Ignore missing file on disk
    }
  }

  return doc;
}

/**
 * Executes a conversational RAG turn:
 * 1. Load conversational memory for the session
 * 2. Condense follow-up question using prior history
 * 3. Embed rewritten query and retrieve top-K chunks from Pinecone
 * 4. Generate grounded LLM response using retrieved passages + history
 * 5. Persist user & assistant messages with citations in session memory
 */
export async function runConversationalRag({
  sessionId,
  question,
  documentIds,
  config,
  memory = memoryStore,
  vectorOptions = {},
  onStage,
  onSources,
  onToken,
}) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) {
    throw new Error('Question cannot be empty.');
  }

  let session = sessionId ? await memory.getSession(sessionId) : null;
  if (!session) {
    session = await memory.createSession({
      documentIds: Array.isArray(documentIds) ? documentIds : [],
    });
  } else if (Array.isArray(documentIds)) {
    await memory.updateSession(session.id, { documentIds });
  }

  const effectiveDocIds = Array.isArray(documentIds)
    ? documentIds
    : session.documentIds || [];

  // Step 1: Retrieve recent conversational memory
  const history = await memory.getRecentHistory(session.id, config.maxHistoryTurns || 8);

  // Step 2: Condense follow-up query with conversational memory
  onStage?.({ stage: 'rewriting', detail: 'Analyzing conversational history...' });
  const rewrittenQuery = await condenseQuestion({
    question: cleanQuestion,
    history,
    config,
  });

  // Step 3: Embed query & retrieve similar chunks from vector store
  onStage?.({ stage: 'retrieving', detail: 'Searching vector embeddings...' });
  const queryVector = await generateQueryEmbedding(rewrittenQuery, config);
  const retrievedChunks = await querySimilarChunks(
    {
      vector: queryVector,
      topK: config.topK || 5,
      documentIds: effectiveDocIds,
      config,
    },
    vectorOptions
  );

  const sources = retrievedChunks.map((chunk, index) => ({
    index: index + 1,
    id: chunk.id,
    documentId: chunk.documentId,
    filename: chunk.filename,
    pageNumber: chunk.pageNumber,
    chunkIndex: chunk.chunkIndex,
    score: Number((chunk.score ?? 0).toFixed(4)),
    text: chunk.text,
  }));

  onSources?.({ rewrittenQuery, sources });

  // Step 4: Generate grounded LLM response
  onStage?.({ stage: 'generating', detail: 'Synthesizing grounded response...' });
  const answer = await generateGroundedAnswer({
    question: cleanQuestion,
    retrievedChunks: sources,
    history,
    config,
    onToken,
  });

  // Step 5: Persist user and assistant turns to conversational memory
  const userMessage = await memory.appendMessage(session.id, {
    role: 'user',
    content: cleanQuestion,
  });

  const assistantMessage = await memory.appendMessage(session.id, {
    role: 'assistant',
    content: answer,
    sources,
    rewrittenQuery: rewrittenQuery !== cleanQuestion ? rewrittenQuery : null,
  });

  const updatedSession = await memory.getSession(session.id);

  return {
    sessionId: session.id,
    sessionTitle: updatedSession.title,
    rewrittenQuery,
    userMessage,
    assistantMessage,
    sources,
  };
}
