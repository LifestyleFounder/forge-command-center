// js/vip-clients.js — VIP Clients tab
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
let editingCell = null;

// ── Public init ──────────────────────────────────────────────────────
export function initVipClients() {
  renderVipClients();
  bindVipEvents();
  subscribe((key) => {
    if (key === 'vipClients') renderVipClients();
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

  const clients = data.clients;
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
          ${client.notionUrl ? `<a href="${escapeHtml(client.notionUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs" title="Open in Notion">↗</a>` : ''}
          <button class="btn btn-ghost btn-xs vip-expand-btn" data-client-id="${escapeHtml(client.id)}" aria-label="Expand">${isExpanded ? '▲' : '▼'}</button>
        </div>
      </td>
    </tr>
    ${isExpanded ? renderExpandedRow(client) : ''}
  `;
}

function renderExpandedRow(client) {
  const todos = client.todo || [];
  return `
    <tr class="vip-expanded-row">
      <td colspan="8">
        <div class="vip-detail-grid">
          <div class="vip-detail-section">
            <h4>Program Details</h4>
            <div class="vip-detail-item"><span class="label">Programs:</span> ${escapeHtml((client.program || []).join(', ') || 'None')}</div>
            <div class="vip-detail-item"><span class="label">Length:</span> ${escapeHtml(client.programLength || 'N/A')}</div>
            <div class="vip-detail-item"><span class="label">Payment:</span> ${escapeHtml(client.payment || 'N/A')}</div>
            <div class="vip-detail-item"><span class="label">PIF:</span> ${escapeHtml(client.pif || '$0')}</div>
          </div>
          ${todos.length > 0 ? `
            <div class="vip-detail-section">
              <h4>Action Items</h4>
              <ul class="vip-todo-list">
                ${todos.map(t => `<li>${escapeHtml(t)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          <div class="vip-detail-section">
            <h4>Contact</h4>
            <div class="vip-detail-item"><span class="label">Email:</span> ${client.email ? `<a href="mailto:${escapeHtml(client.email)}">${escapeHtml(client.email)}</a>` : 'N/A'}</div>
            ${client.notionUrl ? `<div class="vip-detail-item"><a href="${escapeHtml(client.notionUrl)}" target="_blank" rel="noopener noreferrer">View in Notion ↗</a></div>` : ''}
          </div>
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
  // Programs like "Needs Attention", "Paused" → warning
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

// ── Events ──────────────────────────────────────────────────────────
function bindVipEvents() {
  const container = $('#vipClientsContainer');
  if (!container) return;

  container.addEventListener('click', (e) => {
    // Filter buttons
    const filterBtn = e.target.closest('[data-vip-filter]');
    if (filterBtn) {
      activeFilter = filterBtn.dataset.vipFilter;
      renderVipClients();
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

    // Row click (expand if not clicking a button/link)
    const row = e.target.closest('.vip-row');
    if (row && !e.target.closest('a, button')) {
      const clientId = row.dataset.clientId;
      expandedClientId = expandedClientId === clientId ? null : clientId;
      renderVipClients();
    }
  });

  // Search (delegated via input event on container)
  container.addEventListener('input', (e) => {
    if (e.target.id === 'vipSearchInput') {
      searchQuery = e.target.value.trim();
      debounce(() => renderVipClients(), 200)();
    }
  });
}
