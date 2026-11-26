import React, { useRef, useState } from 'react';
import {
  FileText,
  UploadCloud,
  Trash2,
  Plus,
  MessageSquare,
  CheckSquare,
  Square,
  Loader2,
  Database,
} from 'lucide-react';

function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function Sidebar({
  documents,
  selectedDocIds,
  onToggleDoc,
  onSelectAllDocs,
  onUploadPdf,
  onDeleteDoc,
  uploading,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
}) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = (files) => {
    const file = files?.[0];
    if (file) {
      onUploadPdf(file);
    }
  };

  const allSelected = documents.length > 0 && selectedDocIds.length === 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">
          <Database size={18} />
        </div>
        <div>
          <h1>DocuMind RAG</h1>
          <p>PDF Intelligence & Memory</p>
        </div>
      </div>

      <div
        className={`upload-dropzone ${dragActive ? 'drag-active' : ''} ${uploading ? 'uploading' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {uploading ? (
          <>
            <Loader2 size={22} className="spin accent-icon" />
            <span>Extracting, chunking & indexing vectors...</span>
          </>
        ) : (
          <>
            <UploadCloud size={22} className="accent-icon" />
            <span className="upload-title">Upload PDF Document</span>
            <span className="upload-sub">Drop a PDF here or click to browse (max 25 MB)</span>
          </>
        )}
      </div>

      <div className="sidebar-section">
        <div className="section-header">
          <span>Knowledge Base ({documents.length})</span>
          {documents.length > 0 && (
            <button
              type="button"
              className="text-btn"
              onClick={onSelectAllDocs}
              title="Query across all uploaded PDFs"
            >
              {allSelected ? 'All Active' : 'Select All'}
            </button>
          )}
        </div>

        <div className="doc-list">
          {documents.length === 0 ? (
            <div className="empty-hint">
              No PDFs indexed yet. Upload a document to start querying.
            </div>
          ) : (
            documents.map((doc) => {
              const isSelected =
                selectedDocIds.length === 0 || selectedDocIds.includes(doc.id);
              return (
                <div
                  key={doc.id}
                  className={`doc-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => onToggleDoc(doc.id)}
                >
                  <button
                    type="button"
                    className="check-btn"
                    aria-label={`Toggle ${doc.filename}`}
                  >
                    {isSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>
                  <FileText size={16} className="doc-icon" />
                  <div className="doc-meta">
                    <div className="doc-name" title={doc.filename}>
                      {doc.filename}
                    </div>
                    <div className="doc-stats">
                      {doc.pageCount}p · {doc.chunkCount} chunks · {formatBytes(doc.fileSize)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Delete document & vectors"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteDoc(doc.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="sidebar-section sessions-section">
        <div className="section-header">
          <span>Conversations</span>
          <button type="button" className="new-chat-btn" onClick={onNewSession}>
            <Plus size={14} /> New Chat
          </button>
        </div>

        <div className="session-list">
          {sessions.length === 0 ? (
            <div className="empty-hint">No conversation history yet.</div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className={`session-item ${s.id === activeSessionId ? 'active' : ''}`}
                onClick={() => onSelectSession(s.id)}
              >
                <MessageSquare size={14} className="session-icon" />
                <div className="session-meta">
                  <div className="session-title">{s.title}</div>
                  <div className="session-sub">{s.messageCount} messages</div>
                </div>
                <button
                  type="button"
                  className="icon-btn danger"
                  title="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.id);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
