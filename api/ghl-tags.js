// api/ghl-tags.js — Fetch GHL location tags for audience filtering
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
    const apiRes = await fetch(`${GHL_URL}/locations/${LOCATION_ID}/tags`, {
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

    const tags = (data.tags || []).map(t => ({
      id: t.id || t._id || t.name,
      name: t.name,
    }));

    // Sort alphabetically
    tags.sort((a, b) => a.name.localeCompare(b.name));

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
    return res.status(200).json({ tags });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
