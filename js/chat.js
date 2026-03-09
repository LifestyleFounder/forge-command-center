// js/chat.js — Agents panel + chat (Solo:OS-style)
// ──────────────────────────────────────────────────────────────────────

import {
  getState, escapeHtml, formatRelativeTime,
  generateId, $, $$, showToast
} from './app.js';
import {
  getThreads as sbGetThreads,
  getMessages as sbGetMessages,
  createThread as sbCreateThread,
  updateThreadTitle as sbUpdateTitle,
  saveMessage as sbSaveMessage
} from './services/chat-persistence.js';
import { attachVoiceInput } from './voice-input.js';

// ── Constants ────────────────────────────────────────────────────────
const THREADS_KEY = 'forge-chat-threads';
const PROXY_KEY   = 'forge-anthropic-proxy';
const DEFAULT_PROXY = 'https://anthropic-proxy.dan-a14.workers.dev';
const PANEL_KEY   = 'forge-agents-panel-open';

// ── Chip configs ─────────────────────────────────────────────────────
const AGENT_CHIPS = {
  'king-consultant': [
    { key: 'strategy',   icon: '&#9889;',    label: 'Strategy',   prefill: 'Help me create a strategy for ' },
    { key: 'metrics',    icon: '&#128202;',   label: 'Metrics',    prefill: 'Break down my current metrics and tell me ' },
    { key: 'clients',    icon: '&#128101;',   label: 'Clients',    prefill: 'Review my VIP clients and ' },
    { key: 'ads',        icon: '&#127919;',   label: 'Ads',        prefill: 'Analyze my Meta ad performance and ' },
    { key: 'content',    icon: '&#128221;',   label: 'Content',    prefill: 'Review my content performance and ' },
  ],
  multiplier: [
    { key: 'brainstorm', icon: '&#128161;',   label: 'Brainstorm',  prefill: 'Brainstorm time — give me 10 viral content ideas on ' },
    { key: 'angles',     icon: '&#127919;',   label: 'Angles',      prefill: 'Help me find the sharpest angle for this topic: ' },
    { key: 'hooks',      icon: '&#127907;',   label: 'Hooks',       prefill: 'Generate 10 hooks for this angle: ' },
    { key: 'script',     icon: '&#127916;',   label: 'Script',      prefill: 'Write a script for ' },
    { key: 'unpack',     icon: '&#128269;',   label: 'Unpack',      prefill: 'Help me unpack this idea and find the deeper insight: ' },
    { key: 'carousel',   icon: '&#127912;',   label: 'Carousel',    prefill: 'Create a carousel about ' },
  ],
  'the-closer': [
    { key: 'coach',      icon: '&#128172;',   label: 'Coach a DM',   prefill: 'Here\'s a DM conversation — tell me what ECAFI™ stage it\'s in and what to say next:\n\n' },
    { key: 'objection',  icon: '&#128170;',   label: 'Objection',    prefill: 'How do I handle this objection: ' },
    { key: 'stage',      icon: '&#127919;',   label: 'Stage Check',  prefill: 'I\'m at this stage in a DM convo — what should I do next? ' },
    { key: 'followup',   icon: '&#128233;',   label: 'Follow Up',    prefill: 'They went dark. Here\'s the context: ' },
  ],
  'the-coach': [
    { key: 'start',      icon: '&#10024;',    label: 'Start 10.0',   prefill: 'I\'m ready to build my 10.0 vision. Let\'s go.' },
    { key: 'beliefs',    icon: '&#129504;',   label: 'Beliefs',      prefill: 'Help me rewire this limiting belief: ' },
    { key: 'vision',     icon: '&#127752;',   label: 'Vision',       prefill: 'Help me expand my vision for ' },
    { key: 'goals',      icon: '&#127919;',   label: 'Goals',        prefill: 'Help me define goals for ' },
  ],
  'the-workshop-maker': [
    { key: 'buildpage',  icon: '&#128196;',   label: 'Build Page',   prefill: 'Build a landing page for my workshop about ' },
    { key: 'bullets',    icon: '&#127919;',   label: 'Bullets',      prefill: 'Write 10-12 high-converting bullets for a workshop on ' },
    { key: 'cta',        icon: '&#128293;',   label: 'CTA',          prefill: 'Write a closing paragraph and CTA buttons for my workshop on ' },
    { key: 'bonuses',    icon: '&#127873;',   label: 'Bonuses',      prefill: 'Help me create 5-7 named bonuses for my workshop on ' },
  ],
  'the-offer-wizard': [
    { key: 'offer',      icon: '&#10024;',    label: 'Build Offer',  prefill: 'Help me create a new offer. I\'m ready to go through the process.' },
    { key: 'refine',     icon: '&#128296;',   label: 'Refine',       prefill: 'Help me refine my existing offer: ' },
    { key: 'mini',       icon: '&#128230;',   label: 'Mini Products', prefill: 'Break my offer into micro-products and lead magnets: ' },
    { key: 'messaging',  icon: '&#128172;',   label: 'Messaging',    prefill: 'Help me create messaging for my offer: ' },
  ],
  'the-skool-savant': [
    { key: 'engage',     icon: '&#128293;',   label: 'Engagement',   prefill: 'How do I boost engagement for ' },
    { key: 'welcome',    icon: '&#128075;',   label: 'Welcome Flow', prefill: 'Design a welcome flow for ' },
    { key: 'post',       icon: '&#128221;',   label: 'Skool Post',   prefill: 'Write a Skool post about ' },
  ],
  'the-ads-master': [
    { key: 'adcopy',     icon: '&#128203;',   label: 'Ad Copy',     prefill: 'Write ad copy for ' },
    { key: 'targeting',  icon: '&#127919;',   label: 'Targeting',   prefill: 'Help me build an audience for ' },
    { key: 'diagnose',   icon: '&#128269;',   label: 'Diagnose',    prefill: 'Why is my ad underperforming? Here\'s the data: ' },
  ],
};

