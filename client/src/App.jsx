import React, { useCallback, useEffect, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import ContextInspector from './components/ContextInspector.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import {
  clearSessionMessages,
  createSession,
  deleteDocument,
  deleteSession,
  fetchConfig,
  fetchDocuments,
  fetchSession,
  fetchSessions,
  saveConfig,
  streamChat,
  uploadPdf,
} from './api.js';

export default function App() {
  const [config, setConfig] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [inspectedTurn, setInspectedTurn] = useState({
    sources: [],
    rewrittenQuery: null,
    highlightedSourceId: null,
  });
  const [streamingState, setStreamingState] = useState({
    active: false,
    stage: '',
    text: '',
    rewrittenQuery: null,
  });

  const showToast = useCallback((message, type = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const loadInitialData = useCallback(async () => {
    try {
      const [cfgRes, docsRes, sessRes] = await Promise.all([
        fetchConfig(),
        fetchDocuments(),
        fetchSessions(),
      ]);
      setConfig(cfgRes.config);
      setDocuments(docsRes.documents || []);
      const sessList = sessRes.sessions || [];
      setSessions(sessList);

      if (sessList.length > 0) {
        const latest = await fetchSession(sessList[0].id);
        setActiveSessionId(latest.session.id);
        const msgs = latest.session.messages || [];
        setMessages(msgs);
        const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
        if (lastAssistant) {
          setInspectedTurn({
            sources: lastAssistant.sources || [],
            rewrittenQuery: lastAssistant.rewrittenQuery || null,
            highlightedSourceId: null,
          });
        }
      }
    } catch (err) {
      showToast(err.message);
    }
  }, [showToast]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const refreshSessions = async () => {
    const sessRes = await fetchSessions();
    setSessions(sessRes.sessions || []);
  };

  const handleSelectSession = async (id) => {
    try {
      const res = await fetchSession(id);
      setActiveSessionId(res.session.id);
      const msgs = res.session.messages || [];
      setMessages(msgs);
      const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
      setInspectedTurn({
        sources: lastAssistant?.sources || [],
        rewrittenQuery: lastAssistant?.rewrittenQuery || null,
        highlightedSourceId: null,
      });
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleNewSession = async () => {
    try {
      const res = await createSession({ documentIds: selectedDocIds });
      setActiveSessionId(res.session.id);
      setMessages([]);
      setInspectedTurn({ sources: [], rewrittenQuery: null, highlightedSourceId: null });
      await refreshSessions();
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleDeleteSession = async (id) => {
    try {
      await deleteSession(id);
      const sessRes = await fetchSessions();
      const remaining = sessRes.sessions || [];
      setSessions(remaining);
      if (id === activeSessionId) {
        if (remaining.length > 0) {
          await handleSelectSession(remaining[0].id);
        } else {
          setActiveSessionId(null);
          setMessages([]);
          setInspectedTurn({ sources: [], rewrittenQuery: null, highlightedSourceId: null });
        }
      }
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleUploadPdf = async (file) => {
    setUploading(true);
    try {
      const res = await uploadPdf(file);
      setDocuments((prev) => [res.document, ...prev]);
      showToast(
        `Indexed "${res.document.filename}" (${res.document.chunkCount} chunks across ${res.document.pageCount} pages).`,
        'success'
      );
    } catch (err) {
      showToast(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (id) => {
    try {
      await deleteDocument(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      setSelectedDocIds((prev) => prev.filter((docId) => docId !== id));
      showToast('Document and its vectors removed.', 'success');
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleToggleDoc = (id) => {
    setSelectedDocIds((prev) => {
      if (prev.length === 0) {
        return [id];
      }
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        return next;
      }
      const next = [...prev, id];
      return next.length === documents.length ? [] : next;
    });
  };

  const handleSendMessage = async (question) => {
    const tempUserMsg = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: question,
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setStreamingState({
      active: true,
      stage: 'Preparing conversational query...',
      text: '',
      rewrittenQuery: null,
    });

    try {
      let currentText = '';
      await streamChat({
        sessionId: activeSessionId,
        question,
        documentIds: selectedDocIds,
        onStage: (info) => {
          setStreamingState((prev) => ({ ...prev, stage: info.detail }));
        },
        onSources: ({ rewrittenQuery, sources }) => {
          setInspectedTurn({
            sources: sources || [],
            rewrittenQuery: rewrittenQuery !== question ? rewrittenQuery : null,
            highlightedSourceId: null,
          });
          setStreamingState((prev) => ({
            ...prev,
            rewrittenQuery: rewrittenQuery !== question ? rewrittenQuery : null,
          }));
        },
        onToken: (token) => {
          currentText += token;
          setStreamingState((prev) => ({ ...prev, text: currentText }));
        },
        onDone: async (payload) => {
          setActiveSessionId(payload.sessionId);
          setMessages((prev) => {
            const withoutTemp = prev.filter((m) => m.id !== tempUserMsg.id);
            return [...withoutTemp, payload.userMessage, payload.assistantMessage];
          });
          setStreamingState({ active: false, stage: '', text: '', rewrittenQuery: null });
          await refreshSessions();
        },
      });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      setStreamingState({ active: false, stage: '', text: '', rewrittenQuery: null });
      showToast(err.message);
    }
  };

  const handleClearChat = async () => {
    if (!activeSessionId) return;
    try {
      await clearSessionMessages(activeSessionId);
      setMessages([]);
      setInspectedTurn({ sources: [], rewrittenQuery: null, highlightedSourceId: null });
      await refreshSessions();
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleSaveSettings = async (patch) => {
    try {
      const res = await saveConfig(patch);
      setConfig(res.config);
      showToast('Configuration updated.', 'success');
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleEnableLocalSandbox = () =>
    handleSaveSettings({
      vectorStoreProvider: 'local',
      llmProvider: 'local',
      embeddingProvider: 'local',
    });

  return (
    <div className={`app-shell ${inspectorOpen ? 'with-inspector' : 'no-inspector'}`}>
      <Sidebar
        documents={documents}
        selectedDocIds={selectedDocIds}
        onToggleDoc={handleToggleDoc}
        onSelectAllDocs={() => setSelectedDocIds([])}
        onUploadPdf={handleUploadPdf}
        onDeleteDoc={handleDeleteDoc}
        uploading={uploading}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
      />

      <ChatPanel
        config={config}
        documents={documents}
        selectedDocIds={selectedDocIds}
        messages={messages}
        streamingState={streamingState}
        onSendMessage={handleSendMessage}
        onClearChat={handleClearChat}
        onOpenSettings={() => setSettingsOpen(true)}
        onEnableLocalSandbox={handleEnableLocalSandbox}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        onSelectSourceMessage={(msg, sourceId) => {
          setInspectorOpen(true);
          setInspectedTurn({
            sources: msg.sources || [],
            rewrittenQuery: msg.rewrittenQuery || null,
            highlightedSourceId: sourceId,
          });
        }}
      />

      {inspectorOpen && (
        <ContextInspector
          sources={inspectedTurn.sources}
          highlightedSourceId={inspectedTurn.highlightedSourceId}
          rewrittenQuery={inspectedTurn.rewrittenQuery}
          config={config}
          messageCount={messages.length}
        />
      )}

      <SettingsModal
        open={settingsOpen}
        config={config}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveSettings}
      />

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}
