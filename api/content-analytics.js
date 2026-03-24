// api/content-analytics.js — Unified content analytics across Instagram + YouTube
// GET ?range=7|14|30|90&platform=all|instagram|youtube

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCsaposjX2IR0HY3YhrkUnMg';

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const range = parseInt(req.query.range) || 30;
    const platform = req.query.platform || 'all';
    const now = new Date();
    const rangeStart = new Date(now);
    rangeStart.setDate(rangeStart.getDate() - range);
    const prevStart = new Date(rangeStart);
    prevStart.setDate(prevStart.getDate() - range);

    const rangeISO = rangeStart.toISOString();
    const prevISO = prevStart.toISOString();

    let igPosts = [];
    let igPostsPrev = [];
    let igSnapshots = [];
    let ytVideos = [];
    let ytChannel = null;

    // ── Instagram data ──────────────────────────────────
    if (platform === 'all' || platform === 'instagram') {
      const creators = await sbGet('ig_creators', `username=eq.thedanharrison&limit=1`);
      if (creators.length) {
        const cid = creators[0].id;

        const [currentPosts, previousPosts, snaps] = await Promise.all([
          sbGet('ig_posts', `creator_id=eq.${cid}&posted_at=gte.${rangeISO}&order=posted_at.desc&select=id,shortcode,caption,post_type,likes,comments,views,saves,shares,thumbnail_url,post_url,posted_at,hook_framework,hook_structure,content_structure,visual_format,topic,topic_tag`),
          sbGet('ig_posts', `creator_id=eq.${cid}&posted_at=gte.${prevISO}&posted_at=lt.${rangeISO}&order=posted_at.desc&select=id,likes,comments,views,saves,shares`),
          sbGet('ig_creator_snapshots', `creator_id=eq.${cid}&order=scraped_at.asc&limit=90`),
        ]);

        igPosts = currentPosts;
        igPostsPrev = previousPosts;
        igSnapshots = snaps;
      }
    }

    // ── YouTube data ────────────────────────────────────
    if ((platform === 'all' || platform === 'youtube') && YOUTUBE_API_KEY) {
      try {
        // Channel stats
        const chRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${YOUTUBE_CHANNEL_ID}&key=${YOUTUBE_API_KEY}`);
        if (chRes.ok) {
          const chData = await chRes.json();
          if (chData.items?.length) {
            const s = chData.items[0].statistics;
            ytChannel = {
              subscribers: parseInt(s.subscriberCount) || 0,
              totalViews: parseInt(s.viewCount) || 0,
              totalVideos: parseInt(s.videoCount) || 0,
            };
          }
        }

        // Recent videos (up to 50)
        const searchRes = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${YOUTUBE_CHANNEL_ID}&type=video&order=date&maxResults=50&publishedAfter=${prevISO}&key=${YOUTUBE_API_KEY}`);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const videoIds = (searchData.items || []).map(i => i.id.videoId).filter(Boolean);
          if (videoIds.length) {
            const statsRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds.join(',')}&key=${YOUTUBE_API_KEY}`);
            if (statsRes.ok) {
              const statsData = await statsRes.json();
              ytVideos = (statsData.items || []).map(v => ({
                id: v.id,
                title: v.snippet.title,
                thumbnail: v.snippet.thumbnails?.medium?.url || '',
                publishedAt: v.snippet.publishedAt,
                views: parseInt(v.statistics.viewCount) || 0,
                likes: parseInt(v.statistics.likeCount) || 0,
                comments: parseInt(v.statistics.commentCount) || 0,
                shares: 0,
                saves: 0,
                platform: 'youtube',
              }));
            }
          }
        }
      } catch (ytErr) {
        console.warn('[content-analytics] YouTube fetch failed:', ytErr.message);
      }
    }

    // ── Compute KPIs ────────────────────────────────────
    // Normalize IG posts to unified format
    const igNormalized = igPosts.map(p => ({
      id: p.id,
      post_id: p.shortcode,
      title: (p.caption || '').slice(0, 80),
      thumbnail: p.shortcode ? `https://anthropic-proxy.dan-a14.workers.dev/img-proxy?url=${encodeURIComponent(`https://www.instagram.com/p/${p.shortcode}/media/?size=l`)}` : '',
      link: p.post_url || (p.shortcode ? `https://instagram.com/p/${p.shortcode}` : ''),
      platform: 'instagram',
      post_type: p.post_type || 'Post',
      publishedAt: p.posted_at,
      views: p.views || 0,
      likes: p.likes || 0,
      comments: p.comments || 0,
      shares: p.shares || 0,
      saves: p.saves || 0,
      hook_framework: p.hook_framework,
      hook_structure: p.hook_structure,
      content_structure: p.content_structure,
      visual_format: p.visual_format,
      topic: p.topic,
      topic_tag: p.topic_tag,
    }));

    // Filter YT videos to current range
    const ytInRange = ytVideos.filter(v => new Date(v.publishedAt) >= rangeStart);
    const ytPrev = ytVideos.filter(v => {
      const d = new Date(v.publishedAt);
      return d >= prevStart && d < rangeStart;
    });

    const allPosts = [...igNormalized, ...ytInRange];

    // Current period totals
    const totalViews = allPosts.reduce((s, p) => s + p.views, 0);
    const totalLikes = allPosts.reduce((s, p) => s + p.likes, 0);
    const totalComments = allPosts.reduce((s, p) => s + p.comments, 0);
    const totalShares = allPosts.reduce((s, p) => s + (p.shares || 0), 0);
    const totalSaves = allPosts.reduce((s, p) => s + (p.saves || 0), 0);
    const avgEngagement = totalViews > 0
      ? ((totalLikes + totalComments + totalShares + totalSaves) / totalViews * 100)
      : 0;

    // Previous period totals
    const prevViews = igPostsPrev.reduce((s, p) => s + (p.views || 0), 0) + ytPrev.reduce((s, p) => s + p.views, 0);
    const prevLikes = igPostsPrev.reduce((s, p) => s + (p.likes || 0), 0) + ytPrev.reduce((s, p) => s + p.likes, 0);
    const prevComments = igPostsPrev.reduce((s, p) => s + (p.comments || 0), 0) + ytPrev.reduce((s, p) => s + p.comments, 0);
    const prevShares = igPostsPrev.reduce((s, p) => s + (p.shares || 0), 0) + ytPrev.reduce((s, p) => s + (p.shares || 0), 0);
    const prevSaves = igPostsPrev.reduce((s, p) => s + (p.saves || 0), 0) + ytPrev.reduce((s, p) => s + (p.saves || 0), 0);
    const prevEngagement = prevViews > 0
      ? ((prevLikes + prevComments + prevShares + prevSaves) / prevViews * 100)
      : 0;

    // Followers (latest snapshot)
    const latestSnap = igSnapshots.length ? igSnapshots[igSnapshots.length - 1] : null;
    const followers = (latestSnap?.followers || 0) + (ytChannel?.subscribers || 0);
    // Find snapshot closest to range start for previous followers
    const prevSnap = igSnapshots.find(s => new Date(s.scraped_at) >= prevStart) || igSnapshots[0];
    const prevFollowers = (prevSnap?.followers || 0) + (ytChannel?.subscribers || 0);

    function pctChange(curr, prev) {
      if (!prev) return curr > 0 ? 100 : 0;
      return ((curr - prev) / prev * 100);
    }

    const kpis = {
      views: { value: totalViews, change: pctChange(totalViews, prevViews) },
      likes: { value: totalLikes, change: pctChange(totalLikes, prevLikes) },
      engagement: { value: Math.round(avgEngagement * 100) / 100, change: Math.round((avgEngagement - prevEngagement) * 100) / 100 },
      followers: { value: followers, change: pctChange(followers, prevFollowers) },
      shares: { value: totalShares, change: pctChange(totalShares, prevShares) },
      saves: { value: totalSaves, change: pctChange(totalSaves, prevSaves) },
    };

    // ── Daily time series for charts ────────────────────
    const dailyMap = {};
    for (let d = new Date(rangeStart); d <= now; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      dailyMap[key] = { date: key, views: 0, likes: 0, comments: 0, shares: 0, saves: 0, posts: 0 };
    }
    allPosts.forEach(p => {
      if (!p.publishedAt) return;
      const key = new Date(p.publishedAt).toISOString().slice(0, 10);
      if (dailyMap[key]) {
        dailyMap[key].views += p.views;
        dailyMap[key].likes += p.likes;
        dailyMap[key].comments += p.comments;
        dailyMap[key].shares += (p.shares || 0);
        dailyMap[key].saves += (p.saves || 0);
        dailyMap[key].posts += 1;
      }
    });
    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // ── Follower sparkline data ─────────────────────────
    const followerSpark = igSnapshots.slice(-range).map(s => ({
      date: s.scraped_at,
      value: s.followers,
    }));

    // ── Hook & content analysis ─────────────────────────
    const hookBreakdown = {};
    const structureBreakdown = {};
    const formatBreakdown = {};
    const topicBreakdown = {};
    igNormalized.forEach(p => {
      if (p.hook_structure) {
        if (!hookBreakdown[p.hook_structure]) hookBreakdown[p.hook_structure] = { count: 0, totalLikes: 0, totalViews: 0 };
        hookBreakdown[p.hook_structure].count++;
        hookBreakdown[p.hook_structure].totalLikes += p.likes;
        hookBreakdown[p.hook_structure].totalViews += p.views;
      }
      if (p.content_structure) {
        if (!structureBreakdown[p.content_structure]) structureBreakdown[p.content_structure] = { count: 0, totalLikes: 0, totalViews: 0 };
        structureBreakdown[p.content_structure].count++;
        structureBreakdown[p.content_structure].totalLikes += p.likes;
        structureBreakdown[p.content_structure].totalViews += p.views;
      }
      if (p.visual_format) {
        if (!formatBreakdown[p.visual_format]) formatBreakdown[p.visual_format] = { count: 0, totalLikes: 0, totalViews: 0 };
        formatBreakdown[p.visual_format].count++;
        formatBreakdown[p.visual_format].totalLikes += p.likes;
        formatBreakdown[p.visual_format].totalViews += p.views;
      }
      if (p.topic_tag) {
        if (!topicBreakdown[p.topic_tag]) topicBreakdown[p.topic_tag] = { count: 0, totalLikes: 0, totalViews: 0 };
        topicBreakdown[p.topic_tag].count++;
        topicBreakdown[p.topic_tag].totalLikes += p.likes;
        topicBreakdown[p.topic_tag].totalViews += p.views;
      }
    });

    return res.json({
      range,
      platform,
      kpis,
      daily,
      followerSpark,
      posts: allPosts,
      analysis: {
        hooks: hookBreakdown,
        structures: structureBreakdown,
        formats: formatBreakdown,
        topics: topicBreakdown,
      },
      ytChannel,
    });
  } catch (err) {
    console.error('[content-analytics]', err);
    return res.status(500).json({ error: err.message });
  }
}
