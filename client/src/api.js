const API_BASE = '/api';

async function parseJsonResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}

export async function fetchConfig() {
  const res = await fetch(`${API_BASE}/config`);
  return parseJsonResponse(res);
}

export async function saveConfig(patch) {
  const res = await fetch(`${API_BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJsonResponse(res);
}

export async function fetchDocuments() {
  const res = await fetch(`${API_BASE}/documents`);
  return parseJsonResponse(res);
}

export async function uploadPdf(file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/documents/upload`, {
    method: 'POST',
    body: formData,
  });
  return parseJsonResponse(res);
}

export async function deleteDocument(id) {
  const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return parseJsonResponse(res);
}

export async function fetchSessions() {
  const res = await fetch(`${API_BASE}/chat/sessions`);
  return parseJsonResponse(res);
}

export async function createSession({ title, documentIds } = {}) {
  const res = await fetch(`${API_BASE}/chat/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, documentIds }),
  });
  return parseJsonResponse(res);
}

export async function fetchSession(id) {
  const res = await fetch(`${API_BASE}/chat/sessions/${encodeURIComponent(id)}`);
  return parseJsonResponse(res);
}

export async function clearSessionMessages(id) {
  const res = await fetch(`${API_BASE}/chat/sessions/${encodeURIComponent(id)}/clear`, {
    method: 'POST',
  });
  return parseJsonResponse(res);
}

export async function deleteSession(id) {
  const res = await fetch(`${API_BASE}/chat/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return parseJsonResponse(res);
}

/**
 * Streams a conversational RAG response using Server-Sent Events (SSE).
 */
export async function streamChat({
  sessionId,
  question,
  documentIds,
  onStage,
  onSources,
  onToken,
  onDone,
  onError,
  signal,
}) {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, question, documentIds }),
    signal,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Chat request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processBlock = (block) => {
    const lines = block.split('\n');
    let eventName = 'message';
    let dataLine = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLine += line.slice(5).trim();
      }
    }

    if (!dataLine) return;
    const payload = JSON.parse(dataLine);

    if (eventName === 'stage') onStage?.(payload);
    else if (eventName === 'sources') onSources?.(payload);
    else if (eventName === 'token') onToken?.(payload.token);
    else if (eventName === 'done') onDone?.(payload);
    else if (eventName === 'error') {
      throw new Error(payload.error || 'Streaming failed');
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        if (part.trim()) processBlock(part);
      }
    }
    if (buffer.trim()) {
      processBlock(buffer);
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      onError?.(err);
      throw err;
    }
  }
}
