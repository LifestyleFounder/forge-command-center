// js/services/creator-scraper.js — Instagram creator data from Supabase
// ──────────────────────────────────────────────────────────────────────
//
// Actual Supabase schema (verified Feb 27, 2026):
//   ig_creators:          id, username, full_name, profile_pic_url, bio, is_active, created_at
//   ig_posts:             id, creator_id, shortcode, caption, post_type, likes, comments, views,
//                         thumbnail_url, post_url, posted_at, scraped_at, spoken_hook, hook_framework,
//                         hook_structure, topic_tag, text_hook, visual_hook, visual_format, ...
//   ig_creator_snapshots: id, creator_id, followers, following, posts_count, avg_likes, avg_comments,
//                         engagement_rate, scraped_at
//   ig_scrape_runs:       id, status, creators_scraped, posts_found, error_message, started_at, completed_at

import { getSupabase } from './supabase.js';

const IMG_PROXY = 'https://anthropic-proxy.dan-a14.workers.dev/img-proxy';

// ── Creators ─────────────────────────────────────────────────────────

export async function getCreators() {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    // Join with latest snapshot per creator for follower/engagement data
    const { data, error } = await sb
      .from('ig_creators')
      .select('*, ig_creator_snapshots(followers, following, posts_count, avg_likes, avg_comments, engagement_rate, scraped_at)')
      .eq('is_active', true)
      .order('username', { ascending: true });
    if (error) throw error;
    return (data || []).map(normalizeCreator);
  } catch (err) {
    console.warn('[creator-scraper] getCreators failed', err);
    return [];
  }
}

export async function addCreator(username) {
  const sb = getSupabase();
  if (!sb) return null;
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  if (!clean) return null;
  try {
    const { data, error } = await sb
      .from('ig_creators')
      .upsert({ username: clean, is_active: true }, { onConflict: 'username' })
      .select('*, ig_creator_snapshots(followers, following, posts_count, avg_likes, avg_comments, engagement_rate, scraped_at)')
      .single();
    if (error) throw error;
    return normalizeCreator(data);
  } catch (err) {
    console.warn('[creator-scraper] addCreator failed', err);
    return null;
  }
}

export async function removeCreator(username) {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from('ig_creators')
      .update({ is_active: false })
      .eq('username', username);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[creator-scraper] removeCreator failed', err);
    return false;
  }
}

// ── Posts ─────────────────────────────────────────────────────────────

export async function getTopPosts(limit = 50) {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('ig_posts')
      .select('*, ig_creators(username, profile_pic_url)')
      .order('likes', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(normalizePost);
  } catch (err) {
    console.warn('[creator-scraper] getTopPosts failed', err);
    return [];
  }
}

export async function getRecentPosts(limit = 30) {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('ig_posts')
      .select('*, ig_creators(username, profile_pic_url)')
      .order('posted_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(normalizePost);
  } catch (err) {
    console.warn('[creator-scraper] getRecentPosts failed', err);
    return [];
  }
}

export async function getPostsByCreator(username, limit = 20) {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('ig_posts')
      .select('*, ig_creators!inner(username)')
      .eq('ig_creators.username', username)
      .order('posted_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map(normalizePost);
  } catch (err) {
    console.warn('[creator-scraper] getPostsByCreator failed', err);
    return [];
  }
}

// ── Snapshots ────────────────────────────────────────────────────────

export async function getSnapshots(username) {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('ig_creator_snapshots')
      .select('*, ig_creators!inner(username)')
      .eq('ig_creators.username', username)
      .order('scraped_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[creator-scraper] getSnapshots failed', err);
    return [];
  }
}

// ── Scrape Runs ──────────────────────────────────────────────────────

export async function getScrapeRuns(limit = 10) {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('ig_scrape_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('[creator-scraper] getScrapeRuns failed', err);
    return [];
  }
}

// ── Hybrid data source ──────────────────────────────────────────────
// Tries Supabase first. Falls back to static JSON + localStorage edits.

