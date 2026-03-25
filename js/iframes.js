// js/iframes.js — Lazy-loaded iframe tabs
// ──────────────────────────────────────────────────────────────────────

import { $, subscribe } from './app.js';

const IFRAMES = {
  'lfg-os': {
    url: 'https://lfg-os.vercel.app/',
    title: 'LFG-OS',
  },
  'performance-tracker': {
    url: 'https://lfgperformancetracker.lovable.app/auth',
    title: 'Performance Tracker',
  },
  'content-multiplier': {
    url: 'https://lfg-multiplier.vercel.app',
    title: 'Content Multiplier',
  },
  'google-calendar': {
    url: 'https://calendar.google.com/calendar/embed?src=dan%40quantumcollective.com&ctz=America%2FVancouver&mode=WEEK&showTitle=0&showNav=1&showPrint=0&showTabs=1&showCalendars=0&showTz=0',
    title: 'Google Calendar',
  },
};

const loaded = new Set();
const STORAGE_KEY = 'forge-calendar-height';

export function initIframes() {
  // Listen for tab switches to lazy-load iframes
  subscribe((key, value) => {
    if (key !== 'ui') return;
  });

  // Set up lazy loading via IntersectionObserver
  Object.keys(IFRAMES).forEach(id => {
    const container = $(`#iframe-${id}`);
    if (!container) return;

    // Add loading skeleton
    container.innerHTML = `
      <div class="iframe-loading" id="iframe-loading-${id}">
        <div class="spinner"></div>
        <span>Loading ${IFRAMES[id].title}...</span>
      </div>
    `;
  });

  // Add resize handle to calendar iframe container
  initCalendarResize();
}

function initCalendarResize() {
  const container = $('#iframe-google-calendar');
  if (!container) return;

  // Restore saved height
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) container.style.height = saved + 'px';

  // Create resize handle
  const handle = document.createElement('div');
  handle.className = 'calendar-resize-handle';
  handle.title = 'Drag to resize';
  container.appendChild(handle);

  let startY, startH;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = container.offsetHeight;
    handle.classList.add('dragging');
    container.classList.add('resizing');
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', onRelease);
  });

  handle.addEventListener('touchstart', (e) => {
    startY = e.touches[0].clientY;
    startH = container.offsetHeight;
    handle.classList.add('dragging');
    container.classList.add('resizing');
    document.addEventListener('touchmove', onTouchDrag, { passive: false });
    document.addEventListener('touchend', onRelease);
  });

  function onDrag(e) {
    const h = Math.max(300, startH + (e.clientY - startY));
    container.style.height = h + 'px';
  }

  function onTouchDrag(e) {
    e.preventDefault();
    const h = Math.max(300, startH + (e.touches[0].clientY - startY));
    container.style.height = h + 'px';
  }

  function onRelease() {
    handle.classList.remove('dragging');
    container.classList.remove('resizing');
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', onRelease);
    document.removeEventListener('touchmove', onTouchDrag);
    document.removeEventListener('touchend', onRelease);
    localStorage.setItem(STORAGE_KEY, container.offsetHeight);
  }

  // Double-click to reset to default
  handle.addEventListener('dblclick', () => {
    container.style.height = '';
    localStorage.removeItem(STORAGE_KEY);
  });
}

export function loadIframe(id) {
  if (loaded.has(id)) return;
  const config = IFRAMES[id];
  if (!config) return;

  const container = $(`#iframe-${id}`);
  if (!container) return;

  loaded.add(id);

  const iframe = document.createElement('iframe');
  iframe.src = config.url;
  iframe.title = config.title;
  iframe.loading = 'lazy';
  iframe.className = 'iframe-embed';
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write');

  iframe.addEventListener('load', () => {
    const loading = $(`#iframe-loading-${id}`);
    if (loading) loading.remove();
  });

  container.appendChild(iframe);
}
