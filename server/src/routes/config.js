import express from 'express';
import { getPublicConfigStatus, updateConfig } from '../config.js';

export function createConfigRouter() {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.json({ config: getPublicConfigStatus() });
  });

  router.post('/', (req, res) => {
    const updated = updateConfig(req.body || {});
    res.json({ config: updated });
  });

  return router;
}
