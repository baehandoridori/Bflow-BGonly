import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { planStripRoll, rollColumnsPlan, rollDirection } from '../../src/utils/progressMotion.ts';
import { BACKGROUND_FADE_MS, withEntryCurtainHold } from '../../src/utils/backgroundActivity.ts';
import {
  ASSIGNEE_FLASH_MERGE_MS,
  mergeAssigneeFlashes,
  type AssigneeFlash,
} from '../../src/components/widgets/assigneeFlash.ts';
import { SCENE_FLASH_MERGE_MS } from '../../src/stores/sceneFlashStore.ts';

/* 움직임 폴리싱 검증 지적 수정 (갈래 fx-misc):
   acc-dash-1 · acc-dash-3 · review-correctness-3 · acc-live-drag-view-2/3/4 · acc-motion-settings-4 · acc-chrome-popups-2 */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

/* ─── acc-dash-1: 굴러가는 중 방향이 바뀌면 그 자리에서 반대로 ─── */

test('진행률 숫자: 올린 직후(굴림 중) 되돌리면 모든 열이 아래로만 감긴다', () => {
  // 0% → 13% 굴림이 도는 중(굴림 상태 = { from: '0', dir: +1 }) 13% → 0% 가 왔다.
  const rolling = { from: '0', dir: 1 as const };
  const plan = rollColumnsPlan({ value: 13, text: '13' }, { value: 0, text: '0' }, rolling);
  assert.equal(plan.dir, -1, '직전 굴림 방향(+1)을 물려받지 않는다');
  assert.equal(plan.from, '13', '새로 생기는 자리는 직전 값 기준');
  // 일의 자리 열: 3 으로 가던 중(지금 보이는 칸 2.95)에서 0 으로 — 아래로.
  const ones = planStripRoll(2.95, 3, 0, plan.dir);
  assert.ok(ones.to < ones.from, `아래로 감겨야 한다: ${ones.from} → ${ones.to}`);
  assert.equal(((ones.to % 10) + 10) % 10, 0);
  // 고치기 전: 직전 방향(+1)이면 3 → 10 으로 위로 감겨 4·5·…·9 가 스쳤다.
  const stale = planStripRoll(2.95, 3, 0, rolling.dir);
  assert.ok(stale.to > stale.from);

  // 대시보드 0.5% → 1.0% → 0.5% (200ms 간격): 두 열 모두 아래로.
  const dash = rollColumnsPlan({ value: 1, text: '1.0' }, { value: 0.5, text: '0.5' }, { from: '0.5', dir: 1 });
  assert.equal(dash.dir, rollDirection(1, 0.5));
  const intCol = planStripRoll(0.94, 1, 0, dash.dir);
  const fracCol = planStripRoll(9.7, 10, 5, dash.dir);
  assert.ok(intCol.to < intCol.from && fracCol.to < fracCol.from, '정수·소수 자리 모두 아래로');

  // 같은 값을 다시 그릴 때(굴림 상태가 막 갱신된 뒤)는 굴림 상태를 그대로 쓴다.
  assert.deepEqual(rollColumnsPlan({ value: 0, text: '0' }, { value: 0, text: '0' }, { from: '13', dir: -1 }), { from: '13', dir: -1 });
});

test('RollingNumber: 열에 넘기는 방향·출발 글자를 렌더 중에 직전 값으로 정한다', () => {
  const src = read('src/components/ui/RollingNumber.tsx');
  assert.match(src, /const plan = rollColumnsPlan\(lastRef\.current, \{ value: target, text \}, view\);/);
  assert.match(src, /splitRollingDigits\(plan\.from\)/);
  assert.match(src, /dir=\{plan\.dir\}/);
  assert.doesNotMatch(src, /dir=\{view\.dir\}/, '굴림 상태의 낡은 방향을 열에 넘기지 않는다');
});

/* ─── acc-dash-3: 'Bflow.' 덮개 아래 미리 그린 대시보드 배경은 쉰다 ─── */

