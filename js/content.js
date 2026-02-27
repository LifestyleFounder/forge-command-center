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

// ── Lazy data loader (called on first tab visit) ─────────────────────
export async function loadContentData() {
  if (contentDataLoaded) return;
  try {
    const [youtube, instagram, metaAds, adSwipes] = await Promise.all([
      loadJSON('youtube.json'),
      loadJSON('instagram.json'),
      loadJSON('meta-ads.json'),
      loadJSON('ad-swipes.json'),
    ]);
    setState('youtube', youtube);
    setState('instagram', instagram);
    setState('metaAds', metaAds);
    setState('adSwipes', adSwipes);
    contentDataLoaded = true;
  } catch (err) {
    console.error('[content] Failed to load content data:', err);
    showToast('Failed to load content data', 'error');
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
  if (campaigns.length === 0) return;

  // Ensure chart containers exist
  let chartRow = $('#metaChartRow');
  if (!chartRow) {
    const metaPanel = $('#content-meta');
    if (!metaPanel) return;
    const narrative = metaPanel.querySelector('.meta-narrative') || metaPanel.querySelector('#metaNarrative');
    if (!narrative) return;
    chartRow = document.createElement('div');
    chartRow.id = 'metaChartRow';
    chartRow.className = 'meta-chart-row';
    chartRow.innerHTML = `
      <div class="meta-chart-wrap"><canvas id="metaSpendChart"></canvas></div>
      <div class="meta-chart-wrap"><canvas id="metaLeadsChart"></canvas></div>
    `;
    narrative.parentNode.insertBefore(chartRow, narrative.nextSibling);
  }

  const labels = campaigns.map(c => (c.name || '').slice(0, 20));
  const spendData = campaigns.map(c => c.spend || 0);
  const leadsData = campaigns.map(c => c.leads || 0);

  const chartColors = {
    gold: 'rgba(200, 162, 74, 0.8)',
    goldLight: 'rgba(200, 162, 74, 0.2)',
    green: 'rgba(16, 185, 129, 0.8)',
    greenLight: 'rgba(16, 185, 129, 0.2)',
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

  // Spend chart
  const spendCtx = $('#metaSpendChart');
  if (spendCtx) {
    if (spendChart) spendChart.destroy();
    spendChart = new Chart(spendCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Spend ($)', data: spendData, backgroundColor: chartColors.gold, borderRadius: 4 }],
      },
      options: { ...baseOptions, plugins: { ...baseOptions.plugins, title: { display: true, text: 'Spend by Campaign', color: textColor } } },
    });
  }

  // Leads chart
  const leadsCtx = $('#metaLeadsChart');
  if (leadsCtx) {
    if (leadsChart) leadsChart.destroy();
    leadsChart = new Chart(leadsCtx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Leads', data: leadsData, backgroundColor: chartColors.green, borderRadius: 4 }],
      },
      options: { ...baseOptions, plugins: { ...baseOptions.plugins, title: { display: true, text: 'Leads by Campaign', color: textColor } } },
    });
  }
}

function renderMetaSummary(summary) {
  if (!summary) return;

  setTextContent('#metaSpend', '$' + formatNumber(summary.spend || 0));
  setTextContent('#metaLeads', formatNumber(summary.leads || 0));
  setTextContent('#metaCPL', '$' + formatNumber(summary.cpl || 0));
  setTextContent('#metaROAS', (summary.roas || 0).toFixed(1) + 'x');
  setTextContent('#metaImpressions', formatNumber(summary.impressions || 0));
  setTextContent('#metaRevenue', '$' + formatNumber(summary.revenue || 0));
}

function renderMetaNarrative(summary) {
  const el = $('#metaNarrative');
  if (!el || !summary) return;

  if (!summary.spend && !summary.leads) {
    el.textContent = 'Connect your Meta Ads account to see performance data.';
    return;
  }

  const spend = formatNumber(summary.spend || 0);
  const leads = summary.leads || 0;
  const cpl = formatNumber(summary.cpl || 0);
  const roas = (summary.roas || 0).toFixed(1);

  el.textContent = `You spent $${spend} this week and generated ${leads} lead${leads !== 1 ? 's' : ''} at $${cpl} each. Current ROAS is ${roas}x.`;
}

