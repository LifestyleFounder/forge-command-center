// js/content.js — Content tab: Analytics, Weekly Gameplan, YouTube, Instagram, Meta Ads
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe, loadJSON, saveLocal,
  escapeHtml, formatNumber, formatDate, formatRelativeTime,
  generateId, debounce, $, $$, openModal, closeModal, showToast
} from './app.js';

// ── State ────────────────────────────────────────────────────────────
let contentDataLoaded = false;
let igFollowerChartInstance = null;
let caViewsChartInstance = null;
let caEngChartInstance = null;
let caActivePlatform = 'all';
let caActiveRange = 30;
let caActiveSort = 'views';
let caData = null;

// ── Public init ──────────────────────────────────────────────────────
export function initContent() {
  renderGameplan();
  renderYouTube();
  renderMyInstagram();
  renderMetaAds();
  bindContentEvents();

  subscribe((key) => {
    if (key === 'gameplan')   renderGameplan();
    if (key === 'youtube')    renderYouTube();
    if (key === 'myInstagram') renderMyInstagram();
    if (key === 'metaAds')    renderMetaAds();
    if (key === 'adSwipes')   renderAdSwipes();
    if (key === 'contentAnalytics') renderContentAnalytics();
  });
}

// ── Lazy data loader (called on first Content tab visit) ─────────────
export async function loadContentData() {
  if (contentDataLoaded) return;
  contentDataLoaded = true;
  try {
    // Fetch analytics + gameplan + YouTube stats + daily ideas from APIs in parallel
    const [analyticsRes, gameplanRes, youtubeRes, ideasRes] = await Promise.allSettled([
      fetch(`/api/content-analytics?range=${caActiveRange}&platform=${caActivePlatform}`).then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
      fetch('/api/content-gameplan').then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
      fetch('/api/youtube-stats').then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
      fetch('/api/daily-ideas').then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
    ]);

    if (analyticsRes.status === 'fulfilled') {
      caData = analyticsRes.value;
      setState('contentAnalytics', caData);
    } else {
      console.warn('[content] Analytics load failed:', analyticsRes.reason);
    }

    if (gameplanRes.status === 'fulfilled') {
      setState('gameplan', gameplanRes.value);
    } else {
      console.warn('[content] Gameplan load failed:', gameplanRes.reason);
    }

    if (youtubeRes.status === 'fulfilled') {
      setState('youtube', youtubeRes.value);
    } else {
      console.warn('[content] YouTube load failed:', youtubeRes.reason);
    }

    if (ideasRes.status === 'fulfilled') {
      renderDailyIdeas(ideasRes.value);
    } else {
      console.warn('[content] Daily ideas load failed:', ideasRes.reason);
    }

    // Load Instagram data from Supabase
    await loadMyInstagramData();
  } catch (err) {
    console.error('[content] Failed to load content data:', err);
    showToast('Failed to load content data', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  CONTENT ANALYTICS DASHBOARD
// ═══════════════════════════════════════════════════════════════════════

async function loadAnalyticsData() {
  try {
    const res = await fetch(`/api/content-analytics?range=${caActiveRange}&platform=${caActivePlatform}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    caData = await res.json();
    setState('contentAnalytics', caData);
  } catch (err) {
    console.error('[content] Analytics load failed:', err);
    showToast('Failed to load analytics', 'error');
  }
}

function renderContentAnalytics() {
  const data = caData;
  if (!data) return;

  renderKpiCards(data.kpis, data.daily, data.followerSpark);
  renderAnalyticsCharts(data.daily);
  renderPatterns(data.analysis);
  renderPostsLeaderboard(data.posts);
}

// ═══════════════════════════════════════════════════════════════════════
//  DAILY CONTENT IDEAS
// ═══════════════════════════════════════════════════════════════════════

async function loadDailyIdeas() {
  try {
    const res = await fetch('/api/daily-ideas');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderDailyIdeas(data);
  } catch (err) {
    console.warn('[content] Daily ideas load failed:', err.message);
  }
}

async function generateDailyIdeas() {
  try {
    showToast('Generating content ideas...');
    const btn = $('#caIdeasGenBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
    const res = await fetch('/api/daily-ideas?generate');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderDailyIdeas(data);
    showToast('Content ideas generated');
  } catch (err) {
    console.error('[content] Ideas generation failed:', err);
    showToast('Ideas generation failed: ' + err.message, 'error');
  } finally {
    const btn = $('#caIdeasGenBtn');
    if (btn) { btn.disabled = false; btn.textContent = 'Generate'; }
  }
}

function renderDailyIdeas(data) {
  if (!data || !data.ideas) return;

  const ideas = data.ideas;
  const dateEl = $('#caIdeasDate');
  const summaryEl = $('#caIdeasSummary');
  const gridEl = $('#caIdeasGrid');
  const sourcesEl = $('#caIdeasSources');

  // Header date
  if (dateEl) {
    const d = data.run_date || ideas.date;
    dateEl.textContent = d
      ? `Content Ideas — ${new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`
      : "Today's Content Ideas";
  }

  // Summary
  if (summaryEl && ideas.summary) {
    summaryEl.textContent = ideas.summary;
  }

  // Ideas grid
  if (gridEl && ideas.ideas && ideas.ideas.length) {
    gridEl.innerHTML = ideas.ideas.map(idea => {
      const urgencyClass = idea.urgency === 'today' ? 'ca-idea-urgent' : idea.urgency === 'this-week' ? 'ca-idea-soon' : '';
      const sourceIcon = idea.source === 'competitor' ? '&#x1f50d;' : idea.source === 'news' ? '&#x1f4f0;' : idea.source === 'trending' ? '&#x1f525;' : '&#x267b;&#xfe0f;';
      const sourceLabel = idea.source === 'competitor' ? 'Competitor post' : idea.source === 'news' ? 'News article' : idea.source === 'evergreen' ? 'Proven format' : idea.source || '';
      const platformBadge = idea.platform === 'youtube'
        ? '<span class="ca-badge ca-badge-yt">YT</span>'
        : idea.platform === 'instagram'
        ? '<span class="ca-badge ca-badge-ig">IG</span>'
        : '<span class="ca-badge ca-badge-both">Both</span>';

      return `
        <div class="ca-idea-card ${urgencyClass}">
          <div class="ca-idea-top">
            <span class="ca-idea-rank">${idea.rank || ''}</span>
            ${platformBadge}
            <span class="ca-idea-format">${escapeHtml(idea.format || '')}</span>
            ${idea.archetype ? `<span class="ca-idea-archetype">${escapeHtml(idea.archetype)}</span>` : ''}
            ${idea.urgency === 'today' ? '<span class="ca-idea-urgency">TODAY</span>' : ''}
          </div>
          <h4 class="ca-idea-title">${escapeHtml(idea.title)}</h4>
          <p class="ca-idea-hook">"${escapeHtml(idea.hook)}"</p>
          <p class="ca-idea-angle">${escapeHtml(idea.angle)}</p>
          ${idea.reference ? `<p class="ca-idea-ref">${escapeHtml(idea.reference)}</p>` : ''}
          <div class="ca-idea-footer">
            <span class="ca-idea-source">${sourceIcon} ${escapeHtml(sourceLabel)}</span>
            ${idea.referenceUrl ? `<a class="ca-idea-link" href="${escapeHtml(idea.referenceUrl)}" target="_blank" rel="noopener noreferrer">View source &rarr;</a>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  // Sources
  if (sourcesEl && data.sources) {
    const s = data.sources;
    const parts = [];
    if (s.competitorPostCount) parts.push(`${s.competitorPostCount} competitor posts`);
    if (s.trendCount) parts.push(`${s.trendCount} trending topics`);
    if (s.danPostCount) parts.push(`${s.danPostCount} of your top posts`);
    sourcesEl.textContent = parts.length ? `Sources: ${parts.join(' · ')}` : '';
  }
}

function renderKpiCards(kpis, daily, followerSpark) {
  if (!kpis) return;

  const cards = [
    { id: 'Views', kpi: kpis.views, dataKey: 'views', fmt: formatCompact },
    { id: 'Likes', kpi: kpis.likes, dataKey: 'likes', fmt: formatCompact },
    { id: 'Eng', kpi: kpis.engagement, dataKey: null, fmt: v => v.toFixed(2) + '%', isAbs: true },
    { id: 'Followers', kpi: kpis.followers, dataKey: null, fmt: formatCompact, spark: followerSpark },
    { id: 'Shares', kpi: kpis.shares, dataKey: 'shares', fmt: formatCompact },
    { id: 'Saves', kpi: kpis.saves, dataKey: 'saves', fmt: formatCompact },
  ];

  cards.forEach(c => {
    const valEl = $(`#ca${c.id}`);
    const changeEl = $(`#ca${c.id}Change`);
    if (valEl) valEl.textContent = c.fmt(c.kpi.value);
    if (changeEl) {
      const change = c.kpi.change;
      const isAbs = c.isAbs;
      const arrow = change > 0 ? '\u2191' : change < 0 ? '\u2193' : '';
      const cls = change > 0 ? 'ca-change-up' : change < 0 ? 'ca-change-down' : 'ca-change-flat';
      const display = isAbs
        ? `${arrow} ${change > 0 ? '+' : ''}${change.toFixed(2)}pp`
        : `${arrow} ${change > 0 ? '+' : ''}${Math.round(change)}%`;
      changeEl.textContent = display;
      changeEl.className = `ca-kpi-change ${cls}`;
    }

    // Draw sparkline
    const canvas = $(`#ca${c.id}Spark`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    let points;
    if (c.spark) {
      points = c.spark.map(s => s.value);
    } else if (c.dataKey && daily) {
      points = daily.map(d => d[c.dataKey] || 0);
    } else {
      return;
    }
    if (points.length < 2) return;

    const max = Math.max(...points) || 1;
    const min = Math.min(...points);
    const range = max - min || 1;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const color = c.kpi.change >= 0 ? (isDark ? '#34D399' : '#10B981') : (isDark ? '#F87171' : '#EF4444');

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    points.forEach((v, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill under
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = color + '15';
    ctx.fill();
  });
}

function renderAnalyticsCharts(daily) {
  if (typeof Chart === 'undefined' || !daily || daily.length === 0) return;

  const labels = daily.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const textColor = isDark ? '#9CA3AF' : '#6B7280';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  // ── Views & Engagement Area Chart ──
  const viewsCtx = $('#caViewsChart');
  if (viewsCtx) {
    if (caViewsChartInstance) caViewsChartInstance.destroy();
    caViewsChartInstance = new Chart(viewsCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Views',
            data: daily.map(d => d.views),
            borderColor: isDark ? '#C8A24A' : '#0F2A1E',
            backgroundColor: isDark ? 'rgba(200,162,74,0.12)' : 'rgba(15,42,30,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            yAxisID: 'y',
          },
          {
            label: 'Likes',
            data: daily.map(d => d.likes),
            borderColor: isDark ? '#34D399' : '#10B981',
            backgroundColor: isDark ? 'rgba(52,211,153,0.08)' : 'rgba(16,185,129,0.06)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', labels: { color: textColor, boxWidth: 12, padding: 16 } } },
        scales: {
          y: { position: 'left', beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } },
          y1: { position: 'right', beginAtZero: true, ticks: { color: textColor }, grid: { drawOnChartArea: false } },
          x: { ticks: { color: textColor, maxTicksLimit: 10 }, grid: { display: false } },
        },
      },
    });
  }

  // ── Engagement Breakdown Bar Chart ──
  const engCtx = $('#caEngChart');
  if (engCtx) {
    if (caEngChartInstance) caEngChartInstance.destroy();
    const colors = {
      likes: isDark ? 'rgba(200,162,74,0.85)' : 'rgba(193,154,72,0.85)',
      comments: isDark ? 'rgba(52,211,153,0.85)' : 'rgba(16,185,129,0.85)',
      shares: isDark ? 'rgba(96,165,250,0.85)' : 'rgba(59,130,246,0.85)',
      saves: isDark ? 'rgba(167,139,250,0.85)' : 'rgba(139,92,246,0.85)',
    };
    caEngChartInstance = new Chart(engCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Likes', data: daily.map(d => d.likes), backgroundColor: colors.likes, borderRadius: 3, barPercentage: 0.7 },
          { label: 'Comments', data: daily.map(d => d.comments), backgroundColor: colors.comments, borderRadius: 3, barPercentage: 0.7 },
          { label: 'Shares', data: daily.map(d => d.shares), backgroundColor: colors.shares, borderRadius: 3, barPercentage: 0.7 },
          { label: 'Saves', data: daily.map(d => d.saves), backgroundColor: colors.saves, borderRadius: 3, barPercentage: 0.7 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { color: textColor, boxWidth: 12, padding: 16 } } },
        scales: {
          x: { stacked: true, ticks: { color: textColor, maxTicksLimit: 10 }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } },
        },
      },
    });
  }
}

