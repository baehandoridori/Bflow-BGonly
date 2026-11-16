import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  baeStampNote, baeStampProblem, parseBaeStampUnseen, parseBaeStampEvents, parseBaeUsageTeam, baeCostTable, baeUsageCsv, baeUsageCsvName,
  baeTeamPeriodFrom, baeCostRangeDates, baeCostBucketsFor, BAE_STAMP_LABEL, type BaeUsageTeam,
} from '../src/shared/bae/review.ts';
import { baeTeamFilterProblem, baeTeamCursorProblem, baeTeamRowMatches, mergeBaeTeamRows, parseBaeTeamPage, sortBaeTeamRows, type BaeJob } from '../src/shared/bae/jobs.ts';
import { createBaePreviewGateway } from '../src/features/bae-gyeong/previewGateway.ts';
import { baePreviewSeed } from '../src/features/bae-gyeong/previewSeed.ts';

// BAE경 8단계 (관리자 화면): 도장 · 팀 기록 · 새 도장 숫자 · 비용 표의 순수 계산, 그리고 테스트 모드가 서버와 같은 규칙인지.

test('stamp memo is one line, 다시 needs one, the names are the plan\'s', () => {
  assert.deepEqual(BAE_STAMP_LABEL, { seen: '확인함', good: '좋아요', again: '다시' });
  assert.equal(baeStampNote('  칠판을\n\n 더   크게 '), '칠판을 더 크게');
  assert.equal(baeStampNote('  \n '), null); assert.equal(baeStampNote(undefined), null);
  assert.equal(baeStampProblem('good', null), null);
  assert.equal(baeStampProblem(null, null), null, 'taking a stamp back');
  assert.match(baeStampProblem('again', ' ')!, /메모/);
  assert.match(baeStampProblem('gold', null)!, /종류/);
  assert.match(baeStampProblem(undefined, null)!, /종류/);
  assert.match(baeStampProblem('seen', 'x'.repeat(401))!, /400자/);
  assert.equal(baeStampProblem('seen', 'x'.repeat(400)), null);
  assert.match(baeStampProblem('seen', 3)!, /메모/);
});

test('answers of the server are read strictly', () => {
  assert.deepEqual(parseBaeStampUnseen({ count: 2, jobIds: ['11111111-1111-4111-8111-111111111111', 'nope'], upto: 7 }), { count: 2, jobIds: ['11111111-1111-4111-8111-111111111111'], upto: 7 });
  assert.throws(() => parseBaeStampUnseen({ count: -1, jobIds: [], upto: 0 }));
  assert.throws(() => parseBaeStampEvents([{ id: 1, jobId: 'x', stamp: 'good', by: 'a', at: 't' }]));
  assert.deepEqual(parseBaeStampEvents([{ id: 1, jobId: '11111111-1111-4111-8111-111111111111', stamp: null, note: null, by: 'a', byName: '관리자', at: 't' }])[0].stamp, null);
  const page = parseBaeTeamPage({ rows: [], more: true, next: { createdAt: '2026-11-16T07:01:52.123456+00:00', id: '11111111-1111-4111-8111-111111111111' }, serverTime: 's' });
  assert.equal(page.next!.createdAt, '2026-11-16T07:01:52.123456+00:00', 'the cursor text is kept as it came');
  assert.equal(parseBaeTeamPage({ rows: [], more: true, next: null }).more, false, 'no cursor, no next page');
  assert.throws(() => parseBaeUsageTeam({ rows: [], periods: [], bucket: 'hour' }));
});

test('team filter and cursor shapes', () => {
  assert.equal(baeTeamFilterProblem({}), null);
  assert.equal(baeTeamFilterProblem({ userId: '2', from: '2026-11-01T00:00:00Z', kind: 'same', unstamped: true, q: '주차장' }), null);
  assert.match(baeTeamFilterProblem({ actorId: 'x' })!, /거르기/);
  assert.match(baeTeamFilterProblem({ kind: 'paint' })!, /거르기/);
  assert.match(baeTeamFilterProblem({ unstamped: 'yes' })!, /거르기/);
  assert.match(baeTeamFilterProblem({ to: 'later' })!, /기간/);
  assert.match(baeTeamFilterProblem(null)!, /거르기/);
  assert.equal(baeTeamCursorProblem(null), null);
  assert.match(baeTeamCursorProblem({ createdAt: '2026-11-16T07:00:00Z', id: 'x' })!, /위치/);
  assert.match(baeTeamCursorProblem({ createdAt: '2026-11-16T07:00:00Z', id: '11111111-1111-4111-8111-111111111111', extra: 1 })!, /위치/);
});

