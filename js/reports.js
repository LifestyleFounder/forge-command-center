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

// ── Events ──────────────────────────────────────────────────────────
function bindReportEvents() {
  const container = $('#reportsContainer');
  if (!container) return;

  container.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-report-tab]');
    if (tab) {
      activeSubtab = tab.dataset.reportTab;
      renderReports();
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
