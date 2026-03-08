// js/email.js — Email tab (Kit-inspired compose + drafts/templates/contacts + GHL)
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe, escapeHtml, generateId, formatDate,
  formatRelativeTime, formatNumber, debounce, $, $$, showToast
} from './app.js';

// ── Constants ────────────────────────────────────────────────────────
const STORAGE_KEY = 'forge-emails';

// ── State ────────────────────────────────────────────────────────────
let activeSubtab = 'compose';
let editingDraftId = null;
let editingTemplateId = null;
let campaignsLoaded = false;
let ghlTagsCache = null;
let ghlContactsCache = [];
let selectedGhlTag = '';
let ghlSearchQuery = '';
let emailCampaignChartInstance = null;
let selectedContactId = null; // GHL contact ID for sending

// ── Data Access ──────────────────────────────────────────────────────
function loadEmailData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('[email] Failed to parse stored data', e);
  }
  return { drafts: [], sent: [], templates: [], contacts: [] };
}

function saveEmailData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getVipContacts() {
  const vip = getState('vipClients');
  if (!vip || !vip.clients) return [];
  return vip.clients
    .filter(c => c.email)
    .map(c => ({ id: c.id, name: c.name, email: c.email, source: 'vip' }));
}

function getAllContacts() {
  const data = loadEmailData();
  const custom = data.contacts || [];
  const vip = getVipContacts();
  // Merge: custom contacts + VIP contacts (dedup by email)
  const seen = new Set(custom.map(c => c.email.toLowerCase()));
  const merged = [...custom];
  for (const v of vip) {
    if (!seen.has(v.email.toLowerCase())) {
      merged.push(v);
      seen.add(v.email.toLowerCase());
    }
  }
  return merged;
}

// ── GHL Data Loaders ─────────────────────────────────────────────────
async function loadCampaignData() {
  if (campaignsLoaded) return;
  campaignsLoaded = true;
  try {
    const res = await fetch('/api/ghl-email-campaigns');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    setState('emailCampaigns', data);
  } catch (err) {
    console.error('[email] Failed to load campaigns:', err);
    showToast('Failed to load email campaigns', 'error');
  }
}

async function loadGhlTags() {
  if (ghlTagsCache) return ghlTagsCache;
  try {
    const res = await fetch('/api/ghl-tags');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    ghlTagsCache = data.tags || [];
    return ghlTagsCache;
  } catch (err) {
    console.error('[email] Failed to load GHL tags:', err);
    return [];
  }
}