function renderCampaignsTable(campaigns) {
  const el = $('#metaCampaignsBody');
  if (!el) return;

  if (!campaigns || campaigns.length === 0) {
    el.innerHTML = `<tr><td colspan="8" class="empty-cell">Connect Meta Ads to see campaigns.</td></tr>`;
    return;
  }

  el.innerHTML = campaigns.map(c => {
    const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) + '%' : '--';
    const cpl = c.leads > 0 ? '$' + formatNumber(Math.round(c.spend / c.leads)) : '--';
    return `
      <tr>
        <td>${escapeHtml(c.name || '')}</td>
        <td><span class="badge badge-${c.status === 'ACTIVE' ? 'success' : 'neutral'}">${escapeHtml(c.status || '')}</span></td>
        <td>$${formatNumber(c.spend || 0)}</td>
        <td>${formatNumber(c.impressions || 0)}</td>
        <td>${formatNumber(c.clicks || 0)}</td>
        <td>${ctr}</td>
        <td>${formatNumber(c.leads || 0)}</td>
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

  let filtered = swipes;
  if (compFilter !== 'all') {
    filtered = filtered.filter(s => s.advertiser === compFilter);
  }
  if (typeFilter !== 'all') {
    filtered = filtered.filter(s => s.mediaType === typeFilter);
  }

  if (countEl) countEl.textContent = `${filtered.length} ad${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>No ad swipes match your filters.</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(s => `
    <div class="swipe-card" data-swipe-id="${escapeHtml(s.id)}">
      <div class="swipe-header">
        <span class="swipe-advertiser">${escapeHtml(s.advertiser)}</span>
        <span class="badge badge-type">${escapeHtml(s.mediaType || '')}</span>
      </div>
      <div class="swipe-headline">${escapeHtml(s.headline)}</div>
      <div class="swipe-body">${escapeHtml((s.primaryText || '').slice(0, 150))}${(s.primaryText || '').length > 150 ? '...' : ''}</div>
      <div class="swipe-cta">${escapeHtml(s.cta || '')}</div>
      <div class="swipe-footer">
        <span class="badge badge-category">${escapeHtml(s.category || '')}</span>
        ${s.foundDate ? `<span class="swipe-date">${formatDate(s.foundDate)}</span>` : ''}
      </div>
      <div class="swipe-notes" hidden>
        <p><strong>Notes:</strong> ${escapeHtml(s.notes || '')}</p>
        <p><strong>Why it works:</strong> ${escapeHtml(s.whyItWorks || '')}</p>
        ${s.adsLibraryUrl ? `<a href="${escapeHtml(s.adsLibraryUrl)}" target="_blank" rel="noopener noreferrer">View in Ads Library</a>` : ''}
      </div>
    </div>
  `).join('');
}

function openMetaSettings() {
  const body = $('#settingsBody');
  const title = $('#settingsTitle');
  if (!body) return;

  if (title) title.textContent = 'Meta Ads Settings';

  const savedToken = localStorage.getItem('forge-meta-token') || '';
  const savedAccount = localStorage.getItem('forge-meta-account') || '';

  body.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="metaTokenInput">Access Token</label>
      <input type="password" class="form-input" id="metaTokenInput" placeholder="EAA..." value="${escapeHtml(savedToken)}">
    </div>
    <div class="form-group">
      <label class="form-label" for="metaAccountInput">Ad Account ID</label>
      <input type="text" class="form-input" id="metaAccountInput" placeholder="act_..." value="${escapeHtml(savedAccount)}">
    </div>
  `;

  openModal('settingsModal');

  const saveBtn = $('#saveSettingsBtn');
  if (saveBtn) {
    const handler = () => {
      const token = ($('#metaTokenInput'))?.value?.trim() || '';
      const account = ($('#metaAccountInput'))?.value?.trim() || '';
      localStorage.setItem('forge-meta-token', token);
      localStorage.setItem('forge-meta-account', account);
      closeModal('settingsModal');
      showToast('Meta Ads settings saved');
      saveBtn.removeEventListener('click', handler);
    };
    saveBtn.addEventListener('click', handler);
  }
}

async function refreshMetaAds() {
  const token = localStorage.getItem('forge-meta-token') || '';
  const account = localStorage.getItem('forge-meta-account') || '';

  if (!token || !account) {
    showToast('Configure Meta Ads credentials first', 'warning');
    openMetaSettings();
    return;
  }

  try {
    showToast('Fetching Meta Ads data...');
    const fields = 'campaign_name,spend,impressions,clicks,actions';
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(account)}/insights?fields=${fields}&date_preset=last_7d&level=campaign&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta API error: ${res.status}`);
    const data = await res.json();

    const campaigns = (data.data || []).map(row => {
      const leads = (row.actions || []).find(a => a.action_type === 'lead')?.value || 0;
      return {
        name: row.campaign_name,
        status: 'ACTIVE',
        spend: Number(row.spend || 0),
        impressions: Number(row.impressions || 0),
        clicks: Number(row.clicks || 0),
        leads: Number(leads),
      };
    });

    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalLeads = campaigns.reduce((s, c) => s + c.leads, 0);
    const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);

    const meta = {
      lastUpdated: new Date().toISOString(),
      summary: {
        spend: totalSpend,
        leads: totalLeads,
        cpl: totalLeads > 0 ? Math.round(totalSpend / totalLeads) : 0,
        roas: 0,
        impressions: totalImpressions,
        revenue: 0,
      },
      campaigns,
    };

    setState('metaAds', meta);
    showToast('Meta Ads data refreshed');
  } catch (err) {
    console.error('[content] Meta refresh failed:', err);
    showToast('Meta refresh failed: ' + err.message, 'error');
  }
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

      // Lazy-load data on first visit to non-overview subtab
      if (!contentDataLoaded && target !== 'content-overview') {
        loadContentData();
      }

      $$('#contentSubtabs .subtab').forEach(b => {
        const isActive = b === btn;
        b.classList.toggle('is-active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });

      ['content-overview', 'content-youtube', 'content-instagram', 'content-meta'].forEach(id => {
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

  // Meta Ads buttons
  $('#metaRefreshBtn')?.addEventListener('click', refreshMetaAds);
  $('#metaSettingsBtn')?.addEventListener('click', openMetaSettings);

  // Swipe filters
  $('#swipeFilterCompetitor')?.addEventListener('change', () => renderAdSwipes());
  $('#swipeFilterType')?.addEventListener('change', () => renderAdSwipes());

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

  // Swipe card expand/collapse (event delegation)
  const swipesGrid = $('#swipesGrid');
  if (swipesGrid) {
    swipesGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.swipe-card');
      if (!card) return;
      // Don't toggle if clicking a link
      if (e.target.closest('a')) return;
      const notes = card.querySelector('.swipe-notes');
      if (!notes) return;
      if (notes.hasAttribute('hidden')) {
        notes.removeAttribute('hidden');
      } else {
        notes.setAttribute('hidden', '');
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
