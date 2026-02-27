/* ============================================================
   app.js — Forge Command Center core framework + entry point
   ES Module · No globals · All exports at bottom
   ============================================================ */

import { initHome } from './home.js';
import { initProjects } from './projects.js';
import { initContent } from './content.js';
import { initKnowledge, onKnowledgeTabVisit } from './knowledge.js';
import { initChat } from './chat.js';
import { initVipClients } from './vip-clients.js';
import { initCompetitors, loadCompetitorData } from './competitors.js';
import { initGoogleTasks, loadGoogleTaskData } from './google-tasks.js';
import { initReports, loadReportData } from './reports.js';
import { initIframes, loadIframe } from './iframes.js';

// ---- State Management ----------------------------------------

const state = {
  business: null,
  tasks: null,
  activities: null,
  content: null,
  agents: null,
  status: null,
  youtube: null,
  instagram: null,
  metaAds: null,
  adSwipes: null,
  documents: null,
  notes: null,
  vipClients: null,
  schedules: null,
  ui: {
    activeTab: 'home',
    theme: localStorage.getItem('forge-theme') || 'light',
    searchOpen: false,
    activeModal: null
  }
};

const listeners = [];

function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i > -1) listeners.splice(i, 1);
  };
}

function setState(key, value) {
  state[key] = value;
  listeners.forEach(fn => {
    try { fn(key, value); }
    catch (err) { console.error('[forge] subscriber error', err); }
  });
}

function getState(key) {
  if (key) return state[key];
  return state;
}

// ---- Data Loading --------------------------------------------

const DATA_PATH = 'data';

