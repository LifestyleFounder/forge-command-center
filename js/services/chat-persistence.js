// js/services/chat-persistence.js — Supabase chat thread/message CRUD
// ──────────────────────────────────────────────────────────────────────

import { getSupabase } from './supabase.js';

const USER_ID = 'dan'; // single-user system

// ── Threads ──────────────────────────────────────────────────────────

export async function getThreads() {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('chat_threads')
      .select('*')
      .eq('user_id', USER_ID)
      .eq('archived', false)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeThread);
  } catch (err) {
    console.warn('[chat-persistence] getThreads failed, using localStorage', err);
    return null; // caller falls back to localStorage
  }
}

export async function createThread(thread) {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const row = {
      id: thread.id,
      user_id: USER_ID,
      title: thread.title || 'New conversation',
      agent_id: thread.agentId || 'geeves',
      archived: false,
      created_at: thread.createdAt || new Date().toISOString(),
      updated_at: thread.updatedAt || new Date().toISOString(),
    };
    const { data, error } = await sb.from('chat_threads').insert(row).select().single();
    if (error) throw error;
    return normalizeThread(data);
  } catch (err) {
    console.warn('[chat-persistence] createThread failed', err);
    return null;
  }
}

export async function archiveThread(threadId) {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from('chat_threads')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq('id', threadId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[chat-persistence] archiveThread failed', err);
    return false;
  }
}

export async function updateThreadTitle(threadId, title) {
  const sb = getSupabase();
  if (!sb) return false;
  try {
    const { error } = await sb
      .from('chat_threads')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', threadId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[chat-persistence] updateThreadTitle failed', err);
    return false;
  }
}

// ── Messages ─────────────────────────────────────────────────────────

export async function getMessages(threadId) {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from('chat_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(normalizeMessage);
  } catch (err) {
    console.warn('[chat-persistence] getMessages failed', err);
    return null;
  }
}

export async function saveMessage(threadId, msg) {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const row = {
      thread_id: threadId,
      role: msg.role,
      content: msg.content,
      resolved_content: msg.resolvedContent || null,
      model: msg.model || null,
      created_at: msg.timestamp || new Date().toISOString(),
    };
    const { data, error } = await sb.from('chat_messages').insert(row).select().single();
    if (error) throw error;
    // Also bump thread updated_at
    await sb.from('chat_threads').update({ updated_at: row.created_at }).eq('id', threadId);
    return normalizeMessage(data);
  } catch (err) {
    console.warn('[chat-persistence] saveMessage failed', err);
    return null;
  }
}

// ── Normalizers ──────────────────────────────────────────────────────

function normalizeThread(row) {
  return {
    id: row.id,
    title: row.title,
    agentId: row.agent_id,
    archived: row.archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    resolvedContent: row.resolved_content,
    model: row.model,
    timestamp: row.created_at,
  };
}
