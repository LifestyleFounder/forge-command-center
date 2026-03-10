// api/sendblue-webhook.js — Receive inbound messages from Sendblue webhooks
// Stores in Supabase for real-time display in Forge.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const msg = req.body || {};

    console.log('[sendblue-webhook] Received:', JSON.stringify({
      from: msg.from_number,
      to: msg.to_number,
      content: msg.content?.substring(0, 50),
      is_outbound: msg.is_outbound,
      date_sent: msg.date_sent,
    }));

    // Store in Supabase if configured
    if (SUPABASE_URL && SUPABASE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/sendblue_messages`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          message_handle: msg.message_handle,
          content: msg.content,
          from_number: msg.from_number,
          to_number: msg.to_number,
          is_outbound: msg.is_outbound || false,
          status: msg.status,
          media_url: msg.media_url,
          service: msg.service,
          date_sent: msg.date_sent,
          group_id: msg.group_id,
          raw_payload: msg,
        }),
      });
    }

    // Sendblue requires 200 response
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[sendblue-webhook] Error:', err.message);
    return res.status(200).json({ received: true, error: err.message });
  }
}
