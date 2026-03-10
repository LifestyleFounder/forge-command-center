// api/sendblue-webhook.js — Receive inbound messages from Sendblue webhooks
// Stores in Supabase for real-time display in Forge.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

    // Log for debugging (Vercel function logs)
    console.log('[sendblue-webhook] Received:', JSON.stringify({
      from: msg.from_number,
      to: msg.to_number,
      content: msg.content?.substring(0, 50),
      is_outbound: msg.is_outbound,
      date_sent: msg.date_sent,
    }));

    // If Supabase is configured, store the message
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
      );

      await supabase.from('sendblue_messages').insert({
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
      });
    }

    // Sendblue requires 200 response
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[sendblue-webhook] Error:', err.message);
    // Still return 200 so Sendblue doesn't retry
    return res.status(200).json({ received: true, error: err.message });
  }
}
