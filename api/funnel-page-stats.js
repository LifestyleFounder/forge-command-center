// api/funnel-page-stats.js — Per-page funnel stats for the Funnels tab
// Returns views (all + unique), opt-ins (all + rate) per page slug.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not configured' });
  }

  try {
    const slugsParam = req.query.slugs; // comma-separated
    const startParam = req.query.start; // YYYY-MM-DD
    const endParam = req.query.end;     // YYYY-MM-DD

    if (!slugsParam) {
      return res.status(400).json({ error: 'slugs parameter required' });
    }

    const slugs = slugsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (slugs.length === 0) {
      return res.status(400).json({ error: 'No valid slugs provided' });
    }

    // Date range
    const end = endParam || new Date().toISOString().slice(0, 10);
    const start = startParam || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().slice(0, 10);
    })();

    const sinceISO = new Date(start + 'T00:00:00Z').toISOString();
    const untilISO = new Date(end + 'T23:59:59.999Z').toISOString();

    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    };

    // Fetch all events for these slugs in the date range
    const params = new URLSearchParams({
      select: 'event_type,created_at,page_slug,visitor_id',
      'created_at': `gte.${sinceISO}`,
      order: 'created_at.asc',
      limit: '50000',
    });
    params.append('created_at', `lte.${untilISO}`);
    params.set('page_slug', `in.(${slugs.join(',')})`);

    const response = await fetch(`${SUPABASE_URL}/rest/v1/funnel_events?${params}`, { headers });

    if (!response.ok) {
      const text = await response.text();
      console.error('[funnel-page-stats] Supabase error:', text);
      return res.status(500).json({ error: 'Failed to query events' });
    }

    const events = await response.json();

    // Aggregate per page
    const pages = {};
    for (const slug of slugs) {
      pages[slug] = {
        views: { all: 0, unique: 0 },
        optins: { all: 0, rate: '0%' },
        daily: {},
      };
    }

    // Track unique visitors per page
    const uniqueViewers = {};
    const uniqueOptins = {};
    for (const slug of slugs) {
      uniqueViewers[slug] = new Set();
      uniqueOptins[slug] = new Set();
    }

    for (const e of events) {
      const slug = e.page_slug;
      if (!pages[slug]) continue;

      const date = e.created_at.slice(0, 10);
      if (!pages[slug].daily[date]) {
        pages[slug].daily[date] = { date, views: 0, submissions: 0 };
      }

      if (e.event_type === 'page_view') {
        pages[slug].views.all++;
        pages[slug].daily[date].views++;
        if (e.visitor_id) uniqueViewers[slug].add(e.visitor_id);
      } else if (e.event_type === 'form_submit') {
        pages[slug].optins.all++;
        pages[slug].daily[date].submissions++;
        if (e.visitor_id) uniqueOptins[slug].add(e.visitor_id);
      }
    }

    // Calculate unique counts and rates
    for (const slug of slugs) {
      const p = pages[slug];
      p.views.unique = uniqueViewers[slug].size;
      const rate = p.views.all > 0
        ? ((p.optins.all / p.views.all) * 100).toFixed(1)
        : '0.0';
      p.optins.rate = rate + '%';

      // Convert daily map to sorted array
      p.daily = Object.values(p.daily).sort((a, b) => a.date.localeCompare(b.date));
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      pages,
      dateRange: { start, end },
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[funnel-page-stats] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
