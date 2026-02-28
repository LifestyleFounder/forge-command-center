// js/services/notion-blocks.js — Frontend service for Notion block-level API

const ENDPOINT = '/api/notion-blocks';

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
