// js/knowledge.js — Knowledge tab: Library + Notes
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe, loadJSON, saveLocal,
  escapeHtml, formatNumber, formatDate, formatRelativeTime,
  generateId, debounce, $, $$, openModal, closeModal, showToast
} from './app.js';

// ── State ────────────────────────────────────────────────────────────
let activeDocId = null;
let activeNoteId = null;
let activeFolder = null;
let autoSaveTimer = null;

const FOLDERS_KEY = 'forge-note-folders';
const NOTES_KEY  = 'forge-notes-local';

// ── Public init ──────────────────────────────────────────────────────
export function initKnowledge() {
  loadKnowledgeData();
  bindKnowledgeEvents();

  subscribe((key) => {
    if (key === 'documents') renderLibrary();
    if (key === 'notes')     renderNotes();
  });
}

// ── Data loading ─────────────────────────────────────────────────────
async function loadKnowledgeData() {
  try {
    const [docsIndex, docsData, notesData] = await Promise.all([
      loadJSON('docs-index.json'),
      loadJSON('documents.json'),
      loadJSON('notes.json'),
    ]);

    // Merge local docs + notion docs into a single list
    const allDocs = [
      ...(docsData?.documents || []),
      ...(docsData?.notionDocs || []),
    ];

    setState('docsIndex', docsIndex);
    setState('documents', allDocs);

    // Merge file-based notes with any locally saved notes
    const fileNotes = notesData?.notes || [];
    const localRaw = localStorage.getItem(NOTES_KEY);
    const localNotes = localRaw ? JSON.parse(localRaw) : [];
    const merged = mergeNotes(fileNotes, localNotes);
    setState('notes', merged);

    renderLibrary();
    renderNotes();
  } catch (err) {
    console.error('[knowledge] Failed to load data:', err);
    showToast('Failed to load knowledge data', 'error');
  }
}

function mergeNotes(fileNotes, localNotes) {
  const map = new Map();
  fileNotes.forEach(n => map.set(n.id, n));
  localNotes.forEach(n => map.set(n.id, n));
  return Array.from(map.values());
}

// ═══════════════════════════════════════════════════════════════════════
//  LIBRARY
// ═══════════════════════════════════════════════════════════════════════
function renderLibrary() {
  const el = $('#knowledgeList');
  if (!el) return;

  const docs = getState('documents') || [];
  const searchInput = el.closest('.subtab-panel')?.querySelector('.knowledge-search');
  const query = searchInput?.value?.toLowerCase().trim() || '';

  let filtered = docs;
  if (query) {
    filtered = docs.filter(d =>
      (d.name || '').toLowerCase().includes(query) ||
      (d.category || '').toLowerCase().includes(query) ||
      (d.tags || []).some(t => t.toLowerCase().includes(query))
    );
  }

  // Group by category
  const groups = groupByCategory(filtered);
  const categories = Object.keys(groups).sort();

  if (categories.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>No documents found.</p></div>`;
    return;
  }

  el.innerHTML = `
    <div class="knowledge-search-wrap">
      <input type="search" class="input-search knowledge-search" id="librarySearchInput" placeholder="Search documents..." aria-label="Search documents" value="${escapeHtml(query)}">
    </div>
    ${categories.map(cat => `
      <div class="knowledge-group">
        <h3 class="knowledge-group-title">${escapeHtml(cat)}</h3>
        ${groups[cat].map(doc => `
          <button class="knowledge-item${doc.id === activeDocId ? ' is-active' : ''}" data-doc-id="${escapeHtml(doc.id)}">
            <span class="knowledge-item-icon">${doc.type === 'notion' ? '📄' : '📋'}</span>
            <div class="knowledge-item-info">
              <span class="knowledge-item-title">${escapeHtml(doc.name)}</span>
              <div class="knowledge-item-tags">
                ${(doc.tags || []).map(t => `<span class="tag tag-sm">${escapeHtml(t)}</span>`).join('')}
              </div>
            </div>
          </button>
        `).join('')}
      </div>
    `).join('')}
  `;

  // Re-bind search after render
  const newSearch = $('#librarySearchInput');
  if (newSearch) {
    newSearch.addEventListener('input', debounce(() => renderLibrary(), 300));
  }
}

function groupByCategory(docs) {
  const groups = {};
  docs.forEach(d => {
    const cat = d.category || 'uncategorized';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(d);
  });
  return groups;
}

function renderDocPreview(docId) {
  const el = $('#knowledgePreview');
  if (!el) return;

  const docs = getState('documents') || [];
  const doc = docs.find(d => d.id === docId);

  if (!doc) {
    el.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg><p>Select a document to preview</p></div>`;
    return;
  }

  activeDocId = docId;

  const contentHtml = renderMarkdownBasic(doc.content || '');

  el.innerHTML = `
    <div class="doc-preview">
      <div class="doc-preview-header">
        <h2>${escapeHtml(doc.name)}</h2>
        <div class="doc-preview-meta">
          <span class="badge badge-type">${escapeHtml(doc.type || 'local')}</span>
          <span class="badge badge-category">${escapeHtml(doc.category || '')}</span>
          ${doc.notionUrl ? `<a href="${escapeHtml(doc.notionUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs">Open in Notion</a>` : ''}
        </div>
        <div class="doc-preview-tags">
          ${(doc.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
      <div class="doc-preview-content">${contentHtml}</div>
      <div class="doc-preview-footer">
        ${doc.createdAt ? `<span>Created: ${formatDate(doc.createdAt)}</span>` : ''}
        ${doc.updatedAt ? `<span>Updated: ${formatDate(doc.updatedAt)}</span>` : ''}
        ${doc.lastSynced ? `<span>Synced: ${formatRelativeTime(doc.lastSynced)}</span>` : ''}
      </div>
    </div>
  `;

  // Highlight active item in list
  $$('#knowledgeList .knowledge-item').forEach(item => {
    item.classList.toggle('is-active', item.dataset.docId === docId);
  });
}

