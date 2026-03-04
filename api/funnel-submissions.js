// api/funnel-submissions.js — Returns raw form_submit events with contact details
// For the clickable submissions detail view in the Funnels tab.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const SLUG_ALIASES = {
  'swipe-page': 'free-skool',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not configured' });
  }

  try {
    const slug = req.query.slug || null;
    const startParam = req.query.start;
    const endParam = req.query.end;
    const days = Math.min(parseInt(req.query.days) || 30, 365);

    let sinceISO, untilISO;
    if (startParam) {
      sinceISO = new Date(startParam + 'T00:00:00Z').toISOString();
      untilISO = endParam
        ? new Date(endParam + 'T23:59:59.999Z').toISOString()
        : new Date().toISOString();
    } else {
      const since = new Date();
      since.setDate(since.getDate() - days);
      sinceISO = since.toISOString();
      untilISO = null;
    }

    const params = new URLSearchParams({
      select: 'visitor_id,meta,created_at,page_slug',
      event_type: 'eq.form_submit',
      'created_at': `gte.${sinceISO}`,
      order: 'created_at.desc',
      limit: '50',
    });
    if (untilISO) params.append('created_at', `lte.${untilISO}`);

    // Filter by slug (+ aliases)
    if (slug && slug !== 'all') {
      const aliasedSlugs = [slug];
      for (const [alias, canonical] of Object.entries(SLUG_ALIASES)) {
        if (canonical === slug) aliasedSlugs.push(alias);
      }
      if (aliasedSlugs.length === 1) {
        params.set('page_slug', `eq.${slug}`);
      } else {
        params.set('page_slug', `in.(${aliasedSlugs.join(',')})`);
      }
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/funnel_events?${params}`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[funnel-submissions] Supabase error:', text);
      return res.status(500).json({ error: 'Failed to query submissions' });
    }

    const rows = await response.json();

    // Normalize aliased slugs, pass all meta fields through
    const submissions = rows.map(r => ({
      email: r.visitor_id || null,
      meta: r.meta || {},
      page: SLUG_ALIASES[r.page_slug] || r.page_slug,
      timestamp: r.created_at,
    }));

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ submissions });
  } catch (err) {
    console.error('[funnel-submissions] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
