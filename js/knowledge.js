// js/knowledge.js — Workspace: local-first folders + docs
// ──────────────────────────────────────────────────────────────────────

import {
  escapeHtml, formatRelativeTime, generateId, $, $$, showToast,
  openBlockEditor
} from './app.js';
import {
  fetchFolders, fetchDocs, upsertFolders,
  deleteDoc as sbDeleteDoc, deleteFolder as sbDeleteFolder, pushAllDocs
} from './services/workspace-persistence.js';

// ── Storage Keys ────────────────────────────────────────────────────
const DOCS_KEY = 'forge-workspace-docs';
const FOLDERS_KEY = 'forge-workspace-folders';

const DEFAULT_FOLDERS = [
  { id: 'business-planning', name: 'Business Planning', parentId: null, order: 0, type: 'divider' },
  { id: 'ideas', name: 'Ideas', parentId: 'business-planning', order: 0, type: 'folder' },
  { id: 'content', name: 'Content', parentId: null, order: 1, type: 'divider' },
];

// ── State ───────────────────────────────────────────────────────────
let activeFolder = null; // null = no folder selected (empty state)
let expandedFolders = new Set(); // track which folders are expanded
let draggedFolderId = null;

// ── Public API ──────────────────────────────────────────────────────
export function initKnowledge() {
  ensureDefaults();
  render();
  bindEvents();
  // Fire-and-forget Supabase sync (doesn't block render)
  syncFromSupabase();
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
    const folders = raw ? JSON.parse(raw) : DEFAULT_FOLDERS;
    // Backwards-compat: ensure parentId, order & type exist on every folder
    return folders.map((f, i) => ({
      parentId: null,
      order: i,
      type: 'folder',
      ...f,
    }));
  } catch { return DEFAULT_FOLDERS; }
}

function saveFolders(folders) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  upsertFolders(folders); // fire-and-forget Supabase sync
}

function ensureDefaults() {
  if (!localStorage.getItem(FOLDERS_KEY)) {
    saveFolders(DEFAULT_FOLDERS);
    // Auto-expand all dividers on fresh install
    DEFAULT_FOLDERS.filter(f => f.type === 'divider').forEach(f => expandedFolders.add(f.id));
    return;
  }
  // Migrate existing folders to include parentId, order & type
  const folders = getWorkspaceFolders(); // already adds defaults via getWorkspaceFolders
  saveFolders(folders);

  // Auto-expand all dividers so children are visible
  folders.filter(f => f.type === 'divider').forEach(f => expandedFolders.add(f.id));
}

// ── Supabase Sync ──────────────────────────────────────────────────

async function syncFromSupabase() {
  try {
    const [remoteFolders, remoteDocs] = await Promise.all([fetchFolders(), fetchDocs()]);

    // If Supabase is unavailable, skip sync
    if (remoteFolders === null && remoteDocs === null) return;

    const localFolders = getWorkspaceFolders();
    const localDocs = getWorkspaceDocs();

    const hasRemoteFolders = remoteFolders && remoteFolders.length > 0;
    const hasRemoteDocs = remoteDocs && remoteDocs.length > 0;
    const hasLocalDocs = localDocs.length > 0;

    if (!hasRemoteFolders && !hasRemoteDocs && hasLocalDocs) {
      // First-time migration: push all local data to Supabase
      console.log('[workspace] First-time sync — pushing local data to Supabase');
      upsertFolders(localFolders);
      pushAllDocs(localDocs);
      return;
    }

    if (!hasRemoteFolders && !hasRemoteDocs) {
      // Both empty — nothing to sync
      return;
    }

    // Merge folders: remote wins on newer updatedAt
    const mergedFolders = mergeFolders(localFolders, remoteFolders || []);
    saveFoldersLocal(mergedFolders);

    // Merge docs: remote wins on newer updatedAt
    const mergedDocs = mergeDocs(localDocs, remoteDocs || []);
    saveDocsLocal(mergedDocs);

    // Push merged result back to Supabase (local-only items sync up)
    upsertFolders(mergedFolders);
    pushAllDocs(mergedDocs);

    render();
    console.log('[workspace] Synced from Supabase:', mergedFolders.length, 'folders,', mergedDocs.length, 'docs');
  } catch (err) {
    console.warn('[workspace] syncFromSupabase failed (non-blocking)', err);
  }
}