async function searchGhlContacts(query, tag) {
  try {
    const params = new URLSearchParams({ limit: '20' });
    if (query) params.set('query', query);
    if (tag) params.set('tag', tag);
    const res = await fetch(`/api/ghl-contacts?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.contacts || [];
  } catch (err) {
    console.error('[email] Failed to search GHL contacts:', err);
    return [];
  }
}

// Resolve an email to a GHL contact ID (for sending)
async function resolveContactId(email) {
  try {
    const contacts = await searchGhlContacts(email);
    const match = contacts.find(c => c.email.toLowerCase() === email.toLowerCase());
    return match ? match.id : null;
  } catch {
    return null;
  }
}

// ── Public init ──────────────────────────────────────────────────────
export function initEmail() {
  render();
  subscribe((key) => {
    if (key === 'emailCampaigns' && activeSubtab === 'campaigns') {
      renderSubtab();
    }
  });
}

// ── Main Render ──────────────────────────────────────────────────────
function render() {
  const container = $('#emailContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="section-header">
      <h1>Email</h1>
    </div>
    <div class="subtabs" id="emailSubtabs" role="tablist">
      <button class="subtab ${activeSubtab === 'compose' ? 'is-active' : ''}" data-email-subtab="compose" role="tab" aria-selected="${activeSubtab === 'compose'}">Compose</button>
      <button class="subtab ${activeSubtab === 'drafts' ? 'is-active' : ''}" data-email-subtab="drafts" role="tab" aria-selected="${activeSubtab === 'drafts'}">Drafts</button>
      <button class="subtab ${activeSubtab === 'sent' ? 'is-active' : ''}" data-email-subtab="sent" role="tab" aria-selected="${activeSubtab === 'sent'}">Sent</button>
      <button class="subtab ${activeSubtab === 'campaigns' ? 'is-active' : ''}" data-email-subtab="campaigns" role="tab" aria-selected="${activeSubtab === 'campaigns'}">Campaigns</button>
      <button class="subtab ${activeSubtab === 'templates' ? 'is-active' : ''}" data-email-subtab="templates" role="tab" aria-selected="${activeSubtab === 'templates'}">Templates</button>
      <button class="subtab ${activeSubtab === 'contacts' ? 'is-active' : ''}" data-email-subtab="contacts" role="tab" aria-selected="${activeSubtab === 'contacts'}">Contacts</button>
    </div>
    <div id="emailSubtabContent"></div>
  `;

  renderSubtab();
  bindEvents(container);
}

function renderSubtab() {
  const content = $('#emailSubtabContent');
  if (!content) return;

  switch (activeSubtab) {
    case 'compose': renderCompose(content); break;
    case 'drafts': renderDrafts(content); break;
    case 'sent': renderSent(content); break;
    case 'campaigns': renderCampaigns(content); break;
    case 'templates': renderTemplates(content); break;
    case 'contacts': renderContacts(content); break;
  }
}

// ── Compose View ─────────────────────────────────────────────────────
function renderCompose(container, prefill) {
  const draft = prefill || { to: '', subject: '', body: '' };
  const contacts = getAllContacts();
  selectedContactId = null;

  container.innerHTML = `
    <div class="email-compose">
      <div class="email-compose-field">
        <label class="email-field-label" for="emailTo">To</label>
        <div class="email-to-wrap">
          <input type="text" class="email-field-input" id="emailTo" placeholder="name@example.com" value="${escapeHtml(draft.to)}" autocomplete="off">
          <div class="email-autocomplete" id="emailAutocomplete" hidden></div>
        </div>
      </div>
      <div class="email-compose-field">
        <label class="email-field-label" for="emailSubject">Subject</label>
        <input type="text" class="email-field-input" id="emailSubject" placeholder="What's this about?" value="${escapeHtml(draft.subject)}">
      </div>
      <div class="email-compose-toolbar" id="emailToolbar">
        <button class="email-toolbar-btn" data-format="bold" title="Bold (Cmd+B)"><strong>B</strong></button>
        <button class="email-toolbar-btn" data-format="italic" title="Italic (Cmd+I)"><em>I</em></button>
        <button class="email-toolbar-btn" data-format="link" title="Insert Link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </button>
        <button class="email-toolbar-btn" data-format="bullet" title="Bullet List">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        </button>
      </div>
      <div class="email-compose-body">
        <textarea class="email-body-input" id="emailBody" placeholder="Write your email...">${escapeHtml(draft.body)}</textarea>
      </div>
      <div class="email-compose-actions">
        <div class="email-actions-left">
          <button class="btn btn-ghost btn-sm" id="emailSaveDraft">${editingDraftId ? 'Update Draft' : 'Save Draft'}</button>
          <button class="btn btn-ghost btn-sm" id="emailSaveTemplate">Save as Template</button>
        </div>
        <div class="email-actions-right">
          <button class="btn btn-primary btn-sm email-send-btn" id="emailSendBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send
          </button>
        </div>
      </div>
    </div>
  `;

  // Autocomplete — searches local contacts + GHL
  const toInput = $('#emailTo');
  const autocomplete = $('#emailAutocomplete');
  if (toInput && autocomplete) {
    const debouncedGhlSearch = debounce(async (q) => {
      if (q.length < 2) return;
      try {
        const ghlResults = await searchGhlContacts(q);
        // Merge with existing dropdown items (if still showing)
        if (toInput.value.toLowerCase().includes(q)) {
          const current = autocomplete.querySelectorAll('.email-ac-item');
          const existingEmails = new Set();
          current.forEach(el => existingEmails.add(el.dataset.email?.toLowerCase()));

          const newItems = ghlResults.filter(c => c.email && !existingEmails.has(c.email.toLowerCase()));
          if (newItems.length > 0) {
            const html = newItems.slice(0, 3).map(c => `
              <div class="email-ac-item" data-email="${escapeHtml(c.email)}" data-name="${escapeHtml(c.name)}" data-contact-id="${escapeHtml(c.id)}">
                <span class="email-ac-name">${escapeHtml(c.name)}</span>
                <span class="email-ac-email">${escapeHtml(c.email)} <span class="email-ac-badge">GHL</span></span>
              </div>
            `).join('');
            autocomplete.insertAdjacentHTML('beforeend', html);
            autocomplete.hidden = false;
          }
        }
      } catch { /* ignore */ }
    }, 400);

    toInput.addEventListener('input', () => {
      const q = toInput.value.toLowerCase().trim();
      selectedContactId = null;
      if (q.length < 1) { autocomplete.hidden = true; return; }

      // Local matches first
      const matches = contacts.filter(c =>
        c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
      ).slice(0, 5);

      if (matches.length === 0 && q.length < 2) { autocomplete.hidden = true; }
      else {
        autocomplete.innerHTML = matches.map(c => `
          <div class="email-ac-item" data-email="${escapeHtml(c.email)}" data-name="${escapeHtml(c.name)}">
            <span class="email-ac-name">${escapeHtml(c.name)}</span>
            <span class="email-ac-email">${escapeHtml(c.email)}</span>
          </div>
        `).join('');
        autocomplete.hidden = matches.length === 0;
      }

      // Also search GHL (debounced)
      debouncedGhlSearch(q);
    });

    autocomplete.addEventListener('click', (e) => {
      const item = e.target.closest('.email-ac-item');
      if (!item) return;
      toInput.value = item.dataset.email;
      if (item.dataset.contactId) {
        selectedContactId = item.dataset.contactId;
      }
      autocomplete.hidden = true;
      $('#emailSubject')?.focus();
    });

    toInput.addEventListener('blur', () => {
      setTimeout(() => { autocomplete.hidden = true; }, 200);
    });
  }

  // Formatting toolbar
  const toolbar = $('#emailToolbar');
  const bodyInput = $('#emailBody');
  if (toolbar && bodyInput) {
    toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-format]');
      if (!btn) return;
      const fmt = btn.dataset.format;
      applyFormat(bodyInput, fmt);
    });
  }

  // Save Draft
  const saveDraftBtn = $('#emailSaveDraft');
  if (saveDraftBtn) {
    saveDraftBtn.addEventListener('click', () => {
      const to = ($('#emailTo')?.value || '').trim();
      const subject = ($('#emailSubject')?.value || '').trim();
      const body = ($('#emailBody')?.value || '').trim();
      if (!subject && !body) {
        showToast('Add a subject or body first', 'warning');
        return;
      }
      saveDraft({ to, subject, body });
    });
  }

  // Save as Template
  const saveTemplateBtn = $('#emailSaveTemplate');
  if (saveTemplateBtn) {
    saveTemplateBtn.addEventListener('click', () => {
      const subject = ($('#emailSubject')?.value || '').trim();
      const body = ($('#emailBody')?.value || '').trim();
      if (!subject && !body) {
        showToast('Add a subject or body first', 'warning');
        return;
      }
      const name = prompt('Template name:');
      if (!name) return;
      saveTemplate({ name: name.trim(), subject, body });
    });
  }

  // Send button — now functional via GHL
  const sendBtn = $('#emailSendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      const to = ($('#emailTo')?.value || '').trim();
      const subject = ($('#emailSubject')?.value || '').trim();
      const body = ($('#emailBody')?.value || '').trim();

      if (!to || !to.includes('@')) {
        showToast('Enter a valid email address', 'warning');
        return;
      }
      if (!subject && !body) {
        showToast('Add a subject or body', 'warning');
        return;
      }

      // Resolve contact ID if we don't have one
      let contactId = selectedContactId;
      if (!contactId) {
        sendBtn.disabled = true;
        sendBtn.classList.add('is-loading');
        sendBtn.innerHTML = '<span class="email-send-spinner"></span> Finding contact...';
        contactId = await resolveContactId(to);
      }

      if (!contactId) {
        sendBtn.disabled = false;
        sendBtn.classList.remove('is-loading');
        sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send';
        showToast('Contact not found in GHL. Add them first.', 'warning');
        return;
      }

      // Send via GHL
      sendBtn.disabled = true;
      sendBtn.classList.add('is-loading');
      sendBtn.innerHTML = '<span class="email-send-spinner"></span> Sending...';

      try {
        const res = await fetch('/api/ghl-send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId, subject, body: convertToHtml(body) }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Send failed');

        // Save to local sent list
        const emailData = loadEmailData();
        emailData.sent.unshift({
          id: generateId(), to, subject, body,
          sentAt: new Date().toISOString(),
          ghlMessageId: data.messageId,
        });
        saveEmailData(emailData);

        // If we were editing a draft, remove it
        if (editingDraftId) {
          deleteDraftSilent(editingDraftId);
          editingDraftId = null;
        }

        showToast('Email sent via GHL', 'success');
        activeSubtab = 'sent';
        render();
      } catch (err) {
        showToast(`Send failed: ${err.message}`, 'error');
        sendBtn.disabled = false;
        sendBtn.classList.remove('is-loading');
        sendBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send';
      }
    });
  }
}

