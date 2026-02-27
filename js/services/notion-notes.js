// js/services/notion-notes.js — Notion CRUD via Cloudflare Worker proxy
// ──────────────────────────────────────────────────────────────────────

const ENDPOINT = 'https://anthropic-proxy.dan-a14.workers.dev/notion-notes';

export async function getNotes() {
  try {
    const res = await fetch(ENDPOINT);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.notes || data.results || data || []).map(normalizeNote);
  } catch (err) {
    console.warn('[notion-notes] getNotes failed', err);
    return null; // caller falls back to local
  }
}

export async function createNote(note) {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: note.title,
        content: note.content,
        folder: note.folder || 'general',
        tags: note.tags || [],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return normalizeNote(data);
  } catch (err) {
    console.warn('[notion-notes] createNote failed', err);
    return null;
  }
}

export async function updateNote(noteId, updates) {
  try {
    const res = await fetch(`${ENDPOINT}/${noteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return normalizeNote(data);
  } catch (err) {
    console.warn('[notion-notes] updateNote failed', err);
    return null;
  }
}

export async function deleteNote(noteId) {
  try {
    const res = await fetch(`${ENDPOINT}/${noteId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.warn('[notion-notes] deleteNote failed', err);
    return false;
  }
}

function normalizeNote(row) {
  return {
    id: row.id || row.notionId,
    title: row.title || row.name || 'Untitled',
    content: row.content || '',
    folder: row.folder || row.category || 'general',
    tags: row.tags || [],
    source: 'notion',
    notionUrl: row.url || row.notionUrl || null,
    createdAt: row.created_time || row.createdAt,
    updatedAt: row.last_edited_time || row.updatedAt,
  };
}
