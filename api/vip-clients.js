// api/vip-clients.js — Sync VIP clients from Notion
// Queries the "VIP & 1:1 Client Database" and returns all clients.

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const DATABASE_ID = '030dd315-0841-49f8-aee1-cf442d4a25e4';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.NOTION_API_KEY;
  if (!token) {
    return res.status(500).json({ error: 'NOTION_API_KEY not configured in Vercel env vars' });
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  try {
    // Paginate through all results
    const allPages = [];
    let cursor;
    do {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      const r = await fetch(`${NOTION_API}/databases/${DATABASE_ID}/query`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.object === 'error') {
        return res.status(400).json({ error: data.message });
      }

      allPages.push(...(data.results || []));
      cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);

    // Map Notion pages → client objects
    const clients = allPages.map(page => {
      const p = page.properties || {};
      return {
        id: page.id,
        name: getTitle(p.Name),
        status: getSelect(p.Status),
        program: getMultiSelect(p.Program),
        payment: getSelect(p.Payment),
        pif: getRichText(p.PIF),
        joined: getDate(p.Joined),
        programLength: getSelect(p['Program Length']),
        todo: getMultiSelect(p.TODO),
        email: getEmail(p.Email),
        notionUrl: page.url,
      };
    });

    return res.status(200).json({
      lastSynced: new Date().toISOString(),
      clients,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Property extractors ───────────────────────────────────────────
function getTitle(prop) {
  if (!prop || prop.type !== 'title') return '';
  return (prop.title || []).map(t => t.plain_text).join('');
}

function getSelect(prop) {
  if (!prop || prop.type !== 'select') return '';
  return prop.select?.name || '';
}

function getMultiSelect(prop) {
  if (!prop || prop.type !== 'multi_select') return [];
  return (prop.multi_select || []).map(s => s.name);
}

function getRichText(prop) {
  if (!prop || prop.type !== 'rich_text') return '';
  return (prop.rich_text || []).map(t => t.plain_text).join('');
}

function getDate(prop) {
  if (!prop || prop.type !== 'date') return null;
  return prop.date?.start || null;
}

function getEmail(prop) {
  if (!prop || prop.type !== 'email') return '';
  return prop.email || '';
}
