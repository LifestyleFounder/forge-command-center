// js/block-editor.js — Local-first Tiptap block editor
// No sidebar, no Notion page browser. Saves to localStorage, backs up to Notion.

import { $, showToast, debounce } from './app.js';
import { updatePageBlocks, createPage } from './services/notion-blocks.js';
import { tiptapToNotionBlocks } from './notion-converter.js';
import { createSlashCommandSuggestion } from './slash-commands.js';

// ── Workspace Storage (shared keys with knowledge.js) ─────
const DOCS_KEY = 'forge-workspace-docs';
const FOLDERS_KEY = 'forge-workspace-folders';
const DEFAULT_FOLDERS = [
  { id: 'content', name: 'Content' },
  { id: 'ideas', name: 'Ideas' },
  { id: 'business-planning', name: 'Business Planning' },
];

function getWorkspaceDocs() {
  try { const raw = localStorage.getItem(DOCS_KEY); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}

function saveWorkspaceDocs(docs) {
  try { localStorage.setItem(DOCS_KEY, JSON.stringify(docs)); }
  catch (e) { console.error('[block-editor] Failed to save docs:', e); }
}

function getWorkspaceFolders() {
  try { const raw = localStorage.getItem(FOLDERS_KEY); return raw ? JSON.parse(raw) : DEFAULT_FOLDERS; }
  catch { return DEFAULT_FOLDERS; }
}

// ── Module state ──────────────────────────────────────────
let editor = null;
let currentDocId = null;
let currentDocTitle = '';
let isModalOpen = false;
let isSaving = false;
let isDirty = false;
let tiptapModules = null;
let onCloseCallback = null;

const AUTOSAVE_DELAY = 2000;

// ── Public API ────────────────────────────────────────────

export async function initBlockEditor() {
  bindModalEvents();
}

/**
 * Open the block editor modal
 * @param {Object} opts
 * @param {string} opts.docId   - Existing doc ID to edit
 * @param {string} opts.folder  - Default folder for new docs
 * @param {Function} opts.onClose - Callback when editor closes
 */
export async function openBlockEditor(opts = {}) {
  const modal = $('#blockEditorModal');
  const backdrop = $('#blockEditorBackdrop');
  if (!modal || !backdrop) return;

  onCloseCallback = opts.onClose || null;
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
      showToast('Editor initialization failed', 'error');
      return;
    }
  }

  if (!editor) {
    setSyncStatus('error', 'Editor not available');
    return;
  }

  // Populate folder selector
  populateFolderSelector(opts.folder || null);

  // Load existing doc or start fresh
  if (opts.docId) {
    loadDoc(opts.docId);
  } else {
    // New note
    currentDocId = null;
    currentDocTitle = '';
    setEditorTitle('');
    editor.commands.clearContent();
    isDirty = false;
    setSyncStatus('idle', 'New note');

    // Set folder from opts
    const folderSelect = $('#beDocFolder');
    if (folderSelect && opts.folder) {
      folderSelect.value = opts.folder;
    }
  }

  setTimeout(() => editor?.commands.focus(), 100);
}

export function closeBlockEditor() {
  // Auto-save locally if dirty
  if (isDirty) {
    saveToLocal();
  }

  const modal = $('#blockEditorModal');
  const backdrop = $('#blockEditorBackdrop');
  if (modal) modal.hidden = true;
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('block-editor-open');
  isModalOpen = false;

  if (onCloseCallback) {
    onCloseCallback();
    onCloseCallback = null;
  }
}

export function getEditorInstance() {
  return editor;
}

export function isEditorModalOpen() {
  return isModalOpen;
}

// ── Tiptap Loading ────────────────────────────────────────