test('덮개 아래 대시보드 배경: 덮개가 내려와 있으면 첫 장만 그리고 쉬고, 걷히면 창 상태대로', () => {
  const awake = { active: true, fadeMs: BACKGROUND_FADE_MS.resume };
  assert.deepEqual(withEntryCurtainHold(awake, true), { active: false, fadeMs: 0 });
  assert.deepEqual(withEntryCurtainHold(awake, false), awake);
  const blurred = { active: false, fadeMs: BACKGROUND_FADE_MS.blur };
  assert.deepEqual(withEntryCurtainHold(blurred, false), blurred, '걷힌 뒤에도 다른 프로그램을 쓰는 중이면 그대로 멈춤');

  const gate = read('src/hooks/useBackgroundLoopGate.ts');
  assert.match(gate, /const offCurtain = holdUnderCurtain \? entryCurtain\.subscribe\(sync\) : null;/, '덮개 상태를 구독한다(쓰는 배경만)');
  assert.match(gate, /withEntryCurtainHold\(readBackgroundActivity\(\), holdUnderCurtain && entryCurtain\.state === 'down'\)/);
  assert.match(gate, /active: withEntryCurtainHold\(readBackgroundActivity\(\), holdRef\.current && entryCurtain\.state === 'down'\)\.active/, '덮개 아래에서 만든 루프는 잠든 채 시작');
  assert.match(gate, /loopRef\.current\?\.setActive\(active, fadeMs\);/);

  const dash = read('src/views/Dashboard.tsx');
  const plexus = dash.slice(dash.indexOf('function DashboardPlexus'), dash.indexOf('function DashboardBackgroundArt'));
  assert.match(plexus, /\{ holdUnderEntryCurtain: true \}/);
  const art = dash.slice(dash.indexOf('function DashboardBackgroundArt'));
  assert.equal((art.match(/\n\s*holdUnderEntryCurtain\n/g) ?? []).length, 2, '대시보드 StarNest 두 종');
  for (const file of ['src/components/effects/StarNestBackground.tsx', 'src/components/effects/BflowStarNestBackground.tsx']) {
    assert.match(read(file), /holdUnderEntryCurtain = false,/, `${file}: 기본은 끔(로그인·설정 미리보기 배경은 그대로)`);
    assert.match(read(file), /useBackgroundLoopGate\([^\n]*, \{ holdUnderEntryCurtain \}\)/, file);
  }
  // 보이는 로그인 배경은 덮개를 이유로 멈추지 않는다
  assert.doesNotMatch(read('src/components/auth/LoginScreen.tsx'), /holdUnderEntryCurtain/);
});

/* ─── review-correctness-3: 덮개가 걷히는 중 사용자가 사라지면 로그인 카드로 되돌린다 ─── */

test('첫 진입 덮개: 걷히는 도중 사용자가 사라지면 덮개를 되돌리고 새 로그인 카드를 붙인다', () => {
  const src = read('src/components/auth/LoginScreen.tsx');
  const effect = src.slice(src.indexOf("if (mode !== 'login' || currentUser || phase !== 'exit') return;"));
  assert.ok(effect.length > 0, '되돌리기 효과');
  const body = effect.slice(0, effect.indexOf('}, [mode, currentUser, phase]);'));
  assert.match(body, /formRoundRef\.current \+= 1;/);
  assert.match(body, /completedRef\.current = false;/);
  assert.match(body, /rootRef\.current\?\.classList\.remove\('bf-entry-curtain-lift'\);/);
  assert.match(body, /entryCurtain\.set\('down'\);/);
  assert.match(body, /setLifting\(false\);/);
  assert.match(body, /setPhase\('login'\);/);
  // '로그인 중...' 에 멈춘 카드를 다시 쓰지 않는다
  assert.match(src, /key=\{`login-\$\{formRoundRef\.current\}`\}/);
});

/* ─── acc-live-drag-view-2: 담당자 카드 반짝은 한 번의 변경 묶음에 한 번 ─── */

