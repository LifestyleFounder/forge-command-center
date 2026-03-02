// js/content.js — Content tab: Weekly Gameplan, YouTube, Instagram, Meta Ads
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe, loadJSON, saveLocal,
  escapeHtml, formatNumber, formatDate, formatRelativeTime,
  generateId, debounce, $, $$, openModal, closeModal, showToast
} from './app.js';

// ── State ────────────────────────────────────────────────────────────
let contentDataLoaded = false;
let igFollowerChartInstance = null;

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
  });
}

// ── Lazy data loader (called on first Content tab visit) ─────────────
export async function loadContentData() {
  if (contentDataLoaded) return;
  contentDataLoaded = true;
  try {
    // Fetch gameplan + YouTube stats from APIs in parallel
    const [gameplanRes, youtubeRes] = await Promise.allSettled([
      fetch('/api/content-gameplan').then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
      fetch('/api/youtube-stats').then(r => r.ok ? r.json() : Promise.reject(r.statusText)),
    ]);

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

    // Load Instagram data from Supabase
    await loadMyInstagramData();
  } catch (err) {
    console.error('[content] Failed to load content data:', err);
    showToast('Failed to load content data', 'error');
  }
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

      ['content-overview', 'content-youtube', 'content-instagram'].forEach(id => {
        const panel = $(`#${id}`);
        if (!panel) return;
        const active = id === target;
        panel.classList.toggle('is-active', active);
        if (active) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      });
    });
  }

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