async function loadTiptap() {
  try {
    const [
      coreModule, starterKitModule, taskListModule, taskItemModule,
      placeholderModule, highlightModule, linkModule, colorModule,
      textStyleModule, underlineModule, textAlignModule, imageModule,
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
      import('https://esm.sh/@tiptap/extension-image@2.11.5'),
    ]);

    const Editor = coreModule.Editor;
    const Extension = coreModule.Extension;
    const Node = coreModule.Node;
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
    const Image = imageModule.Image || imageModule.default;

    if (!Editor || !Extension || !StarterKit) {
      throw new Error('Core Tiptap modules failed to load');
    }

    console.log('[block-editor] Tiptap loaded successfully');
    return {
      Editor, Node, StarterKit, TaskList, TaskItem, Placeholder,
      Highlight, Link, TxtColor, TextStyle, Underline, TextAlign, Image, Extension,
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
    Editor, Node, StarterKit, TaskList, TaskItem, Placeholder,
    Highlight, Link, TxtColor, TextStyle, Underline, TextAlign, Image, Extension,
  } = tiptapModules;

  const mountEl = $('#blockEditorContent');
  if (!mountEl) return;

  const SlashCommands = createSlashExtension(Extension);

  // Extend Image with resizable width attribute + drag-handle NodeView
  const ResizableImage = Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        width: {
          default: null,
          parseHTML: el => el.getAttribute('width') || el.style.width?.replace('px', '') || null,
          renderHTML: attrs => {
            if (!attrs.width) return {};
            const w = String(attrs.width).includes('%') ? attrs.width : attrs.width + 'px';
            return { width: attrs.width, style: `width: ${w}` };
          },
        },
      };
    },
    addNodeView() {
      return ({ node, editor: ed, getPos }) => {
        // Container
        const wrap = document.createElement('div');
        wrap.className = 'image-resizer';

        const img = document.createElement('img');
        img.src = node.attrs.src;
        if (node.attrs.alt) img.alt = node.attrs.alt;
        if (node.attrs.title) img.title = node.attrs.title;
        if (node.attrs.width) img.style.width = String(node.attrs.width).includes('%') ? node.attrs.width : node.attrs.width + 'px';

        // Right-edge drag handle
        const handle = document.createElement('div');
        handle.className = 'image-resize-handle';

        function startResize(startX) {
          const startWidth = img.offsetWidth;
          wrap.classList.add('is-resizing');

          function onMove(clientX) {
            const newWidth = Math.max(80, startWidth + (clientX - startX));
            img.style.width = newWidth + 'px';
          }
          function onEnd() {
            wrap.classList.remove('is-resizing');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
            // Persist width to node attrs
            if (typeof getPos === 'function') {
              ed.view.dispatch(
                ed.view.state.tr.setNodeMarkup(getPos(), undefined, {
                  ...node.attrs,
                  width: img.offsetWidth,
                })
              );
            }
          }
          function onMouseMove(e) { onMove(e.clientX); }
          function onMouseUp() { onEnd(); }
          function onTouchMove(e) { e.preventDefault(); onMove(e.touches[0].clientX); }
          function onTouchEnd() { onEnd(); }

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
          document.addEventListener('touchmove', onTouchMove, { passive: false });
          document.addEventListener('touchend', onTouchEnd);
        }

        handle.addEventListener('mousedown', (e) => { e.preventDefault(); startResize(e.clientX); });
        handle.addEventListener('touchstart', (e) => { e.preventDefault(); startResize(e.touches[0].clientX); }, { passive: false });

        wrap.appendChild(img);
        wrap.appendChild(handle);

        return {
          dom: wrap,
          update: (updatedNode) => {
            if (updatedNode.type.name !== 'image') return false;
            img.src = updatedNode.attrs.src;
            if (updatedNode.attrs.alt) img.alt = updatedNode.attrs.alt;
            if (updatedNode.attrs.width) {
              img.style.width = String(updatedNode.attrs.width).includes('%') ? updatedNode.attrs.width : updatedNode.attrs.width + 'px';
            } else {
              img.style.width = '';
            }
            // Keep node attrs in sync for future updates
            node = updatedNode;
            return true;
          },
        };
      };
    },
  }).configure({ inline: false, allowBase64: true });

  // Toggle block — collapsible section with editable title + body
  const ToggleBlock = Node.create({
    name: 'toggleBlock',
    group: 'block',
    content: 'block+',
    defining: true,

    addAttributes() {
      return {
        summary: { default: 'Toggle' },
        open: { default: true },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="toggle"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', { 'data-type': 'toggle', ...HTMLAttributes }, 0];
    },

    addCommands() {
      return {
        setToggleBlock: (attrs) => ({ commands }) => {
          return commands.insertContent({
            type: 'toggleBlock',
            attrs: { summary: attrs?.summary || 'Toggle', open: true },
            content: [{ type: 'paragraph' }],
          });
        },
      };
    },

    addNodeView() {
      return ({ node, editor: ed, getPos }) => {
        const dom = document.createElement('div');
        dom.className = 'toggle-block is-open';

        // Header row: arrow + editable title
        const header = document.createElement('div');
        header.className = 'toggle-header';

        const arrow = document.createElement('span');
        arrow.className = 'toggle-arrow';
        arrow.innerHTML = '&#9654;';

        const title = document.createElement('span');
        title.className = 'toggle-title';
        title.contentEditable = 'true';
        title.setAttribute('data-placeholder', 'Toggle title...');
        title.textContent = node.attrs.summary || '';

        const contentWrap = document.createElement('div');
        contentWrap.className = 'toggle-content';

        let isOpen = node.attrs.open !== false;

        function updateVisual() {
          dom.classList.toggle('is-open', isOpen);
          contentWrap.style.display = isOpen ? '' : 'none';
        }

        arrow.addEventListener('click', (e) => {
          e.preventDefault();
          isOpen = !isOpen;
          updateVisual();
          if (typeof getPos === 'function') {
            ed.view.dispatch(
              ed.view.state.tr.setNodeMarkup(getPos(), undefined, {
                ...node.attrs,
                open: isOpen,
              })
            );
          }
        });

        // Save title changes back to node attrs
        title.addEventListener('input', () => {
          if (typeof getPos === 'function') {
            ed.view.dispatch(
              ed.view.state.tr.setNodeMarkup(getPos(), undefined, {
                ...node.attrs,
                summary: title.textContent,
              })
            );
          }
        });

        // Enter in title → focus into content body
        title.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!isOpen) { isOpen = true; updateVisual(); }
            ed.commands.focus();
          }
        });

        header.appendChild(arrow);
        header.appendChild(title);
        dom.appendChild(header);
        dom.appendChild(contentWrap);

        updateVisual();

        return {
          dom,
          contentDOM: contentWrap,
          update: (updatedNode) => {
            if (updatedNode.type.name !== 'toggleBlock') return false;
            if (updatedNode.attrs.summary !== title.textContent) {
              title.textContent = updatedNode.attrs.summary;
            }
            isOpen = updatedNode.attrs.open !== false;
            updateVisual();
            node = updatedNode;
            return true;
          },
          stopEvent: (event) => {
            return title.contains(event.target);
          },
        };
      };
    },
  });

  editor = new Editor({
    element: mountEl,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Type "/" for commands...' }),
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
      ResizableImage,
      ToggleBlock,
      TextStyle, TxtColor, Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      SlashCommands,
    ],
    content: '<p></p>',
    autofocus: false,
    editorProps: {
      attributes: { class: 'block-editor-prose' },
      handleDrop(view, event) {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const file = files[0];
        if (!file.type.startsWith('image/')) return false;
        event.preventDefault();
        if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'warning'); return true; }
        const reader = new FileReader();
        reader.onload = () => {
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          const node = view.state.schema.nodes.image.create({ src: reader.result });
          const tr = view.state.tr.insert(pos?.pos ?? view.state.selection.from, node);
          view.dispatch(tr);
        };
        reader.readAsDataURL(file);
        return true;
      },
      handlePaste(view, event) {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) return true;
            if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'warning'); return true; }
            const reader = new FileReader();
            reader.onload = () => {
              editor.chain().focus().setImage({ src: reader.result }).run();
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: () => {
      isDirty = true;
      setSyncStatus('editing', 'Editing...');
      debouncedAutoSave();
    },
  });

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
          setTimeout(() => showSlashMenu(), 10);
          return false;
        },
      };
    },
  });
}

