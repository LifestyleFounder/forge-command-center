// js/block-editor.js — Core Tiptap block editor module
// Manages the full-screen block editor modal with Notion sync

import { $, showToast, debounce } from './app.js';
import { getPageBlocks, updatePageBlocks, searchPages, getPage } from './services/notion-blocks.js';
import { notionBlocksToTiptap, tiptapToNotionBlocks } from './notion-converter.js';
import { createSlashCommandSuggestion } from './slash-commands.js';

// ── Module state ──────────────────────────────────────────
let editor = null;
let currentPageId = null;
let currentPageTitle = '';
let isModalOpen = false;
let isSaving = false;
let isDirty = false;
let loadedPages = [];
let tiptapModules = null; // cached imports

const PINNED_KEY = 'forge-pinned-notion-page';
const LOCAL_DRAFT_KEY = 'forge-block-editor-draft';
const AUTOSAVE_DELAY = 2000;

// ── Public API ────────────────────────────────────────────

/**
 * Initialize block editor — called once on boot
 */
export async function initBlockEditor() {
  bindModalEvents();
}

/**
 * Open the block editor modal
 * @param {Object} opts
 * @param {string} opts.pageId - Notion page ID to load
 * @param {string} opts.title - Page title
 * @param {string} opts.mode - 'modal' (default) or 'inline'
 */
export async function openBlockEditor(opts = {}) {
  const modal = $('#blockEditorModal');
  const backdrop = $('#blockEditorBackdrop');
  if (!modal || !backdrop) return;

  isModalOpen = true;
  modal.hidden = false;
  backdrop.hidden = false;
  document.body.classList.add('block-editor-open');

  // Load Tiptap if not yet loaded
  if (!tiptapModules) {
    setSyncStatus('loading', 'Loading editor...');
    tiptapModules = await loadTiptap();
    if (!tiptapModules) {
      setSyncStatus('error', 'Failed to load editor');
      return;
    }
  }

  // Create editor instance if needed
  if (!editor) {
    try {
      createEditorInstance();
    } catch (err) {
      console.error('[block-editor] Failed to create editor:', err);
      setSyncStatus('error', 'Editor failed to load');
      showToast('Editor initialization failed — check console', 'error');
      return;
    }
  }

  if (!editor) {
    setSyncStatus('error', 'Editor not available');
    return;
  }

  // Always load page list in sidebar
  refreshPageList();

  // Load page
  const pageId = opts.pageId || getPinnedPageId();
  if (pageId) {
    await loadPage(pageId, opts.title);
  } else {
    // No pinned page — show empty editor
    setEditorTitle('');
    editor.commands.setContent('<p>Select a page from the sidebar, or search for one.</p>');
    setSyncStatus('idle', 'No page selected');
  }

  // Focus editor
  setTimeout(() => editor?.commands.focus(), 100);
}

/**
 * Close the block editor modal
 */
export function closeBlockEditor() {
  const modal = $('#blockEditorModal');
  const backdrop = $('#blockEditorBackdrop');

  // Save before closing if dirty
  if (isDirty && currentPageId) {
    saveDraftToLocal();
  }

  if (modal) modal.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('block-editor-open');
  isModalOpen = false;
}

/**
 * Get the editor instance (for knowledge.js integration)
 */
export function getEditorInstance() {
  return editor;
}

/**
 * Check if modal is currently open
 */
export function isEditorModalOpen() {
  return isModalOpen;
}

// ── Tiptap Loading ────────────────────────────────────────