function renderPatterns(analysis) {
  if (!analysis) return;

  function renderPatternList(containerId, data) {
    const el = $(`#${containerId}`);
    if (!el) return;

    const sorted = Object.entries(data)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        avgLikes: stats.count > 0 ? Math.round(stats.totalLikes / stats.count) : 0,
        avgViews: stats.count > 0 ? Math.round(stats.totalViews / stats.count) : 0,
      }))
      .sort((a, b) => b.avgViews - a.avgViews)
      .slice(0, 5);

    if (sorted.length === 0) {
      el.innerHTML = '<span class="text-sm text-secondary">No data yet</span>';
      return;
    }

    const maxViews = sorted[0].avgViews || 1;
    el.innerHTML = sorted.map(item => {
      const pct = Math.round((item.avgViews / maxViews) * 100);
      return `
        <div class="ca-pattern-item">
          <div class="ca-pattern-info">
            <span class="ca-pattern-name">${escapeHtml(item.name)}</span>
            <span class="ca-pattern-stats">${formatCompact(item.avgViews)} avg views &middot; ${item.count} posts</span>
          </div>
          <div class="ca-pattern-bar-bg"><div class="ca-pattern-bar" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
  }

  renderPatternList('caHookPatterns', analysis.hooks || {});
  renderPatternList('caStructurePatterns', analysis.structures || {});
  renderPatternList('caFormatPatterns', analysis.formats || {});
}

function renderPostsLeaderboard(posts) {
  const el = $('#caPostsList');
  if (!el) return;

  if (!posts || posts.length === 0) {
    el.innerHTML = '<div class="empty-state"><p>No posts in this time range.</p></div>';
    return;
  }

  // Sort posts
  const sorted = [...posts].sort((a, b) => {
    if (caActiveSort === 'engagement') {
      const eA = a.views > 0 ? (a.likes + a.comments + (a.shares || 0) + (a.saves || 0)) / a.views : 0;
      const eB = b.views > 0 ? (b.likes + b.comments + (b.shares || 0) + (b.saves || 0)) / b.views : 0;
      return eB - eA;
    }
    return (b[caActiveSort] || 0) - (a[caActiveSort] || 0);
  });

  el.innerHTML = sorted.slice(0, 20).map((p, i) => {
    const engRate = p.views > 0
      ? ((p.likes + p.comments + (p.shares || 0) + (p.saves || 0)) / p.views * 100).toFixed(1) + '%'
      : '--';
    const platformBadge = p.platform === 'youtube'
      ? '<span class="ca-badge ca-badge-yt">YT</span>'
      : '<span class="ca-badge ca-badge-ig">IG</span>';
    const date = p.publishedAt ? formatDate(p.publishedAt) : '';

    return `
      <a class="ca-post-row" href="${escapeHtml(p.link || '#')}" target="_blank" rel="noopener noreferrer">
        <span class="ca-post-rank">${i + 1}</span>
        ${p.thumbnail
          ? `<img class="ca-post-thumb" src="${escapeHtml(p.thumbnail)}" alt="" loading="lazy" onerror="this.style.display='none'">`
          : '<div class="ca-post-thumb ca-post-thumb-empty"></div>'}
        <div class="ca-post-info">
          <span class="ca-post-title">${platformBadge} ${escapeHtml(p.title || 'Untitled')}</span>
          <span class="ca-post-meta">${escapeHtml(p.post_type || '')} &middot; ${date}</span>
        </div>
        <div class="ca-post-metrics">
          <span class="ca-metric"><strong>${formatCompact(p.views)}</strong> views</span>
          <span class="ca-metric"><strong>${formatCompact(p.likes)}</strong> likes</span>
          <span class="ca-metric"><strong>${formatCompact(p.comments)}</strong> comments</span>
          <span class="ca-metric"><strong>${formatCompact(p.shares || 0)}</strong> shares</span>
          <span class="ca-metric"><strong>${formatCompact(p.saves || 0)}</strong> saves</span>
          <span class="ca-metric ca-metric-eng"><strong>${engRate}</strong> eng</span>
        </div>
      </a>`;
  }).join('');
}

// ── Meta Ads data loader (called on first Meta Ads tab visit) ────────
let metaAdsLoaded = false;
export async function loadMetaAdsData() {
  if (metaAdsLoaded) return;
  try {
    const [metaAds, adSwipes] = await Promise.all([
      loadJSON('meta-ads.json'),
      loadJSON('ad-swipes.json'),
    ]);
    setState('metaAds', metaAds);
    setState('adSwipes', adSwipes);
    metaAdsLoaded = true;
  } catch (err) {
    console.error('[content] Failed to load Meta Ads data:', err);
    showToast('Failed to load Meta Ads data', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  WEEKLY GAMEPLAN
// ═══════════════════════════════════════════════════════════════════════
function renderGameplan() {
  const data = getState('gameplan');
  const el = $('#gameplanContent');
  const label = $('#gameplanWeekLabel');
  if (!el) return;

  if (!data || !data.gameplan) {
    el.innerHTML = `<div class="empty-state"><p>No gameplan yet. Click Refresh to generate one.</p></div>`;
    return;
  }

  const gp = data.gameplan;
  if (label && data.weekStart) {
    label.textContent = `Week of ${formatDate(data.weekStart)}`;
  }

  let html = '';
  if (gp.summary) {
    html += `<p class="gameplan-summary">${escapeHtml(gp.summary)}</p>`;
  }

  if (gp.days && gp.days.length) {
    html += gp.days.map(day => `
      <div class="gameplan-day">
        <h3>${escapeHtml(day.day)}</h3>
        <div class="gameplan-items">
          ${day.youtube ? `
          <div class="gameplan-item gameplan-item-yt">
            <span class="gameplan-item-platform">YouTube</span>
            <span class="gameplan-item-title">${escapeHtml(day.youtube.title)}</span>
            <span class="gameplan-item-hook">"${escapeHtml(day.youtube.hook)}"</span>
            <span class="gameplan-item-meta">${escapeHtml(day.youtube.format || '')}</span>
            ${day.youtube.rationale ? `<span class="gameplan-item-rationale">${escapeHtml(day.youtube.rationale)}</span>` : ''}
          </div>` : ''}
          ${day.instagram ? `
          <div class="gameplan-item gameplan-item-ig">
            <span class="gameplan-item-platform">Instagram</span>
            <span class="gameplan-item-title">${escapeHtml(day.instagram.title)}</span>
            <span class="gameplan-item-hook">"${escapeHtml(day.instagram.hook)}"</span>
            <span class="gameplan-item-meta">${escapeHtml(day.instagram.format || '')}</span>
            ${day.instagram.rationale ? `<span class="gameplan-item-rationale">${escapeHtml(day.instagram.rationale)}</span>` : ''}
          </div>` : ''}
        </div>
      </div>
    `).join('');
  }

  el.innerHTML = html || `<div class="empty-state"><p>Gameplan is empty.</p></div>`;
}

async function refreshGameplan() {
  try {
    showToast('Generating weekly gameplan...');
    const res = await fetch('/api/content-gameplan?refresh=true');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    setState('gameplan', data);
    showToast('Gameplan refreshed');
  } catch (err) {
    console.error('[content] Gameplan refresh failed:', err);
    showToast('Gameplan refresh failed: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  YOUTUBE
// ═══════════════════════════════════════════════════════════════════════
function renderYouTube() {
  const yt = getState('youtube');
  if (!yt) return;

  const stats = yt.channelStats;
  if (stats) {
    setTextContent('#ytSubs', formatNumber(stats.subscribers));
    setTextContent('#ytViews', formatNumber(stats.totalViews));
    setTextContent('#ytVideos', formatNumber(stats.totalVideos));
    const avg = stats.totalVideos > 0
      ? Math.round(stats.totalViews / stats.totalVideos)
      : 0;
    setTextContent('#ytAvgViews', formatNumber(avg));
  }

  renderVideoList(yt.recentVideos);
}

function renderVideoList(videos) {
  const el = $('#ytVideoList');
  if (!el) return;

  if (!videos || videos.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>No videos found. Click Refresh to load.</p></div>`;
    return;
  }

  el.innerHTML = videos.map(v => `
    <div class="video-item">
      ${v.thumbnail ? `<img class="video-thumb" src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy">` : '<div class="video-thumb-placeholder"></div>'}
      <div class="video-info">
        <span class="video-title">${escapeHtml(v.title)}</span>
        <span class="video-meta">${v.publishedAt ? formatDate(v.publishedAt) : ''}</span>
      </div>
      <div class="video-stats">
        <span>${formatNumber(v.views || 0)} views</span>
        <span>${formatNumber(v.likes || 0)} likes</span>
        <span>${formatNumber(v.comments || 0)} comments</span>
      </div>
    </div>
  `).join('');
}

async function refreshYouTube() {
  try {
    showToast('Fetching YouTube data...');
    const res = await fetch('/api/youtube-stats');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    setState('youtube', data);
    showToast('YouTube data refreshed');
  } catch (err) {
    console.error('[content] YouTube refresh failed:', err);
    showToast('YouTube refresh failed: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  INSTAGRAM — My Growth
// ═══════════════════════════════════════════════════════════════════════
const DAN_IG_USERNAME = 'thedanharrison';

async function loadMyInstagramData() {
  try {
    const res = await fetch('/api/instagram-stats');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    setState('myInstagram', data);
  } catch (err) {
    console.error('[content] Instagram data load failed:', err);
    setState('myInstagram', { error: err.message });
  }
}

function renderMyInstagram() {
  const data = getState('myInstagram');
  if (!data) return;

  if (data.empty) {
    setTextContent('#igFollowers', '--');
    setTextContent('#igEngRate', '--');
    setTextContent('#igAvgLikes', '--');
    setTextContent('#igPostCount', '--');
    const grid = $('#igMyPostsGrid');
    if (grid) grid.innerHTML = `<div class="empty-state"><p>@${DAN_IG_USERNAME} not found in database. Run the scraper first.</p></div>`;
    return;
  }

  if (data.error) {
    const grid = $('#igMyPostsGrid');
    if (grid) grid.innerHTML = `<div class="empty-state"><p>Error loading data: ${escapeHtml(data.error)}</p></div>`;
    return;
  }

  // Use latest snapshot for stat cards
  const snaps = data.snapshots || [];
  const latest = snaps.length ? snaps[snaps.length - 1] : null;
  if (latest) {
    setTextContent('#igFollowers', formatNumber(latest.followers || 0));
    setTextContent('#igEngRate', latest.engagement_rate != null ? latest.engagement_rate.toFixed(2) + '%' : '--');
    setTextContent('#igAvgLikes', formatNumber(latest.avg_likes || 0));
    setTextContent('#igPostCount', formatNumber(latest.posts_count || 0));
  }

  // Render follower chart
  renderFollowerChart(data.snapshots || []);

  // Render recent posts
  const grid = $('#igMyPostsGrid');
  if (!grid) return;

  const posts = data.posts || [];
  if (posts.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>No posts found.</p></div>`;
    return;
  }

  // Build fresh image URLs from shortcode (CDN thumbnails expire within hours)
  const IMG_PROXY = 'https://anthropic-proxy.dan-a14.workers.dev/img-proxy';
  grid.innerHTML = posts.map(p => {
    const imgUrl = p.shortcode
      ? `${IMG_PROXY}?url=${encodeURIComponent(`https://www.instagram.com/p/${p.shortcode}/media/?size=l`)}`
      : '';
    const postLink = p.post_url || (p.shortcode ? `https://instagram.com/p/${p.shortcode}` : '');
    return `
    <a class="ig-card" href="${escapeHtml(postLink)}" target="_blank" rel="noopener noreferrer" ${!postLink ? 'style="pointer-events:none"' : ''}>
      ${imgUrl ? `<img class="ig-card-img" src="${escapeHtml(imgUrl)}" alt="" loading="lazy">` : '<div class="ig-card-placeholder"></div>'}
      <div class="ig-card-meta">
        <span>${formatNumber(p.likes || 0)} likes</span>
        <span>${formatNumber(p.comments || 0)} comments</span>
        ${p.views ? `<span>${formatNumber(p.views)} views</span>` : ''}
        <span>${p.post_type || 'post'}</span>
      </div>
    </a>
  `;
  }).join('');
}