// Convert markdown-ish body to basic HTML for GHL
function convertToHtml(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function applyFormat(textarea, fmt) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);
  let replacement = '';

  switch (fmt) {
    case 'bold': replacement = `**${selected || 'bold text'}**`; break;
    case 'italic': replacement = `*${selected || 'italic text'}*`; break;
    case 'link': {
      const url = prompt('URL:');
      if (!url) return;
      replacement = `[${selected || 'link text'}](${url})`;
      break;
    }
    case 'bullet': replacement = `\n- ${selected || 'list item'}`; break;
    default: return;
  }

  textarea.value = text.substring(0, start) + replacement + text.substring(end);
  textarea.focus();
  textarea.selectionStart = start;
  textarea.selectionEnd = start + replacement.length;
}

// ── Draft Operations ─────────────────────────────────────────────────
function saveDraft({ to, subject, body }) {
  const data = loadEmailData();
  if (editingDraftId) {
    const idx = data.drafts.findIndex(d => d.id === editingDraftId);
    if (idx !== -1) {
      data.drafts[idx] = { ...data.drafts[idx], to, subject, body, updatedAt: new Date().toISOString() };
    }
  } else {
    data.drafts.unshift({
      id: generateId(), to, subject, body,
      updatedAt: new Date().toISOString()
    });
  }
  saveEmailData(data);
  editingDraftId = null;
  showToast('Draft saved', 'success');
  activeSubtab = 'drafts';
  render();
}

