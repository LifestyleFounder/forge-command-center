// js/competitors.js — Competitors tab (Instagram creator tracking)
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe,
  escapeHtml, formatNumber, formatDate, formatRelativeTime,
  debounce, $, $$, openModal, closeModal, showToast
} from './app.js';

import {
  getCreators, addCreator, removeCreator,
  getTopPosts, getRecentPosts, getScrapeRuns, proxyImageUrl
} from './services/creator-scraper.js';

// ── State ────────────────────────────────────────────────────────────
let creators = [];
let recentPosts = [];
let topPosts = [];
let scrapeRuns = [];
let activeSubtab = 'comp-creators';
let selectedCreator = null;
let loading = false;

// ── Public init ──────────────────────────────────────────────────────
export function initCompetitors() {
  bindCompetitorEvents();
}

export async function loadCompetitorData() {
  if (loading) return;
  loading = true;
  const container = $('#competitorsContainer');
  if (container && !creators.length) {
    container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading creator data...</span></div>';
  }

  try {
    const [c, rp, tp, sr] = await Promise.all([
      getCreators(),
      getRecentPosts(30),
      getTopPosts(50),
      getScrapeRuns(10),
    ]);
    creators = c;
    recentPosts = rp;
    topPosts = tp;
    scrapeRuns = sr;
  } catch (err) {
    console.warn('[competitors] Failed to load data', err);
  } finally {
    loading = false;
  }

  renderCompetitors();
}

