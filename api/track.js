// api/track.js — Tracking endpoint for funnel events
// Writes page_view and form_submit events to Supabase funnel_events table.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  // CORS — allow any origin (tracking pixel pattern)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const body = req.body || {};
    // Accept both short names (slug/event) and full names (page_slug/event_type)
    const page_slug = body.page_slug || body.slug;
    const event_type = body.event_type || body.event;
    const visitor_id = body.visitor_id;
    const referrer = body.referrer;

    if (!page_slug || !event_type) {
      return res.status(400).json({ error: 'page_slug and event_type required' });
    }

    const allowed = ['page_view', 'form_submit'];
    if (!allowed.includes(event_type)) {
      return res.status(400).json({ error: 'Invalid event_type' });
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/funnel_events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        page_slug: String(page_slug).slice(0, 200),
        event_type,
        visitor_id: visitor_id ? String(visitor_id).slice(0, 100) : null,
        referrer: referrer ? String(referrer).slice(0, 500) : null,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[track] Supabase error:', text);
      return res.status(500).json({ error: 'Failed to write event' });
    }

    return res.status(204).end();
  } catch (err) {
    console.error('[track] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
