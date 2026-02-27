// js/services/supabase.js — Shared Supabase client
// ──────────────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://nzppfxttbqrgwjofxqfm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_sV62e_R_dS3hviPSmOm3bQ_VrN1Pj4d';

let _client = null;

export function getSupabase() {
  if (_client) return _client;
  if (typeof window.supabase === 'undefined') {
    console.warn('[supabase] SDK not loaded yet');
    return null;
  }
  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return _client;
}

export { SUPABASE_URL, SUPABASE_KEY };