function mergeFolders(local, remote) {
  const map = new Map();
  // Start with remote
  for (const f of remote) map.set(f.id, f);
  // Overlay local where newer
  for (const f of local) {
    const existing = map.get(f.id);
    if (!existing) {
      map.set(f.id, f); // local-only, keep
    } else {
      const localTime = f.updatedAt ? new Date(f.updatedAt).getTime() : 0;
      const remoteTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      if (localTime > remoteTime) map.set(f.id, f);
    }
  }
  return Array.from(map.values());
}

function mergeDocs(local, remote) {
  const map = new Map();
  for (const d of remote) map.set(d.id, d);
  for (const d of local) {
    const existing = map.get(d.id);
    if (!existing) {
      map.set(d.id, d);
    } else {
      const localTime = d.updatedAt ? new Date(d.updatedAt).getTime() : 0;
      const remoteTime = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      if (localTime > remoteTime) map.set(d.id, d);
    }
  }
  return Array.from(map.values());
}

/** Write folders to localStorage only (no Supabase side-effect) */
function saveFoldersLocal(folders) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

/** Write docs to localStorage only (no Supabase side-effect) */
function saveDocsLocal(docs) {
  try {
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs));
  } catch (e) {
    console.error('[workspace] Failed to save docs:', e);
  }
}

// ── Folder Helpers ──────────────────────────────────────────────────

