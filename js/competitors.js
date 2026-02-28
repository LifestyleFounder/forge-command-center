// js/competitors.js — Competitors tab (Instagram creator tracking)
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe,
  escapeHtml, formatNumber, formatDate, formatRelativeTime,
  debounce, $, $$, openModal, closeModal, showToast
} from './app.js';

import {
  getCreators, addCreator, removeCreator,
  getTopPosts, getRecentPosts, getScrapeRuns, proxyImageUrl,
  getCreatorsWithFallback, addCreatorLocal, removeCreatorLocal
} from './services/creator-scraper.js';

// ── State ────────────────────────────────────────────────────────────
let creators = [];
let allPosts = [];
let dataSource = 'none';
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
    const result = await getCreatorsWithFallback();
    creators = result.creators;
    allPosts = result.posts;
    dataSource = result.source;
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
    case 'comp-hooks': return renderHookLibrary();
    default: return '';
  }
}

// ── Creators Grid ────────────────────────────────────────────────────
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

  const sourceLabel = dataSource === 'supabase' ? 'Live' : dataSource === 'static' ? 'Pre-loaded' : '';

  return `
    <div class="comp-toolbar">
      <button class="btn btn-primary btn-sm" id="addCompCreatorBtn">Add Creator</button>
      <span class="text-sm text-secondary">${creators.length} creator${creators.length !== 1 ? 's' : ''} tracked</span>
      ${sourceLabel ? `<span class="badge badge-neutral">${sourceLabel}</span>` : ''}
    </div>
    <div class="creator-cards-grid">
      ${creators.map(c => renderCreatorCard(c)).join('')}
    </div>
  `;
}

function renderCreatorCard(c) {
  const initial = (c.fullName || c.username || '?')[0].toUpperCase();
  return `
    <div class="creator-card" data-username="${escapeHtml(c.username)}">
      <div class="creator-card-header">
        ${c.profilePic
          ? `<img class="creator-avatar" src="${escapeHtml(c.profilePic)}" alt="" loading="lazy">`
          : `<div class="creator-avatar creator-avatar-placeholder">${initial}</div>`}
        <div class="creator-card-info">
          <span class="creator-handle">@${escapeHtml(c.username)}</span>
          ${c.fullName ? `<span class="creator-fullname">${escapeHtml(c.fullName)}</span>` : ''}
          ${c.niche ? `<span class="creator-niche-badge">${escapeHtml(c.niche)}</span>` : ''}
        </div>
        <button class="btn btn-ghost btn-xs comp-remove-btn" data-username="${escapeHtml(c.username)}" title="Remove creator">×</button>
      </div>
      ${c.bio ? `<div class="creator-bio">${escapeHtml(c.bio)}</div>` : ''}
      <div class="creator-card-stats">
        <div class="creator-stat"><span class="creator-stat-value">${formatNumber(c.followers)}</span><span class="creator-stat-label">Followers</span></div>
        <div class="creator-stat"><span class="creator-stat-value">${c.engagementRate ? c.engagementRate.toFixed(1) + '%' : '--'}</span><span class="creator-stat-label">Eng. Rate</span></div>
        <div class="creator-stat"><span class="creator-stat-value">${formatNumber(c.avgLikes)}</span><span class="creator-stat-label">Avg Likes</span></div>
        <div class="creator-stat"><span class="creator-stat-value">${formatNumber(c.posts)}</span><span class="creator-stat-label">Posts</span></div>
      </div>
      <div class="creator-card-footer">
        <span class="text-xs text-tertiary">${dataSource === 'static' ? 'Pre-loaded data' : `Last scraped: ${c.lastScraped ? formatRelativeTime(c.lastScraped) : '--'}`}</span>
        <button class="btn btn-ghost btn-xs comp-view-posts-btn" data-username="${escapeHtml(c.username)}">View Posts →</button>
      </div>
    </div>
  `;
}

