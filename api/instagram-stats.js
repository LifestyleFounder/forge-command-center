// api/instagram-stats.js — Fetch Dan's Instagram growth data from Supabase
// GET → returns creator stats, snapshots, and recent posts

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DAN_USERNAME = 'iamdanharrison';

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
    // Get Dan's creator record
    const creators = await sbGet('ig_creators', `username=eq.${DAN_USERNAME}&limit=1`);
    if (!creators.length) {
      return res.json({ empty: true });
    }

    const creator = creators[0];

    // Fetch snapshots and recent posts in parallel
    const [snapshots, posts] = await Promise.all([
      sbGet('ig_creator_snapshots', `creator_id=eq.${creator.id}&order=snapshot_date.asc&limit=90`),
      sbGet('ig_posts', `creator_username=eq.${DAN_USERNAME}&order=posted_at.desc.nullslast&limit=12&select=id,caption,likes_count,comments_count,post_type,thumbnail_url,posted_at`),
    ]);

    return res.json({ creator, snapshots, posts });
  } catch (err) {
    console.error('[instagram-stats]', err);
    return res.status(500).json({ error: err.message });
  }
}
