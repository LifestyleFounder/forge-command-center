// js/vip-clients.js — VIP Clients tab (with inline editing)
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe, saveLocal,
  escapeHtml, formatNumber, formatDate, formatRelativeTime,
  daysBetween, debounce, $, $$, showToast
} from './app.js';

// ── State ────────────────────────────────────────────────────────────
let activeFilter = 'all';
let searchQuery = '';
let expandedClientId = null;
let skipNextRender = false;

// Local edits stored per client id
const LOCAL_EDITS_KEY = 'forge-vip-edits';

function getLocalEdits() {
  try { return JSON.parse(localStorage.getItem(LOCAL_EDITS_KEY)) || {}; }
  catch { return {}; }
}

function saveLocalEdit(clientId, field, value) {
  const edits = getLocalEdits();
  if (!edits[clientId]) edits[clientId] = {};
  edits[clientId][field] = value;
  localStorage.setItem(LOCAL_EDITS_KEY, JSON.stringify(edits));
}

function clearLocalEdits(clientId) {
  const edits = getLocalEdits();
  delete edits[clientId];
  localStorage.setItem(LOCAL_EDITS_KEY, JSON.stringify(edits));
}

// Merge local edits into client data
function mergeEdits(client) {
  const edits = getLocalEdits()[client.id];
  if (!edits) return client;
  return { ...client, ...edits };
}

// ── Sync indicator per client ────────────────────────────────────────
const syncStatus = {}; // clientId → 'syncing' | 'saved' | 'error' | null

function setSyncStatus(clientId, status) {
  syncStatus[clientId] = status;
  const el = document.querySelector(`.vip-sync-indicator[data-client-id="${clientId}"]`);
  if (!el) return;
  if (status === 'syncing') {
    el.textContent = 'Syncing...';
    el.className = 'vip-sync-indicator vip-sync-active';
  } else if (status === 'saved') {
    el.textContent = 'Saved to Notion';
    el.className = 'vip-sync-indicator vip-sync-saved';
    setTimeout(() => {
      if (syncStatus[clientId] === 'saved') {
        el.className = 'vip-sync-indicator vip-sync-fade';
        setTimeout(() => { el.textContent = ''; el.className = 'vip-sync-indicator'; }, 600);
      }
    }, 2000);
  } else if (status === 'error') {
    el.textContent = 'Sync failed';
    el.className = 'vip-sync-indicator vip-sync-error';
  }
}

// ── Debounced Notion save ────────────────────────────────────────────
const pendingUpdates = {}; // clientId → { field: notionField, value }

const debouncedSave = debounce((clientId) => {
  const updates = pendingUpdates[clientId];
  if (!updates) return;
  delete pendingUpdates[clientId];
  saveToNotion(clientId, updates);
}, 800);

function queueNotionUpdate(clientId, notionField, value) {
  if (!pendingUpdates[clientId]) pendingUpdates[clientId] = {};
  pendingUpdates[clientId][notionField] = value;
  setSyncStatus(clientId, 'syncing');
  debouncedSave(clientId);
}

async function saveToNotion(clientId, properties) {
  try {
    const res = await fetch('/api/update-vip-client', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: clientId, properties }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setSyncStatus(clientId, 'saved');
  } catch (err) {
    console.error('[vip] Notion sync failed:', err);
    setSyncStatus(clientId, 'error');
    showToast(`Sync failed: ${err.message}`, 'error');
  }
}

