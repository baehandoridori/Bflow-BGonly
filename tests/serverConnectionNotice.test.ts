import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isServerQuotaBlocked } from '../src/shared/serverQuota.ts';
import { resolveHeaderConnectionBadge } from '../src/components/layout/headerConnection.ts';

// 2026-10-21 아침 실제로 받은 거절 본문(402).
const QUOTA_BODY = 'Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service.';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the usage-limit block is recognised by its 402 or by its message, not by other failures', () => {
  assert.equal(isServerQuotaBlocked(402, QUOTA_BODY), true);
  assert.equal(isServerQuotaBlocked(402, ''), true, '본문이 비어도 402 면 한도 차단');
  assert.equal(isServerQuotaBlocked(undefined, QUOTA_BODY), true, '상태 숫자를 잃어도 본문으로 안다');
  assert.equal(isServerQuotaBlocked(0, 'exceed_db_size_quota'), true, '다른 한도 위반도 같다');
  assert.equal(isServerQuotaBlocked(0, 'TypeError: fetch failed'), false);
  assert.equal(isServerQuotaBlocked(401, 'JWT expired'), false);
  assert.equal(isServerQuotaBlocked(503, 'upstream connect error'), false);
  assert.equal(isServerQuotaBlocked(403, 'restricted projects remain hidden'), false);
  assert.equal(isServerQuotaBlocked(undefined, { message: QUOTA_BODY }), false, '글이 아닌 값은 보지 않는다');
});

test('the header names the server state in words and never says sheets', () => {
  const ok = resolveHeaderConnectionBadge('supabase');
  assert.equal(ok?.tone, 'ok');
  assert.equal(ok?.label, null, '연결되면 아이콘만');

  const offline = resolveHeaderConnectionBadge('offline');
  assert.equal(offline?.tone, 'offline');
  assert.equal(offline?.label, '서버 연결 안 됨');
  assert.match(offline?.title ?? '', /인터넷 연결을 확인/);

  const blocked = resolveHeaderConnectionBadge('quota-blocked');
  assert.equal(blocked?.tone, 'blocked');
  assert.equal(blocked?.label, '서버 사용량 한도로 막힘');
  assert.match(blocked?.title ?? '', /관리자에게 알려/);
  assert.doesNotMatch(blocked?.title ?? '', /인터넷 연결을 확인/);

  assert.equal(resolveHeaderConnectionBadge(null), null);
  for (const badge of [ok, offline, blocked]) {
    assert.doesNotMatch(`${badge?.label ?? ''} ${badge?.title ?? ''}`, /sheets|시트|supabase/i);
  }
});

test('a failed server check marks the header as offline or blocked and no longer detours through sheets', () => {
  const app = read('src/App.tsx');
  const body = app.slice(app.indexOf('const fetchAllData = useCallback('), app.indexOf('const fetchAllDataRef = useRef('));
  assert.match(body, /setActiveDataSource\(sbConn\.quotaBlocked \? 'quota-blocked' : 'offline'\)/);
  assert.doesNotMatch(body, /setActiveDataSource\('sheets'\)|sheetsReadAllMetadata|checkGasConnection|connectGas/);

  const header = read('src/components/layout/Header.tsx');
  assert.match(header, /resolveHeaderConnectionBadge\(activeDataSource\)/);
  assert.doesNotMatch(header, /현재 연결: \$\{activeDataSource\}/);
});

test('login and the connection check carry the usage-limit block from the server response', () => {
  const supabase = read('electron/supabase.ts');
  const login = supabase.slice(supabase.indexOf('export async function loginSession('), supabase.indexOf('export async function logoutSession('));
  assert.match(login, /const \{ data, error, status \} = await supabase\.rpc\('app_login'/);
  assert.match(login, /isServerQuotaBlocked\(status, error\.message\)\) return \{ status: 'unavailable', reason: 'quota-blocked' \}/);
  const check = supabase.slice(supabase.indexOf('export async function testConnection('), supabase.indexOf('export async function readAllEpisodes('));
  assert.match(check, /quotaBlocked: isServerQuotaBlocked\(status, error\.message\)/);
});
