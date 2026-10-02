import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EMPTY_SCENE_FLASH_BOOK,
  SCENE_FLASH_MAX_RINGS,
  SCENE_FLASH_TTL_MS,
  applySceneFlash,
  pickSceneFlash,
  pruneSceneFlashes,
  sceneFlashLabel,
  useSceneFlashStore,
  type SceneFlashBook,
  type SceneFlashChange,
} from '../../src/stores/sceneFlashStore.ts';
import { phaseFlashLabel, remotePhaseFlash, remoteStageFlash, type RemoteSceneFlashContext } from '../../src/utils/remoteSceneFlash.ts';
import { ASSIGNEE_FLASH_LIMIT, diffAssigneeProgress, snapshotAssignees } from '../../src/components/widgets/assigneeFlash.ts';
import {
  FEED_FRESH_KEEP_MS,
  FEED_FRESH_MAX,
  feedAnchorShift,
  pruneFreshIds,
  trackFreshActivities,
} from '../../src/components/widgets/activity/feedFreshness.ts';
import { groupActivities } from '../../src/components/widgets/activity/utils.ts';
import type { Activity, ActionType } from '../../src/types/index.ts';

/* 움직임 폴리싱 9번 — 팀원이 바꾼 순간: 씬 카드 빛·이름표, 담당자 카드 반짝, 최근 작업 새 줄·묶음 유지. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const stage = (s: 'lo' | 'done' | 'review' | 'png', value = true, department: 'bg' | 'acting' = 'bg'): SceneFlashChange =>
  ({ kind: 'stage', stage: s, value, department });

function play(events: Array<{ uuid: string; at: number; change: SceneFlashChange; by?: string | null }>): SceneFlashBook {
  return events.reduce<SceneFlashBook>(
    (book, e) => applySceneFlash(book, { uuid: e.uuid, byName: e.by === undefined ? '김지은' : e.by, change: e.change, now: e.at }),
    EMPTY_SCENE_FLASH_BOOK,
  );
}

/* ─── 씬 카드: 빛 + 이름표 ─── */

test('한 장 체크: 링과 이름표 "김지은 · 검수 ✓"', () => {
  const book = play([{ uuid: 'a03', at: 1000, change: stage('review') }]);
  const flash = book.flashes.a03;
  assert.ok(flash);
  assert.equal(flash.tag, true);
  assert.equal(flash.bulk, false);
  assert.equal(flash.byName, '김지은');
  assert.equal(flash.label, '검수 ✓');
});

test('BG 연속 저장(LO→완료→검수)은 빛을 다시 틀지 않고 글자만 가장 높은 단계로', () => {
  const book1 = play([{ uuid: 'a03', at: 1000, change: stage('lo') }]);
  const seq = book1.flashes.a03.seq;
  const book2 = applySceneFlash(book1, { uuid: 'a03', byName: '김지은', change: stage('done'), now: 1250 });
  // 직전 신호 기준 400ms — 첫 신호에서 600ms 지나도 사이가 짧으면 같은 묶음
  const book3 = applySceneFlash(book2, { uuid: 'a03', byName: '김지은', change: stage('review'), now: 1600 });
  assert.equal(book3.flashes.a03.seq, seq, '같은 묶음은 같은 key — 링을 재시작하지 않는다');
  assert.equal(book3.flashes.a03.startedAt, 1000);
  assert.equal(book3.flashes.a03.label, '검수 ✓');
});

test('400ms 넘게 쉬었다 다시 오면 새 링(key 가 바뀐다)', () => {
  const book1 = play([{ uuid: 'a03', at: 1000, change: stage('review') }]);
  const book2 = applySceneFlash(book1, { uuid: 'a03', byName: '김지은', change: stage('png'), now: 1500 });
  assert.notEqual(book2.flashes.a03.seq, book1.flashes.a03.seq);
  assert.equal(book2.flashes.a03.label, 'PNG ✓');
  assert.equal(book2.flashes.a03.startedAt, 1500);
});

