// js/chat.js — Multi-agent chat system
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe, loadJSON, saveLocal,
  escapeHtml, formatNumber, formatDate, formatRelativeTime,
  generateId, debounce, $, $$, openModal, closeModal, showToast
} from './app.js';
import {
  getThreads as sbGetThreads, createThread as sbCreateThread,
  archiveThread as sbArchiveThread, updateThreadTitle as sbUpdateTitle,
  getMessages as sbGetMessages, saveMessage as sbSaveMessage
} from './services/chat-persistence.js';

// ── Constants ────────────────────────────────────────────────────────
const THREADS_KEY = 'forge-chat-threads';
const PROXY_KEY   = 'forge-anthropic-proxy';
const DEFAULT_PROXY = 'https://anthropic-proxy.dan-a14.workers.dev';

// ── State ────────────────────────────────────────────────────────────
let activeAgentId = 'geeves';
let activeThreadId = null;
let isSending = false;
let mentionState = {
  active: false,
  query: '',
  startIndex: -1,
  selectedIndex: 0,
  items: [],
};

// ── Public init ──────────────────────────────────────────────────────
export function initChat() {
  loadAgents();
  initChatThreads();
  bindChatEvents();
}

// ═══════════════════════════════════════════════════════════════════════
//  AGENTS
// ═══════════════════════════════════════════════════════════════════════
function loadAgents() {
  const agentsData = getState('agents');
  if (!agentsData) return;
  renderAgentBar(agentsData);
}

function renderAgentBar(agentsData) {
  const el = $('#agentBar');
  if (!el) return;

  const agents = agentsData.agents || agentsData || [];
  if (!Array.isArray(agents) || agents.length === 0) return;

  el.innerHTML = agents.map(agent => `
    <button class="agent-tab${agent.id === activeAgentId ? ' is-active' : ''}" data-agent="${escapeHtml(agent.id)}" role="tab" aria-selected="${agent.id === activeAgentId}" title="${escapeHtml(agent.role || '')}">
      <span class="agent-icon">${agent.emoji || '🤖'}</span>
      <span class="agent-name">${escapeHtml(agent.name)}</span>
    </button>
  `).join('');

  updateInputPlaceholder();
}

function getAgent(agentId) {
  const agentsData = getState('agents');
  if (!agentsData) return null;
  const agents = agentsData.agents || agentsData || [];
  return agents.find(a => a.id === agentId) || null;
}

