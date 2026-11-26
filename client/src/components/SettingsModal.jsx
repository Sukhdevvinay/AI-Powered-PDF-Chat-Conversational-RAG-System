import React, { useEffect, useState } from 'react';
import { X, Save, ShieldCheck } from 'lucide-react';

export default function SettingsModal({ open, config, onClose, onSave }) {
  const [form, setForm] = useState({
    vectorStoreProvider: 'pinecone',
    pineconeApiKey: '',
    pineconeIndex: 'pdf-rag-index',
    pineconeNamespace: 'default',
    llmProvider: 'openai',
    embeddingProvider: 'openai',
    openaiApiKey: '',
    openaiChatModel: 'gpt-4o-mini',
    openaiEmbeddingModel: 'text-embedding-3-small',
    geminiApiKey: '',
    geminiChatModel: 'gemini-2.5-flash',
    geminiEmbeddingModel: 'text-embedding-004',
    chunkSize: 1000,
    chunkOverlap: 200,
    topK: 5,
    maxHistoryTurns: 8,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config && open) {
      setForm((prev) => ({
        ...prev,
        vectorStoreProvider: config.vectorStoreProvider || 'pinecone',
        pineconeIndex: config.pineconeIndex || 'pdf-rag-index',
        pineconeNamespace: config.pineconeNamespace || 'default',
        llmProvider: config.llmProvider || 'openai',
        embeddingProvider: config.embeddingProvider || 'openai',
        openaiChatModel: config.openaiChatModel || 'gpt-4o-mini',
        openaiEmbeddingModel: config.openaiEmbeddingModel || 'text-embedding-3-small',
        geminiChatModel: config.geminiChatModel || 'gemini-2.5-flash',
        geminiEmbeddingModel: config.geminiEmbeddingModel || 'text-embedding-004',
        chunkSize: config.chunkSize ?? 1000,
        chunkOverlap: config.chunkOverlap ?? 200,
        topK: config.topK ?? 5,
        maxHistoryTurns: config.maxHistoryTurns ?? 8,
      }));
    }
  }, [config, open]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.pineconeApiKey) delete payload.pineconeApiKey;
      if (!payload.openaiApiKey) delete payload.openaiApiKey;
      if (!payload.geminiApiKey) delete payload.geminiApiKey;
      await onSave(payload);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const applyLocalPreset = () => {
    setForm((prev) => ({
      ...prev,
      vectorStoreProvider: 'local',
      llmProvider: 'local',
      embeddingProvider: 'local',
    }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>RAG &amp; Provider Configuration</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="preset-bar">
            <span>
              <ShieldCheck size={15} /> Keys are kept in server runtime memory (or set via{' '}
              <code>.env</code>).
            </span>
            <button type="button" className="btn-secondary" onClick={applyLocalPreset}>
              Local Sandbox Preset
            </button>
          </div>

          <div className="form-grid">
            <label>
              <span>Vector Store Provider</span>
              <select
                value={form.vectorStoreProvider}
                onChange={(e) => setForm({ ...form, vectorStoreProvider: e.target.value })}
              >
                <option value="pinecone">Pinecone (Cloud Vector DB)</option>
                <option value="local">Local Vector Store (Offline Sandbox)</option>
              </select>
            </label>

            <label>
              <span>LLM Provider</span>
              <select
                value={form.llmProvider}
                onChange={(e) => setForm({ ...form, llmProvider: e.target.value })}
              >
                <option value="openai">OpenAI</option>
                <option value="gemini">Google Gemini</option>
                <option value="local">Local Extractive Sandbox</option>
              </select>
            </label>

            <label>
              <span>Embedding Provider</span>
              <select
                value={form.embeddingProvider}
                onChange={(e) => setForm({ ...form, embeddingProvider: e.target.value })}
              >
                <option value="openai">OpenAI Embeddings</option>
                <option value="gemini">Gemini Embeddings</option>
                <option value="local">Local Hash Embeddings</option>
              </select>
            </label>

            <label>
              <span>Pinecone Index Name</span>
              <input
                type="text"
                value={form.pineconeIndex}
                onChange={(e) => setForm({ ...form, pineconeIndex: e.target.value })}
                placeholder="pdf-rag-index"
              />
            </label>

            <label>
              <span>
                Pinecone API Key {config?.pineconeConfigured ? '(configured)' : ''}
              </span>
              <input
                type="password"
                value={form.pineconeApiKey}
                onChange={(e) => setForm({ ...form, pineconeApiKey: e.target.value })}
                placeholder={config?.pineconeConfigured ? '•••••••• (unchanged)' : 'pcsk_...'}
              />
            </label>

            <label>
              <span>Pinecone Namespace</span>
              <input
                type="text"
                value={form.pineconeNamespace}
                onChange={(e) => setForm({ ...form, pineconeNamespace: e.target.value })}
                placeholder="default"
              />
            </label>

            <label>
              <span>OpenAI API Key {config?.openaiConfigured ? '(configured)' : ''}</span>
              <input
                type="password"
                value={form.openaiApiKey}
                onChange={(e) => setForm({ ...form, openaiApiKey: e.target.value })}
                placeholder={config?.openaiConfigured ? '•••••••• (unchanged)' : 'sk-...'}
              />
            </label>

            <label>
              <span>OpenAI Chat Model</span>
              <input
                type="text"
                value={form.openaiChatModel}
                onChange={(e) => setForm({ ...form, openaiChatModel: e.target.value })}
              />
            </label>

            <label>
              <span>Gemini API Key {config?.geminiConfigured ? '(configured)' : ''}</span>
              <input
                type="password"
                value={form.geminiApiKey}
                onChange={(e) => setForm({ ...form, geminiApiKey: e.target.value })}
                placeholder={config?.geminiConfigured ? '•••••••• (unchanged)' : 'AIza...'}
              />
            </label>

            <label>
              <span>Gemini Chat Model</span>
              <input
                type="text"
                value={form.geminiChatModel}
                onChange={(e) => setForm({ ...form, geminiChatModel: e.target.value })}
              />
            </label>

            <label>
              <span>Chunk Size (chars)</span>
              <input
                type="number"
                min={200}
                max={4000}
                value={form.chunkSize}
                onChange={(e) => setForm({ ...form, chunkSize: Number(e.target.value) })}
              />
            </label>

            <label>
              <span>Chunk Overlap (chars)</span>
              <input
                type="number"
                min={0}
                max={1000}
                value={form.chunkOverlap}
                onChange={(e) => setForm({ ...form, chunkOverlap: Number(e.target.value) })}
              />
            </label>

            <label>
              <span>Top-K Retrieved Chunks</span>
              <input
                type="number"
                min={1}
                max={20}
                value={form.topK}
                onChange={(e) => setForm({ ...form, topK: Number(e.target.value) })}
              />
            </label>

            <label>
              <span>Memory Window (turns)</span>
              <input
                type="number"
                min={1}
                max={30}
                value={form.maxHistoryTurns}
                onChange={(e) => setForm({ ...form, maxHistoryTurns: Number(e.target.value) })}
              />
            </label>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              <Save size={15} /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