let slashMenuVisible = false;
let slashMenuQuery = '';
let slashMenuEl = null;

function showSlashMenu() {
  if (slashMenuVisible || !editor) return;

  const { from } = editor.state.selection;
  const coords = editor.view.coordsAtPos(from);

  slashMenuVisible = true;
  slashMenuQuery = '';

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
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); selectItem(filtered, index); });
      btn.addEventListener('mouseenter', () => { selectedIndex = index; render(); });
      slashMenuEl.appendChild(btn);
    });
  }

  function selectItem(filtered, index) {
    const item = filtered[index];
    if (!item) return;
    const { from: curFrom } = editor.state.selection;
    const slashPos = curFrom - slashMenuQuery.length - 1;
    editor.chain().focus().deleteRange({ from: Math.max(0, slashPos), to: curFrom }).run();
    item.command({ editor, range: { from: Math.max(0, slashPos), to: Math.max(0, slashPos) } });
    hideSlashMenu();
  }

  function handleKeydown(e) {
    const filtered = createSlashCommandSuggestion().items({ query: slashMenuQuery });
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = (selectedIndex + 1) % Math.max(filtered.length, 1); render(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = (selectedIndex - 1 + filtered.length) % Math.max(filtered.length, 1); render(); return; }
    if (e.key === 'Enter') { e.preventDefault(); selectItem(filtered, selectedIndex); return; }
    if (e.key === 'Escape' || e.key === ' ') { hideSlashMenu(); return; }
    if (e.key === 'Backspace') {
      if (slashMenuQuery.length > 0) { slashMenuQuery = slashMenuQuery.slice(0, -1); selectedIndex = 0; render(); }
      else { hideSlashMenu(); }
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { slashMenuQuery += e.key; selectedIndex = 0; render(); }
  }

  render();
  slashMenuEl.style.position = 'fixed';
  slashMenuEl.style.left = `${coords.left}px`;
  slashMenuEl.style.top = `${coords.bottom + 4}px`;
  slashMenuEl.style.zIndex = '10000';
  document.body.appendChild(slashMenuEl);

  document.addEventListener('keydown', handleKeydown, true);
  slashMenuEl._cleanup = () => { document.removeEventListener('keydown', handleKeydown, true); };

  setTimeout(() => {
    const closeOnClick = (e) => {
      if (!slashMenuEl?.contains(e.target)) { hideSlashMenu(); document.removeEventListener('mousedown', closeOnClick); }
    };
    document.addEventListener('mousedown', closeOnClick);
    slashMenuEl._closeOnClick = closeOnClick;
  }, 50);
}

