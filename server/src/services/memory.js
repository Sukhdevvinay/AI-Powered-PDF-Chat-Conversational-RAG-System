import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_SESSIONS_PATH = path.resolve(__dirname, '../../data/sessions.json');

/**
 * Manages multi-turn conversational memory and session persistence.
 */
export class ConversationMemoryStore {
  constructor(filePath = DEFAULT_SESSIONS_PATH) {
    this.filePath = filePath;
    this.sessions = null;
  }

  async ensureLoaded() {
    if (this.sessions !== null) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.sessions = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.sessions = [];
      } else {
        throw err;
      }
    }
  }

  async persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.sessions, null, 2), 'utf8');
  }

  async listSessions() {
    await this.ensureLoaded();
    return [...this.sessions]
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map((s) => ({
        id: s.id,
        title: s.title,
        documentIds: s.documentIds,
        messageCount: s.messages.length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));
  }

  async getSession(sessionId) {
    await this.ensureLoaded();
    return this.sessions.find((s) => s.id === sessionId) || null;
  }

  async createSession({ title = 'New Document Chat', documentIds = [] } = {}) {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const session = {
      id: uuidv4(),
      title,
      documentIds: Array.isArray(documentIds) ? documentIds : [],
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.push(session);
    await this.persist();
    return session;
  }

  async updateSession(sessionId, { title, documentIds } = {}) {
    await this.ensureLoaded();
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return null;
    if (typeof title === 'string' && title.trim()) {
      session.title = title.trim();
    }
    if (Array.isArray(documentIds)) {
      session.documentIds = documentIds;
    }
    session.updatedAt = new Date().toISOString();
    await this.persist();
    return session;
  }

  async appendMessage(sessionId, message) {
    await this.ensureLoaded();
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const entry = {
      id: uuidv4(),
      role: message.role,
      content: message.content,
      sources: message.sources || [],
      rewrittenQuery: message.rewrittenQuery || null,
      createdAt: new Date().toISOString(),
    };

    session.messages.push(entry);

    // Auto-title session from the first user question if still using default title
    if (
      session.messages.length === 1 &&
      message.role === 'user' &&
      (session.title === 'New Document Chat' || !session.title)
    ) {
      const cleaned = message.content.trim().replace(/\s+/g, ' ');
      session.title = cleaned.length > 48 ? `${cleaned.slice(0, 45)}...` : cleaned;
    }

    session.updatedAt = new Date().toISOString();
    await this.persist();
    return entry;
  }

  async clearMessages(sessionId) {
    await this.ensureLoaded();
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session) return null;
    session.messages = [];
    session.updatedAt = new Date().toISOString();
    await this.persist();
    return session;
  }

  async deleteSession(sessionId) {
    await this.ensureLoaded();
    const idx = this.sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) return false;
    this.sessions.splice(idx, 1);
    await this.persist();
    return true;
  }

  /**
   * Returns recent conversation turns within the configured sliding memory window.
   */
  async getRecentHistory(sessionId, maxTurns = 8) {
    const session = await this.getSession(sessionId);
    if (!session) return [];
    const maxMessages = Math.max(1, maxTurns) * 2;
    return session.messages.slice(-maxMessages).map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }
}

export const memoryStore = new ConversationMemoryStore();
