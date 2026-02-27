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
    topicTag: row.topic_tag || '',
    visualFormat: row.visual_format || '',
  };
}