function deleteDraft(id) {
  const data = loadEmailData();
  data.drafts = data.drafts.filter(d => d.id !== id);
  saveEmailData(data);
  showToast('Draft deleted', 'info');
  renderSubtab();
}

function deleteDraftSilent(id) {
  const data = loadEmailData();
  data.drafts = data.drafts.filter(d => d.id !== id);
  saveEmailData(data);
}

// ── Template Operations ──────────────────────────────────────────────
function saveTemplate({ name, subject, body }) {
  const data = loadEmailData();
  if (editingTemplateId) {
    const idx = data.templates.findIndex(t => t.id === editingTemplateId);
    if (idx !== -1) {
      data.templates[idx] = { ...data.templates[idx], name, subject, body, createdAt: new Date().toISOString() };
    }
    editingTemplateId = null;
  } else {
    data.templates.unshift({
      id: generateId(), name, subject, body,
      createdAt: new Date().toISOString()
    });
  }
  saveEmailData(data);
  showToast('Template saved', 'success');
  activeSubtab = 'templates';
  render();
}

function deleteTemplate(id) {
  const data = loadEmailData();
  data.templates = data.templates.filter(t => t.id !== id);
  saveEmailData(data);
  showToast('Template deleted', 'info');
  renderSubtab();
}

// ── Contact Operations ───────────────────────────────────────────────
function addContact({ name, email }) {
  const data = loadEmailData();
  data.contacts.unshift({
    id: generateId(), name, email, source: 'custom'
  });
  saveEmailData(data);
  showToast('Contact added', 'success');
  renderSubtab();
}

function deleteContact(id) {
  const data = loadEmailData();
  data.contacts = data.contacts.filter(c => c.id !== id);
  saveEmailData(data);
  showToast('Contact removed', 'info');
  renderSubtab();
}

