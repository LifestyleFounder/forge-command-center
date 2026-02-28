// js/knowledge.js — Workspace: local-first folders + docs
// ──────────────────────────────────────────────────────────────────────

import {
  escapeHtml, formatRelativeTime, generateId, $, $$, showToast,
  openBlockEditor
} from './app.js';

// ── Storage Keys ────────────────────────────────────────────────────
const DOCS_KEY = 'forge-workspace-docs';
const FOLDERS_KEY = 'forge-workspace-folders';

const DEFAULT_FOLDERS = [
  { id: 'content', name: 'Content' },
  { id: 'ideas', name: 'Ideas' },
  { id: 'business-planning', name: 'Business Planning' },
];

// ── State ───────────────────────────────────────────────────────────
let activeFolder = null; // null = All Notes

// ── Public API ──────────────────────────────────────────────────────
export function initKnowledge() {
  ensureDefaults();
  render();
  bindEvents();
}

export function onKnowledgeTabVisit() {
  render();
}

// ── Storage Helpers ─────────────────────────────────────────────────
export function getWorkspaceDocs() {
  try {
    const raw = localStorage.getItem(DOCS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveWorkspaceDocs(docs) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
  } catch (e) {
    console.error('[workspace] Failed to save docs:', e);
  }
}

export function getWorkspaceFolders() {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_FOLDERS;
  } catch { return DEFAULT_FOLDERS; }
}

function saveFolders(folders) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

function ensureDefaults() {
  if (!localStorage.getItem(FOLDERS_KEY)) {
    saveFolders(DEFAULT_FOLDERS);
  }
}

// ── Render ──────────────────────────────────────────────────────────
function render() {
  renderFolderSidebar();
  renderDocsList();
}

function renderFolderSidebar() {
  const el = $('#workspaceFolderSidebar');
  if (!el) return;

  const folders = getWorkspaceFolders();

  el.innerHTML = `
    <button class="ws-folder-item${activeFolder === null ? ' is-active' : ''}" data-folder="">
      <span class="ws-folder-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
      </span>
      All Notes
      <span class="ws-folder-count">${getWorkspaceDocs().length}</span>
    </button>
    ${folders.map(f => {
      const count = getWorkspaceDocs().filter(d => d.folder === f.id).length;
      return `
        <button class="ws-folder-item${activeFolder === f.id ? ' is-active' : ''}" data-folder="${escapeHtml(f.id)}">
          <span class="ws-folder-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
          </span>
          ${escapeHtml(f.name)}
          <span class="ws-folder-count">${count}</span>
        </button>
      `;
    }).join('')}
  `;
}

function renderDocsList() {
  const el = $('#workspaceDocsMain');
  if (!el) return;

  let docs = getWorkspaceDocs();

  if (activeFolder) {
    docs = docs.filter(d => d.folder === activeFolder);
  }

  // Sort by updatedAt descending
  docs.sort((a, b) => {
    const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return db - da;
  });

  if (docs.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
        <p>No notes${activeFolder ? ' in this folder' : ''} yet.</p>
        <p class="text-secondary">Click "New Note" to get started.</p>
      </div>
    `;
    return;
  }

  const folders = getWorkspaceFolders();
  const folderMap = {};
  folders.forEach(f => { folderMap[f.id] = f.name; });

  el.innerHTML = `
    <div class="ws-doc-grid">
      ${docs.map(doc => {
        const preview = extractPreview(doc.content);
        const folderName = folderMap[doc.folder] || doc.folder || '';
        return `
          <button class="ws-doc-card" data-doc-id="${escapeHtml(doc.id)}">
            <div class="ws-doc-card-title">${escapeHtml(doc.title || 'Untitled')}</div>
            <div class="ws-doc-card-preview">${escapeHtml(preview)}</div>
            <div class="ws-doc-card-meta">
              ${folderName ? `<span class="ws-doc-card-folder">${escapeHtml(folderName)}</span>` : ''}
              <span class="ws-doc-card-time">${doc.updatedAt ? formatRelativeTime(doc.updatedAt) : ''}</span>
              ${doc.notionPageId ? '<span class="ws-doc-card-backed" title="Backed up to Notion">&#9729;</span>' : ''}
            </div>
            <button class="ws-doc-delete" data-delete-id="${escapeHtml(doc.id)}" title="Delete note">&times;</button>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

/** Extract plain-text preview from Tiptap JSON content */
function extractPreview(content) {
  if (!content) return '';
  if (typeof content === 'string') return content.slice(0, 120);

  // Walk Tiptap JSON and collect text
  const texts = [];
  function walk(node) {
    if (texts.join(' ').length > 120) return;
    if (node.text) texts.push(node.text);
    if (node.content) node.content.forEach(walk);
  }
  walk(content);
  const full = texts.join(' ');
  return full.length > 120 ? full.slice(0, 120) + '...' : full;
}

// ── Events ──────────────────────────────────────────────────────────
function bindEvents() {
  // Folder sidebar clicks
  const sidebar = $('#workspaceFolderSidebar');
  if (sidebar) {
    sidebar.addEventListener('click', (e) => {
      const item = e.target.closest('.ws-folder-item');
      if (!item) return;
      const folder = item.dataset.folder;
      activeFolder = folder || null;
      render();
    });
  }

  // Doc card clicks
  const main = $('#workspaceDocsMain');
  if (main) {
    main.addEventListener('click', (e) => {
      // Delete button
      const deleteBtn = e.target.closest('.ws-doc-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const docId = deleteBtn.dataset.deleteId;
        if (docId) deleteDoc(docId);
        return;
      }

      // Open doc in editor
      const card = e.target.closest('.ws-doc-card');
      if (card) {
        const docId = card.dataset.docId;
        if (docId) openBlockEditor({ docId, onClose: () => render() });
      }
    });
  }

  // New Note button
  const newNoteBtn = $('#wsNewNoteBtn');
  if (newNoteBtn) {
    newNoteBtn.addEventListener('click', () => {
      openBlockEditor({ folder: activeFolder, onClose: () => render() });
    });
  }

  // New Folder button
  const newFolderBtn = $('#wsNewFolderBtn');
  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', () => createNewFolder());
  }
}

function deleteDoc(docId) {
  if (!confirm('Delete this note?')) return;
  let docs = getWorkspaceDocs();
  docs = docs.filter(d => d.id !== docId);
  saveWorkspaceDocs(docs);
  showToast('Note deleted');
  render();
}

function createNewFolder() {
  const name = prompt('Folder name:');
  if (!name || !name.trim()) return;

  const folders = getWorkspaceFolders();
  const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  if (folders.some(f => f.id === id)) {
    showToast('Folder already exists', 'warning');
    return;
  }

  folders.push({ id, name: name.trim() });
  saveFolders(folders);
  showToast(`Folder "${name.trim()}" created`);
  render();
}