const LS_KEY = 'forge-creator-edits';

function getLocalEdits() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
  catch { return {}; }
}

function saveLocalEdits(edits) {
  localStorage.setItem(LS_KEY, JSON.stringify(edits));
}

export async function getCreatorsWithFallback() {
  // Fetch Supabase data
  const sbCreators = await getCreators();
  const sbPosts = sbCreators.length > 0 ? await getRecentPosts(50) : [];

  // Check if Supabase has RICH creator profiles (followers, bio, engagement)
  const hasRichProfiles = sbCreators.some(c => c.followers > 0 && c.bio);

  // If Supabase has rich profiles, use it directly
  if (hasRichProfiles) {
    return { creators: sbCreators, posts: sbPosts, source: 'supabase' };
  }

  // Otherwise: load static JSON for rich profiles, merge with Supabase posts
  try {
    const res = await fetch('data/creators.json?t=' + Date.now());
    const data = await res.json();
    const edits = getLocalEdits();
    const removed = edits.removed || [];
    const added = edits.added || [];

    // Start with static creators (rich profiles)
    let creators = (data.creators || [])
      .filter(c => !removed.includes(c.username))
      .map(normalizeStaticCreator);

    // Merge in locally-added creators (placeholders)
    added.forEach(a => {
      if (!creators.find(c => c.username === a.username) && !removed.includes(a.username)) {
        creators.push(a);
      }
    });

    // Also merge in any Supabase creators that aren't in static data
    sbCreators.forEach(sc => {
      if (!creators.find(c => c.username === sc.username) && !removed.includes(sc.username)) {
        creators.push(sc);
      }
    });

    // Combine posts: static analyzed posts + Supabase scraped posts (deduped)
    const staticPosts = extractStaticPosts(data.creators || [], removed);
    const postIds = new Set(staticPosts.map(p => p.id));
    const mergedPosts = [...staticPosts];
    sbPosts.forEach(sp => {
      if (!postIds.has(sp.id)) mergedPosts.push(sp);
    });
    mergedPosts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    return { creators, posts: mergedPosts, source: sbPosts.length > 0 ? 'hybrid' : 'static', lastUpdated: data.lastUpdated };
  } catch (err) {
    console.warn('[creator-scraper] Static JSON fallback failed', err);
    // Last resort: just return whatever Supabase has
    if (sbCreators.length > 0) return { creators: sbCreators, posts: sbPosts, source: 'supabase' };
    return { creators: [], posts: [], source: 'none' };
  }
}

export function addCreatorLocal(username) {
  const clean = username.replace(/^@/, '').trim().toLowerCase();
  if (!clean) return null;
  const edits = getLocalEdits();
  if (!edits.added) edits.added = [];
  if (!edits.removed) edits.removed = [];

  // Remove from "removed" list if it was previously removed
  edits.removed = edits.removed.filter(u => u !== clean);

  // Add placeholder if not already there
  if (!edits.added.find(a => a.username === clean)) {
    const placeholder = {
      id: 'local-' + clean,
      username: clean,
      fullName: '@' + clean,
      bio: 'Manually added — data will populate when scraper runs.',
      profilePic: '',
      followers: 0,
      following: 0,
      posts: 0,
      engagementRate: 0,
      avgLikes: 0,
      avgComments: 0,
      niche: '',
      isActive: true,
      lastScraped: new Date().toISOString(),
      topContent: [],
    };
    edits.added.push(placeholder);
    saveLocalEdits(edits);
    return placeholder;
  }
  saveLocalEdits(edits);
  return edits.added.find(a => a.username === clean);
}

export function removeCreatorLocal(username) {
  const edits = getLocalEdits();
  if (!edits.removed) edits.removed = [];
  if (!edits.added) edits.added = [];

  // Add to removed list
  if (!edits.removed.includes(username)) {
    edits.removed.push(username);
  }
  // Remove from added list
  edits.added = edits.added.filter(a => a.username !== username);
  saveLocalEdits(edits);
  return true;
}

