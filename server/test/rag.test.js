import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import http from 'node:http';
import { extractPdfPages, chunkPages } from '../src/services/pdfProcessor.js';
import {
  upsertChunks,
  querySimilarChunks,
  deleteDocumentVectors,
} from '../src/services/vectorStore.js';
import { ConversationMemoryStore } from '../src/services/memory.js';
import { DocumentRegistry } from '../src/services/documentRegistry.js';
import { createApp } from '../src/app.js';

/**
 * Generates a valid multi-page PDF Buffer with real text streams for testing pdf-parse.
 */
function buildTestPdfBuffer(pageTexts) {
  const objects = [];
  const pageCount = pageTexts.length;
  // Obj 1: Catalog, Obj 2: Pages, Obj 3: Font
  // For each page i: Page obj = 4 + i*2, Content stream obj = 5 + i*2
  const pageIds = pageTexts.map((_, i) => 4 + i * 2);

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`
  );
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  );

  pageTexts.forEach((text, i) => {
    const pageObjId = 4 + i * 2;
    const contentObjId = 5 + i * 2;
    const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;

    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n`
    );
    objects.push(
      `${contentObjId} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

test('PDF extraction and overlapping chunking preserve page numbers and boundaries', async () => {
  const longPage1 =
    'Retrieval Augmented Generation combines semantic vector search with large language model synthesis. '.repeat(
      6
    );
  const page2 =
    'Pinecone stores high-dimensional vector embeddings and supports metadata filtering for fast similarity search.';
  const pdfBuffer = buildTestPdfBuffer([longPage1, page2]);

  const extracted = await extractPdfPages(pdfBuffer);
  assert.equal(extracted.pageCount, 2);
  assert.equal(extracted.pages.length, 2);
  assert.match(extracted.pages[0].text, /Retrieval Augmented Generation/);
  assert.match(extracted.pages[1].text, /Pinecone stores/);

  const chunks = chunkPages(extracted.pages, {
    documentId: 'doc-123',
    filename: 'architecture.pdf',
    chunkSize: 240,
    chunkOverlap: 50,
  });

  assert.ok(chunks.length >= 3, 'Expected multiple chunks from long page 1 + page 2');
  assert.equal(chunks[0].documentId, 'doc-123');
  assert.equal(chunks[0].filename, 'architecture.pdf');
  assert.equal(chunks[0].pageNumber, 1);
  assert.equal(chunks[chunks.length - 1].pageNumber, 2);
  assert.ok(chunks[0].tokenEstimate > 0);
});

test('Pinecone vectorStore adapter formats upsert, filtered query, and delete calls', async () => {
  const calls = { upsert: [], query: [], deleteMany: [] };
  const mockFactory = () => ({
    index: (name) => {
      assert.equal(name, 'test-index');
      return {
        namespace: (ns) => {
          assert.equal(ns, 'docs-ns');
          return {
            upsert: async (batch) => calls.upsert.push(batch),
            query: async (payload) => {
              calls.query.push(payload);
              return {
                matches: [
                  {
                    id: 'doc-1_chunk_0',
                    score: 0.91,
                    metadata: {
                      documentId: 'doc-1',
                      filename: 'guide.pdf',
                      pageNumber: 3,
                      chunkIndex: 0,
                      text: 'Pinecone vector search result',
                    },
                  },
                ],
              };
            },
            deleteMany: async (ids) => calls.deleteMany.push(ids),
          };
        },
      };
    },
  });

  const config = {
    vectorStoreProvider: 'pinecone',
    pineconeApiKey: 'pcsk_test',
    pineconeIndex: 'test-index',
    pineconeNamespace: 'docs-ns',
  };

  await upsertChunks(
    [
      {
        id: 'doc-1_chunk_0',
        documentId: 'doc-1',
        filename: 'guide.pdf',
        pageNumber: 3,
        chunkIndex: 0,
        tokenEstimate: 10,
        text: 'Pinecone vector search result',
      },
    ],
    [[0.1, 0.2, 0.3]],
    config,
    { pineconeClientFactory: mockFactory }
  );

  assert.equal(calls.upsert.length, 1);
  assert.equal(calls.upsert[0][0].id, 'doc-1_chunk_0');
  assert.equal(calls.upsert[0][0].metadata.pageNumber, 3);

  const matches = await querySimilarChunks(
    { vector: [0.1, 0.2, 0.3], topK: 4, documentIds: ['doc-1'], config },
    { pineconeClientFactory: mockFactory }
  );

  assert.equal(calls.query[0].topK, 4);
  assert.deepEqual(calls.query[0].filter, { documentId: { $eq: 'doc-1' } });
  assert.equal(matches[0].score, 0.91);
  assert.equal(matches[0].filename, 'guide.pdf');

  await deleteDocumentVectors(
    { documentId: 'doc-1', vectorIds: ['doc-1_chunk_0'], config },
    { pineconeClientFactory: mockFactory }
  );
  assert.deepEqual(calls.deleteMany[0], ['doc-1_chunk_0']);
});

test('ConversationMemoryStore persists sessions and applies sliding history window', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-mem-'));
  try {
    const store = new ConversationMemoryStore(path.join(tmpDir, 'sessions.json'));
    const session = await store.createSession({ documentIds: ['doc-a'] });

    await store.appendMessage(session.id, { role: 'user', content: 'First question about RAG?' });
    await store.appendMessage(session.id, { role: 'assistant', content: 'First answer.' });
    await store.appendMessage(session.id, { role: 'user', content: 'Second question?' });
    await store.appendMessage(session.id, { role: 'assistant', content: 'Second answer.' });

    const fetched = await store.getSession(session.id);
    assert.equal(fetched.title, 'First question about RAG?');
    assert.equal(fetched.messages.length, 4);

    const recentOneTurn = await store.getRecentHistory(session.id, 1);
    assert.equal(recentOneTurn.length, 2);
    assert.equal(recentOneTurn[0].content, 'Second question?');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Invokes an Express app in-process without opening a TCP socket.
 */
function invokeApp(app, { method = 'GET', url = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const socket = new PassThrough();
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );

    const bodyBuffer = body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
    if (bodyBuffer && !req.headers['content-length']) {
      req.headers['content-length'] = String(bodyBuffer.length);
    }

    const res = new http.ServerResponse(req);
    const chunks = [];
    res.assignSocket(new PassThrough());
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);

    res.write = (chunk, encoding, cb) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      return origWrite(chunk, encoding, cb);
    };
    res.end = (chunk, encoding, cb) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      const result = origEnd(chunk, encoding, cb);
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        text,
        json: () => JSON.parse(text),
      });
      return result;
    };

    app.handle(req, res, (err) => {
      if (err) reject(err);
    });

    if (bodyBuffer) {
      req.push(bodyBuffer);
    }
    req.push(null);
  });
}

function buildMultipartPdfBody(filename, pdfBuffer) {
  const boundary = '----DocuMindTestBoundary7MA4YWxkTrZu0gW';
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
    'utf8'
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([header, pdfBuffer, footer]),
  };
}

test('End-to-end API: PDF upload, multi-turn conversational RAG, streaming, and deletion', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-e2e-'));
  const registry = new DocumentRegistry(path.join(tmpDir, 'documents.json'));
  const memory = new ConversationMemoryStore(path.join(tmpDir, 'sessions.json'));
  const localStorePath = path.join(tmpDir, 'local-vectors.json');
  const uploadsDir = path.join(tmpDir, 'uploads');

  const testConfig = {
    clientOrigin: '*',
    vectorStoreProvider: 'local',
    llmProvider: 'local',
    embeddingProvider: 'local',
    chunkSize: 500,
    chunkOverlap: 100,
    topK: 3,
    maxHistoryTurns: 6,
  };

  const app = createApp({
    registry,
    memory,
    uploadsDir,
    vectorOptions: { localStorePath },
    getAppConfig: () => testConfig,
  });

  try {
    // 1. Upload a PDF
    const pdfBuffer = buildTestPdfBuffer([
      'DocuMind uses Pinecone vector embeddings to index PDF chunks for fast semantic retrieval.',
      'Conversational memory rewrites follow-up questions so multi-turn document chats stay accurate.',
    ]);

    const multipart = buildMultipartPdfBody('documind.pdf', pdfBuffer);
    const uploadRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/documents/upload',
      headers: { 'Content-Type': multipart.contentType },
      body: multipart.body,
    });
    assert.equal(uploadRes.status, 201);
    const uploadData = uploadRes.json();
    assert.equal(uploadData.document.filename, 'documind.pdf');
    assert.equal(uploadData.document.pageCount, 2);
    assert.ok(uploadData.document.chunkCount >= 2);

    const docId = uploadData.document.id;

    // 2. Turn 1: Initial question
    const turn1Res = await invokeApp(app, {
      method: 'POST',
      url: '/api/chat',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'How does DocuMind index PDF chunks?',
        documentIds: [docId],
      }),
    });
    assert.equal(turn1Res.status, 200);
    const turn1 = turn1Res.json();
    assert.ok(turn1.sessionId);
    assert.ok(turn1.sources.length >= 1);
    assert.match(turn1.assistantMessage.content, /Pinecone/i);

    // 3. Turn 2: Follow-up with pronoun relying on conversational memory
    const turn2Res = await invokeApp(app, {
      method: 'POST',
      url: '/api/chat',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: turn1.sessionId,
        question: 'How does it keep multi-turn chats accurate?',
        documentIds: [docId],
      }),
    });
    assert.equal(turn2Res.status, 200);
    const turn2 = turn2Res.json();
    assert.ok(turn2.rewrittenQuery.includes('context:'));
    assert.match(turn2.assistantMessage.content, /Conversational memory/i);

    // 4. Verify session retained all 4 messages (2 turns)
    const sessionRes = await invokeApp(app, {
      method: 'GET',
      url: `/api/chat/sessions/${turn1.sessionId}`,
    });
    assert.equal(sessionRes.status, 200);
    const sessionData = sessionRes.json();
    assert.equal(sessionData.session.messages.length, 4);

    // 5. SSE streaming turn
    const streamRes = await invokeApp(app, {
      method: 'POST',
      url: '/api/chat/stream',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: turn1.sessionId,
        question: 'Summarize Pinecone usage',
        documentIds: [docId],
      }),
    });
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.text, /event: sources/);
    assert.match(streamRes.text, /event: token/);
    assert.match(streamRes.text, /event: done/);

    // 6. Delete document & verify cleanup
    const delRes = await invokeApp(app, {
      method: 'DELETE',
      url: `/api/documents/${docId}`,
    });
    assert.equal(delRes.status, 200);
    const listRes = await invokeApp(app, { method: 'GET', url: '/api/documents' });
    const listData = listRes.json();
    assert.equal(listData.documents.length, 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
