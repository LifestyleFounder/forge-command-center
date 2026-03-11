// api/skool-send.js — Send a message via Skool chat API (proxied through Playwright)
// NOTE: This is a placeholder. Sending requires a live Playwright session with Skool auth.
// For now, it stores the intent in Supabase as a pending outbound message.
// The poller running on Geeves (Mac Mini) will pick up and send via its browser session.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase config' });
  }

  const { channel_id, content } = req.body || {};
  if (!channel_id || !content) {
    return res.status(400).json({ error: 'channel_id and content required' });
  }

  try {
    // Insert as pending outbound message in Supabase
    const msg = {
      id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channel_id,
      sender_id: '536462bbe1d54558aeac575be267e7bc', // Dan's Skool user ID
      sender_name: 'Dan Harrison',
      content,
      has_attachment: false,
      created_at: new Date().toISOString(),
    };

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/skool_messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(msg),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: text });
    }

    // Also update conversation's last message
    await fetch(`${SUPABASE_URL}/rest/v1/skool_conversations?id=eq.${encodeURIComponent(channel_id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        last_message_content: content.slice(0, 500),
        last_message_from: 'me',
        last_message_at: msg.created_at,
        updated_at: msg.created_at,
      }),
    });

    return res.status(200).json({ ok: true, message_id: msg.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