function normalizeStaticCreator(c) {
  return {
    id: c.id,
    username: c.username,
    fullName: c.fullName || '',
    bio: c.bio || '',
    profilePic: c.profilePic || '',
    followers: c.followers || 0,
    following: c.following || 0,
    posts: c.posts || 0,
    engagementRate: c.engagementRate || 0,
    avgLikes: c.avgLikes || 0,
    avgComments: c.avgComments || 0,
    niche: c.niche || '',
    isActive: true,
    lastScraped: c.lastUpdated || '2026-02-27',
    topContent: c.topContent || [],
  };
}

function extractStaticPosts(creators, removed = []) {
  const posts = [];
  creators.forEach(c => {
    if (removed.includes(c.username)) return;
    (c.topContent || []).forEach(p => {
      posts.push({
        id: p.id,
        shortcode: '',
        creator: c.username,
        creatorPic: c.profilePic || '',
        caption: p.caption || '',
        type: (p.type || 'post').toLowerCase(),
        imageUrl: '',
        likes: p.likes || 0,
        comments: p.comments || 0,
        views: p.views || 0,
        date: p.date,
        permalink: p.permalink || '',
        spokenHook: p.spokenHook || '',
        textHook: p.textHook || '',
        hookStructure: p.hookStructure || '',
        hookFramework: p.hookFramework || '',
        contentStructure: p.contentStructure || '',
        visualFormat: p.visualFormat || '',
        visualHook: p.visualHook || '',
        topic: p.topic || '',
        summary: p.summary || '',
        cta: p.cta || '',
        topicTag: p.topic || '',
      });
    });
  });
  return posts.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

// ── Proxy helper ─────────────────────────────────────────────────────

export function proxyImageUrl(url) {
  if (!url) return '';
  if (url.includes('instagram') || url.includes('cdninstagram') || url.includes('fbcdn')) {
    return `${IMG_PROXY}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

// ── Normalizers ──────────────────────────────────────────────────────

function normalizeCreator(row) {
  // Snapshots come as array from the join — grab the latest one
  const snapshots = row.ig_creator_snapshots || [];
  const latest = snapshots.sort((a, b) =>
    new Date(b.scraped_at || 0) - new Date(a.scraped_at || 0)
  )[0] || {};

  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name || '',
    profilePic: proxyImageUrl(row.profile_pic_url),
    followers: latest.followers || 0,
    following: latest.following || 0,
    posts: latest.posts_count || 0,
    engagementRate: latest.engagement_rate || 0,
    avgLikes: latest.avg_likes || 0,
    bio: row.bio || '',
    isActive: row.is_active,
    lastScraped: latest.scraped_at || row.created_at,
  };
}

function normalizePost(row) {
  const creator = row.ig_creators;
  // Use Instagram's /media/ endpoint for fresh images (CDN thumbnails expire)
  const freshImageUrl = row.shortcode
    ? proxyImageUrl(`https://www.instagram.com/p/${row.shortcode}/media/?size=l`)
    : '';
  return {
    id: row.id,
    shortcode: row.shortcode,
    creator: creator?.username || '',
    creatorPic: proxyImageUrl(creator?.profile_pic_url),
    caption: row.caption || '',
    type: row.post_type || 'post',
    imageUrl: freshImageUrl,
    likes: row.likes || 0,
    comments: row.comments || 0,
    views: row.views || 0,
    date: row.posted_at,
    permalink: row.post_url || (row.shortcode ? `https://instagram.com/p/${row.shortcode}` : ''),
    spokenHook: row.spoken_hook || '',
    textHook: row.text_hook || '',
    hookStructure: row.hook_structure || '',
    hookFramework: row.hook_framework || '',
    contentStructure: row.content_structure || '',
    visualFormat: row.visual_format || '',
    visualHook: row.visual_hook || '',
    topic: row.topic || '',
    summary: row.summary || '',
    cta: row.cta || '',
    topicTag: row.topic_tag || '',
  };
}