// Default chips for agents not in the map
const DEFAULT_CHIPS = [
  { key: 'ask', icon: '&#128172;', label: 'Ask', prefill: 'Help me with ' },
];

// ── State ────────────────────────────────────────────────────────────
let activeAgentId  = 'king-consultant';
let activeThreadId = null;
let isSending      = false;
let chatState      = 'landing'; // 'landing' | 'conversation'
let attachedFiles  = [];
let searchQuery    = '';

// ── Public init ──────────────────────────────────────────────────────
export function initChat() {
  renderAgentsPanel();
  renderHistoryList();
  updateTopbar();
  restorePanelState();
  bindEvents();

  // Mobile voice input
  attachVoiceInput({ button: $('#chatVoiceBtn'), textarea: $('#chatInput') });

  // Fire-and-forget Supabase sync (doesn't block render)
  syncChatsFromSupabase();
}

// ═══════════════════════════════════════════════════════════════════════
//  TWO-STATE LOGIC
// ═══════════════════════════════════════════════════════════════════════
function setChatState(state) {
  chatState = state;
  const layout = $('.chat-layout');
  if (layout) layout.setAttribute('data-chat-state', state);
}

function transitionToConversation() {
  setChatState('conversation');
  const input = $('#chatInput');
  if (input) input.focus();
  scrollToBottom();
}

