/* ============================================================
   home.js — Forge Command Center Home Tab
   Morning brief, metrics, client health, pipeline, greeting
   ============================================================ */

import {
  getState,
  subscribe,
  escapeHtml,
  formatNumber,
  formatDate,
  formatRelativeTime,
  daysBetween,
  $,
  $$,
  showToast,
  loadJSON,
  setState
} from './app.js';

// ---- DOM Cache (module-scoped) --------------------------------

let el = {};

function cacheHomeElements() {
  el = {
    greeting: $('#homeGreeting'),
    morningBrief: $('#morningBrief'),
    briefItems: $('#morningBrief .brief-items'),
    metricsRow: $('#metricsRow'),
    metricFree: $('#metricFree'),
    metricFreeTrend: $('#metricFreeTrend'),
    metricPremium: $('#metricPremium'),
    metricPremiumTrend: $('#metricPremiumTrend'),
    metricVip: $('#metricVip'),
    metricVipTrend: $('#metricVipTrend'),
    metricOneone: $('#metricOneone'),
    metricOneoneTrend: $('#metricOneoneTrend'),
    metricApps: $('#metricApps'),
    metricAppsTrend: $('#metricAppsTrend'),
    metricWorkshop: $('#metricWorkshop'),
    metricWorkshopTrend: $('#metricWorkshopTrend'),
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
    pipelineBody: $('#pipelineBody'),
    refreshAllBtn: $('#refreshAllBtn'),
  };
}

// ---- Public Init ----------------------------------------------