/** Get children of a parent, sorted by order */
function getChildren(folders, parentId) {
  return folders
    .filter(f => f.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

/** Get all descendant IDs of a folder (for cycle prevention) */
function getDescendantIds(folders, folderId) {
  const ids = new Set();
  function collect(pid) {
    folders.filter(f => f.parentId === pid).forEach(f => {
      ids.add(f.id);
      collect(f.id);
    });
  }
  collect(folderId);
  return ids;
}

/** Count docs directly in this folder only (not descendants) */
function countDocsDirect(folderId, docs) {
  return docs.filter(d => d.folder === folderId).length;
}

/** Check if a folder has children */
function hasChildren(folders, folderId) {
  return folders.some(f => f.parentId === folderId);
}

/** Build full path name for a folder (e.g. "Content > Ideas") */
export function getFolderPath(folders, folderId) {
  const parts = [];
  let current = folders.find(f => f.id === folderId);
  while (current) {
    parts.unshift(current.name);
    current = current.parentId ? folders.find(f => f.id === current.parentId) : null;
  }
  return parts.join(' > ');
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
  const docs = getWorkspaceDocs();
  const isMobile = window.innerWidth < 768;

  el.innerHTML = `
    ${renderFolderTree(folders, null, 0, docs, isMobile)}
  `;
}

function renderFolderTree(folders, parentId, depth, docs, isMobile) {
  const children = getChildren(folders, parentId);
  if (children.length === 0) return '';

  return children.map(f => {
    const isDivider = f.type === 'divider';
    const hasKids = hasChildren(folders, f.id);
    const isExpanded = expandedFolders.has(f.id);
    const indent = isMobile ? depth * 10 : depth * 16;

    if (isDivider) {
      // Divider: section header, not selectable, toggle only
      return `
        <div class="ws-folder-row ws-divider-row" data-folder-id="${escapeHtml(f.id)}">
          <button class="ws-divider-item" data-divider="${escapeHtml(f.id)}">
            <span class="ws-folder-toggle${isExpanded ? ' is-expanded' : ''}" data-toggle="${escapeHtml(f.id)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            </span>
            ${escapeHtml(f.name)}
          </button>
          <span class="ws-folder-delete" role="button" tabindex="0" data-delete-folder="${escapeHtml(f.id)}" title="Delete section">&times;</span>
        </div>
        ${isExpanded ? `<div class="ws-folder-children">${renderFolderTree(folders, f.id, depth + 1, docs, isMobile)}</div>` : ''}
      `;
    }

    // Regular folder
    const count = countDocsDirect(f.id, docs);
    let html = `
      <div class="ws-folder-row" data-folder-id="${escapeHtml(f.id)}"${!isMobile ? ` draggable="true"` : ''}>
        <button class="ws-folder-item${activeFolder === f.id ? ' is-active' : ''}" data-folder="${escapeHtml(f.id)}" style="${indent ? `padding-left: ${indent + 12}px` : ''}">
          ${hasKids ? `<span class="ws-folder-toggle${isExpanded ? ' is-expanded' : ''}" data-toggle="${escapeHtml(f.id)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
          </span>` : `<span class="ws-folder-toggle-spacer"></span>`}
          <span class="ws-folder-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
          </span>
          ${escapeHtml(f.name)}
          <span class="ws-folder-count">${count}</span>
        </button>
        <span class="ws-folder-delete" role="button" tabindex="0" data-delete-folder="${escapeHtml(f.id)}" title="Delete folder">&times;</span>
      </div>
      ${hasKids && isExpanded ? `<div class="ws-folder-children">${renderFolderTree(folders, f.id, depth + 1, docs, isMobile)}</div>` : ''}
    `;
    return html;
  }).join('');
}

function renderDocsList() {
  const el = $('#workspaceDocsMain');
  if (!el) return;

  const folders = getWorkspaceFolders();

  // No folder selected — show empty state prompting user to pick one
  if (!activeFolder) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
        </svg>
        <p>Select a folder to view your notes</p>
      </div>
    `;
    return;
  }

  let docs = getWorkspaceDocs().filter(d => d.folder === activeFolder);

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
        <p>No notes in this folder yet.</p>
        <p class="text-secondary">Click "New Note" to get started.</p>
      </div>
    `;
    return;
  }

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
  const sidebar = $('#workspaceFolderSidebar');
  if (sidebar) {
    // Folder clicks (select + toggle)
    sidebar.addEventListener('click', (e) => {
      // Delete folder button
      const deleteBtn = e.target.closest('.ws-folder-delete');
      if (deleteBtn) {
        e.stopPropagation();
        const folderId = deleteBtn.dataset.deleteFolder;
        if (folderId) deleteFolder(folderId);
        return;
      }

      // Toggle expand/collapse
      const toggle = e.target.closest('.ws-folder-toggle');
      if (toggle) {
        e.stopPropagation();
        const folderId = toggle.dataset.toggle;
        if (folderId) {
          if (expandedFolders.has(folderId)) {
            expandedFolders.delete(folderId);
          } else {
            expandedFolders.add(folderId);
          }
          render();
        }
        return;
      }

      // Divider click — only expand/collapse, don't select
      const dividerItem = e.target.closest('.ws-divider-item');
      if (dividerItem) {
        const dividerId = dividerItem.dataset.divider;
        if (dividerId) {
          if (expandedFolders.has(dividerId)) {
            expandedFolders.delete(dividerId);
          } else {
            expandedFolders.add(dividerId);
          }
          render();
        }
        return;
      }

      // Select folder
      const item = e.target.closest('.ws-folder-item');
      if (!item) return;
      const folder = item.dataset.folder;
      activeFolder = folder || null;
      render();
    });

    // Drag-and-drop on sidebar
    sidebar.addEventListener('dragstart', onDragStart);
    sidebar.addEventListener('dragover', onDragOver);
    sidebar.addEventListener('drop', onDrop);
    sidebar.addEventListener('dragend', onDragEnd);
    sidebar.addEventListener('dragleave', onDragLeave);
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
      let folder = activeFolder;
      if (!folder) {
        // No folder selected — auto-select the first available folder
        const folders = getWorkspaceFolders();
        const firstFolder = folders.find(f => f.type === 'folder');
        if (firstFolder) {
          folder = firstFolder.id;
          activeFolder = folder;
          render();
        } else {
          showToast('Create a folder first', 'warning');
          return;
        }
      }
      openBlockEditor({ folder, onClose: () => render() });
    });
  }

  // New Folder button
  const newFolderBtn = $('#wsNewFolderBtn');
  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', () => createNewFolder());
  }
}