test('해제 묶음은 가장 낮은 단계 해제, 액팅 단계 이름이 있으면 그게 먼저', () => {
  assert.equal(sceneFlashLabel({ stages: { done: false, review: false, png: false }, department: 'bg', phaseLabel: null, lastLabel: 'PNG 해제' }), '완료 해제');
  assert.equal(sceneFlashLabel({ stages: { lo: true, review: false }, department: 'bg', phaseLabel: null, lastLabel: '검수 해제' }), '검수 해제');
  const book = play([
    { uuid: 'c01', at: 0, change: { kind: 'phase', label: '작업중 2차' } },
    { uuid: 'c01', at: 100, change: stage('lo', true, 'acting') },
    { uuid: 'c01', at: 200, change: stage('done', true, 'acting') },
  ]);
  assert.equal(book.flashes.c01.label, '작업중 2차');
});

test('보낸 사람 이름을 모르면 링만(이름표 없음)', () => {
  const book = play([{ uuid: 'a03', at: 0, change: stage('lo'), by: null }]);
  assert.equal(book.flashes.a03.tag, false);
});

test('일괄: 300ms 안에 4장 이상이면 이름표를 거두고 짧은 링, 동시 링은 최대 8장', () => {
  const events = Array.from({ length: 30 }, (_, i) => ({ uuid: `s${i}`, at: 1000 + i * 5, change: stage('png') }));
  const book = play(events);
  const flashes = Object.values(book.flashes);
  assert.equal(flashes.length, SCENE_FLASH_MAX_RINGS, '동시 링 상한');
  assert.ok(flashes.every((f) => !f.tag), '일괄이면 이름표 없음(먼저 붙은 것도 거둔다)');
  assert.ok(flashes.filter((f) => f.bulk).length >= SCENE_FLASH_MAX_RINGS - 3, '판정 뒤 링은 짧게');
  // 일괄이 끝나고 한참 뒤 한 장은 다시 이름표
  const later = applySceneFlash(book, { uuid: 'z1', byName: '김지은', change: stage('lo'), now: 5000 });
  assert.equal(later.flashes.z1.tag, true);
  assert.equal(later.flashes.z1.bulk, false);
});

test('일괄로 판정되는 순간 들어온 씬부터 이름표 없이 짧은 링', () => {
  const book = play(['s0', 's1', 's2', 's3'].map((uuid, i) => ({ uuid, at: 1000 + i * 20, change: stage('png') })));
  assert.equal(book.flashes.s3.tag, false);
  assert.equal(book.flashes.s3.bulk, true);
  assert.ok(['s0', 's1', 's2'].every((uuid) => book.flashes[uuid].tag === false && book.flashes[uuid].bulk === false), '먼저 시작된 링은 그대로(다시 틀지 않음), 이름표만 거둔다');
});

test('서로 다른 두 팀원이 각각 한 장씩 — 일괄 아님', () => {
  const book = play([
    { uuid: 'a', at: 0, change: stage('lo'), by: '김지은' },
    { uuid: 'b', at: 50, change: stage('lo'), by: '배한솔' },
  ]);
  assert.ok(book.flashes.a.tag && book.flashes.b.tag);
});

test('표시가 끝나면 지운다(2.5초), 통합 카드는 BG·ACT 중 최근 것', () => {
  const book = play([
    { uuid: 'bg1', at: 0, change: stage('lo') },
    { uuid: 'act1', at: 1000, change: { kind: 'phase', label: '완료' } },
  ]);
  assert.equal(pickSceneFlash(book.flashes, ['bg1', 'act1', null])?.label, '완료');
  assert.equal(pickSceneFlash(book.flashes, [undefined, null]), undefined);
  const pruned = pruneSceneFlashes(book, SCENE_FLASH_TTL_MS + 10);
  assert.equal(pruned.flashes.bg1, undefined);
  assert.ok(pruned.flashes.act1);
  assert.equal(pruneSceneFlashes(pruned, SCENE_FLASH_TTL_MS + 20), pruned, '바뀐 게 없으면 같은 객체');
});

test('스토어 pulse: 한 타이머로 정리, clearAll', () => {
  const store = useSceneFlashStore;
  try {
    store.getState().pulse('x1', '김지은', stage('review'));
    assert.equal(store.getState().flashes.x1?.label, '검수 ✓');
  } finally {
    store.getState().clearAll();
  }
  assert.deepEqual(store.getState().flashes, {});
});

/* ─── 받은 신호 중 '팀원이 실제로 바꾼 것'만 ─── */

