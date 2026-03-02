// api/scrape-creators.js — Scrape Instagram posts via Apify for tracked creators
// GET (no params) → list of creators with last scrape timestamp
// GET ?username=X  → scrape one creator, upsert posts + snapshot

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APIFY_TOKEN  = process.env.APIFY_TOKEN;

const sbHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation',
};

// ── Supabase helpers ────────────────────────────────────────────────
async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPost(table, body, prefer) {
  const headers = { ...sbHeaders };
  if (prefer) headers['Prefer'] = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase POST ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbUpsert(table, onConflict, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase UPSERT ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbPatch(table, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH', headers: sbHeaders, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Main handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not configured' });
  }

  const username = req.query.username;

  try {
    // No username → return creator list with scrape status
    if (!username) {
      return res.status(200).json(await listCreators());
    }

    // With username → scrape that creator
    if (!APIFY_TOKEN) {
      return res.status(500).json({ error: 'APIFY_TOKEN not configured' });
    }

    const result = await scrapeCreator(username);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[scrape-creators] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── List creators with last scrape info ─────────────────────────────
async function listCreators() {
  const creators = await sbGet('ig_creators', 'is_active=eq.true&select=id,username,full_name,created_at,ig_creator_snapshots(scraped_at)&order=username.asc');

  return {
    creators: creators.map(c => {
      const snapshots = c.ig_creator_snapshots || [];
      const latest = snapshots.sort((a, b) =>
        new Date(b.scraped_at || 0) - new Date(a.scraped_at || 0)
      )[0];
      return {
        username: c.username,
        fullName: c.full_name,
        lastScraped: latest?.scraped_at || null,
      };
    }),
    count: creators.length,
  };
}

// ── Scrape one creator via Apify ────────────────────────────────────
async function scrapeCreator(username) {
  // 1. Find creator in Supabase
  const rows = await sbGet('ig_creators', `username=eq.${encodeURIComponent(username)}&is_active=eq.true&limit=1`);
  if (!rows.length) {
    throw new Error(`Creator @${username} not found or inactive`);
  }
  const creator = rows[0];

  const apifyUrl = `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;

  // 2a. Fetch profile details (followers, bio, etc.) — separate call because
  //     resultsType: 'posts' never includes profile-level stats
  let profileDetails = {};
  try {
    const detailsRes = await fetch(apifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${username}/`],
        resultsType: 'details',
        resultsLimit: 1,
      }),
    });
    if (detailsRes.ok) {
      const detailsItems = await detailsRes.json();
      if (detailsItems.length > 0) {
        profileDetails = detailsItems[0];
      }
    } else {
      console.warn('[scrape-creators] Apify details call failed:', detailsRes.status);
    }
  } catch (e) {
    console.warn('[scrape-creators] Apify details call error:', e.message);
  }

  // 2b. Update creator profile_pic_url and bio if we got details
  if (profileDetails.profilePicUrl || profileDetails.biography) {
    try {
      const updates = {};
      if (profileDetails.profilePicUrl) updates.profile_pic_url = profileDetails.profilePicUrl;
      if (profileDetails.biography) updates.bio = profileDetails.biography.substring(0, 500);
      if (profileDetails.fullName) updates.full_name = profileDetails.fullName;
      await sbPatch('ig_creators', `id=eq.${creator.id}`, updates);
    } catch (e) {
      console.warn('[scrape-creators] Could not update creator profile:', e.message);
    }
  }

  // 3. Fetch recent posts
  const apifyRes = await fetch(apifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      directUrls: [`https://www.instagram.com/${username}/`],
      resultsLimit: 12,
      resultsType: 'posts',
      searchType: 'user',
    }),
  });

  if (!apifyRes.ok) {
    const errText = await apifyRes.text();
    throw new Error(`Apify error (${apifyRes.status}): ${errText.slice(0, 200)}`);
  }

  const items = await apifyRes.json();

  // 4. Map Apify fields → ig_posts columns
  const now = new Date().toISOString();
  const posts = [];
  for (const d of items) {
    if (!d.shortCode) continue;
    posts.push({
      creator_id: creator.id,
      shortcode: d.shortCode,
      caption: (d.caption || '').substring(0, 2000),
      post_type: d.type || 'Image',
      likes: d.likesCount || 0,
      comments: d.commentsCount || 0,
      views: d.videoViewCount || 0,
      thumbnail_url: d.displayUrl || '',
      post_url: d.url || '',
      posted_at: d.timestamp || null,
      scraped_at: now,
    });
  }

  // 5. Upsert posts into ig_posts (dedup on shortcode)
  let upsertedCount = 0;
  if (posts.length > 0) {
    const result = await sbUpsert('ig_posts', 'shortcode', posts);
    upsertedCount = result.length;
  }

  // 6. Compute snapshot stats from scraped posts
  const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
  const totalComments = posts.reduce((s, p) => s + p.comments, 0);
  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;

  // Use real profile-level data from the details call
  let followers = profileDetails.followersCount || 0;
  let following = profileDetails.followsCount || 0;
  let postsCount = profileDetails.postsCount || posts.length;

  // If details call failed, carry forward from previous snapshot
  if (!followers) {
    try {
      const prevSnapshots = await sbGet(
        'ig_creator_snapshots',
        `creator_id=eq.${creator.id}&order=scraped_at.desc&limit=1`
      );
      if (prevSnapshots.length) {
        const prev = prevSnapshots[0];
        followers = prev.followers || 0;
        following = prev.following || 0;
        if (!postsCount) postsCount = prev.posts_count || posts.length;
      }
    } catch (e) {
      console.warn('[scrape-creators] Could not fetch previous snapshot:', e.message);
    }
  }

  const engagementRate = followers > 0
    ? Number(((avgLikes + avgComments) / followers * 100).toFixed(2))
    : 0;

  // 7. Insert creator snapshot
  await sbPost('ig_creator_snapshots', {
    creator_id: creator.id,
    followers,
    following,
    posts_count: postsCount,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    engagement_rate: engagementRate,
    scraped_at: now,
  }, 'return=representation');

  return {
    success: true,
    username,
    postsScraped: upsertedCount,
    followers,
    engagementRate,
    scrapedAt: now,
  };
}
