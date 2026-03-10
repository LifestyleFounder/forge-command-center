// api/sendblue-messages.js — Fetch conversations and messages from Sendblue
// Proxies Sendblue API so keys stay server-side.

const BASE_URL = 'https://api.sendblue.co';

function getHeaders() {
  return {
    'sb-api-key-id': process.env.SENDBLUE_API_KEY,
    'sb-api-secret-key': process.env.SENDBLUE_API_SECRET,
    'Content-Type': 'application/json',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.SENDBLUE_API_KEY || !process.env.SENDBLUE_API_SECRET) {
    return res.status(500).json({ error: 'SENDBLUE_API_KEY or SENDBLUE_API_SECRET not configured' });
  }

  try {
    const { action } = req.query;

    // Action: get all contacts (paginate through all)
    if (action === 'contacts') {
      const allContacts = [];
      let offset = 0;
      const pageSize = 100;

      while (true) {
        const contactsRes = await fetch(
          `${BASE_URL}/api/v2/contacts?limit=${pageSize}&offset=${offset}`,
          { headers: getHeaders() }
        );
        if (!contactsRes.ok) {
          const err = await contactsRes.json();
          return res.status(contactsRes.status).json(err);
        }
        const page = await contactsRes.json();
        const contacts = Array.isArray(page) ? page : (page.data || []);
        allContacts.push(...contacts);

        if (contacts.length < pageSize) break;
        offset += pageSize;

        // Safety cap at 5000 contacts
        if (offset >= 5000) break;
      }

      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ contacts: allContacts });
    }

    // Action: get messages (optionally filtered by phone number)
    const number = req.query.number || '';
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;

    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });

    if (number) params.set('number', number);

    const msgRes = await fetch(`${BASE_URL}/api/v2/messages?${params}`, {
      headers: getHeaders(),
    });
    const data = await msgRes.json();

    if (!msgRes.ok || data.status === 'ERROR') {
      return res.status(msgRes.ok ? 400 : msgRes.status).json({ error: data.message || 'Sendblue API error' });
    }

    // Sendblue returns { status: "OK", data: [...] }
    const messages = data.data || [];

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ messages });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
