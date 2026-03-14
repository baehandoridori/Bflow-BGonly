import { createClient } from '@supabase/supabase-js';

// ─── Supabase 클라이언트 (하드코딩 — 의사결정 #환경변수 참조) ───

const SUPABASE_URL = 'https://mpqifkpxalwxgcrddchv.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wcWlma3B4YWx3eGdjcmRkY2h2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODEzNjIsImV4cCI6MjA4OTA1NzM2Mn0.vkaColwt60z1fpxFP2FDSDSdomLSgpGK44xwZe-Gvio';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── 연결 테스트 ────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('episodes').select('id').limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
