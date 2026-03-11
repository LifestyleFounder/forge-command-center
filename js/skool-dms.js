// js/skool-dms.js — Skool DM conversations tab
// ──────────────────────────────────────────────────────────────────────

import {
  escapeHtml, formatRelativeTime, debounce, $, $$, showToast
} from './app.js';

// ── State ────────────────────────────────────────────────────────────
let conversations = [];
let activeConversation = null; // channel ID
let activeConvoData = null;   // full conversation object
let messages = [];
let loading = false;
let searchQuery = '';
let sendingMessage = false;
let filter = 'all'; // 'all' or 'unread'
let refreshTimer = null;
const REFRESH_INTERVAL = 30000; // 30 seconds

const MY_USER_ID = '536462bbe1d54558aeac575be267e7bc';

// ── API Helpers ─────────────────────────────────────────────────────

async function fetchConversations(filterType, search) {
  const params = new URLSearchParams();
  if (filterType === 'unread') params.set('filter', 'unread');
  if (search) params.set('search', search);
  const res = await fetch(`/api/skool-conversations?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchMessages(channelId) {
  const res = await fetch(`/api/skool-messages?channel_id=${encodeURIComponent(channelId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sendMessageAPI(channelId, content) {
  const res = await fetch('/api/skool-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_id: channelId, content }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Send failed');
  }
  return res.json();
}

// ── Render ───────────────────────────────────────────────────────────

function renderContainer() {
  const container = document.getElementById('skoolDmsContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="skdm-layout ${activeConversation ? 'has-active-convo' : ''}">
      <div class="skdm-sidebar">
        <div class="skdm-sidebar-header">
          <h2>Skool DMs</h2>
          <button class="btn btn-ghost btn-sm" id="skdmRefreshBtn" title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
        <div class="skdm-filters">
          <button class="skdm-filter-btn ${filter === 'all' ? 'is-active' : ''}" data-filter="all">All</button>
          <button class="skdm-filter-btn ${filter === 'unread' ? 'is-active' : ''}" data-filter="unread">Unread</button>
        </div>
        <div class="skdm-search">
          <input type="text" id="skdmSearchInput" placeholder="Search conversations..." autocomplete="off" value="${escapeHtml(searchQuery)}" />
        </div>
        <div class="skdm-list" id="skdmConvoList">
          <div class="skdm-empty-state">Loading conversations...</div>
        </div>
      </div>
      <div class="skdm-thread" id="skdmThread">
        <div class="skdm-thread-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <p>Select a conversation to view messages</p>
        </div>
      </div>
    </div>
  `;

  // Event listeners
  document.getElementById('skdmRefreshBtn')?.addEventListener('click', () => loadConversations());

  document.querySelectorAll('.skdm-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      document.querySelectorAll('.skdm-filter-btn').forEach(b => b.classList.toggle('is-active', b.dataset.filter === filter));
      loadConversations();
    });
  });

  document.getElementById('skdmSearchInput')?.addEventListener('input', debounce((e) => {
    searchQuery = e.target.value.trim();
    loadConversations();
  }, 300));
}

function renderConversationList() {
  const list = document.getElementById('skdmConvoList');
  if (!list) return;

  if (conversations.length === 0) {
    list.innerHTML = `<div class="skdm-empty-state">${loading ? 'Loading...' : 'No conversations found'}</div>`;
    return;
  }

  list.innerHTML = conversations.map(c => {
    const name = c.other_user_name || `${c.other_user_first || ''} ${c.other_user_last || ''}`.trim() || 'Unknown';
    const initial = name.charAt(0).toUpperCase();
    const pic = c.other_user_pic;
    const isActive = activeConversation === c.id;
    const isUnread = c.is_unread;
    const preview = c.last_message_content || '';
    const isFromMe = c.last_message_from === 'me';

    return `
      <button class="skdm-convo-item ${isActive ? 'is-active' : ''} ${isUnread ? 'is-unread' : ''}"
              data-id="${escapeHtml(c.id)}">
        <div class="skdm-convo-avatar">
          ${pic ? `<img src="${escapeHtml(pic)}" alt="" />` : `<span>${initial}</span>`}
        </div>
        <div class="skdm-convo-info">
          <div class="skdm-convo-top">
            <span class="skdm-convo-name">${escapeHtml(name)}</span>
            <span class="skdm-convo-time">${formatRelativeTime(c.last_message_at)}</span>
          </div>
          <div class="skdm-convo-preview">
            ${isFromMe ? '<span class="skdm-you">You: </span>' : ''}${escapeHtml(preview.substring(0, 80))}
          </div>
        </div>
        ${isUnread ? '<span class="skdm-unread-dot"></span>' : ''}
      </button>
    `;
  }).join('');

  list.querySelectorAll('.skdm-convo-item').forEach(btn => {
    btn.addEventListener('click', () => selectConversation(btn.dataset.id));
  });
}

function renderThread() {
  const thread = document.getElementById('skdmThread');
  if (!thread || !activeConversation || !activeConvoData) return;

  const name = activeConvoData.other_user_name || `${activeConvoData.other_user_first || ''} ${activeConvoData.other_user_last || ''}`.trim() || 'Unknown';
  const pic = activeConvoData.other_user_pic;
  const initial = name.charAt(0).toUpperCase();

  thread.innerHTML = `
    <div class="skdm-thread-header">
      <button class="btn-icon skdm-back-btn" id="skdmBackBtn" title="Back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="skdm-thread-avatar">
        ${pic ? `<img src="${escapeHtml(pic)}" alt="" />` : `<span>${initial}</span>`}
      </div>
      <div class="skdm-thread-contact">
        <span class="skdm-thread-name">${escapeHtml(name)}</span>
        ${activeConvoData.other_user_bio ? `<span class="skdm-thread-bio">${escapeHtml(activeConvoData.other_user_bio.substring(0, 60))}</span>` : ''}
      </div>
    </div>
    <div class="skdm-thread-messages" id="skdmThreadMessages">
      ${loading ? '<div class="skdm-empty-state">Loading messages...</div>' : renderMessages()}
    </div>
    <div class="skdm-compose">
      <textarea id="skdmComposeInput" placeholder="Type a message..." rows="1"></textarea>
      <button class="btn btn-primary btn-sm" id="skdmSendBtn" ${sendingMessage ? 'disabled' : ''}>
        ${sendingMessage ? '...' : 'Send'}
      </button>
    </div>
  `;

  // Scroll to bottom
  const msgContainer = document.getElementById('skdmThreadMessages');
  if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;

  // Back button (mobile)
  document.getElementById('skdmBackBtn')?.addEventListener('click', () => {
    stopAutoRefresh();
    activeConversation = null;
    activeConvoData = null;
    renderContainer();
    renderConversationList();
  });

  // Compose
  const input = document.getElementById('skdmComposeInput');
  const sendBtn = document.getElementById('skdmSendBtn');

  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

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
    return '<div class="skdm-empty-state">No messages yet</div>';
  }

  let lastDate = '';

  return messages.map(msg => {
    const msgDate = new Date(msg.created_at);
    const dateStr = msgDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = msgDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    let dateDivider = '';
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      dateDivider = `<div class="skdm-date-divider"><span>${dateStr}</span></div>`;
    }

    const isMe = msg.sender_id === MY_USER_ID;
    const direction = isMe ? 'outbound' : 'inbound';
    const isPending = msg.status === 'pending';

    return `
      ${dateDivider}
      <div class="skdm-bubble skdm-${direction} ${isPending ? 'skdm-pending' : ''}">
        ${msg.content ? `<div class="skdm-text">${escapeHtml(msg.content)}</div>` : ''}
        <div class="skdm-meta">
          <span class="skdm-time">${timeStr}</span>
          ${isPending ? '<span class="skdm-status">sending...</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ── Actions ──────────────────────────────────────────────────────────

async function loadConversations() {
  loading = true;
  renderConversationList();

  try {
    const data = await fetchConversations(filter, searchQuery);
    conversations = data.conversations || [];
    loading = false;
    renderConversationList();
  } catch (err) {
    loading = false;
    console.error('[skool-dms] Failed to load:', err);
    showToast('Failed to load Skool conversations: ' + err.message, 'error');
    renderConversationList();
  }
}

async function selectConversation(channelId) {
  stopAutoRefresh();
  activeConversation = channelId;
  activeConvoData = conversations.find(c => c.id === channelId) || null;
  loading = true;

  // Update layout class
  const layout = document.querySelector('.skdm-layout');
  if (layout) layout.classList.add('has-active-convo');

  renderConversationList();
  renderThread();

  try {
    const data = await fetchMessages(channelId);
    messages = data.messages || [];
    loading = false;
    renderThread();
    startAutoRefresh(channelId);
  } catch (err) {
    loading = false;
    console.error('[skool-dms] Failed to load thread:', err);
    showToast('Failed to load messages', 'error');
    renderThread();
  }
}

function startAutoRefresh(channelId) {
  stopAutoRefresh();
  refreshTimer = setInterval(async () => {
    if (activeConversation !== channelId) { stopAutoRefresh(); return; }
    try {
      const data = await fetchMessages(channelId);
      const newMsgs = data.messages || [];
      // Only re-render if message count changed (new messages arrived)
      if (newMsgs.length !== messages.length) {
        messages = newMsgs;
        renderThread();
      }
      // Also refresh conversation list for unread badges
      const convoData = await fetchConversations(filter, searchQuery);
      conversations = convoData.conversations || [];
      renderConversationList();
    } catch (err) {
      // Silent fail on auto-refresh
    }
  }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function handleSend() {
  const input = document.getElementById('skdmComposeInput');
  const content = input?.value?.trim();
  if (!content || !activeConversation || sendingMessage) return;

  sendingMessage = true;
  renderThread();

  try {
    await sendMessageAPI(activeConversation, content);

    // Add to local messages immediately
    messages.push({
      id: `pending_${Date.now()}`,
      channel_id: activeConversation,
      sender_id: MY_USER_ID,
      sender_name: 'Dan Harrison',
      content,
      created_at: new Date().toISOString(),
      status: 'pending',
    });

    // Update conversation preview
    const convo = conversations.find(c => c.id === activeConversation);
    if (convo) {
      convo.last_message_content = content;
      convo.last_message_from = 'me';
      convo.last_message_at = new Date().toISOString();
    }

    sendingMessage = false;
    renderThread();
    renderConversationList();
    showToast('Message queued', 'success');
  } catch (err) {
    sendingMessage = false;
    renderThread();
    showToast('Failed to send: ' + err.message, 'error');
  }
}

// ── Init ─────────────────────────────────────────────────────────────

export function initSkoolDms() {
  // Render happens on tab visit
}

export function loadSkoolDmData() {
  const container = document.getElementById('skoolDmsContainer');
  if (!container) return;

  renderContainer();
  loadConversations();
}
