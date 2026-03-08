// js/funnels.js — Funnels tab (GHL-style funnel tracking dashboard)
// ──────────────────────────────────────────────────────────────────────

import {
  escapeHtml, formatNumber, $, $$, showToast, generateId
} from './app.js';

// ── State ────────────────────────────────────────────────────────────
const STORAGE_KEY = 'forge-funnels-config';
let funnelsConfig = []; // [{ id, name, pages: [{ id, name, slug }] }]
let activeFunnelId = null;
let dateRange = getDefaultDateRange();
let pageStats = {};  // slug -> { views: {all, unique}, optins: {all, rate}, daily: [] }
let loading = false;
let expandedRows = new Set(); // page IDs with expanded daily detail
let vercelProjects = null; // cached list from /api/vercel-projects
let trackedSlugs = null;   // cached list from /api/funnel-stats (existing slugs)
let addPageMode = 'picker'; // 'picker' or 'manual'

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

// ── Config Persistence ──────────────────────────────────────────────
function loadConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      funnelsConfig = JSON.parse(saved);
      if (funnelsConfig.length > 0 && !activeFunnelId) {
        activeFunnelId = funnelsConfig[0].id;
      }
    }
  } catch { funnelsConfig = []; }
}

function saveConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(funnelsConfig));
}

function getActiveFunnel() {
  return funnelsConfig.find(f => f.id === activeFunnelId) || null;
}

// ── Public API ──────────────────────────────────────────────────────
export function initFunnels() {
  loadConfig();
  bindEvents();
}

export async function loadFunnelData() {
  loadConfig();
  render();
  await fetchPageStats();
}