function renderFollowerChart(snapshots) {
  const canvas = $('#igFollowerChart');
  if (!canvas || !snapshots.length) return;

  // Destroy previous instance
  if (igFollowerChartInstance) {
    igFollowerChartInstance.destroy();
    igFollowerChartInstance = null;
  }

  // Check if Chart.js is available
  if (typeof Chart === 'undefined') return;

  const labels = snapshots.map(s => {
    const d = new Date(s.scraped_at);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const dataPoints = snapshots.map(s => s.followers);

  const isDark = document.documentElement.classList.contains('dark');
  const lineColor = isDark ? '#C8A24A' : '#0F2A1E';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';

  igFollowerChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Followers',
        data: dataPoints,
        borderColor: lineColor,
        backgroundColor: lineColor + '1A',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 10 } },
        y: { grid: { color: gridColor }, ticks: { color: textColor } },
      },
    },
  });
}

async function refreshMyInstagram() {
  try {
    showToast('Scraping @thedanharrison...');
    const res = await fetch(`/api/scrape-creators?username=${DAN_IG_USERNAME}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await loadMyInstagramData();
    showToast('Instagram data refreshed');
  } catch (err) {
    console.error('[content] Instagram refresh failed:', err);
    showToast('Instagram refresh failed: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  META ADS
// ═══════════════════════════════════════════════════════════════════════
let maSpendChartInstance = null;
let maLeadsChartInstance = null;
let activeMetaPreset = 'last_7d';

function renderMetaAds() {
  const meta = getState('metaAds');
  if (!meta) return;

  renderMetaNarrative(meta.summary);
  renderMetaCharts(meta.daily);
  renderCampaignsTable(meta.campaigns);
  renderAdSwipes();
}

function renderMetaCharts(daily) {
  if (typeof Chart === 'undefined' || !daily || daily.length === 0) return;

  const labels = daily.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });
  const spendData = daily.map(d => d.spend || 0);
  const leadsData = daily.map(d => d.leads || 0);
  const appsData = daily.map(d => d.applications || 0);

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const lineColor = isDark ? '#C8A24A' : '#2d5016';
  const fillColor = isDark ? 'rgba(200,162,74,0.15)' : 'rgba(45,80,22,0.15)';
  const barColor = isDark ? 'rgba(200,162,74,0.8)' : 'rgba(193,154,72,0.8)';
  const textColor = isDark ? '#9CA3AF' : '#6B7280';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  // ── Spend Over Time ──
  const spendCtx = $('#maSpendChart');
  if (spendCtx) {
    if (maSpendChartInstance) maSpendChartInstance.destroy();
    maSpendChartInstance = new Chart(spendCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Daily Spend',
          data: spendData,
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
          y: { beginAtZero: true, ticks: { color: textColor, callback: v => '$' + v }, grid: { color: gridColor } },
          x: { ticks: { color: textColor }, grid: { display: false } },
        },
      },
    });
  }

  // ── Leads (line) & Applications (bar) ──
  const leadsCtx = $('#maLeadsChart');
  if (leadsCtx) {
    if (maLeadsChartInstance) maLeadsChartInstance.destroy();
    maLeadsChartInstance = new Chart(leadsCtx, {
      data: {
        labels,
        datasets: [
          {
            type: 'line',
            label: 'Leads',
            data: leadsData,
            borderColor: lineColor,
            backgroundColor: fillColor,
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: lineColor,
            order: 1,
          },
          {
            type: 'bar',
            label: 'Applications',
            data: appsData,
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
        plugins: { legend: { position: 'top', labels: { color: textColor, boxWidth: 12 } } },
        scales: {
          y: { beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } },
          x: { ticks: { color: textColor }, grid: { display: false } },
        },
      },
    });
  }
}


function renderMetaNarrative(summary) {
  const el = $('#metaNarrative');
  if (!el || !summary) return;

  if (!summary.spend && !summary.impressions) {
    el.textContent = 'No Meta Ads data yet. Hit Refresh to pull latest campaign performance.';
    return;
  }

  const spend = formatNumber(summary.spend || 0);
  const impressions = formatCompact(summary.impressions || 0);
  const leads = summary.leads || 0;
  const apps = summary.applications || 0;
  const cpl = leads > 0 ? '$' + (summary.spend / leads).toFixed(2) : 'N/A';
  const cpa = apps > 0 ? '$' + (summary.spend / apps).toFixed(2) : 'N/A';
  const periodMap = { today: 'today', yesterday: 'yesterday', last_7d: 'the last 7 days', last_30d: 'the last 30 days' };
  const period = periodMap[summary.period] || periodMap[activeMetaPreset] || 'the last 7 days';

  let text = `Over ${period}: $${spend} spent across ${impressions} impressions.`;
  if (leads > 0) {
    text += ` ${formatNumber(leads)} leads at ${cpl} CPL.`;
  }
  if (apps > 0) {
    text += ` ${formatNumber(apps)} applications at ${cpa} CPA.`;
  }
  if (summary.registrations > 0) {
    text += ` ${formatNumber(summary.registrations)} registrations.`;
  }
  if (summary.revenue > 0) {
    const roas = (summary.revenue / summary.spend).toFixed(1);
    text += ` $${formatNumber(summary.revenue)} revenue (${roas}x ROAS).`;
  }

  el.textContent = text;
}

function renderCampaignsTable(campaigns) {
  const el = $('#metaCampaignsBody');
  if (!el) return;

  if (!campaigns || campaigns.length === 0) {
    el.innerHTML = `<tr><td colspan="9" class="empty-cell">No campaign data. Hit Refresh to pull from Meta.</td></tr>`;
    return;
  }

  el.innerHTML = campaigns.map(c => {
    const ctr = c.ctr ? c.ctr.toFixed(2) + '%' : (c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) + '%' : '--');
    const cpl = c.leads > 0 ? '$' + (c.spend / c.leads).toFixed(2) : '--';
    return `
      <tr>
        <td>${escapeHtml(c.name || '')}</td>
        <td><span class="badge badge-${c.status === 'ACTIVE' ? 'success' : 'neutral'}">${escapeHtml(c.status || '')}</span></td>
        <td>$${formatNumber(c.spend || 0)}</td>
        <td>${formatNumber(c.impressions || 0)}</td>
        <td>${formatNumber(c.clicks || 0)}</td>
        <td>${ctr}</td>
        <td>${formatNumber(c.leads || 0)}</td>
        <td>${formatNumber(c.applications || 0)}</td>
        <td>${cpl}</td>
      </tr>
    `;
  }).join('');
}


// ── Ad Swipe File ────────────────────────────────────────────────────
function renderAdSwipes() {
  const data = getState('adSwipes');
  if (!data) return;

  populateSwipeFilters(data);
  filterAndRenderSwipes(data);
}

function populateSwipeFilters(data) {
  const compSel = $('#swipeFilterCompetitor');
  if (!compSel) return;

  const current = compSel.value;
  const competitors = data.competitors || [];

  let html = '<option value="all">All Competitors</option>';
  competitors.forEach(name => {
    html += `<option value="${escapeHtml(name)}"${name === current ? ' selected' : ''}>${escapeHtml(name)}</option>`;
  });
  compSel.innerHTML = html;
}

function filterAndRenderSwipes(data) {
  const grid = $('#swipesGrid');
  const countEl = $('#swipeCount');
  if (!grid) return;

  const swipes = data.swipes || [];
  const compFilter = ($('#swipeFilterCompetitor'))?.value || 'all';
  const typeFilter = ($('#swipeFilterType'))?.value || 'all';
  const catFilter = ($('#swipeFilterCategory'))?.value || 'all';

  let filtered = swipes;
  if (compFilter !== 'all') {
    filtered = filtered.filter(s => s.advertiser === compFilter);
  }
  if (typeFilter !== 'all') {
    filtered = filtered.filter(s => s.mediaType === typeFilter);
  }
  if (catFilter !== 'all') {
    filtered = filtered.filter(s => s.category === catFilter);
  }

  if (countEl) countEl.textContent = `${filtered.length} ad${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>No ad swipes match your filters.</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(s => {
    const typeIcon = s.mediaType === 'video' ? '🎬' : s.mediaType === 'carousel' ? '📸' : '🖼';
    const categoryLabel = (s.category || '').replace(/-/g, ' ');
    const hasImage = s.imageUrl && s.imageUrl.startsWith('http');
    const hookClass = 'hook-' + ((s.hookType || '').toLowerCase().replace(/\s+/g, '-') || 'default');
    const elemCount = (s.swipeElements || []).length;

    return `
      <div class="swipe-card" data-swipe-id="${escapeHtml(s.id)}">
        <div class="swipe-media-area">
          ${hasImage
            ? `<img class="swipe-media-img" src="${escapeHtml(s.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : ''}
          <div class="swipe-media-placeholder" ${hasImage ? 'style="display:none"' : ''}>
            <span class="swipe-media-icon">${typeIcon}</span>
            <span class="swipe-media-type">${escapeHtml(s.mediaType || 'ad')}</span>
          </div>
          <span class="swipe-type-badge">${escapeHtml(s.mediaType || '')}</span>
          ${s.hookType ? `<span class="swipe-hook-badge ${hookClass}">${escapeHtml(s.hookType)}</span>` : ''}
        </div>
        <div class="swipe-card-body">
          <span class="swipe-advertiser">${escapeHtml(s.advertiser)}</span>
          <div class="swipe-headline">${escapeHtml(s.headline || (s.primaryText || '').slice(0, 80))}</div>
          ${s.hookFramework ? `<div class="swipe-hook-preview">"${escapeHtml(s.hookFramework)}"</div>` : ''}
          <div class="swipe-meta-row">
            <span class="badge badge-category">${escapeHtml(categoryLabel)}</span>
            ${s.foundDate ? `<span class="swipe-date">${formatDate(s.foundDate)}</span>` : ''}
            ${elemCount ? `<span class="swipe-elements-count">${elemCount} elements</span>` : ''}
          </div>
          ${s.adsLibraryUrl ? `<a href="${escapeHtml(s.adsLibraryUrl)}" target="_blank" rel="noopener noreferrer" class="swipe-source-link" onclick="event.stopPropagation()">View Source ↗</a>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openSwipeDetail(swipeId) {
  const data = getState('adSwipes');
  if (!data) return;

  const swipe = (data.swipes || []).find(s => s.id === swipeId);
  if (!swipe) return;

  const title = $('#swipeDetailTitle');
  const body = $('#swipeDetailBody');
  const libraryLink = $('#swipeDetailLibraryLink');
  if (!body) return;

  if (title) title.textContent = `${swipe.advertiser} — ${swipe.mediaType || 'Ad'}`;

  if (libraryLink) {
    if (swipe.adsLibraryUrl) {
      libraryLink.href = swipe.adsLibraryUrl;
      libraryLink.style.display = '';
    } else {
      libraryLink.style.display = 'none';
    }
  }

  body.innerHTML = `
    <div class="swipe-detail">
      <div class="swipe-detail-meta">
        <span class="swipe-advertiser">${escapeHtml(swipe.advertiser)}</span>
        <span class="badge badge-type">${escapeHtml(swipe.mediaType || '')}</span>
        <span class="badge badge-category">${escapeHtml((swipe.category || '').replace(/-/g, ' '))}</span>
        ${swipe.hookType ? `<span class="badge" style="background:rgba(139,92,246,0.1);color:#7c3aed;border:1px solid rgba(139,92,246,0.25)">${escapeHtml(swipe.hookType)}</span>` : ''}
        ${swipe.startDate ? `<span class="text-xs text-tertiary">Running since ${escapeHtml(swipe.startDate)}</span>` : ''}
      </div>

      ${swipe.headline ? `
        <div class="swipe-detail-section">
          <h3>Headline</h3>
          <p>${escapeHtml(swipe.headline)}</p>
        </div>
      ` : ''}

      ${swipe.primaryText ? `
        <div class="swipe-detail-section">
          <h3>Primary Text</h3>
          <p class="swipe-detail-text">${escapeHtml(swipe.primaryText)}</p>
        </div>
      ` : ''}

      ${swipe.transcript ? `
        <div class="swipe-detail-section">
          <h3>Video Script</h3>
          <p class="swipe-detail-text">${escapeHtml(swipe.transcript)}</p>
        </div>
      ` : ''}

      ${swipe.cta ? `
        <div class="swipe-detail-section">
          <h3>Call to Action</h3>
          <p>${escapeHtml(swipe.cta)}</p>
        </div>
      ` : ''}

      ${swipe.hookFramework ? `
        <div class="swipe-detail-section swipe-detail-framework">
          <h3>Hook Framework</h3>
          <p>"${escapeHtml(swipe.hookFramework)}"</p>
        </div>
      ` : ''}

      ${swipe.copyStructure ? `
        <div class="swipe-detail-section">
          <h3>Copy Structure</h3>
          <p>${escapeHtml(swipe.copyStructure)}</p>
        </div>
      ` : ''}

      ${swipe.targetAudience ? `
        <div class="swipe-detail-section">
          <h3>Target Audience</h3>
          <p>${escapeHtml(swipe.targetAudience)}</p>
        </div>
      ` : ''}

      ${(swipe.swipeElements && swipe.swipeElements.length) ? `
        <div class="swipe-detail-section swipe-detail-elements">
          <h3>Swipeable Elements (${swipe.swipeElements.length})</h3>
          <ul>
            ${swipe.swipeElements.map(el => `<li>${escapeHtml(el)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      ${swipe.whyItWorks ? `
        <div class="swipe-detail-section swipe-detail-highlight">
          <h3>Why It Works</h3>
          <p>${escapeHtml(swipe.whyItWorks)}</p>
        </div>
      ` : ''}

      ${swipe.notes ? `
        <div class="swipe-detail-section">
          <h3>Notes</h3>
          <p class="text-secondary">${escapeHtml(swipe.notes)}</p>
        </div>
      ` : ''}
    </div>
  `;

  openModal('swipeDetailModal');
}

// ── Meta Refresh ────────────────────────────────────────────────────
async function refreshMetaAds(preset) {
  if (preset) activeMetaPreset = preset;
  try {
    showToast('Fetching Meta Ads data...');

    const res = await fetch(`/api/meta-refresh?preset=${activeMetaPreset}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      throw new Error(data.error || `API returned ${res.status}`);
    }

    setState('metaAds', data);
    saveLocal('metaAds', data);
    showToast(data.campaigns?.length ? 'Meta Ads refreshed (with campaigns)' : 'Meta Ads refreshed (account-level)');
  } catch (err) {
    console.error('[content] Meta refresh failed:', err);
    showToast('Meta refresh failed: ' + err.message, 'error');
  }
}

function switchMetaPreset(preset) {
  activeMetaPreset = preset;
  // Update active button
  $$('.meta-date-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.preset === preset);
  });
  refreshMetaAds(preset);
}

// ── Compact number helper ───────────────────────────────────────────
function formatCompact(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// ═══════════════════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════════════════
function bindContentEvents() {
  // Content subtab switching
  const subtabs = $('#contentSubtabs');
  if (subtabs) {
    subtabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.subtab');
      if (!btn) return;
      const target = btn.dataset.subtab;
      if (!target) return;

      if (!contentDataLoaded) {
        loadContentData();
      }

      $$('#contentSubtabs .subtab').forEach(b => {
        const isActive = b === btn;
        b.classList.toggle('is-active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });

      ['content-analytics', 'content-overview', 'content-youtube', 'content-instagram'].forEach(id => {
        const panel = $(`#${id}`);
        if (!panel) return;
        const active = id === target;
        panel.classList.toggle('is-active', active);
        if (active) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      });
    });
  }

  // Analytics platform filter
  $('#caPlatformFilter')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.ca-pill');
    if (!btn || !btn.dataset.platform) return;
    caActivePlatform = btn.dataset.platform;
    $$('#caPlatformFilter .ca-pill').forEach(b => b.classList.toggle('is-active', b === btn));
    loadAnalyticsData();
  });

  // Analytics time range filter
  $('#caRangeFilter')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.ca-pill');
    if (!btn || !btn.dataset.range) return;
    caActiveRange = parseInt(btn.dataset.range);
    $$('#caRangeFilter .ca-pill').forEach(b => b.classList.toggle('is-active', b === btn));
    loadAnalyticsData();
  });

  // Analytics sort dropdown
  $('#caPostSort')?.addEventListener('change', (e) => {
    caActiveSort = e.target.value;
    if (caData) renderPostsLeaderboard(caData.posts);
  });

  // Daily ideas generate
  $('#caIdeasGenBtn')?.addEventListener('click', generateDailyIdeas);

  // Gameplan refresh
  $('#refreshGameplanBtn')?.addEventListener('click', refreshGameplan);

  // YouTube refresh
  $('#ytRefreshBtn')?.addEventListener('click', refreshYouTube);

  // Instagram refresh
  $('#igMyRefreshBtn')?.addEventListener('click', refreshMyInstagram);

  // Meta date range switcher
  const dateSwitcher = $('#metaDateSwitcher');
  if (dateSwitcher) {
    dateSwitcher.addEventListener('click', (e) => {
      const btn = e.target.closest('.meta-date-btn');
      if (!btn) return;
      const preset = btn.dataset.preset;
      if (preset) switchMetaPreset(preset);
    });
  }

  // Meta Ads buttons
  $('#metaRefreshBtn')?.addEventListener('click', () => refreshMetaAds());

  // Swipe filters
  $('#swipeFilterCompetitor')?.addEventListener('change', () => renderAdSwipes());
  $('#swipeFilterType')?.addEventListener('change', () => renderAdSwipes());
  $('#swipeFilterCategory')?.addEventListener('change', () => renderAdSwipes());

  // Toggle sections (event delegation on meta panel)
  const metaPanel = $('#tab-meta-ads');
  if (metaPanel) {
    metaPanel.addEventListener('click', (e) => {
      const header = e.target.closest('[data-toggle]');
      if (header) {
        const targetId = header.dataset.toggle;
        const content = $(`#${targetId}`);
        if (content) {
          const isCollapsed = content.classList.toggle('is-collapsed');
          const icon = header.querySelector('.meta-toggle-icon');
          if (icon) icon.textContent = isCollapsed ? '▸' : '▾';
        }
        return;
      }

      // Swipe card click → open detail modal
      const card = e.target.closest('.swipe-card');
      if (card && !e.target.closest('a')) {
        const swipeId = card.dataset.swipeId;
        if (swipeId) openSwipeDetail(swipeId);
        return;
      }
    });
  }

}

// ── Helpers ──────────────────────────────────────────────────────────
function setTextContent(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}