function hideSlashMenu() {
  if (slashMenuEl) {
    slashMenuEl._cleanup?.();
    if (slashMenuEl._closeOnClick) document.removeEventListener('mousedown', slashMenuEl._closeOnClick);
    slashMenuEl.remove();
    slashMenuEl = null;
  }
  slashMenuVisible = false;
  slashMenuQuery = '';
}

// ── Doc Loading (from localStorage) ──────────────────────

function loadDoc(docId) {
  if (!editor) return;

  const docs = getWorkspaceDocs();
  const doc = docs.find(d => d.id === docId);

  if (!doc) {
    showToast('Document not found', 'error');
    return;
  }

  currentDocId = doc.id;
  currentDocTitle = doc.title || '';
  isDirty = false;

  setEditorTitle(doc.title || '');

  if (doc.content && typeof doc.content === 'object') {
    editor.commands.setContent(doc.content);
  } else if (doc.content && typeof doc.content === 'string') {
    editor.commands.setContent(doc.content);
  } else {
    editor.commands.clearContent();
  }

  // Set folder in dropdown
  const folderSelect = $('#beDocFolder');
  if (folderSelect && doc.folder) {
    folderSelect.value = doc.folder;
  }

  setSyncStatus('saved', 'Loaded');
  updateToolbarState();
}

// ── Saving ────────────────────────────────────────────────

const debouncedAutoSave = debounce(() => {
  if (!isDirty) return;
  saveToLocal();
}, AUTOSAVE_DELAY);

function saveToLocal() {
  if (!editor) return;

  const titleInput = $('#bePageTitle');
  const title = titleInput?.value?.trim() || 'Untitled';
  const folderSelect = $('#beDocFolder');
  const folder = folderSelect?.value || 'content';
  const content = editor.getJSON();
  const now = new Date().toISOString();

  let docs = getWorkspaceDocs();

  if (currentDocId) {
    // Update existing
    docs = docs.map(d => {
      if (d.id === currentDocId) {
        return { ...d, title, folder, content, updatedAt: now };
      }
      return d;
    });
  } else {
    // Create new
    const newDoc = {
      id: generateId('doc'),
      title,
      folder,
      content,
      notionPageId: null,
      createdAt: now,
      updatedAt: now,
    };
    currentDocId = newDoc.id;
    docs.push(newDoc);
  }

  saveWorkspaceDocs(docs);
  currentDocTitle = title;
  isDirty = false;
  setSyncStatus('saved', 'Saved locally');
}