// ── Data Fetching ───────────────────────────────────────────────────
async function fetchPageStats() {
  const funnel = getActiveFunnel();
  if (!funnel || funnel.pages.length === 0) {
    pageStats = {};
    render();
    return;
  }

  loading = true;
  render();

  try {
    const slugs = funnel.pages.map(p => p.slug).join(',');
    const url = `/api/funnel-page-stats?slugs=${encodeURIComponent(slugs)}&start=${dateRange.start}&end=${dateRange.end}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    pageStats = data.pages || {};
  } catch (err) {
    console.warn('[funnels] Failed to load page stats', err);
    pageStats = {};
  }

  loading = false;
  render();
}

// Known Vercel projects (update this list when you deploy new landing pages)
const KNOWN_PROJECTS = [
  { name: 'Chat Closer Checkout', slug: 'chat-closer-checkout', url: 'https://chat-closer-checkout.vercel.app' },
  { name: 'Chat Closer Workshop', slug: 'chat-closer-workshop', url: 'https://chat-closer-workshop.vercel.app' },
  { name: 'Swipe Page', slug: 'swipe-page', url: 'https://swipe-page.vercel.app' },
];

async function fetchPagePickerData() {
  // Only fetch once per session
  if (vercelProjects !== null) return;

  // Set known projects immediately so dropdown populates fast
  vercelProjects = [...KNOWN_PROJECTS];

  // Also fetch tracked slugs from Supabase (adds any extra pages with data)
  try {
    const res = await fetch('/api/funnel-stats?days=365');
    if (res.ok) {
      const data = await res.json();
      trackedSlugs = data.pages || [];
    } else {
      trackedSlugs = [];
    }
  } catch {
    trackedSlugs = [];
  }

  // Re-render the modal if it's open
  const modal = document.getElementById('addPageModal');
  if (modal && !modal.hidden) {
    render();
    openFunnelModal('addPageModal');
  }
}

// ── Rendering ───────────────────────────────────────────────────────
function render() {
  const container = $('#funnelsContainer');
  if (!container) return;

  if (funnelsConfig.length === 0) {
    container.innerHTML = renderEmptyState();
    return;
  }

  const funnel = getActiveFunnel();

  container.innerHTML = `
    <div class="section-header">
      <h1>Funnels</h1>
      <div class="section-actions" style="display:flex;gap:var(--space-2)">
        <button class="btn btn-ghost btn-sm" id="funnelAddPageBtn">+ Add Page</button>
        <button class="btn btn-ghost btn-sm" id="funnelNewBtn">+ New Funnel</button>
      </div>
    </div>

    ${renderFunnelTabs()}

    <div class="funnel-controls">
      <div class="funnel-date-range">
        <input type="date" id="funnelDateStart" class="funnel-date-input" value="${dateRange.start}">
        <span class="funnel-date-arrow">→</span>
        <input type="date" id="funnelDateEnd" class="funnel-date-input" value="${dateRange.end}">
        <button class="btn btn-sm btn-danger" id="funnelResetDates" style="margin-left:var(--space-2)">Reset</button>
      </div>
    </div>

    ${funnel && funnel.pages.length > 0 ? renderFunnelTable(funnel) : renderNoPages()}

    ${renderFunnelSettingsModal()}
    ${renderAddPageModal()}
    ${renderNewFunnelModal()}
  `;
}

function renderEmptyState() {
  return `
    <div class="section-header">
      <h1>Funnels</h1>
    </div>
    <div class="funnel-empty-state">
      <div class="funnel-empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>
        </svg>
      </div>
      <h2>No funnels yet</h2>
      <p class="text-secondary">Create your first funnel to start tracking page performance.</p>
      <button class="btn btn-primary" id="funnelCreateFirst">Create Funnel</button>
    </div>
    ${renderNewFunnelModal()}
  `;
}

function renderNoPages() {
  return `
    <div class="funnel-empty-state" style="padding:var(--space-8) 0">
      <p class="text-secondary">No pages in this funnel yet. Add pages to start tracking.</p>
      <button class="btn btn-primary btn-sm" id="funnelAddPageEmpty">+ Add Page</button>
    </div>
  `;
}

function renderFunnelTabs() {
  return `
    <div class="funnel-tabs">
      ${funnelsConfig.map(f => `
        <button class="funnel-tab ${f.id === activeFunnelId ? 'is-active' : ''}" data-funnel-id="${escapeHtml(f.id)}">
          ${escapeHtml(f.name)}
        </button>
      `).join('')}
      <button class="funnel-tab-settings" id="funnelSettingsBtn" title="Manage funnels">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
    </div>
  `;
}

function renderFunnelTable(funnel) {
  const pages = funnel.pages;

  // Calculate conversion between consecutive pages
  const conversionRates = [];
  for (let i = 0; i < pages.length; i++) {
    if (i === 0) {
      conversionRates.push(null);
    } else {
      const prevSlug = pages[i - 1].slug;
      const currSlug = pages[i].slug;
      const prevOptins = pageStats[prevSlug]?.optins?.all || 0;
      const currViews = pageStats[currSlug]?.views?.all || 0;
      if (prevOptins > 0 && currViews > 0) {
        conversionRates.push(((currViews / prevOptins) * 100).toFixed(1) + '%');
      } else {
        conversionRates.push('-');
      }
    }
  }

  return `
    <div class="funnel-table-wrapper">
      <table class="funnel-table">
        <thead>
          <tr class="funnel-table-group-row">
            <th class="funnel-table-name-col" rowspan="2"></th>
            <th class="funnel-col-group funnel-col-views" colspan="2">Page Views</th>
            <th class="funnel-col-group funnel-col-optins" colspan="2">Opt-Ins</th>
            <th class="funnel-col-group funnel-col-sales" colspan="5">Sales</th>
            <th class="funnel-col-group funnel-col-earnings" colspan="2">Earnings/Page View</th>
          </tr>
          <tr class="funnel-table-sub-row">
            <th class="funnel-col-views-sub">All</th>
            <th class="funnel-col-views-sub">Uniques</th>
            <th class="funnel-col-optins-sub">All</th>
            <th class="funnel-col-optins-sub">Rate</th>
            <th class="funnel-col-sales-sub">Orders</th>
            <th class="funnel-col-sales-sub">Rate</th>
            <th class="funnel-col-sales-sub">Quantity</th>
            <th class="funnel-col-sales-sub">Amount</th>
            <th class="funnel-col-sales-sub">Avg. cart v...</th>
            <th class="funnel-col-earnings-sub">All</th>
            <th class="funnel-col-earnings-sub">Uniques</th>
          </tr>
        </thead>
        <tbody>
          ${pages.map((page, idx) => renderPageRow(page, idx, conversionRates[idx])).join('')}
        </tbody>
      </table>
    </div>
    ${loading ? '<div class="text-sm text-tertiary" style="text-align:center;padding:var(--space-4)">Loading stats...</div>' : ''}
  `;
}

function renderPageRow(page, index, conversionRate) {
  const stats = pageStats[page.slug];
  const isExpanded = expandedRows.has(page.id);
  const hasData = stats && (stats.views.all > 0 || stats.optins.all > 0);

  const viewsAll = stats ? formatNumber(stats.views.all) : '-';
  const viewsUnique = stats ? formatNumber(stats.views.unique) : '-';
  const optinsAll = stats ? formatNumber(stats.optins.all) : '-';
  const optinsRate = stats ? stats.optins.rate : '-';

  // Build the conversion indicator between pages
  const conversionBadge = conversionRate && conversionRate !== '-'
    ? `<span class="funnel-conversion-badge">${conversionRate}</span>`
    : '';

  let rows = `
    <tr class="funnel-page-row ${isExpanded ? 'is-expanded' : ''}" data-page-id="${escapeHtml(page.id)}">
      <td class="funnel-table-name-cell">
        <button class="funnel-row-toggle ${hasData ? '' : 'is-hidden'}" data-toggle-page="${escapeHtml(page.id)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            ${isExpanded ? '<polyline points="6 9 12 15 18 9"/>' : '<polyline points="9 6 15 12 9 18"/>'}
          </svg>
        </button>
        <svg class="funnel-page-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
        </svg>
        <span class="funnel-page-name">${escapeHtml(page.name)}</span>
        ${conversionBadge}
        <button class="funnel-page-delete" data-delete-page="${escapeHtml(page.id)}" title="Remove page">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
      <td class="funnel-data-cell">${viewsAll}</td>
      <td class="funnel-data-cell">${viewsUnique}</td>
      <td class="funnel-data-cell">${optinsAll}</td>
      <td class="funnel-data-cell">${optinsRate}</td>
      <td class="funnel-data-cell">-</td>
      <td class="funnel-data-cell">-</td>
      <td class="funnel-data-cell">-</td>
      <td class="funnel-data-cell">-</td>
      <td class="funnel-data-cell">-</td>
      <td class="funnel-data-cell">-</td>
      <td class="funnel-data-cell">-</td>
    </tr>
  `;

  // Expanded daily breakdown
  if (isExpanded && stats?.daily?.length > 0) {
    rows += `
      <tr class="funnel-daily-header">
        <td colspan="12">
          <div class="funnel-daily-table-wrap">
            <table class="funnel-daily-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Views</th>
                  <th>Opt-Ins</th>
                  <th>Conv. Rate</th>
                </tr>
              </thead>
              <tbody>
                ${stats.daily.slice().reverse().map(d => {
                  const rate = d.views > 0 ? ((d.submissions / d.views) * 100).toFixed(1) + '%' : '-';
                  return `
                    <tr>
                      <td>${formatDateShort(d.date)}</td>
                      <td>${d.views}</td>
                      <td>${d.submissions}</td>
                      <td>${rate}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    `;
  }

  return rows;
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Modals ──────────────────────────────────────────────────────────
function renderNewFunnelModal() {
  return `
    <div class="funnel-modal-overlay" id="newFunnelModal" hidden>
      <div class="funnel-modal">
        <div class="funnel-modal-header">
          <h3>New Funnel</h3>
          <button class="funnel-modal-close" data-close-funnel-modal="newFunnelModal">&times;</button>
        </div>
        <div class="funnel-modal-body">
          <label class="funnel-label">Funnel Name</label>
          <input type="text" id="newFunnelName" class="funnel-input" placeholder="e.g. Workshop Funnel" autofocus>
        </div>
        <div class="funnel-modal-footer">
          <button class="btn btn-ghost btn-sm" data-close-funnel-modal="newFunnelModal">Cancel</button>
          <button class="btn btn-primary btn-sm" id="newFunnelSubmit">Create</button>
        </div>
      </div>
    </div>
  `;
}

function renderAddPageModal() {
  const isLoading = vercelProjects === null;
  const showManual = addPageMode === 'manual';

  // Build dropdown options from Vercel projects
  let optionsHtml = '<option value="">Select a page...</option>';

  if (isLoading) {
    optionsHtml = '<option value="">Loading your Vercel pages...</option>';
  }

  if (vercelProjects?.length > 0) {
    for (const p of vercelProjects) {
      const displayUrl = p.url ? p.url.replace('https://', '') : '';
      const label = displayUrl ? `${p.name} — ${displayUrl}` : p.name;
      const val = escapeHtml(JSON.stringify({ name: p.name, slug: p.slug, url: p.url || '' }));
      optionsHtml += `<option value='${val}'>${escapeHtml(label)}</option>`;
    }
  }

  if (trackedSlugs?.length > 0) {
    // Add tracked slugs that aren't already Vercel projects
    const vercelSlugs = new Set((vercelProjects || []).map(p => p.slug));
    const extraSlugs = trackedSlugs.filter(s => !vercelSlugs.has(s));
    if (extraSlugs.length > 0) {
      optionsHtml += '<optgroup label="Other Tracked Pages">';
      for (const slug of extraSlugs) {
        const name = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const val = escapeHtml(JSON.stringify({ name, slug, url: '' }));
        optionsHtml += `<option value='${val}'>${escapeHtml(name)}</option>`;
      }
      optionsHtml += '</optgroup>';
    }
  }

  return `
    <div class="funnel-modal-overlay" id="addPageModal" hidden>
      <div class="funnel-modal">
        <div class="funnel-modal-header">
          <h3>Add Page to Funnel</h3>
          <button class="funnel-modal-close" data-close-funnel-modal="addPageModal">&times;</button>
        </div>
        <div class="funnel-modal-body">
          ${!showManual ? `
            <label class="funnel-label">Choose a page</label>
            <select id="addPagePicker" class="funnel-input funnel-select-lg">
              ${optionsHtml}
            </select>
            <div id="addPagePickerPreview" class="funnel-picker-preview" style="display:none"></div>
            <div style="margin-top:var(--space-3)">
              <button class="btn btn-ghost btn-xs" id="addPageManualToggle">Enter manually instead</button>
            </div>
          ` : `
            <label class="funnel-label">Page Name</label>
            <input type="text" id="addPageName" class="funnel-input" placeholder="e.g. Checkout Page">
            <label class="funnel-label" style="margin-top:var(--space-3)">Slug</label>
            <input type="text" id="addPageSlug" class="funnel-input" placeholder="e.g. checkout-page">
            <div style="margin-top:var(--space-3)">
              <button class="btn btn-ghost btn-xs" id="addPagePickerToggle">Choose from Vercel instead</button>
            </div>
          `}
        </div>
        <div class="funnel-modal-footer">
          <button class="btn btn-ghost btn-sm" data-close-funnel-modal="addPageModal">Cancel</button>
          <button class="btn btn-primary btn-sm" id="addPageSubmit">Add Page</button>
        </div>
      </div>
    </div>
  `;
}

function renderFunnelSettingsModal() {
  return `
    <div class="funnel-modal-overlay" id="funnelSettingsModal" hidden>
      <div class="funnel-modal">
        <div class="funnel-modal-header">
          <h3>Manage Funnels</h3>
          <button class="funnel-modal-close" data-close-funnel-modal="funnelSettingsModal">&times;</button>
        </div>
        <div class="funnel-modal-body">
          ${funnelsConfig.map(f => `
            <div class="funnel-settings-item">
              <span>${escapeHtml(f.name)}</span>
              <div style="display:flex;gap:var(--space-2)">
                <button class="btn btn-ghost btn-xs" data-rename-funnel="${escapeHtml(f.id)}">Rename</button>
                <button class="btn btn-ghost btn-xs text-danger" data-delete-funnel="${escapeHtml(f.id)}">Delete</button>
              </div>
            </div>
          `).join('')}
          ${funnelsConfig.length === 0 ? '<p class="text-sm text-tertiary">No funnels created yet.</p>' : ''}
        </div>
        <div class="funnel-modal-footer">
          <button class="btn btn-ghost btn-sm" data-close-funnel-modal="funnelSettingsModal">Close</button>
        </div>
      </div>
    </div>
  `;
}

// ── Events ──────────────────────────────────────────────────────────
function bindEvents() {
  const container = $('#funnelsContainer');
  if (!container) return;

  container.addEventListener('click', (e) => {
    // Create first funnel
    if (e.target.closest('#funnelCreateFirst')) {
      openFunnelModal('newFunnelModal');
      return;
    }

    // New funnel button
    if (e.target.closest('#funnelNewBtn')) {
      openFunnelModal('newFunnelModal');
      return;
    }

    // Add page button
    if (e.target.closest('#funnelAddPageBtn') || e.target.closest('#funnelAddPageEmpty')) {
      addPageMode = 'picker';
      render();
      openFunnelModal('addPageModal');
      fetchPagePickerData();
      return;
    }

    // Settings button
    if (e.target.closest('#funnelSettingsBtn')) {
      openFunnelModal('funnelSettingsModal');
      return;
    }

    // Close modal
    const closeBtn = e.target.closest('[data-close-funnel-modal]');
    if (closeBtn) {
      closeFunnelModal(closeBtn.dataset.closeFunnelModal);
      return;
    }

    // Modal overlay click to close
    const overlay = e.target.closest('.funnel-modal-overlay');
    if (overlay && e.target === overlay) {
      overlay.hidden = true;
      return;
    }

    // Switch funnel tab
    const funnelTab = e.target.closest('[data-funnel-id]');
    if (funnelTab) {
      activeFunnelId = funnelTab.dataset.funnelId;
      expandedRows.clear();
      pageStats = {};
      render();
      fetchPageStats();
      return;
    }

    // Toggle row expansion
    const toggleBtn = e.target.closest('[data-toggle-page]');
    if (toggleBtn) {
      const pageId = toggleBtn.dataset.togglePage;
      if (expandedRows.has(pageId)) {
        expandedRows.delete(pageId);
      } else {
        expandedRows.add(pageId);
      }
      render();
      return;
    }

    // Delete page
    const deletePageBtn = e.target.closest('[data-delete-page]');
    if (deletePageBtn) {
      const pageId = deletePageBtn.dataset.deletePage;
      const funnel = getActiveFunnel();
      if (funnel) {
        funnel.pages = funnel.pages.filter(p => p.id !== pageId);
        saveConfig();
        render();
        fetchPageStats();
      }
      return;
    }

    // Create funnel submit
    if (e.target.closest('#newFunnelSubmit')) {
      const nameInput = $('#newFunnelName');
      const name = nameInput?.value.trim();
      if (!name) {
        showToast('Enter a funnel name', 'error');
        return;
      }
      const newFunnel = { id: generateId(), name, pages: [] };
      funnelsConfig.push(newFunnel);
      activeFunnelId = newFunnel.id;
      saveConfig();
      closeFunnelModal('newFunnelModal');
      render();
      return;
    }

    // Toggle between picker and manual mode
    if (e.target.closest('#addPageManualToggle')) {
      addPageMode = 'manual';
      render();
      openFunnelModal('addPageModal');
      return;
    }
    if (e.target.closest('#addPagePickerToggle')) {
      addPageMode = 'picker';
      render();
      openFunnelModal('addPageModal');
      fetchPagePickerData();
      return;
    }

    // Add page submit
    if (e.target.closest('#addPageSubmit')) {
      let name, slug;

      if (addPageMode === 'picker') {
        // Get value from dropdown
        const picker = $('#addPagePicker');
        const val = picker?.value;
        if (!val) {
          showToast('Select a page from the dropdown', 'error');
          return;
        }
        try {
          const parsed = JSON.parse(val);
          name = parsed.name;
          slug = parsed.slug;
        } catch {
          showToast('Invalid selection', 'error');
          return;
        }
      } else {
        // Manual mode
        const nameInput = $('#addPageName');
        const slugInput = $('#addPageSlug');
        name = nameInput?.value.trim();
        slug = slugInput?.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      }

      if (!name || !slug) {
        showToast('Select or enter a page', 'error');
        return;
      }
      const funnel = getActiveFunnel();
      if (funnel) {
        funnel.pages.push({ id: generateId(), name, slug });
        saveConfig();
        addPageMode = 'picker'; // reset for next time
        closeFunnelModal('addPageModal');
        render();
        fetchPageStats();
      }
      return;
    }

    // Reset dates
    if (e.target.closest('#funnelResetDates')) {
      dateRange = getDefaultDateRange();
      render();
      fetchPageStats();
      return;
    }

    // Delete funnel
    const deleteFunnelBtn = e.target.closest('[data-delete-funnel]');
    if (deleteFunnelBtn) {
      const funnelId = deleteFunnelBtn.dataset.deleteFunnel;
      funnelsConfig = funnelsConfig.filter(f => f.id !== funnelId);
      if (activeFunnelId === funnelId) {
        activeFunnelId = funnelsConfig.length > 0 ? funnelsConfig[0].id : null;
      }
      saveConfig();
      closeFunnelModal('funnelSettingsModal');
      render();
      if (activeFunnelId) fetchPageStats();
      return;
    }

    // Rename funnel
    const renameFunnelBtn = e.target.closest('[data-rename-funnel]');
    if (renameFunnelBtn) {
      const funnelId = renameFunnelBtn.dataset.renameFunnel;
      const funnel = funnelsConfig.find(f => f.id === funnelId);
      if (funnel) {
        const newName = prompt('Rename funnel:', funnel.name);
        if (newName && newName.trim()) {
          funnel.name = newName.trim();
          saveConfig();
          closeFunnelModal('funnelSettingsModal');
          render();
        }
      }
      return;
    }
  });

  // Date range changes + page picker
  container.addEventListener('change', (e) => {
    if (e.target.id === 'funnelDateStart') {
      dateRange.start = e.target.value;
      fetchPageStats();
    }
    if (e.target.id === 'funnelDateEnd') {
      dateRange.end = e.target.value;
      fetchPageStats();
    }
    // Page picker dropdown — show preview
    if (e.target.id === 'addPagePicker') {
      const val = e.target.value;
      const preview = $('#addPagePickerPreview');
      if (!val || !preview) {
        if (preview) preview.style.display = 'none';
        return;
      }
      try {
        const parsed = JSON.parse(val);
        preview.style.display = 'block';
        preview.innerHTML = `
          <div class="funnel-picker-preview-name">${escapeHtml(parsed.name)}</div>
          ${parsed.url ? `<div class="funnel-picker-preview-url">${escapeHtml(parsed.url)}</div>` : ''}
        `;
      } catch { preview.style.display = 'none'; }
    }
  });

  // Enter key in modals
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.target.id === 'newFunnelName') {
        e.preventDefault();
        $('#newFunnelSubmit')?.click();
      }
      if (e.target.id === 'addPageName' || e.target.id === 'addPageSlug') {
        e.preventDefault();
        $('#addPageSubmit')?.click();
      }
    }
  });
}

function openFunnelModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.hidden = false;
    const input = modal.querySelector('input');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 50);
    }
  }
}

function closeFunnelModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = true;
}
