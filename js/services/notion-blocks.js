// js/services/notion-blocks.js — Frontend service for Notion block-level API

const ENDPOINT = '/api/notion-blocks';

/**
 * Fetch the full workspace index: folders + docs + unfiled
 * Returns { folders: [...], unfiled: [...] } or null
 */
export async function getWorkspaceIndex() {
  try {
    const r = await fetch(`${ENDPOINT}?action=workspace-index`);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (err) {
    console.error('[notion-blocks] getWorkspaceIndex failed:', err);
    return null;
  }
}

/**
 * Create a folder page (📁 icon) under workspace root
 * Returns { folderId } or null
 */
export async function createNotionFolder(name) {
  try {
    const r = await fetch(`${ENDPOINT}?action=create-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (err) {
    console.error('[notion-blocks] createNotionFolder failed:', err);
    return null;
  }
}

/**
 * Create a doc page under a specific parent page (folder)
 * Returns { pageId, url } or null
 */
export async function createDocInFolder(parentId, title, blocks = []) {
  try {
    const r = await fetch(`${ENDPOINT}?action=create-doc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId, title, blocks }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (err) {
    console.error('[notion-blocks] createDocInFolder failed:', err);
    return null;
  }
}

/**
 * Update a page's title in Notion
 */
export async function updatePageTitle(pageId, title) {
  try {
    const r = await fetch(ENDPOINT, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, title }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return true;
  } catch (err) {
    console.error('[notion-blocks] updatePageTitle failed:', err);
    return false;
  }
}

/**
 * Move a doc into a Notion folder (re-creates under new parent, archives old)
 * Returns { newPageId, oldPageId } or null
 */
export async function moveDocToFolder(pageId, targetFolderId) {
  try {
    const r = await fetch(`${ENDPOINT}?action=move-doc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, targetFolderId }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (err) {
    console.error('[notion-blocks] moveDocToFolder failed:', err);
    return null;
  }
}

/**
 * Fetch all blocks from a Notion page (recursive)
 */
export async function getPageBlocks(pageId) {
  try {
    const r = await fetch(`${ENDPOINT}?pageId=${encodeURIComponent(pageId)}`);
    const data = await r.json();
    if (data.error) {
      console.error('[notion-blocks] getPageBlocks error:', data.error, data.code);
      return null;
    }
    return data.blocks || [];
  } catch (err) {
    console.error('[notion-blocks] getPageBlocks failed:', err);
    return null;
  }
}

/**
 * Save blocks to a Notion page (replaces existing content)
 */
export async function updatePageBlocks(pageId, blocks) {
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, blocks }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    return data.success || false;
  } catch (err) {
    console.error('[notion-blocks] updatePageBlocks failed:', err);
    return false;
  }
}

/**
 * Create a new page in the workspace parent (legacy — used by old backup flow)
 * Returns { pageId, url } or null
 */
export async function createPage(title, blocks = []) {
  try {
    const r = await fetch(`${ENDPOINT}?action=create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, blocks }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    return data.pageId ? data : null;
  } catch (err) {
    console.error('[notion-blocks] createPage failed:', err);
    return null;
  }
}

/**
 * Search Notion pages by query
 */
export async function searchPages(query = '') {
  try {
    const params = new URLSearchParams({ action: 'search', query });
    const r = await fetch(`${ENDPOINT}?${params}`);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    return data.pages || [];
  } catch (err) {
    console.error('[notion-blocks] searchPages failed:', err);
    return [];
  }
}

/**
 * Get page metadata (title, icon, lastEdited)
 */
export async function getPage(pageId) {
  try {
    const params = new URLSearchParams({ action: 'page', pageId });
    const r = await fetch(`${ENDPOINT}?${params}`);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (err) {
    console.error('[notion-blocks] getPage failed:', err);
    return null;
  }
}
