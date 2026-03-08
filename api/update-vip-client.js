// api/update-vip-client.js — Update a VIP client in Notion
// PATCH endpoint: { pageId, properties: { Status: "Active", ... } }

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Map our field names → Notion property update payloads
const FIELD_MAP = {
  Status:        (v) => ({ select: v ? { name: v } : null }),
  Payment:       (v) => ({ select: v ? { name: v } : null }),
  'Program Length': (v) => ({ select: v ? { name: v } : null }),
  Program:       (v) => ({ multi_select: (v || []).map(name => ({ name })) }),
  TODO:          (v) => ({ multi_select: (v || []).map(name => ({ name })) }),
  Name:          (v) => ({ title: [{ text: { content: v || '' } }] }),
  Email:         (v) => ({ email: v || null }),
  PIF:           (v) => ({ rich_text: [{ text: { content: v || '' } }] }),
  Joined:        (v) => ({ date: v ? { start: v } : null }),
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.NOTION_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'NOTION_API_KEY not configured' });
  }

  const { pageId, properties } = req.body || {};
  if (!pageId || !properties || typeof properties !== 'object') {
    return res.status(400).json({ error: 'Missing pageId or properties' });
  }

  // Build Notion properties payload
  const notionProps = {};
  for (const [field, value] of Object.entries(properties)) {
    const mapper = FIELD_MAP[field];
    if (!mapper) continue; // skip unknown fields
    notionProps[field] = mapper(value);
  }

  if (Object.keys(notionProps).length === 0) {
    return res.status(400).json({ error: 'No valid properties to update' });
  }

  try {
    const r = await fetch(`${NOTION_API}/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties: notionProps }),
    });

    const data = await r.json();
    if (data.object === 'error') {
      return res.status(400).json({ error: data.message });
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
