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
  showToast,
  loadJSON,
  setState,
  switchTab
} from './app.js';
import { getUpcomingTasks, completeTaskFromHome } from './google-tasks.js';
import { getUpcomingEvents } from './google-calendar.js';

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
    clientNotifications: $('#clientNotifications'),
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
  renderClientNotifications();
  updateGreeting();
  renderUpcomingTasks();
  renderSchedule();

  // Subscribe to state changes
  subscribe((key) => {
    if (key === 'business') {
      renderClientHealth();
      renderClientNotifications();
    }
    if (key === 'vipClients') {
      renderClientNotifications();
      renderVipMetrics();
    }
  });

  // Refresh all data
  if (el.refreshAllBtn) {
    el.refreshAllBtn.addEventListener('click', handleRefreshAll);
  }

  // Tasks card: View All → Google Tasks tab
  $('#tasksViewAllBtn')?.addEventListener('click', () => switchTab('google-tasks'));

  // Calendar card: "Open Calendar" is now an <a> link, no JS needed

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

// ---- Client Notifications (flat list below health stats) ------

function renderClientNotifications() {
  const container = el.clientNotifications;
  if (!container) return;

  const items = [];

  // Business-level alerts
  const biz = getState().business;
  if (biz?.clients?.alerts) {
    biz.clients.alerts.forEach(a => {
      const icon = a.type === 'warning' ? '\u26A0' : a.type === 'success' ? '\u2705' : '\u2139';
      items.push({ icon, text: a.text, type: a.type || 'info' });
    });
  }

  // Watch list clients
  if (biz?.clients?.warning) {
    biz.clients.warning.forEach(c => {
      items.push({ icon: '\uD83D\uDC41', text: `${c.name} — ${c.note}`, type: 'warning' });
    });
  }

  // At-risk clients from business data
  if (biz?.clients?.atRisk) {
    biz.clients.atRisk.forEach(c => {
      items.push({ icon: '\uD83D\uDEA8', text: `${c.name} — at risk${c.note ? ': ' + c.note : ''}`, type: 'danger' });
    });
  }

  // VIP client alerts (at risk + action items)
  const vipData = getState('vipClients');
  if (vipData?.clients) {
    vipData.clients.forEach(c => {
      const s = (c.status || '').toLowerCase();
      if (s === 'at risk') {
        // Avoid duplicate if already in biz data
        const already = items.some(i => i.text.startsWith(c.name));
        if (!already) {
          items.push({ icon: '\uD83D\uDEA8', text: `${c.name} — At Risk`, type: 'danger' });
        }
      }
      if (c.todo && c.todo.length > 0) {
        items.push({ icon: '\u2705', text: `${c.name} — ${c.todo.length} action item${c.todo.length > 1 ? 's' : ''}`, type: 'warning' });
      }
    });
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="cn-empty">No alerts right now</div>';
    return;
  }

  container.innerHTML = items.slice(0, 8).map(i => `
    <div class="cn-item cn-${escapeHtml(i.type)}">
      <span class="cn-icon">${i.icon}</span>
      <span class="cn-text">${escapeHtml(i.text)}</span>
    </div>
  `).join('');
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

// ---- Schedule (Google Calendar) --------------------------------

async function renderSchedule() {
  const container = $('#scheduleBody');
  if (!container) return;

  try {
    const events = await getUpcomingEvents();

    if (events.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No upcoming events</p></div>';
      return;
    }

    const now = new Date();
    let lastDateStr = '';

    const html = events.map(ev => {
      const startDt = ev.allDay ? new Date(ev.start.date + 'T00:00:00') : new Date(ev.start.dateTime);
      const endDt = ev.allDay
        ? new Date(ev.end.date + 'T00:00:00')
        : (ev.end.dateTime ? new Date(ev.end.dateTime) : null);

      const isNow = !ev.allDay && endDt && now >= startDt && now < endDt;

      let timeStr;
      if (ev.allDay) {
        timeStr = 'All day';
      } else {
        timeStr = startDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      }

      // Date separator
      const dateStr = startDt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      let separator = '';
      if (dateStr !== lastDateStr) {
        const isToday = startDt.toDateString() === now.toDateString();
        const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
        const isTomorrow = startDt.toDateString() === tomorrow.toDateString();
        const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : dateStr;
        separator = `<div class="schedule-date-sep">${label}</div>`;
        lastDateStr = dateStr;
      }

      const title = escapeHtml(ev.title);

      return `${separator}<a href="${escapeHtml(ev.link)}" target="_blank" class="schedule-item${isNow ? ' schedule-now' : ''}">
        <span class="schedule-time${ev.allDay ? ' schedule-allday' : ''}">${timeStr}</span>
        <span class="schedule-title">${title}</span>
      </a>`;
    }).join('');

    container.innerHTML = `<div class="schedule-list">${html}</div>`;

  } catch (err) {
    console.warn('[home] Failed to load schedule', err);
    container.innerHTML = '<div class="empty-state"><p>Calendar unavailable</p></div>';
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
