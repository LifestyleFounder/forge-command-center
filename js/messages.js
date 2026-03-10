// js/messages.js — Sendblue DM conversations tab
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe, escapeHtml, formatRelativeTime,
  debounce, $, $$, showToast
} from './app.js';

// ── State ────────────────────────────────────────────────────────────
let conversations = [];       // grouped by phone number
let activeConversation = null; // phone number of selected convo
let messages = [];             // messages for active conversation
let loading = false;
let searchQuery = '';
let sendingMessage = false;

// ── API Helpers ─────────────────────────────────────────────────────

async function fetchMessages(number, limit = 50, offset = 0) {
  const params = new URLSearchParams({ limit, offset });
  if (number) params.set('number', number);
  const res = await fetch(`/api/sendblue-messages?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchContacts() {
  const res = await fetch('/api/sendblue-messages?action=contacts');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sendMessage(number, content) {
  const res = await fetch('/api/sendblue-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, content }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Send failed');
  }
  return res.json();
}

// ── Build Conversation List from Messages ───────────────────────────

function buildConversations(allMessages) {
  const map = new Map();

  for (const msg of allMessages) {
    // Determine the contact number (the other person)
    const contactNumber = msg.is_outbound ? msg.to_number : msg.from_number;
    if (!contactNumber) continue;

    // Use date_updated as primary (date_sent is epoch for inbound)
    const msgDate = msg.date_updated || msg.date_sent;

    if (!map.has(contactNumber)) {
      map.set(contactNumber, {
        number: contactNumber,
        name: msg.contact_name || null,
        lastMessage: msg.content || (msg.media_url ? '[Media]' : ''),
        lastDate: msgDate,
        isOutbound: msg.is_outbound,
        service: msg.service,
        unread: 0,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const da = new Date(a.lastDate || 0);
    const db = new Date(b.lastDate || 0);
    return db - da;
  });
}

// ── Render ───────────────────────────────────────────────────────────

function formatPhone(number) {
  if (!number) return '';
  // Format US numbers nicely
  const clean = number.replace(/[^\d+]/g, '');
  if (clean.length === 12 && clean.startsWith('+1')) {
    return `(${clean.slice(2, 5)}) ${clean.slice(5, 8)}-${clean.slice(8)}`;
  }
  return number;
}

function renderContainer() {
  const container = document.getElementById('messagesContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="messages-layout">
      <div class="messages-sidebar">
        <div class="messages-sidebar-header">
          <h2>Messages</h2>
          <button class="btn btn-ghost btn-sm" id="msgRefreshBtn" title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
        <div class="messages-search">
          <input type="text" id="msgSearchInput" placeholder="Search conversations..." autocomplete="off" />
        </div>
        <div class="messages-list" id="msgConvoList">
          <div class="messages-empty-state">Loading conversations...</div>
        </div>
      </div>
      <div class="messages-thread" id="msgThread">
        <div class="messages-thread-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <p>Select a conversation to view messages</p>
        </div>
      </div>
    </div>
  `;

  // Event listeners
  document.getElementById('msgRefreshBtn')?.addEventListener('click', loadAllMessages);
  document.getElementById('msgSearchInput')?.addEventListener('input', debounce((e) => {
    searchQuery = e.target.value.toLowerCase();
    renderConversationList();
  }, 200));
}

function renderConversationList() {
  const list = document.getElementById('msgConvoList');
  if (!list) return;

  let filtered = conversations;
  if (searchQuery) {
    filtered = conversations.filter(c =>
      (c.name || '').toLowerCase().includes(searchQuery) ||
      (c.number || '').includes(searchQuery) ||
      (c.lastMessage || '').toLowerCase().includes(searchQuery)
    );
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="messages-empty-state">${loading ? 'Loading...' : 'No conversations found'}</div>`;
    return;
  }

  list.innerHTML = filtered.map(c => `
    <button class="msg-convo-item ${activeConversation === c.number ? 'is-active' : ''}"
            data-number="${escapeHtml(c.number)}">
      <div class="msg-convo-avatar">${(c.name || c.number || '?').charAt(0).toUpperCase()}</div>
      <div class="msg-convo-info">
        <div class="msg-convo-top">
          <span class="msg-convo-name">${escapeHtml(c.name || formatPhone(c.number))}</span>
          <span class="msg-convo-time">${formatRelativeTime(c.lastDate)}</span>
        </div>
        <div class="msg-convo-preview">
          ${c.isOutbound ? '<span class="msg-you">You: </span>' : ''}${escapeHtml((c.lastMessage || '').substring(0, 60))}
        </div>
      </div>
      ${c.service ? `<span class="msg-service-badge msg-service-${c.service?.toLowerCase()}">${c.service === 'iMessage' ? 'iM' : 'SMS'}</span>` : ''}
    </button>
  `).join('');

  // Click handlers
  list.querySelectorAll('.msg-convo-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const num = btn.dataset.number;
      selectConversation(num);
    });
  });
}

function renderThread() {
  const thread = document.getElementById('msgThread');
  if (!thread || !activeConversation) return;

  const convo = conversations.find(c => c.number === activeConversation);
  const displayName = convo?.name || formatPhone(activeConversation);

  thread.innerHTML = `
    <div class="msg-thread-header">
      <button class="btn-icon msg-back-btn" id="msgBackBtn" title="Back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="msg-thread-contact">
        <span class="msg-thread-name">${escapeHtml(displayName)}</span>
        <span class="msg-thread-number">${escapeHtml(formatPhone(activeConversation))}</span>
      </div>
    </div>
    <div class="msg-thread-messages" id="msgThreadMessages">
      ${loading ? '<div class="messages-empty-state">Loading messages...</div>' : renderMessages()}
    </div>
    <div class="msg-compose">
      <textarea id="msgComposeInput" placeholder="Type a message..." rows="1"></textarea>
      <button class="btn btn-primary btn-sm" id="msgSendBtn" ${sendingMessage ? 'disabled' : ''}>
        ${sendingMessage ? 'Sending...' : 'Send'}
      </button>
    </div>
  `;

  // Scroll to bottom
  const msgContainer = document.getElementById('msgThreadMessages');
  if (msgContainer) {
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  // Event listeners
  document.getElementById('msgBackBtn')?.addEventListener('click', () => {
    activeConversation = null;
    renderContainer();
    renderConversationList();
  });

  const input = document.getElementById('msgComposeInput');
  const sendBtn = document.getElementById('msgSendBtn');

  // Auto-resize textarea
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // Send on Enter (Shift+Enter for newline)
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn?.addEventListener('click', handleSend);
}

function renderMessages() {
  if (messages.length === 0) {
    return '<div class="messages-empty-state">No messages yet</div>';
  }

  // Messages come in desc order from API, reverse for display
  const sorted = [...messages].sort((a, b) =>
    new Date(a.date_sent || a.created_at) - new Date(b.date_sent || b.created_at)
  );

  let lastDate = '';

  return sorted.map(msg => {
    const msgDate = new Date(msg.date_updated || msg.date_sent);
    const dateStr = msgDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = msgDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    let dateDivider = '';
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      dateDivider = `<div class="msg-date-divider"><span>${dateStr}</span></div>`;
    }

    const direction = msg.is_outbound ? 'outbound' : 'inbound';
    const mediaHtml = msg.media_url
      ? `<div class="msg-media"><img src="${escapeHtml(msg.media_url)}" alt="Media" loading="lazy" /></div>`
      : '';

    return `
      ${dateDivider}
      <div class="msg-bubble msg-${direction}">
        ${mediaHtml}
        ${msg.content ? `<div class="msg-text">${escapeHtml(msg.content)}</div>` : ''}
        <div class="msg-meta">
          <span class="msg-time">${timeStr}</span>
          ${msg.is_outbound && msg.status ? `<span class="msg-status msg-status-${msg.status}">${msg.status}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ── Actions ──────────────────────────────────────────────────────────

async function loadAllMessages() {
  loading = true;
  renderConversationList();

  try {
    const data = await fetchMessages(null, 100, 0);
    const allMsgs = data.messages || data || [];
    conversations = buildConversations(allMsgs);
    loading = false;
    renderConversationList();
  } catch (err) {
    loading = false;
    console.error('[messages] Failed to load:', err);
    showToast('Failed to load messages: ' + err.message, 'error');
    renderConversationList();
  }
}

async function selectConversation(number) {
  activeConversation = number;
  loading = true;
  renderConversationList();
  renderThread();

  try {
    const data = await fetchMessages(number, 100, 0);
    messages = data.messages || data || [];
    loading = false;
    renderThread();
  } catch (err) {
    loading = false;
    console.error('[messages] Failed to load thread:', err);
    showToast('Failed to load conversation', 'error');
    renderThread();
  }
}

async function handleSend() {
  const input = document.getElementById('msgComposeInput');
  const content = input?.value?.trim();
  if (!content || !activeConversation || sendingMessage) return;

  sendingMessage = true;
  renderThread();

  try {
    await sendMessage(activeConversation, content);

    // Add optimistic message to local list
    messages.push({
      content,
      is_outbound: true,
      date_sent: new Date().toISOString(),
      status: 'QUEUED',
      from_number: null,
      to_number: activeConversation,
    });

    // Update conversation preview
    const convo = conversations.find(c => c.number === activeConversation);
    if (convo) {
      convo.lastMessage = content;
      convo.lastDate = new Date().toISOString();
      convo.isOutbound = true;
    }

    sendingMessage = false;
    renderThread();
    renderConversationList();
    showToast('Message sent', 'success');
  } catch (err) {
    sendingMessage = false;
    renderThread();
    showToast('Failed to send: ' + err.message, 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────────────

export function initMessages() {
  // Render happens on tab visit
}

export function loadMessageData() {
  const container = document.getElementById('messagesContainer');
  if (!container) return;

  renderContainer();
  loadAllMessages();
}