// ── Drag & Drop ─────────────────────────────────────────────────────

function onDragStart(e) {
  const row = e.target.closest('.ws-folder-row');
  if (!row) return;
  draggedFolderId = row.dataset.folderId;
  row.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedFolderId);
}

function onDragOver(e) {
  if (!draggedFolderId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  // Clear all drop indicators
  clearDropIndicators();

  const row = e.target.closest('.ws-folder-row');
  if (!row || row.dataset.folderId === draggedFolderId) return;

  // Prevent dropping into own descendants
  const folders = getWorkspaceFolders();
  const descendants = getDescendantIds(folders, draggedFolderId);
  if (descendants.has(row.dataset.folderId)) return;

  // Calculate drop zone: top 25% = before, bottom 25% = after, middle 50% = nest inside
  const rect = row.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const pct = y / rect.height;

  if (pct < 0.25) {
    row.classList.add('ws-folder-drop-before');
  } else if (pct > 0.75) {
    row.classList.add('ws-folder-drop-after');
  } else {
    row.classList.add('ws-folder-drop-inside');
  }
}

function onDragLeave(e) {
  const row = e.target.closest('.ws-folder-row');
  if (row) {
    row.classList.remove('ws-folder-drop-before', 'ws-folder-drop-after', 'ws-folder-drop-inside');
  }
}

function onDrop(e) {
  e.preventDefault();
  if (!draggedFolderId) return;

  const row = e.target.closest('.ws-folder-row');
  if (!row || row.dataset.folderId === draggedFolderId) {
    cleanupDrag();
    return;
  }

  const targetId = row.dataset.folderId;
  let folders = getWorkspaceFolders();

  // Prevent dropping into own descendants
  const descendants = getDescendantIds(folders, draggedFolderId);
  if (descendants.has(targetId)) {
    cleanupDrag();
    return;
  }

  const targetFolder = folders.find(f => f.id === targetId);
  if (!targetFolder) { cleanupDrag(); return; }

  // Calculate drop zone
  const rect = row.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const pct = y / rect.height;

  const draggedFolder = folders.find(f => f.id === draggedFolderId);
  if (!draggedFolder) { cleanupDrag(); return; }

  if (pct < 0.25) {
    // Drop BEFORE target: same parent, order just before target
    draggedFolder.parentId = targetFolder.parentId;
    reorderAtLevel(folders, draggedFolder, targetFolder.parentId, targetId, 'before');
  } else if (pct > 0.75) {
    // Drop AFTER target: same parent, order just after target
    draggedFolder.parentId = targetFolder.parentId;
    reorderAtLevel(folders, draggedFolder, targetFolder.parentId, targetId, 'after');
  } else {
    // Drop INSIDE target: nest as last child
    draggedFolder.parentId = targetId;
    const siblings = getChildren(folders, targetId).filter(f => f.id !== draggedFolderId);
    draggedFolder.order = siblings.length;
    // Auto-expand the target so the nested folder is visible
    expandedFolders.add(targetId);
  }

  saveFolders(folders);
  cleanupDrag();
  render();
}

function reorderAtLevel(folders, draggedFolder, parentId, targetId, position) {
  // Get siblings at this level (excluding the dragged one)
  const siblings = getChildren(folders, parentId).filter(f => f.id !== draggedFolder.id);
  const targetIndex = siblings.findIndex(f => f.id === targetId);
  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
  siblings.splice(insertIndex, 0, draggedFolder);
  // Reassign order for all siblings at this level
  siblings.forEach((f, i) => { f.order = i; });
}

function onDragEnd() {
  cleanupDrag();
}

function cleanupDrag() {
  draggedFolderId = null;
  clearDropIndicators();
  const dragging = document.querySelector('.ws-folder-row.is-dragging');
  if (dragging) dragging.classList.remove('is-dragging');
}

function clearDropIndicators() {
  $$('.ws-folder-drop-before, .ws-folder-drop-after, .ws-folder-drop-inside').forEach(el => {
    el.classList.remove('ws-folder-drop-before', 'ws-folder-drop-after', 'ws-folder-drop-inside');
  });
}

// ── Folder CRUD ─────────────────────────────────────────────────────

function deleteDoc(docId) {
  if (!confirm('Delete this note?')) return;
  let docs = getWorkspaceDocs();
  docs = docs.filter(d => d.id !== docId);
  saveWorkspaceDocs(docs);
  sbDeleteDoc(docId); // fire-and-forget Supabase delete
  showToast('Note deleted');
  render();
}

function deleteFolder(folderId) {
  const folders = getWorkspaceFolders();
  const folder = folders.find(f => f.id === folderId);
  if (!folder) return;

  const docs = getWorkspaceDocs();
  const docCount = countDocsDirect(folderId, docs);
  const childFolders = folders.filter(f => f.parentId === folderId);
  const parentName = folder.parentId
    ? (folders.find(f => f.id === folder.parentId)?.name || 'top-level')
    : 'top-level';

  const msg = docCount > 0
    ? `Delete "${folder.name}"? ${docCount} note${docCount > 1 ? 's' : ''} will move to ${parentName}.`
    : `Delete "${folder.name}"?`;

  if (!confirm(msg)) return;

  // Move child docs to parent folder (or first default)
  const newDocFolder = folder.parentId || folders[0]?.id || 'content';
  const updatedDocs = docs.map(d => {
    if (d.folder === folderId) return { ...d, folder: newDocFolder };
    return d;
  });
  saveWorkspaceDocs(updatedDocs);

  // Move child folders up to the deleted folder's parent
  const updatedFolders = folders
    .map(f => {
      if (f.parentId === folderId) return { ...f, parentId: folder.parentId };
      return f;
    })
    .filter(f => f.id !== folderId);

  // Re-order siblings at the parent level
  const siblings = getChildren(updatedFolders, folder.parentId);
  siblings.forEach((f, i) => { f.order = i; });

  saveFolders(updatedFolders);
  sbDeleteFolder(folderId); // fire-and-forget Supabase delete
  expandedFolders.delete(folderId);

  // If we deleted the active folder, go to All Notes
  if (activeFolder === folderId) activeFolder = null;

  showToast(`Folder "${folder.name}" deleted`);
  render();
}

function createNewFolder() {
  const isDivider = confirm('Create a section divider?\n\nOK = Section Divider (groups folders)\nCancel = Folder (holds notes)');
  const label = isDivider ? 'Divider' : 'Folder';
  const name = prompt(`${label} name:`);
  if (!name || !name.trim()) return;

  const folders = getWorkspaceFolders();
  const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  if (folders.some(f => f.id === id)) {
    showToast(`${label} already exists`, 'warning');
    return;
  }

  let parentId = null;
  if (isDivider) {
    // Dividers always go to top level
    parentId = null;
  } else {
    // Folders: if a divider is currently active/selected in sidebar, nest under it
    // Otherwise check if activeFolder is a divider
    if (activeFolder) {
      const activeF = folders.find(f => f.id === activeFolder);
      if (activeF && activeF.type === 'divider') {
        parentId = activeFolder;
      } else if (activeF) {
        // Active is a folder — nest under same parent
        parentId = activeF.parentId || null;
      }
    }
  }

  const siblings = getChildren(folders, parentId);
  const order = siblings.length;
  const type = isDivider ? 'divider' : 'folder';

  folders.push({ id, name: name.trim(), parentId, order, type });
  saveFolders(folders);

  // Auto-expand parent if nested
  if (parentId) expandedFolders.add(parentId);

  showToast(`${label} "${name.trim()}" created`);
  render();
}
