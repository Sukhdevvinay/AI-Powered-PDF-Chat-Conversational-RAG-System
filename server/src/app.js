import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, getPublicConfigStatus } from './config.js';
import { createDocumentsRouter } from './routes/documents.js';
import { createChatRouter } from './routes/chat.js';
import { createConfigRouter } from './routes/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(deps = {}) {
  const app = express();
  const cfg = (deps.getAppConfig || getConfig)();

  app.use(
    cors({
      origin: cfg.clientOrigin || '*',
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      config: getPublicConfigStatus(),
    });
  });

  app.use('/api/config', createConfigRouter());
  app.use('/api/documents', createDocumentsRouter(deps));
  app.use('/api/chat', createChatRouter(deps));

  // Serve built React frontend in production if present
  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((err, _req, res, _next) => {
    const status = err.status || (err.message?.includes('Only PDF') ? 400 : 500);
    res.status(status).json({
      error: err.message || 'Internal server error',
    });
  });

  return app;
}
