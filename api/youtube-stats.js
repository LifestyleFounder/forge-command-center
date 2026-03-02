// api/youtube-stats.js — Server-side YouTube Data API proxy
// GET → returns channel stats + recent videos with per-video metrics

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const CHANNEL_ID = 'UCsaposjX2IR0HY3YhrkUnMg';

async function ytGet(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  params.key = YOUTUBE_API_KEY;
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`YouTube API ${endpoint}: ${res.status} ${await res.text()}`);
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!YOUTUBE_API_KEY) {
    return res.status(500).json({ error: 'YOUTUBE_API_KEY not configured' });
  }

  try {
    // 1. Channel stats
    const channelData = await ytGet('channels', {
      part: 'statistics,snippet',
      id: CHANNEL_ID,
    });

    const channel = channelData.items?.[0];
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const stats = channel.statistics;
    const channelStats = {
      subscribers: Number(stats.subscriberCount),
      totalViews: Number(stats.viewCount),
      totalVideos: Number(stats.videoCount),
      channelTitle: channel.snippet?.title || '',
    };

    // 2. Recent video IDs via search
    const searchData = await ytGet('search', {
      part: 'id',
      channelId: CHANNEL_ID,
      maxResults: '10',
      order: 'date',
      type: 'video',
    });

    const videoIds = (searchData.items || [])
      .map(item => item.id?.videoId)
      .filter(Boolean)
      .join(',');

    if (!videoIds) {
      return res.json({ channelStats, recentVideos: [] });
    }

    // 3. Per-video stats
    const videosData = await ytGet('videos', {
      part: 'snippet,statistics',
      id: videoIds,
    });

    const recentVideos = (videosData.items || []).map(v => ({
      id: v.id,
      title: v.snippet?.title || '',
      thumbnail: v.snippet?.thumbnails?.medium?.url || '',
      publishedAt: v.snippet?.publishedAt || '',
      views: Number(v.statistics?.viewCount || 0),
      likes: Number(v.statistics?.likeCount || 0),
      comments: Number(v.statistics?.commentCount || 0),
    }));

    return res.json({ channelStats, recentVideos });
  } catch (err) {
    console.error('[youtube-stats]', err);
    return res.status(500).json({ error: err.message });
  }
}
