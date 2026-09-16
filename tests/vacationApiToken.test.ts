/**
 * 휴가 API 인증 헤더(x-bflow-token) 계약 테스트
 *
 * 2026-09 이관으로 휴가 API 상대가 구 Apps Script 웹 앱 → Supabase Edge Function 으로 바뀌었다.
 * 신 API 는 토큰이 없거나 틀리면 **모든 action 을 거부**한다. 호출부가 9곳이라
 * 한 곳만 헤더를 빠뜨려도 그 기능 하나만 조용히 죽는다(연결 상태는 멀쩡해 보인다).
 * 그래서 핑·읽기·쓰기 각 경로에서 헤더가 실제로 실려 나가는지 본다.
 *
 * vacation.ts 는 모듈 전역에 연결 상태를 들고 있으므로, 테스트마다 esbuild 로 묶어
 * **새 인스턴스**를 import 한다(다른 테스트의 연결이 새지 않게).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

type VacationModule = typeof import('../electron/vacation.ts');

let bundleSource: Promise<string> | undefined;
let bundleNonce = 0;

async function bundledVacationSource(): Promise<string> {
  bundleSource ??= build({
    stdin: {
      contents: "export * from './electron/vacation.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'vacation-api-token-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
  }).then((result) => result.outputFiles[0].text);
  return bundleSource;
}

async function freshVacation(): Promise<VacationModule> {
  const encoded = Buffer.from(await bundledVacationSource()).toString('base64');
  return await import(
    `data:text/javascript;base64,${encoded}#vacation-api-token-${bundleNonce++}`
  ) as VacationModule;
}

type Recorded = { url: string; headers: Record<string, string> };

/** gasFetch 가 쓰는 전역 fetch 를 가로채 호출 헤더를 기록한다. */
function stubFetch(body: unknown): Recorded[] {
  const calls: Recorded[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    url: string,
    init: { headers?: Record<string, string> } = {},
  ) => {
    calls.push({ url: String(url), headers: { ...(init.headers ?? {}) } });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body,
    };
  };
  return calls;
}

test('토큰을 주면 핑·읽기·쓰기 전 경로가 x-bflow-token 을 싣는다', async () => {
  const vac = await freshVacation();
  const calls = stubFetch({ ok: true, data: [], success: true, state: '등록완료' });

  const r = await vac.initVacation('https://example.test/functions/v1/vacation-api', 'TOKEN-123');
  assert.equal(r.ok, true);

  await vac.readVacationStatus('홍길동');
  await vac.registerVacation({
    name: '홍길동', type: '연차',
    startDate: '2026-09-16', endDate: '2026-09-16', reason: '',
  });
  await vac.readDahyuList();
  await vac.deleteDahyu([1001]);

  assert.equal(calls.length, 5, '핑 1 + GET 2 + POST 2');
  for (const c of calls) {
    assert.equal(c.headers['x-bflow-token'], 'TOKEN-123', `헤더 누락: ${c.url}`);
  }
  // 토큰을 끼우면서 기존 헤더를 덮어쓰면 POST 가 깨진다
  assert.equal(calls[2].headers['Content-Type'], 'application/json');
});

test('토큰이 없으면 헤더를 붙이지 않는다 (구 GAS 로 되돌려도 그대로 동작)', async () => {
  const vac = await freshVacation();
  const calls = stubFetch({ ok: true, data: [] });

  await vac.initVacation('https://script.google.com/macros/s/AAA/exec');
  await vac.readVacationStatus('홍길동');

  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal('x-bflow-token' in c.headers, false, `토큰이 없는데 헤더가 붙었다: ${c.url}`);
  }
});

test('인증 실패 문구를 그대로 올려 URL 문제와 구분되게 한다', async () => {
  const vac = await freshVacation();
  stubFetch({ ok: false, error: '인증 토큰이 유효하지 않습니다' });

  const r = await vac.initVacation('https://example.test/functions/v1/vacation-api', 'WRONG');

  assert.equal(r.ok, false);
  assert.equal(r.error, '인증 토큰이 유효하지 않습니다');
});
