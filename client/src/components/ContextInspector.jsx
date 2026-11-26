import React from 'react';
import { BookOpen, Layers, Search, Sparkles } from 'lucide-react';

export default function ContextInspector({
  sources = [],
  highlightedSourceId,
  rewrittenQuery,
  config,
  messageCount,
}) {
  return (
    <aside className="inspector">
      <div className="inspector-header">
        <BookOpen size={16} />
        <h2>RAG Context Inspector</h2>
      </div>

      <div className="inspector-stats">
        <div className="stat-card">
          <span className="stat-label">Top-K</span>
          <span className="stat-value">{config?.topK ?? 5}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Chunk Size</span>
          <span className="stat-value">{config?.chunkSize ?? 1000}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Memory Turns</span>
          <span className="stat-value">{Math.floor(messageCount / 2)}</span>
        </div>
      </div>

      {rewrittenQuery && (
        <div className="inspector-query-box">
          <div className="box-title">
            <Search size={13} /> Condensed Retrieval Query
          </div>
          <p>{rewrittenQuery}</p>
        </div>
      )}

      <div className="inspector-section-title">
        <Layers size={14} /> Retrieved Passages ({sources.length})
      </div>

      <div className="passage-list">
        {sources.length === 0 ? (
          <div className="empty-hint">
            <Sparkles size={18} style={{ marginBottom: 8, opacity: 0.6 }} />
            <div>
              Ask a question or click a citation badge in chat to inspect the exact vector
              passages retrieved from Pinecone.
            </div>
          </div>
        ) : (
          sources.map((src) => (
            <div
              key={src.id}
              className={`passage-card ${highlightedSourceId === src.id ? 'highlighted' : ''}`}
            >
              <div className="passage-header">
                <span className="passage-index">Source [{src.index}]</span>
                <span className="passage-score">
                  Score: {(src.score * 100).toFixed(1)}%
                </span>
              </div>
              <div className="passage-meta">
                {src.filename} · Page {src.pageNumber} · Chunk #{src.chunkIndex}
              </div>
              <div className="passage-text">{src.text}</div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
