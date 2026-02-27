// js/services/creator-scraper.js — Instagram creator data from Supabase
// ──────────────────────────────────────────────────────────────────────

import { getSupabase } from './supabase.js';

const IMG_PROXY = 'https://anthropic-proxy.dan-a14.workers.dev/img-proxy';

// ── Creators ─────────────────────────────────────────────────────────

export async function getCreators() {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('ig_creators')
      .select('*')
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
      .upsert({ username: clean, tracked: true }, { onConflict: 'username' })
      .select()
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
      .update({ tracked: false })
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
      .order('likes_count', { ascending: false })
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
      .order('taken_at', { ascending: false })
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
      .order('taken_at', { ascending: false })
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
      .order('snapshot_date', { ascending: false })
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
  // Instagram CDN images need proxying
  if (url.includes('instagram') || url.includes('cdninstagram') || url.includes('fbcdn')) {
    return `${IMG_PROXY}?url=${encodeURIComponent(url)}`;
  }
  return url;
}

// ── Normalizers ──────────────────────────────────────────────────────

function normalizeCreator(row) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name || '',
    profilePic: proxyImageUrl(row.profile_pic_url),
    followers: row.follower_count || 0,
    following: row.following_count || 0,
    posts: row.media_count || 0,
    engagementRate: row.engagement_rate || 0,
    avgLikes: row.avg_likes || 0,
    bio: row.biography || '',
    tracked: row.tracked,
    lastScraped: row.last_scraped_at,
  };
}

function normalizePost(row) {
  const creator = row.ig_creators;
  return {
    id: row.id,
    shortcode: row.shortcode,
    creator: creator?.username || '',
    creatorPic: proxyImageUrl(creator?.profile_pic_url),
    caption: row.caption || '',
    type: row.media_type || 'post',
    imageUrl: proxyImageUrl(row.thumbnail_url || row.display_url),
    likes: row.likes_count || 0,
    comments: row.comments_count || 0,
    views: row.video_view_count || 0,
    date: row.taken_at,
    permalink: row.shortcode ? `https://instagram.com/p/${row.shortcode}` : '',
  };
}