test('담당자 카드 반짝: 400ms 안에 연달아 오르면 빛을 다시 틀지 않고 +N씬 만 더한다', () => {
  assert.equal(ASSIGNEE_FLASH_MERGE_MS, SCENE_FLASH_MERGE_MS, '씬 카드 묶음과 같은 간격');
  let n = 0;
  const seq = () => ++n;
  const empty: ReadonlyMap<string, AssigneeFlash> = new Map();
  // BG 체크 한 번 = LO → 완료 → 검수 → PNG 가 왕복 시간 간격으로 차례로 저장(마지막에 씬 완료)
  let flashes = mergeAssigneeFlashes(empty, [{ name: '원동우', delta: 0 }], 1000, seq);
  const first = flashes.get('원동우')!;
  flashes = mergeAssigneeFlashes(flashes, [{ name: '원동우', delta: 0 }], 1250, seq);
  flashes = mergeAssigneeFlashes(flashes, [{ name: '원동우', delta: 0 }], 1500, seq);
  flashes = mergeAssigneeFlashes(flashes, [{ name: '원동우', delta: 1 }], 1750, seq);
  const merged = flashes.get('원동우')!;
  assert.equal(merged.seq, first.seq, '반짝(key)은 그대로 — 최고 밝기에서 0 으로 떨어지지 않는다');
  assert.equal(merged.delta, 1);
  assert.notEqual(merged.deltaSeq, first.deltaSeq, '완료 씬이 늘면 +N씬 만 새로 띄운다');
  // 이미 띄운 +N씬 은 진행만 오를 때 다시 틀지 않는다
  const again = mergeAssigneeFlashes(flashes, [{ name: '원동우', delta: 0 }], 1900, seq).get('원동우')!;
  assert.equal(again.deltaSeq, merged.deltaSeq);
  // 묶음 안에서 씬을 또 끝내면 +N 이 쌓인다(+1씬 → +2씬)
  const twice = mergeAssigneeFlashes(flashes, [{ name: '원동우', delta: 1 }], 1900, seq).get('원동우')!;
  assert.equal(twice.delta, 2);
  assert.equal(twice.seq, first.seq);
  // 묶음이 끝난 뒤(직전 오름에서 400ms 넘게)의 새 변경은 새 반짝
  const later = mergeAssigneeFlashes(flashes, [{ name: '원동우', delta: 0 }], 1750 + ASSIGNEE_FLASH_MERGE_MS + 1, seq).get('원동우')!;
  assert.notEqual(later.seq, first.seq);
  assert.equal(later.delta, 0);
  // 다른 사람은 따로
  const other = mergeAssigneeFlashes(flashes, [{ name: '이혜민', delta: 0 }], 1800, seq);
  assert.equal(other.get('원동우')!.seq, first.seq);
  assert.ok(other.get('이혜민'));
  assert.equal(mergeAssigneeFlashes(flashes, [], 2000, seq), flashes, '오른 사람이 없으면 그대로');

  const widget = read('src/components/widgets/AssigneeCardsWidget.tsx');
  assert.match(widget, /<span key=\{flash\.seq\} className="assignee-flash" aria-hidden \/>/);
  assert.match(widget, /key=\{`delta-\$\{flash\.deltaSeq\}`\}/);
});

/* ─── acc-live-drag-view-3: 시트 첫 줄 이름표가 고정 머리줄에 가리지 않는다 ─── */