function ctx(scene: Record<string, unknown> | null, department: 'bg' | 'acting' = 'bg'): RemoteSceneFlashContext {
  return {
    myId: 'me',
    findScene: () => (scene ? { scene, department } : null),
    nameOf: (id) => (id === 'u2' ? '김지은' : null),
  };
}

test('내가 보낸 것·보낸 사람 없음·값이 같음·화면에 없는 씬은 빛나지 않는다', () => {
  assert.equal(remoteStageFlash(ctx({ review: false }), 'a', 'me', { review: true }), null, '내가 바꾼 것');
  assert.equal(remoteStageFlash(ctx({ review: false }), 'a', undefined, { review: true }), null, '보낸 사람 없음');
  assert.equal(remoteStageFlash(ctx({ review: true }), 'a', 'u2', { review: true }), null, '이미 같은 값(방송 뒤 늦게 온 같은 변경)');
  assert.equal(remoteStageFlash(ctx(null), 'a', 'u2', { review: true }), null);
  assert.equal(remoteStageFlash({ ...ctx({ review: false }), myId: null }, 'a', 'u2', { review: true }), null, '로그인 전');
});

test('팀원이 바꾼 단계만 신호가 된다(일괄 행은 여러 단계, 문자열 필드는 무시)', () => {
  const signal = remoteStageFlash(ctx({ lo: true, done: false, review: undefined, png: false }, 'acting'), 'a', 'u2', {
    lo: true, done: true, review: true, png: false, memo: 'x', assignee: '김지은',
  });
  assert.ok(signal);
  assert.equal(signal.byName, '김지은');
  assert.deepEqual(signal.changes, [
    { kind: 'stage', stage: 'done', value: true, department: 'acting' },
    { kind: 'stage', stage: 'review', value: true, department: 'acting' },
  ]);
});

test('액팅 단계: 같은 단계·차수면 신호 없음, 바뀌면 알림과 같은 말', () => {
  const scene = { sceneState: 'work', workRound: 1, feedbackRound: 0 };
  assert.equal(remotePhaseFlash(ctx(scene, 'acting'), 'a', 'u2', { sceneState: 'work', workRound: 1, feedbackRound: 0 }), null);
  const signal = remotePhaseFlash(ctx(scene, 'acting'), 'a', 'u2', { sceneState: 'work', workRound: 2, feedbackRound: 0 });
  assert.deepEqual(signal?.changes, [{ kind: 'phase', label: '작업중 2차' }]);
  assert.equal(phaseFlashLabel('feedback', 1, 3), '피드백 대기 3차');
  assert.equal(phaseFlashLabel('done', 1, 1), '완료');
});

/* ─── 담당자 카드 ─── */

test('담당자 카드: 첫 계산은 저장만, 오른 사람만, 완료 씬이 늘면 +N씬, 최대 6명', () => {
  const rows = [
    { name: '김지은', pct: 50, completedScenes: 6 },
    { name: '배한솔', pct: 30, completedScenes: 2 },
  ];
  assert.deepEqual(diffAssigneeProgress(null, rows), []);
  const prev = snapshotAssignees(rows);
  assert.deepEqual(diffAssigneeProgress(prev, [
    { name: '김지은', pct: 58.3, completedScenes: 7 },
    { name: '배한솔', pct: 25, completedScenes: 2 },
    { name: '새사람', pct: 80, completedScenes: 4 },
  ]), [{ name: '김지은', delta: 1 }], '내려간 사람·처음 보이는 사람은 반짝이지 않는다');
  assert.deepEqual(diffAssigneeProgress(prev, [{ name: '배한솔', pct: 32, completedScenes: 2 }]), [{ name: '배한솔', delta: 0 }], '진행만 오르면 +N씬 없이 반짝');
  assert.deepEqual(diffAssigneeProgress(prev, [{ name: '배한솔', pct: 30.02, completedScenes: 2 }]), [], '표시되지 않는 흔들림은 무시');

  const many = Array.from({ length: 10 }, (_, i) => ({ name: `p${i}`, pct: 10, completedScenes: 0 }));
  const up = many.map((row) => ({ ...row, pct: 20 }));
  assert.equal(diffAssigneeProgress(snapshotAssignees(many), up).length, ASSIGNEE_FLASH_LIMIT);
});

/* ─── 최근 작업 ─── */

