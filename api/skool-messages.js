// api/skool-messages.js — Fetch messages for a Skool DM conversation from Supabase
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase config' });
  }

  const channelId = req.query.channel_id;
  if (!channelId) {
    return res.status(400).json({ error: 'channel_id required' });
  }

  try {
    const limit = req.query.limit || 100;
    const url = `${SUPABASE_URL}/rest/v1/skool_messages?channel_id=eq.${encodeURIComponent(channelId)}&order=created_at.asc&limit=${limit}`;

    const resp = await fetch(url, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: text });
    }

    const messages = await resp.json();
    return res.status(200).json({ messages });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
