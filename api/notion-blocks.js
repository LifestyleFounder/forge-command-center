// api/notion-blocks.js — Vercel serverless function
// Proxies Notion block-level API so NOTION_API_KEY stays server-side.

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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
    // ── GET ?action=workspace-index ─────────────────────────────
    // Returns full workspace structure: folders (📁 pages) + docs + unfiled
    if (req.method === 'GET' && req.query.action === 'workspace-index') {
      const parentId = process.env.NOTION_WORKSPACE_PARENT_PAGE;
      if (!parentId) {
        return res.status(500).json({ error: 'NOTION_WORKSPACE_PARENT_PAGE not configured' });
      }

      // 1. Fetch direct child pages of workspace root
      const rootBlocks = await fetchChildPages(parentId, headers);

      // 2. Fetch page metadata for root children (to get icon for folder detection)
      const pageMetas = await Promise.all(
        rootBlocks.map(b => fetchPageMeta(b.id, headers))
      );

      const folders = [];
      const unfiled = [];

      for (let i = 0; i < rootBlocks.length; i++) {
        const block = rootBlocks[i];
        const meta = pageMetas[i];
        if (!meta) continue;

        if (meta.icon === '📁') {
          // Folder — fetch its child pages (docs)
          const docBlocks = await fetchChildPages(block.id, headers);
          folders.push({
            id: block.id,
            title: meta.title,
            lastEdited: meta.lastEdited,
            docs: docBlocks.map(d => ({
              id: d.id,
              title: d.child_page?.title || 'Untitled',
              lastEdited: d.last_edited_time,
            })),
          });
        } else {
          // Unfiled doc at root level
          unfiled.push({
            id: block.id,
            title: meta.title,
            lastEdited: meta.lastEdited,
          });
        }
      }

      return res.status(200).json({ folders, unfiled });
    }

    // ── GET ?action=search&query=xxx ────────────────────────────
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

    // ── GET ?action=page&pageId=xxx ─────────────────────────────
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

    // ── GET ?pageId=xxx — fetch block children (recursive) ──────
    if (req.method === 'GET' && req.query.pageId) {
      const { pageId } = req.query;

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

    // ── POST ?action=create-folder ──────────────────────────────
    // Creates a folder page (📁 icon) under workspace root
    if (req.method === 'POST' && req.query.action === 'create-folder') {
      const { name } = req.body || {};
      const parentId = process.env.NOTION_WORKSPACE_PARENT_PAGE;
      if (!parentId) {
        return res.status(500).json({ error: 'NOTION_WORKSPACE_PARENT_PAGE not configured' });
      }

      const pageBody = {
        parent: { page_id: parentId },
        icon: { type: 'emoji', emoji: '📁' },
        properties: {
          title: { title: [{ text: { content: name || 'Untitled Folder' } }] },
        },
        children: [],
      };

      const r = await fetch(`${NOTION_API}/pages`, {
        method: 'POST', headers, body: JSON.stringify(pageBody),
      });
      const data = await r.json();
      if (data.object === 'error') return res.status(400).json({ error: data.message });

      return res.status(200).json({ folderId: data.id });
    }

    // ── POST ?action=create-doc ─────────────────────────────────
    // Creates a doc page under a specific parent (folder page)
    if (req.method === 'POST' && req.query.action === 'create-doc') {
      const { parentId, title, blocks } = req.body || {};
      if (!parentId) return res.status(400).json({ error: 'parentId required' });

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
      if (data.object === 'error') return res.status(400).json({ error: data.message });

      // Append remaining blocks if > 100
      if (blocks && blocks.length > 100) {
        const chunks = chunkArray(blocks.slice(100), 100);
        for (const chunk of chunks) {
          await fetch(`${NOTION_API}/blocks/${data.id}/children`, {
            method: 'PATCH', headers, body: JSON.stringify({ children: chunk }),
          });
        }
      }

      return res.status(200).json({ pageId: data.id, url: data.url });
    }

    // ── POST ?action=create — create new page under workspace parent (legacy)
    if (req.method === 'POST' && req.query.action === 'create') {
      const { title, blocks } = req.body || {};
      const parentId = process.env.NOTION_WORKSPACE_PARENT_PAGE;
      if (!parentId) {
        return res.status(500).json({ error: 'NOTION_WORKSPACE_PARENT_PAGE not configured' });
      }

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

    // ── POST ?action=move-doc ──────────────────────────────────
    // Moves a doc into a folder by re-creating it under the new parent
    // (Notion API 2022-06-28 doesn't support parent updates, so we copy + archive)
    if (req.method === 'POST' && req.query.action === 'move-doc') {
      const { pageId, targetFolderId } = req.body || {};
      if (!pageId || !targetFolderId) {
        return res.status(400).json({ error: 'pageId and targetFolderId required' });
      }

      // 1. Get the original page metadata
      const metaR = await fetch(`${NOTION_API}/pages/${pageId}`, { headers });
      const metaData = await metaR.json();
      if (metaData.object === 'error') return res.status(400).json({ error: metaData.message });
      const title = getPageTitle(metaData);

      // 2. Fetch all blocks from original page
      const blocks = await fetchBlocksRecursive(pageId, headers);

      // 3. Strip IDs from blocks so Notion treats them as new
      const cleanBlocks = stripBlockIds(blocks);

      // 4. Create new page under target folder
      const newPageBody = {
        parent: { page_id: targetFolderId },
        properties: {
          title: { title: [{ text: { content: title } }] },
        },
        children: cleanBlocks.slice(0, 100),
      };

      const createR = await fetch(`${NOTION_API}/pages`, {
        method: 'POST', headers, body: JSON.stringify(newPageBody),
      });
      const createData = await createR.json();
      if (createData.object === 'error') {
        return res.status(400).json({ error: createData.message });
      }

      // Append remaining blocks if > 100
      if (cleanBlocks.length > 100) {
        const chunks = chunkArray(cleanBlocks.slice(100), 100);
        for (const chunk of chunks) {
          await fetch(`${NOTION_API}/blocks/${createData.id}/children`, {
            method: 'PATCH', headers, body: JSON.stringify({ children: chunk }),
          });
        }
      }

      // 5. Archive the old page
      await fetch(`${NOTION_API}/pages/${pageId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ archived: true }),
      });

      return res.status(200).json({
        newPageId: createData.id,
        oldPageId: pageId,
        url: createData.url,
      });
    }

    // ── PATCH — update page title ───────────────────────────────
    if (req.method === 'PATCH') {
      const { pageId, title } = req.body || {};
      if (!pageId || !title) return res.status(400).json({ error: 'pageId and title required' });

      const r = await fetch(`${NOTION_API}/pages/${pageId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({
          properties: {
            title: { title: [{ text: { content: title } }] },
          },
        }),
      });
      const data = await r.json();
      if (data.object === 'error') return res.status(400).json({ error: data.message });

      return res.status(200).json({ success: true });
    }

    // ── POST — save blocks to page ──────────────────────────────
    if (req.method === 'POST') {
      const { pageId, blocks } = req.body || {};
      if (!pageId || !blocks) {
        return res.status(400).json({ error: 'pageId and blocks required' });
      }

      // 1. Get existing block children
      const existingBlocks = await fetchBlockIds(pageId, headers);

      // 2. Delete existing blocks
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

// ── Helpers ────────────────────────────────────────────────────────

/** Fetch only child_page blocks from a page (non-recursive, one level) */
async function fetchChildPages(pageId, headers) {
  const blocks = [];
  let cursor;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const r = await fetch(`${NOTION_API}/blocks/${pageId}/children?${params}`, { headers });
    const data = await r.json();
    if (data.object === 'error') break;
    for (const block of (data.results || [])) {
      if (block.type === 'child_page') blocks.push(block);
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return blocks;
}

/** Fetch page metadata (title, icon, last_edited) */
async function fetchPageMeta(pageId, headers) {
  try {
    const r = await fetch(`${NOTION_API}/pages/${pageId}`, { headers });
    const data = await r.json();
    if (data.object === 'error') return null;
    return {
      id: data.id,
      title: getPageTitle(data),
      icon: data.icon?.emoji || null,
      lastEdited: data.last_edited_time,
    };
  } catch { return null; }
}

/** Fetch all block children, recursing into blocks that have_children */
async function fetchBlocksRecursive(blockId, headers, depth = 0) {
  if (depth > 3) return [];

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

/** Fetch just the IDs of direct block children (for deletion) */
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

/** Strip IDs from blocks so they can be re-created under a new parent */
function stripBlockIds(blocks) {
  return blocks
    .filter(b => b.type !== 'child_page') // skip nested page refs
    .map(b => {
      const clean = { type: b.type };
      if (b[b.type]) clean[b.type] = b[b.type];
      if (b.children && b.children.length > 0) {
        clean[b.type] = { ...clean[b.type] };
        // Notion API uses 'children' inside the block type for nested blocks
        clean.children = stripBlockIds(b.children);
      }
      return clean;
    });
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
