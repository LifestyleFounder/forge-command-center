/* ============================================================
   home.js — Forge Command Center Home Tab
   Tasks, schedule, client health, VIP metrics, greeting
   ============================================================ */

import {
  getState,
  subscribe,
  escapeHtml,
  formatDate,
  daysBetween,
  $,
  $$,
  showToast,
  loadJSON,
  setState,
  switchTab
} from './app.js';
import { getUpcomingTasks, completeTaskFromHome } from './google-tasks.js';

// ---- DOM Cache (module-scoped) --------------------------------

let el = {};

function cacheHomeElements() {
  el = {
    greeting: $('#homeGreeting'),
    healthSummary: $('#healthSummary'),
    clientsHealthy: $('#clientsHealthy'),
    clientsWarning: $('#clientsWarning'),
    clientsAtRisk: $('#clientsAtRisk'),
    clientsStaleness: $('#clientsStaleness'),
    clientExpand: $('#clientExpand'),
    clientExpandTitle: $('#clientExpandTitle'),
    clientExpandItems: $('#clientExpandItems'),
    closeClientExpand: $('#closeClientExpand'),
    clientAlerts: $('#clientAlerts'),
    clientVipAlerts: $('#clientVipAlerts'),
    refreshAllBtn: $('#refreshAllBtn'),
    vipActiveCount: $('#vipActiveCount'),
    vipMrr: $('#vipMrr'),
    vipAtRiskCount: $('#vipAtRiskCount'),
    vipToGoal: $('#vipToGoal'),
  };
}

// ---- Public Init ----------------------------------------------

