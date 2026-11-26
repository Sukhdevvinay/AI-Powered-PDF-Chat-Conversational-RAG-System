import { createApp } from './app.js';
import { getConfig } from './config.js';

const config = getConfig();
const app = createApp();

app.listen(config.port, () => {
  console.log(`DocuMind RAG server listening on http://localhost:${config.port}`);
});