// ── Campaigns View (NEW) ─────────────────────────────────────────────
function renderCampaigns(container) {
  const campaigns = getState('emailCampaigns');

  if (!campaigns) {
    container.innerHTML = `
      <div class="email-campaigns-loading">
        <div class="email-send-spinner"></div>
        <p class="text-sm text-secondary">Loading campaign data from GHL...</p>
      </div>
    `;
    loadCampaignData();
    return;
  }

  const { summary, campaigns: list } = campaigns;

  container.innerHTML = `
    <div class="email-campaigns">
      <div class="email-campaign-cards">
        <div class="email-campaign-card">
          <span class="email-campaign-card-label">Total Campaigns</span>
          <span class="email-campaign-card-value">${formatNumber(summary.totalCampaigns)}</span>
        </div>
        <div class="email-campaign-card">
          <span class="email-campaign-card-label">Avg Delivery Rate</span>
          <span class="email-campaign-card-value">${summary.avgDeliveryRate}%</span>
        </div>
        <div class="email-campaign-card">
          <span class="email-campaign-card-label">Total Emails Sent</span>
          <span class="email-campaign-card-value">${formatNumber(summary.totalSent)}</span>
        </div>
        <div class="email-campaign-card">
          <span class="email-campaign-card-label">Last Campaign</span>
          <span class="email-campaign-card-value">${summary.lastCampaignDate ? formatDate(summary.lastCampaignDate) : '--'}</span>
        </div>
      </div>

      <div class="email-campaign-chart-wrap">
        <h3 class="text-sm" style="margin-bottom: var(--space-3)">Delivery Rate — Last 20 Campaigns</h3>
        <div class="email-campaign-chart-container">
          <canvas id="emailCampaignChart"></canvas>
        </div>
      </div>

      <div class="email-campaign-table-wrap">
        <table class="email-campaign-table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Date</th>
              <th>Sent</th>
              <th>Delivered</th>
              <th>Failed</th>
              <th>Rate</th>
            </tr>
          </thead>
          <tbody id="emailCampaignTableBody">
            ${list.map(c => `
              <tr class="email-campaign-row" data-campaign-id="${c.id}">
                <td class="email-campaign-name">${escapeHtml(c.name)}</td>
                <td>${c.date ? formatDate(c.date) : '--'}</td>
                <td>${formatNumber(c.sentCount)}</td>
                <td>${formatNumber(c.deliveredCount)}</td>
                <td>${c.failedCount > 0 ? `<span class="text-danger">${formatNumber(c.failedCount)}</span>` : '0'}</td>
                <td>
                  <span class="email-campaign-rate ${c.deliveryRate >= 95 ? 'rate-good' : c.deliveryRate >= 80 ? 'rate-ok' : 'rate-bad'}">
                    ${c.deliveryRate}%
                  </span>
                </td>
              </tr>
              <tr class="email-campaign-detail" id="detail-${c.id}" hidden>
                <td colspan="6">
                  <div class="email-campaign-detail-inner">
                    <div><strong>Subject:</strong> ${escapeHtml(c.subject)}</div>
                    <div><strong>Status:</strong> ${escapeHtml(c.status)}</div>
                    <div><strong>Type:</strong> ${escapeHtml(c.campaignType)}</div>
                    ${c.openedCount ? `<div><strong>Opened:</strong> ${formatNumber(c.openedCount)} (${c.openRate}%)</div>` : ''}
                    ${c.clickedCount ? `<div><strong>Clicked:</strong> ${formatNumber(c.clickedCount)} (${c.clickRate}%)</div>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Render chart
  renderCampaignChart(list);

  // Row click → expand detail
  container.querySelectorAll('.email-campaign-row').forEach(row => {
    row.addEventListener('click', () => {
      const detailRow = $(`#detail-${row.dataset.campaignId}`);
      if (detailRow) {
        detailRow.hidden = !detailRow.hidden;
        row.classList.toggle('is-expanded');
      }
    });
  });
}

function renderCampaignChart(campaigns) {
  if (typeof Chart === 'undefined' || !campaigns || campaigns.length === 0) return;

  const canvas = $('#emailCampaignChart');
  if (!canvas) return;

  // Take last 20, reverse for chronological
  const recent = campaigns.slice(0, 20).reverse();
  const labels = recent.map(c => {
    if (!c.date) return '?';
    const dt = new Date(c.date);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const rateData = recent.map(c => c.deliveryRate);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const lineColor = isDark ? '#C8A24A' : '#2d5016';
  const fillColor = isDark ? 'rgba(200,162,74,0.15)' : 'rgba(45,80,22,0.15)';
  const textColor = isDark ? '#9CA3AF' : '#6B7280';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  if (emailCampaignChartInstance) emailCampaignChartInstance.destroy();
  emailCampaignChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Delivery Rate %',
        data: rateData,
        borderColor: lineColor,
        backgroundColor: fillColor,
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: lineColor,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          min: 0, max: 100,
          ticks: { color: textColor, callback: v => v + '%' },
          grid: { color: gridColor },
        },
        x: { ticks: { color: textColor }, grid: { display: false } },
      },
    },
  });
}