// ── Navigate to a specific client (used by home.js) ─────────────────
export function navigateToClient(clientId) {
  expandedClientId = clientId;
  renderVipClients();
  // Scroll to the expanded row after render
  requestAnimationFrame(() => {
    const row = document.querySelector(`.vip-row[data-client-id="${clientId}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ── Public init ──────────────────────────────────────────────────────
export function initVipClients() {
  renderVipClients();
  bindVipEvents();
  subscribe((key) => {
    if (key === 'vipClients') {
      if (skipNextRender) { skipNextRender = false; return; }
      renderVipClients();
    }
  });
}

// ── Rendering ────────────────────────────────────────────────────────
function renderVipClients() {
  const container = $('#vipClientsContainer');
  if (!container) return;

  const data = getState('vipClients');
  if (!data || !data.clients) {
    container.innerHTML = '<div class="empty-state"><p>No VIP client data loaded.</p></div>';
    return;
  }

  const clients = data.clients.map(mergeEdits);
  const stats = computeStats(clients);

  // Filter
  let filtered = clients;
  if (activeFilter !== 'all') {
    filtered = clients.filter(c => classifyStatus(c.status) === activeFilter);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.program || []).join(' ').toLowerCase().includes(q)
    );
  }

  container.innerHTML = `
    <div class="vip-stats-row">
      <button class="vip-stat-card ${activeFilter === 'all' ? 'is-active' : ''}" data-vip-filter="all">
        <span class="vip-stat-value">${stats.total}</span><span class="vip-stat-label">Total</span>
      </button>
      <button class="vip-stat-card ${activeFilter === 'active' ? 'is-active' : ''}" data-vip-filter="active">
        <span class="vip-stat-value">${stats.active}</span><span class="vip-stat-label">Active</span>
      </button>
      <button class="vip-stat-card vip-stat-warning ${activeFilter === 'warning' ? 'is-active' : ''}" data-vip-filter="warning">
        <span class="vip-stat-value">${stats.warning}</span><span class="vip-stat-label">Attention</span>
      </button>
      <button class="vip-stat-card vip-stat-danger ${activeFilter === 'at-risk' ? 'is-active' : ''}" data-vip-filter="at-risk">
        <span class="vip-stat-value">${stats.atRisk}</span><span class="vip-stat-label">At Risk</span>
      </button>
      <button class="vip-stat-card vip-stat-muted ${activeFilter === 'churned' ? 'is-active' : ''}" data-vip-filter="churned">
        <span class="vip-stat-value">${stats.churned}</span><span class="vip-stat-label">Churned</span>
      </button>
    </div>
    <div class="vip-toolbar">
      <input type="search" class="input-search" id="vipSearchInput" placeholder="Search clients..." value="${escapeHtml(searchQuery)}" aria-label="Search clients">
      <span class="text-sm text-secondary">${filtered.length} client${filtered.length !== 1 ? 's' : ''}</span>
      <button class="btn btn-sm btn-outline" id="vipRefreshBtn" title="Sync from Notion">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        Refresh
      </button>
    </div>
    <div class="vip-table-wrap">
      <table class="data-table vip-table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Status</th>
            <th>Program</th>
            <th>Payment</th>
            <th>PIF</th>
            <th>Joined</th>
            <th>Duration</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="vipTableBody">
          ${filtered.length === 0
            ? '<tr><td colspan="8" class="empty-cell">No clients match your filters.</td></tr>'
            : filtered.map(c => renderClientRow(c, data.lastSynced)).join('')}
        </tbody>
      </table>
    </div>
    ${data.lastSynced ? `<div class="vip-sync-info text-xs text-tertiary">Last synced: ${formatRelativeTime(data.lastSynced)}</div>` : ''}
  `;
}

function renderClientRow(client, lastSynced) {
  const statusClass = classifyStatus(client.status);
  const programs = (client.program || []).join(', ');
  const joined = client.joined ? formatDate(client.joined) : '--';
  const tenure = client.joined ? tenureLabel(client.joined) : '--';
  const hasTodos = client.todo && client.todo.length > 0;
  const isExpanded = expandedClientId === client.id;

  return `
    <tr class="vip-row ${isExpanded ? 'is-expanded' : ''}" data-client-id="${escapeHtml(client.id)}">
      <td>
        <div class="vip-client-cell">
          <span class="vip-client-name">${escapeHtml(client.name)}</span>
          ${client.email ? `<span class="vip-client-email text-xs text-tertiary">${escapeHtml(client.email)}</span>` : ''}
        </div>
      </td>
      <td><span class="vip-status-badge vip-status-${escapeHtml(statusClass)}">${escapeHtml(client.status)}</span></td>
      <td class="text-sm">${escapeHtml(programs)}</td>
      <td class="text-sm">${escapeHtml(client.payment || '--')}</td>
      <td class="text-sm">${escapeHtml(client.pif || '--')}</td>
      <td class="text-sm">${joined}</td>
      <td class="text-sm">${tenure}</td>
      <td>
        <div class="vip-actions">
          ${hasTodos ? `<span class="vip-todo-badge" title="${escapeHtml(client.todo.join(', '))}">${client.todo.length}</span>` : ''}
          ${client.notionUrl ? `<a href="${escapeHtml(client.notionUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs" title="Open in Notion">&#8599;</a>` : ''}
          <button class="btn btn-ghost btn-xs vip-expand-btn" data-client-id="${escapeHtml(client.id)}" aria-label="Expand">${isExpanded ? '&#9650;' : '&#9660;'}</button>
        </div>
      </td>
    </tr>
    ${isExpanded ? renderExpandedRow(client) : ''}
  `;
}

// ── Editable expanded row ────────────────────────────────────────────

const STATUS_OPTIONS = ['Active', 'At Risk', 'Onboarding', 'Churned'];
const PAYMENT_OPTIONS = ['1k/month', '3k PIF/Year', 'PIF', '+1', ''];
const LENGTH_OPTIONS = ['3 Months', '5 Months', '6 Months', '12 Months', ''];
const PROGRAM_OPTIONS = ['Group VIP', '1:1 VIP', 'VIP Accelerator', 'VIP DAY', 'Special Deal', 'Needs Attention', 'Paused', 'Cancelled', 'Graduated'];

function renderExpandedRow(client) {
  const todos = client.todo || [];
  const programs = client.program || [];
  const sync = syncStatus[client.id];

  return `
    <tr class="vip-expanded-row" data-expanded-id="${escapeHtml(client.id)}">
      <td colspan="8">
        <div class="vip-edit-grid">
          <div class="vip-edit-section">
            <h4>Details</h4>
            <div class="vip-edit-field">
              <label>Name</label>
              <input type="text" class="vip-edit-input" data-field="name" data-notion="Name" value="${escapeHtml(client.name)}" />
            </div>
            <div class="vip-edit-field">
              <label>Email</label>
              <input type="email" class="vip-edit-input" data-field="email" data-notion="Email" value="${escapeHtml(client.email || '')}" />
            </div>
            <div class="vip-edit-field">
              <label>Status</label>
              <select class="vip-edit-select" data-field="status" data-notion="Status">
                ${STATUS_OPTIONS.map(o => `<option value="${escapeHtml(o)}" ${client.status === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
              </select>
            </div>
            <div class="vip-edit-field">
              <label>Payment</label>
              <select class="vip-edit-select" data-field="payment" data-notion="Payment">
                ${PAYMENT_OPTIONS.map(o => `<option value="${escapeHtml(o)}" ${client.payment === o ? 'selected' : ''}>${escapeHtml(o || '(none)')}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="vip-edit-section">
            <h4>Program</h4>
            <div class="vip-edit-field">
              <label>PIF</label>
              <input type="text" class="vip-edit-input" data-field="pif" data-notion="PIF" value="${escapeHtml(client.pif || '')}" />
            </div>
            <div class="vip-edit-field">
              <label>Joined</label>
              <input type="date" class="vip-edit-input" data-field="joined" data-notion="Joined" value="${escapeHtml(client.joined || '')}" />
            </div>
            <div class="vip-edit-field">
              <label>Program Length</label>
              <select class="vip-edit-select" data-field="programLength" data-notion="Program Length">
                ${LENGTH_OPTIONS.map(o => `<option value="${escapeHtml(o)}" ${client.programLength === o ? 'selected' : ''}>${escapeHtml(o || '(none)')}</option>`).join('')}
              </select>
            </div>
            <div class="vip-edit-field">
              <label>Programs</label>
              <div class="vip-tag-editor" data-field="program" data-notion="Program">
                <div class="vip-tag-list">
                  ${programs.map(p => `<span class="vip-tag">${escapeHtml(p)}<button class="vip-tag-remove" data-tag="${escapeHtml(p)}">&times;</button></span>`).join('')}
                </div>
                <div class="vip-tag-add">
                  <select class="vip-tag-select">
                    <option value="">+ Add program</option>
                    ${PROGRAM_OPTIONS.filter(o => !programs.includes(o)).map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
                  </select>
                </div>
              </div>
            </div>
          </div>
          <div class="vip-edit-section">
            <h4>Action Items</h4>
            <div class="vip-edit-field">
              <div class="vip-tag-editor" data-field="todo" data-notion="TODO">
                <div class="vip-tag-list">
                  ${todos.map(t => `<span class="vip-tag vip-tag-todo">${escapeHtml(t)}<button class="vip-tag-remove" data-tag="${escapeHtml(t)}">&times;</button></span>`).join('')}
                </div>
                <div class="vip-tag-add">
                  <input type="text" class="vip-tag-input" placeholder="Add action item..." />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="vip-edit-footer">
          <span class="vip-sync-indicator" data-client-id="${escapeHtml(client.id)}">${sync === 'syncing' ? 'Syncing...' : sync === 'saved' ? 'Saved to Notion' : ''}</span>
          ${client.notionUrl ? `<a href="${escapeHtml(client.notionUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs">View in Notion &#8599;</a>` : ''}
        </div>
      </td>
    </tr>
  `;
}

// ── Helpers ──────────────────────────────────────────────────────────
function computeStats(clients) {
  const stats = { total: clients.length, active: 0, warning: 0, atRisk: 0, churned: 0, onboarding: 0 };
  clients.forEach(c => {
    const cls = classifyStatus(c.status);
    if (cls === 'active') stats.active++;
    else if (cls === 'warning') stats.warning++;
    else if (cls === 'at-risk') stats.atRisk++;
    else if (cls === 'churned') stats.churned++;
    else if (cls === 'onboarding') stats.onboarding++;
  });
  return stats;
}

function classifyStatus(status) {
  if (!status) return 'active';
  const s = status.toLowerCase();
  if (s === 'active') return 'active';
  if (s === 'at risk') return 'at-risk';
  if (s === 'churned' || s === 'cancelled' || s === 'graduated') return 'churned';
  if (s === 'onboarding') return 'onboarding';
  if (s.includes('needs attention') || s.includes('paused')) return 'warning';
  return 'active';
}

function tenureLabel(joinedDate) {
  const days = daysBetween(joinedDate, null);
  if (days === null) return '--';
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years}y ${rem}mo` : `${years}y`;
}

// ── Update local state + queue Notion sync ───────────────────────────
function updateClientField(clientId, field, notionField, value) {
  // Save to localStorage immediately
  saveLocalEdit(clientId, field, value);

  // Update in-memory state without triggering re-render
  skipNextRender = true;
  const data = getState('vipClients');
  if (data?.clients) {
    const client = data.clients.find(c => c.id === clientId);
    if (client) client[field] = value;
    setState('vipClients', { ...data });
  }

  // Queue debounced Notion update
  queueNotionUpdate(clientId, notionField, value);
}

// ── Notion sync ─────────────────────────────────────────────────────
async function refreshVipClients() {
  const btn = $('#vipRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
  showToast('Syncing clients from Notion...', 'info');

  try {
    const res = await fetch('/api/vip-clients');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    // Clear local edits on fresh sync
    localStorage.removeItem(LOCAL_EDITS_KEY);
    setState('vipClients', data);
    showToast(`Synced ${data.clients.length} clients from Notion`, 'success');
  } catch (err) {
    showToast(`Sync failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Refresh'; }
  }
}

// ── Events ──────────────────────────────────────────────────────────
function bindVipEvents() {
  const container = $('#vipClientsContainer');
  if (!container) return;

  container.addEventListener('click', (e) => {
    // Refresh button
    if (e.target.closest('#vipRefreshBtn')) {
      refreshVipClients();
      return;
    }

    // Filter buttons
    const filterBtn = e.target.closest('[data-vip-filter]');
    if (filterBtn) {
      activeFilter = filterBtn.dataset.vipFilter;
      renderVipClients();
      return;
    }

    // Tag remove button
    const removeBtn = e.target.closest('.vip-tag-remove');
    if (removeBtn) {
      e.stopPropagation();
      const tag = removeBtn.dataset.tag;
      const editor = removeBtn.closest('.vip-tag-editor');
      const expandedRow = removeBtn.closest('[data-expanded-id]');
      if (!editor || !expandedRow) return;

      const clientId = expandedRow.dataset.expandedId;
      const field = editor.dataset.field;
      const notionField = editor.dataset.notion;
      const client = mergeEdits(getState('vipClients')?.clients?.find(c => c.id === clientId) || {});
      const current = client[field] || [];
      const updated = current.filter(t => t !== tag);

      updateClientField(clientId, field, notionField, updated);
      // Re-render just the expanded row
      renderExpandedInPlace(clientId);
      return;
    }

    // Expand/collapse
    const expandBtn = e.target.closest('.vip-expand-btn');
    if (expandBtn) {
      const clientId = expandBtn.dataset.clientId;
      expandedClientId = expandedClientId === clientId ? null : clientId;
      renderVipClients();
      return;
    }

    // Row click (expand if not clicking a button/link/input)
    const row = e.target.closest('.vip-row');
    if (row && !e.target.closest('a, button, input, select, .vip-tag-editor')) {
      const clientId = row.dataset.clientId;
      expandedClientId = expandedClientId === clientId ? null : clientId;
      renderVipClients();
    }
  });

  // Handle input/select changes in expanded rows
  container.addEventListener('change', (e) => {
    const el = e.target;
    const expandedRow = el.closest('[data-expanded-id]');
    if (!expandedRow) return;
    const clientId = expandedRow.dataset.expandedId;

    // Select/input field change
    if (el.classList.contains('vip-edit-select') || el.classList.contains('vip-edit-input')) {
      const field = el.dataset.field;
      const notionField = el.dataset.notion;
      updateClientField(clientId, field, notionField, el.value);
      return;
    }

    // Tag add (select dropdown for programs)
    if (el.classList.contains('vip-tag-select') && el.value) {
      const editor = el.closest('.vip-tag-editor');
      if (!editor) return;
      const field = editor.dataset.field;
      const notionField = editor.dataset.notion;
      const client = mergeEdits(getState('vipClients')?.clients?.find(c => c.id === clientId) || {});
      const current = client[field] || [];
      if (!current.includes(el.value)) {
        const updated = [...current, el.value];
        updateClientField(clientId, field, notionField, updated);
        renderExpandedInPlace(clientId);
      }
      el.value = '';
    }
  });

  // Handle text input for inputs (debounced)
  container.addEventListener('input', (e) => {
    // Search
    if (e.target.id === 'vipSearchInput') {
      searchQuery = e.target.value.trim();
      debounce(() => renderVipClients(), 200)();
      return;
    }

    // Edit inputs (text/email/date)
    const el = e.target;
    if (el.classList.contains('vip-edit-input')) {
      const expandedRow = el.closest('[data-expanded-id]');
      if (!expandedRow) return;
      const clientId = expandedRow.dataset.expandedId;
      const field = el.dataset.field;
      const notionField = el.dataset.notion;
      updateClientField(clientId, field, notionField, el.value);
    }
  });

  // Handle Enter key on todo input
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (!el.classList.contains('vip-tag-input')) return;
    e.preventDefault();
    const val = el.value.trim();
    if (!val) return;

    const editor = el.closest('.vip-tag-editor');
    const expandedRow = el.closest('[data-expanded-id]');
    if (!editor || !expandedRow) return;

    const clientId = expandedRow.dataset.expandedId;
    const field = editor.dataset.field;
    const notionField = editor.dataset.notion;
    const client = mergeEdits(getState('vipClients')?.clients?.find(c => c.id === clientId) || {});
    const current = client[field] || [];
    const updated = [...current, val];

    updateClientField(clientId, field, notionField, updated);
    el.value = '';
    renderExpandedInPlace(clientId);
  });
}

// Re-render just the expanded row content without full table re-render
function renderExpandedInPlace(clientId) {
  const row = document.querySelector(`[data-expanded-id="${clientId}"]`);
  if (!row) return;
  const data = getState('vipClients');
  const rawClient = data?.clients?.find(c => c.id === clientId);
  if (!rawClient) return;
  const client = mergeEdits(rawClient);

  const td = row.querySelector('td');
  if (!td) return;

  // Build new content
  const tmp = document.createElement('tr');
  tmp.innerHTML = renderExpandedRow(client);
  const newTd = tmp.querySelector('td');
  if (newTd) td.innerHTML = newTd.innerHTML;
}
