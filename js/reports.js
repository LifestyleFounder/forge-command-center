// js/reports.js — Reports tab (Memory, Schedules, Activity, Documents)
// ──────────────────────────────────────────────────────────────────────

import {
  getState, subscribe, loadJSON, setState,
  escapeHtml, formatNumber, formatDate, formatRelativeTime,
  debounce, $, $$, showToast
} from './app.js';

// ── State ────────────────────────────────────────────────────────────
let activeSubtab = 'reports-schedules';
let schedulesData = null;
let docsIndexData = null;
let funnelData = null;
let funnelDays = 30;
let funnelRange = '30d'; // '1d-today', '1d-yesterday', '7d', '30d', '90d'
let funnelSlug = 'all';
let funnelPages = [];
let funnelChartInstance = null;
let funnelSubmissions = null; // cached submissions list
let funnelSubmissionsOpen = false; // toggle state

const FUNNEL_PAGE_NAMES = {
  'free-skool': 'Free Skool',
  'application': 'Application',
};

// What "submissions" means per page
const SUBMISSION_LABELS = {
  'free-skool': 'Leads',
  'application': 'Applicants',
  'all': 'Submissions',
};

// ── Public init ──────────────────────────────────────────────────────
export function initReports() {
  bindReportEvents();
}

export async function loadReportData() {
  try {
    const [schedules, docsIndex] = await Promise.all([
      loadJSON('schedules.json'),
      loadJSON('docs-index.json'),
    ]);
    schedulesData = schedules;
    docsIndexData = docsIndex;
  } catch (err) {
    console.warn('[reports] Failed to load data', err);
  }
  renderReports();
}