// ── Drafts View ──────────────────────────────────────────────────────
function renderDrafts(container) {
  const data = loadEmailData();
  const drafts = data.drafts || [];

  if (drafts.length === 0) {
    container.innerHTML = `
      <div class="email-empty">
        <p>No drafts yet.</p>
        <button class="btn btn-primary btn-sm" id="emailNewFromEmpty">Compose Email</button>
      </div>
    `;
    container.querySelector('#emailNewFromEmpty')?.addEventListener('click', () => {
      editingDraftId = null;
      activeSubtab = 'compose';
      render();
    });
    return;
  }

  container.innerHTML = `
    <div class="email-list">
      ${drafts.map(d => `
        <div class="email-list-item" data-draft-id="${d.id}">
          <div class="email-list-main">
            <span class="email-list-to">${escapeHtml(d.to || '(no recipient)')}</span>
            <span class="email-list-subject">${escapeHtml(d.subject || '(no subject)')}</span>
            <span class="email-list-preview">${escapeHtml((d.body || '').substring(0, 80))}${(d.body || '').length > 80 ? '...' : ''}</span>
          </div>
          <div class="email-list-meta">
            <span class="email-list-date">${formatRelativeTime(d.updatedAt)}</span>
            <button class="btn-icon btn-xs email-delete-btn" data-delete-draft="${d.id}" title="Delete draft" aria-label="Delete draft">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Click to edit
  container.querySelectorAll('.email-list-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.email-delete-btn')) return;
      const id = item.dataset.draftId;
      const draft = drafts.find(d => d.id === id);
      if (draft) {
        editingDraftId = id;
        activeSubtab = 'compose';
        render();
        const toEl = $('#emailTo');
        const subEl = $('#emailSubject');
        const bodyEl = $('#emailBody');
        if (toEl) toEl.value = draft.to || '';
        if (subEl) subEl.value = draft.subject || '';
        if (bodyEl) bodyEl.value = draft.body || '';
      }
    });
  });

  // Delete buttons
  container.querySelectorAll('[data-delete-draft]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteDraft(btn.dataset.deleteDraft);
    });
  });
}

// ── Sent View ────────────────────────────────────────────────────────
function renderSent(container) {
  const data = loadEmailData();
  const sent = data.sent || [];

  if (sent.length === 0) {
    container.innerHTML = `
      <div class="email-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="1.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        <p>No sent emails yet.</p>
        <p class="text-sm text-secondary">Compose and send emails via GHL.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="email-list">
      ${sent.map(s => `
        <div class="email-list-item email-list-sent">
          <div class="email-list-main">
            <span class="email-list-to">To: ${escapeHtml(s.to)}</span>
            <span class="email-list-subject">${escapeHtml(s.subject || '(no subject)')}</span>
            <span class="email-list-preview">${escapeHtml((s.body || '').substring(0, 80))}</span>
          </div>
          <div class="email-list-meta">
            <span class="email-list-date">${formatRelativeTime(s.sentAt)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Templates View ───────────────────────────────────────────────────
function renderTemplates(container) {
  const data = loadEmailData();
  const templates = data.templates || [];

  if (templates.length === 0) {
    container.innerHTML = `
      <div class="email-empty">
        <p>No templates yet.</p>
        <p class="text-sm text-secondary">Save an email as a template from the compose view.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="email-templates-grid">
      ${templates.map(t => `
        <div class="email-template-card" data-template-id="${t.id}">
          <div class="email-template-header">
            <span class="email-template-name">${escapeHtml(t.name)}</span>
            <div class="email-template-actions">
              <button class="btn-icon btn-xs" data-edit-template="${t.id}" title="Edit" aria-label="Edit template">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon btn-xs" data-delete-template="${t.id}" title="Delete" aria-label="Delete template">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
          <div class="email-template-subject">${escapeHtml(t.subject || '(no subject)')}</div>
          <div class="email-template-preview">${escapeHtml((t.body || '').substring(0, 100))}${(t.body || '').length > 100 ? '...' : ''}</div>
          <div class="email-template-footer">
            <span class="text-xs text-tertiary">${formatDate(t.createdAt)}</span>
            <button class="btn btn-ghost btn-xs" data-use-template="${t.id}">Use Template</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Use template
  container.querySelectorAll('[data-use-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = templates.find(t => t.id === btn.dataset.useTemplate);
      if (t) {
        editingDraftId = null;
        activeSubtab = 'compose';
        render();
        const subEl = $('#emailSubject');
        const bodyEl = $('#emailBody');
        if (subEl) subEl.value = t.subject || '';
        if (bodyEl) bodyEl.value = t.body || '';
        showToast('Template loaded', 'info');
      }
    });
  });

  // Edit template
  container.querySelectorAll('[data-edit-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = templates.find(t => t.id === btn.dataset.editTemplate);
      if (t) {
        editingTemplateId = t.id;
        activeSubtab = 'compose';
        render();
        const subEl = $('#emailSubject');
        const bodyEl = $('#emailBody');
        if (subEl) subEl.value = t.subject || '';
        if (bodyEl) bodyEl.value = t.body || '';
      }
    });
  });

  // Delete template
  container.querySelectorAll('[data-delete-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTemplate(btn.dataset.deleteTemplate);
    });
  });
}