const job = (n: number, patch: Partial<BaeJob> = {}): BaeJob => ({
  id: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`, userId: 'u2', userName: '장삐쭈', kind: 'new', status: 'done', name: null, parentJobId: null,
  summary: { request: `요청 ${n}` }, result: {}, images: {}, selfReview: null, stamp: null, stampAt: null, costUsd: 0, origin: '', appVersion: '', hidden: false,
  createdAt: `2026-11-1${n}T01:00:00.000Z`, finishedAt: null, updatedAt: `2026-11-1${n}T01:00:00.000Z`, ...patch,
});

test('changed rows are merged into the visible team list the way the server would filter them', () => {
  const have = sortBaeTeamRows([job(3), job(4), job(5)]);
  assert.deepEqual(have.map((j) => j.id.slice(-1)), ['5', '4', '3'], 'newest made first');
  // '도장 없음': a row that got a stamp leaves; a new unstamped row made after the oldest loaded one comes in
  const f = { unstamped: true };
  const merged = mergeBaeTeamRows(have, [job(4, { stamp: 'seen', updatedAt: '2026-11-16T00:00:00Z' }), job(6)], f, false);
  assert.deepEqual(merged.map((j) => j.id.slice(-1)), ['6', '5', '3']);
  // a changed row made before the oldest loaded row belongs to a page not loaded yet: not added unless the list is complete
  assert.equal(mergeBaeTeamRows(have, [job(1)], {}, false).length, 3);
  assert.equal(mergeBaeTeamRows(have, [job(1)], {}, true).length, 4);
  // person and kind filters
  assert.equal(mergeBaeTeamRows(have, [job(7, { userId: 'u3' })], { userId: 'u2' }, true).length, 3);
  assert.equal(mergeBaeTeamRows(have, [job(7, { kind: 'same' })], { kind: 'same' }, true).length, 4);
  // words: a new row comes in only if its name or description has them; a row already found by the server (order text) stays
  assert.equal(baeTeamRowMatches(job(7, { name: '지하 주차장' }), { q: '주차장' }), true);
  assert.equal(baeTeamRowMatches(job(7), { q: '주차장' }), false);
  const found = [job(5)];
  assert.equal(mergeBaeTeamRows(found, [job(5, { updatedAt: '2026-11-17T00:00:00Z', stamp: 'good' })], { q: 'zebra' }, true)[0].stamp, 'good');
  // an older copy never replaces a newer one, and the PD words of the old copy are kept
  const withPd = [{ ...job(5, { updatedAt: '2026-11-17T00:00:00Z' }), pd: { prompt: 'x' } }];
  assert.equal(mergeBaeTeamRows(withPd, [job(5)], {}, true)[0].updatedAt, '2026-11-17T00:00:00Z');
  assert.equal(mergeBaeTeamRows(withPd, [job(5, { updatedAt: '2026-11-18T00:00:00Z' })], {}, true)[0].pd!.prompt, 'x');
  // a period filter
  assert.equal(baeTeamRowMatches(job(3), { from: '2026-11-14T00:00:00Z' }), false);
  assert.equal(baeTeamRowMatches(job(5), { from: '2026-11-14T00:00:00Z', to: '2026-11-16T00:00:00Z' }), true);
  // unfinished jobs are not waiting for a stamp
  assert.equal(baeTeamRowMatches(job(5, { status: 'drawing' }), { unstamped: true }), false);
});

const report: BaeUsageTeam = {
  from: '2026-10-31T15:00:00.000Z', to: '2026-11-16T09:00:00.000Z', bucket: 'day', tz: 'Asia/Seoul', periods: ['2026-11-14', '2026-11-15', '2026-11-16'],
  rows: [
    { userId: 'u2', userName: '장삐쭈', period: '2026-11-14', kind: 'order', model: 'gpt-6.1-sol', n: 1, usd: 0.1 },
    { userId: 'u2', userName: '장삐쭈', period: '2026-11-16', kind: 'image', model: 'gpt-image-2.5-sunburst', n: 2, usd: 0.2 },
    { userId: 'u3', userName: '허혜원', period: '2026-11-16', kind: 'image', model: 'gpt-image-2.5-sunburst', n: 1, usd: 0.0834 },
    { userId: 'gone', userName: '', period: '2026-11-15', kind: 'layers', model: 'gpt-6.1-sol', n: 1, usd: 0.0001 },
  ],
  total: { n: 5, usd: 0.3835 }, month: { from: '2026-10-31T15:00:00.000Z', n: 5, usd: 0.3835 },
};

test('the cost table adds up to the ledger to the micro-dollar, person × period, kinds in the plan\'s order', () => {
  const t = baeCostTable(report);
  assert.equal(t.check.same, true, '0.1 + 0.2 + … equals the ledger exactly (micro-dollars, no float drift)');
  assert.equal(t.total.usd, 0.3835); assert.equal(t.total.n, 5);
  assert.deepEqual(t.people.map((p) => p.name), ['장삐쭈', '허혜원', '(지운 사용자)'], 'most spent first; a removed user stays with a label');
  assert.deepEqual(t.periods.map((p) => p.label), ['11/14', '11/15', '11/16']);
  assert.equal(t.periods[1].usd, 0.0001);
  assert.deepEqual(t.kinds.map((k) => k.label), ['주문서', '그림', '레이어']);
  assert.equal(t.people[0].cells['2026-11-16'].usd, 0.2); assert.equal(t.people[0].cells['2026-11-15'], undefined);
  const sumOfPeople = t.people.reduce((a, p) => a + Math.round(p.usd * 1e6), 0);
  assert.equal(sumOfPeople, Math.round(report.total.usd * 1e6), 'person sums add up to the total');
  const off = baeCostTable({ ...report, total: { n: 5, usd: 0.38 } });
  assert.equal(off.check.same, false, 'a missing line shows');
  const csv = baeUsageCsv(report, 1400);
  assert.match(csv, /\r\n합계,,,,5,0\.383500,537\r\n$/);
  assert.equal(baeUsageCsvName(report), 'BAE경_비용_2026-11-01_2026-11-16.csv');
});

test('periods: week from Monday, month from the 1st; this year is not shown by day', () => {
  const wed = new Date(2026, 10, 18, 15, 30); // Wed 18 Nov 2026, local time
  const mon = new Date(baeTeamPeriodFrom('week', wed)!);
  assert.equal(mon.getDay(), 1); assert.equal(mon.getDate(), 16); assert.equal(mon.getHours(), 0);
  assert.equal(new Date(baeTeamPeriodFrom('month', wed)!).getDate(), 1);
  assert.equal(new Date(baeTeamPeriodFrom('today', wed)!).getDate(), 18);
  assert.equal(baeTeamPeriodFrom('all', wed), null);
  const sun = new Date(2026, 10, 22, 9); assert.equal(new Date(baeTeamPeriodFrom('week', sun)!).getDate(), 16, 'Sunday belongs to the week of Monday the 16th');
  const last = baeCostRangeDates('last-month', wed);
  assert.equal(new Date(last.from).getMonth(), 9); assert.equal(new Date(last.to!).getMonth(), 10); assert.equal(new Date(last.to!).getDate(), 1);
  assert.equal(new Date(baeCostRangeDates('three-months', wed).from).getMonth(), 8);
  assert.deepEqual(baeCostBucketsFor('this-year'), ['week', 'month']);
  assert.deepEqual(baeCostBucketsFor('this-month'), ['day', 'week', 'month']);
});

function memoryStorage() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, raw: m }; }
const people: Record<string, { id: string; name: string; role: string }> = {
  admin: { id: 'admin', name: '관리자', role: 'admin' }, m1: { id: 'm1', name: '장삐쭈', role: 'user' }, m2: { id: 'm2', name: '허혜원', role: 'user' },
  rev: { id: 'rev', name: '안류천', role: 'user' }, out: { id: 'out', name: '바깥', role: 'user' },
};
function previewWorld() {
  const storage = memoryStorage(); let who = people.admin; let clock = Date.parse('2026-11-16T03:00:00.000Z');
  let ctx: any = null;
  const gw = createBaePreviewGateway({
    storage, identity: () => who, knownUserIds: () => Object.keys(people), userName: (id) => people[id]?.name,
    now: () => new Date(clock += 1000).toISOString(), make: (c) => { ctx = c; return {} as never; },
  });
  return { gw, storage, as: (k: keyof typeof people) => { who = people[k]; }, ctx: () => ctx };
}
const PJ = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;

test('test mode keeps the server\'s rules: two makers never see each other, the reviewer sees and stamps both', async () => {
  const w = previewWorld();
  await w.gw.membersSet('m1', 'user'); await w.gw.membersSet('m2', 'user'); await w.gw.membersSet('rev', 'reviewer');
  w.as('m1'); w.ctx().writeJob({ id: PJ(1), kind: 'new', status: 'done', summary: { request: '지하 주차장' }, pd: { prompt: 'a ZEBRA lot' } });
  w.ctx().logUsage({ requestId: 'r1', jobId: PJ(1), kind: 'image', model: 'gpt-image-2.5-sunburst', tokens: {}, usd: 0.0752, at: '2026-11-16T03:00:10.000Z' });
  w.ctx().writeJob({ id: PJ(3), kind: 'new', status: 'drawing' });
  w.as('m2'); w.ctx().writeJob({ id: PJ(2), kind: 'edit', status: 'done', summary: { request: '교실' } });
  w.ctx().logUsage({ requestId: 'r2', jobId: PJ(2), kind: 'order', model: 'gpt-6.1-sol', tokens: {}, usd: 0.0241, at: '2026-11-16T03:00:20.000Z' });
  // makers: no team list, no other's job or stamps, no stamp, no team cost
  for (const k of ['m1', 'm2'] as const) {
    w.as(k);
    await assert.rejects(w.gw.jobsTeamFind({}, null), /검수자만/);
    await assert.rejects(w.gw.jobsTeam(null), /검수자만/);
    await assert.rejects(w.gw.jobGet(k === 'm1' ? PJ(2) : PJ(1)), /볼 수 없습니다/);
    await assert.rejects(w.gw.jobStamps(k === 'm1' ? PJ(2) : PJ(1)), /볼 수 없습니다/);
    await assert.rejects(w.gw.jobStamp(PJ(2), 'good', null), /검수자만/);
    await assert.rejects(w.gw.usageTeam(null, null, 'day'), /검수자만/);
    assert.ok((await w.gw.jobsMine(null)).rows.every((r) => r.userId === k));
  }
  // reviewer: both makers, server-side filters (the order text too), list shape without PD words
  w.as('rev');
  const all = await w.gw.jobsTeamFind({}, null);
  assert.deepEqual(new Set(all.rows.map((r) => r.userId)), new Set(['m1', 'm2'])); assert.ok(all.rows.every((r) => !('pd' in r)));
  assert.deepEqual((await w.gw.jobsTeamFind({ q: 'zebra' }, null)).rows.map((r) => r.id), [PJ(1)]);
  assert.deepEqual((await w.gw.jobsTeamFind({ unstamped: true }, null)).rows.map((r) => r.id).sort(), [PJ(1), PJ(2)].sort());
  const p1 = await w.gw.jobsTeamFind({}, null, 2); assert.equal(p1.more, true);
  const p2 = await w.gw.jobsTeamFind({}, p1.next, 2); assert.equal(p2.more, false); assert.equal(p2.rows.length, 1);
  // stamps
  await assert.rejects(w.gw.jobStamp(PJ(1), 'again', ''), /메모/);
  await assert.rejects(w.gw.jobStamp(PJ(3), 'seen', null), /만드는 중/);
  const s = await w.gw.jobStamp(PJ(1), 'good', '좋아요\n그대로');
  assert.equal(s.stamp, 'good'); assert.equal(s.stampBy, 'rev'); assert.equal(s.stampNote, '좋아요 그대로');
  await w.gw.jobStamp(PJ(1), 'good', '좋아요 그대로'); // double click
  w.as('admin'); await w.gw.jobStamp(PJ(1), 'again', '창문을 더 크게');
  w.as('m1');
  const h = await w.gw.jobStamps(PJ(1));
  assert.deepEqual(h.map((x) => [x.stamp, x.byName]), [['again', '관리자'], ['good', '안류천']], 'one per job, the history keeps both');
  // the number on the maker's 景 icon
  const u = await w.gw.stampUnseen(); assert.equal(u.count, 1); assert.deepEqual(u.jobIds, [PJ(1)]);
  w.as('m2'); assert.equal((await w.gw.stampUnseen()).count, 0);
  w.as('rev'); await w.gw.jobStamp(PJ(2), 'seen', null);
  w.as('m2'); assert.equal((await w.gw.stampUnseen()).count, 0, '확인함 is quiet');
  w.as('m1'); assert.equal((await w.gw.stampSeen(u.upto)).count, 0);
  // bulk 확인함: never over a stamp, never on a job being drawn
  w.as('rev');
  const b = await w.gw.jobStampBulk([PJ(1), PJ(2), PJ(3)]);
  assert.deepEqual(b, { stamped: [], skipped: 3 });
  // team cost adds up to the ledger
  const c = await w.gw.usageTeam('2026-11-16T00:00:00.000Z', '2026-11-17T00:00:00.000Z', 'day');
  assert.equal(baeCostTable(c).check.same, true); assert.equal(c.total.usd, 0.0993);
  assert.deepEqual(c.periods, ['2026-11-16', '2026-11-17'], 'a UTC day spans two Korean days (periods are Korean time, like the server)');
  assert.ok(c.rows.every((r) => r.period === '2026-11-16'));
  assert.deepEqual(c.rows.map((r) => [r.userName, r.kind]).sort(), [['장삐쭈', 'image'], ['허혜원', 'order']]);
  await assert.rejects(w.gw.usageTeam('2026-01-01T00:00:00.000Z', '2026-11-17T00:00:00.000Z', 'day'), /너무 깁니다/);
  assert.equal(await w.gw.usageExport(null, null, 'week'), null, 'test mode writes no file');
  // taking the reviewer off the list takes the team view away at once
  w.as('admin'); await w.gw.membersSet('rev', 'user');
  w.as('rev'); await assert.rejects(w.gw.jobsTeamFind({}, null), /검수자만/);
});

test('the test-mode seed: two test accounts, a reviewer, and two stamps waiting for 배한솔', async () => {
  const now = new Date(2026, 10, 16, 15, 0);
  const s = baePreviewSeed(now, ['a.jpg', 'b.jpg']);
  assert.deepEqual(s.members, [{ userId: '2', role: 'user' }, { userId: '3', role: 'user' }, { userId: '4', role: 'reviewer' }]);
  assert.deepEqual(new Set(s.jobs.map((j) => j.userId)), new Set(['1', '2', '3']));
  assert.ok(s.jobs.every((j) => Date.parse(j.createdAt) <= now.getTime()), 'nothing made in the future');
  const ids = s.stamps.map((x) => x.id); assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.deepEqual(s.stamps.map((x) => x.at), [...s.stamps.map((x) => x.at)].sort(), 'stamp ids follow time');
  const storage = memoryStorage(); const me = { id: '1', name: '배한솔', role: 'admin' };
  const gw = createBaePreviewGateway({ storage, identity: () => me, knownUserIds: () => ['1', '2', '3', '4'], seed: () => s, userName: (id) => ({ '4': '안류천' } as Record<string, string>)[id] });
  const u = await gw.stampUnseen();
  assert.equal(u.count, 2, '좋아요 and 다시 on 배한솔\'s jobs');
  assert.equal((await gw.jobsTeamFind({ userId: '2' }, null)).rows.length, 4);
  const c = await gw.usageTeam(new Date(now.getTime() - 20 * 86400_000).toISOString(), now.toISOString(), 'day');
  const ledger = s.usage.reduce((a, x) => a + Math.round(x.usd * 1e6), 0) / 1e6;
  assert.equal(c.total.usd, ledger); assert.equal(baeCostTable(c).check.same, true);
  const h = await gw.jobStamps('5eed0000-0000-4000-8000-000000000010');
  assert.deepEqual(h.map((x) => x.stamp), ['again', 'seen'], 'the history shows the stamp was changed');
  // seeded once only
  const again = createBaePreviewGateway({ storage, identity: () => me, knownUserIds: () => ['1'], seed: () => { throw new Error('seeded twice'); } });
  assert.equal((await again.stampUnseen()).count, 2);
});

test('the sidebar badge goes through the files plan 14c 15-4 names, and the badge store never polls', () => {
  const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
  assert.match(sidebar, /item\.id === 'bae-gyeong' && <BaeStampBadge userId=\{currentUser\?\.id \?\? null\} \/>/);
  assert.match(sidebar, /item\.id !== 'bae-gyeong' \|\| canAccessBaeGyeong\(currentUser\)/, 'drawn only inside the gated item');
  const store = readFileSync('src/features/bae-gyeong/state/useBaeStamps.ts', 'utf8');
  assert.doesNotMatch(store, /setInterval/);
  assert.match(store, /import\('\.\.\/gateway'\)/, 'the test-mode gateway is loaded late (the sidebar stays light)');
  const team = readFileSync('src/features/bae-gyeong/state/useBaeTeam.ts', 'utf8');
  assert.doesNotMatch(team, /setInterval/);
  const cost = readFileSync('src/features/bae-gyeong/costs/CostTab.tsx', 'utf8');
  assert.doesNotMatch(cost, /setInterval/);
});