async function loadTiptap() {
  try {
    const [
      coreModule,
      starterKitModule,
      taskListModule,
      taskItemModule,
      placeholderModule,
      highlightModule,
      linkModule,
      colorModule,
      textStyleModule,
      underlineModule,
      textAlignModule,
    ] = await Promise.all([
      import('https://esm.sh/@tiptap/core@2.11.5'),
      import('https://esm.sh/@tiptap/starter-kit@2.11.5'),
      import('https://esm.sh/@tiptap/extension-task-list@2.11.5'),
      import('https://esm.sh/@tiptap/extension-task-item@2.11.5'),
      import('https://esm.sh/@tiptap/extension-placeholder@2.11.5'),
      import('https://esm.sh/@tiptap/extension-highlight@2.11.5'),
      import('https://esm.sh/@tiptap/extension-link@2.11.5'),
      import('https://esm.sh/@tiptap/extension-color@2.11.5'),
      import('https://esm.sh/@tiptap/extension-text-style@2.11.5'),
      import('https://esm.sh/@tiptap/extension-underline@2.11.5'),
      import('https://esm.sh/@tiptap/extension-text-align@2.11.5'),
    ]);

    // Use named exports with default fallback
    const Editor = coreModule.Editor;
    const Extension = coreModule.Extension;
    const StarterKit = starterKitModule.StarterKit || starterKitModule.default;
    const TaskList = taskListModule.TaskList || taskListModule.default;
    const TaskItem = taskItemModule.TaskItem || taskItemModule.default;
    const Placeholder = placeholderModule.Placeholder || placeholderModule.default;
    const Highlight = highlightModule.Highlight || highlightModule.default;
    const Link = linkModule.Link || linkModule.default;
    const TxtColor = colorModule.Color || colorModule.default;
    const TextStyle = textStyleModule.TextStyle || textStyleModule.default;
    const Underline = underlineModule.Underline || underlineModule.default;
    const TextAlign = textAlignModule.TextAlign || textAlignModule.default;

    // Verify critical modules loaded
    if (!Editor || !Extension || !StarterKit) {
      console.error('[block-editor] Missing critical Tiptap modules:', { Editor: !!Editor, Extension: !!Extension, StarterKit: !!StarterKit });
      throw new Error('Core Tiptap modules failed to load');
    }

    console.log('[block-editor] Tiptap loaded successfully');
    return {
      Editor, StarterKit, TaskList, TaskItem, Placeholder,
      Highlight, Link, TxtColor, TextStyle, Underline, TextAlign, Extension,
    };
  } catch (err) {
    console.error('[block-editor] Failed to load Tiptap:', err);
    showToast('Failed to load editor libraries', 'error');
    return null;
  }
}

// ── Editor Instance ───────────────────────────────────────

function createEditorInstance() {
  const {
    Editor, StarterKit, TaskList, TaskItem, Placeholder,
    Highlight, Link, TxtColor, TextStyle, Underline, TextAlign, Extension,
  } = tiptapModules;

  const mountEl = $('#blockEditorContent');
  if (!mountEl) return;

  // Create slash command extension
  const SlashCommands = createSlashExtension(Extension);

  editor = new Editor({
    element: mountEl,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: 'Type "/" for commands...',
      }),
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
      TextStyle,
      TxtColor,
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      SlashCommands,
    ],
    content: '<p></p>',
    autofocus: false,
    editorProps: {
      attributes: {
        class: 'block-editor-prose',
      },
    },
    onUpdate: () => {
      isDirty = true;
      setSyncStatus('editing', 'Editing...');
      debouncedSave();
    },
  });

  // Update toolbar active states on selection change
  editor.on('selectionUpdate', updateToolbarState);
  editor.on('transaction', updateToolbarState);
}

// ── Slash Command Extension ───────────────────────────────

function createSlashExtension(Extension) {
  return Extension.create({
    name: 'slashCommands',

    addKeyboardShortcuts() {
      return {
        '/': () => {
          // Show slash menu after the "/" character is inserted
          setTimeout(() => showSlashMenu(), 10);
          return false; // let the "/" character be typed
        },
      };
    },
  });
}

let slashMenuVisible = false;
let slashMenuQuery = '';
let slashMenuEl = null;