function act(id: string, createdAt: string, overrides: Partial<Activity> = {}): Activity {
  return {
    id,
    userId: 'u2',
    userName: '김지은',
    actionType: 'stage_lo' as ActionType,
    actionGroup: 'progress',
    sceneId: 'scene-1',
    sceneLabel: 'EP01 #01',
    episodeNumber: 1,
    department: 'bg',
    detail: null,
    createdAt,
    ...overrides,
  } as Activity;
}

test('새 줄: 처음 채우기·다시 불러오기는 새 줄 아님, 새로 들어온 최신 항목만', () => {
  const base = [act('b', '2026-10-03T01:00:00Z'), act('a', '2026-10-03T00:59:00Z')];
  const seeded = trackFreshActivities(null, base, { reseed: false, now: 0 });
  assert.equal(seeded.fresh.size, 0);

  const arrived = trackFreshActivities(seeded, [act('c', '2026-10-03T01:01:00Z'), ...base], { reseed: false, now: 100 });
  assert.deepEqual([...arrived.fresh.keys()], ['c']);

  const older = trackFreshActivities(arrived, [...base, act('old', '2026-10-02T00:00:00Z')], { reseed: false, now: 200 });
  assert.equal(older.fresh.has('old'), false, '더 불러온 옛 항목은 새 줄이 아니다');

  const reloaded = trackFreshActivities(arrived, [act('d', '2026-10-03T02:00:00Z'), ...base], { reseed: true, now: 300 });
  assert.equal(reloaded.fresh.size, 0, '다시 불러오기(isLoading 거침)는 새 줄 아님');

  const flood = Array.from({ length: FEED_FRESH_MAX + 1 }, (_, i) => act(`f${i}`, `2026-10-03T03:00:${String(i).padStart(2, '0')}Z`));
  assert.equal(trackFreshActivities(seeded, [...flood, ...base], { reseed: false, now: 400 }).fresh.size, 0, '한꺼번에 많이 오면 새 줄로 치지 않는다');

  assert.equal(pruneFreshIds(arrived.fresh, 100 + FEED_FRESH_KEEP_MS).size, 0);
  assert.equal(pruneFreshIds(arrived.fresh, 101), arrived.fresh, '지울 게 없으면 같은 객체');
});

test('목록 내리기 거리: 원래 있던 첫 줄이 밀린 만큼, 줄이 묶음으로 바뀌기만 하면 0', () => {
  // 새 줄(56px)이 맨 위에 생김 → x3 이 0 → 56
  assert.equal(feedAnchorShift(new Map([['x3', 0], ['x2', 56]]), new Map([['n1', 0], ['x3', 56], ['x2', 112]]), ['n1', 'x3', 'x2']), 56);
  // n1 한 줄이 n1+n2 묶음으로 바뀜 → 아래 줄 위치 그대로
  assert.equal(feedAnchorShift(new Map([['n1', 0], ['x3', 56]]), new Map([['g:n1', 0], ['x3', 56]]), ['g:n1', 'x3']), 0);
  assert.equal(feedAnchorShift(null, new Map([['a', 0]]), ['a']), 0);
  assert.equal(feedAnchorShift(new Map([['z', 0]]), new Map([['a', 0]]), ['a']), 0, '비교할 줄 없음');
});

test('묶음 key 는 가장 오래된 항목 — 같은 사람이 또 해도 묶음이 새로 만들어지지 않는다', () => {
  const two = [act('a2', '2026-10-03T01:01:00Z'), act('a1', '2026-10-03T01:00:00Z')];
  const three = [act('a3', '2026-10-03T01:02:00Z'), ...two];
  const g2 = groupActivities(two);
  const g3 = groupActivities(three);
  assert.equal(g2[0].type, 'group');
  assert.equal(g3[0].type, 'group');
  if (g2[0].type === 'group' && g3[0].type === 'group') {
    assert.equal(g3[0].key, g2[0].key);
    assert.equal(g3[0].items.length, 3);
    assert.equal(g3[0].items[0].id, 'a3', '머리 줄(최신)은 그대로 맨 앞');
  }
});

/* ─── 소스 가드 ─── */

