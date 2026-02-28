// js/slash-commands.js — Slash command suggestion extension for Tiptap
// Creates a "/" menu for inserting block types

const SLASH_ITEMS = [
  { title: 'Text', description: 'Plain paragraph', icon: '¶', command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setNode('paragraph').run();
  }},
  { title: 'Heading 1', description: 'Large heading', icon: 'H1', command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
  }},
  { title: 'Heading 2', description: 'Medium heading', icon: 'H2', command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
  }},
  { title: 'Heading 3', description: 'Small heading', icon: 'H3', command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
  }},
  { title: 'Bullet List', description: 'Unordered list', icon: '•', command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).toggleBulletList().run();
  }},
  { title: 'Numbered List', description: 'Ordered list', icon: '1.', command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).toggleOrderedList().run();
  }},
  { title: 'To-do List', description: 'Task checklist', icon: '☑', command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).toggleTaskList().run();
  }},
  { title: 'Quote', description: 'Block quote', icon: '"', command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setBlockquote().run();
  }},
  { title: 'Code', description: 'Code block', icon: '<>', command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setCodeBlock().run();
  }},
  { title: 'Divider', description: 'Horizontal rule', icon: '—', command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setHorizontalRule().run();
  }},
];

/**
 * Create the slash command Suggestion configuration for Tiptap's Mention/Suggestion
 * This returns the config object to pass to a custom extension
 */
export function createSlashCommandSuggestion() {
  return {
    items: ({ query }) => {
      return SLASH_ITEMS.filter(item =>
        item.title.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10);
    },

    render: () => {
      let popup = null;
      let selectedIndex = 0;
      let items = [];
      let commandFn = null;

      return {
        onStart: (props) => {
          items = props.items;
          commandFn = props.command;
          selectedIndex = 0;
          popup = createPopupElement(items, selectedIndex, (index) => {
            commandFn(items[index]);
          });
          updatePosition(popup, props.clientRect);
          document.body.appendChild(popup);
        },

        onUpdate: (props) => {
          items = props.items;
          commandFn = props.command;
          selectedIndex = 0;
          if (popup) {
            popup.remove();
          }
          popup = createPopupElement(items, selectedIndex, (index) => {
            commandFn(items[index]);
          });
          updatePosition(popup, props.clientRect);
          document.body.appendChild(popup);
        },

        onKeyDown: ({ event }) => {
          if (!popup || items.length === 0) return false;

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            updateSelected(popup, selectedIndex);
            return true;
          }

          if (event.key === 'ArrowDown') {
            event.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            updateSelected(popup, selectedIndex);
            return true;
          }

          if (event.key === 'Enter') {
            event.preventDefault();
            commandFn(items[selectedIndex]);
            return true;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            if (popup) { popup.remove(); popup = null; }
            return true;
          }

          return false;
        },

        onExit: () => {
          if (popup) { popup.remove(); popup = null; }
        },
      };
    },
  };
}

function createPopupElement(items, selectedIndex, onSelect) {
  const el = document.createElement('div');
  el.className = 'slash-command-menu';

  if (items.length === 0) {
    el.innerHTML = '<div class="slash-command-empty">No results</div>';
    return el;
  }

  items.forEach((item, index) => {
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
      onSelect(index);
    });
    btn.addEventListener('mouseenter', () => {
      updateSelected(el, index);
    });
    el.appendChild(btn);
  });

  return el;
}

function updateSelected(popup, index) {
  if (!popup) return;
  const items = popup.querySelectorAll('.slash-command-item');
  items.forEach((item, i) => {
    item.classList.toggle('is-selected', i === index);
    if (i === index) item.scrollIntoView({ block: 'nearest' });
  });
}

function updatePosition(popup, clientRect) {
  if (!clientRect) return;
  const rect = typeof clientRect === 'function' ? clientRect() : clientRect;
  if (!rect) return;

  popup.style.position = 'fixed';
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 4}px`;
  popup.style.zIndex = '9999';
}

export { SLASH_ITEMS };
