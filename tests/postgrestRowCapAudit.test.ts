// tests/postgrestRowCapAudit.test.ts
// PostgREST 1000행 캡 전수 감사(project_postgrest_1000_row_cap)에서 고친 지점들의 회귀 방지.
//
// 여기서 지키려는 것은 두 가지다.
//  1) 정렬키가 고유하지 않으면 offset 페이지네이션은 경계 행을 잃는다 — 커서 방식은 잃지 않는다.
//  2) 긴 id 목록을 .in() 한 번에 넣으면 URL 길이 한계를 넘는다 — 묶음으로 끊으면 넘지 않는다.
// 둘 다 "에러 없이 조용히" 일어나므로, 가짜 서버로 그 조용한 실패를 재현해 잡는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chunkForInQuery,
  collectAllPages,
  collectAllPagesByKey,
  POSTGREST_IN_CHUNK_SIZE,
  POSTGREST_PAGE_SIZE,
} from '../src/shared/postgrestPaging.ts';

const supabaseSrc = readFileSync(new URL('../electron/supabase.ts', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');

/** `(export )?async function <name>(` 부터 다음 최상위 선언 직전까지를 잘라낸다. */
function functionSource(src: string, name: string): string {
  const start = src.search(new RegExp(`^(?:export )?async function ${name}(?:<[^>]*>)?\\(`, 'm'));
  assert.notEqual(start, -1, `${name} 를 찾지 못했습니다`);
  const next = src.slice(start + 1).search(/^(?:export )?(?:async function|function|const|interface|type) /m);
  return next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
}

// ─── 가짜 PostgREST ────────────────────────────────────────────────
// 실제 서버처럼 (a) 한 응답을 캡으로 자르고, (b) 동률 구간 안의 순서는 보장하지 않는다.
// (b) 가 핵심이다. Postgres 는 ORDER BY 가 동률이면 매 실행마다 다른 순서를 줄 수 있다.

interface Row { id: string; sortOrder: number }

/** id 는 사전순 정렬이 되도록 zero-padding. sortOrder 동률 비율을 조절할 수 있다. */
function makeRows(count: number, distinctSortOrders: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${String(i).padStart(6, '0')}`,
    sortOrder: i % distinctSortOrders,
  }));
}

/** 동률 구간을 요청마다 다르게 섞어 돌려주는 서버. */
function tieProneServer(rows: Row[], cap: number) {
  let call = 0;
  const orderedFor = (nth: number): Row[] => {
    const groups = new Map<number, Row[]>();
    for (const r of rows) {
      const g = groups.get(r.sortOrder) ?? [];
      g.push(r);
      groups.set(r.sortOrder, g);
    }
    return [...groups.keys()].sort((a, b) => a - b).flatMap((k) => {
      const g = [...(groups.get(k) ?? [])];
      // 홀수번째 요청에서는 동률 그룹을 뒤집는다 — DB 가 순서를 보장하지 않는 상황.
      return nth % 2 === 1 ? g.reverse() : g;
    });
  };
  return {
    /** sort_order 로 정렬한 채 offset 으로 끊어 읽기 (예전 방식). */
    offsetPage: async (from: number, to: number): Promise<Row[]> => {
      const ordered = orderedFor(call++);
      return ordered.slice(from, Math.min(to + 1, from + cap));
    },
    /** 고유키(id)로 정렬하고 "마지막으로 본 id 보다 큰 것"만 읽기 (지금 방식). */
    keysetPage: async (afterId: string | null, limit: number): Promise<Row[]> => {
      call++;
      const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id));
      const startAt = afterId === null ? 0 : ordered.findIndex((r) => r.id > afterId);
      if (startAt === -1) return [];
      return ordered.slice(startAt, startAt + Math.min(limit, cap));
    },
  };
}

test('동률 정렬키 + offset: 페이지 경계에서 행이 실제로 사라진다 (고치려던 그 증상)', async () => {
  // scene_work_links 는 379행 전부가 sort_order=0 이다. 그 상황을 1000행 캡 너머까지 키운 것.
  const rows = makeRows(2500, 1);
  const server = tieProneServer(rows, POSTGREST_PAGE_SIZE);
  const collected = await collectAllPages<Row>(server.offsetPage, POSTGREST_PAGE_SIZE);
  const unique = new Set(collected.map((r) => r.id));
  assert.ok(
    unique.size < rows.length,
    '이 테스트의 가짜 서버가 동률 문제를 재현하지 못하고 있습니다 (테스트 자체가 무의미해짐)',
  );
});

test('동률 정렬키 + 커서(id): 전부 한 번씩만 돌아온다', async () => {
  for (const distinct of [1, 2, 8, 2500]) {
    const rows = makeRows(2500, distinct);
    const server = tieProneServer(rows, POSTGREST_PAGE_SIZE);
    const collected = await collectAllPagesByKey<Row>(server.keysetPage, (r) => r.id, POSTGREST_PAGE_SIZE);
    assert.equal(collected.length, rows.length, `동률 ${distinct}종에서 행 수가 달라졌다`);
    assert.equal(new Set(collected.map((r) => r.id)).size, rows.length, '중복 없이 전량이어야 한다');
    assert.deepEqual(
      collected.map((r) => r.id),
      [...rows].sort((a, b) => a.id.localeCompare(b.id)).map((r) => r.id),
      'id 오름차순으로 이어져야 한다',
    );
  }
});

test('커서(id): 페이지 사이에 다른 사람이 행을 지워도 남은 행을 건너뛰지 않는다', async () => {
  const rows = makeRows(2500, 1);
  const server = tieProneServer(rows, POSTGREST_PAGE_SIZE);
  let deleted = false;
  const collected = await collectAllPagesByKey<Row>(
    async (afterId, limit) => {
      const page = await server.keysetPage(afterId, limit);
      if (!deleted && afterId !== null) {
        // 첫 페이지를 받은 직후 누군가 앞쪽 행 10개를 지운 상황.
        deleted = true;
        rows.splice(0, 10);
      }
      return page;
    },
    (r) => r.id,
    POSTGREST_PAGE_SIZE,
  );
  // 이미 읽은 앞쪽이 지워졌을 뿐, 아직 안 읽은 뒤쪽은 한 줄도 빠지면 안 된다.
  const lastId = `row-${String(2499).padStart(6, '0')}`;
  assert.ok(collected.some((r) => r.id === lastId), '마지막 행이 누락됐다');
  assert.equal(new Set(collected.map((r) => r.id)).size, collected.length, '중복이 생기면 안 된다');
});

test('커서: 서버 캡이 요청한 페이지 크기보다 작아도 전량을 받는다', async () => {
  const rows = makeRows(1714, 1);
  for (const requested of [1000, 5000, 100000]) {
    const server = tieProneServer(rows, 500);  // 서버는 500행씩만 준다
    const collected = await collectAllPagesByKey<Row>(server.keysetPage, (r) => r.id, requested);
    assert.equal(collected.length, 1714, `요청 페이지 ${requested} 에서 행이 잘렸다`);
  }
});

test('커서: 키가 전진하지 않으면 무한 루프 대신 실패한다', async () => {
  // 정렬키를 고유하지 않은 컬럼으로 잘못 지정하면 같은 페이지를 영원히 받게 된다.
  let calls = 0;
  await assert.rejects(
    collectAllPagesByKey<Row>(
      async () => {
        if (++calls > 50) throw new Error('무한 루프: 커서가 전진하지 않음');
        return [{ id: 'same', sortOrder: 0 }];
      },
      (r) => r.id,
      10,
    ),
    /커서가 전진하지 않았습니다/,
  );
  assert.ok(calls <= 50, '무한 루프 가드가 동작하지 않았다');
});

test('커서: 빈 결과 · 빈 키 · 잘못된 페이지 크기', async () => {
  assert.deepEqual(await collectAllPagesByKey<Row>(async () => [], (r) => r.id, 10), []);
  await assert.rejects(
    collectAllPagesByKey<Row>(async () => [{ id: '', sortOrder: 0 }], (r) => r.id, 10),
    /커서가 전진하지 않았습니다/,
    '키가 빈 문자열이면 진행하면 안 된다',
  );
  for (const bad of [0, -5, 1.5, Number.NaN]) {
    await assert.rejects(
      collectAllPagesByKey<Row>(async () => [], (r) => r.id, bad),
      /1 이상의 정수/,
      `pageSize=${bad} 는 거부돼야 한다`,
    );
  }
});

test('커서: fetchAfter 가 던진 에러는 그대로 전파된다', async () => {
  await assert.rejects(
    collectAllPagesByKey<Row>(
      async (afterId) => {
        if (afterId !== null) throw new Error('두 번째 페이지 실패');
        return makeRows(10, 10);
      },
      (r) => r.id,
      10,
    ),
    /두 번째 페이지 실패/,
  );
});

// ─── .in() 묶음 ────────────────────────────────────────────────────

/** PostgREST 가 실제로 만드는 형태의 쿼리스트링 길이. */
function inQueryLength(ids: string[]): number {
  return `id=in.(${ids.join(',')})`.length;
}

const uuids = (n: number) =>
  Array.from({ length: n }, (_, i) => `0123abcd-89ef-4567-89ab-${String(i).padStart(12, '0')}`);

test('.in() 묶음 크기 100 은 URL 길이 한계 아래에 머문다', () => {
  // UUID 36자 + 구분자 → 100개면 약 3.7KB. PostgREST 의 실질 한계(2~4KB) 아래.
  assert.ok(inQueryLength(uuids(100)) < 4096, '100개 묶음이 4KB 를 넘었다');
  // 끊지 않았을 때 실제로 한계를 넘는다는 것도 같이 박아둔다 — 묶음이 필요한 이유.
  assert.ok(inQueryLength(uuids(250)) > 4096, '250개를 한 번에 넣으면 한계를 넘어야 정상');
  assert.equal(POSTGREST_IN_CHUNK_SIZE, 100);
});

test('chunkForInQuery: 경계값과 잘못된 입력', () => {
  assert.deepEqual(chunkForInQuery([], 100), []);
  assert.deepEqual(chunkForInQuery([1, 2, 3], 100), [[1, 2, 3]]);
  assert.deepEqual(chunkForInQuery([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  const big = chunkForInQuery(uuids(250));
  assert.deepEqual(big.map((c) => c.length), [100, 100, 50]);
  assert.equal(big.flat().length, 250, '묶어도 하나도 빠지면 안 된다');
  assert.equal(new Set(big.flat()).size, 250, '묶어도 중복되면 안 된다');
  for (const bad of [0, -1, 2.5, Number.NaN]) {
    assert.throws(() => chunkForInQuery([1, 2], bad), /1 이상의 정수/, `size=${bad} 는 거부돼야 한다`);
  }
});

// ─── 고친 호출 지점이 되돌아가지 않았는지 ───────────────────────────

test('전량 로드(loadAllRows)는 고유키 커서로 페이지를 끊는다', () => {
  const src = functionSource(supabaseSrc, 'loadAllRows');
  assert.match(src, /collectAllPagesByKey</, '커서 페이지네이션을 써야 한다');
  assert.match(src, /\.order\('id', \{ ascending: true \}\)/, '고유키(id)로 정렬해야 한다');
  assert.match(src, /\.gt\('id', afterKey\)/, '마지막으로 본 id 이후만 요청해야 한다');
  assert.doesNotMatch(src, /\.range\(/, 'offset range 로 되돌아가면 동률에서 다시 행을 잃는다');
  assert.doesNotMatch(
    src,
    /\.order\(order\.column/,
    '고유하지 않은 컬럼으로 페이지를 끊으면 안 된다 (표시 순서는 받은 뒤 정렬한다)',
  );
});

test('작업 링크 조회도 고유키 커서로 끊는다 (379행 전부 sort_order=0)', () => {
  const src = functionSource(supabaseSrc, 'readSceneWorkLinkPage');
  assert.match(src, /\.order\('id', \{ ascending: true \}\)/, '고유키(id)로 정렬해야 한다');
  assert.match(src, /\.gt\('id', afterId\)/);
  assert.doesNotMatch(src, /\.range\(/, 'offset range 로 되돌아가면 안 된다');
  assert.doesNotMatch(
    src,
    /\.order\('sort_order'[^)]*\)[\s\S]*\.range\(/,
    'sort_order 로 페이지를 끊으면 전부 동률이라 경계 행이 사라진다',
  );
  const chunk = functionSource(supabaseSrc, 'readSceneWorkLinkChunk');
  assert.match(chunk, /collectAllPagesByKey</);
});

test('씬 UUID 사전조회는 묶음으로 끊고 실패를 삼키지 않는다', () => {
  const src = functionSource(supabaseSrc, 'readScenesByUuidChunks');
  assert.match(src, /chunkForInQuery\(/, '긴 id 목록은 묶음으로 끊어야 한다');
  assert.match(src, /if \(error\) throw new Error/, '조회 실패를 반드시 드러내야 한다');

  for (const fn of ['bulkDeleteScenes', 'bulkUpdateSceneFields']) {
    const body = functionSource(supabaseSrc, fn);
    assert.match(body, /readScenesByUuidChunks\(/, `${fn} 이 묶음 조회를 써야 한다`);
    // 끊지 않은 .in() + error 를 버리는 구조분해로 되돌아가면 삭제 시 이미지가 고아로 남는다.
    assert.doesNotMatch(
      body,
      /const \{ data: \w+ \} = await supabase[\s\S]*?\.in\('id'/,
      `${fn} 이 error 를 버리는 단일 .in() 조회로 되돌아갔습니다`,
    );
  }
});

test('스레드 댓글은 전량을 받는다 (최신 댓글이 잘려 사라지지 않도록)', () => {
  const helper = functionSource(supabaseSrc, 'readAllCommentsBy');
  assert.match(helper, /collectAllPagesByKey</);
  assert.match(helper, /\.order\('id', \{ ascending: true \}\)/);
  assert.match(helper, /\.gt\('id', afterId\)/);
  assert.match(helper, /created_at/, '표시 순서는 시간순으로 맞춰야 한다');
  for (const fn of ['readCommentsForPart', 'readCommentsForCharacter']) {
    const body = functionSource(supabaseSrc, fn);
    assert.match(body, /readAllCommentsBy\(/, `${fn} 이 전량 로드를 거쳐야 한다`);
    assert.doesNotMatch(body, /await supabase\s*$/m, `${fn} 이 단일 select 로 되돌아갔습니다`);
  }
});

test('컴포지팅 상태도 전량을 받는다', () => {
  const src = functionSource(supabaseSrc, 'loadCompositingStates');
  assert.match(src, /collectAllPagesByKey</);
  assert.match(src, /\.eq\('episode_number', episodeNumber\)/, '편 필터는 유지돼야 한다');
  assert.match(src, /\.gt\('id', afterId\)/);
  assert.match(src, /scene_id/, '표시 순서는 scene_id 순이어야 한다');
});

test('에피소드 전량 읽기의 씬 루프는 받은 행 수만큼만 전진한다', () => {
  const src = functionSource(supabaseSrc, 'readAllEpisodes');
  assert.match(src, /collectAllPages</, '씬 페이지는 공용 헬퍼로 모아야 한다');
  assert.match(src, /chunkForInQuery\(sceneIds/, '완료 기록 조회는 묶음으로 끊어야 한다');
  assert.doesNotMatch(
    src,
    /sceneRows\.length < SCENE_PAGE_SIZE/,
    '서버가 요청보다 적게 주면 거기서 끊기는 옛 종료 조건으로 되돌아갔습니다',
  );
});

test('담당자 일괄 변경: 이전 담당자를 못 읽으면 알림을 보내지 않는다', () => {
  const handler = mainSrc.slice(mainSrc.indexOf("ipcMain.handle('supabase:bulk-update-scene-fields'"));
  const body = handler.slice(0, handler.indexOf("ipcMain.handle('supabase:update-scene-field'"));
  assert.ok(body.length > 0, 'bulk-update-scene-fields 핸들러를 찾지 못했습니다');
  assert.match(body, /chunkForInQuery\(/, '이전 담당자 조회도 묶음으로 끊어야 한다');
  assert.match(body, /if \(error\) throw new Error\(error\.message\)/, '조회 실패를 삼키면 안 된다');
  // prevAssignee 를 '' 로 채우면 기존 담당자 전원에게 재배정 알림이 다시 간다.
  assert.doesNotMatch(
    body,
    /prevAssigneeByUuid\.get\(u\.sceneUuid\) \?\? ''/,
    "못 읽은 씬을 빈 문자열로 처리하면 기존 담당자에게 중복 알림이 갑니다",
  );
  assert.match(body, /prevAssignee === undefined/, '못 읽은 씬은 건너뛰어야 한다');
});

test('페이지 크기 상수는 서버 캡과 같은 1000 이다', () => {
  assert.equal(POSTGREST_PAGE_SIZE, 1000);
});