// ── Feed — Geeves-style post cards ──────────────────────────────────
function renderFeed() {
  // If a creator is selected, filter to their posts
  let posts = allPosts;
  if (selectedCreator) {
    posts = allPosts.filter(p => p.creator === selectedCreator);
  }

  if (posts.length === 0) {
    return `<div class="empty-state"><p>${selectedCreator ? `No posts found for @${escapeHtml(selectedCreator)}.` : 'No posts yet. Add creators to populate the feed.'}</p>
    ${selectedCreator ? `<button class="btn btn-ghost btn-sm comp-clear-filter">Show All Posts</button>` : ''}</div>`;
  }

  const creatorList = [...new Set(allPosts.map(p => p.creator))];

  return `
    <div class="comp-feed-toolbar">
      <select class="form-select form-select-sm" id="compFeedCreatorFilter">
        <option value="">All Creators (${allPosts.length})</option>
        ${creatorList.map(c => `<option value="${escapeHtml(c)}" ${c === selectedCreator ? 'selected' : ''}>@${escapeHtml(c)}</option>`).join('')}
      </select>
      ${selectedCreator ? `<button class="btn btn-ghost btn-xs comp-clear-filter">Clear Filter</button>` : ''}
      <span class="text-sm text-secondary">${posts.length} post${posts.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="comp-posts-grid">
      ${posts.map(p => renderPostCard(p)).join('')}
    </div>
  `;
}

function renderPostCard(p) {
  const hookColor = getHookColor(p.hookStructure);
  return `
    <div class="comp-post-card" data-post-id="${escapeHtml(p.id)}">
      <div class="comp-post-header">
        <span class="comp-creator">@${escapeHtml(p.creator || 'unknown')}</span>
        <span class="comp-date">${p.date ? formatDate(p.date) : '--'}</span>
      </div>

      ${p.imageUrl ? `
      <div class="comp-thumb-wrap">
        <img class="comp-thumb-img" src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy" onerror="this.parentElement.style.display='none'">
      </div>` : ''}

      <div class="comp-stats-bar">
        <div class="comp-stat-item">
          <span class="comp-stat-number">${formatCompact(p.views)}</span>
          <span class="comp-stat-lbl">views</span>
        </div>
        <div class="comp-stat-item">
          <span class="comp-stat-number">${formatCompact(p.likes)}</span>
          <span class="comp-stat-lbl">likes</span>
        </div>
        <div class="comp-stat-item">
          <span class="comp-stat-number">${formatCompact(p.comments)}</span>
          <span class="comp-stat-lbl">comments</span>
        </div>
      </div>

      ${p.hookFramework ? `
      <div class="comp-hook-framework">
        <div class="comp-framework-text">"${escapeHtml(p.hookFramework)}"</div>
      </div>` : ''}

      <div class="comp-analysis">
        ${renderField('Hook Structure', p.hookStructure)}
        ${renderField('Content Structure', p.contentStructure)}
        ${renderField('Visual Format', p.visualFormat)}
        ${renderField('Visual Hook', p.visualHook)}
        ${renderField('Text Hook', p.textHook)}
        ${renderField('Spoken Hook', p.spokenHook)}
        ${renderField('Topic', p.topic || p.topicTag)}
        ${renderField('Summary', p.summary)}
        ${renderField('CTA', p.cta)}
      </div>

      <div class="comp-badges">
        ${p.hookStructure ? `<span class="comp-badge hook-badge" style="background:${hookColor.bg};color:${hookColor.text};border:1px solid ${hookColor.border}">${escapeHtml(p.hookStructure)}</span>` : ''}
        ${p.contentStructure ? `<span class="comp-badge content-badge">${escapeHtml(p.contentStructure)}</span>` : ''}
        ${p.visualFormat ? `<span class="comp-badge visual-badge">${escapeHtml(p.visualFormat)}</span>` : ''}
      </div>

      ${p.permalink ? `<a href="${escapeHtml(p.permalink)}" target="_blank" rel="noopener noreferrer" class="comp-link">View Original →</a>` : ''}
    </div>
  `;
}

function renderField(label, value) {
  if (!value) return '';
  return `<div class="comp-detail"><span class="comp-label">${escapeHtml(label)}</span><span class="comp-value">${escapeHtml(value)}</span></div>`;
}

