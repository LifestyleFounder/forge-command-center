// api/ghl-contacts.js — Search GHL contacts by name/email/tag
// Proxies GHL API so the token stays server-side.

const GHL_URL = 'https://services.leadconnectorhq.com';
const LOCATION_ID = 'lNgTmLlqKbQL16uqww0g';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.GHL_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'GHL_API_TOKEN not configured in Vercel env vars' });
  }

  try {
    const query = req.query.query || '';
    const tag = req.query.tag || '';
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const params = new URLSearchParams({
      locationId: LOCATION_ID,
      limit: String(limit),
    });

    if (query) params.set('query', query);
    if (tag) params.set('query', tag); // GHL search covers tags too

    const apiRes = await fetch(`${GHL_URL}/contacts/?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data.message || data.msg || 'GHL API error' });
    }

    const rawContacts = data.contacts || [];

    const contacts = rawContacts.map(c => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '(no name)',
      email: c.email || '',
      phone: c.phone || '',
      tags: c.tags || [],
      source: 'ghl',
    }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      total: data.total || contacts.length,
      contacts,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
