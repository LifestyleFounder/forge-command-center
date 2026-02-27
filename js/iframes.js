// js/iframes.js — Lazy-loaded iframe tabs
// ──────────────────────────────────────────────────────────────────────

import { $, subscribe } from './app.js';

const IFRAMES = {
  'performance-tracker': {
    url: 'https://lovable.dev/projects/lfg-performance',
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
