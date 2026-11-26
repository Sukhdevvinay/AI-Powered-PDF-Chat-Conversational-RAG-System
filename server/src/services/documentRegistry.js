import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DOCS_PATH = path.resolve(__dirname, '../../data/documents.json');

/**
 * Persists metadata for uploaded and indexed PDF documents.
 */
export class DocumentRegistry {
  constructor(filePath = DEFAULT_DOCS_PATH) {
    this.filePath = filePath;
    this.documents = null;
  }

  async ensureLoaded() {
    if (this.documents !== null) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.documents = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.documents = [];
      } else {
        throw err;
      }
    }
  }

  async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.documents, null, 2), 'utf8');
  }

  async listDocuments() {
    await this.ensureLoaded();
    return [...this.documents].sort(
      (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
    );
  }

  async getDocument(documentId) {
    await this.ensureLoaded();
    return this.documents.find((d) => d.id === documentId) || null;
  }

  async addDocument(doc) {
    await this.ensureLoaded();
    this.documents.push(doc);
    await this.persist();
    return doc;
  }

  async removeDocument(documentId) {
    await this.ensureLoaded();
    const idx = this.documents.findIndex((d) => d.id === documentId);
    if (idx === -1) return null;
    const [removed] = this.documents.splice(idx, 1);
    await this.persist();
    return removed;
  }
}

export const documentRegistry = new DocumentRegistry();