test('수신부: 스토어 반영 전에 변화를 읽고, 반영 뒤에 빛낸다(세 경로)', () => {
  const app = read('src/App.tsx');
  for (const [name, flashCall] of [
    ['scene-update', 'remoteStageFlash(remoteSceneFlashContext(), sceneUuid, senderId'],
    ['scene-phase-update', 'remotePhaseFlash(remoteSceneFlashContext(), sceneUuid, senderId'],
    ['scenes UPDATE', 'remoteStageFlash(\n            remoteSceneFlashContext(),\n            delta.uuid,'],
  ] as const) {
    const at = app.indexOf(flashCall);
    assert.ok(at >= 0, `${name}: 변화 판정 호출`);
    // 같은 처리부 안(다음 판정 호출 전, 600자 이내)에서 판정 → 반영 → 빛 순서
    const block = app.slice(at, at + 600);
    const update = block.indexOf('updateSceneByUuid(');
    const pulse = block.indexOf('pulseRemoteSceneFlash(flash)');
    assert.ok(update > 0 && pulse > update, `${name}: 판정 → 반영 → 빛 순서`);
  }
});

test('씬 카드·통합 카드·시트 두 종류에 모두 붙어 있다', () => {
  assert.match(read('src/views/ScenesView.tsx'), /<SceneRemoteFlash sceneUuids=\{\[scene\.id\]\} variant="card" \/>/);
  assert.match(read('src/components/scenes/UnifiedSceneCard.tsx'), /<SceneRemoteFlash sceneUuids=\{\[bgScene\?\.id, actScene\?\.id\]\} variant="card" \/>/);
  assert.match(read('src/components/scenes/SceneSheetView.tsx'), /<SceneRemoteFlash sceneUuids=\{\[scene\.id\]\} variant="row" \/>/);
  assert.match(read('src/components/scenes/UnifiedSceneSheetView.tsx'), /<SceneRemoteFlash sceneUuids=\{\[bgScene\?\.id, actScene\?\.id\]\} variant="row" \/>/);
  const flash = read('src/components/scenes/SceneRemoteFlash.tsx');
  assert.match(flash, /key=\{`ring-\$\{flash\.seq\}`\}/, '다시 틀 때는 key 재마운트');
});

test('CSS: 빛·물듦은 opacity 만, 그림자·배경은 애니메이션하지 않는다, 동작 줄이기는 정적 1.5초', () => {
  const css = stripComments(read('src/styles/motion-live-drag.css'));
  for (const name of ['bf-remote-glow', 'bf-feed-wash', 'bf-remote-hold']) {
    const at = css.indexOf(`@keyframes ${name}`);
    assert.ok(at >= 0, name);
    const body = css.slice(at, css.indexOf('\n}', at));
    assert.doesNotMatch(body, /box-shadow|background|width|height|top|left/, `${name} 은 opacity 만`);
  }
  for (const name of ['bf-remote-tag-in', 'bf-remote-tag-out', 'bf-assignee-delta', 'bf-feed-row-in']) {
    const at = css.indexOf(`@keyframes ${name}`);
    const body = css.slice(at, css.indexOf('\n}', at));
    assert.doesNotMatch(body, /box-shadow|background|width|height|\btop\b|\bleft\b/, `${name} 은 transform/opacity 만`);
  }
  const reduce = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduce, /\.scene-remote-ring,[\s\S]*?animation: bf-remote-hold 1500ms linear forwards !important/);
  assert.doesNotMatch(css, /backdrop-filter/);
});

test('최근 작업: 묶음 펼침은 목록이 들고, 다시 그릴 때 0 에서 펼치지 않는다', () => {
  const feed = read('src/components/widgets/activity/ActivityFeed.tsx');
  assert.doesNotMatch(feed, /useState\(isSelf\)/, '묶음 안 상태로 두면 key 가 바뀔 때 접힌다');
  assert.match(feed, /<AnimatePresence initial=\{false\}>/);
  assert.match(feed, /open=\{openGroups\.get\(item\.key\) \?\? isSelf\}/);
  assert.match(feed, /scroller\.scrollTop > 1\) return;/, '맨 위일 때만 목록을 내린다');
  assert.match(feed, /animateEl\(list, \[\{ transform: `translateY/, '내리기는 WAAPI transform');
  assert.match(feed, /const shift = feedAnchorShift\(prevTops, tops, keys\);\n    if \(shift <= 0\) return;/, '밀린 만큼만');
});
