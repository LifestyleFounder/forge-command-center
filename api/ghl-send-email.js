// api/ghl-send-email.js — Send an individual email via GHL conversations API
// Proxies GHL API so the token stays server-side.

const GHL_URL = 'https://services.leadconnectorhq.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.GHL_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'GHL_API_TOKEN not configured in Vercel env vars' });
  }

  try {
    const { contactId, subject, body, emailFrom } = req.body || {};

    if (!contactId) {
      return res.status(400).json({ error: 'contactId is required' });
    }
    if (!subject && !body) {
      return res.status(400).json({ error: 'subject or body is required' });
    }

    const payload = {
      type: 'Email',
      contactId,
      subject: subject || '(no subject)',
      html: body || '',
    };

    if (emailFrom) {
      payload.emailFrom = emailFrom;
    }

    const apiRes = await fetch(`${GHL_URL}/conversations/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: data.message || data.msg || 'GHL API error' });
    }

    return res.status(200).json({
      success: true,
      messageId: data.messageId || data.id,
      conversationId: data.conversationId,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
