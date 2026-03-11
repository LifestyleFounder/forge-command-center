// api/skool-conversations.js — Fetch Skool DM conversations from Supabase
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

  try {
    const filter = req.query.filter; // 'unread' or undefined
    let url = `${SUPABASE_URL}/rest/v1/skool_conversations?select=*&order=last_message_at.desc.nullslast&limit=50`;

    if (filter === 'unread') {
      url += '&is_unread=eq.true';
    }

    if (req.query.search) {
      const q = req.query.search.replace(/%/g, '');
      url += `&or=(other_user_name.ilike.*${encodeURIComponent(q)}*,other_user_first.ilike.*${encodeURIComponent(q)}*,other_user_last.ilike.*${encodeURIComponent(q)}*,last_message_content.ilike.*${encodeURIComponent(q)}*)`;
    }

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

    const conversations = await resp.json();
    return res.status(200).json({ conversations });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