export function initHome() {
  cacheHomeElements();

  renderClientHealth();
  renderVipMetrics();
  updateGreeting();
  renderUpcomingTasks();

  // Subscribe to state changes
  subscribe((key) => {
    if (key === 'business') {
      renderClientHealth();
    }
    if (key === 'vipClients') {
      renderVipAlerts();
      renderVipMetrics();
    }
  });

  // Event delegation for client health buttons
  if (el.healthSummary) {
    el.healthSummary.addEventListener('click', handleHealthClick);
  }

  // Close client expand panel
  if (el.closeClientExpand) {
    el.closeClientExpand.addEventListener('click', () => {
      if (el.clientExpand) el.clientExpand.hidden = true;
      // Reset aria-expanded on health stats
      $$('.health-stat', el.healthSummary).forEach(btn => {
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Refresh all data
  if (el.refreshAllBtn) {
    el.refreshAllBtn.addEventListener('click', handleRefreshAll);
  }

  // Tasks card: View All → Google Tasks tab
  $('#tasksViewAllBtn')?.addEventListener('click', () => switchTab('google-tasks'));

  // Calendar card: Full View → Calendar tab
  $('#calendarFullViewBtn')?.addEventListener('click', () => switchTab('calendar'));

  // Tasks card: checkbox delegation (complete on click)
  const tasksBody = $('#upcomingTasksBody');
  if (tasksBody) {
    tasksBody.addEventListener('click', async (e) => {
      const checkbox = e.target.closest('.home-task-checkbox');
      if (!checkbox) return;
      const taskId = checkbox.dataset.taskId;
      const listId = checkbox.dataset.listId;
      if (!taskId || !listId) return;

      // Visual feedback
      checkbox.classList.add('is-completing');
      checkbox.textContent = '\u2713';
      const row = checkbox.closest('.home-task-item');
      if (row) row.classList.add('home-task-completing');

      const result = await completeTaskFromHome(listId, taskId);
      if (result) {
        setTimeout(() => {
          renderUpcomingTasks();
          showToast('Task completed', 'success');
        }, 500);
      } else {
        checkbox.classList.remove('is-completing');
        checkbox.textContent = '';
        if (row) row.classList.remove('home-task-completing');
        showToast('Failed to complete task', 'error');
      }
    });
  }
}

// ---- Greeting -------------------------------------------------

function updateGreeting() {
  if (!el.greeting) return;
  const hour = new Date().getHours();
  let period;
  if (hour < 12) period = 'morning';
  else if (hour < 17) period = 'afternoon';
  else period = 'evening';
  el.greeting.textContent = `Good ${period}, Dan`;
}

// ---- VIP Metrics (4-card row) ---------------------------------

function renderVipMetrics() {
  const VIP_GOAL = 72;
  const data = getState('vipClients');
  if (!data || !data.clients) return;

  const clients = data.clients;
  const activeCount = clients.filter(c => c.status === 'Active').length;
  const atRiskCount = clients.filter(c => c.status === 'At Risk').length;
  const mrr = activeCount * 1000;
  const toGoal = VIP_GOAL - activeCount;

  if (el.vipActiveCount) el.vipActiveCount.textContent = activeCount;
  if (el.vipMrr) el.vipMrr.textContent = '$' + mrr.toLocaleString();
  if (el.vipAtRiskCount) el.vipAtRiskCount.textContent = atRiskCount;
  if (el.vipToGoal) el.vipToGoal.textContent = toGoal;
}

// ---- Client Health --------------------------------------------

function renderClientHealth() {
  const biz = getState().business;
  if (!biz || !biz.clients) return;

  const healthy = biz.clients.healthy || [];
  const warning = biz.clients.warning || [];
  const atRisk = biz.clients.atRisk || [];

  // Update counts
  if (el.clientsHealthy) el.clientsHealthy.textContent = healthy.length;
  if (el.clientsWarning) el.clientsWarning.textContent = warning.length;
  if (el.clientsAtRisk) el.clientsAtRisk.textContent = atRisk.length;

  // Staleness badge
  renderStaleness();

  // Alerts
  renderAlerts();
}

function renderStaleness() {
  if (!el.clientsStaleness) return;
  const biz = getState().business;
  if (!biz || !biz.lastUpdated) {
    el.clientsStaleness.textContent = '';
    return;
  }
  const days = daysBetween(biz.lastUpdated, null);
  if (days === null) {
    el.clientsStaleness.textContent = '';
    return;
  }

  let colorClass;
  let label;
  if (days === 0) {
    colorClass = 'staleness-fresh';
    label = 'Updated today';
  } else if (days <= 3) {
    colorClass = 'staleness-recent';
    label = `${days}d ago`;
  } else {
    colorClass = 'staleness-stale';
    label = `${days}d ago`;
  }

  el.clientsStaleness.className = `staleness ${colorClass}`;
  el.clientsStaleness.textContent = label;
}

function renderAlerts() {
  if (!el.clientAlerts) return;
  const biz = getState().business;
  if (!biz || !biz.clients || !biz.clients.alerts || biz.clients.alerts.length === 0) {
    el.clientAlerts.innerHTML = '';
    return;
  }

  el.clientAlerts.innerHTML = biz.clients.alerts.map(alert => `
    <div class="client-alert alert-${escapeHtml(alert.type)}">
      <span class="alert-icon">${alert.type === 'warning' ? '\u26A0' : alert.type === 'success' ? '\u2705' : '\u2139'}</span>
      <span class="alert-text">${escapeHtml(alert.text)}</span>
    </div>
  `).join('');
}

function handleHealthClick(e) {
  const stat = e.target.closest('.health-stat');
  if (!stat) return;

  const healthKey = stat.dataset.health;
  if (!healthKey) return;

  const biz = getState().business;
  if (!biz || !biz.clients) return;

  const clients = biz.clients[healthKey] || [];
  const isExpanded = stat.getAttribute('aria-expanded') === 'true';

  // Reset all buttons
  $$('.health-stat', el.healthSummary).forEach(btn => {
    btn.setAttribute('aria-expanded', 'false');
  });

  if (isExpanded) {
    // Collapse
    if (el.clientExpand) el.clientExpand.hidden = true;
    return;
  }

  // Expand
  stat.setAttribute('aria-expanded', 'true');

  const labels = { healthy: 'Healthy Clients', warning: 'Watch List', atRisk: 'At-Risk Clients' };
  if (el.clientExpandTitle) {
    el.clientExpandTitle.textContent = labels[healthKey] || 'Clients';
  }

  if (el.clientExpandItems) {
    if (clients.length === 0) {
      el.clientExpandItems.innerHTML = '<div class="empty-state"><p>No clients in this category</p></div>';
    } else {
      el.clientExpandItems.innerHTML = clients.map(c => `
        <div class="client-row">
          <div class="client-info">
            <span class="client-name">${escapeHtml(c.name)}</span>
            <span class="client-type">${escapeHtml(c.type)}</span>
          </div>
          <span class="client-note">${escapeHtml(c.note)}</span>
        </div>
      `).join('');
    }
  }

  if (el.clientExpand) el.clientExpand.hidden = false;
}

// ---- VIP Client Alerts (inline in Client Health card) ---------

function renderVipAlerts() {
  const container = el.clientVipAlerts;
  if (!container) return;

  const data = getState('vipClients');
  if (!data || !data.clients) {
    container.innerHTML = '';
    return;
  }

  const alerts = [];

  data.clients.forEach(c => {
    const s = (c.status || '').toLowerCase();
    if (s === 'at risk') {
      alerts.push({ name: c.name, type: 'danger', text: 'At Risk', program: c.program || '' });
    }
    if (c.todo && c.todo.length > 0) {
      alerts.push({ name: c.name, type: 'warning', text: `${c.todo.length} action item${c.todo.length > 1 ? 's' : ''}`, program: c.program || '' });
    }
  });

  if (alerts.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="client-vip-alerts-header">VIP Alerts</div>
    ${alerts.slice(0, 6).map(a => `
      <div class="client-vip-alert-item client-vip-alert-${escapeHtml(a.type)}">
        <span class="client-vip-alert-name">${escapeHtml(a.name)}</span>
        <span class="badge badge-${a.type === 'danger' ? 'error' : 'warning'}">${escapeHtml(a.text)}</span>
      </div>
    `).join('')}
  `;
}

// ---- Upcoming Tasks (Google Tasks) ----------------------------

async function renderUpcomingTasks() {
  const container = $('#upcomingTasksBody');
  if (!container) return;

  try {
    const tasks = await getUpcomingTasks();

    if (tasks.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No upcoming tasks</p></div>';
      return;
    }

    const now = new Date();
    container.innerHTML = `
      <div class="home-tasks-list">
        ${tasks.map(t => {
          const isOverdue = t.due && new Date(t.due) < now;
          const dueStr = t.due ? formatDate(t.due) : '';
          return `
            <div class="home-task-item" data-task-id="${escapeHtml(t.id)}">
              <button class="home-task-checkbox" data-task-id="${escapeHtml(t.id)}" data-list-id="${escapeHtml(t.listId)}" aria-label="Complete task"></button>
              <div class="home-task-content">
                <span class="home-task-title">${escapeHtml(t.title || 'Untitled')}</span>
              </div>
              ${dueStr ? `<span class="home-task-due ${isOverdue ? 'home-task-overdue' : ''}">${dueStr}</span>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;

  } catch (err) {
    console.warn('[home] Failed to load upcoming tasks', err);
    container.innerHTML = '<div class="empty-state"><p>Could not load tasks</p></div>';
  }
}

// ---- Refresh All Data -----------------------------------------

async function handleRefreshAll() {
  if (!el.refreshAllBtn) return;
  el.refreshAllBtn.disabled = true;
  el.refreshAllBtn.textContent = 'Refreshing...';

  try {
    const [business, tasks, activities, statusData] = await Promise.all([
      loadJSON('business.json'),
      loadJSON('tasks.json'),
      loadJSON('activity-log.json'),
      loadJSON('status.json'),
    ]);

    if (business) setState('business', business);
    if (tasks) setState('tasks', tasks);
    if (activities) setState('activities', activities);
    if (statusData) setState('status', statusData);

    showToast('Data refreshed', 'success');
  } catch (err) {
    console.error('[forge] Refresh failed', err);
    showToast('Refresh failed', 'error');
  } finally {
    el.refreshAllBtn.disabled = false;
    el.refreshAllBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      Refresh
    `;
  }
}