test('시트 이름표: 고정 머리줄과 맞닿은 줄이면 칸 아래쪽으로 뒤집는다', () => {
  const flash = read('src/components/scenes/SceneRemoteFlash.tsx');
  assert.match(flash, /<RemoteRowTag key=\{`tag-\$\{flash\.seq\}`\} text=\{tagText\} \/>/, '다시 틀 때는 key 재마운트 그대로');
  assert.match(flash, /const head = cell\?\.closest\('table'\)\?\.tHead;/);
  assert.match(flash, /cell\.getBoundingClientRect\(\)\.top - ROW_TAG_OVERHANG_PX < head\.getBoundingClientRect\(\)\.bottom/);
  assert.match(flash, /useLayoutEffect\(/, '그리기 전에 정한다(위에 떴다 아래로 튀지 않게)');
  const css = read('src/styles/motion-live-drag.css');
  assert.match(css, /\.scene-remote-tag\.scene-remote-tag--row \{[^}]*top: -11px;/);
  assert.match(css, /\.scene-remote-tag\.scene-remote-tag--row\.is-below \{\s*top: auto;\s*bottom: -11px;\s*\}/);
});

/* ─── acc-live-drag-view-4: '만들기' 뒤 저장 응답에 막대가 다시 붙지 않는다 ─── */

test("'만들기': 저장 id 로 바뀌어도 같은 막대(key)로 이어 그려 굳어짐·빛 링이 끊기지 않는다", () => {
  const view = read('src/views/ScheduleView.tsx');
  const handler = view.slice(view.indexOf('const handleAddEvent = useCallback('), view.indexOf('const handleDeleteEvent'));
  const persisted = handler.slice(handler.indexOf('onPersistedIdentity:'));
  assert.match(persisted, /const persistedKey = calendarEventIdentityKey\(identity\);/);
  assert.match(persisted, /const optimisticKey = calendarEventIdentityKey\(optimisticIdentity\);/);
  assert.match(persisted, /new Map\(previous\)\.set\(persistedKey, optimisticKey\)/);
  assert.match(view, /bornEventAliases=\{bornEventAliases\}/);
  // 새 useState 는 기존 선언들 뒤(테스트 하네스가 훅을 슬롯 순서로 흉내 낸다)
  assert.ok(view.indexOf('const [bornEventAliases, setBornEventAliases] = useState') > view.indexOf('const [createGhostLeaving, setCreateGhostLeaving] = useState(false);'));

  const grid = read('src/components/calendar/CalendarGrid.tsx');
  assert.match(grid, /const alias = bornEventAliases\?\.get\(identityKey\);/);
  assert.match(grid, /const barKey = alias && !events\.some\(\(event\) => calendarEventIdentityKey\(event\) === alias\) \? alias : identityKey;/, '낙관적 행이 따로 남아 있으면 key 가 겹치지 않게');
  assert.match(grid, /isBorn=\{bornEventIdentities\?\.has\(barKey\) === true\}/);
  // 착지·실시간 표시는 실제 일정 키 그대로
  assert.match(grid, /landingToken=\{landing && landing\.key === identityKey \? landing\.seq : null\}/);
  assert.match(grid, /isRealtimeHighlighted=\{highlightedEventIdentities\?\.has\(identityKey\)\}/);
});

/* ─── acc-motion-settings-4: 빠른 검색 — 키보드로 옮기는 중에는 커서 밑 줄로 선택을 덮어쓰지 않는다 ─── */

test('빠른 검색: 마우스를 실제로 움직였을 때만 그 줄을 고른다', () => {
  const src = read('src/components/spotlight/SpotlightSearch.tsx');
  assert.doesNotMatch(src, /onMouseEnter=\{\(\) => setSelectedIndex\(idx\)\}/, '스크롤로 커서 밑에 들어온 줄이 키보드 선택을 덮어썼다');
  const move = src.slice(src.indexOf('onMouseMove={(e) => {'));
  assert.ok(move.length > 0);
  assert.match(move, /^onMouseMove=\{\(e\) => \{\n\s*const last = pointerAtRef\.current;\n\s*pointerAtRef\.current = \{ x: e\.clientX, y: e\.clientY \};\n\s*if \(last \? last\.x === e\.clientX && last\.y === e\.clientY : keyboardNavRef\.current\) return;\n\s*keyboardNavRef\.current = false;\n\s*setSelectedIndex\(idx\);/);
  // ↓·↑ 를 누르면 키보드로 옮기는 중 — 포인터 위치를 모르는 채 처음 들어온 이동(스크롤로 생긴 것)은 고르지 않는다
  const keys = src.slice(src.indexOf('const handleKeyDown = useCallback('), src.indexOf("} else if (e.key === 'Enter'"));
  assert.equal((keys.match(/keyboardNavRef\.current = true;/g) ?? []).length, 2);
});

/* ─── acc-chrome-popups-2: 캘린더 빠른 편집 창은 흐림 없이 불투명 ─── */

test('캘린더 우클릭 빠른 편집: 흐림을 뺀 만큼 바탕을 불투명하게(뒤 날짜·막대가 비치지 않게)', () => {
  const src = read('src/components/calendar/EventQuickEdit.tsx');
  const style = src.slice(src.indexOf('...floatingSolidStyle,'), src.indexOf('boxShadow:', src.indexOf('...floatingSolidStyle,')));
  assert.doesNotMatch(style, /bg-card\) \/ 0\.9/, '95% 바탕 덮어쓰기 금지');
  assert.match(style, /background: 'rgb\(var\(--color-bg-card\)\)',/);
  assert.doesNotMatch(src, /backdropFilter|floatingGlassStyle/, '움직이며 피어나는 창에 흐림을 다시 넣지 않는다');
});
