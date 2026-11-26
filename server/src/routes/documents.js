import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, isIngestionReady } from '../config.js';
import { documentRegistry } from '../services/documentRegistry.js';
import { ingestPdfDocument, deletePdfDocument } from '../services/ragPipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB limit
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      cb(new Error('Only PDF files are supported.'));
      return;
    }
    cb(null, true);
  },
});

export function createDocumentsRouter({
  registry = documentRegistry,
  getAppConfig = getConfig,
  vectorOptions = {},
  uploadsDir = UPLOADS_DIR,
} = {}) {
  const router = express.Router();

  router.get('/', async (_req, res, next) => {
    try {
      const documents = await registry.listDocuments();
      res.json({ documents });
    } catch (err) {
      next(err);
    }
  });

  router.post('/upload', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No PDF file uploaded.' });
      }

      const config = getAppConfig();
      if (!isIngestionReady(config)) {
        return res.status(400).json({
          error:
            'Vector store or embedding provider is not configured. Add Pinecone & LLM/Embedding API keys in Settings or switch to Local Sandbox Mode.',
        });
      }

      await fs.mkdir(uploadsDir, { recursive: true });
      const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storedFilePath = path.join(uploadsDir, `${Date.now()}-${safeName}`);
      await fs.writeFile(storedFilePath, req.file.buffer);

      const result = await ingestPdfDocument({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        fileSize: req.file.size,
        storedFilePath,
        config,
        registry,
        vectorOptions,
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const config = getAppConfig();
      const removed = await deletePdfDocument({
        documentId: req.params.id,
        config,
        registry,
        vectorOptions,
      });

      if (!removed) {
        return res.status(404).json({ error: 'Document not found.' });
      }

      res.json({ deleted: true, documentId: removed.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
