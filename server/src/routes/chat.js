import express from 'express';
import { getConfig, isChatReady } from '../config.js';
import { memoryStore } from '../services/memory.js';
import { runConversationalRag } from '../services/ragPipeline.js';

export function createChatRouter({
  memory = memoryStore,
  getAppConfig = getConfig,
  vectorOptions = {},
} = {}) {
  const router = express.Router();

  router.get('/sessions', async (_req, res, next) => {
    try {
      const sessions = await memory.listSessions();
      res.json({ sessions });
    } catch (err) {
      next(err);
    }
  });

  router.post('/sessions', async (req, res, next) => {
    try {
      const { title, documentIds } = req.body || {};
      const session = await memory.createSession({ title, documentIds });
      res.status(201).json({ session });
    } catch (err) {
      next(err);
    }
  });

  router.get('/sessions/:id', async (req, res, next) => {
    try {
      const session = await memory.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Chat session not found.' });
      }
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/sessions/:id', async (req, res, next) => {
    try {
      const session = await memory.updateSession(req.params.id, req.body || {});
      if (!session) {
        return res.status(404).json({ error: 'Chat session not found.' });
      }
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });

  router.post('/sessions/:id/clear', async (req, res, next) => {
    try {
      const session = await memory.clearMessages(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Chat session not found.' });
      }
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/sessions/:id', async (req, res, next) => {
    try {
      const deleted = await memory.deleteSession(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Chat session not found.' });
      }
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const config = getAppConfig();
      if (!isChatReady(config)) {
        return res.status(400).json({
          error:
            'LLM, embedding, or vector store provider is not configured. Open Settings to configure API keys or enable Local Sandbox Mode.',
        });
      }

      const { sessionId, question, documentIds } = req.body || {};
      if (!question || !String(question).trim()) {
        return res.status(400).json({ error: 'Question is required.' });
      }

      const result = await runConversationalRag({
        sessionId,
        question,
        documentIds,
        config,
        memory,
        vectorOptions,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/stream', async (req, res) => {
    const config = getAppConfig();
    if (!isChatReady(config)) {
      return res.status(400).json({
        error:
          'LLM, embedding, or vector store provider is not configured. Open Settings to configure API keys or enable Local Sandbox Mode.',
      });
    }

    const { sessionId, question, documentIds } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ error: 'Question is required.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event, payload) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const result = await runConversationalRag({
        sessionId,
        question,
        documentIds,
        config,
        memory,
        vectorOptions,
        onStage: (stageInfo) => sendEvent('stage', stageInfo),
        onSources: (sourceInfo) => sendEvent('sources', sourceInfo),
        onToken: (token) => sendEvent('token', { token }),
      });

      sendEvent('done', result);
      res.end();
    } catch (err) {
      sendEvent('error', { error: err.message || 'Streaming RAG request failed.' });
      res.end();
    }
  });

  return router;
}