function showSlashMenu() {
  if (slashMenuVisible) return;
  if (!editor) return;

  const { from } = editor.state.selection;
  const coords = editor.view.coordsAtPos(from);

  slashMenuVisible = true;
  slashMenuQuery = '';

  const items = createSlashCommandSuggestion().items({ query: '' });

  slashMenuEl = document.createElement('div');
  slashMenuEl.className = 'slash-command-menu';
  let selectedIndex = 0;

  function render() {
    const filtered = createSlashCommandSuggestion().items({ query: slashMenuQuery });
    slashMenuEl.innerHTML = '';

    if (filtered.length === 0) {
      slashMenuEl.innerHTML = '<div class="slash-command-empty">No results</div>';
      return;
    }

    filtered.forEach((item, index) => {
      const btn = document.createElement('button');
      btn.className = 'slash-command-item' + (index === selectedIndex ? ' is-selected' : '');
      btn.type = 'button';
      btn.innerHTML = `
        <span class="slash-command-icon">${item.icon}</span>
        <span class="slash-command-label">
          <span class="slash-command-title">${item.title}</span>
          <span class="slash-command-desc">${item.description}</span>
        </span>
      `;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectItem(filtered, index);
      });
      btn.addEventListener('mouseenter', () => {
        selectedIndex = index;
        render();
      });
      slashMenuEl.appendChild(btn);
    });
  }

  function selectItem(filtered, index) {
    const item = filtered[index];
    if (!item) return;

    // Delete the "/" and any query text
    const { from: curFrom } = editor.state.selection;
    const textBefore = editor.state.doc.textBetween(Math.max(0, curFrom - slashMenuQuery.length - 1), curFrom);
    const slashPos = curFrom - slashMenuQuery.length - 1;

    editor.chain().focus().deleteRange({ from: Math.max(0, slashPos), to: curFrom }).run();
    item.command({ editor, range: { from: Math.max(0, slashPos), to: Math.max(0, slashPos) } });

    hideSlashMenu();
  }

  function handleKeydown(e) {
    const filtered = createSlashCommandSuggestion().items({ query: slashMenuQuery });

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % Math.max(filtered.length, 1);
      render();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + filtered.length) % Math.max(filtered.length, 1);
      render();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      selectItem(filtered, selectedIndex);
      return;
    }
    if (e.key === 'Escape' || e.key === ' ') {
      hideSlashMenu();
      return;
    }
    if (e.key === 'Backspace') {
      if (slashMenuQuery.length > 0) {
        slashMenuQuery = slashMenuQuery.slice(0, -1);
        selectedIndex = 0;
        render();
      } else {
        hideSlashMenu();
      }
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      slashMenuQuery += e.key;
      selectedIndex = 0;
      render();
    }
  }

  render();

  slashMenuEl.style.position = 'fixed';
  slashMenuEl.style.left = `${coords.left}px`;
  slashMenuEl.style.top = `${coords.bottom + 4}px`;
  slashMenuEl.style.zIndex = '10000';
  document.body.appendChild(slashMenuEl);

  // Listen for keypresses to filter
  document.addEventListener('keydown', handleKeydown, true);

  // Store cleanup ref
  slashMenuEl._cleanup = () => {
    document.removeEventListener('keydown', handleKeydown, true);
  };

  // Close on click outside
  setTimeout(() => {
    const closeOnClick = (e) => {
      if (!slashMenuEl?.contains(e.target)) {
        hideSlashMenu();
        document.removeEventListener('mousedown', closeOnClick);
      }
    };
    document.addEventListener('mousedown', closeOnClick);
    slashMenuEl._closeOnClick = closeOnClick;
  }, 50);
}

function hideSlashMenu() {
  if (slashMenuEl) {
    slashMenuEl._cleanup?.();
    if (slashMenuEl._closeOnClick) {
      document.removeEventListener('mousedown', slashMenuEl._closeOnClick);
    }
    slashMenuEl.remove();
    slashMenuEl = null;
  }
  slashMenuVisible = false;
  slashMenuQuery = '';
}

// ── Page Loading ──────────────────────────────────────────

async function loadPage(pageId, title) {
  if (!editor) {
    console.error('[block-editor] No editor instance — cannot load page');
    return;
  }

  currentPageId = pageId;
  currentPageTitle = title || '';
  isDirty = false;

  setSyncStatus('loading', 'Loading...');
  setEditorTitle(title || 'Loading...');

  // Check for local draft first
  const draft = getLocalDraft(pageId);

  // Fetch from Notion
  const blocks = await getPageBlocks(pageId);
  console.log('[block-editor] Loaded blocks:', blocks?.length, 'for page:', pageId);

  if (blocks && blocks.length > 0) {
    try {
      const tiptapDoc = notionBlocksToTiptap(blocks);
      console.log('[block-editor] Converted to Tiptap:', JSON.stringify(tiptapDoc).slice(0, 200));
      editor.commands.setContent(tiptapDoc);
    } catch (err) {
      console.error('[block-editor] Failed to convert/set content:', err);
      setSyncStatus('error', 'Content conversion failed');
      return;
    }
    setSyncStatus('saved', 'Synced with Notion');

    // Get page title if not provided
    if (!title) {
      const page = await getPage(pageId);
      if (page) {
        currentPageTitle = page.title;
        setEditorTitle(page.title);
      }
    }
  } else if (blocks && blocks.length === 0) {
    // Page exists but has no block content (empty page or database entry)
    editor.commands.setContent('<p><em>This page has no editable content. It may be a database entry or empty page.</em></p>');
    setSyncStatus('idle', 'Empty page');
    // Still get the title
    if (!title) {
      const page = await getPage(pageId);
      if (page) {
        currentPageTitle = page.title;
        setEditorTitle(page.title);
      }
    }
  } else if (draft) {
    // Fallback to local draft
    editor.commands.setContent(draft.content);
    setSyncStatus('offline', 'Working offline');
  } else {
    editor.commands.clearContent();
    setSyncStatus('error', 'Failed to load page');
  }

  // Highlight in sidebar
  highlightActivePage(pageId);
  updateToolbarState();
}