// ── Contacts View (with GHL search + tag filters) ────────────────────
function renderContacts(container) {
  const localContacts = getAllContacts();

  container.innerHTML = `
    <div class="email-contacts-header">
      <span class="text-sm text-secondary">${localContacts.length} local contact${localContacts.length !== 1 ? 's' : ''}</span>
      <button class="btn btn-primary btn-sm" id="emailAddContact">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Contact
      </button>
    </div>

    <div class="email-ghl-search">
      <div class="email-ghl-search-row">
        <input type="text" class="form-input" id="ghlContactSearch" placeholder="Search GHL contacts (27K+)..." value="${escapeHtml(ghlSearchQuery)}">
        <button class="btn btn-secondary btn-sm" id="ghlSearchBtn">Search</button>
      </div>
      <div class="email-tag-chips" id="ghlTagChips"></div>
    </div>

    <div id="ghlContactResults"></div>

    ${localContacts.length === 0
      ? ''
      : `<div style="margin-top: var(--space-6)">
          <h3 class="text-sm text-secondary" style="margin-bottom: var(--space-3)">Local Contacts</h3>
          <div class="email-contacts-list">
            ${localContacts.map(c => `
              <div class="email-contact-row" data-contact-email="${escapeHtml(c.email)}">
                <div class="email-contact-avatar">${(c.name || '?').charAt(0).toUpperCase()}</div>
                <div class="email-contact-info">
                  <span class="email-contact-name">${escapeHtml(c.name)}</span>
                  <span class="email-contact-email">${escapeHtml(c.email)}</span>
                </div>
                <span class="email-contact-source">${c.source === 'vip' ? 'VIP Client' : 'Custom'}</span>
                <div class="email-contact-actions">
                  <button class="btn btn-ghost btn-xs" data-compose-to="${escapeHtml(c.email)}">Compose</button>
                  ${c.source === 'custom' ? `<button class="btn-icon btn-xs" data-delete-contact="${c.id}" title="Remove" aria-label="Remove contact">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>`
    }
  `;

  // Load tags for filter chips
  loadGhlTags().then(tags => {
    const chipContainer = $('#ghlTagChips');
    if (!chipContainer || tags.length === 0) return;
    chipContainer.innerHTML = tags.slice(0, 30).map(t => `
      <button class="email-tag-chip ${selectedGhlTag === t.name ? 'is-active' : ''}" data-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>
    `).join('') + (tags.length > 30 ? `<span class="text-xs text-tertiary">+${tags.length - 30} more</span>` : '');

    chipContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.email-tag-chip');
      if (!chip) return;
      const tag = chip.dataset.tag;
      selectedGhlTag = selectedGhlTag === tag ? '' : tag;
      chipContainer.querySelectorAll('.email-tag-chip').forEach(c => {
        c.classList.toggle('is-active', c.dataset.tag === selectedGhlTag);
      });
      doGhlSearch();
    });
  });

  // Search functionality
  const searchInput = $('#ghlContactSearch');
  const searchBtn = $('#ghlSearchBtn');

  const doGhlSearch = async () => {
    ghlSearchQuery = searchInput?.value || '';
    const resultsContainer = $('#ghlContactResults');
    if (!resultsContainer) return;

    if (!ghlSearchQuery && !selectedGhlTag) {
      resultsContainer.innerHTML = '<p class="text-sm text-tertiary" style="padding: var(--space-3)">Enter a name, email, or select a tag to search GHL contacts.</p>';
      return;
    }

    resultsContainer.innerHTML = '<div class="email-campaigns-loading"><div class="email-send-spinner"></div><p class="text-sm text-secondary">Searching...</p></div>';
    const results = await searchGhlContacts(ghlSearchQuery, selectedGhlTag);
    ghlContactsCache = results;

    if (results.length === 0) {
      resultsContainer.innerHTML = '<p class="text-sm text-tertiary" style="padding: var(--space-3)">No GHL contacts found.</p>';
      return;
    }

    resultsContainer.innerHTML = `
      <div class="email-contacts-list" style="margin-top: var(--space-3)">
        ${results.map(c => `
          <div class="email-contact-row" data-contact-email="${escapeHtml(c.email)}" data-contact-id="${escapeHtml(c.id)}">
            <div class="email-contact-avatar">${(c.name || '?').charAt(0).toUpperCase()}</div>
            <div class="email-contact-info">
              <span class="email-contact-name">${escapeHtml(c.name)}</span>
              <span class="email-contact-email">${escapeHtml(c.email)}</span>
              ${c.tags && c.tags.length > 0 ? `<span class="email-contact-tags">${c.tags.slice(0, 3).map(t => escapeHtml(t)).join(', ')}${c.tags.length > 3 ? '...' : ''}</span>` : ''}
            </div>
            <span class="email-contact-source">GHL</span>
            <div class="email-contact-actions">
              <button class="btn btn-ghost btn-xs" data-compose-to="${escapeHtml(c.email)}" data-compose-contact-id="${escapeHtml(c.id)}">Compose</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Bind compose buttons on GHL results
    resultsContainer.querySelectorAll('[data-compose-to]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingDraftId = null;
        selectedContactId = btn.dataset.composeContactId || null;
        activeSubtab = 'compose';
        render();
        const toEl = $('#emailTo');
        if (toEl) toEl.value = btn.dataset.composeTo;
        $('#emailSubject')?.focus();
      });
    });
  };

  if (searchBtn) searchBtn.addEventListener('click', doGhlSearch);
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doGhlSearch();
    });
  }

  // Show cached GHL results if any
  if (ghlContactsCache.length > 0 || ghlSearchQuery || selectedGhlTag) {
    doGhlSearch();
  }

  // Add contact
  const addBtn = $('#emailAddContact');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const name = prompt('Contact name:');
      if (!name) return;
      const email = prompt('Email address:');
      if (!email || !email.includes('@')) {
        showToast('Please enter a valid email', 'warning');
        return;
      }
      addContact({ name: name.trim(), email: email.trim() });
    });
  }

  // Compose to (local contacts)
  container.querySelectorAll('[data-compose-to]').forEach(btn => {
    btn.addEventListener('click', () => {
      editingDraftId = null;
      selectedContactId = btn.dataset.composeContactId || null;
      activeSubtab = 'compose';
      render();
      const toEl = $('#emailTo');
      if (toEl) toEl.value = btn.dataset.composeTo;
      $('#emailSubject')?.focus();
    });
  });

  // Delete contact
  container.querySelectorAll('[data-delete-contact]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteContact(btn.dataset.deleteContact);
    });
  });
}

// ── Event Binding ────────────────────────────────────────────────────
function bindEvents(container) {
  // Subtab switching
  container.querySelectorAll('[data-email-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeSubtab = btn.dataset.emailSubtab;
      editingDraftId = null;
      editingTemplateId = null;
      // Update button states
      container.querySelectorAll('[data-email-subtab]').forEach(b => {
        b.classList.toggle('is-active', b.dataset.emailSubtab === activeSubtab);
        b.setAttribute('aria-selected', String(b.dataset.emailSubtab === activeSubtab));
      });
      renderSubtab();
    });
  });
}
