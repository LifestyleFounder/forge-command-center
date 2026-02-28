// api/notion-blocks.js — Vercel serverless function
// Proxies Notion block-level API so NOTION_API_KEY stays server-side.

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

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
    // GET ?action=search&query=xxx — search pages
    if (req.method === 'GET' && req.query.action === 'search') {
      const query = req.query.query || '';
      const body = {
        query,
        filter: { property: 'object', value: 'page' },
        page_size: 20,
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
      };
      const r = await fetch(`${NOTION_API}/search`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.object === 'error') return res.status(400).json({ error: data.message });

      const pages = (data.results || []).map(p => ({
        id: p.id,
        title: getPageTitle(p),
        icon: p.icon?.emoji || p.icon?.external?.url || null,
        lastEdited: p.last_edited_time,
        url: p.url,
      }));
      return res.status(200).json({ pages });
    }

    // GET ?action=page&pageId=xxx — get page metadata
    if (req.method === 'GET' && req.query.action === 'page') {
      const { pageId } = req.query;
      if (!pageId) return res.status(400).json({ error: 'pageId required' });

      const r = await fetch(`${NOTION_API}/pages/${pageId}`, { headers });
      const data = await r.json();
      if (data.object === 'error') return res.status(400).json({ error: data.message });

      return res.status(200).json({
        id: data.id,
        title: getPageTitle(data),
        icon: data.icon?.emoji || data.icon?.external?.url || null,
        lastEdited: data.last_edited_time,
        url: data.url,
      });
    }

    // GET ?pageId=xxx — fetch block children (recursive)
    if (req.method === 'GET' && req.query.pageId) {
      const { pageId } = req.query;

      // First check if we can access blocks at all
      const testR = await fetch(
        `${NOTION_API}/blocks/${pageId}/children?page_size=1`,
        { headers }
      );
      const testData = await testR.json();
      if (testData.object === 'error') {
        return res.status(400).json({ error: testData.message, code: testData.code });
      }

      const blocks = await fetchBlocksRecursive(pageId, headers);
      return res.status(200).json({ blocks });
    }

    // POST ?action=create — create new page under workspace parent
    if (req.method === 'POST' && req.query.action === 'create') {
      const { title, blocks } = req.body || {};
      const parentId = process.env.NOTION_WORKSPACE_PARENT_PAGE;
      if (!parentId) {
        return res.status(500).json({ error: 'NOTION_WORKSPACE_PARENT_PAGE not configured' });
      }

      // Create page
      const pageBody = {
        parent: { page_id: parentId },
        properties: {
          title: { title: [{ text: { content: title || 'Untitled' } }] },
        },
        children: blocks && blocks.length > 0 ? blocks.slice(0, 100) : [],
      };

      const r = await fetch(`${NOTION_API}/pages`, {
        method: 'POST', headers, body: JSON.stringify(pageBody),
      });
      const data = await r.json();
      if (data.object === 'error') {
        return res.status(400).json({ error: data.message });
      }

      // If more than 100 blocks, append the rest
      if (blocks && blocks.length > 100) {
        const remaining = blocks.slice(100);
        const chunks = chunkArray(remaining, 100);
        for (const chunk of chunks) {
          await fetch(`${NOTION_API}/blocks/${data.id}/children`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ children: chunk }),
          });
        }
      }

      return res.status(200).json({ pageId: data.id, url: data.url });
    }

    // POST — save blocks to page
    if (req.method === 'POST') {
      const { pageId, blocks } = req.body || {};
      if (!pageId || !blocks) {
        return res.status(400).json({ error: 'pageId and blocks required' });
      }

      // 1. Get existing block children
      const existingBlocks = await fetchBlockIds(pageId, headers);

      // 2. Delete existing blocks (in batches to avoid rate limits)
      for (const blockId of existingBlocks) {
        await fetch(`${NOTION_API}/blocks/${blockId}`, {
          method: 'DELETE', headers,
        });
      }

      // 3. Append new blocks (Notion limits to 100 per request)
      const chunks = chunkArray(blocks, 100);
      for (const chunk of chunks) {
        const r = await fetch(`${NOTION_API}/blocks/${pageId}/children`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ children: chunk }),
        });
        const data = await r.json();
        if (data.object === 'error') {
          return res.status(400).json({ error: data.message });
        }
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Fetch all block children, recursing into blocks that have_children
async function fetchBlocksRecursive(blockId, headers, depth = 0) {
  if (depth > 3) return []; // limit recursion depth

  const blocks = [];
  let cursor;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);

    const r = await fetch(
      `${NOTION_API}/blocks/${blockId}/children?${params}`,
      { headers }
    );
    const data = await r.json();
    if (data.object === 'error') {
      console.error('[notion-blocks] fetchBlocksRecursive error:', data.code, data.message, 'blockId:', blockId);
      break;
    }

    for (const block of (data.results || [])) {
      const b = { ...block };
      if (block.has_children) {
        b.children = await fetchBlocksRecursive(block.id, headers, depth + 1);
      }
      blocks.push(b);
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return blocks;
}

// Fetch just the IDs of direct block children (for deletion)
async function fetchBlockIds(blockId, headers) {
  const ids = [];
  let cursor;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);

    const r = await fetch(
      `${NOTION_API}/blocks/${blockId}/children?${params}`,
      { headers }
    );
    const data = await r.json();
    if (data.object === 'error') break;

    for (const block of (data.results || [])) {
      ids.push(block.id);
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return ids;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function getPageTitle(page) {
  const props = page.properties || {};
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop.type === 'title' && prop.title?.length > 0) {
      return prop.title.map(t => t.plain_text).join('');
    }
  }
  return 'Untitled';
}
