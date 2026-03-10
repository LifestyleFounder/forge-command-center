// js/messages.js — Sendblue DM conversations tab
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe, escapeHtml, formatRelativeTime,
  formatDate, debounce, $, $$, showToast
} from './app.js';
import { attachVoiceInput } from './voice-input.js';

// ── State ────────────────────────────────────────────────────────────
let conversations = [];       // grouped by phone number
let activeConversation = null; // phone number of selected convo
let messages = [];             // messages for active conversation
let loading = false;
let searchQuery = '';
let sendingMessage = false;
let contactMap = new Map();    // phone → { name, email, tags, ... }
let contactsLoaded = false;
let contactPanelOpen = false;
let isRecordingVoice = false;
let mediaRecorder = null;
let audioChunks = [];

// ── API Helpers ─────────────────────────────────────────────────────

async function fetchMessages(number, limit = 50, offset = 0) {
  const params = new URLSearchParams({ limit, offset });
  if (number) params.set('number', number);
  const res = await fetch(`/api/sendblue-messages?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sendMessageAPI(number, content, media_url) {
  const body = { number };
  if (content) body.content = content;
  if (media_url) body.media_url = media_url;
  const res = await fetch('/api/sendblue-send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Send failed');
  }
  return res.json();
}

async function uploadVoiceNote(blob) {
  const res = await fetch('/api/sendblue-upload', {
    method: 'POST',
    body: blob,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

async function fetchSendblueContacts() {
  if (contactsLoaded) return;
  try {
    const res = await fetch('/api/sendblue-messages?action=contacts');
    if (!res.ok) return;
    const data = await res.json();
    const contacts = data.contacts || [];
    for (const c of contacts) {
      if (c.phone) {
        const normalized = normalizePhone(c.phone);
        const name = [c.first_name || c.firstName, c.last_name || c.lastName]
          .filter(Boolean).join(' ').trim();
        contactMap.set(normalized, {
          name: name || null,
          phone: c.phone,
          tags: c.tags || [],
          sendblueNumber: c.sendblue_number || c.sendblueNumber,
          createdAt: c.created_at,
          source: 'sendblue',
        });
      }
    }
    contactsLoaded = true;
    console.log(`[messages] Loaded ${contacts.length} Sendblue contacts`);
  } catch (err) {
    console.warn('[messages] Failed to load Sendblue contacts:', err);
  }
}

function lookupContact(phone) {
  const normalized = normalizePhone(phone);
  return contactMap.get(normalized) || null;
}

function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[^\d+]/g, '');
}

function getContactName(phone) {
  const normalized = normalizePhone(phone);
  const contact = contactMap.get(normalized);
  return contact?.name || null;
}

// ── Build Conversation List from Messages ───────────────────────────

function buildConversations(allMessages) {
  const map = new Map();

  for (const msg of allMessages) {
    const contactNumber = msg.is_outbound ? msg.to_number : msg.from_number;
    if (!contactNumber) continue;

    const msgDate = msg.date_updated || msg.date_sent;

    if (!map.has(contactNumber)) {
      map.set(contactNumber, {
        number: contactNumber,
        name: getContactName(contactNumber),
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
  const clean = number.replace(/[^\d+]/g, '');
  if (clean.length === 12 && clean.startsWith('+1')) {
    return `(${clean.slice(2, 5)}) ${clean.slice(5, 8)}-${clean.slice(8)}`;
  }
  return number;
}

function getDisplayName(number) {
  return getContactName(number) || formatPhone(number);
}

function renderContainer() {
  const container = document.getElementById('messagesContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="messages-layout ${activeConversation ? 'has-active-convo' : ''} ${contactPanelOpen ? 'has-contact-panel' : ''}">
      <div class="messages-sidebar">
        <div class="messages-sidebar-header">
          <h2>Messages</h2>
          <button class="btn btn-ghost btn-sm" id="msgRefreshBtn" title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
        </div>
        <div class="messages-search">
          <input type="text" id="msgSearchInput" placeholder="Search conversations..." autocomplete="off" value="${escapeHtml(searchQuery)}" />
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
      <div class="messages-contact-panel" id="msgContactPanel"></div>
    </div>
  `;

  document.getElementById('msgRefreshBtn')?.addEventListener('click', () => {
    contactsLoaded = false;
    contactMap.clear();
    loadAllMessages();
  });
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

  list.innerHTML = filtered.map(c => {
    const name = c.name || getContactName(c.number) || formatPhone(c.number);
    const initial = (name || c.number || '?').charAt(0).toUpperCase();
    const isLetter = /[A-Z]/.test(initial);

    return `
      <button class="msg-convo-item ${activeConversation === c.number ? 'is-active' : ''}"
              data-number="${escapeHtml(c.number)}">
        <div class="msg-convo-avatar ${isLetter ? '' : 'msg-convo-avatar-num'}">${initial}</div>
        <div class="msg-convo-info">
          <div class="msg-convo-top">
            <span class="msg-convo-name">${escapeHtml(name)}</span>
            <span class="msg-convo-time">${formatRelativeTime(c.lastDate)}</span>
          </div>
          <div class="msg-convo-preview">
            ${c.isOutbound ? '<span class="msg-you">You: </span>' : ''}${escapeHtml((c.lastMessage || '').substring(0, 60))}
          </div>
        </div>
        ${c.service ? `<span class="msg-service-badge msg-service-${c.service?.toLowerCase()}">${c.service === 'iMessage' ? 'iM' : 'SMS'}</span>` : ''}
      </button>
    `;
  }).join('');

  list.querySelectorAll('.msg-convo-item').forEach(btn => {
    btn.addEventListener('click', () => selectConversation(btn.dataset.number));
  });
}

function renderThread() {
  const thread = document.getElementById('msgThread');
  if (!thread || !activeConversation) return;

  const displayName = getDisplayName(activeConversation);

  thread.innerHTML = `
    <div class="msg-thread-header">
      <button class="btn-icon msg-back-btn" id="msgBackBtn" title="Back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="msg-thread-contact" id="msgThreadContactClick">
        <span class="msg-thread-name">${escapeHtml(displayName)}</span>
        <span class="msg-thread-number">${escapeHtml(formatPhone(activeConversation))}</span>
      </div>
      <button class="btn-icon msg-info-btn" id="msgInfoBtn" title="Contact info">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </button>
    </div>
    <div class="msg-thread-messages" id="msgThreadMessages">
      ${loading ? '<div class="messages-empty-state">Loading messages...</div>' : renderMessages()}
    </div>
    <div class="msg-compose">
      <button class="btn-icon msg-voice-btn ${isRecordingVoice ? 'is-recording' : ''}" id="msgVoiceBtn" title="${isRecordingVoice ? 'Stop recording' : 'Record voice note'}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      </button>
      <textarea id="msgComposeInput" placeholder="Type a message..." rows="1"></textarea>
      <button class="btn btn-primary btn-sm" id="msgSendBtn" ${sendingMessage ? 'disabled' : ''}>
        ${sendingMessage ? 'Sending...' : 'Send'}
      </button>
    </div>
  `;

  // Scroll to bottom
  const msgContainer = document.getElementById('msgThreadMessages');
  if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;

  // Back button
  document.getElementById('msgBackBtn')?.addEventListener('click', () => {
    activeConversation = null;
    contactPanelOpen = false;
    renderContainer();
    renderConversationList();
  });

  // Contact info toggle
  document.getElementById('msgInfoBtn')?.addEventListener('click', toggleContactPanel);
  document.getElementById('msgThreadContactClick')?.addEventListener('click', toggleContactPanel);

  // Compose
  const input = document.getElementById('msgComposeInput');
  const sendBtn = document.getElementById('msgSendBtn');

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

  // Voice note
  document.getElementById('msgVoiceBtn')?.addEventListener('click', handleVoiceToggle);

  // Render contact panel if open
  if (contactPanelOpen) renderContactPanel();
}

function renderMessages() {
  if (messages.length === 0) {
    return '<div class="messages-empty-state">No messages yet</div>';
  }

  const sorted = [...messages].sort((a, b) => {
    const da = new Date(a.date_updated || a.date_sent);
    const db = new Date(b.date_updated || b.date_sent);
    return da - db;
  });

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

    let mediaHtml = '';
    if (msg.media_url) {
      const url = escapeHtml(msg.media_url);
      if (/\.(m4a|caf|mp3|ogg|wav|aac)/i.test(msg.media_url)) {
        mediaHtml = `<div class="msg-media"><audio controls preload="none" src="${url}"></audio></div>`;
      } else {
        mediaHtml = `<div class="msg-media"><img src="${url}" alt="Media" loading="lazy" /></div>`;
      }
    }

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

// ── Contact Panel ────────────────────────────────────────────────────

function toggleContactPanel() {
  contactPanelOpen = !contactPanelOpen;
  const layout = document.querySelector('.messages-layout');
  if (layout) layout.classList.toggle('has-contact-panel', contactPanelOpen);
  if (contactPanelOpen) {
    renderContactPanel();
  } else {
    const panel = document.getElementById('msgContactPanel');
    if (panel) panel.innerHTML = '';
  }
}

function renderContactPanel() {
  const panel = document.getElementById('msgContactPanel');
  if (!panel || !activeConversation) return;

  const contact = lookupContact(activeConversation);
  const displayName = contact?.name || formatPhone(activeConversation);
  const initial = (displayName || '?').charAt(0).toUpperCase();

  // Message stats
  const totalMessages = messages.length;
  const inbound = messages.filter(m => !m.is_outbound).length;
  const outbound = messages.filter(m => m.is_outbound).length;
  const firstMsg = messages.length ? messages.reduce((a, b) => {
    const da = new Date(a.date_updated || a.date_sent);
    const db = new Date(b.date_updated || b.date_sent);
    return da < db ? a : b;
  }) : null;
  const firstDate = firstMsg ? new Date(firstMsg.date_updated || firstMsg.date_sent).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '--';
  const contactSince = contact?.createdAt ? new Date(contact.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

  panel.innerHTML = `
    <div class="msg-cp-header">
      <h3>Contact Info</h3>
      <button class="btn-icon" id="msgCpClose" title="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="msg-cp-body">
      <div class="msg-cp-avatar">${initial}</div>
      <div class="msg-cp-name">${escapeHtml(displayName)}</div>
      <div class="msg-cp-phone">${escapeHtml(formatPhone(activeConversation))}</div>

      ${contact ? `
        <div class="msg-cp-section">
          <div class="msg-cp-label">Details</div>
          <div class="msg-cp-row"><span class="msg-cp-row-label">Phone</span><span class="msg-cp-row-value">${escapeHtml(contact.phone)}</span></div>
          ${contact.sendblueNumber ? `<div class="msg-cp-row"><span class="msg-cp-row-label">Your line</span><span class="msg-cp-row-value">${escapeHtml(formatPhone(contact.sendblueNumber))}</span></div>` : ''}
          ${contactSince ? `<div class="msg-cp-row"><span class="msg-cp-row-label">Contact since</span><span class="msg-cp-row-value">${contactSince}</span></div>` : ''}
        </div>
        ${contact.tags?.length ? `
          <div class="msg-cp-section">
            <div class="msg-cp-label">Tags</div>
            <div class="msg-cp-tags">${contact.tags.map(t => `<span class="msg-cp-tag">${escapeHtml(t)}</span>`).join('')}</div>
          </div>
        ` : ''}
      ` : `
        <div class="msg-cp-section">
          <div class="msg-cp-no-data">No contact info found in Sendblue</div>
        </div>
      `}

      <div class="msg-cp-section">
        <div class="msg-cp-label">Conversation</div>
        <div class="msg-cp-row"><span class="msg-cp-row-label">Total messages</span><span class="msg-cp-row-value">${totalMessages}</span></div>
        <div class="msg-cp-row"><span class="msg-cp-row-label">From them</span><span class="msg-cp-row-value">${inbound}</span></div>
        <div class="msg-cp-row"><span class="msg-cp-row-label">From you</span><span class="msg-cp-row-value">${outbound}</span></div>
        <div class="msg-cp-row"><span class="msg-cp-row-label">First message</span><span class="msg-cp-row-value">${firstDate}</span></div>
      </div>
    </div>
  `;

  panel.querySelector('#msgCpClose')?.addEventListener('click', toggleContactPanel);
}

// ── Voice Notes ──────────────────────────────────────────────────────

async function handleVoiceToggle() {
  if (isRecordingVoice) {
    stopRecording();
  } else {
    startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];

    // Try to record in m4a-compatible format, fallback to webm
    const mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
      : MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      if (blob.size > 0) {
        await sendVoiceNote(blob);
      }
    };

    mediaRecorder.start();
    isRecordingVoice = true;
    updateVoiceButton();
    showToast('Recording... tap mic to stop', 'info');
  } catch (err) {
    showToast('Microphone access denied', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecordingVoice = false;
  updateVoiceButton();
}

function updateVoiceButton() {
  const btn = document.getElementById('msgVoiceBtn');
  if (btn) {
    btn.classList.toggle('is-recording', isRecordingVoice);
    btn.title = isRecordingVoice ? 'Stop recording' : 'Record voice note';
  }
}

async function sendVoiceNote(blob) {
  if (!activeConversation) return;

  sendingMessage = true;
  renderThread();

  try {
    showToast('Uploading voice note...', 'info');
    const { url } = await uploadVoiceNote(blob);

    await sendMessageAPI(activeConversation, null, url);

    messages.push({
      content: null,
      media_url: url,
      is_outbound: true,
      date_updated: new Date().toISOString(),
      date_sent: new Date().toISOString(),
      status: 'QUEUED',
      to_number: activeConversation,
    });

    const convo = conversations.find(c => c.number === activeConversation);
    if (convo) {
      convo.lastMessage = '[Voice Note]';
      convo.lastDate = new Date().toISOString();
      convo.isOutbound = true;
    }

    sendingMessage = false;
    renderThread();
    renderConversationList();
    showToast('Voice note sent', 'success');
  } catch (err) {
    sendingMessage = false;
    renderThread();
    showToast('Failed to send voice note: ' + err.message, 'error');
  }
}

// ── Actions ──────────────────────────────────────────────────────────

async function loadAllMessages() {
  loading = true;
  renderConversationList();

  // Start contacts loading in background (don't block messages)
  fetchSendblueContacts().then(() => {
    // Re-render with names once contacts are loaded
    conversations.forEach(c => {
      if (!c.name) c.name = getContactName(c.number);
    });
    renderConversationList();
    // Update thread header name if a convo is open
    const threadName = document.querySelector('.msg-thread-name');
    if (threadName && activeConversation) {
      threadName.textContent = getDisplayName(activeConversation);
    }
  });

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
  contactPanelOpen = false;
  loading = true;

  // Update layout class
  const layout = document.querySelector('.messages-layout');
  if (layout) {
    layout.classList.add('has-active-convo');
    layout.classList.remove('has-contact-panel');
  }

  renderConversationList();
  renderThread();

  try {
    const data = await fetchMessages(number, 100, 0);
    messages = data.messages || data || [];

    // Update conversation name now that we may have contact info
    const convo = conversations.find(c => c.number === number);
    if (convo && !convo.name) {
      convo.name = getContactName(number);
    }

    loading = false;
    renderThread();
    renderConversationList();
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
    await sendMessageAPI(activeConversation, content);

    messages.push({
      content,
      is_outbound: true,
      date_updated: new Date().toISOString(),
      date_sent: new Date().toISOString(),
      status: 'QUEUED',
      from_number: null,
      to_number: activeConversation,
    });

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