function transitionToLanding() {
  activeThreadId = null;
  setChatState('landing');
  renderMessages([]);
  highlightActiveHistory();
  updateTopbar();
  const input = $('#chatInput');
  if (input) {
    input.value = '';
    input.focus();
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  AGENTS
// ═══════════════════════════════════════════════════════════════════════
function getAgents() {
  const data = getState('agents');
  if (!data) return [];
  return data.agents || data || [];
}

function getAgent(agentId) {
  return getAgents().find(a => a.id === agentId) || null;
}

function setActiveAgent(agentId) {
  activeAgentId = agentId;
  updateTopbar();
  highlightActiveAgent();
  renderHistoryList();
}

// ── Agents Panel ─────────────────────────────────────────────────────
function renderAgentsPanel() {
  const agents = getAgents().filter(a => a.systemPrompt);
  const countEl = $('#agentsCount');
  const listEl = $('#agentsList');
  if (countEl) countEl.textContent = agents.length;
  if (!listEl) return;

  listEl.innerHTML = agents.map(a => {
    const bgColor = a.color || 'var(--bg-tertiary)';
    return `
      <button class="agent-panel-item${a.id === activeAgentId ? ' is-active' : ''}" data-agent-id="${escapeHtml(a.id)}">
        <span class="agent-panel-icon" style="background-color: ${bgColor}20; color: ${bgColor}">${a.emoji || '🤖'}</span>
        <span class="agent-panel-name">${escapeHtml(a.name)}</span>
      </button>
    `;
  }).join('');
}

function highlightActiveAgent() {
  $$('#agentsList .agent-panel-item').forEach(item => {
    item.classList.toggle('is-active', item.dataset.agentId === activeAgentId);
  });
}

function handleAgentClick(e) {
  const item = e.target.closest('.agent-panel-item');
  if (!item) return;
  const agentId = item.dataset.agentId;
  if (agentId) {
    setActiveAgent(agentId);
    transitionToLanding();
    // On mobile, close panel after selecting
    if (window.innerWidth <= 768) {
      closeAgentsPanel();
    }
  }
}

// ── Panel Toggle ─────────────────────────────────────────────────────
function toggleAgentsPanel() {
  const panel = $('#agentsPanel');
  if (!panel) return;
  if (panel.classList.contains('is-open')) {
    closeAgentsPanel();
  } else {
    openAgentsPanel();
  }
}

function openAgentsPanel() {
  const panel = $('#agentsPanel');
  const overlay = $('#agentsPanelOverlay');
  if (panel) panel.classList.add('is-open');
  if (overlay && window.innerWidth <= 768) overlay.classList.add('is-visible');
  localStorage.setItem(PANEL_KEY, '1');
}

function closeAgentsPanel() {
  const panel = $('#agentsPanel');
  const overlay = $('#agentsPanelOverlay');
  if (panel) panel.classList.remove('is-open');
  if (overlay) overlay.classList.remove('is-visible');
  localStorage.setItem(PANEL_KEY, '0');
}

function restorePanelState() {
  // On mobile, default closed. On desktop, restore preference.
  if (window.innerWidth <= 768) {
    closeAgentsPanel();
  } else {
    const saved = localStorage.getItem(PANEL_KEY);
    if (saved === '0') {
      closeAgentsPanel();
    }
    // else keep default (is-open in HTML)
  }
}

// ── Topbar ───────────────────────────────────────────────────────────
function updateTopbar() {
  const agent = getAgent(activeAgentId);
  if (!agent) return;

  const emoji = $('#chatTopbarEmoji');
  const name  = $('#chatTopbarName');
  const role  = $('#chatTopbarRole');
  const greeting = $('#chatGreeting');

  if (emoji) emoji.textContent = agent.emoji || '🤖';
  if (name)  name.textContent  = agent.name;
  if (role)  role.textContent  = 'How can I help?';
  if (greeting) greeting.textContent = `Welcome to ${agent.name}`;
  renderChips();
}

// ═══════════════════════════════════════════════════════════════════════
//  THREADS / HISTORY
// ═══════════════════════════════════════════════════════════════════════
function getThreads() {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    const threads = raw ? JSON.parse(raw) : [];
    threads.sort((a, b) => {
      const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return db - da;
    });
    return threads;
  } catch {
    return [];
  }
}

function saveThreads(threads) {
  localStorage.setItem(THREADS_KEY, JSON.stringify(threads));
}

function getActiveThread() {
  if (!activeThreadId) return null;
  return getThreads().find(t => t.id === activeThreadId) || null;
}

function createNewThread() {
  const now = new Date().toISOString();
  const thread = {
    id: generateId('thread'),
    title: 'New conversation',
    agentId: activeAgentId,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };

  const threads = getThreads();
  threads.unshift(thread);
  saveThreads(threads);

  activeThreadId = thread.id;
  renderHistoryList();
  renderMessages([]);
  highlightActiveHistory();
  transitionToConversation();

  syncThreadToSupabase(thread);
}

function updateThreadTitle(threadId, firstMessage) {
  const threads = getThreads();
  const thread = threads.find(t => t.id === threadId);
  if (!thread || thread.title !== 'New conversation') return;

  thread.title = firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '');
  saveThreads(threads);
  renderHistoryList();
  highlightActiveHistory();
  syncTitleToSupabase(threadId, thread.title);
}

// ── Supabase Sync ─────────────────────────────────────────────────
async function syncThreadToSupabase(thread) {
  try {
    await sbCreateThread({
      id: thread.id, title: thread.title,
      agentId: thread.agentId,
      createdAt: thread.createdAt, updatedAt: thread.updatedAt,
    });
  } catch { /* silent */ }
}

async function syncMessageToSupabase(threadId, msg) {
  try {
    await sbSaveMessage(threadId, msg);
  } catch { /* silent */ }
}

async function syncTitleToSupabase(threadId, title) {
  try { await sbUpdateTitle(threadId, title); } catch { /* silent */ }
}

// ── Sync from Supabase on Init ──────────────────────────────────────
async function syncChatsFromSupabase() {
  try {
    const remoteThreads = await sbGetThreads();
    if (!remoteThreads || !Array.isArray(remoteThreads)) return; // Supabase unavailable

    const localThreads = getThreads();
    const hasRemote = remoteThreads.length > 0;
    const hasLocal = localThreads.length > 0;

    if (!hasRemote && hasLocal) {
      // First-time migration: push all local threads + messages to Supabase
      console.log('[chat] First-time sync — pushing local chats to Supabase');
      for (const t of localThreads) {
        syncThreadToSupabase(t);
        for (const m of (t.messages || [])) {
          syncMessageToSupabase(t.id, m);
        }
      }
      return;
    }

    if (!hasRemote) return; // Both empty

    // Build merged thread list
    const localMap = new Map(localThreads.map(t => [t.id, t]));
    const mergedMap = new Map();

    // Process remote threads — fetch their messages
    for (const rt of remoteThreads) {
      const localThread = localMap.get(rt.id);
      if (localThread) {
        // Both have it — pick newer, merge messages
        const localTime = localThread.updatedAt ? new Date(localThread.updatedAt).getTime() : 0;
        const remoteTime = rt.updatedAt ? new Date(rt.updatedAt).getTime() : 0;
        const base = remoteTime >= localTime ? { ...rt } : { ...localThread };

        // Merge messages: fetch remote messages, combine with local
        const remoteMessages = await sbGetMessages(rt.id) || [];
        const localMessages = localThread.messages || [];
        base.messages = mergeMessages(localMessages, remoteMessages);
        base.updatedAt = remoteTime >= localTime ? rt.updatedAt : localThread.updatedAt;
        mergedMap.set(rt.id, base);
      } else {
        // Remote-only thread — fetch its messages
        const messages = await sbGetMessages(rt.id) || [];
        mergedMap.set(rt.id, { ...rt, messages });
      }
      localMap.delete(rt.id);
    }

    // Remaining local-only threads — keep them, push to Supabase
    for (const [, lt] of localMap) {
      mergedMap.set(lt.id, lt);
      syncThreadToSupabase(lt);
      for (const m of (lt.messages || [])) {
        syncMessageToSupabase(lt.id, m);
      }
    }

    const merged = Array.from(mergedMap.values());
    saveThreads(merged);
    renderHistoryList();
    highlightActiveHistory();

    // If we're viewing a conversation, refresh its messages
    if (activeThreadId && chatState === 'conversation') {
      const active = merged.find(t => t.id === activeThreadId);
      if (active) renderMessages(active.messages || []);
    }

    console.log('[chat] Synced from Supabase:', merged.length, 'threads');
  } catch (err) {
    console.warn('[chat] syncChatsFromSupabase failed (non-blocking)', err);
  }
}

