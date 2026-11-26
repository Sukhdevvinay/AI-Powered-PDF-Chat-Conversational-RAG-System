import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send,
  Settings,
  PanelRightOpen,
  PanelRightClose,
  RotateCcw,
  Sparkles,
  Bot,
  User,
  Search,
  AlertTriangle,
  Cpu,
} from 'lucide-react';

const STARTER_PROMPTS = [
  'Summarize the main points and key takeaways from the uploaded PDF.',
  'What methodologies, architectures, or findings are described?',
  'List any important numbers, dates, or limitations mentioned.',
];

export default function ChatPanel({
  config,
  documents,
  selectedDocIds,
  messages,
  streamingState,
  onSendMessage,
  onClearChat,
  onOpenSettings,
  onEnableLocalSandbox,
  inspectorOpen,
  onToggleInspector,
  onSelectSourceMessage,
}) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingState?.text]);

  const activeScopeLabel =
    documents.length === 0
      ? 'No PDFs uploaded'
      : selectedDocIds.length === 0 || selectedDocIds.length === documents.length
      ? `All ${documents.length} PDF(s)`
      : `${selectedDocIds.length} selected PDF(s)`;

  const handleSubmit = (e) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || streamingState?.active) return;
    onSendMessage(trimmed);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <main className="chat-panel">
      <header className="chat-header">
        <div className="header-left">
          <div className="scope-pill">{activeScopeLabel}</div>
          {config && (
            <div className="provider-badges">
              <span className="badge">
                <Cpu size={12} /> {config.llmProvider.toUpperCase()}
              </span>
              <span className="badge">
                Vector: {config.vectorStoreProvider === 'pinecone' ? 'Pinecone' : 'Local'}
              </span>
            </div>
          )}
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="header-btn"
            onClick={onClearChat}
            disabled={messages.length === 0 || streamingState?.active}
            title="Clear current conversation memory"
          >
            <RotateCcw size={15} />
            <span>Clear</span>
          </button>
          <button type="button" className="header-btn" onClick={onOpenSettings}>
            <Settings size={15} />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="header-btn"
            onClick={onToggleInspector}
            title="Toggle RAG Context & Memory Inspector"
          >
            {inspectorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            <span>Context</span>
          </button>
        </div>
      </header>

      {config && !config.readyForChat && (
        <div className="config-banner">
          <AlertTriangle size={18} />
          <div className="config-banner-text">
            <strong>API keys needed:</strong> Configure your Pinecone &amp; LLM API keys in Settings,
            or switch to Local Sandbox Mode to test the full RAG pipeline offline.
          </div>
          <div className="config-banner-actions">
            <button type="button" className="btn-secondary" onClick={onEnableLocalSandbox}>
              Use Local Sandbox
            </button>
            <button type="button" className="btn-primary" onClick={onOpenSettings}>
              Configure Keys
            </button>
          </div>
        </div>
      )}

      <div className="messages-container">
        {messages.length === 0 && !streamingState?.active ? (
          <div className="empty-chat">
            <div className="empty-chat-icon">
              <Sparkles size={28} />
            </div>
            <h2>Conversational PDF Intelligence</h2>
            <p>
              Upload one or more PDFs in the sidebar, then ask questions in natural language.
              Multi-turn conversational memory automatically rewrites follow-ups and retrieves
              grounded passages from Pinecone.
            </p>
            {documents.length > 0 && (
              <div className="starter-grid">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="starter-card"
                    onClick={() => onSendMessage(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((msg) => (
              <div key={msg.id} className={`message-row ${msg.role}`}>
                <div className="avatar">
                  {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className="message-body">
                  {msg.rewrittenQuery && (
                    <div className="rewritten-chip" title="Contextual query rewritten from history">
                      <Search size={12} />
                      <span>Search query: {msg.rewrittenQuery}</span>
                    </div>
                  )}
                  <div className="message-content markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="citation-bar">
                      {msg.sources.map((src) => (
                        <button
                          key={src.id}
                          type="button"
                          className="citation-pill"
                          onClick={() => onSelectSourceMessage(msg, src.id)}
                        >
                          [{src.index}] {src.filename} · p.{src.pageNumber} ({Math.round(src.score * 100)}%)
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {streamingState?.active && (
              <div className="message-row assistant">
                <div className="avatar">
                  <Bot size={16} />
                </div>
                <div className="message-body">
                  {streamingState.stage && (
                    <div className="stage-indicator">{streamingState.stage}</div>
                  )}
                  {streamingState.rewrittenQuery && (
                    <div className="rewritten-chip">
                      <Search size={12} />
                      <span>Search query: {streamingState.rewrittenQuery}</span>
                    </div>
                  )}
                  <div className="message-content markdown-body">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {streamingState.text || '...'}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            documents.length === 0
              ? 'Upload a PDF first to ask questions...'
              : 'Ask a question or follow up on previous answers...'
          }
          disabled={streamingState?.active}
        />
        <button
          type="submit"
          className="send-btn"
          disabled={!input.trim() || streamingState?.active}
          title="Send message"
        >
          <Send size={16} />
        </button>
      </form>
    </main>
  );
}