/** Simple markdown to HTML for doc preview. Escapes HTML first. */
function renderMarkdownBasic(md) {
  if (!md) return '';

  let html = escapeHtml(md);

  // Headings (# ## ###)
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Bold / italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Unordered list items
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Ordered list items
  html = html.replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>');

  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  html = '<p>' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  html = html.replace(/<p>\s*(<h[2-4]>)/g, '$1');
  html = html.replace(/(<\/h[2-4]>)\s*<\/p>/g, '$1');
  html = html.replace(/<p>\s*(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');

  return html;
}

// ═══════════════════════════════════════════════════════════════════════
//  NOTES
// ═══════════════════════════════════════════════════════════════════════
function renderNotes() {
  renderFolderTree();
  renderNotesList();
}

function getFolders() {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [{ id: 'general', name: 'General' }];
  } catch {
    return [{ id: 'general', name: 'General' }];
  }
}

function saveFolders(folders) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

function renderFolderTree() {
  const el = $('#notesTree');
  if (!el) return;

  const folders = getFolders();

  el.innerHTML = `
    <button class="folder-item${activeFolder === null ? ' is-active' : ''}" data-folder="">
      <span class="folder-icon">📁</span> All Notes
    </button>
    ${folders.map(f => `
      <button class="folder-item${activeFolder === f.id ? ' is-active' : ''}" data-folder="${escapeHtml(f.id)}">
        <span class="folder-icon">📂</span> ${escapeHtml(f.name)}
      </button>
    `).join('')}
  `;
}

function renderNotesList() {
  const el = $('#notesList');
  if (!el) return;

  const notes = getState('notes') || [];
  let filtered = notes;

  if (activeFolder) {
    filtered = notes.filter(n => n.folder === activeFolder);
  }

  // Sort by updatedAt descending
  filtered.sort((a, b) => {
    const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return db - da;
  });

  if (filtered.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>No notes${activeFolder ? ' in this folder' : ''} yet.</p><p class="text-secondary">Click "New Note" to get started.</p></div>`;
    return;
  }

  el.innerHTML = filtered.map(n => {
    const preview = stripHtml(n.content || '').slice(0, 100);
    return `
      <button class="note-item${n.id === activeNoteId ? ' is-active' : ''}" data-note-id="${escapeHtml(n.id)}">
        <div class="note-item-title">${escapeHtml(n.title || 'Untitled')}</div>
        <div class="note-item-preview">${escapeHtml(preview)}${preview.length >= 100 ? '...' : ''}</div>
        <div class="note-item-date">${n.updatedAt ? formatRelativeTime(n.updatedAt) : ''}</div>
      </button>
    `;
  }).join('');
}

function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function openNoteEditor(noteId) {
  const editor = $('#notesEditor');
  const notesList = $('#notesList');
  const titleInput = $('#noteTitleInput');
  const contentEl = $('#noteContent');
  const metaEl = $('#noteMeta');
  const deleteBtn = $('#deleteNoteBtn');
  if (!editor || !titleInput || !contentEl) return;

  const notes = getState('notes') || [];
  const note = noteId ? notes.find(n => n.id === noteId) : null;

  activeNoteId = noteId || null;

  if (note) {
    titleInput.value = note.title || '';
    contentEl.innerHTML = note.content || '';
    if (metaEl) {
      const parts = [];
      if (note.createdAt) parts.push('Created: ' + formatDate(note.createdAt));
      if (note.updatedAt) parts.push('Updated: ' + formatRelativeTime(note.updatedAt));
      if (note.folder) parts.push('Folder: ' + escapeHtml(note.folder));
      metaEl.textContent = parts.join(' | ');
    }
    if (deleteBtn) deleteBtn.removeAttribute('hidden');
  } else {
    titleInput.value = '';
    contentEl.innerHTML = '';
    if (metaEl) metaEl.textContent = '';
    if (deleteBtn) deleteBtn.setAttribute('hidden', '');
  }

  if (notesList) notesList.setAttribute('hidden', '');
  editor.removeAttribute('hidden');
  titleInput.focus();
}

function closeNoteEditor() {
  const editor = $('#notesEditor');
  const notesList = $('#notesList');
  if (editor) editor.setAttribute('hidden', '');
  if (notesList) notesList.removeAttribute('hidden');
  activeNoteId = null;
  clearAutoSave();
  renderNotesList();
}

function saveCurrentNote() {
  const titleInput = $('#noteTitleInput');
  const contentEl = $('#noteContent');
  if (!titleInput || !contentEl) return;

  const title = titleInput.value.trim() || 'Untitled';
  const content = contentEl.innerHTML;
  const now = new Date().toISOString();

  let notes = getState('notes') || [];

  if (activeNoteId) {
    // Update existing
    notes = notes.map(n => {
      if (n.id === activeNoteId) {
        return { ...n, title, content, updatedAt: now };
      }
      return n;
    });
  } else {
    // Create new
    const newNote = {
      id: generateId('note'),
      title,
      content,
      folder: activeFolder || 'general',
      source: 'local',
      createdAt: now,
      updatedAt: now,
    };
    activeNoteId = newNote.id;
    notes.push(newNote);
    // Show delete button now that note exists
    const deleteBtn = $('#deleteNoteBtn');
    if (deleteBtn) deleteBtn.removeAttribute('hidden');
  }

  setState('notes', notes);
  persistNotes(notes);
  showToast('Note saved');
}

function deleteCurrentNote() {
  if (!activeNoteId) return;

  if (!confirm('Delete this note? This cannot be undone.')) return;

  let notes = getState('notes') || [];
  notes = notes.filter(n => n.id !== activeNoteId);
  setState('notes', notes);
  persistNotes(notes);
  showToast('Note deleted');
  closeNoteEditor();
}

function persistNotes(notes) {
  const localNotes = notes.filter(n => n.source === 'local' || !n.source);
  localStorage.setItem(NOTES_KEY, JSON.stringify(localNotes));
}

function scheduleAutoSave() {
  clearAutoSave();
  autoSaveTimer = setTimeout(() => {
    if (activeNoteId || ($('#noteTitleInput'))?.value?.trim() || ($('#noteContent'))?.innerHTML?.trim()) {
      saveCurrentNote();
    }
  }, 2000);
}

function clearAutoSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

function createNewFolder() {
  const name = prompt('Folder name:');
  if (!name || !name.trim()) return;

  const folders = getFolders();
  const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  if (folders.some(f => f.id === id)) {
    showToast('Folder already exists', 'warning');
    return;
  }

  folders.push({ id, name: name.trim() });
  saveFolders(folders);
  renderFolderTree();
  showToast(`Folder "${name.trim()}" created`);
}

// ═══════════════════════════════════════════════════════════════════════
//  TOOLBAR (Rich Text)
// ═══════════════════════════════════════════════════════════════════════
function applyFormat(format) {
  const contentEl = $('#noteContent');
  if (!contentEl) return;
  contentEl.focus();

  if (format === 'h2') {
    document.execCommand('formatBlock', false, 'h2');
  } else if (format === 'blockquote') {
    document.execCommand('formatBlock', false, 'blockquote');
  } else {
    document.execCommand(format, false, null);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════════════════
function bindKnowledgeEvents() {
  // Knowledge subtab switching
  const knowledgeSubtabs = $('#knowledgeSubtabs');
  if (knowledgeSubtabs) {
    knowledgeSubtabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.subtab');
      if (!btn) return;
      const target = btn.dataset.subtab;
      if (!target) return;

      $$('#knowledgeSubtabs .subtab').forEach(b => {
        const isActive = b === btn;
        b.classList.toggle('is-active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });

      ['knowledge-library', 'knowledge-notes'].forEach(id => {
        const panel = $(`#${id}`);
        if (!panel) return;
        const active = id === target;
        panel.classList.toggle('is-active', active);
        if (active) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      });

      // Toggle New Note button visibility
      const noteActions = $('#knowledgeActions');
      if (noteActions) {
        const newNoteBtn = $('#newNoteBtn');
        if (newNoteBtn) {
          if (target === 'knowledge-notes') {
            newNoteBtn.removeAttribute('hidden');
          } else {
            newNoteBtn.setAttribute('hidden', '');
          }
        }
      }
    });
  }

  // Document click (event delegation on knowledgeList)
  const knowledgeList = $('#knowledgeList');
  if (knowledgeList) {
    knowledgeList.addEventListener('click', (e) => {
      const item = e.target.closest('.knowledge-item');
      if (!item) return;
      const docId = item.dataset.docId;
      if (docId) renderDocPreview(docId);
    });
  }

  // Folder tree (event delegation)
  const notesTree = $('#notesTree');
  if (notesTree) {
    notesTree.addEventListener('click', (e) => {
      const item = e.target.closest('.folder-item');
      if (!item) return;
      const folder = item.dataset.folder;
      activeFolder = folder || null;
      renderFolderTree();
      renderNotesList();
    });
  }

  // Notes list click (event delegation)
  const notesList = $('#notesList');
  if (notesList) {
    notesList.addEventListener('click', (e) => {
      const item = e.target.closest('.note-item');
      if (!item) return;
      const noteId = item.dataset.noteId;
      if (noteId) openNoteEditor(noteId);
    });
  }

  // New Note
  $('#newNoteBtn')?.addEventListener('click', () => openNoteEditor(null));

  // Save Note
  $('#saveNoteBtn')?.addEventListener('click', () => {
    clearAutoSave();
    saveCurrentNote();
  });

  // Cancel Note
  $('#cancelNoteBtn')?.addEventListener('click', () => closeNoteEditor());

  // Delete Note
  $('#deleteNoteBtn')?.addEventListener('click', () => deleteCurrentNote());

  // New Folder
  $('#newFolderBtn')?.addEventListener('click', () => createNewFolder());

  // Toolbar formatting (event delegation)
  const toolbar = $('.editor-toolbar');
  if (toolbar) {
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.toolbar-btn');
      if (!btn) return;
      const format = btn.dataset.format;
      if (format) applyFormat(format);
    });
  }

  // Auto-save on content edits
  const noteContent = $('#noteContent');
  if (noteContent) {
    noteContent.addEventListener('input', () => scheduleAutoSave());
  }

  // Auto-save on title change
  const noteTitleInput = $('#noteTitleInput');
  if (noteTitleInput) {
    noteTitleInput.addEventListener('input', () => scheduleAutoSave());
  }
}