function mergeMessages(local, remote) {
  const map = new Map();
  // Index remote by timestamp+role (no stable ID across systems)
  for (const m of remote) {
    const key = `${m.timestamp || m.created_at}|${m.role}`;
    map.set(key, m);
  }
  // Add local messages that don't exist in remote
  for (const m of local) {
    const key = `${m.timestamp}|${m.role}`;
    if (!map.has(key)) map.set(key, m);
  }
  // Sort by timestamp
  return Array.from(map.values()).sort((a, b) => {
    const ta = new Date(a.timestamp || a.created_at || 0).getTime();
    const tb = new Date(b.timestamp || b.created_at || 0).getTime();
    return ta - tb;
  });
}

// ── History List Rendering ───────────────────────────────────────────
function renderHistoryList() {
  const el = $('#historyList');
  if (!el) return;

  // Get threads for the active agent, filtered by search
  let threads = getThreads().filter(t => t.agentId === activeAgentId);

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    threads = threads.filter(t =>
      (t.title || '').toLowerCase().includes(q) ||
      (t.messages || []).some(m => (m.content || '').toLowerCase().includes(q))
    );
  }

  if (!threads.length) {
    el.innerHTML = `<div class="history-empty">No conversations yet</div>`;
    return;
  }

  // Group by date: Today, Previous 30 Days, Older
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysAgo = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000);

  const groups = { today: [], recent: [], older: [] };

  threads.forEach(t => {
    const d = t.updatedAt ? new Date(t.updatedAt) : new Date(0);
    if (d >= todayStart) {
      groups.today.push(t);
    } else if (d >= thirtyDaysAgo) {
      groups.recent.push(t);
    } else {
      groups.older.push(t);
    }
  });

  let html = '';

  if (groups.today.length) {
    html += `<div class="history-date-header">Today</div>`;
    html += groups.today.map(t => renderHistoryItem(t)).join('');
  }

  if (groups.recent.length) {
    html += `<div class="history-date-header">Previous 30 Days</div>`;
    html += groups.recent.map(t => renderHistoryItem(t)).join('');
  }

  if (groups.older.length) {
    html += `<div class="history-date-header">Older</div>`;
    html += groups.older.map(t => renderHistoryItem(t)).join('');
  }

  el.innerHTML = html;
}

function renderHistoryItem(thread) {
  const agent = getAgent(thread.agentId);
  const icon = agent ? (agent.emoji || '🤖') : '🤖';
  const msgCount = (thread.messages || []).length;
  const time = thread.updatedAt ? formatRelativeTime(thread.updatedAt) : '';

  return `
    <button class="history-item${thread.id === activeThreadId ? ' is-active' : ''}" data-thread-id="${escapeHtml(thread.id)}">
      <span class="history-item-icon">${icon}</span>
      <div class="history-item-info">
        <div class="history-item-title">${escapeHtml(thread.title || 'New conversation')}</div>
        <div class="history-item-meta">${msgCount} msg${msgCount !== 1 ? 's' : ''} · ${escapeHtml(time)}</div>
      </div>
    </button>
  `;
}

function highlightActiveHistory() {
  $$('#historyList .history-item').forEach(item => {
    item.classList.toggle('is-active', item.dataset.threadId === activeThreadId);
  });
}

function handleHistoryClick(e) {
  const item = e.target.closest('.history-item');
  if (!item) return;
  const threadId = item.dataset.threadId;
  if (!threadId) return;

  activeThreadId = threadId;
  const thread = getActiveThread();
  if (!thread) return;

  if (thread.agentId) activeAgentId = thread.agentId;
  updateTopbar();
  highlightActiveAgent();
  renderMessages(thread.messages || []);
  highlightActiveHistory();
  transitionToConversation();

  // On mobile, close panel after selecting
  if (window.innerWidth <= 768) {
    closeAgentsPanel();
  }
}