// ── Saving ────────────────────────────────────────────────

const debouncedSave = debounce(async () => {
  if (!isDirty || !currentPageId) return;

  // Always save to localStorage first (instant)
  saveDraftToLocal();

  // Then sync to Notion
  await saveToNotion();
}, AUTOSAVE_DELAY);

function saveDraftToLocal() {
  if (!currentPageId || !editor) return;
  const data = {
    pageId: currentPageId,
    title: currentPageTitle,
    content: editor.getJSON(),
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(`${LOCAL_DRAFT_KEY}-${currentPageId}`, JSON.stringify(data));
  } catch (e) {
    // localStorage full — silently fail
  }
}

function getLocalDraft(pageId) {
  try {
    const raw = localStorage.getItem(`${LOCAL_DRAFT_KEY}-${pageId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveToNotion() {
  if (!currentPageId || !editor || isSaving) return;

  isSaving = true;
  setSyncStatus('saving', 'Saving to Notion...');

  try {
    const doc = editor.getJSON();
    const blocks = tiptapToNotionBlocks(doc);
    const success = await updatePageBlocks(currentPageId, blocks);

    if (success) {
      isDirty = false;
      setSyncStatus('saved', 'Saved to Notion');
    } else {
      setSyncStatus('error', 'Save failed — draft kept locally');
    }
  } catch (err) {
    console.error('[block-editor] Save failed:', err);
    setSyncStatus('error', 'Save failed');
  } finally {
    isSaving = false;
  }
}

// ── Toolbar ───────────────────────────────────────────────

function updateToolbarState() {
  if (!editor) return;

  const buttons = {
    'be-bold': editor.isActive('bold'),
    'be-italic': editor.isActive('italic'),
    'be-underline': editor.isActive('underline'),
    'be-strike': editor.isActive('strike'),
    'be-code': editor.isActive('code'),
    'be-highlight': editor.isActive('highlight'),
    'be-link': editor.isActive('link'),
    'be-bullet': editor.isActive('bulletList'),
    'be-ordered': editor.isActive('orderedList'),
    'be-task': editor.isActive('taskList'),
    'be-quote': editor.isActive('blockquote'),
    'be-code-block': editor.isActive('codeBlock'),
    'be-h1': editor.isActive('heading', { level: 1 }),
    'be-h2': editor.isActive('heading', { level: 2 }),
    'be-h3': editor.isActive('heading', { level: 3 }),
  };

  for (const [id, active] of Object.entries(buttons)) {
    const btn = $(`#${id}`);
    if (btn) btn.classList.toggle('is-active', active);
  }
}

// ── Toolbar Commands ──────────────────────────────────────

export function execToolbarCommand(cmd) {
  if (!editor) return;

  const commands = {
    'bold': () => editor.chain().focus().toggleBold().run(),
    'italic': () => editor.chain().focus().toggleItalic().run(),
    'underline': () => editor.chain().focus().toggleUnderline().run(),
    'strike': () => editor.chain().focus().toggleStrike().run(),
    'code': () => editor.chain().focus().toggleCode().run(),
    'highlight': () => editor.chain().focus().toggleHighlight().run(),
    'link': () => {
      const url = prompt('Enter URL:');
      if (url) editor.chain().focus().setLink({ href: url }).run();
    },
    'bullet': () => editor.chain().focus().toggleBulletList().run(),
    'ordered': () => editor.chain().focus().toggleOrderedList().run(),
    'task': () => editor.chain().focus().toggleTaskList().run(),
    'quote': () => editor.chain().focus().toggleBlockquote().run(),
    'code-block': () => editor.chain().focus().toggleCodeBlock().run(),
    'h1': () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    'h2': () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    'h3': () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    'divider': () => editor.chain().focus().setHorizontalRule().run(),
    'align-left': () => editor.chain().focus().setTextAlign('left').run(),
    'align-center': () => editor.chain().focus().setTextAlign('center').run(),
    'align-right': () => editor.chain().focus().setTextAlign('right').run(),
  };

  const fn = commands[cmd];
  if (fn) fn();
}

// ── Page Browser ──────────────────────────────────────────

async function refreshPageList(query = '') {
  const listEl = $('#bePageList');
  if (!listEl) return;

  listEl.innerHTML = '<div class="be-page-loading">Loading pages...</div>';

  const pages = await searchPages(query);
  loadedPages = pages;

  renderPageList(pages);
}

function renderPageList(pages) {
  const listEl = $('#bePageList');
  if (!listEl) return;

  const pinnedId = getPinnedPageId();

  if (pages.length === 0) {
    listEl.innerHTML = '<div class="be-page-empty">No pages found</div>';
    return;
  }

  listEl.innerHTML = pages.map(p => `
    <button class="be-page-item ${p.id === currentPageId ? 'is-active' : ''} ${p.id === pinnedId ? 'is-pinned' : ''}"
            data-page-id="${p.id}" data-page-title="${escapeAttr(p.title)}">
      <span class="be-page-icon">${p.icon || '📄'}</span>
      <span class="be-page-title">${escapeHTML(p.title)}</span>
      ${p.id === pinnedId ? '<span class="be-page-pin" title="Pinned">📌</span>' : ''}
    </button>
  `).join('');
}

function highlightActivePage(pageId) {
  const items = document.querySelectorAll('.be-page-item');
  items.forEach(item => {
    item.classList.toggle('is-active', item.dataset.pageId === pageId);
  });
}

// ── Pinned Page ───────────────────────────────────────────

export function getPinnedPageId() {
  return localStorage.getItem(PINNED_KEY) || '';
}

export function setPinnedPageId(pageId) {
  localStorage.setItem(PINNED_KEY, pageId);
  renderPageList(loadedPages); // re-render to show pin indicator
  showToast('Page pinned as default', 'success');
}

// ── Sync Status ───────────────────────────────────────────

function setSyncStatus(state, text) {
  const el = $('#beSyncStatus');
  if (!el) return;
  el.className = `be-sync-status be-sync-${state}`;
  el.textContent = text;
}

// ── Editor Title ──────────────────────────────────────────

function setEditorTitle(title) {
  const el = $('#bePageTitle');
  if (el) el.value = title || '';
  currentPageTitle = title || '';
}

// ── Event Binding ─────────────────────────────────────────

function bindModalEvents() {
  // Close button
  const closeBtn = $('#blockEditorClose');
  if (closeBtn) closeBtn.addEventListener('click', closeBlockEditor);

  // Backdrop click to close
  const backdrop = $('#blockEditorBackdrop');
  if (backdrop) backdrop.addEventListener('click', closeBlockEditor);

  // Toolbar clicks
  const toolbar = $('#beToolbar');
  if (toolbar) {
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (btn) {
        e.preventDefault();
        execToolbarCommand(btn.dataset.cmd);
      }
    });
  }

  // Page list clicks
  const pageList = $('#bePageList');
  if (pageList) {
    pageList.addEventListener('click', (e) => {
      const item = e.target.closest('[data-page-id]');
      if (item) {
        loadPage(item.dataset.pageId, item.dataset.pageTitle);
      }
    });

    // Right-click to pin
    pageList.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('[data-page-id]');
      if (item) {
        e.preventDefault();
        setPinnedPageId(item.dataset.pageId);
      }
    });
  }

  // Search input
  const searchInput = $('#bePageSearch');
  if (searchInput) {
    const debouncedSearch = debounce((q) => refreshPageList(q), 400);
    searchInput.addEventListener('input', () => debouncedSearch(searchInput.value));
  }

  // Page title edit
  const titleInput = $('#bePageTitle');
  if (titleInput) {
    titleInput.addEventListener('input', () => {
      currentPageTitle = titleInput.value;
    });
  }

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isModalOpen) {
      closeBlockEditor();
    }
  });

  // New page button
  const newPageBtn = $('#beNewPage');
  if (newPageBtn) {
    newPageBtn.addEventListener('click', () => {
      currentPageId = null;
      currentPageTitle = '';
      setEditorTitle('');
      if (editor) editor.commands.clearContent();
      isDirty = false;
      setSyncStatus('idle', 'New document');
      highlightActivePage('');
    });
  }

  // Manual save button
  const saveBtn = $('#beSaveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (currentPageId) {
        saveDraftToLocal();
        await saveToNotion();
      } else {
        showToast('Open a Notion page first', 'info');
      }
    });
  }

  // Refresh pages button
  const refreshBtn = $('#beRefreshPages');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => refreshPageList());
  }
}

// ── Helpers ───────────────────────────────────────────────

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
