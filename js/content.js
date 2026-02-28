// js/content.js — Content tab: Overview, YouTube, Instagram, Meta Ads
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe, loadJSON, saveLocal,
  escapeHtml, formatNumber, formatDate, formatRelativeTime,
  generateId, debounce, $, $$, openModal, closeModal, showToast
} from './app.js';

// ── State ────────────────────────────────────────────────────────────
let contentDataLoaded = false;
let activeIgSubtab = 'ig-feed';

// ── Public init ──────────────────────────────────────────────────────
export function initContent() {
  renderContentOverview();
  renderYouTube();
  renderInstagram();
  renderMetaAds();
  bindContentEvents();

  subscribe((key) => {
    if (key === 'content')  renderContentOverview();
    if (key === 'youtube')  renderYouTube();
    if (key === 'instagram') renderInstagram();
    if (key === 'metaAds')  renderMetaAds();
    if (key === 'adSwipes') renderAdSwipes();
  });
}

// ── Lazy data loader (called on first Content tab visit) ─────────────
export async function loadContentData() {
  if (contentDataLoaded) return;
  try {
    const [youtube, instagram] = await Promise.all([
      loadJSON('youtube.json'),
      loadJSON('instagram.json'),
    ]);
    setState('youtube', youtube);
    setState('instagram', instagram);
    contentDataLoaded = true;
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
//  CONTENT OVERVIEW
// ═══════════════════════════════════════════════════════════════════════
function renderContentOverview() {
  const content = getState('content');
  if (!content) return;

  renderTrends(content.trends);
  renderOutliers(content.outliers);
  renderYouTubeIdeas(content.youtubeIdeas);
  renderInstagramIdeas(content.instagramIdeas);
}

function renderTrends(trends) {
  if (!trends) return;

  const hotEl = $('#hotTrends');
  const risingEl = $('#risingTrends');
  if (!hotEl || !risingEl) return;

  hotEl.innerHTML = (trends.hot || [])
    .map(t => `<span class="tag tag-hot">${escapeHtml(t)}</span>`)
    .join('');

  risingEl.innerHTML = (trends.rising || [])
    .map(t => `<span class="tag tag-rising">${escapeHtml(t)}</span>`)
    .join('');
}

function renderOutliers(outliers) {
  const el = $('#outlierList');
  if (!el || !outliers) return;

  el.innerHTML = outliers.map(o => `
    <div class="outlier-item">
      <div class="outlier-name">${escapeHtml(o.name)}</div>
      <div class="outlier-members">${escapeHtml(String(o.members))}</div>
      <div class="outlier-insight">${escapeHtml(o.insight)}</div>
    </div>
  `).join('');
}

function renderYouTubeIdeas(ideas) {
  const el = $('#youtubeIdeas');
  if (!el || !ideas) return;

  el.innerHTML = ideas.map(idea => `
    <div class="idea-card" data-idea-id="${escapeHtml(idea.id)}">
      <div class="idea-header">
        <span class="idea-title">${escapeHtml(idea.title)}</span>
        <span class="badge badge-type">${escapeHtml(idea.type)}</span>
      </div>
      <div class="idea-hook" hidden>
        <p>${escapeHtml(idea.hook)}</p>
      </div>
    </div>
  `).join('');
}

function renderInstagramIdeas(ideas) {
  const el = $('#instagramIdeas');
  if (!el || !ideas) return;

  el.innerHTML = ideas.map(idea => `
    <div class="idea-card" data-idea-id="${escapeHtml(idea.id)}">
      <div class="idea-header">
        <span class="badge badge-format">${escapeHtml(idea.format)}</span>
        <span class="idea-title">${escapeHtml(idea.concept)}</span>
      </div>
      <div class="idea-hook" hidden>
        <p>${escapeHtml(idea.hook)}</p>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════════════
//  YOUTUBE
// ═══════════════════════════════════════════════════════════════════════
function renderYouTube() {
  const yt = getState('youtube');
  if (!yt) return;

  const stats = yt.channelStats && yt.channelStats.subscribers != null
    ? yt.channelStats
    : yt.manualStats;

  if (stats) {
    setTextContent('#ytSubs', formatNumber(stats.subscribers));
    setTextContent('#ytViews', formatNumber(stats.totalViews));
    setTextContent('#ytVideos', formatNumber(stats.totalVideos));
    setTextContent('#ytAvgViews', formatNumber(stats.avgViewsPerVideo || 0));
  }

  renderVideoList(yt.recentVideos);
}

function renderVideoList(videos) {
  const el = $('#ytVideoList');
  if (!el) return;

  if (!videos || videos.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>Connect your YouTube API key to see analytics.</p></div>`;
    return;
  }

  el.innerHTML = videos.map(v => `
    <div class="video-item">
      ${v.thumbnail ? `<img class="video-thumb" src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy">` : '<div class="video-thumb-placeholder"></div>'}
      <div class="video-info">
        <span class="video-title">${escapeHtml(v.title)}</span>
        <span class="video-meta">${formatNumber(v.views || 0)} views &middot; ${v.publishedAt ? formatDate(v.publishedAt) : ''}</span>
      </div>
    </div>
  `).join('');
}

function openYouTubeSettings() {
  const saved = getYouTubeConfig();
  const body = $('#settingsBody');
  const title = $('#settingsTitle');
  if (!body) return;

  if (title) title.textContent = 'YouTube Settings';

  body.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="ytApiKeyInput">YouTube API Key</label>
      <input type="text" class="form-input" id="ytApiKeyInput" placeholder="AIza..." value="${escapeHtml(saved.apiKey || '')}">
    </div>
    <div class="form-group">
      <label class="form-label" for="ytChannelIdInput">Channel ID</label>
      <input type="text" class="form-input" id="ytChannelIdInput" placeholder="UC..." value="${escapeHtml(saved.channelId || '')}">
    </div>
  `;

  openModal('settingsModal');

  const saveBtn = $('#saveSettingsBtn');
  if (saveBtn) {
    const handler = () => {
      saveYouTubeConfig();
      saveBtn.removeEventListener('click', handler);
    };
    saveBtn.addEventListener('click', handler);
  }
}

function getYouTubeConfig() {
  try {
    const raw = localStorage.getItem('forge-yt-config');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveYouTubeConfig() {
  const apiKey = ($('#ytApiKeyInput'))?.value?.trim() || '';
  const channelId = ($('#ytChannelIdInput'))?.value?.trim() || '';
  localStorage.setItem('forge-yt-config', JSON.stringify({ apiKey, channelId }));
  closeModal('settingsModal');
  showToast('YouTube settings saved');
}

async function refreshYouTube() {
  const cfg = getYouTubeConfig();
  if (!cfg.apiKey || !cfg.channelId) {
    showToast('Configure your YouTube API key first', 'warning');
    openYouTubeSettings();
    return;
  }

  try {
    showToast('Fetching YouTube data...');
    const channelRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(cfg.channelId)}&key=${encodeURIComponent(cfg.apiKey)}`
    );
    if (!channelRes.ok) throw new Error(`YouTube API error: ${channelRes.status}`);
    const channelData = await channelRes.json();
    const stats = channelData.items?.[0]?.statistics;

    if (stats) {
      const yt = getState('youtube') || {};
      yt.channelStats = {
        subscribers: Number(stats.subscriberCount),
        totalViews: Number(stats.viewCount),
        totalVideos: Number(stats.videoCount),
        lastFetched: new Date().toISOString(),
      };
      setState('youtube', { ...yt });
    }

    const videosRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(cfg.channelId)}&maxResults=10&order=date&type=video&key=${encodeURIComponent(cfg.apiKey)}`
    );
    if (videosRes.ok) {
      const videosData = await videosRes.json();
      const yt = getState('youtube') || {};
      yt.recentVideos = (videosData.items || []).map(item => ({
        id: item.id?.videoId,
        title: item.snippet?.title || '',
        thumbnail: item.snippet?.thumbnails?.medium?.url || '',
        publishedAt: item.snippet?.publishedAt || '',
        views: null,
      }));
      setState('youtube', { ...yt });
    }

    showToast('YouTube data refreshed');
  } catch (err) {
    console.error('[content] YouTube refresh failed:', err);
    showToast('YouTube refresh failed: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  INSTAGRAM
// ═══════════════════════════════════════════════════════════════════════
function renderInstagram() {
  const ig = getState('instagram');
  if (!ig) return;

  renderIgFeed(ig);
  renderIgCreators(ig);
  renderIgTopPosts(ig);
}

function renderIgFeed(ig) {
  const el = $('#igFeedGrid');
  if (!el) return;

  const posts = ig.topPosts || [];
  if (posts.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>Add creators and run the scraper to see posts here.</p></div>`;
    return;
  }

  el.innerHTML = posts.map(p => `
    <div class="ig-card">
      ${p.imageUrl ? `<img class="ig-card-img" src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy">` : '<div class="ig-card-placeholder"></div>'}
      <div class="ig-card-meta">
        <span>${escapeHtml(p.creator || ig.handle || '')}</span>
        <span>${formatNumber(p.likes || 0)} likes</span>
      </div>
    </div>
  `).join('');
}

function renderIgCreators(ig) {
  const el = $('#igCreatorsBody');
  if (!el) return;

  const creators = ig.trackedCreators || [];

  if (creators.length === 0) {
    // Show at least the current account if we have stats
    if (ig.currentStats) {
      const s = ig.currentStats;
      el.innerHTML = `
        <tr>
          <td>${escapeHtml(ig.handle || '--')}</td>
          <td>${formatNumber(s.followers)}</td>
          <td>${formatNumber(s.following)}</td>
          <td>${formatNumber(s.posts)}</td>
          <td>${s.engagementRate != null ? (s.engagementRate).toFixed(2) + '%' : '--'}</td>
          <td>${formatNumber(s.avgLikes || 0)}</td>
          <td>${s.snapshotDate ? formatDate(s.snapshotDate) : '--'}</td>
          <td></td>
        </tr>
      `;
    } else {
      el.innerHTML = `<tr><td colspan="8" class="empty-cell">No creators tracked yet.</td></tr>`;
    }
    return;
  }

  el.innerHTML = creators.map(c => `
    <tr>
      <td>${escapeHtml(c.username || '')}</td>
      <td>${formatNumber(c.followers || 0)}</td>
      <td>${formatNumber(c.following || 0)}</td>
      <td>${formatNumber(c.posts || 0)}</td>
      <td>${c.engagementRate != null ? c.engagementRate.toFixed(2) + '%' : '--'}</td>
      <td>${formatNumber(c.avgLikes || 0)}</td>
      <td>${c.lastScraped ? formatRelativeTime(c.lastScraped) : '--'}</td>
      <td><button class="btn btn-ghost btn-xs remove-creator-btn" data-username="${escapeHtml(c.username || '')}">Remove</button></td>
    </tr>
  `).join('');
}

function renderIgTopPosts(ig) {
  const el = $('#igTopPostsBody');
  if (!el) return;

  const posts = collectAllPosts(ig);
  populateCreatorFilter(ig);

  const filterCreator = ($('#igTopCreatorFilter'))?.value || '';
  const sortBy = ($('#igTopSortBy'))?.value || 'likes';

  let filtered = posts;
  if (filterCreator) {
    filtered = filtered.filter(p => p.creator === filterCreator);
  }

  filtered.sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0));

  if (filtered.length === 0) {
    el.innerHTML = `<tr><td colspan="8" class="empty-cell">No posts yet.</td></tr>`;
    return;
  }

  el.innerHTML = filtered.map(p => `
    <tr>
      <td>${p.imageUrl ? `<img class="table-thumb" src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy">` : ''}</td>
      <td>${escapeHtml(p.creator || '')}</td>
      <td class="caption-cell">${escapeHtml((p.caption || '').slice(0, 80))}${(p.caption || '').length > 80 ? '...' : ''}</td>
      <td>${escapeHtml(p.type || 'post')}</td>
      <td>${formatNumber(p.likes || 0)}</td>
      <td>${formatNumber(p.comments || 0)}</td>
      <td>${formatNumber(p.views || 0)}</td>
      <td>${p.date ? formatDate(p.date) : '--'}</td>
    </tr>
  `).join('');
}

function collectAllPosts(ig) {
  const posts = [];
  if (ig.topPosts) {
    ig.topPosts.forEach(p => posts.push({ ...p, creator: p.creator || ig.handle }));
  }
  if (ig.trackedCreators) {
    ig.trackedCreators.forEach(c => {
      (c.topPosts || []).forEach(p => posts.push({ ...p, creator: c.username }));
    });
  }
  return posts;
}

function populateCreatorFilter(ig) {
  const sel = $('#igTopCreatorFilter');
  if (!sel) return;

  const current = sel.value;
  const creators = new Set();
  if (ig.handle) creators.add(ig.handle);
  (ig.trackedCreators || []).forEach(c => { if (c.username) creators.add(c.username); });

  let html = '<option value="">All Creators</option>';
  creators.forEach(name => {
    html += `<option value="${escapeHtml(name)}"${name === current ? ' selected' : ''}>${escapeHtml(name)}</option>`;
  });
  sel.innerHTML = html;
}

function openAddCreator() {
  const body = $('#settingsBody');
  const title = $('#settingsTitle');
  if (!body) return;

  if (title) title.textContent = 'Add Creator';

  body.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="addCreatorInput">Instagram Username</label>
      <input type="text" class="form-input" id="addCreatorInput" placeholder="@username">
    </div>
  `;

  openModal('settingsModal');

  const saveBtn = $('#saveSettingsBtn');
  if (saveBtn) {
    const handler = () => {
      const username = ($('#addCreatorInput'))?.value?.trim().replace(/^@/, '') || '';
      if (!username) {
        showToast('Enter a username', 'warning');
        return;
      }
      const ig = getState('instagram') || {};
      if (!ig.trackedCreators) ig.trackedCreators = [];
      if (ig.trackedCreators.some(c => c.username === username)) {
        showToast('Creator already tracked', 'warning');
        closeModal('settingsModal');
        saveBtn.removeEventListener('click', handler);
        return;
      }
      ig.trackedCreators.push({
        username,
        followers: 0,
        following: 0,
        posts: 0,
        engagementRate: null,
        avgLikes: 0,
        lastScraped: null,
        topPosts: [],
      });
      setState('instagram', { ...ig });
      saveLocal('instagram', ig);
      closeModal('settingsModal');
      showToast(`Added @${username}`);
      saveBtn.removeEventListener('click', handler);
    };
    saveBtn.addEventListener('click', handler);
  }
}

function switchIgSubtab(targetId) {
  activeIgSubtab = targetId;
  const subtabs = $$('#igSubtabs .subtab');
  subtabs.forEach(btn => {
    const isActive = btn.dataset.subtab === targetId;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  ['ig-feed', 'ig-creators', 'ig-top'].forEach(id => {
    const panel = $(`#${id}`);
    if (!panel) return;
    const active = id === targetId;
    panel.classList.toggle('is-active', active);
    if (active) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
  });
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

      if (!contentDataLoaded && target !== 'content-overview') {
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

  // Instagram sub-subtabs
  const igSubtabs = $('#igSubtabs');
  if (igSubtabs) {
    igSubtabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.subtab');
      if (!btn) return;
      const target = btn.dataset.subtab;
      if (target) switchIgSubtab(target);
    });
  }

  // YouTube buttons
  $('#ytRefreshBtn')?.addEventListener('click', refreshYouTube);
  $('#ytConfigBtn')?.addEventListener('click', openYouTubeSettings);

  // Instagram buttons
  $('#addCreatorBtn')?.addEventListener('click', openAddCreator);

  // IG top posts filters
  $('#igTopCreatorFilter')?.addEventListener('change', () => {
    const ig = getState('instagram');
    if (ig) renderIgTopPosts(ig);
  });
  $('#igTopSortBy')?.addEventListener('change', () => {
    const ig = getState('instagram');
    if (ig) renderIgTopPosts(ig);
  });

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

  // Idea card expand/collapse (event delegation)
  const overviewPanel = $('#content-overview');
  if (overviewPanel) {
    overviewPanel.addEventListener('click', (e) => {
      const card = e.target.closest('.idea-card');
      if (!card) return;
      const hook = card.querySelector('.idea-hook');
      if (!hook) return;
      if (hook.hasAttribute('hidden')) {
        hook.removeAttribute('hidden');
      } else {
        hook.setAttribute('hidden', '');
      }
    });
  }

  // IG Creators remove button (event delegation)
  const creatorsBody = $('#igCreatorsBody');
  if (creatorsBody) {
    creatorsBody.addEventListener('click', (e) => {
      const btn = e.target.closest('.remove-creator-btn');
      if (!btn) return;
      const username = btn.dataset.username;
      if (!username) return;
      const ig = getState('instagram') || {};
      ig.trackedCreators = (ig.trackedCreators || []).filter(c => c.username !== username);
      setState('instagram', { ...ig });
      saveLocal('instagram', ig);
      showToast(`Removed @${username}`);
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────
function setTextContent(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}
