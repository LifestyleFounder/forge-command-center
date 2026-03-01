// js/chat.js — Clean chat (claude.ai-style, two-state)
// ──────────────────────────────────────────────────────────────────────

import {
  getState, escapeHtml, formatRelativeTime,
  generateId, $, $$, showToast
} from './app.js';
import {
  createThread as sbCreateThread,
  updateThreadTitle as sbUpdateTitle,
  saveMessage as sbSaveMessage
} from './services/chat-persistence.js';

// ── Constants ────────────────────────────────────────────────────────
const THREADS_KEY = 'forge-chat-threads';
const PROXY_KEY   = 'forge-anthropic-proxy';
const DEFAULT_PROXY = 'https://anthropic-proxy.dan-a14.workers.dev';

// ── Chip configs ─────────────────────────────────────────────────────
const CHIP_CONFIG = {
  write:      { prefill: 'Help me write ',                    agent: 'multiplier' },
  strategize: { prefill: 'Help me create a strategy for ',    agent: 'geeves' },
  analyze:    { prefill: 'Analyze my current ',                agent: 'geeves' },
  coach:      { prefill: 'I need coaching on ',                agent: 'the-coach' },
  close:      { prefill: 'Help me close this deal: ',          agent: 'the-closer' },
};

// ── State ────────────────────────────────────────────────────────────
let activeAgentId  = 'geeves';
let activeThreadId = null;
let isSending      = false;
let chatState      = 'landing'; // 'landing' | 'conversation'
let attachedFiles  = [];        // { name, type, content } — text extracted from files

// ── Public init ──────────────────────────────────────────────────────
export function initChat() {
  renderAgentDropdowns();
  initThreads();
  bindEvents();
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
  const input = $('#chatInputConvo');
  if (input) input.focus();
  scrollToBottom();
}

function transitionToLanding() {
  activeThreadId = null;
  setChatState('landing');
  renderMessages([]);
  highlightActiveThread();
  const input = $('#chatInputLanding');
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
  updateAgentSelectors();
}

function updateAgentSelectors() {
  const agent = getAgent(activeAgentId);
  if (!agent) return;

  // Update both selectors (landing + conversation)
  $$('.chat-agent-selector').forEach(btn => {
    const emoji = btn.querySelector('.agent-selector-emoji');
    const name  = btn.querySelector('.agent-selector-name');
    if (emoji) emoji.textContent = agent.emoji || '🤖';
    if (name)  name.textContent  = agent.name;
  });
}

function renderAgentDropdowns() {
  const agents = getAgents();
  if (!agents.length) return;

  const html = agents
    .filter(a => a.systemPrompt) // Only show agents with system prompts
    .map(a => `
      <button class="agent-dropdown-item${a.id === activeAgentId ? ' is-active' : ''}" data-agent-id="${escapeHtml(a.id)}">
        <span class="agent-dd-emoji">${a.emoji || '🤖'}</span>
        <span class="agent-dd-info">
          <span class="agent-dd-name">${escapeHtml(a.name)}</span>
          <span class="agent-dd-role">${escapeHtml((a.role || '').slice(0, 50))}</span>
        </span>
      </button>
    `).join('');

  // Fill both dropdowns
  const d1 = $('#agentDropdown');
  const d2 = $('#agentDropdownConvo');
  if (d1) d1.innerHTML = html;
  if (d2) d2.innerHTML = html;

  updateAgentSelectors();
}

function toggleAgentDropdown(dropdownId) {
  const dd = $(`#${dropdownId}`);
  if (!dd) return;

  const isOpen = !dd.hasAttribute('hidden');
  // Close all dropdowns first
  $$('.chat-agent-dropdown').forEach(el => el.setAttribute('hidden', ''));

  if (!isOpen) {
    // Re-render active states
    dd.querySelectorAll('.agent-dropdown-item').forEach(item => {
      item.classList.toggle('is-active', item.dataset.agentId === activeAgentId);
    });
    dd.removeAttribute('hidden');
  }
}

function handleAgentSelect(e) {
  const item = e.target.closest('.agent-dropdown-item');
  if (!item) return;

  const agentId = item.dataset.agentId;
  if (agentId) setActiveAgent(agentId);

  // Close all dropdowns
  $$('.chat-agent-dropdown').forEach(el => el.setAttribute('hidden', ''));
}

// ═══════════════════════════════════════════════════════════════════════
//  THREADS
// ═══════════════════════════════════════════════════════════════════════
function initThreads() {
  const threads = getThreads();
  renderThreadsList(threads);

  // If threads exist, load most recent but stay on landing
  if (threads.length > 0) {
    const latest = threads[0];
    activeAgentId = latest.agentId || 'geeves';
    updateAgentSelectors();
  }
}

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
  renderThreadsList(getThreads());
  renderMessages([]);
  highlightActiveThread();
  transitionToConversation();
  closeThreadDrawer();

  // Fire-and-forget Supabase sync
  syncThreadToSupabase(thread);
}

