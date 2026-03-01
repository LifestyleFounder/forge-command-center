// api/funnel-stats.js — Aggregates funnel_events from Supabase
// Returns summary + daily breakdown for the Funnels report tab.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not configured' });
  }

  try {
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceISO = since.toISOString();

    // Fetch all events in the date range
    const params = new URLSearchParams({
      select: 'event_type,created_at',
      'created_at': `gte.${sinceISO}`,
      order: 'created_at.asc',
      limit: '10000',
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/funnel_events?${params}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[funnel-stats] Supabase error:', text);
      return res.status(500).json({ error: 'Failed to query events' });
    }

    const events = await response.json();

    // Aggregate by day
    const dailyMap = {};
    let totalViews = 0;
    let totalSubmissions = 0;

    for (const e of events) {
      const date = e.created_at.slice(0, 10); // YYYY-MM-DD
      if (!dailyMap[date]) dailyMap[date] = { date, views: 0, submissions: 0 };

      if (e.event_type === 'page_view') {
        dailyMap[date].views++;
        totalViews++;
      } else if (e.event_type === 'form_submit') {
        dailyMap[date].submissions++;
        totalSubmissions++;
      }
    }

    // Fill in missing days with zeros
    const daily = [];
    const cursor = new Date(since);
    cursor.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    while (cursor <= today) {
      const dateStr = cursor.toISOString().slice(0, 10);
      daily.push(dailyMap[dateStr] || { date: dateStr, views: 0, submissions: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    const conversionRate = totalViews > 0
      ? Number(((totalSubmissions / totalViews) * 100).toFixed(1))
      : 0;

    const result = {
      summary: {
        views: totalViews,
        submissions: totalSubmissions,
        conversionRate,
      },
      daily,
      lastUpdated: new Date().toISOString(),
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[funnel-stats] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
