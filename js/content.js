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
let spendChart = null;
let leadsChart = null;
let appsChart = null;
let activeMetaPreset = 'last_7d';

function renderMetaAds() {
  const meta = getState('metaAds');
  if (!meta) return;

  renderMetaSummary(meta.summary);
  renderMetaNarrative(meta.summary);
  renderMetaCharts(meta);
  renderCampaignsTable(meta.campaigns);
  renderAdSwipes();
}

function renderMetaCharts(meta) {
  if (typeof Chart === 'undefined') return;
  const campaigns = meta.campaigns || [];

  const chartRow = $('#metaChartRow');
  if (!chartRow) return;

  // Hide charts if no campaign data
  if (campaigns.length === 0) {
    chartRow.style.display = 'none';
    return;
  }
  chartRow.style.display = '';

  const labels = campaigns.map(c => (c.name || '').slice(0, 20));
  const spendData = campaigns.map(c => c.spend || 0);
  const leadsData = campaigns.map(c => c.leads || 0);
  const appsData = campaigns.map(c => c.applications || 0);

  const chartColors = {
    gold: 'rgba(200, 162, 74, 0.8)',
    green: 'rgba(16, 185, 129, 0.8)',
    blue: 'rgba(59, 130, 246, 0.8)',
  };

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#9CA3AF' : '#6B7280';

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: textColor, maxRotation: 45 }, grid: { display: false } },
      y: { ticks: { color: textColor }, grid: { color: gridColor } },
    },
  };

  const spendCtx = $('#metaSpendChart');
  if (spendCtx) {
    if (spendChart) spendChart.destroy();
    spendChart = new Chart(spendCtx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Spend ($)', data: spendData, backgroundColor: chartColors.gold, borderRadius: 4 }] },
      options: { ...baseOptions, plugins: { ...baseOptions.plugins, title: { display: true, text: 'Spend by Campaign', color: textColor } } },
    });
  }

  const leadsCtx = $('#metaLeadsChart');
  if (leadsCtx) {
    if (leadsChart) leadsChart.destroy();
    leadsChart = new Chart(leadsCtx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Leads', data: leadsData, backgroundColor: chartColors.green, borderRadius: 4 }] },
      options: { ...baseOptions, plugins: { ...baseOptions.plugins, title: { display: true, text: 'Leads by Campaign', color: textColor } } },
    });
  }

  const appsCtx = $('#metaAppsChart');
  if (appsCtx) {
    if (appsChart) appsChart.destroy();
    appsChart = new Chart(appsCtx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Applications', data: appsData, backgroundColor: chartColors.blue, borderRadius: 4 }] },
      options: { ...baseOptions, plugins: { ...baseOptions.plugins, title: { display: true, text: 'Applications by Campaign', color: textColor } } },
    });
  }
}

function renderMetaSummary(summary) {
  if (!summary) return;

  const spend = summary.spend || 0;
  const leads = summary.leads || 0;
  const apps = summary.applications || 0;
  const cpl = leads > 0 ? spend / leads : 0;
  const cpa = apps > 0 ? spend / apps : 0;
  const roas = summary.roas || (summary.revenue && spend ? (summary.revenue / spend) : 0);
  const impressions = summary.impressions || 0;
  const revenue = summary.revenue || 0;

  setTextContent('#metaSpend', '$' + formatNumber(spend));
  setTextContent('#metaLeads', formatNumber(leads));
  setTextContent('#metaCPL', leads > 0 ? '$' + cpl.toFixed(2) : '--');
  setTextContent('#metaApps', formatNumber(apps));
  setTextContent('#metaCPA', apps > 0 ? '$' + cpa.toFixed(2) : '--');
  setTextContent('#metaROAS', roas > 0 ? roas.toFixed(1) + 'x' : '--');
  setTextContent('#metaImpressions', formatCompact(impressions));
  setTextContent('#metaRevenue', revenue > 0 ? '$' + formatNumber(revenue) : '--');
}