function updateThreadTitle(threadId, firstMessage) {
  const threads = getThreads();
  const thread = threads.find(t => t.id === threadId);
  if (!thread || thread.title !== 'New conversation') return;

  thread.title = firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '');
  saveThreads(threads);
  renderThreadsList(getThreads());
  highlightActiveThread();
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

// ── Thread drawer ─────────────────────────────────────────────────
function openThreadDrawer() {
  const drawer  = $('#chatThreadDrawer');
  const overlay = $('#chatDrawerOverlay');
  if (drawer)  drawer.classList.add('is-open');
  if (overlay) overlay.classList.add('is-visible');
}

function closeThreadDrawer() {
  const drawer  = $('#chatThreadDrawer');
  const overlay = $('#chatDrawerOverlay');
  if (drawer)  drawer.classList.remove('is-open');
  if (overlay) overlay.classList.remove('is-visible');
}

function toggleThreadDrawer() {
  const drawer = $('#chatThreadDrawer');
  if (drawer?.classList.contains('is-open')) {
    closeThreadDrawer();
  } else {
    openThreadDrawer();
  }
}

// ── Thread list rendering ─────────────────────────────────────────
function renderThreadsList(threads) {
  const el = $('#threadsList');
  if (!el) return;

  if (!threads || threads.length === 0) {
    el.innerHTML = `<div class="empty-state threads-empty"><p class="text-secondary">No conversations yet</p></div>`;
    return;
  }

  el.innerHTML = threads.map(t => {
    const agent = getAgent(t.agentId);
    const icon = agent ? (agent.emoji || '🤖') : '🤖';
    const agentName = agent ? agent.name : t.agentId;
    return `
      <button class="thread-item${t.id === activeThreadId ? ' is-active' : ''}" data-thread-id="${escapeHtml(t.id)}">
        <div class="thread-item-header">
          <span class="thread-agent-icon">${icon}</span>
          <span class="thread-title">${escapeHtml(t.title || 'New conversation')}</span>
        </div>
        <div class="thread-item-meta">
          <span class="thread-agent-name">${escapeHtml(agentName)}</span>
          <span class="thread-time">${t.updatedAt ? formatRelativeTime(t.updatedAt) : ''}</span>
        </div>
      </button>
    `;
  }).join('');
}

function highlightActiveThread() {
  $$('#threadsList .thread-item').forEach(item => {
    item.classList.toggle('is-active', item.dataset.threadId === activeThreadId);
  });
}

