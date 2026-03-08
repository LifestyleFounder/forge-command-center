// js/note-ai.js — Contextual AI chat inside the block editor
// ──────────────────────────────────────────────────────────────────────

import { $, escapeHtml, showToast } from './app.js';
import { getEditorInstance } from './block-editor.js';
import { attachVoiceInput } from './voice-input.js';

// ── Constants ────────────────────────────────────────────────────────
const PROXY_KEY   = 'forge-anthropic-proxy';
const DEFAULT_PROXY = 'https://anthropic-proxy.dan-a14.workers.dev';
const MODEL = 'claude-sonnet-4-20250514';

// ── State ────────────────────────────────────────────────────────────
let messages = [];  // { role, content, timestamp }
let isSending = false;
let isOpen = false;

// ── Init ─────────────────────────────────────────────────────────────
export function initNoteAi() {
  // FAB toggle
  $('#noteAiFab')?.addEventListener('click', openPanel);
  $('#noteAiClose')?.addEventListener('click', closePanel);

  // Send
  $('#noteAiSend')?.addEventListener('click', handleSend);
  $('#noteAiInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize input
  $('#noteAiInput')?.addEventListener('input', () => {
    const el = $('#noteAiInput');
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 80) + 'px';
  });

  renderEmptyState();

  // Mobile voice input
  attachVoiceInput({ button: $('#noteAiVoiceBtn'), textarea: $('#noteAiInput') });
}

// ── Panel open/close ─────────────────────────────────────────────────
function openPanel() {
  const panel = $('#noteAiPanel');
  const fab   = $('#noteAiFab');
  if (!panel) return;

  isOpen = true;
  panel.hidden = false;
  fab?.classList.add('is-hidden');

  // Reset messages for fresh context each time editor opens a new note
  messages = [];
  renderEmptyState();

  setTimeout(() => $('#noteAiInput')?.focus(), 100);
}

function closePanel() {
  const panel = $('#noteAiPanel');
  const fab   = $('#noteAiFab');
  if (!panel) return;

  isOpen = false;
  panel.hidden = true;
  fab?.classList.remove('is-hidden');
}

// ── Get note context ─────────────────────────────────────────────────
function getNoteContext() {
  const editor = getEditorInstance();
  if (!editor) return { title: '', content: '' };

  const title = $('#bePageTitle')?.value || '';
  const text = editor.getText() || '';

  return { title, content: text };
}

function buildSystemPrompt() {
  const { title, content } = getNoteContext();

  let system = `You are a helpful AI assistant embedded inside a note editor for Dan Harrison, founder of Lifestyle Founders Group.

You have full context of the note Dan is currently working on. Help him with whatever he asks — refining the content, brainstorming ideas, answering questions about what he's written, suggesting improvements, or anything else.

Be concise and direct. Use Dan's voice (casual, witty, anti-bro marketing). Format responses with markdown when helpful.`;

  if (title || content) {
    system += `\n\n---\n\n# Current Note`;
    if (title) system += `\n**Title:** ${title}`;
    if (content) {
      // Truncate very long notes to keep tokens reasonable
      const truncated = content.length > 8000
        ? content.slice(0, 8000) + '\n...[note truncated]'
        : content;
      system += `\n\n**Content:**\n${truncated}`;
    }
  }

  return system;
}

// ── Rendering ────────────────────────────────────────────────────────
function renderEmptyState() {
  const el = $('#noteAiMessages');
  if (!el) return;
  el.innerHTML = `
    <div class="note-ai-empty">
      <span class="note-ai-empty-icon">&#10024;</span>
      <span>Ask anything about this note</span>
    </div>
  `;
}

function renderMessage(msg) {
  const isUser  = msg.role === 'user';
  const classes = isUser ? 'message message-user' : 'message message-assistant';
  const content = isUser ? escapeHtml(msg.content) : formatMd(msg.content);

  return `
    <div class="${classes}">
      <div class="message-content">${content}</div>
    </div>
  `;
}

function appendMessage(msg) {
  const el = $('#noteAiMessages');
  if (!el) return;

  // Clear empty state
  const empty = el.querySelector('.note-ai-empty');
  if (empty) empty.remove();

  el.insertAdjacentHTML('beforeend', renderMessage(msg));
  el.scrollTop = el.scrollHeight;
}

function formatMd(content) {
  if (!content) return '';
  let p = escapeHtml(content);
  p = p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  p = p.replace(/\*(.+?)\*/g, '<em>$1</em>');
  p = p.replace(/`([^`]+)`/g, '<code>$1</code>');
  p = p.replace(/^- (.+)$/gm, '<li>$1</li>');
  p = p.replace(/(<li>[\s\S]*?<\/li>(?:\n|<br>)?)+/g, m => '<ul>' + m + '</ul>');
  p = p.replace(/\n/g, '<br>');
  return p;
}

// ── Send ─────────────────────────────────────────────────────────────
async function handleSend() {
  if (isSending) return;

  const input = $('#noteAiInput');
  if (!input) return;

  const text = input.value.trim();
  if (!text) return;

  const userMsg = { role: 'user', content: text };
  messages.push(userMsg);
  appendMessage(userMsg);

  input.value = '';
  input.style.height = 'auto';

  // Show typing
  isSending = true;
  const el = $('#noteAiMessages');
  if (el) {
    el.insertAdjacentHTML('beforeend',
      `<div class="message message-assistant" id="noteAiTyping">
        <div class="typing-dots"><span></span><span></span><span></span></div>
      </div>`
    );
    el.scrollTop = el.scrollHeight;
  }

  try {
    const proxyUrl = localStorage.getItem(PROXY_KEY) || DEFAULT_PROXY;
    const systemPrompt = buildSystemPrompt();

    const res = await fetch(`${proxyUrl}/anthropic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const reply = data.content?.[0]?.text || 'No response received.';

    const assistantMsg = { role: 'assistant', content: reply };
    messages.push(assistantMsg);

    // Remove typing indicator and show response
    $('#noteAiTyping')?.remove();
    appendMessage(assistantMsg);
  } catch (err) {
    console.error('[note-ai] Send failed:', err);
    $('#noteAiTyping')?.remove();
    appendMessage({
      role: 'assistant',
      content: `Sorry, something went wrong: ${err.message}`,
    });
    showToast('AI response failed', 'error');
  } finally {
    isSending = false;
  }
}