function handleHistorySearch(e) {
  searchQuery = (e.target.value || '').trim();
  renderHistoryList();
}

// ═══════════════════════════════════════════════════════════════════════
//  MESSAGES
// ═══════════════════════════════════════════════════════════════════════
function renderMessages(messages) {
  const el = $('#chatMessages');
  if (!el) return;

  if (!messages || messages.length === 0) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = messages.map(m => renderSingleMessage(m)).join('');
  scrollToBottom();
}

function renderSingleMessage(msg) {
  const isUser  = msg.role === 'user';
  const classes = isUser ? 'message message-user' : 'message message-assistant';
  const content = isUser ? escapeHtml(msg.content) : formatMarkdown(msg.content);
  const time    = msg.timestamp ? formatRelativeTime(msg.timestamp) : '';

  return `
    <div class="${classes}">
      <div class="message-content">${content}</div>
      <div class="message-time">${escapeHtml(time)}</div>
    </div>
  `;
}

function appendMessage(msg) {
  const el = $('#chatMessages');
  if (!el) return;
  el.insertAdjacentHTML('beforeend', renderSingleMessage(msg));
  scrollToBottom();
}

function scrollToBottom() {
  const el = $('#chatMessages');
  if (!el) return;
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

// ═══════════════════════════════════════════════════════════════════════
//  MARKDOWN RENDERING
// ═══════════════════════════════════════════════════════════════════════
function formatMarkdown(content) {
  if (!content) return '';

  const codeBlocks = [];
  let processed = content.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      `<pre><code class="lang-${escapeHtml(lang || 'text')}">${escapeHtml(code.trim())}</code></pre>`
    );
    return `%%CODEBLOCK_${idx}%%`;
  });

  processed = escapeHtml(processed);
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>');
  processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>');
  processed = processed.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  processed = processed.replace(/^- (.+)$/gm, '<li>$1</li>');
  processed = processed.replace(/(<li>[\s\S]*?<\/li>(?:\n|<br>)?)+/g, m => '<ul>' + m + '</ul>');
  processed = processed.replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>');
  processed = processed.replace(/\n/g, '<br>');

  codeBlocks.forEach((block, i) => {
    processed = processed.replace(`%%CODEBLOCK_${i}%%`, block);
  });

  return processed;
}