// ── Hook Library — grouped by hook type ─────────────────────────────
function renderHookLibrary() {
  const postsWithHooks = allPosts.filter(p => p.hookFramework);

  if (postsWithHooks.length === 0) {
    return '<div class="empty-state"><p>No hook frameworks found. Add creators with analyzed content.</p></div>';
  }

  // Group by hookStructure
  const grouped = {};
  postsWithHooks.forEach(p => {
    const key = p.hookStructure || 'uncategorized';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(p);
  });

  const sortedGroups = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

  return `
    <div class="hook-library-grouped">
      ${sortedGroups.map(([structure, posts]) => {
        const color = getHookColor(structure);
        return `
          <div class="hook-group">
            <div class="hook-group-header">
              <h3><span class="hook-group-dot" style="background:${color.text}"></span>${escapeHtml(structure)}</h3>
              <span class="hook-group-count">${posts.length} hook${posts.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="hook-group-items">
              ${posts.map(p => `
                <div class="hook-swipe-card">
                  <div class="hook-swipe-framework">"${escapeHtml(p.hookFramework)}"</div>
                  <div class="hook-swipe-meta">
                    <span class="comp-creator">@${escapeHtml(p.creator)}</span>
                    ${p.topic || p.topicTag ? `<span class="hook-swipe-topic">${escapeHtml(p.topic || p.topicTag)}</span>` : ''}
                    <span class="text-xs text-tertiary">${formatCompact(p.likes)} likes</span>
                  </div>
                  ${p.textHook ? `<div class="hook-swipe-texthook">"${escapeHtml(p.textHook.slice(0, 100))}${p.textHook.length > 100 ? '...' : ''}"</div>` : ''}
                  <a href="${escapeHtml(p.permalink || `https://instagram.com/${p.creator}`)}" target="_blank" rel="noopener noreferrer" class="hook-source-link" onclick="event.stopPropagation()">View Profile ↗</a>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// ── Hook color mapping ──────────────────────────────────────────────
function getHookColor(hookType) {
  const colors = {
    curiosity:      { bg: 'rgba(139,92,246,0.1)',  text: '#7c3aed', border: 'rgba(139,92,246,0.3)' },
    pain:           { bg: 'rgba(239,68,68,0.1)',    text: '#dc2626', border: 'rgba(239,68,68,0.3)' },
    authority:      { bg: 'rgba(34,197,94,0.1)',    text: '#16a34a', border: 'rgba(34,197,94,0.3)' },
    'social-proof': { bg: 'rgba(59,130,246,0.1)',   text: '#2563eb', border: 'rgba(59,130,246,0.3)' },
    contrarian:     { bg: 'rgba(245,158,11,0.1)',   text: '#d97706', border: 'rgba(245,158,11,0.3)' },
    education:      { bg: 'rgba(20,184,166,0.1)',   text: '#0d9488', border: 'rgba(20,184,166,0.3)' },
    transformation: { bg: 'rgba(236,72,153,0.1)',   text: '#db2777', border: 'rgba(236,72,153,0.3)' },
    storytelling:   { bg: 'rgba(168,85,247,0.1)',   text: '#9333ea', border: 'rgba(168,85,247,0.3)' },
  };
  return colors[(hookType || '').toLowerCase()] || { bg: 'rgba(107,114,128,0.1)', text: '#6b7280', border: 'rgba(107,114,128,0.3)' };
}

// ── Compact number formatter ────────────────────────────────────────
function formatCompact(n) {
  if (!n || n === 0) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
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

    // Add creator button → open modal
    if (e.target.closest('#addCompCreatorBtn')) {
      openAddCreatorModal();
      return;
    }

    // Remove creator
    const removeBtn = e.target.closest('.comp-remove-btn');
    if (removeBtn) {
      e.stopPropagation();
      const username = removeBtn.dataset.username;
      if (!confirm(`Remove @${username}?`)) return;

      let ok = false;
      if (dataSource === 'supabase') {
        ok = await removeCreator(username);
      } else {
        ok = removeCreatorLocal(username);
      }
      if (ok) {
        creators = creators.filter(c => c.username !== username);
        allPosts = allPosts.filter(p => p.creator !== username);
        renderCompetitors();
        showToast(`Removed @${username}`);
      }
      return;
    }

    // View posts for a creator
    const viewPostsBtn = e.target.closest('.comp-view-posts-btn');
    if (viewPostsBtn) {
      e.stopPropagation();
      selectedCreator = viewPostsBtn.dataset.username;
      activeSubtab = 'comp-feed';
      renderCompetitors();
      return;
    }

    // Clear filter
    if (e.target.closest('.comp-clear-filter')) {
      selectedCreator = null;
      renderCompetitors();
      return;
    }

    // Post detail (click on post card)
    const postCard = e.target.closest('.comp-post-card');
    if (postCard && !e.target.closest('a')) {
      const postId = postCard.dataset.postId;
      const post = allPosts.find(p => p.id === postId);
      if (post) showPostDetail(post);
    }
  });

  // Creator filter dropdown in feed
  container.addEventListener('change', (e) => {
    if (e.target.id === 'compFeedCreatorFilter') {
      selectedCreator = e.target.value || null;
      renderCompetitors();
    }
  });
}

// ── Add Creator Modal ───────────────────────────────────────────────
function openAddCreatorModal() {
  const body = $('#settingsBody');
  const title = $('#settingsTitle');
  if (!body) return;

  if (title) title.textContent = 'Add Creator';

  body.innerHTML = `
    <div class="add-creator-form">
      <div class="form-group">
        <label class="form-label" for="addCreatorInput">Instagram Username</label>
        <div class="input-with-prefix">
          <span class="input-prefix">@</span>
          <input type="text" class="form-input" id="addCreatorInput" placeholder="username" autocomplete="off" autofocus>
        </div>
        <span class="form-help text-xs text-tertiary">Enter the Instagram handle of the creator to track.</span>
      </div>
      <div class="form-actions" style="margin-top:16px;">
        <button class="btn btn-primary" id="confirmAddCreatorBtn">Add Creator</button>
      </div>
      <div id="addCreatorFeedback" class="form-feedback" style="margin-top:8px;"></div>
    </div>
  `;

  // Hide save button
  const saveBtn = $('#saveSettingsBtn');
  if (saveBtn) saveBtn.style.display = 'none';

  openModal('settingsModal');

  // Focus input
  setTimeout(() => { const inp = $('#addCreatorInput'); if (inp) inp.focus(); }, 100);

  // Add event
  const confirmBtn = $('#confirmAddCreatorBtn');
  const input = $('#addCreatorInput');
  const feedback = $('#addCreatorFeedback');

  const doAdd = async () => {
    const val = input?.value?.trim();
    if (!val) {
      if (feedback) feedback.innerHTML = '<span class="text-error">Please enter a username</span>';
      return;
    }
    const clean = val.replace(/^@/, '').toLowerCase();

    // Check if already tracked
    if (creators.find(c => c.username === clean)) {
      if (feedback) feedback.innerHTML = '<span class="text-error">@' + escapeHtml(clean) + ' is already tracked</span>';
      return;
    }

    if (feedback) feedback.innerHTML = '<span class="text-secondary">Adding...</span>';

    let result = null;
    if (dataSource === 'supabase') {
      result = await addCreator(clean);
    } else {
      result = addCreatorLocal(clean);
    }

    if (result) {
      creators.push(result);
      closeModal('settingsModal');
      if (saveBtn) saveBtn.style.display = '';
      renderCompetitors();
      showToast(`Added @${clean}`, 'success');
    } else {
      if (feedback) feedback.innerHTML = '<span class="text-error">Failed to add creator</span>';
    }
  };

  if (confirmBtn) confirmBtn.addEventListener('click', doAdd);
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });

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

// ── Post Detail Modal ───────────────────────────────────────────────
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

      ${post.hookFramework ? `
      <div class="post-detail-framework">
        <h3>Hook Framework</h3>
        <p>"${escapeHtml(post.hookFramework)}"</p>
      </div>` : ''}

      <div class="post-detail-analysis">
        ${detailField('Hook Structure', post.hookStructure)}
        ${detailField('Content Structure', post.contentStructure)}
        ${detailField('Visual Format', post.visualFormat)}
        ${detailField('Visual Hook', post.visualHook)}
        ${detailField('Text Hook', post.textHook)}
        ${detailField('Spoken Hook', post.spokenHook)}
        ${detailField('Topic', post.topic || post.topicTag)}
        ${detailField('CTA', post.cta)}
      </div>

      ${post.summary ? `
      <div class="post-detail-summary">
        <h3>Summary</h3>
        <p>${escapeHtml(post.summary)}</p>
      </div>` : ''}

      <div class="post-detail-caption-section">
        <h3>Full Caption</h3>
        <p class="post-detail-caption-text">${escapeHtml(post.caption || 'No caption')}</p>
      </div>

      ${post.permalink ? `<a href="${escapeHtml(post.permalink)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="margin-top:8px">View on Instagram ↗</a>` : ''}
    </div>
  `;

  const saveBtn = $('#saveSettingsBtn');
  if (saveBtn) saveBtn.style.display = 'none';

  openModal('settingsModal');

  const observer = new MutationObserver(() => {
    const modal = $('#settingsModal');
    if (modal && modal.hidden) {
      if (saveBtn) saveBtn.style.display = '';
      observer.disconnect();
    }
  });
  observer.observe($('#settingsModal'), { attributes: true });
}

function detailField(label, value) {
  if (!value) return '';
  return `<div class="post-detail-field"><span class="comp-label">${escapeHtml(label)}</span><span class="comp-value">${escapeHtml(value)}</span></div>`;
}
