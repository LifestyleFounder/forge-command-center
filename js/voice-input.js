// js/voice-input.js — Mobile voice-to-text via Web Speech API
// ──────────────────────────────────────────────────────────────────────

import { showToast } from './app.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

let activeRecognition = null; // only one mic at a time

/**
 * Attach voice input to a button.
 *
 * @param {Object} opts
 * @param {HTMLElement} opts.button       — the mic button element
 * @param {HTMLTextAreaElement} [opts.textarea] — textarea to insert into (mutually exclusive with editor)
 * @param {Object} [opts.editor]          — Tiptap editor instance (mutually exclusive with textarea)
 * @param {Function} [opts.getEditor]     — getter fn that returns the editor (lazy)
 */
export function attachVoiceInput({ button, textarea, editor, getEditor }) {
  if (!SpeechRecognition || !button) {
    button?.classList.add('voice-unsupported');
    return;
  }

  let recognition = null;
  let isRecording = false;

  button.addEventListener('click', () => {
    if (isRecording) {
      stop();
    } else {
      start();
    }
  });

  function start() {
    // Stop any other active mic first
    if (activeRecognition) {
      try { activeRecognition.stop(); } catch {}
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (!last.isFinal) return;
      const text = last[0].transcript;
      insertText(text);
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        showToast('Microphone access denied', 'error');
      }
      // 'no-speech' is silent — expected when user pauses
      stop();
    };

    recognition.onend = () => {
      // If still marked as recording, it ended unexpectedly (timeout, etc.)
      if (isRecording) stop();
    };

    try {
      recognition.start();
      isRecording = true;
      activeRecognition = recognition;
      button.classList.add('is-recording');
    } catch {
      showToast('Could not start microphone', 'error');
    }
  }

  function stop() {
    isRecording = false;
    button.classList.remove('is-recording');
    if (recognition) {
      try { recognition.stop(); } catch {}
      if (activeRecognition === recognition) activeRecognition = null;
      recognition = null;
    }
  }

  function insertText(text) {
    const ed = editor || (getEditor && getEditor());

    if (ed) {
      // Tiptap mode
      ed.chain().focus().insertContent(text + ' ').run();
    } else if (textarea) {
      // Textarea mode — insert at cursor
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = textarea.value.slice(0, start);
      const after = textarea.value.slice(end);
      const insert = (before.length && !before.endsWith(' ') ? ' ' : '') + text;
      textarea.value = before + insert + after;
      textarea.selectionStart = textarea.selectionEnd = start + insert.length;
      // Fire input event for auto-resize and any listeners
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
    }
  }
}
