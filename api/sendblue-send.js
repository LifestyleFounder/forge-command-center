// api/sendblue-send.js — Send a message via Sendblue
// POST { number, content, media_url? }

const BASE_URL = 'https://api.sendblue.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.SENDBLUE_API_KEY || !process.env.SENDBLUE_API_SECRET) {
    return res.status(500).json({ error: 'SENDBLUE_API_KEY or SENDBLUE_API_SECRET not configured' });
  }

  try {
    const { number, content, media_url } = req.body || {};

    if (!number) return res.status(400).json({ error: 'number is required' });
    if (!content && !media_url) return res.status(400).json({ error: 'content or media_url is required' });

    const body = { number, content };
    if (media_url) body.media_url = media_url;
    if (process.env.SENDBLUE_FROM_NUMBER) body.from_number = process.env.SENDBLUE_FROM_NUMBER;

    const sendRes = await fetch(`${BASE_URL}/api/send-message`, {
      method: 'POST',
      headers: {
        'sb-api-key-id': process.env.SENDBLUE_API_KEY,
        'sb-api-secret-key': process.env.SENDBLUE_API_SECRET,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await sendRes.json();

    if (!sendRes.ok) {
      return res.status(sendRes.status).json({ error: data.message || data.error_message || 'Send failed' });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