function renderMetaNarrative(summary) {
  const el = $('#metaNarrative');
  if (!el || !summary) return;

  if (!summary.spend && !summary.impressions) {
    el.textContent = 'Connect your Meta Ads account or use Quick Add to enter performance data.';
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
    el.innerHTML = `<tr><td colspan="9" class="empty-cell">Connect Meta Ads to see campaigns, or use Quick Add below.</td></tr>`;
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

function quickAddMetaData() {
  const spend = parseFloat($('#quickSpend')?.value) || 0;
  const leads = parseInt($('#quickLeads')?.value) || 0;
  const revenue = parseFloat($('#quickRevenue')?.value) || 0;

  if (!spend && !leads && !revenue) {
    showToast('Enter at least one value', 'warning');
    return;
  }

  const meta = getState('metaAds') || { summary: {}, campaigns: [] };
  const s = meta.summary || {};

  s.spend = (s.spend || 0) + spend;
  s.leads = (s.leads || 0) + leads;
  s.revenue = (s.revenue || 0) + revenue;
  s.cpl = s.leads > 0 ? Math.round(s.spend / s.leads) : 0;
  s.roas = s.spend > 0 ? s.revenue / s.spend : 0;
  meta.summary = s;
  meta.lastUpdated = new Date().toISOString();

  setState('metaAds', { ...meta });
  saveLocal('metaAds', meta);

  // Clear inputs
  const qi = $('#quickSpend'); if (qi) qi.value = '';
  const ql = $('#quickLeads'); if (ql) ql.value = '';
  const qr = $('#quickRevenue'); if (qr) qr.value = '';

  showToast('Data added to summary');
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

// ── Meta Settings & Refresh ─────────────────────────────────────────
function openMetaSettings() {
  const body = $('#settingsBody');
  const title = $('#settingsTitle');
  if (!body) return;

  if (title) title.textContent = 'Meta Ads Settings';

  const savedToken = localStorage.getItem('forge-meta-token') || '';
  const savedAccount = localStorage.getItem('forge-meta-account') || '';

  body.innerHTML = `
    <div class="meta-settings-tabs">
      <button class="btn btn-sm meta-settings-tab is-active" data-meta-tab="api">API Connection</button>
      <button class="btn btn-sm meta-settings-tab" data-meta-tab="manual">Manual Entry</button>
    </div>

    <div class="meta-settings-panel" id="metaSettingsApi">
      <div class="form-group">
        <label class="form-label" for="metaTokenInput">Access Token</label>
        <input type="password" class="form-input" id="metaTokenInput" placeholder="EAA..." value="${escapeHtml(savedToken)}">
      </div>
      <div class="form-group">
        <label class="form-label" for="metaAccountInput">Ad Account ID</label>
        <input type="text" class="form-input" id="metaAccountInput" placeholder="act_..." value="${escapeHtml(savedAccount)}">
      </div>
      <div class="text-xs text-secondary" style="margin-top:var(--space-2)">
        Get your token from Meta Business Suite &rarr; Settings &rarr; Ad Account.
      </div>
    </div>

    <div class="meta-settings-panel" id="metaSettingsManual" hidden>
      <div class="form-group">
        <label class="form-label" for="manualDateRange">Date Range</label>
        <select class="form-select" id="manualDateRange">
          <option value="last_7d">Last 7 Days</option>
          <option value="last_30d">Last 30 Days</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="manualSpend">Total Spend ($)</label>
        <input type="number" class="form-input" id="manualSpend" step="0.01" placeholder="0.00">
      </div>
      <div class="form-group">
        <label class="form-label" for="manualLeads">Total Leads</label>
        <input type="number" class="form-input" id="manualLeads" placeholder="0">
      </div>
      <div class="form-group">
        <label class="form-label" for="manualRevenue">Revenue ($)</label>
        <input type="number" class="form-input" id="manualRevenue" step="0.01" placeholder="0.00">
      </div>
      <div class="form-group">
        <label class="form-label" for="manualImpressions">Impressions</label>
        <input type="number" class="form-input" id="manualImpressions" placeholder="0">
      </div>
      <div class="form-group">
        <label class="form-label" for="manualCampaigns">Campaign Breakdown (CSV: Name, Spend, Leads)</label>
        <textarea class="form-input" id="manualCampaigns" rows="4" placeholder="Campaign 1, 500, 12&#10;Campaign 2, 300, 8"></textarea>
      </div>
    </div>
  `;

  // Tab switching within modal
  body.addEventListener('click', (e) => {
    const tab = e.target.closest('.meta-settings-tab');
    if (!tab) return;
    const target = tab.dataset.metaTab;
    body.querySelectorAll('.meta-settings-tab').forEach(t => t.classList.toggle('is-active', t === tab));
    const apiPanel = $('#metaSettingsApi');
    const manualPanel = $('#metaSettingsManual');
    if (apiPanel) apiPanel.hidden = target !== 'api';
    if (manualPanel) manualPanel.hidden = target !== 'manual';
  });

  openModal('settingsModal');

  const saveBtn = $('#saveSettingsBtn');
  if (saveBtn) {
    const handler = () => {
      const activeTab = body.querySelector('.meta-settings-tab.is-active');
      const isApi = activeTab?.dataset.metaTab === 'api';

      if (isApi) {
        const token = ($('#metaTokenInput'))?.value?.trim() || '';
        const account = ($('#metaAccountInput'))?.value?.trim() || '';
        localStorage.setItem('forge-meta-token', token);
        localStorage.setItem('forge-meta-account', account);
        closeModal('settingsModal');
        showToast('Meta Ads settings saved');
        if (token && account) refreshMetaAds();
      } else {
        saveManualMetaData();
        closeModal('settingsModal');
      }
      saveBtn.removeEventListener('click', handler);
    };
    saveBtn.addEventListener('click', handler);
  }
}

function saveManualMetaData() {
  const spend = parseFloat($('#manualSpend')?.value) || 0;
  const leads = parseInt($('#manualLeads')?.value) || 0;
  const revenue = parseFloat($('#manualRevenue')?.value) || 0;
  const impressions = parseInt($('#manualImpressions')?.value) || 0;
  const period = $('#manualDateRange')?.value || 'last_7d';

  const campaignText = $('#manualCampaigns')?.value || '';
  const campaigns = campaignText.split('\n').filter(l => l.trim()).map(line => {
    const parts = line.split(',').map(s => s.trim());
    return {
      name: parts[0] || 'Unknown',
      status: 'ACTIVE',
      spend: parseFloat(parts[1]) || 0,
      impressions: 0,
      clicks: 0,
      leads: parseInt(parts[2]) || 0,
    };
  });

  const meta = {
    lastUpdated: new Date().toISOString(),
    summary: {
      spend,
      leads,
      cpl: leads > 0 ? Math.round(spend / leads) : 0,
      roas: spend > 0 ? revenue / spend : 0,
      impressions,
      revenue,
      period,
    },
    campaigns,
  };

  setState('metaAds', meta);
  saveLocal('metaAds', meta);
  showToast('Meta Ads data saved');
}

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
  $('#metaSettingsBtn')?.addEventListener('click', openMetaSettings);
  $('#quickAddBtn')?.addEventListener('click', quickAddMetaData);

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