// ── Rendering ────────────────────────────────────────────────────────
function renderCompetitors() {
  const container = $('#competitorsContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="subtabs subtabs-sm comp-subtabs" role="tablist">
      <button class="subtab ${activeSubtab === 'comp-creators' ? 'is-active' : ''}" data-comp-tab="comp-creators" role="tab">Creators</button>
      <button class="subtab ${activeSubtab === 'comp-feed' ? 'is-active' : ''}" data-comp-tab="comp-feed" role="tab">Feed</button>
      <button class="subtab ${activeSubtab === 'comp-top' ? 'is-active' : ''}" data-comp-tab="comp-top" role="tab">Top Posts</button>
      <button class="subtab ${activeSubtab === 'comp-hooks' ? 'is-active' : ''}" data-comp-tab="comp-hooks" role="tab">Hook Library</button>
    </div>
    <div class="comp-panel" id="compPanel">
      ${renderActivePanel()}
    </div>
  `;
}

function renderActivePanel() {
  switch (activeSubtab) {
    case 'comp-creators': return renderCreatorsGrid();
    case 'comp-feed': return renderFeed();
    case 'comp-top': return renderTopPostsTable();
    case 'comp-hooks': return renderHookLibrary();
    default: return '';
  }
}

function renderCreatorsGrid() {
  if (creators.length === 0) {
    return `
      <div class="empty-state">
        <p>No creators tracked yet.</p>
        <p class="text-secondary">Add Instagram creators to track their content and engagement.</p>
        <button class="btn btn-primary btn-sm" id="addCompCreatorBtn">Add Creator</button>
      </div>
    `;
  }

  return `
    <div class="comp-toolbar">
      <button class="btn btn-primary btn-sm" id="addCompCreatorBtn">Add Creator</button>
      <span class="text-sm text-secondary">${creators.length} creator${creators.length !== 1 ? 's' : ''} tracked</span>
    </div>
    <div class="creator-cards-grid">
      ${creators.map(c => `
        <div class="creator-card" data-username="${escapeHtml(c.username)}">
          <div class="creator-card-header">
            ${c.profilePic
              ? `<img class="creator-avatar" src="${escapeHtml(c.profilePic)}" alt="" loading="lazy">`
              : '<div class="creator-avatar creator-avatar-placeholder"></div>'}
            <div class="creator-card-info">
              <span class="creator-handle">@${escapeHtml(c.username)}</span>
              ${c.fullName ? `<span class="creator-fullname text-xs text-tertiary">${escapeHtml(c.fullName)}</span>` : ''}
            </div>
            <button class="btn btn-ghost btn-xs comp-remove-btn" data-username="${escapeHtml(c.username)}" title="Remove">×</button>
          </div>
          <div class="creator-card-stats">
            <div class="creator-stat"><span class="creator-stat-value">${formatNumber(c.followers)}</span><span class="creator-stat-label">Followers</span></div>
            <div class="creator-stat"><span class="creator-stat-value">${c.engagementRate ? c.engagementRate.toFixed(1) + '%' : '--'}</span><span class="creator-stat-label">Eng. Rate</span></div>
            <div class="creator-stat"><span class="creator-stat-value">${formatNumber(c.avgLikes)}</span><span class="creator-stat-label">Avg Likes</span></div>
            <div class="creator-stat"><span class="creator-stat-value">${formatNumber(c.posts)}</span><span class="creator-stat-label">Posts</span></div>
          </div>
          ${c.lastScraped ? `<div class="creator-card-footer text-xs text-tertiary">Last scraped: ${formatRelativeTime(c.lastScraped)}</div>` : ''}
        </div>
      `).join('')}
    </div>
    ${renderScrapeHistory()}
  `;
}

function renderFeed() {
  if (recentPosts.length === 0) {
    return '<div class="empty-state"><p>No posts yet. Run the scraper to populate the feed.</p></div>';
  }

  return `
    <div class="ig-grid comp-feed-grid">
      ${recentPosts.map(p => {
        const typeIcon = p.type === 'Video' ? '🎬' : p.type === 'Sidecar' ? '📸' : '📷';
        return `
        <div class="ig-card comp-post-card" data-post-id="${escapeHtml(p.id)}">
          ${p.imageUrl
            ? `<img class="ig-card-img" src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
            : ''}
          <div class="ig-card-hero" ${p.imageUrl ? 'style="display:none"' : ''}>
            <span class="ig-card-type-icon">${typeIcon}</span>
            <span class="ig-card-type-label">${escapeHtml(p.type)}</span>
          </div>
          <div class="ig-card-stats">
            <span>❤ ${formatNumber(p.likes)}</span>
            <span>💬 ${formatNumber(p.comments)}</span>
            ${p.views ? `<span>👁 ${formatNumber(p.views)}</span>` : ''}
          </div>
          <div class="ig-card-meta">
            <span class="ig-card-creator">@${escapeHtml(p.creator)}</span>
            <span class="ig-card-date">${p.date ? formatDate(p.date) : ''}</span>
          </div>
          <div class="ig-card-caption text-xs">${escapeHtml((p.caption || '').slice(0, 140))}${(p.caption || '').length > 140 ? '...' : ''}</div>
          ${p.permalink ? `<a href="${escapeHtml(p.permalink)}" target="_blank" rel="noopener noreferrer" class="ig-card-link text-xs">View on Instagram</a>` : ''}
        </div>
      `;}).join('')}
    </div>
  `;
}

function renderTopPostsTable() {
  if (topPosts.length === 0) {
    return '<div class="empty-state"><p>No top posts data available.</p></div>';
  }

  return `
    <div class="filter-row">
      <select class="form-select" id="compTopCreatorFilter" aria-label="Filter by creator">
        <option value="">All Creators</option>
        ${[...new Set(topPosts.map(p => p.creator))].map(c =>
          `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`
        ).join('')}
      </select>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th></th><th>Creator</th><th>Caption</th><th>Type</th><th>Likes</th><th>Comments</th><th>Views</th><th>Date</th><th></th></tr>
        </thead>
        <tbody>
          ${topPosts.slice(0, 50).map(p => `
            <tr class="comp-post-row" data-post-id="${escapeHtml(p.id)}">
              <td>${p.imageUrl ? `<img class="table-thumb" src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}</td>
              <td>@${escapeHtml(p.creator)}</td>
              <td class="caption-cell">${escapeHtml((p.caption || '').slice(0, 80))}${(p.caption || '').length > 80 ? '...' : ''}</td>
              <td><span class="badge badge-type">${escapeHtml(p.type)}</span></td>
              <td>${formatNumber(p.likes)}</td>
              <td>${formatNumber(p.comments)}</td>
              <td>${formatNumber(p.views)}</td>
              <td>${p.date ? formatDate(p.date) : '--'}</td>
              <td>${p.permalink ? `<a href="${escapeHtml(p.permalink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs">↗</a>` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderHookLibrary() {
  // Extract first lines (hooks) from top posts
  const hooks = topPosts
    .filter(p => p.caption && p.caption.trim().length > 10)
    .map(p => {
      const firstLine = p.caption.split('\n')[0].trim();
      return {
        hook: firstLine.slice(0, 150),
        creator: p.creator,
        likes: p.likes,
        type: p.type,
      };
    })
    .filter(h => h.hook.length > 15)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 30);

  if (hooks.length === 0) {
    return '<div class="empty-state"><p>No hooks extracted yet. Need posts with captions.</p></div>';
  }

  return `
    <div class="hook-library">
      ${hooks.map(h => `
        <div class="hook-card">
          <div class="hook-text">"${escapeHtml(h.hook)}"</div>
          <div class="hook-meta">
            <span class="text-xs text-secondary">@${escapeHtml(h.creator)}</span>
            <span class="text-xs text-tertiary">❤ ${formatNumber(h.likes)}</span>
            <span class="badge badge-type badge-sm">${escapeHtml(h.type)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderScrapeHistory() {
  if (scrapeRuns.length === 0) return '';
  return `
    <div class="comp-scrape-history">
      <h3>Recent Scrapes</h3>
      <div class="scrape-runs">
        ${scrapeRuns.slice(0, 5).map(r => `
          <div class="scrape-run">
            <span class="badge badge-${r.status === 'completed' ? 'success' : r.status === 'running' ? 'info' : 'neutral'}">${escapeHtml(r.status || 'unknown')}</span>
            <span class="text-sm">${r.creators_scraped || 0} creators</span>
            <span class="text-xs text-tertiary">${r.started_at ? formatRelativeTime(r.started_at) : '--'}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ── Events ──────────────────────────────────────────────────────────
function bindCompetitorEvents() {
  const container = $('#competitorsContainer');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    // Subtab switching
    const tab = e.target.closest('[data-comp-tab]');
    if (tab) {
      activeSubtab = tab.dataset.compTab;
      renderCompetitors();
      return;
    }

    // Add creator
    if (e.target.closest('#addCompCreatorBtn')) {
      const username = prompt('Instagram username:');
      if (!username) return;
      showToast('Adding creator...');
      const result = await addCreator(username);
      if (result) {
        creators.push(result);
        renderCompetitors();
        showToast(`Added @${result.username}`, 'success');
      } else {
        showToast('Failed to add creator', 'error');
      }
      return;
    }

    // Remove creator
    const removeBtn = e.target.closest('.comp-remove-btn');
    if (removeBtn) {
      const username = removeBtn.dataset.username;
      if (!confirm(`Remove @${username}?`)) return;
      const ok = await removeCreator(username);
      if (ok) {
        creators = creators.filter(c => c.username !== username);
        renderCompetitors();
        showToast(`Removed @${username}`);
      }
      return;
    }

    // Post detail (click on post card)
    const postCard = e.target.closest('.comp-post-card, .comp-post-row');
    if (postCard) {
      const postId = postCard.dataset.postId;
      const post = [...recentPosts, ...topPosts].find(p => p.id === postId);
      if (post) showPostDetail(post);
    }
  });
}

function showPostDetail(post) {
  const body = $('#settingsBody');
  const title = $('#settingsTitle');
  if (!body) return;

  if (title) title.textContent = `@${post.creator} — Post Detail`;

  body.innerHTML = `
    <div class="post-detail">
      ${post.imageUrl ? `<img class="post-detail-img" src="${escapeHtml(post.imageUrl)}" alt="" loading="lazy">` : ''}
      <div class="post-detail-stats">
        <span>❤ ${formatNumber(post.likes)}</span>
        <span>💬 ${formatNumber(post.comments)}</span>
        ${post.views ? `<span>👁 ${formatNumber(post.views)}</span>` : ''}
        <span class="badge badge-type">${escapeHtml(post.type)}</span>
        ${post.date ? `<span>${formatDate(post.date)}</span>` : ''}
      </div>
      <div class="post-detail-caption">${escapeHtml(post.caption || 'No caption')}</div>
      ${post.permalink ? `<a href="${escapeHtml(post.permalink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm">View on Instagram ↗</a>` : ''}
    </div>
  `;

  // Hide save button for this modal
  const saveBtn = $('#saveSettingsBtn');
  if (saveBtn) saveBtn.style.display = 'none';

  openModal('settingsModal');

  // Restore save button on close
  const observer = new MutationObserver(() => {
    const modal = $('#settingsModal');
    if (modal && modal.hidden) {
      if (saveBtn) saveBtn.style.display = '';
      observer.disconnect();
    }
  });
  observer.observe($('#settingsModal'), { attributes: true });
}