// ── Rendering ────────────────────────────────────────────────────────
function renderReports() {
  const container = $('#reportsContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="subtabs subtabs-sm" role="tablist">
      <button class="subtab ${activeSubtab === 'reports-schedules' ? 'is-active' : ''}" data-report-tab="reports-schedules" role="tab">Schedules</button>
      <button class="subtab ${activeSubtab === 'reports-activity' ? 'is-active' : ''}" data-report-tab="reports-activity" role="tab">Activity</button>
      <button class="subtab ${activeSubtab === 'reports-docs' ? 'is-active' : ''}" data-report-tab="reports-docs" role="tab">Documents</button>
      <button class="subtab ${activeSubtab === 'reports-memory' ? 'is-active' : ''}" data-report-tab="reports-memory" role="tab">Memory</button>
      <button class="subtab ${activeSubtab === 'reports-funnels' ? 'is-active' : ''}" data-report-tab="reports-funnels" role="tab">Funnels</button>
    </div>
    <div class="report-panel">
      ${renderActiveReport()}
    </div>
  `;
}

function renderActiveReport() {
  switch (activeSubtab) {
    case 'reports-schedules': return renderSchedules();
    case 'reports-activity': return renderActivity();
    case 'reports-docs': return renderDocsIndex();
    case 'reports-memory': return renderMemory();
    case 'reports-funnels': return renderFunnels();
    default: return '';
  }
}

// ── Schedules ────────────────────────────────────────────────────────
function renderSchedules() {
  const data = schedulesData;
  if (!data || !data.schedules) {
    return '<div class="empty-state"><p>No schedule data loaded.</p></div>';
  }

  return `
    <div class="schedule-grid">
      ${data.schedules.map(s => {
        const statusClass = s.lastStatus === 'success' ? 'success' : s.lastStatus === 'error' ? 'error' : 'neutral';
        return `
          <div class="schedule-card">
            <div class="schedule-card-header">
              <span class="schedule-name">${escapeHtml(s.name)}</span>
              <span class="badge badge-${s.enabled ? 'success' : 'neutral'}">${s.enabled ? 'Active' : 'Paused'}</span>
            </div>
            <p class="schedule-desc text-sm text-secondary">${escapeHtml(s.description)}</p>
            <div class="schedule-meta">
              <div class="schedule-meta-item">
                <span class="label">Schedule:</span>
                <span>${escapeHtml(s.humanSchedule)}</span>
              </div>
              <div class="schedule-meta-item">
                <span class="label">Last run:</span>
                <span class="badge badge-sm badge-${statusClass}">${s.lastRun ? formatRelativeTime(s.lastRun) : 'Never'}</span>
              </div>
              <div class="schedule-meta-item">
                <span class="label">Next:</span>
                <span>${s.nextRun ? formatDate(s.nextRun) : '--'}</span>
              </div>
              ${s.channel ? `<div class="schedule-meta-item"><span class="label">Channel:</span><span class="badge badge-sm badge-neutral">${escapeHtml(s.channel)}</span></div>` : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
    ${data.lastUpdated ? `<div class="text-xs text-tertiary" style="margin-top:var(--space-4)">Last updated: ${formatRelativeTime(data.lastUpdated)}</div>` : ''}
  `;
}

// ── Activity ─────────────────────────────────────────────────────────
function renderActivity() {
  const activitiesData = getState('activities');
  const entries = activitiesData?.entries || [];

  if (entries.length === 0) {
    return '<div class="empty-state"><p>No activity recorded yet.</p></div>';
  }

  const ICONS = {
    system: '🔧', task: '✅', scheduled: '🕒',
    communication: '💬', research: '🔍', default: '●'
  };

  return `
    <div class="report-activity-toolbar">
      <input type="search" class="input-search" id="reportActivitySearch" placeholder="Filter activity..." aria-label="Filter activity">
    </div>
    <div class="activity-timeline" id="reportActivityList">
      ${entries.slice(0, 50).map(entry => `
        <div class="activity-timeline-item" data-type="${escapeHtml(entry.type || '')}">
          <span class="activity-timeline-icon">${ICONS[entry.type] || ICONS.default}</span>
          <div class="activity-timeline-content">
            <span class="activity-timeline-action">${escapeHtml(entry.action || '')}</span>
            ${entry.details ? `<span class="activity-timeline-details text-xs text-tertiary">${escapeHtml(entry.details.slice(0, 200))}${entry.details.length > 200 ? '...' : ''}</span>` : ''}
          </div>
          <span class="activity-timeline-time text-xs text-tertiary">${formatRelativeTime(entry.timestamp)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Documents Index ──────────────────────────────────────────────────
function renderDocsIndex() {
  const data = docsIndexData;
  if (!data || !data.docs) {
    return '<div class="empty-state"><p>No document index loaded.</p></div>';
  }

  const grouped = {};
  data.docs.forEach(d => {
    const cat = d.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(d);
  });

  return `
    <div class="docs-index">
      ${Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([cat, docs]) => `
        <div class="docs-group">
          <h3 class="docs-group-title">${escapeHtml(cat.charAt(0).toUpperCase() + cat.slice(1))}</h3>
          ${docs.map(d => `
            <div class="doc-index-item">
              <span class="doc-index-title">${escapeHtml(d.title)}</span>
              <span class="doc-index-date text-xs text-tertiary">${d.date ? formatDate(d.date) : ''}</span>
              ${d.notionUrl ? `<a href="${escapeHtml(d.notionUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs">Notion ↗</a>` : ''}
            </div>
          `).join('')}
        </div>
      `).join('')}
    </div>
    <div class="text-xs text-tertiary" style="margin-top:var(--space-4)">
      ${data.docs.length} documents indexed
      ${data.directories ? ` across ${data.directories.length} directories` : ''}
    </div>
  `;
}

// ── Memory ───────────────────────────────────────────────────────────
function renderMemory() {
  const agents = getState('agents');
  const agentsList = agents?.agents || [];

  const geeves = agentsList.find(a => a.id === 'geeves');
  const recentActivity = geeves?.recentActivity || [];

  return `
    <div class="memory-section">
      <h3>Agent Memory</h3>
      <div class="memory-entries">
        ${agentsList.map(a => `
          <div class="memory-card">
            <div class="memory-card-header">
              <span>${a.emoji || '🤖'} ${escapeHtml(a.name)}</span>
              <span class="badge badge-${a.status === 'online' ? 'success' : 'neutral'}">${escapeHtml(a.status)}</span>
            </div>
            <div class="memory-card-body text-sm text-secondary">
              <div>${escapeHtml(a.role)}</div>
              ${a.currentTask ? `<div class="text-xs">Current: ${escapeHtml(a.currentTask)}</div>` : ''}
              <div class="text-xs">Tasks completed: ${a.tasksCompleted || 0}</div>
              ${a.lastActive ? `<div class="text-xs">Last active: ${formatRelativeTime(a.lastActive)}</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ${recentActivity.length > 0 ? `
      <div class="memory-section">
        <h3>Geeves Recent Activity</h3>
        <div class="memory-timeline">
          ${recentActivity.map(a => `
            <div class="memory-timeline-item">
              <span class="badge badge-sm badge-${a.status === 'done' ? 'success' : 'info'}">${escapeHtml(a.status)}</span>
              <span class="text-sm">${escapeHtml(a.action)}</span>
              <span class="text-xs text-tertiary">${a.time ? formatRelativeTime(a.time) : ''}</span>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

// ── Funnels ─────────────────────────────────────────────────────────
function renderFunnels() {
  const s = funnelData?.summary;
  const loading = !funnelData;

  const pageOptions = funnelPages
    .filter(slug => slug in FUNNEL_PAGE_NAMES)
    .map(slug => {
      const name = FUNNEL_PAGE_NAMES[slug];
      return `<option value="${escapeHtml(slug)}" ${funnelSlug === slug ? 'selected' : ''}>${escapeHtml(name)}</option>`;
    }).join('');

  const subLabel = SUBMISSION_LABELS[funnelSlug] || 'Submissions';

  return `
    <div class="funnel-toolbar" style="display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-4);align-items:center">
      <select id="funnelPageSelect" class="input-search" style="padding:var(--space-1) var(--space-2);font-size:var(--text-sm);min-width:160px;max-width:240px">
        <option value="all" ${funnelSlug === 'all' ? 'selected' : ''}>All Funnels</option>
        ${pageOptions}
      </select>
      <div class="funnel-range-btns" style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        <button class="btn btn-sm ${funnelRange === '1d-today' ? 'btn-primary' : 'btn-ghost'}" data-funnel-range="1d-today">Today</button>
        <button class="btn btn-sm ${funnelRange === '1d-yesterday' ? 'btn-primary' : 'btn-ghost'}" data-funnel-range="1d-yesterday">Yesterday</button>
        <button class="btn btn-sm ${funnelRange === '7d' ? 'btn-primary' : 'btn-ghost'}" data-funnel-range="7d">7d</button>
        <button class="btn btn-sm ${funnelRange === '30d' ? 'btn-primary' : 'btn-ghost'}" data-funnel-range="30d">30d</button>
        <button class="btn btn-sm ${funnelRange === '90d' ? 'btn-primary' : 'btn-ghost'}" data-funnel-range="90d">90d</button>
      </div>
    </div>
    <div class="funnel-summary-row">
      <div class="meta-chart-card" style="text-align:center;padding:var(--space-5)">
        <div class="text-xs text-secondary" style="margin-bottom:var(--space-1)">Page Views</div>
        <div style="font-size:var(--text-2xl);font-weight:700;color:var(--text-primary)">${loading ? '--' : formatNumber(s.views)}</div>
      </div>
      <div class="meta-chart-card" id="funnelSubmissionsCard" style="text-align:center;padding:var(--space-5);cursor:pointer;transition:box-shadow 0.15s ease" title="Click to view ${escapeHtml(subLabel).toLowerCase()}">
        <div class="text-xs text-secondary" style="margin-bottom:var(--space-1)">${escapeHtml(subLabel)} ▾</div>
        <div style="font-size:var(--text-2xl);font-weight:700;color:var(--text-primary)">${loading ? '--' : formatNumber(s.submissions)}</div>
      </div>
      <div class="meta-chart-card" style="text-align:center;padding:var(--space-5)">
        <div class="text-xs text-secondary" style="margin-bottom:var(--space-1)">Conversion Rate</div>
        <div style="font-size:var(--text-2xl);font-weight:700;color:var(--text-primary)">${loading ? '--' : s.conversionRate + '%'}</div>
      </div>
    </div>
    <div class="meta-chart-card">
      <h3>Daily Views &amp; Submissions</h3>
      <canvas id="funnelChart"></canvas>
    </div>
    ${funnelSubmissionsOpen ? renderSubmissionsPanel(subLabel) : ''}
    ${funnelData?.lastUpdated ? `<div class="text-xs text-tertiary" style="margin-top:var(--space-4)">Last updated: ${formatRelativeTime(funnelData.lastUpdated)}</div>` : ''}
  `;
}

function renderSubmissionsPanel(label) {
  if (!funnelSubmissions) {
    return `
      <div class="meta-chart-card" style="margin-top:var(--space-3);padding:var(--space-4)">
        <h3>${escapeHtml(label)}</h3>
        <div class="text-sm text-tertiary" style="padding:var(--space-4) 0;text-align:center">Loading...</div>
      </div>
    `;
  }

  if (funnelSubmissions.length === 0) {
    return `
      <div class="meta-chart-card" style="margin-top:var(--space-3);padding:var(--space-4)">
        <h3>${escapeHtml(label)}</h3>
        <div class="text-sm text-tertiary" style="padding:var(--space-4) 0;text-align:center">No submissions in this period.</div>
      </div>
    `;
  }

  const PAGE_NAMES = { 'free-skool': 'Free Skool', 'application': 'Application' };

  return `
    <div class="meta-chart-card" style="margin-top:var(--space-3);padding:var(--space-4)">
      <h3>${escapeHtml(label)} (${funnelSubmissions.length})</h3>
      <div class="activity-timeline" style="margin-top:var(--space-3)">
        ${funnelSubmissions.map(sub => {
          const primary = sub.name || sub.email || 'Anonymous';
          const secondary = sub.name && sub.email ? sub.email : '';
          const pageName = PAGE_NAMES[sub.page] || sub.page;
          return `
            <div class="activity-timeline-item">
              <span class="activity-timeline-icon" style="font-size:var(--text-base)">●</span>
              <div class="activity-timeline-content">
                <span class="activity-timeline-action">${escapeHtml(primary)}</span>
                <span class="activity-timeline-details text-xs text-tertiary">${[secondary, sub.phone, pageName].filter(Boolean).map(escapeHtml).join(' · ')}</span>
              </div>
              <span class="activity-timeline-time text-xs text-tertiary">${formatRelativeTime(sub.timestamp)}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

async function loadSubmissions() {
  try {
    const rangeParams = funnelRangeToParams(funnelRange);
    let url = `/api/funnel-submissions?${rangeParams}`;
    if (funnelSlug && funnelSlug !== 'all') url += `&slug=${encodeURIComponent(funnelSlug)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    funnelSubmissions = data.submissions || [];
  } catch (err) {
    console.warn('[reports] Failed to load submissions', err);
    funnelSubmissions = [];
  }
  renderReports();
  requestAnimationFrame(() => renderFunnelChart());
}

function funnelRangeToParams(range) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  switch (range) {
    case '1d-today':
      return `start=${todayStr}&end=${todayStr}`;
    case '1d-yesterday':
      return `start=${yesterdayStr}&end=${yesterdayStr}`;
    case '7d':
      return 'days=7';
    case '90d':
      return 'days=90';
    case '30d':
    default:
      return 'days=30';
  }
}

async function loadFunnelStats(range) {
  if (range) funnelRange = range;
  try {
    const rangeParams = funnelRangeToParams(funnelRange);
    let url = `/api/funnel-stats?${rangeParams}`;
    if (funnelSlug && funnelSlug !== 'all') url += `&slug=${encodeURIComponent(funnelSlug)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    funnelData = await res.json();
    if (funnelData.pages) funnelPages = funnelData.pages;
  } catch (err) {
    console.warn('[reports] Failed to load funnel stats', err);
    funnelData = null;
  }
  renderReports();
  // Render chart after DOM update
  requestAnimationFrame(() => renderFunnelChart());
}

function renderFunnelChart() {
  if (typeof Chart === 'undefined' || !funnelData?.daily?.length) return;

  const canvas = document.getElementById('funnelChart');
  if (!canvas) return;

  if (funnelChartInstance) funnelChartInstance.destroy();

  const labels = funnelData.daily.map(d =>
    new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  );
  const viewsData = funnelData.daily.map(d => d.views);
  const subsData = funnelData.daily.map(d => d.submissions);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const lineColor = isDark ? '#C8A24A' : '#2d5016';
  const fillColor = isDark ? 'rgba(200,162,74,0.15)' : 'rgba(45,80,22,0.15)';
  const barColor = isDark ? 'rgba(200,162,74,0.8)' : 'rgba(193,154,72,0.8)';
  const textColor = isDark ? '#9CA3AF' : '#6B7280';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  funnelChartInstance = new Chart(canvas, {
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: 'Page Views',
          data: viewsData,
          borderColor: lineColor,
          backgroundColor: fillColor,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: lineColor,
          order: 1,
        },
        {
          type: 'bar',
          label: 'Submissions',
          data: subsData,
          backgroundColor: barColor,
          borderRadius: 4,
          barPercentage: 0.4,
          order: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { color: textColor, boxWidth: 12 } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } },
        x: { ticks: { color: textColor, maxRotation: 45 }, grid: { display: false } },
      },
    },
  });
}

// ── Events ──────────────────────────────────────────────────────────
function bindReportEvents() {
  const container = $('#reportsContainer');
  if (!container) return;

  container.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-report-tab]');
    if (tab) {
      activeSubtab = tab.dataset.reportTab;
      renderReports();
      if (activeSubtab === 'reports-funnels' && !funnelData) {
        loadFunnelStats(funnelRange);
      } else if (activeSubtab === 'reports-funnels') {
        requestAnimationFrame(() => renderFunnelChart());
      }
    }

    // Submissions card click — toggle detail panel
    const subCard = e.target.closest('#funnelSubmissionsCard');
    if (subCard) {
      funnelSubmissionsOpen = !funnelSubmissionsOpen;
      if (funnelSubmissionsOpen) {
        funnelSubmissions = null; // trigger loading state
        renderReports();
        requestAnimationFrame(() => renderFunnelChart());
        loadSubmissions();
      } else {
        renderReports();
        requestAnimationFrame(() => renderFunnelChart());
      }
    }

    const rangeBtn = e.target.closest('[data-funnel-range]');
    if (rangeBtn) {
      funnelSubmissions = null;
      funnelSubmissionsOpen = false;
      loadFunnelStats(rangeBtn.dataset.funnelRange);
    }
  });

  container.addEventListener('change', (e) => {
    if (e.target.id === 'funnelPageSelect') {
      funnelSlug = e.target.value;
      funnelSubmissions = null;
      funnelSubmissionsOpen = false;
      loadFunnelStats(funnelRange);
    }
  });

  container.addEventListener('input', (e) => {
    if (e.target.id === 'reportActivitySearch') {
      const query = e.target.value.toLowerCase().trim();
      filterReportActivity(query);
    }
  });
}

function filterReportActivity(query) {
  const items = $$('#reportActivityList .activity-timeline-item');
  items.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = !query || text.includes(query) ? '' : 'none';
  });
}