async function triggerNotionBackup() {
  if (!editor || !currentDocId) return;

  const docs = getWorkspaceDocs();
  const doc = docs.find(d => d.id === currentDocId);
  if (!doc) return;

  setSyncStatus('saving', 'Backing up to Notion...');

  try {
    const tiptapDoc = editor.getJSON();
    const blocks = tiptapToNotionBlocks(tiptapDoc);

    if (doc.notionPageId) {
      // Update existing Notion page
      const success = await updatePageBlocks(doc.notionPageId, blocks);
      if (success) {
        setSyncStatus('saved', 'Backed up to Notion');
        showToast('Backed up to Notion', 'success');
      } else {
        setSyncStatus('error', 'Notion backup failed');
        showToast('Notion backup failed — saved locally', 'warning');
      }
    } else {
      // Create new Notion page
      const result = await createPage(doc.title || 'Untitled', blocks);
      if (result && result.pageId) {
        // Store Notion page ID
        const updatedDocs = getWorkspaceDocs().map(d => {
          if (d.id === currentDocId) {
            return { ...d, notionPageId: result.pageId };
          }
          return d;
        });
        saveWorkspaceDocs(updatedDocs);
        setSyncStatus('saved', 'Backed up to Notion');
        showToast('Backed up to Notion', 'success');
      } else {
        setSyncStatus('error', 'Notion backup failed');
        showToast('Notion backup failed — saved locally', 'warning');
      }
    }
  } catch (err) {
    console.error('[block-editor] Notion backup failed:', err);
    setSyncStatus('error', 'Notion backup failed');
    showToast('Notion backup failed', 'error');
  }
}

// ── Folder Selector ───────────────────────────────────────

function populateFolderSelector(defaultFolder) {
  const select = $('#beDocFolder');
  if (!select) return;

  const folders = getWorkspaceFolders();
  select.innerHTML = buildFolderOptions(folders, null, 0);

  if (defaultFolder) {
    select.value = defaultFolder;
  }
}

function buildFolderOptions(folders, parentId, depth) {
  const children = folders
    .filter(f => (f.parentId || null) === parentId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return children.map(f => {
    // Skip dividers — notes can only live in folders
    if (f.type === 'divider') {
      // But still recurse into children (folders under this divider)
      return buildFolderOptions(folders, f.id, depth);
    }
    const indent = '\u00A0\u00A0'.repeat(depth);
    const option = `<option value="${escapeHtml(f.id)}">${indent}${escapeHtml(f.name)}</option>`;
    return option + buildFolderOptions(folders, f.id, depth + 1);
  }).join('');
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
    'image': () => insertImage(),
    'toggle': () => editor.chain().focus().setToggleBlock().run(),
    'align-left': () => editor.chain().focus().setTextAlign('left').run(),
    'align-center': () => editor.chain().focus().setTextAlign('center').run(),
    'align-right': () => editor.chain().focus().setTextAlign('right').run(),
  };

  const fn = commands[cmd];
  if (fn) fn();
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
  currentDocTitle = title || '';
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

  // Page title edit
  const titleInput = $('#bePageTitle');
  if (titleInput) {
    titleInput.addEventListener('input', () => {
      currentDocTitle = titleInput.value;
      isDirty = true;
      debouncedAutoSave();
    });
  }

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isModalOpen) {
      closeBlockEditor();
    }
  });

  // Save button — saves locally + triggers Notion backup
  const saveBtn = $('#beSaveBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveToLocal();
      await triggerNotionBackup();
    });
  }
}

// ── Image Insert ──────────────────────────────────────────

function insertImage() {
  if (!editor) return;

  // Create a hidden file input to pick an image
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;

    // Validate size (max 5MB for localStorage)
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image must be under 5MB', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      editor.chain().focus().setImage({ src: reader.result }).run();
      isDirty = true;
      debouncedAutoSave();
    };
    reader.readAsDataURL(file);
  });

  document.body.appendChild(input);
  input.click();
  input.remove();
}

// ── Helpers ───────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function generateId(prefix = 'doc') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
