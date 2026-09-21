// tests/metadataPagination.test.ts
// metadata 전량 로드가 PostgREST 1000행 캡에 잘리지 않는지 + 에피소드 이름 폴백이 비지 않는지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectAllPages, POSTGREST_PAGE_SIZE } from '../src/shared/postgrestPaging.ts';
import { defaultEpisodeTitle } from '../src/shared/episodeTitle.ts';

const supabaseSrc = readFileSync(new URL('../electron/supabase.ts', import.meta.url), 'utf8');

/** `export async function <name>(` 부터 다음 최상위 `export ` 직전까지를 잘라낸다. */
function functionSource(name: string): string {
  const start = supabaseSrc.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} 를 electron/supabase.ts 에서 찾지 못했습니다`);
  const next = supabaseSrc.indexOf('\nexport ', start + 1);
  return supabaseSrc.slice(start, next === -1 ? undefined : next);
}

/** PostgREST 흉내: 요청 range 를 지키되, 한 응답을 serverMaxRows 로 잘라서 준다. */
function fakePostgrest<T>(rows: T[], serverMaxRows: number, asked?: Array<[number, number]>) {
  return async (from: number, to: number) => {
    asked?.push([from, to]);
    return rows.slice(from, Math.min(to + 1, from + serverMaxRows));
  };
}

test('collectAllPages: 1000행 캡 너머까지 이어 받아 전량을 반환', async () => {
  const rows = Array.from({ length: 2345 }, (_, i) => ({ i }));
  const asked: Array<[number, number]> = [];
  const all = await collectAllPages<{ i: number }>(fakePostgrest(rows, 1000, asked), 1000);
  assert.equal(all.length, 2345, '1000행 캡 너머의 행까지 전부 돌아와야 한다');
  assert.deepEqual(all.map((r) => r.i), rows.map((r) => r.i), '순서가 유지되어야 한다');
  assert.deepEqual(asked, [[0, 999], [1000, 1999], [2000, 2999], [2345, 3344]], '빈 페이지를 받고 끝낸다');
});

test('collectAllPages: 서버 캡이 요청한 페이지 크기보다 작아도 전량을 받는다', async () => {
  // 페이지 크기를 잘못 키우거나 서버 max-rows 가 낮아져도 고치려던 '조용한 잘림'이 되살아나면 안 된다.
  const rows = Array.from({ length: 1714 }, (_, i) => i);
  for (const requested of [1000, 5000, 100000]) {
    const all = await collectAllPages<number>(fakePostgrest(rows, 1000), requested);
    assert.deepEqual(all, rows, `요청 페이지 ${requested} 에서 행이 잘렸다`);
  }
});

test('collectAllPages: 총 개수가 페이지 크기의 배수면 빈 페이지를 한 번 더 받고 끝낸다', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => i);
  const asked: Array<[number, number]> = [];
  const all = await collectAllPages<number>(fakePostgrest(rows, 10, asked), 10);
  assert.deepEqual(all, rows);
  assert.deepEqual(asked, [[0, 9], [10, 19], [20, 29]]);
});

test('collectAllPages: 데이터가 페이지보다 적으면 두 번째 요청에서 끝난다', async () => {
  const asked: Array<[number, number]> = [];
  const all = await collectAllPages<number>(fakePostgrest([1, 2, 3], 10, asked), 10);
  assert.deepEqual(all, [1, 2, 3]);
  assert.deepEqual(asked, [[0, 9], [3, 12]]);
});

test('collectAllPages: 빈 결과와 잘못된 페이지 크기', async () => {
  assert.deepEqual(await collectAllPages<number>(async () => [], 10), []);
  // pageSize 가 0/음수면 offset 이 전진하지 않아 무한 루프가 된다.
  // 가드가 사라지면 "멈춤" 대신 "실패"로 드러나도록 호출 횟수에 상한을 둔다.
  const capped = () => {
    let calls = 0;
    return async () => { if (++calls > 50) throw new Error('무한 루프: offset 이 전진하지 않음'); return []; };
  };
  for (const bad of [0, -5, 1.5, Number.NaN]) {
    await assert.rejects(collectAllPages<number>(capped(), bad), /1 이상의 정수/, `pageSize=${bad} 는 거부돼야 한다`);
  }
  assert.equal(POSTGREST_PAGE_SIZE, 1000);
});

test('collectAllPages: fetchPage 가 던진 에러는 그대로 전파된다', async () => {
  await assert.rejects(
    collectAllPages<number>(async (from) => { if (from > 0) throw new Error('두 번째 페이지 실패'); return Array.from({ length: 10 }, (_, i) => i); }, 10),
    /두 번째 페이지 실패/,
  );
});

test('readAllMetadata 는 페이지네이션으로 전량을 읽는다 (1000행 캡 방지)', () => {
  const src = functionSource('readAllMetadata');
  assert.match(src, /collectAllPages</, 'collectAllPages 로 페이지를 끝까지 받아야 한다');
  assert.match(src, /\.range\(from, to\)/, 'range() 로 페이지 구간을 지정해야 한다');
  assert.match(
    src,
    /\.order\('id', \{ ascending: true \}\)/,
    '페이지 경계 누락/중복 방지를 위해 고유키(id)로 정렬해야 한다',
  );
  // 정렬/range 없는 단일 select 로 되돌아가면 다시 1000행에서 잘린다.
  const selectCalls = src.match(/\.select\(/g) ?? [];
  assert.equal(selectCalls.length, 1, 'metadata select 는 페이지 루프 안 한 곳이어야 한다');
});

test('에피소드 이름 폴백: 빈 문자열 대신 EP.xx', () => {
  assert.equal(defaultEpisodeTitle(1), 'EP.01');
  assert.equal(defaultEpisodeTitle(8), 'EP.08');
  assert.equal(defaultEpisodeTitle(12), 'EP.12');
  assert.equal(defaultEpisodeTitle(100), 'EP.100');
});

test('Supabase 에피소드 읽기는 빈 제목을 EP.xx 로 채운다', () => {
  for (const [fn, expr] of [
    ['readAllEpisodes', /title: ep\.title \|\| defaultEpisodeTitle\(ep\.episode_number\)/],
    ['readArchivedEpisodes', /title: e\.title \|\| defaultEpisodeTitle\(e\.episode_number\)/],
  ] as const) {
    const src = functionSource(fn);
    assert.match(src, expr, `${fn} 의 제목 폴백이 defaultEpisodeTitle 이어야 한다`);
    assert.doesNotMatch(src, /title: (?:ep|e)\.title \|\| ''/, `${fn} 이 빈 문자열 폴백으로 되돌아갔습니다`);
  }
});

test('에피소드 낙관적 추가도 같은 폴백 이름을 쓴다', () => {
  const store = readFileSync(new URL('../src/stores/useDataStore.ts', import.meta.url), 'utf8');
  assert.match(store, /title: defaultEpisodeTitle\(episodeNumber\)/);
  assert.match(store, /from '@\/shared\/episodeTitle'/);
});