// ═══════════════════════════════════════════════════════════════════════
//  AUTO-CONTEXT INJECTION
// ═══════════════════════════════════════════════════════════════════════
async function fetchJSON(path) {
  try {
    const res = await fetch(`./data/${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function buildDashboardContext(agentId) {
  const parts = [];

  // Business metrics
  const biz = getState('business');
  if (biz) {
    parts.push(`## Current Business Metrics
- Free members: ${biz.free?.total ?? '?'}
- Premium members: ${biz.premium?.total ?? '?'} (last month: ${biz.premium?.lastMonth ?? '?'})
- VIP clients: ${biz.vip?.total ?? '?'} (last month: ${biz.vip?.lastMonth ?? '?'})
- 1:1 clients: ${biz.oneone?.total ?? '?'}/${biz.oneone?.cap ?? 12}
- Applications this week: ${biz.applications?.thisWeek ?? '?'}
- Workshop sales: ${biz.workshop?.sales ?? '?'}`);

    const healthy = biz.clients?.healthy?.length ?? 0;
    const warning = biz.clients?.warning?.length ?? 0;
    const atRisk  = biz.clients?.atRisk?.length  ?? 0;
    parts.push(`## Client Health
- Healthy: ${healthy}
- Warning: ${warning}${warning > 0 && biz.clients?.warning ? ' (' + biz.clients.warning.map(c => c.name || c).join(', ') + ')' : ''}
- At-risk: ${atRisk}${atRisk > 0 && biz.clients?.atRisk ? ' (' + biz.clients.atRisk.map(c => c.name || c).join(', ') + ')' : ''}`);
  }

  // VIP clients (fields: name, status, program[], joined, payment, pif, email)
  const vip = getState('vipClients');
  if (vip && Array.isArray(vip)) {
    const active = vip.filter(c => c.status === 'Active' || !c.status);
    const atRiskVip = vip.filter(c => c.status === 'At Risk');
    const recent = vip.filter(c => {
      if (!c.joined) return false;
      const d = new Date(c.joined);
      return (Date.now() - d.getTime()) < 30 * 24 * 60 * 60 * 1000;
    });

    if (agentId === 'king-consultant') {
      const vipLines = vip.map(c => {
        const prog = Array.isArray(c.program) ? c.program.join(', ') : (c.program || '?');
        return `- ${c.name} | ${c.status || 'Active'} | ${prog} | joined ${c.joined || '?'} | ${c.payment || '?'}`;
      });
      parts.push(`## VIP Client Roster (${vip.length} total, ${active.length} active, ${atRiskVip.length} at-risk)\n${vipLines.join('\n')}`);
    } else {
      parts.push(`## VIP Clients
- Active: ${active.length}
- At-risk: ${atRiskVip.length}${atRiskVip.length > 0 ? ' (' + atRiskVip.map(c => c.name).join(', ') + ')' : ''}
- Joined last 30 days: ${recent.length}`);
    }
  }

  // Tasks
  const tasksData = getState('tasks');
  if (tasksData) {
    const taskList = (tasksData.tasks || []).filter(t => t.status !== 'done').slice(0, 10);
    if (taskList.length > 0) {
      const lines = taskList.map(t => `- [${t.status}] ${t.title} (${t.priority || 'medium'})`);
      parts.push(`## Active Tasks\n${lines.join('\n')}`);
    }
  }

  // Content trending (data uses trends.hot / trends.rising)
  const content = getState('content');
  const trending = content?.trending || content?.trends?.hot || content?.trends?.rising || [];
  if (trending.length > 0) {
    const topics = trending.slice(0, 5).map(t => `- ${t.title || t.topic || t}`);
    parts.push(`## Trending Content\n${topics.join('\n')}`);
  }

  // ── King Consultant: inject ALL data sources ──────────────────────
  if (agentId === 'king-consultant') {
    // Meta Ads (fields: summary.spend/leads/cpl/applications/roas, campaigns[])
    const metaAds = getState('metaAds') || await fetchJSON('meta-ads.json');
    if (metaAds) {
      const s = metaAds.summary || metaAds;
      const cpa = (s.spend && s.applications) ? (s.spend / s.applications).toFixed(2) : '?';
      parts.push(`## Meta Ads Performance
- Total spend: $${s.spend ?? '?'}
- Leads: ${s.leads ?? '?'}
- CPL: $${s.cpl ?? '?'}
- Applications: ${s.applications ?? '?'}
- CPA: $${cpa}
- ROAS: ${s.roas ?? '?'}
- Impressions: ${s.impressions ?? '?'}
- Clicks: ${s.clicks ?? '?'}
- CTR: ${s.ctr ?? '?'}%`);
      if (metaAds.campaigns && Array.isArray(metaAds.campaigns)) {
        const campLines = metaAds.campaigns.map(c =>
          `- ${c.name}: $${c.spend ?? '?'} spend | ${c.leads ?? '?'} leads | ${c.applications ?? '?'} apps | ${c.status || 'unknown'}`
        );
        parts.push(`### Campaigns\n${campLines.join('\n')}`);
      }
    }

    // Ad Swipes (fields: swipes[].advertiser, .headline, .primaryText, .hookFramework)
    const adSwipes = getState('adSwipes') || await fetchJSON('ad-swipes.json');
    if (adSwipes) {
      const swipeArr = Array.isArray(adSwipes) ? adSwipes : adSwipes.swipes || [];
      if (swipeArr.length > 0) {
        const swipeLines = swipeArr.slice(0, 10).map(s =>
          `- ${s.advertiser || 'Unknown'}: "${(s.headline || s.primaryText || '').slice(0, 80)}" [${s.hookFramework || s.hookType || ''}]`
        );
        parts.push(`## Ad Swipes (Competitor Hooks)\n${swipeLines.join('\n')}`);
      }
    }

    // Instagram (fields: currentStats.followers/engagementRate/posts/avgLikes/avgComments)
    const ig = getState('instagram') || await fetchJSON('instagram.json');
    if (ig) {
      const stats = ig.currentStats || ig;
      parts.push(`## Instagram Performance
- Handle: ${ig.handle ?? '?'}
- Followers: ${stats.followers ?? '?'}
- Engagement rate: ${stats.engagementRate ?? '?'}%
- Total posts: ${stats.posts ?? '?'}
- Avg likes: ${stats.avgLikes ?? '?'}
- Avg comments: ${stats.avgComments ?? '?'}`);
    }

    // YouTube (fields: manualStats.subscribers/totalViews/totalVideos/avgViewsPerVideo)
    const yt = getState('youtube') || await fetchJSON('youtube.json');
    if (yt) {
      const stats = yt.manualStats || yt.channelStats || yt;
      parts.push(`## YouTube Performance
- Subscribers: ${stats.subscribers ?? '?'}
- Total views: ${stats.totalViews ?? '?'}
- Videos: ${stats.totalVideos ?? '?'}
- Avg views/video: ${stats.avgViewsPerVideo ?? '?'}`);
    }

    // Competitor analysis (fields: creators[].fullName/username/followers/engagementRate)
    const creators = await fetchJSON('creators.json');
    if (creators) {
      const creatorArr = Array.isArray(creators) ? creators : creators.creators || [];
      if (creatorArr.length > 0) {
        const creatorLines = creatorArr.map(c =>
          `- ${c.fullName || c.username}: @${c.username} | ${c.followers ?? '?'} followers | ${c.engagementRate ?? '?'}% engagement | ${c.niche || 'coaching'}`
        );
        parts.push(`## Competitor Analysis (Organic)\n${creatorLines.join('\n')}`);
      }
    }

    // Content pipeline
    const pipeline = content?.pipeline || content?.upcoming || [];
    if (Array.isArray(pipeline) && pipeline.length > 0) {
      const pipeLines = pipeline.slice(0, 10).map(p =>
        `- [${p.status || '?'}] ${p.title || p.topic || p}`
      );
      parts.push(`## Content Pipeline\n${pipeLines.join('\n')}`);
    }
  }

  if (parts.length === 0) return '';
  return '\n\n---\n\n# Dashboard Context (auto-injected, current as of this moment)\n\n' + parts.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════
//  SEND / LLM
// ═══════════════════════════════════════════════════════════════════════
async function handleSend() {
  if (isSending) return;

  const input = $('#chatInput');
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  // If on landing, create thread and transition
  if (chatState === 'landing') {
    const now = new Date().toISOString();
    const thread = {
      id: generateId('thread'),
      title: 'New conversation',
      agentId: activeAgentId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    const threads = getThreads();
    threads.unshift(thread);
    saveThreads(threads);
    activeThreadId = thread.id;
    renderHistoryList();
    highlightActiveHistory();
    syncThreadToSupabase(thread);
    transitionToConversation();
  }

  // Ensure thread exists
  if (!activeThreadId) {
    createNewThread();
  }

  // Build content with file context
  let fullContent = text;
  if (attachedFiles.length > 0) {
    const fileContext = attachedFiles.map(f =>
      `[Attached file: ${f.name}]\n${f.content}\n[/Attached file]`
    ).join('\n\n');
    fullContent = text + '\n\n' + fileContext;
  }

  const now = new Date().toISOString();
  const userMsg = { role: 'user', content: text, fullContent, timestamp: now };

  // Add to thread
  const threads = getThreads();
  const thread = threads.find(t => t.id === activeThreadId);
  if (!thread) return;

  thread.messages.push(userMsg);
  thread.updatedAt = now;
  saveThreads(threads);

  // Auto-title
  if (thread.messages.filter(m => m.role === 'user').length === 1) {
    updateThreadTitle(thread.id, text);
  }

  appendMessage(userMsg);
  syncMessageToSupabase(activeThreadId, userMsg);

  // Clear input and files
  input.value = '';
  autoResize(input);
  clearAttachedFiles();

  // Call LLM
  isSending = true;
  setSendingState(true);

  try {
    const agent = getAgent(activeAgentId);
    const apiMessages = thread.messages.map(m => ({
      role: m.role, content: m.fullContent || m.content,
    }));

    const response = await callLLM(apiMessages, agent);

    const assistantMsg = {
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
    };

    const updatedThreads = getThreads();
    const updatedThread = updatedThreads.find(t => t.id === activeThreadId);
    if (updatedThread) {
      updatedThread.messages.push(assistantMsg);
      updatedThread.updatedAt = assistantMsg.timestamp;
      saveThreads(updatedThreads);
    }

    appendMessage(assistantMsg);
    syncMessageToSupabase(activeThreadId, assistantMsg);
    renderHistoryList();
    highlightActiveHistory();
  } catch (err) {
    console.error('[chat] Send failed:', err);
    appendMessage({
      role: 'assistant',
      content: `Sorry, I encountered an error: ${err.message}. Check your proxy configuration or try again.`,
      timestamp: new Date().toISOString(),
    });
    showToast('Message failed to send', 'error');
  } finally {
    isSending = false;
    setSendingState(false);
  }
}

function setSendingState(sending) {
  const input = $('#chatInput');
  const btn = $('#chatSendBtn');
  if (input) input.disabled = sending;
  if (btn) btn.disabled = sending;

  if (sending) {
    const el = $('#chatMessages');
    if (el) {
      el.insertAdjacentHTML('beforeend',
        `<div class="message message-assistant message-typing" id="typingIndicator">
          <div class="typing-dots"><span></span><span></span><span></span></div>
        </div>`
      );
      scrollToBottom();
    }
  } else {
    const indicator = $('#typingIndicator');
    if (indicator) indicator.remove();
  }
}

function getAgentKnowledge(agentId) {
  const map = getState('agentKnowledge');
  if (!map?.[agentId]) return '';
  const text = map[agentId];
  const MAX_CHARS = 200000;
  return text.length > MAX_CHARS
    ? text.slice(0, MAX_CHARS) + '\n\n[... Knowledge truncated]'
    : text;
}

async function callLLM(messages, agent) {
  const proxyUrl = localStorage.getItem(PROXY_KEY) || DEFAULT_PROXY;
  const model = agent?.defaultModel || 'claude-opus-4-6';

  let systemPrompt = agent?.systemPrompt || 'You are a helpful assistant for Dan Harrison, founder of Lifestyle Founders Group. Be direct, concise, and actionable.';

  const knowledge = getAgentKnowledge(agent?.id);
  if (knowledge) {
    systemPrompt += '\n\n---\n\n# Knowledge Base\n\n' + knowledge;
  }

  systemPrompt += await buildDashboardContext(agent?.id);

  const res = await fetch(`${proxyUrl}/anthropic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${errorText.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || data.choices?.[0]?.message?.content || 'No response received.';
}

// ═══════════════════════════════════════════════════════════════════════
//  CHIPS
// ═══════════════════════════════════════════════════════════════════════
function renderChips() {
  const container = $('#chatChips');
  if (!container) return;
  const chips = AGENT_CHIPS[activeAgentId] || DEFAULT_CHIPS;
  container.innerHTML = chips.map(c =>
    `<button class="chat-chip" data-chip="${c.key}"><span class="chip-icon">${c.icon}</span> ${c.label}</button>`
  ).join('');
}

function handleChipClick(e) {
  const chip = e.target.closest('.chat-chip');
  if (!chip) return;

  const chipKey = chip.dataset.chip;
  const chips = AGENT_CHIPS[activeAgentId] || DEFAULT_CHIPS;
  const config = chips.find(c => c.key === chipKey);
  if (!config) return;

  // Prefill input
  const input = $('#chatInput');
  if (input) {
    input.value = config.prefill;
    input.focus();
    input.selectionStart = input.selectionEnd = config.prefill.length;
    autoResize(input);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  FILE ATTACHMENTS
// ═══════════════════════════════════════════════════════════════════════
function handleFileSelect(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  files.forEach(file => {
    if (file.size > 2 * 1024 * 1024) {
      showToast(`${file.name} is too large (max 2MB)`, 'error');
      return;
    }

    if (file.type.startsWith('image/')) {
      attachedFiles.push({
        name: file.name,
        type: file.type,
        content: `[Image file: ${file.name}, ${(file.size / 1024).toFixed(1)}KB]`,
      });
      renderFilePreview();
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result;
        const truncated = text.length > 50000 ? text.slice(0, 50000) + '\n...[truncated]' : text;
        attachedFiles.push({
          name: file.name,
          type: file.type,
          content: truncated,
        });
        renderFilePreview();
      };
      reader.readAsText(file);
    }
  });

  e.target.value = '';
}

function renderFilePreview() {
  const el = $('#filePreview');
  if (!el) return;

  if (attachedFiles.length === 0) {
    el.setAttribute('hidden', '');
    el.innerHTML = '';
    return;
  }

  el.removeAttribute('hidden');
  el.innerHTML = attachedFiles.map((f, i) => `
    <div class="file-preview-item">
      <span class="file-preview-name">${escapeHtml(f.name)}</span>
      <button class="file-preview-remove" data-file-index="${i}" title="Remove">&times;</button>
    </div>
  `).join('');
}

function handleFileRemove(e) {
  const btn = e.target.closest('.file-preview-remove');
  if (!btn) return;
  const idx = parseInt(btn.dataset.fileIndex, 10);
  if (!isNaN(idx)) {
    attachedFiles.splice(idx, 1);
    renderFilePreview();
  }
}

function clearAttachedFiles() {
  attachedFiles = [];
  const el = $('#filePreview');
  if (el) {
    el.setAttribute('hidden', '');
    el.innerHTML = '';
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  AUTO-RESIZE
// ═══════════════════════════════════════════════════════════════════════
function autoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

// ═══════════════════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════════════════
function bindEvents() {
  // Send button
  $('#chatSendBtn')?.addEventListener('click', () => handleSend());

  // Enter to send
  const input = $('#chatInput');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    input.addEventListener('input', () => autoResize(input));
  }

  // Panel toggle
  $('#chatPanelToggle')?.addEventListener('click', toggleAgentsPanel);
  $('#agentsPanelClose')?.addEventListener('click', closeAgentsPanel);
  $('#agentsPanelOverlay')?.addEventListener('click', closeAgentsPanel);

  // Section collapse/expand toggles
  document.querySelector('.agents-section-header')?.addEventListener('click', () => {
    document.querySelector('.agents-section')?.classList.toggle('is-collapsed');
  });
  document.querySelector('.history-section-header')?.addEventListener('click', () => {
    document.querySelector('.history-section')?.classList.toggle('is-collapsed');
  });

  // Agent list clicks
  $('#agentsList')?.addEventListener('click', handleAgentClick);

  // History list clicks
  $('#historyList')?.addEventListener('click', handleHistoryClick);

  // History search
  $('#historySearch')?.addEventListener('input', handleHistorySearch);

  // New chat button
  $('#newChatBtn')?.addEventListener('click', () => {
    transitionToLanding();
  });

  // Chips
  $('#chatChips')?.addEventListener('click', handleChipClick);

  // File attachments
  $('#attachBtn')?.addEventListener('click', () => $('#fileInput')?.click());
  $('#fileInput')?.addEventListener('change', handleFileSelect);
  $('#filePreview')?.addEventListener('click', handleFileRemove);
}
