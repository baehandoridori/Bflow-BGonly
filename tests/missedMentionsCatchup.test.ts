/**
 * 놓친 알림 모으기(메인 fetchMissedMentions) — 나를 부른 댓글 셋(직접 @ · 내 댓글에 답글 · 내가 대상인 리테이크 댓글)을
 * 한 번의 최신순 훑기에서 같이 가려, 어느 한 종류가 자리를 먼저 다 차지해도 더 새로운 다른 종류가 빠지지 않는다(코덱스 3차).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

type Row = {
  id: string; part_id: string; scene_id: string; scene_uuid: string | null; user_id: string; user_name: string;
  text: string; mentions: string[]; images: string[]; created_at: string; edited_at: string | null;
  revision_id: string | null; parent_comment_id: string | null; character_id: string | null;
};
type Revision = { id: string; revision_no: number; requester_id: string | null; assignee_ids: string[]; notify_user_ids: string[] };

function loadFetchMissedMentions(comments: Row[], revisions: Revision[], calls: string[]) {
  const source = fs.readFileSync(new URL('../electron/supabase.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('supabase.ts', source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'fetchMissedMentions');
  assert.ok(node, 'fetchMissedMentions 를 찾지 못함');
  const compiled = ts.transpileModule(node.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const from = (table: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let columns = '*';
    let limit = Infinity;
    const builder: any = {
      select: (cols: string) => { columns = cols; return builder; },
      gt: (col: string, value: string) => { filters.push((r) => r[col] > value); return builder; },
      neq: (col: string, value: string) => { filters.push((r) => r[col] !== value); return builder; },
      is: (col: string, value: null) => { filters.push((r) => r[col] === value); return builder; },
      not: (col: string, _op: string, _value: null) => { filters.push((r) => r[col] != null); return builder; },
      in: (col: string, values: string[]) => { filters.push((r) => values.includes(String(r[col]))); return builder; },
      order: () => builder,
      limit: (n: number) => { limit = n; return builder; },
      or: (expr: string) => {
        // created_at.lt.X,and(created_at.eq.X,id.lt.Y)
        const m = expr.match(/^created_at\.lt\.(.+?),and\(created_at\.eq\.(.+?),id\.lt\.(.+)\)$/);
        assert.ok(m, expr);
        const [, at, , id] = m;
        filters.push((r) => r.created_at < at || (r.created_at === at && r.id < id));
        return builder;
      },
      then: (resolve: (v: unknown) => void) => {
        calls.push(`${table}:${columns}`);
        const source = table === 'comp_revisions' ? revisions : comments;
        const data = (source as any[])
          .filter((r) => filters.every((f) => f(r)))
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || String(b.id).localeCompare(String(a.id)))
          .slice(0, limit);
        resolve({ data, error: null });
      },
    };
    return builder;
  };
  const context = vm.createContext({ exports: {}, supabase: { from } });
  vm.runInContext(compiled, context);
  const fn = context.exports.fetchMissedMentions as (userId: string, userName: string, since: string, limit?: number) => Promise<any[]>;
  // vm 안에서 만든 배열은 다른 영역(realm) 것이라 deepStrictEqual 이 원형을 다르게 본다 — 이 영역 값으로 옮긴다.
  return async (userId: string, userName: string, since: string, limit?: number) =>
    JSON.parse(JSON.stringify(await fn(userId, userName, since, limit))) as any[];
}

const ME = { id: 'u-me', name: '배한솔' };
let seq = 0;
function row(overrides: Partial<Row>): Row {
  seq += 1;
  return {
    id: `c-${String(seq).padStart(4, '0')}`, part_id: 'p-1', scene_id: '1', scene_uuid: null, user_id: 'u-kim', user_name: '김어진',
    text: '글', mentions: [], images: [], created_at: `2026-11-04T01:00:${String(seq % 60).padStart(2, '0')}.000Z`, edited_at: null,
    revision_id: null, parent_comment_id: null, character_id: null, ...overrides,
  };
}
const at = (minute: number, second = 0) => `2026-11-04T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;

test('멘션 49개보다 더 새로운 답글 2개가 limit 안에 들어온다(한 종류가 자리를 다 차지하지 않음)', async () => {
  const mine = row({ user_id: ME.id, user_name: ME.name, created_at: at(0) });
  const mentions = Array.from({ length: 49 }, (_, i) => row({ mentions: [ME.name], created_at: at(10 + i) }));
  const replies = [row({ parent_comment_id: mine.id, created_at: at(100) }), row({ parent_comment_id: mine.id, created_at: at(101) })];
  const calls: string[] = [];
  const fetch = loadFetchMissedMentions([mine, ...mentions, ...replies], [], calls);
  const out = await fetch(ME.id, ME.name, at(1), 50);
  assert.equal(out.length, 50);
  assert.deepEqual(out.slice(0, 2).map((r) => r.id), [replies[1].id, replies[0].id], '가장 새로운 답글이 맨 앞');
  assert.equal(out[0].parentAuthorId, ME.id);
  assert.ok(out.every((r, i) => i === 0 || r.createdAt <= out[i - 1].createdAt), '최신순');
});

test('내가 요청자·담당자·알림 대상인 리테이크의 댓글은 그 리테이크를 실어 오고, 아닌 리테이크는 뺀다', async () => {
  const comments = [
    row({ revision_id: 'rev-mine', created_at: at(20) }),
    row({ revision_id: 'rev-other', created_at: at(21) }),
    row({ revision_id: 'rev-assigned', created_at: at(22) }),
  ];
  const revisions: Revision[] = [
    { id: 'rev-mine', revision_no: 3, requester_id: ME.id, assignee_ids: [], notify_user_ids: [] },
    { id: 'rev-other', revision_no: 4, requester_id: 'u-x', assignee_ids: ['u-y'], notify_user_ids: [] },
    { id: 'rev-assigned', revision_no: 5, requester_id: 'u-x', assignee_ids: [ME.id], notify_user_ids: [] },
  ];
  const fetch = loadFetchMissedMentions(comments, revisions, []);
  const out = await fetch(ME.id, ME.name, at(1), 50);
  assert.deepEqual(out.map((r) => r.revisionId), ['rev-assigned', 'rev-mine']);
  assert.equal(out[1].revision.revisionNo, 3);
  assert.equal(out[1].revision.requesterId, ME.id);
});

test('다른 사람 댓글에 달린 답글·내가 쓴 댓글·캐릭터 댓글·기준 시각 이전 댓글은 돌려주지 않는다', async () => {
  const theirs = row({ user_id: 'u-park', created_at: at(0) });
  const comments = [
    theirs,
    row({ parent_comment_id: theirs.id, created_at: at(30) }),
    row({ user_id: ME.id, mentions: [ME.name], created_at: at(31) }),
    row({ mentions: [ME.name], character_id: 'hero', created_at: at(32) }),
    row({ mentions: [ME.name], created_at: at(0, 30) }),
  ];
  const fetch = loadFetchMissedMentions(comments, [], []);
  assert.deepEqual(await fetch(ME.id, ME.name, at(1), 50), []);
});

test('여러 페이지에 걸친 답글도 원댓글 작성자를 페이지마다 한 번에 읽고, limit 이 차면 그만 읽는다', async () => {
  const mine = row({ user_id: ME.id, user_name: ME.name, created_at: at(0) });
  const filler = Array.from({ length: 450 }, (_, i) => row({ created_at: at(10, 0).replace('00.000Z', `${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`) }));
  const replies = Array.from({ length: 3 }, (_, i) => row({ parent_comment_id: mine.id, created_at: at(5, i) }));
  const calls: string[] = [];
  const fetch = loadFetchMissedMentions([mine, ...filler, ...replies], [], calls);
  const out = await fetch(ME.id, ME.name, at(1), 2);
  assert.equal(out.length, 2, 'limit 개만');
  assert.ok(out.every((r) => r.parentAuthorId === ME.id));
  assert.ok(calls.filter((c) => c.startsWith('comments:id, part_id')).length <= 3, '페이지는 최대 셋');
});
