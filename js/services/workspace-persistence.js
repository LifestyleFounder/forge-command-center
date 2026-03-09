// js/services/workspace-persistence.js — Supabase workspace CRUD
// ──────────────────────────────────────────────────────────────────────
// Mirrors chat-persistence.js pattern: async, fire-and-forget, graceful fallback.

import { getSupabase } from './supabase.js';

const USER_ID = 'dan';

// ── Folders ──────────────────────────────────────────────────────────

export async function fetchFolders() {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('workspace_folders')
      .select('*')
      .eq('user_id', USER_ID)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data || []).map(normalizeFolder);
  } catch (err) {
    console.warn('[workspace-persistence] fetchFolders failed', err);
    return null;
  }
}

export async function upsertFolders(folders) {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const rows = folders.map(f => ({
      id: f.id,
      user_id: USER_ID,
      name: f.name,
      parent_id: f.parentId || null,
      sort_order: f.order ?? 0,
      type: f.type || 'folder',
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb
      .from('workspace_folders')
      .upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[workspace-persistence] upsertFolders failed', err);
    return false;
  }
}

export async function deleteFolder(id) {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from('workspace_folders')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[workspace-persistence] deleteFolder failed', err);
    return false;
  }
}

// ── Docs ─────────────────────────────────────────────────────────────

export async function fetchDocs() {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('workspace_docs')
      .select('*')
      .eq('user_id', USER_ID)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeDoc);
  } catch (err) {
    console.warn('[workspace-persistence] fetchDocs failed', err);
    return null;
  }
}

export async function upsertDoc(doc) {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const row = {
      id: doc.id,
      user_id: USER_ID,
      title: doc.title || 'Untitled',
      folder_id: doc.folder,
      content: doc.content || null,
      notion_page_id: doc.notionPageId || null,
      updated_at: doc.updatedAt || new Date().toISOString(),
      created_at: doc.createdAt || new Date().toISOString(),
    };
    const { error } = await sb
      .from('workspace_docs')
      .upsert(row, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[workspace-persistence] upsertDoc failed', err);
    return false;
  }
}

export async function deleteDoc(id) {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from('workspace_docs')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[workspace-persistence] deleteDoc failed', err);
    return false;
  }
}

export async function pushAllDocs(docs) {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const rows = docs.map(d => ({
      id: d.id,
      user_id: USER_ID,
      title: d.title || 'Untitled',
      folder_id: d.folder,
      content: d.content || null,
      notion_page_id: d.notionPageId || null,
      updated_at: d.updatedAt || new Date().toISOString(),
      created_at: d.createdAt || new Date().toISOString(),
    }));
    const { error } = await sb
      .from('workspace_docs')
      .upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[workspace-persistence] pushAllDocs failed', err);
    return false;
  }
}

// ── Normalizers ──────────────────────────────────────────────────────

function normalizeFolder(row) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id || null,
    order: row.sort_order ?? 0,
    type: row.type || 'folder',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeDoc(row) {
  return {
    id: row.id,
    title: row.title || 'Untitled',
    folder: row.folder_id,
    content: row.content || null,
    notionPageId: row.notion_page_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