export function initHome() {
  cacheHomeElements();

  renderMorningBrief();
  renderMetrics();
  renderClientHealth();
  renderPipeline();
  updateGreeting();

  // Subscribe to state changes
  subscribe((key) => {
    if (key === 'business') {
      renderMetrics();
      renderClientHealth();
      renderPipeline();
      renderMorningBrief();
    }
    if (key === 'tasks' || key === 'status') {
      renderMorningBrief();
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

// ---- Morning Brief --------------------------------------------

function renderMorningBrief() {
  if (!el.briefItems) return;

  const insights = generateInsights();

  if (insights.length === 0) {
    el.briefItems.innerHTML = '<div class="brief-item"><span class="brief-icon">&#9745;</span><span class="brief-text">All clear. No urgent items.</span></div>';
    return;
  }

  el.briefItems.innerHTML = insights.map(item => `
    <div class="brief-item brief-${escapeHtml(item.level)}">
      <span class="brief-icon">${item.icon}</span>
      <span class="brief-text">${escapeHtml(item.text)}</span>
    </div>
  `).join('');
}

function generateInsights() {
  const insights = [];
  const state = getState();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // --- Check overdue tasks ---
  const tasks = state.tasks?.tasks || [];
  const overdue = tasks.filter(t =>
    t.due &&
    t.status !== 'done' &&
    new Date(t.due) < now
  );
  overdue.forEach(t => {
    insights.push({
      level: 'warning',
      icon: '\u26A0',
      text: `${t.title} is overdue (due ${formatDate(t.due)})`
    });
  });

  // --- Check at-risk clients ---
  const biz = state.business;
  if (biz && biz.clients) {
    const atRisk = biz.clients.atRisk || [];
    if (atRisk.length > 0) {
      const names = atRisk.map(c => c.name).join(', ');
      insights.push({
        level: 'danger',
        icon: '\uD83D\uDC65',
        text: `${atRisk.length} client${atRisk.length > 1 ? 's' : ''} at risk: ${names}`
      });
    }

    const warning = biz.clients.warning || [];
    if (warning.length > 0) {
      warning.forEach(c => {
        insights.push({
          level: 'warning',
          icon: '\uD83D\uDC41',
          text: `${c.name} needs attention: ${c.note}`
        });
      });
    }
  }

  // --- Check data staleness ---
  if (biz && biz.lastUpdated) {
    const stale = daysBetween(biz.lastUpdated, today);
    if (stale !== null && stale > 3) {
      insights.push({
        level: 'info',
        icon: '\uD83D\uDCCA',
        text: `Business data is ${stale} days old \u2014 consider updating`
      });
    }
  }

  // --- Tasks in progress / backlog summary ---
  const inProgress = tasks.filter(t => t.status === 'progress').length;
  const backlog = tasks.filter(t => t.status === 'todo' || t.status === 'inbox').length;
  if (inProgress > 0 || backlog > 0) {
    const parts = [];
    if (inProgress > 0) parts.push(`${inProgress} task${inProgress > 1 ? 's' : ''} in progress`);
    if (backlog > 0) parts.push(`${backlog} in backlog`);
    insights.push({
      level: 'neutral',
      icon: '\u2705',
      text: parts.join(', ')
    });
  }

  // --- Applications this week ---
  if (biz && biz.applications) {
    const apps = biz.applications.thisWeek;
    if (apps != null) {
      insights.push({
        level: 'neutral',
        icon: '\uD83D\uDCCB',
        text: `${apps} application${apps !== 1 ? 's' : ''} this week`
      });
    }
  }

  // --- Recent alerts from clients ---
  if (biz && biz.clients && biz.clients.alerts) {
    const successAlerts = biz.clients.alerts.filter(a => a.type === 'success');
    successAlerts.forEach(a => {
      insights.push({
        level: 'success',
        icon: '\uD83C\uDF89',
        text: a.text
      });
    });
  }

  return insights.slice(0, 6);
}

// ---- Metrics Row ----------------------------------------------

function renderMetrics() {
  const biz = getState().business;
  if (!biz) return;

  // Free Community
  if (el.metricFree) {
    el.metricFree.textContent = formatNumber(biz.free?.total);
  }
  if (el.metricFreeTrend && biz.free?.last30Days != null) {
    el.metricFreeTrend.innerHTML = trendHtml(biz.free.last30Days, 'last 30d');
  }

  // Premium
  if (el.metricPremium) {
    el.metricPremium.textContent = formatNumber(biz.premium?.total);
  }
  if (el.metricPremiumTrend && biz.premium?.lastMonth != null) {
    el.metricPremiumTrend.innerHTML = trendHtml(biz.premium.lastMonth, 'last month');
  }

  // VIP
  if (el.metricVip) {
    el.metricVip.textContent = formatNumber(biz.vip?.total);
  }
  if (el.metricVipTrend && biz.vip?.lastMonth != null) {
    el.metricVipTrend.innerHTML = trendHtml(biz.vip.lastMonth, 'last month');
  }

  // 1:1
  if (el.metricOneone) {
    el.metricOneone.textContent = biz.oneone?.total != null ? `${biz.oneone.total}/${biz.oneone.cap || 12}` : '--';
  }
  if (el.metricOneoneTrend) {
    const pct = biz.oneone?.total && biz.oneone?.cap
      ? Math.round((biz.oneone.total / biz.oneone.cap) * 100)
      : null;
    el.metricOneoneTrend.textContent = pct != null ? `${pct}% capacity` : '';
  }

  // Applications
  if (el.metricApps) {
    el.metricApps.textContent = biz.applications?.thisWeek != null ? biz.applications.thisWeek : '--';
  }
  if (el.metricAppsTrend) {
    el.metricAppsTrend.textContent = 'this week';
  }

  // Workshops
  if (el.metricWorkshop) {
    el.metricWorkshop.textContent = biz.workshop?.sales != null ? biz.workshop.sales : '--';
  }
  if (el.metricWorkshopTrend && biz.workshop?.cashCollected != null) {
    el.metricWorkshopTrend.textContent = `$${formatNumber(biz.workshop.cashCollected)} collected`;
  }
}

function trendHtml(value, label) {
  if (value == null) return '';
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const sign = value > 0 ? '+' : '';
  return `<span class="trend-${escapeHtml(dir)}">${sign}${formatNumber(value)}</span> <span class="trend-label">${escapeHtml(label)}</span>`;
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

// ---- Pipeline -------------------------------------------------

function renderPipeline() {
  if (!el.pipelineBody) return;

  const biz = getState().business;
  const tasks = getState().tasks?.tasks || [];

  // Build pipeline data from business + task context
  const stages = [];

  // Applications
  const apps = biz?.applications?.thisWeek || 0;
  stages.push({
    label: 'Applications',
    value: apps,
    status: apps > 0 ? 'active' : 'empty'
  });

  // Active sales tasks
  const salesTasks = tasks.filter(t =>
    t.tags && t.tags.includes('sales') && t.status !== 'done'
  );
  stages.push({
    label: 'Active Sales',
    value: salesTasks.length,
    status: salesTasks.length > 0 ? 'active' : 'empty'
  });

  // Premium members (new last month)
  const premiumNew = biz?.premium?.lastMonth || 0;
  stages.push({
    label: 'New Premium',
    value: premiumNew,
    status: premiumNew > 0 ? 'active' : 'empty'
  });

  // VIP members (new last month)
  const vipNew = biz?.vip?.lastMonth || 0;
  stages.push({
    label: 'New VIP',
    value: vipNew,
    status: vipNew > 0 ? 'active' : 'empty'
  });

  // 1:1 capacity
  const oneoneTotal = biz?.oneone?.total || 0;
  const oneoneCap = biz?.oneone?.cap || 12;
  stages.push({
    label: '1:1 Slots',
    value: `${oneoneTotal}/${oneoneCap}`,
    status: oneoneTotal >= oneoneCap ? 'full' : oneoneTotal > 0 ? 'active' : 'empty'
  });

  el.pipelineBody.innerHTML = `
    <div class="pipeline-stages">
      ${stages.map(s => `
        <div class="pipeline-stage pipeline-${escapeHtml(s.status)}">
          <span class="pipeline-value">${escapeHtml(String(s.value))}</span>
          <span class="pipeline-label">${escapeHtml(s.label)}</span>
        </div>
      `).join('<div class="pipeline-arrow" aria-hidden="true">\u2192</div>')}
    </div>
    ${salesTasks.length > 0 ? `
      <div class="pipeline-details">
        <h3>Active Sales Tasks</h3>
        ${salesTasks.map(t => `
          <div class="pipeline-task">
            <span class="pipeline-task-title">${escapeHtml(t.title)}</span>
            ${t.due ? `<span class="pipeline-task-due ${new Date(t.due) < new Date() ? 'is-overdue' : ''}">${formatDate(t.due)}</span>` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
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