function handleAgentSwitch(e) {
  const tab = e.target.closest('.agent-tab');
  if (!tab) return;
  const agentId = tab.dataset.agent;
  if (!agentId || agentId === activeAgentId) return;

  activeAgentId = agentId;

  $$('#agentBar .agent-tab').forEach(btn => {
    const isActive = btn.dataset.agent === agentId;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  updateInputPlaceholder();

  // If current thread belongs to a different agent, deselect it
  const thread = getActiveThread();
  if (thread && thread.agentId !== agentId) {
    activeThreadId = null;
    renderMessages([]);
    highlightActiveThread();
  }
}

function updateInputPlaceholder() {
  const input = $('#chatInput');
  if (!input) return;
  const agent = getAgent(activeAgentId);
  const name = agent ? agent.name : 'assistant';
  input.placeholder = `Message ${name}... (@ to mention)`;
}

// ═══════════════════════════════════════════════════════════════════════
//  THREADS
// ═══════════════════════════════════════════════════════════════════════
function initChatThreads() {
  const threads = getThreads();
  renderThreadsList(threads);

  // Load most recent thread if any
  if (threads.length > 0) {
    const latest = threads[0];
    activeThreadId = latest.id;
    activeAgentId = latest.agentId || 'geeves';
    loadAgents(); // Re-render agent bar with correct active
    renderMessages(latest.messages || []);
    highlightActiveThread();
  }
}

function getThreads() {
  try {
    const raw = localStorage.getItem(THREADS_KEY);
    const threads = raw ? JSON.parse(raw) : [];
    // Sort newest first
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

// ── Supabase Sync (fire-and-forget) ─────────────────────────────
async function syncThreadToSupabase(thread) {
  try {
    await sbCreateThread({
      id: thread.id,
      title: thread.title,
      agent_id: thread.agentId,
      created_at: thread.createdAt,
      updated_at: thread.updatedAt,
    });
  } catch { /* silent — localStorage is primary */ }
}

async function syncMessageToSupabase(threadId, msg) {
  try {
    await sbSaveMessage({
      thread_id: threadId,
      role: msg.role,
      content: msg.content,
      created_at: msg.timestamp,
    });
  } catch { /* silent */ }
}

async function syncTitleToSupabase(threadId, title) {
  try { await sbUpdateTitle(threadId, title); } catch { /* silent */ }
}

function getActiveThread() {
  if (!activeThreadId) return null;
  const threads = getThreads();
  return threads.find(t => t.id === activeThreadId) || null;
}

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

  // Switch to thread's agent
  if (thread.agentId && thread.agentId !== activeAgentId) {
    activeAgentId = thread.agentId;
    $$('#agentBar .agent-tab').forEach(btn => {
      const isActive = btn.dataset.agent === activeAgentId;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    updateInputPlaceholder();
  }

  renderMessages(thread.messages || []);
  highlightActiveThread();
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
  syncThreadToSupabase(thread);

  const input = $('#chatInput');
  if (input) input.focus();
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

// ═══════════════════════════════════════════════════════════════════════
//  MESSAGES
// ═══════════════════════════════════════════════════════════════════════
function renderMessages(messages) {
  const el = $('#chatMessages');
  if (!el) return;

  if (!messages || messages.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>Start a conversation</p><p class="text-secondary">Select an agent and type a message below</p></div>`;
    return;
  }

  el.innerHTML = messages.map(m => renderSingleMessage(m)).join('');
  scrollToBottom();
}

function renderSingleMessage(msg) {
  const isUser = msg.role === 'user';
  const classes = isUser ? 'message message-user' : 'message message-assistant';
  const content = isUser ? escapeHtml(msg.content) : formatMessage(msg.content);
  const time = msg.timestamp ? formatRelativeTime(msg.timestamp) : '';

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

  // Remove empty state if present
  const empty = el.querySelector('.empty-state');
  if (empty) empty.remove();

  el.insertAdjacentHTML('beforeend', renderSingleMessage(msg));
  scrollToBottom();
}

function scrollToBottom() {
  const el = $('#chatMessages');
  if (!el) return;
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  MARKDOWN RENDERING
// ═══════════════════════════════════════════════════════════════════════
function formatMessage(content) {
  if (!content) return '';

  // Extract code blocks first, escape their contents, preserve them
  const codeBlocks = [];
  let processed = content.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      `<pre><code class="lang-${escapeHtml(lang || 'text')}">${escapeHtml(code.trim())}</code></pre>`
    );
    return `%%CODEBLOCK_${idx}%%`;
  });

  // Escape remaining HTML
  processed = escapeHtml(processed);

  // Apply markdown formatting (order matters)
  // Bold (must come before italic)
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links [text](url)
  processed = processed.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // Unordered lists (lines starting with - )
  processed = processed.replace(/^- (.+)$/gm, '<li>$1</li>');
  processed = processed.replace(/(<li>[\s\S]*?<\/li>(?:\n|<br>)?)+/g, (match) => {
    return '<ul>' + match + '</ul>';
  });
  // Ordered lists (lines starting with number.)
  processed = processed.replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>');
  // Newlines
  processed = processed.replace(/\n/g, '<br>');

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    processed = processed.replace(`%%CODEBLOCK_${i}%%`, block);
  });

  return processed;
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

  // Ensure we have a thread
  if (!activeThreadId) {
    createNewThread();
  }

  // Resolve @mentions into context
  const resolvedContent = resolveMentions(text);

  const now = new Date().toISOString();
  const userMsg = {
    role: 'user',
    content: text,
    resolvedContent,
    timestamp: now,
  };

  // Add user message to thread
  const threads = getThreads();
  const thread = threads.find(t => t.id === activeThreadId);
  if (!thread) return;

  thread.messages.push(userMsg);
  thread.updatedAt = now;
  saveThreads(threads);

  // Auto-title from first message
  if (thread.messages.filter(m => m.role === 'user').length === 1) {
    updateThreadTitle(thread.id, text);
  }

  // Render and clear input
  appendMessage(userMsg);
  syncMessageToSupabase(activeThreadId, userMsg);
  input.value = '';
  autoResize();
  closeMentionDropdown();

  // Call LLM
  isSending = true;
  setSendingState(true);

  try {
    const agent = getAgent(activeAgentId);

    // Build message history for API
    const apiMessages = thread.messages.map(m => ({
      role: m.role,
      content: m.role === 'user' ? (m.resolvedContent || m.content) : m.content,
    }));

    const response = await callLLM(apiMessages, agent);

    const assistantMsg = {
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
    };

    // Save to thread
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
    const errorMsg = {
      role: 'assistant',
      content: `Sorry, I encountered an error: ${err.message}. Check your proxy configuration or try again.`,
      timestamp: new Date().toISOString(),
    };
    appendMessage(errorMsg);
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
    // Show typing indicator
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
    // Remove typing indicator
    const indicator = $('#typingIndicator');
    if (indicator) indicator.remove();
  }
}

async function callLLM(messages, agent) {
  const proxyUrl = localStorage.getItem(PROXY_KEY) || DEFAULT_PROXY;
  const model = agent?.defaultModel || 'claude-sonnet-4';
  const systemPrompt = agent?.systemPrompt || 'You are a helpful assistant.';

  try {
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
  } catch (err) {
    console.error('[chat] LLM call failed:', err);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  @MENTION AUTOCOMPLETE
// ═══════════════════════════════════════════════════════════════════════
function handleMentionInput() {
  const input = $('#chatInput');
  if (!input) return;

  const text = input.value;
  const cursorPos = input.selectionStart;

  // Find the last @ before cursor that isn't preceded by a word char
  let atIndex = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (text[i] === '@') {
      // Valid if at start or preceded by space/newline
      if (i === 0 || /\s/.test(text[i - 1])) {
        atIndex = i;
      }
      break;
    }
    if (/\s/.test(text[i])) break;
  }

  if (atIndex === -1) {
    closeMentionDropdown();
    return;
  }

  const query = text.slice(atIndex + 1, cursorPos).toLowerCase();
  mentionState.active = true;
  mentionState.query = query;
  mentionState.startIndex = atIndex;
  mentionState.selectedIndex = 0;

  const items = buildMentionItems(query);
  mentionState.items = items;

  if (items.length === 0) {
    closeMentionDropdown();
    return;
  }

  renderMentionDropdown(items);
}

function buildMentionItems(query) {
  const items = [];

  // Special mentions
  const specials = [
    { id: '@metrics', label: 'Metrics', description: 'Current business metrics', type: 'special' },
    { id: '@tasks', label: 'Tasks', description: 'Active tasks and projects', type: 'special' },
    { id: '@pipeline', label: 'Pipeline', description: 'Sales pipeline data', type: 'special' },
  ];

  specials.forEach(s => {
    if (!query || s.label.toLowerCase().includes(query) || s.id.toLowerCase().includes(query)) {
      items.push(s);
    }
  });

  // Documents
  const docs = getState('documents') || [];
  docs.forEach(d => {
    if (!query || (d.name || '').toLowerCase().includes(query)) {
      items.push({
        id: `@doc:${d.id}`,
        label: d.name,
        description: d.category || d.type || '',
        type: 'document',
      });
    }
  });

  // Notes
  const notes = getState('notes') || [];
  notes.forEach(n => {
    if (!query || (n.title || '').toLowerCase().includes(query)) {
      items.push({
        id: `@note:${n.id}`,
        label: n.title || 'Untitled',
        description: 'Note',
        type: 'note',
      });
    }
  });

  return items.slice(0, 10); // Limit to 10 results
}

function renderMentionDropdown(items) {
  const el = $('#mentionDropdown');
  if (!el) return;

  el.innerHTML = items.map((item, i) => {
    const icon = item.type === 'special' ? '⚡' : item.type === 'document' ? '📄' : '📝';
    return `
      <div class="mention-item${i === mentionState.selectedIndex ? ' is-selected' : ''}" data-mention-index="${i}" role="option">
        <span class="mention-icon">${icon}</span>
        <div class="mention-info">
          <span class="mention-label">${escapeHtml(item.label)}</span>
          <span class="mention-desc">${escapeHtml(item.description)}</span>
        </div>
      </div>
    `;
  }).join('');

  el.removeAttribute('hidden');
}

function closeMentionDropdown() {
  const el = $('#mentionDropdown');
  if (el) el.setAttribute('hidden', '');
  mentionState.active = false;
  mentionState.items = [];
  mentionState.selectedIndex = 0;
}

function handleMentionKeydown(e) {
  if (!mentionState.active || mentionState.items.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    mentionState.selectedIndex = (mentionState.selectedIndex + 1) % mentionState.items.length;
    renderMentionDropdown(mentionState.items);
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    mentionState.selectedIndex = (mentionState.selectedIndex - 1 + mentionState.items.length) % mentionState.items.length;
    renderMentionDropdown(mentionState.items);
    return;
  }

  if (e.key === 'Enter' || e.key === 'Tab') {
    if (mentionState.active && mentionState.items.length > 0) {
      e.preventDefault();
      selectMention(mentionState.selectedIndex);
      return;
    }
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    closeMentionDropdown();
    return;
  }
}

function selectMention(index) {
  const item = mentionState.items[index];
  if (!item) return;

  const input = $('#chatInput');
  if (!input) return;

  const text = input.value;
  const before = text.slice(0, mentionState.startIndex);
  const after = text.slice(input.selectionStart);

  const insertText = item.id + ' ';
  input.value = before + insertText + after;
  input.selectionStart = input.selectionEnd = before.length + insertText.length;
  input.focus();

  closeMentionDropdown();
}

function handleMentionClick(e) {
  const item = e.target.closest('.mention-item');
  if (!item) return;
  const index = parseInt(item.dataset.mentionIndex, 10);
  if (!isNaN(index)) selectMention(index);
}

// ── Resolve mentions into context ────────────────────────────────────
function resolveMentions(text) {
  let resolved = text;

  // Resolve @doc:id mentions
  resolved = resolved.replace(/@doc:([^\s]+)/g, (match, docId) => {
    const docs = getState('documents') || [];
    const doc = docs.find(d => d.id === docId);
    if (!doc) return match;
    return `[Document: ${doc.name}]\n${doc.content || '(no content)'}\n[/Document]`;
  });

  // Resolve @note:id mentions
  resolved = resolved.replace(/@note:([^\s]+)/g, (match, noteId) => {
    const notes = getState('notes') || [];
    const note = notes.find(n => n.id === noteId);
    if (!note) return match;
    const plainContent = stripHtmlForMention(note.content || '');
    return `[Note: ${note.title || 'Untitled'}]\n${plainContent}\n[/Note]`;
  });

  // Resolve special mentions
  resolved = resolved.replace(/@metrics\b/g, () => {
    const biz = getState('business');
    if (!biz) return '[Metrics: not loaded]';
    const summary = {
      free: biz.free?.total,
      premium: biz.premium?.total,
      vip: biz.vip?.total,
      oneOnOne: `${biz.oneone?.total || 0}/${biz.oneone?.cap || 12}`,
      applications: biz.applications?.thisWeek,
      workshop: biz.workshop?.sales,
    };
    return `[Metrics]\n${JSON.stringify(summary, null, 2)}\n[/Metrics]`;
  });

  resolved = resolved.replace(/@tasks\b/g, () => {
    const tasksData = getState('tasks');
    if (!tasksData) return '[Tasks: not loaded]';
    const taskList = tasksData?.tasks || [];
    const summary = taskList.map(t =>
      `- [${t.status}] ${t.title} (${t.priority || 'medium'})`
    ).join('\n');
    return `[Tasks]\n${summary || 'No tasks'}\n[/Tasks]`;
  });

  resolved = resolved.replace(/@pipeline\b/g, () => {
    const biz = getState('business');
    if (!biz) return '[Pipeline: not loaded]';
    const pipeline = {
      applications: biz.applications?.thisWeek || 0,
      premiumNew: biz.premium?.lastMonth || 0,
      vipNew: biz.vip?.lastMonth || 0,
      oneOnOne: `${biz.oneone?.total || 0}/${biz.oneone?.cap || 12}`,
      healthyClients: biz.clients?.healthy?.length || 0,
      warningClients: biz.clients?.warning?.length || 0,
      atRiskClients: biz.clients?.atRisk?.length || 0,
    };
    return `[Pipeline]\n${JSON.stringify(pipeline, null, 2)}\n[/Pipeline]`;
  });

  return resolved;
}

function stripHtmlForMention(html) {
  if (typeof document !== 'undefined') {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }
  return html.replace(/<[^>]*>/g, '');
}

// ═══════════════════════════════════════════════════════════════════════
//  AUTO-RESIZE
// ═══════════════════════════════════════════════════════════════════════
function autoResize() {
  const el = $('#chatInput');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

// ═══════════════════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════════════════
function bindChatEvents() {
  // Send on button click
  $('#chatSendBtn')?.addEventListener('click', handleSend);

  // Send on Enter (not Shift+Enter)
  $('#chatInput')?.addEventListener('keydown', (e) => {
    // Let mention keydown handler take precedence
    if (mentionState.active && mentionState.items.length > 0) {
      if (['ArrowDown', 'ArrowUp', 'Tab', 'Escape'].includes(e.key)) {
        handleMentionKeydown(e);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // If mention is active, select mention instead of sending
        handleMentionKeydown(e);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize textarea
  $('#chatInput')?.addEventListener('input', autoResize);

  // Agent switching via event delegation on #agentBar
  $('#agentBar')?.addEventListener('click', handleAgentSwitch);

  // Thread switching via event delegation on #threadsList
  $('#threadsList')?.addEventListener('click', handleThreadClick);

  // New thread
  $('#newThreadBtn')?.addEventListener('click', createNewThread);

  // Mention handling — input triggers autocomplete search
  $('#chatInput')?.addEventListener('input', handleMentionInput);

  // Mention dropdown click (event delegation)
  $('#mentionDropdown')?.addEventListener('click', handleMentionClick);

  // Close mention dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!mentionState.active) return;
    const dropdown = $('#mentionDropdown');
    const input = $('#chatInput');
    if (dropdown && !dropdown.contains(e.target) && input !== e.target) {
      closeMentionDropdown();
    }
  });
}