async function loadJSON(filename) {
  const url = `${DATA_PATH}/${filename}?t=${Date.now()}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    localStorage.setItem(`forge-${filename}`, JSON.stringify(data));
    return data;
  } catch (e) {
    console.warn(`[forge] Failed to load ${filename}, using cache`, e);
    const cached = localStorage.getItem(`forge-${filename}`);
    if (cached) {
      try { return JSON.parse(cached); } catch { return null; }
    }
    return null;
  }
}

function saveLocal(key, data) {
  localStorage.setItem(`forge-${key}`, JSON.stringify(data));
}

// ---- Utility Functions ---------------------------------------

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function formatNumber(n) {
  if (n == null) return '--';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatCurrency(n) {
  if (n == null) return '--';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return '--';
  const now = new Date();
  const then = new Date(dateStr);
  if (isNaN(then.getTime())) return '--';
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatDate(dateStr);
}

function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = dateStr2 ? new Date(dateStr2) : new Date();
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return null;
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function $(sel, ctx) {
  return (ctx || document).querySelector(sel);
}

function $$(sel, ctx) {
  return [...(ctx || document).querySelectorAll(sel)];
}

// ---- DOM Cache -----------------------------------------------

let elCache = {};

function cacheElements() {
  elCache = {
    // Status bar
    statusIndicator: $('#statusIndicator'),
    statusDot: $('.status-dot'),
    statusLabel: $('.status-label'),
    currentTask: $('#currentTask'),
    lastHeartbeat: $('#lastHeartbeat span:last-child'),
    modelInfo: $('#modelInfo span:last-child'),
    // Search
    searchTrigger: $('#searchTrigger'),
    searchOverlay: $('#searchOverlay'),
    globalSearchInput: $('#globalSearchInput'),
    searchResults: $('#searchResults'),
    // Theme
    themeToggle: $('#themeToggle'),
    iconSun: $('.icon-sun'),
    iconMoon: $('.icon-moon'),
    // Sidebar
    sidebar: $('#sidebar'),
    navItems: $$('.nav-item[data-tab]'),
    // Mobile
    mobileHeader: $('#mobileHeader'),
    mobileMenuBtn: $('#mobileMenuBtn'),
    mobileTitle: $('#mobileTitle'),
    mobileSearchBtn: $('#mobileSearchBtn'),
    // Tabs
    tabPanels: $$('.tab-panel'),
    // Modals
    modalBackdrop: $('#modalBackdrop'),
    modals: $$('.modal'),
    // Toast
    toastContainer: $('#toastContainer'),
  };
}

// ---- Router (Tab Navigation) ---------------------------------

const TAB_LABELS = {
  home: 'Home',
  projects: 'Projects',
  content: 'Content',
  knowledge: 'Knowledge',
  chat: 'Chat',
  'vip-clients': 'VIP Clients',
  competitors: 'Competitors',
  'google-tasks': 'Google Tasks',
  reports: 'Reports',
  calendar: 'Calendar',
  'performance-tracker': 'Performance',
  'content-multiplier': 'Multiplier',
};

const TAB_SHORTCUTS = {
  '1': 'home', '2': 'projects', '3': 'content', '4': 'knowledge', '5': 'chat',
  '6': 'vip-clients', '7': 'competitors', '8': 'google-tasks', '9': 'reports', '0': 'calendar',
};

// Lazy-load handlers for tabs that fetch data on first visit
const tabLoaded = new Set();
function onTabFirstVisit(tabName) {
  if (tabLoaded.has(tabName)) return;
  tabLoaded.add(tabName);
  switch (tabName) {
    case 'competitors': loadCompetitorData(); break;
    case 'google-tasks': loadGoogleTaskData(); break;
    case 'reports': loadReportData(); break;
    case 'calendar': loadIframe('google-calendar'); break;
    case 'performance-tracker': loadIframe('performance-tracker'); break;
    case 'content-multiplier': loadIframe('content-multiplier'); break;
  }
}

function switchTab(tabName) {
  if (!TAB_LABELS[tabName]) return;

  // Update panels
  elCache.tabPanels.forEach(panel => {
    const isTarget = panel.id === `tab-${tabName}`;
    panel.hidden = !isTarget;
    panel.classList.toggle('is-active', isTarget);
  });

  // Update nav items
  elCache.navItems.forEach(btn => {
    const isTarget = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', isTarget);
    btn.setAttribute('aria-selected', String(isTarget));
  });

  // Update mobile title
  if (elCache.mobileTitle) {
    elCache.mobileTitle.textContent = TAB_LABELS[tabName];
  }

  // Update document title
  document.title = `${TAB_LABELS[tabName]} — Forge`;

  // Store in state
  state.ui.activeTab = tabName;

  // Lazy-load data for tabs that need it
  onTabFirstVisit(tabName);

  // Knowledge tab auto-sync check (every visit, not just first)
  if (tabName === 'knowledge') onKnowledgeTabVisit();

  // Close mobile sidebar if open
  if (elCache.sidebar) {
    elCache.sidebar.classList.remove('is-open');
  }
}

function initRouter() {
  // Main tab navigation via event delegation on nav list
  const navList = $('.nav-list');
  if (navList) {
    navList.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item[data-tab]');
      if (!btn) return;
      e.preventDefault();
      switchTab(btn.dataset.tab);
    });
  }

  // Sub-tab navigation via event delegation on main content
  const mainContent = $('#mainContent');
  if (mainContent) {
    mainContent.addEventListener('click', (e) => {
      const btn = e.target.closest('.subtab[data-subtab]');
      if (!btn) return;
      e.preventDefault();
      const tabGroup = btn.closest('.subtabs');
      if (!tabGroup) return;
      switchSubtab(tabGroup, btn.dataset.subtab);
    });
  }

  // Mobile menu toggle
  if (elCache.mobileMenuBtn) {
    elCache.mobileMenuBtn.addEventListener('click', () => {
      if (elCache.sidebar) {
        elCache.sidebar.classList.toggle('is-open');
      }
    });
  }
}

function switchSubtab(tabGroup, subtabName) {
  // Update subtab buttons in the same group
  const buttons = $$('.subtab', tabGroup);
  buttons.forEach(btn => {
    const isTarget = btn.dataset.subtab === subtabName;
    btn.classList.toggle('is-active', isTarget);
    btn.setAttribute('aria-selected', String(isTarget));
  });

  // Find the parent section and update panels
  // The subtab panels are siblings (or nearby) of the subtab group
  const parentSection = tabGroup.closest('.tab-panel') || tabGroup.parentElement;
  const panels = $$('.subtab-panel', parentSection);

  panels.forEach(panel => {
    // Match by ID — panels that belong to this tab group
    // Only toggle panels whose IDs match one of the buttons in this group
    const buttonIds = buttons.map(b => b.dataset.subtab);
    if (buttonIds.includes(panel.id)) {
      const isTarget = panel.id === subtabName;
      panel.hidden = !isTarget;
      panel.classList.toggle('is-active', isTarget);
    }
  });
}

// ---- Theme Toggle --------------------------------------------

function initTheme() {
  const saved = state.ui.theme;
  applyTheme(saved);
  if (elCache.themeToggle) {
    elCache.themeToggle.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.ui.theme = theme;
  localStorage.setItem('forge-theme', theme);

  // Toggle icon visibility
  const sun = $('.icon-sun');
  const moon = $('.icon-moon');
  if (sun && moon) {
    sun.style.display = theme === 'dark' ? 'none' : 'block';
    moon.style.display = theme === 'dark' ? 'block' : 'none';
  }
}

// ---- Search (Cmd+K) -----------------------------------------

let searchUnsubscribe = null;

function initSearch() {
  const overlay = elCache.searchOverlay;
  const input = elCache.globalSearchInput;
  const results = elCache.searchResults;
  if (!overlay || !input || !results) return;

  // Open triggers
  if (elCache.searchTrigger) {
    elCache.searchTrigger.addEventListener('click', () => openSearch());
  }
  if (elCache.mobileSearchBtn) {
    elCache.mobileSearchBtn.addEventListener('click', () => openSearch());
  }

  // Close on overlay click (outside search container)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSearch();
  });

  // Search as user types
  const debouncedSearch = debounce((query) => {
    performSearch(query, results);
  }, 200);

  input.addEventListener('input', () => {
    debouncedSearch(input.value.trim());
  });

  // Navigate results with keyboard
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearch();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      navigateSearchResults(results, e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter') {
      const active = $('.search-result-item.is-active', results);
      if (active) {
        e.preventDefault();
        active.click();
      }
    }
  });

  // Click on results
  results.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (!item) return;
    const tab = item.dataset.tab;
    if (tab) switchTab(tab);
    closeSearch();
  });
}

function openSearch() {
  const overlay = elCache.searchOverlay;
  const input = elCache.globalSearchInput;
  if (!overlay) return;
  overlay.hidden = false;
  state.ui.searchOpen = true;
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 50);
  }
  if (elCache.searchResults) {
    elCache.searchResults.innerHTML = renderSearchHint();
  }
}

function closeSearch() {
  const overlay = elCache.searchOverlay;
  if (!overlay) return;
  overlay.hidden = true;
  state.ui.searchOpen = false;
}

function renderSearchHint() {
  return '<div class="search-hint">Type to search tasks, notes, documents, and clients...</div>';
}

function performSearch(query, container) {
  if (!query || query.length < 2) {
    container.innerHTML = renderSearchHint();
    return;
  }

  const lowerQ = query.toLowerCase();
  const results = [];

  // Search tasks
  const tasks = state.tasks?.tasks || [];
  tasks.forEach(task => {
    if (matchesQuery(task.title, lowerQ) || matchesQuery(task.description, lowerQ)) {
      results.push({
        type: 'task',
        icon: priorityIcon(task.priority),
        title: task.title,
        subtitle: `${task.status} ${task.due ? '· Due ' + formatDate(task.due) : ''}`,
        tab: 'projects',
        id: task.id
      });
    }
  });

  // Search documents (handles both flat array and raw {documents, notionDocs} formats)
  const rawDocs = state.documents;
  const allDocs = Array.isArray(rawDocs)
    ? rawDocs
    : [...(rawDocs?.documents || []), ...(rawDocs?.notionDocs || [])];
  allDocs.forEach(doc => {
    if (matchesQuery(doc.name, lowerQ) || matchesQuery(doc.content, lowerQ)) {
      results.push({
        type: doc.type === 'notion' ? 'notion' : 'document',
        icon: doc.type === 'notion' ? 'notion' : 'doc',
        title: doc.name,
        subtitle: doc.category || (doc.type === 'notion' ? 'Notion' : 'Document'),
        tab: 'knowledge',
        id: doc.id
      });
    }
  });

  // Search notes (handles both flat array and raw {notes} format)
  const rawNotes = state.notes;
  const allNotes = Array.isArray(rawNotes) ? rawNotes : (rawNotes?.notes || []);
  allNotes.forEach(note => {
    if (matchesQuery(note.title, lowerQ) || matchesQuery(note.content, lowerQ)) {
      results.push({
        type: 'note',
        icon: 'note',
        title: note.title,
        subtitle: note.folder || 'Note',
        tab: 'knowledge',
        id: note.id
      });
    }
  });

  // Search clients
  const biz = state.business;
  if (biz && biz.clients) {
    ['healthy', 'warning', 'atRisk'].forEach(cat => {
      (biz.clients[cat] || []).forEach(client => {
        if (matchesQuery(client.name, lowerQ) || matchesQuery(client.note, lowerQ)) {
          results.push({
            type: 'client',
            icon: 'client',
            title: client.name,
            subtitle: `${client.type} · ${cat}`,
            tab: 'home',
            id: client.name
          });
        }
      });
    });
  }

  if (results.length === 0) {
    container.innerHTML = '<div class="search-hint">No results found</div>';
    return;
  }

  container.innerHTML = results.slice(0, 20).map((r, i) => `
    <div class="search-result-item ${i === 0 ? 'is-active' : ''}" data-tab="${escapeHtml(r.tab)}" data-id="${escapeHtml(r.id)}">
      <span class="search-result-icon">${searchIcon(r.icon)}</span>
      <div class="search-result-text">
        <span class="search-result-title">${highlightMatch(r.title, query)}</span>
        <span class="search-result-subtitle">${escapeHtml(r.subtitle)}</span>
      </div>
      <span class="search-result-type">${escapeHtml(r.type)}</span>
    </div>
  `).join('');
}

function matchesQuery(text, lowerQ) {
  if (!text) return false;
  return String(text).toLowerCase().includes(lowerQ);
}

function highlightMatch(text, query) {
  if (!text || !query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

function searchIcon(type) {
  const icons = {
    doc: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    notion: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
    note: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    client: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  };
  return icons[type] || '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/></svg>';
}

function priorityIcon(priority) {
  return priority || 'medium';
}

function navigateSearchResults(container, direction) {
  const items = $$('.search-result-item', container);
  if (!items.length) return;
  const activeIdx = items.findIndex(el => el.classList.contains('is-active'));
  items.forEach(el => el.classList.remove('is-active'));
  let nextIdx = activeIdx + direction;
  if (nextIdx < 0) nextIdx = items.length - 1;
  if (nextIdx >= items.length) nextIdx = 0;
  items[nextIdx].classList.add('is-active');
  items[nextIdx].scrollIntoView({ block: 'nearest' });
}

// ---- Modal System --------------------------------------------

function initModalSystem() {
  const backdrop = elCache.modalBackdrop;

  // Close on backdrop click
  if (backdrop) {
    backdrop.addEventListener('click', closeModal);
  }

  // Close on [data-close-modal] buttons — delegate from body
  document.body.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-modal]')) {
      e.preventDefault();
      closeModal();
    }
  });
}

function openModal(id) {
  const modal = document.getElementById(id);
  const backdrop = elCache.modalBackdrop;
  if (!modal || !backdrop) return;
  backdrop.hidden = false;
  modal.hidden = false;
  state.ui.activeModal = id;
  // Focus first input
  const firstInput = $('input, textarea, select', modal);
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function closeModal() {
  const backdrop = elCache.modalBackdrop;
  elCache.modals.forEach(m => { m.hidden = true; });
  if (backdrop) backdrop.hidden = true;
  state.ui.activeModal = null;
}

// ---- Toast System --------------------------------------------

function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 3000;
  const container = elCache.toastContainer;
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${escapeHtml(type)}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ---- Keyboard Shortcuts --------------------------------------

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Cmd+K / Ctrl+K: open search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (state.ui.searchOpen) {
        closeSearch();
      } else {
        openSearch();
      }
      return;
    }

    // Escape: close search / modal
    if (e.key === 'Escape') {
      if (state.ui.searchOpen) {
        closeSearch();
        return;
      }
      if (state.ui.activeModal) {
        closeModal();
        return;
      }
    }

    // Don't intercept shortcuts when user is typing in an input
    const active = document.activeElement;
    const isTyping = active && (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.tagName === 'SELECT' ||
      active.isContentEditable
    );
    if (isTyping) return;

    // Number keys 1-5: switch tabs
    if (TAB_SHORTCUTS[e.key]) {
      e.preventDefault();
      switchTab(TAB_SHORTCUTS[e.key]);
      return;
    }

    // N: new task (when on projects tab)
    if (e.key === 'n' || e.key === 'N') {
      if (state.ui.activeTab === 'projects') {
        e.preventDefault();
        openModal('taskModal');
      }
    }
  });
}

// ---- Status Bar Update ----------------------------------------

function updateStatusBar() {
  const s = state.status;
  if (!s) return;

  // Status dot + label
  const dot = elCache.statusDot;
  const label = elCache.statusLabel;
  if (dot && label) {
    const statusMap = {
      'working': 'active',
      'idle': 'idle',
      'sleeping': 'idle',
      'error': 'error'
    };
    dot.setAttribute('data-status', statusMap[s.status] || 'idle');
    label.textContent = s.status ? s.status.charAt(0).toUpperCase() + s.status.slice(1) : 'Idle';
  }

  // Current task
  if (elCache.currentTask) {
    elCache.currentTask.textContent = s.currentTask || 'Waiting for instructions';
  }

  // Last heartbeat
  if (elCache.lastHeartbeat && s.lastHeartbeat) {
    elCache.lastHeartbeat.textContent = formatRelativeTime(s.lastHeartbeat);
  }

  // Model info
  if (elCache.modelInfo && s.model) {
    elCache.modelInfo.textContent = s.model;
  }
}

// ---- Initialization ------------------------------------------

async function init() {
  // Cache all DOM elements first
  cacheElements();

  // Apply saved theme immediately
  initTheme();

  // Set up routing, search, modals, keyboard
  initRouter();
  initSearch();
  initModalSystem();
  initKeyboardShortcuts();

  // Load all data in parallel
  try {
    const [business, tasks, activities, content, agents, statusData, documents, notes, vipClients] = await Promise.all([
      loadJSON('business.json'),
      loadJSON('tasks.json'),
      loadJSON('activity-log.json'),
      loadJSON('content.json'),
      loadJSON('agents.json'),
      loadJSON('status.json'),
      loadJSON('documents.json'),
      loadJSON('notes.json'),
      loadJSON('vip-clients.json'),
    ]);

    setState('business', business);
    setState('tasks', tasks);
    setState('activities', activities);
    setState('content', content);
    setState('agents', agents);
    setState('status', statusData);
    setState('documents', documents);
    setState('notes', notes);
    setState('vipClients', vipClients);
  } catch (err) {
    console.error('[forge] Failed to load initial data', err);
    showToast('Failed to load some data. Check console.', 'error', 5000);
  }

  // Initialize feature modules
  initHome();
  initProjects();
  initContent();
  initKnowledge();
  initChat();
  initVipClients();
  initCompetitors();
  initGoogleTasks();
  initReports();
  initIframes();

  // Update status bar
  updateStatusBar();

  // Subscribe to status changes
  subscribe((key) => {
    if (key === 'status') updateStatusBar();
  });

  console.log('[forge] Command Center initialized');
}

document.addEventListener('DOMContentLoaded', init);

// ---- Exports -------------------------------------------------

export {
  getState,
  setState,
  subscribe,
  loadJSON,
  saveLocal,
  escapeHtml,
  formatNumber,
  formatCurrency,
  formatDate,
  formatRelativeTime,
  daysBetween,
  generateId,
  debounce,
  $,
  $$,
  openModal,
  closeModal,
  showToast,
  switchTab
};