function handleThreadClick(e) {
  const item = e.target.closest('.thread-item');
  if (!item) return;
  const threadId = item.dataset.threadId;
  if (!threadId) return;

  activeThreadId = threadId;
  const thread = getActiveThread();
  if (!thread) return;

  if (thread.agentId) setActiveAgent(thread.agentId);

  renderMessages(thread.messages || []);
  highlightActiveThread();
  transitionToConversation();
  closeThreadDrawer();
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
function buildDashboardContext() {
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

    // Client health
    const healthy = biz.clients?.healthy?.length ?? 0;
    const warning = biz.clients?.warning?.length ?? 0;
    const atRisk  = biz.clients?.atRisk?.length  ?? 0;
    parts.push(`## Client Health
- Healthy: ${healthy}
- Warning: ${warning}${warning > 0 && biz.clients?.warning ? ' (' + biz.clients.warning.map(c => c.name || c).join(', ') + ')' : ''}
- At-risk: ${atRisk}${atRisk > 0 && biz.clients?.atRisk ? ' (' + biz.clients.atRisk.map(c => c.name || c).join(', ') + ')' : ''}`);
  }

  // VIP clients
  const vip = getState('vipClients');
  if (vip && Array.isArray(vip)) {
    const active = vip.filter(c => c.status === 'active' || !c.status);
    const atRiskVip = vip.filter(c => c.health === 'at-risk' || c.health === 'warning');
    const recent = vip.filter(c => {
      if (!c.joinDate) return false;
      const d = new Date(c.joinDate);
      return (Date.now() - d.getTime()) < 30 * 24 * 60 * 60 * 1000;
    });
    parts.push(`## VIP Clients
- Active: ${active.length}
- At-risk/warning: ${atRiskVip.length}${atRiskVip.length > 0 ? ' (' + atRiskVip.map(c => c.name).join(', ') + ')' : ''}
- Joined last 30 days: ${recent.length}`);
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

  // Content trending
  const content = getState('content');
  if (content?.trending && content.trending.length > 0) {
    const topics = content.trending.slice(0, 5).map(t => `- ${t.title || t.topic || t}`);
    parts.push(`## Trending Content\n${topics.join('\n')}`);
  }

  if (parts.length === 0) return '';
  return '\n\n---\n\n# Dashboard Context (auto-injected, current as of this moment)\n\n' + parts.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════
//  SEND / LLM
// ═══════════════════════════════════════════════════════════════════════
async function handleSend(inputId) {
  if (isSending) return;

  const input = $(`#${inputId}`);
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
    renderThreadsList(getThreads());
    highlightActiveThread();
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

  // Clear inputs and files
  $('#chatInputLanding').value = '';
  $('#chatInputConvo').value = '';
  autoResize($('#chatInputLanding'));
  autoResize($('#chatInputConvo'));
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
    renderThreadsList(getThreads());
    highlightActiveThread();
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
  $$('.chat-input').forEach(el => el.disabled = sending);
  $$('.chat-send-btn').forEach(el => el.disabled = sending);

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

async function callLLM(messages, agent) {
  const proxyUrl = localStorage.getItem(PROXY_KEY) || DEFAULT_PROXY;
  const model = agent?.defaultModel || 'claude-sonnet-4-20250514';

  // Build system prompt with auto-injected context
  let systemPrompt = agent?.systemPrompt || 'You are a helpful assistant for Dan Harrison, founder of Lifestyle Founders Group. Be direct, concise, and actionable.';
  systemPrompt += buildDashboardContext();

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
function handleChipClick(e) {
  const chip = e.target.closest('.chat-chip');
  if (!chip) return;

  const chipKey = chip.dataset.chip;
  const config  = CHIP_CONFIG[chipKey];
  if (!config) return;

  // Switch agent
  setActiveAgent(config.agent);

  // Prefill input
  const input = $('#chatInputLanding');
  if (input) {
    input.value = config.prefill;
    input.focus();
    // Place cursor at end
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
    // Size limit: 500KB for text, images as base64 up to 2MB
    if (file.size > 2 * 1024 * 1024) {
      showToast(`${file.name} is too large (max 2MB)`, 'error');
      return;
    }

    const reader = new FileReader();

    if (file.type.startsWith('image/')) {
      // Images: note the attachment but can't extract text content
      attachedFiles.push({
        name: file.name,
        type: file.type,
        content: `[Image file: ${file.name}, ${(file.size / 1024).toFixed(1)}KB]`,
      });
      renderFilePreview();
    } else {
      // For text files, read as text
      reader.onload = () => {
        const text = reader.result;
        // Truncate very long files
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

  // Reset file input so same file can be re-selected
  e.target.value = '';
}

function renderFilePreview() {
  const ids = chatState === 'landing'
    ? 'filePreviewLanding'
    : 'filePreviewConvo';
  const el = $(`#${ids}`);
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
  ['filePreviewLanding', 'filePreviewConvo'].forEach(id => {
    const el = $(`#${id}`);
    if (el) {
      el.setAttribute('hidden', '');
      el.innerHTML = '';
    }
  });
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
  // Send buttons
  $('#chatSendLanding')?.addEventListener('click', () => handleSend('chatInputLanding'));
  $('#chatSendConvo')?.addEventListener('click', () => handleSend('chatInputConvo'));

  // Enter to send (both inputs)
  const bindInput = (id) => {
    const el = $(`#${id}`);
    if (!el) return;

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend(id);
      }
    });

    el.addEventListener('input', () => autoResize(el));
  };

  bindInput('chatInputLanding');
  bindInput('chatInputConvo');

  // Agent selector toggles
  $('#agentSelectorLanding')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAgentDropdown('agentDropdown');
  });
  $('#agentSelectorConvo')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAgentDropdown('agentDropdownConvo');
  });

  // Agent dropdown selection (event delegation)
  $('#agentDropdown')?.addEventListener('click', handleAgentSelect);
  $('#agentDropdownConvo')?.addEventListener('click', handleAgentSelect);

  // Close dropdowns on outside click
  document.addEventListener('click', () => {
    $$('.chat-agent-dropdown').forEach(el => el.setAttribute('hidden', ''));
  });

  // Thread drawer toggle
  $('#chatThreadToggle')?.addEventListener('click', toggleThreadDrawer);
  $('#chatDrawerOverlay')?.addEventListener('click', closeThreadDrawer);

  // Thread list clicks
  $('#threadsList')?.addEventListener('click', handleThreadClick);

  // New thread button
  $('#newThreadBtn')?.addEventListener('click', createNewThread);

  // Chips
  $('#chatChips')?.addEventListener('click', handleChipClick);

  // File attachments
  $('#attachBtnLanding')?.addEventListener('click', () => $('#fileInputLanding')?.click());
  $('#attachBtnConvo')?.addEventListener('click', () => $('#fileInputConvo')?.click());
  $('#fileInputLanding')?.addEventListener('change', handleFileSelect);
  $('#fileInputConvo')?.addEventListener('change', handleFileSelect);
  // File preview remove buttons (event delegation)
  $('#filePreviewLanding')?.addEventListener('click', handleFileRemove);
  $('#filePreviewConvo')?.addEventListener('click', handleFileRemove);
}
