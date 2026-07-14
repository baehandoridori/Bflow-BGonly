import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { advanceFixedStep, createFixedStepLoop } from '../src/features/playground/arcade/games/loop.ts';
import { createHorizontalRepeater } from '../src/features/playground/arcade/games/keymap.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...seg: string[]) => readFileSync(path.join(root, ...seg), 'utf8');
const chromeSource = read('src', 'views', 'playground', 'arcade', 'ArcadeStageChrome.tsx');
const resultSource = read('src', 'views', 'playground', 'arcade', 'RunResultOverlay.tsx');
const snakeStageSource = read('src', 'views', 'playground', 'arcade', 'SnakeStage.tsx');
const loopSource = read('src', 'features', 'playground', 'arcade', 'games', 'loop.ts');
const arcadeCssSource = read('src', 'views', 'playground', 'arcade', 'arcade.css');
const tetrisStageSource = read('src', 'views', 'playground', 'arcade', 'TetrisStage.tsx');
const gameHostSource = read('src', 'views', 'playground', 'arcade', 'GameHost.tsx');
const neonSource = read('src', 'views', 'playground', 'arcade', 'neonBoard.ts');
const rankingPanelSource = read('src', 'views', 'playground', 'arcade', 'ArcadeRankingPanel.tsx');
const adminSettingsSource = read('src', 'views', 'playground', 'arcade', 'ArcadeAdminSettings.tsx');
const houseSource = read('src', 'views', 'playground', 'JbbjHouse.tsx');
const mainSource = read('electron', 'main.ts');

test('advanceFixedStep accumulates frames and steps once per crossed interval', () => {
  let steps = 0;
  const getStep = () => 160;
  let acc = 0;
  for (let i = 0; i < 4; i += 1) acc = advanceFixedStep(acc, 33, getStep, () => { steps += 1; });
  assert.equal(steps, 0, '132ms 누적 → 아직 스텝 없음');
  acc = advanceFixedStep(acc, 33, getStep, () => { steps += 1; });
  assert.equal(steps, 1, '165ms 누적 → 1스텝');
  assert.ok(acc >= 0 && acc < 160);
});

test('advanceFixedStep re-reads stepMs each step so acceleration takes effect', () => {
  let stepMs = 100;
  const steps: number[] = [];
  // 200ms 를 한 번에 넣되, 스텝마다 간격이 줄어들어 고정 100ms(2스텝)보다 많이 실행돼야 한다.
  advanceFixedStep(0, 200, () => stepMs, () => { steps.push(stepMs); stepMs = Math.max(20, stepMs - 40); });
  assert.ok(steps.length >= 3, `가변 stepMs 로 3스텝 이상 (실제 ${steps.length})`);
  assert.deepEqual(steps.slice(0, 3), [100, 60, 20]);
});

test('advanceFixedStep caps catch-up steps to avoid the spiral of death', () => {
  let steps = 0;
  advanceFixedStep(0, 100000, () => 16, () => { steps += 1; }, 5);
  assert.equal(steps, 5);
});

test('createFixedStepLoop does not advance simulation while paused', () => {
  const frame: { cb: ((t: number) => void) | null } = { cb: null };
  const requestFrame = (fn: (t: number) => void) => { frame.cb = fn; return 1; };
  const cancelFrame = () => { frame.cb = null; };
  let steps = 0;
  const loop = createFixedStepLoop({
    getStepMs: () => 100,
    onStep: () => { steps += 1; },
    now: () => 1000,
    requestFrame,
    cancelFrame,
  });
  loop.start();
  frame.cb?.(1050); // delta 50 → 0 step
  frame.cb?.(1160); // delta 110 → 1 step
  assert.equal(steps, 1);
  loop.pause();
  assert.equal(loop.isRunning(), false);
  frame.cb?.(2000); // paused: tick 은 early-return 이어야 한다
  assert.equal(steps, 1, '일시정지 중에는 스텝이 늘지 않는다');
});

test('the DAS/ARR repeater moves once immediately then repeats after the delay', () => {
  const r = createHorizontalRepeater({ dasMs: 160, arrMs: 40 });
  assert.equal(r.press(1, 0), 1, 'keydown 즉시 1회');
  assert.equal(r.advance(159), 0, 'DAS 전에는 반복 없음');
  assert.equal(r.advance(160), 1, 'DAS(160ms) 후 첫 반복');
  assert.equal(r.advance(200), 1, 'ARR 40ms 간격 반복');
  assert.equal(r.advance(239), 0);
  assert.equal(r.advance(240), 1);
  r.release(1, 300);
  assert.equal(r.activeDir(), 0);
  assert.equal(r.advance(1000), 0, 'keyup 후 반복 정지');
});

test('the repeater gives the later key priority and falls back on release', () => {
  const r = createHorizontalRepeater({ dasMs: 160, arrMs: 40 });
  r.press(1, 0);
  r.press(-1, 10); // 나중 키 우선
  assert.equal(r.activeDir(), -1);
  r.release(-1, 20); // 오른쪽이 아직 눌려 있으면 그쪽으로 전환
  assert.equal(r.activeDir(), 1);
  // 같은 방향 반복 press(홀드 keydown)는 즉시 이동을 만들지 않는다
  assert.equal(r.press(1, 30), 0);
});

test('ArcadeStageChrome renders per-phase overlays and guards start/back', () => {
  assert.match(chromeSource, /phase === 'ready'/);
  assert.match(chromeSource, /phase === 'countdown'/);
  assert.match(chromeSource, /phase === 'paused'/);
  assert.match(chromeSource, /phase === 'result'/);
  // 시작 버튼은 사유가 있거나 입장 요청 진행 중이면 비활성(입장료 중복 차감 방지)
  assert.match(chromeSource, /disabled=\{!!startDisabledReason \|\| !!startPending\}/);
  assert.match(chromeSource, /entryFee\}P 내고 시작/);
  // 진행/일시정지/카운트다운 + 입장료 정산 중(startPending)에도 뒤로가기 인터셉트
  assert.match(chromeSource, /phase === 'running' \|\| phase === 'paused' \|\| phase === 'countdown' \|\| !!startPending/);
  assert.match(chromeSource, /usePlaygroundBackInterceptor\(interceptActive/);
  // 정산·저장 중에는 이탈만 막고(모달 없이), 진행 중이면 확인 전에 먼저 멈춘다
  assert.match(chromeSource, /if \(startPending \|\| phase === 'finishing'\) return;/);
  assert.match(chromeSource, /if \(phase === 'running'\) \{ onPause\(\)/);
  // 확인 모달 중에는 카운트다운도 멈춘다
  assert.match(chromeSource, /phase !== 'countdown' \|\| confirmingQuit/);
  // 결과 저장 중(에러 전)에도 뒤로가기를 가로채 유료 판 유실을 막는다
  assert.match(chromeSource, /const savingResult = phase === 'finishing' && !finishError;/);
  assert.match(chromeSource, /if \(startPending \|\| phase === 'finishing'\) return;/);
  // 종료 확인 문구 + 입장료 안내
  assert.match(chromeSource, /게임을 종료할까요\?/);
  assert.match(chromeSource, /입장료는 돌려받지 못해요/);
  // 상태 aria-live + reduced-motion 대체
  assert.match(chromeSource, /aria-live="polite"/);
  assert.match(chromeSource, /useReducedMotion/);
  assert.match(chromeSource, /if \(prefersReducedMotion\)/);
});

test('the loop auto-pauses on hidden/blur and resumes on focus', () => {
  assert.match(loopSource, /addEventListener\('visibilitychange'/);
  assert.match(loopSource, /addEventListener\('blur'/);
  assert.match(loopSource, /addEventListener\('focus'/);
  // active(사용자 의도) + visible(창 상태) 둘 다일 때만 프레임을 돌린다
  assert.match(loopSource, /if \(!active \|\| !visible\) return;/);
  assert.match(loopSource, /!document\.hidden && document\.hasFocus\(\)/);
  // onStep 이 stop()/pause() 하면 tick 이 다음 프레임을 재요청하지 않고 frameId 를 비운다(재시작 가능)
  assert.match(loopSource, /if \(active && visible\) \{\s*frameId = requestFrame\(tick\);\s*\} else \{\s*frameId = null;/);
});

test('SnakeStage only updates the HUD when values change (no per-frame re-render)', () => {
  assert.match(snakeStageSource, /s\.length !== hudRef\.current\.length \|\| s\.goldenEaten !== hudRef\.current\.golden/);
});

test('arcade.css wraps --pg tokens in rgb() (they are raw triplets)', () => {
  assert.match(arcadeCssSource, /rgb\(var\(--pg-panel\)\)/);
  assert.match(arcadeCssSource, /rgb\(var\(--pg-bg\) \/ 0\.82\)/);
  assert.doesNotMatch(arcadeCssSource, /background: var\(--pg-/); // 감싸지 않은 직접 사용 없음
});

test('SnakeStage keeps a retry state when finishRun fails and normalizes canvas colors', () => {
  // finishRun 실패 시 이탈하지 않고 재시도 상태 유지
  assert.match(snakeStageSource, /setFinishError\(true\)/);
  assert.match(snakeStageSource, /onRetryFinish=\{\(\) => void finalize\(\)\}/);
  assert.match(snakeStageSource, /deadStateRef/);
  // 죽은 뒤 catch-up 스텝이 finalize 를 중복 호출하지 않도록 가드
  assert.match(snakeStageSource, /if \(!s \|\| s\.status !== 'running'\) return;/);
  // 종료 payload 를 1회 고정하고, finalize·재시도가 그대로 재사용(멱등 request_id·내용)
  assert.match(snakeStageSource, /finishInputRef\.current = \{/);
  assert.match(snakeStageSource, /const input = finishInputRef\.current;/);
  // duration 은 wall-clock 이 아니라 활성 플레이 시간(스텝 tickMs 합)을 4시간 상한으로 클램프
  assert.match(snakeStageSource, /activePlayMsRef\.current \+= s\.tickMs;/);
  assert.match(snakeStageSource, /Math\.min\(14_400_000, Math\.max\(1000, Math\.round\(activePlayMsRef\.current\)\)\)/);
  assert.doesNotMatch(snakeStageSource, /performance\.now\(\) - startedAtRef/); // wall-clock duration 제거
  // 캔버스도 토큰을 rgb(...) 로 감싼다
  assert.match(snakeStageSource, /`rgb\(\$\{triplet\}\)`/);
  // 크롬은 finishError 시 재시도 오버레이를 띄운다
  assert.match(chromeSource, /finishError \?/);
  assert.match(chromeSource, /결과를 저장하지 못했어요/);
});

test('SnakeStage guards against duplicate entry charges and exits directly', () => {
  // 입장 요청 진행 중이면 재시작 무시(동기 ref 가드) + 버튼 비활성 전달
  assert.match(snakeStageSource, /if \(startingRef\.current\) return;/);
  assert.match(snakeStageSource, /startingRef\.current = true;/);
  assert.match(snakeStageSource, /startPending=\{starting\}/);
  // 확인 전 일시정지용 onPause 전달(루프만 멈춤)
  assert.match(snakeStageSource, /onPause=\{\(\) => loopRef\.current\?\.pause\(\)\}/);
  // 종료 확인 모달이 뜨면 게임 키 입력을 막는다(모달 뒤 방향 큐잉 방지)
  assert.match(snakeStageSource, /if \(confirmOpen\) return;/);
  // 키 홀드 반복(e.repeat)은 방향 큐를 중복으로 채우지 않는다
  assert.match(snakeStageSource, /if \(e\.repeat\) return;/);
  assert.match(snakeStageSource, /onConfirmingChange=\{setConfirmOpen\}/);
  // 결과·종료 라벨은 소스 서페이스 라벨을 쓴다(하우스에서 진입 시 '로비로' 오표기 방지)
  assert.match(snakeStageSource, /returnLabel=\{returnLabel\}/);
  assert.match(resultSource, /\{returnLabel\}/);
  assert.match(chromeSource, /onConfirmingChange\?\.\(confirmingQuit\)/);
  // 시작 실패는 화면에 안내해 유료 시작이 조용히 방치되지 않게 한다
  assert.match(snakeStageSource, /setStartError\(/);
  assert.match(snakeStageSource, /startErrorHint=\{startError\}/);
  assert.match(chromeSource, /\{startErrorHint && <p className="pg-arcade-overlay__hint" role="alert">/);
  // 종료는 루프를 멈추고 onExit(직접 이탈)로 나간다
  assert.match(snakeStageSource, /loopRef\.current\?\.stop\(\);\s*onExit\(\);/);
});

test('ArcadeStageChrome uses a 2-pane layout with info panel and board arena', () => {
  // 좌측 정보 패널 + 우측 아레나
  assert.match(chromeSource, /<aside className="pg-arcade-info">/);
  assert.match(chromeSource, /<div className="pg-arcade-arena">/);
  // 새 슬롯: eyebrow · 제목 · 등급 진행 · 톤 토큰
  assert.match(chromeSource, /className="pg-arcade-eyebrow"/);
  assert.match(chromeSource, /className="pg-arcade-title"/);
  assert.match(chromeSource, /gradeProgress && \(/);
  assert.match(chromeSource, /--pg-arena-tone.*var\(\$\{accentToken\}\)/);
  // 오버레이는 아레나 안에 있어 보드만 덮는다(정보 패널은 계속 보임)
  assert.match(chromeSource, /<div className="pg-arcade-arena">[\s\S]*?pg-arcade-overlay[\s\S]*?phase === 'result'/);
});

test('neonBoard renders emissive neon cells without an embossed inset bevel', () => {
  // 바깥 글로우(shadowBlur) 중심, inset 베벨 아님
  assert.match(neonSource, /export function drawNeonCell/);
  assert.match(neonSource, /export function paintNeonBackground/);
  assert.match(neonSource, /export function drawNeonOutline/);
  assert.match(neonSource, /export function drawNeonDot/);
  assert.match(neonSource, /ctx\.shadowColor = color/);
  assert.match(neonSource, /ctx\.shadowBlur/);
  // 위쪽만 밝히는 광택(아래 어둠 없음 → 엠보싱 방지)
  assert.match(neonSource, /rgba\(255,255,255,0\.32\)/);
});

test('SnakeStage draws a green neon board and passes 2-pane info props', () => {
  assert.match(snakeStageSource, /paintNeonBackground\(/);
  assert.match(snakeStageSource, /drawNeonCell\(/);
  assert.match(snakeStageSource, /drawNeonDot\(/);
  assert.match(snakeStageSource, /accentToken="--pg-green"/);
  assert.match(snakeStageSource, /eyebrow="GROW & SURVIVE"/);
  assert.match(snakeStageSource, /gradeProgress=\{gradeProgress\('snake', hud\.length\)\}/);
  assert.match(snakeStageSource, /className="pg-arcade-board"/);
});

test('TetrisStage draws a blue neon board, moves hold/next into the arena sideboard', () => {
  assert.match(tetrisStageSource, /paintNeonBackground\(/);
  assert.match(tetrisStageSource, /drawNeonCell\(/);
  assert.match(tetrisStageSource, /drawNeonOutline\(/); // 고스트 윤곽
  assert.match(tetrisStageSource, /accentToken="--pg-blue"/);
  assert.match(tetrisStageSource, /gradeProgress=\{gradeProgress\('tetris', hud\.score\)\}/);
  assert.match(tetrisStageSource, /className="pg-arcade-boardwrap"/);
  assert.match(tetrisStageSource, /pg-arcade-sideboard/);
});

test('GameHost routes snake and tetris to their stages, others to ComingSoon', () => {
  assert.match(gameHostSource, /game === 'snake'[\s\S]*?<SnakeStage/);
  assert.match(gameHostSource, /game === 'tetris'[\s\S]*?<TetrisStage/);
  assert.match(gameHostSource, /<ComingSoonGame/);
});

test('TetrisStage reuses the arcade safeguards and DAS/ARR input', () => {
  assert.match(tetrisStageSource, /startRun\('tetris'\)/);
  assert.match(tetrisStageSource, /gameId: 'tetris'/);
  // finish meta: 라인·레벨·최대 라인클리어 (사망 상태에서 고정)
  assert.match(tetrisStageSource, /meta: \{ lines: dead\.lines, levelReached: dead\.stats\.levelReached, maxLineClear: dead\.stats\.maxLineClear \}/);
  // DAS/ARR 리피터 + 활성 시간 클록
  assert.match(tetrisStageSource, /createHorizontalRepeater\(\)/);
  assert.match(tetrisStageSource, /repeaterRef\.current\.advance\(activePlayMsRef\.current\)/);
  // PR C 안전장치 이식: 중복시작 가드·payload 고정·활성시간·확인모달 입력차단·홀드반복 무시·저장실패 재시도
  assert.match(tetrisStageSource, /if \(startingRef\.current\) return;/);
  assert.match(tetrisStageSource, /finishInputRef\.current = \{/);
  assert.match(tetrisStageSource, /if \(confirmOpen\) \{/);
  assert.match(tetrisStageSource, /if \(e\.repeat\) return;/);
  assert.match(tetrisStageSource, /setFinishError\(true\)/);
  assert.match(tetrisStageSource, /onConfirmingChange=\{setConfirmOpen\}/);
  // duration 은 활성 시간을 4시간 상한으로 클램프
  assert.match(tetrisStageSource, /Math\.min\(14_400_000, Math\.max\(1000, Math\.round\(activePlayMsRef\.current\)\)\)/);
});

test('TetrisStage HUD re-renders when hold/next change without a scoring change', () => {
  // 홀드·넥스트는 점수 변화 없이 바뀌므로(홀드 스왑·조각 락) HUD 상태·비교에 포함돼야 stale 안 됨
  assert.match(tetrisStageSource, /hold: TetrisPiece \| null;/);
  assert.match(tetrisStageSource, /next: TetrisPiece\[\];/);
  assert.match(tetrisStageSource, /s\.hold !== prev\.hold \|\| next\.join\(','\) !== prev\.next\.join\(','\)/);
  assert.match(tetrisStageSource, /pieceGlyph\(hud\.hold, 'hold'\)/);
  assert.match(tetrisStageSource, /hud\.next\.map\(/);
});

test('TetrisStage clears held-key state on quit-confirm/blur and syncs the HUD before a keydown death', () => {
  // 눌린 좌우 DAS·소프트드롭을 비우는 공용 헬퍼 — keyup 을 못 받는 상황(확인창·블러·탭 전환)용
  assert.match(tetrisStageSource, /const clearHeldKeys = \(\): void => \{[\s\S]*?repeaterRef\.current\.reset\(\);[\s\S]*?applyTetrisInput\(s, 'softDropOff'\)/);
  assert.match(tetrisStageSource, /if \(confirmOpen\) \{\s*clearHeldKeys\(\);\s*return;/); // 확인창
  assert.match(tetrisStageSource, /window\.addEventListener\('blur', onBlur\)/); // alt-tab
  assert.match(tetrisStageSource, /document\.addEventListener\('visibilitychange', onVisibility\)/); // 탭 숨김
  assert.match(tetrisStageSource, /if \(document\.hidden\) clearHeldKeys\(\)/);
  // 키입력 사망을 저장하기 전에 최종 상태로 HUD 를 맞춘다(결과 화면 점수 = 저장 점수)
  assert.match(tetrisStageSource, /syncHud\(dead\);/);
});

test('TetrisStage finalizes a run that dies from a keydown, not only from a tick', () => {
  // 하드드롭·홀드로 keydown 에서 죽어도 결과 화면으로 마감돼야 한다(입장료 내고 멈추는 일 없게)
  assert.match(tetrisStageSource, /const finalizeDead = useCallback/);
  assert.match(tetrisStageSource, /if \(finishedRef\.current\) return;/); // 정확히 한 번만
  assert.match(tetrisStageSource, /if \(next\.status === 'dead'\) finalizeDead\(next\)/); // 키입력 사망 경로
  assert.match(tetrisStageSource, /if \(s\.status === 'dead'\) finalizeDead\(s\)/); // onStep(중력) 사망 경로
});

test('ArcadeRankingPanel reads snapshot leaderboards with game and period tabs', () => {
  // 스냅샷의 leaderboard 를 그대로 — 별도 fetch 없음
  assert.match(rankingPanelSource, /useArcadeStore\(\(state\) => state\.snapshot\)/);
  assert.match(rankingPanelSource, /leaderboardAll/);
  assert.match(rankingPanelSource, /leaderboardWeekly/);
  // 게임 탭(스네이크/테트리스) × 기간 탭(전체/이번 주)
  assert.match(rankingPanelSource, /id: 'snake'/);
  assert.match(rankingPanelSource, /id: 'tetris'/);
  assert.match(rankingPanelSource, /id: 'all'/);
  assert.match(rankingPanelSource, /id: 'weekly'/);
  // 내 행 강조 + 5행 고정(미달 시 '—' 자리 표시)
  assert.match(rankingPanelSource, /entry\.userId === myUserId/);
  assert.match(rankingPanelSource, /className=\{isMe \? 'is-me' : ''\}/);
  assert.match(rankingPanelSource, /Array\.from\(\{ length: VISIBLE_ROWS \}/);
});

test('ArcadeAdminSettings toggle drives setSlackNotify and shows the URL notice', () => {
  assert.match(adminSettingsSource, /state\.snapshot\?\.config\.slackNotifyEnabled/);
  assert.match(adminSettingsSource, /setSlackNotify\(event\.target\.checked\)/);
  assert.match(adminSettingsSource, /슬랙 워크플로 주소가 설정된 뒤에 실제로 발송돼요/);
});

test('JbbjHouse mounts the ranking panel and gates admin settings behind authorizedHansol', () => {
  assert.match(houseSource, /<ArcadeRankingPanel \/>/);
  assert.match(houseSource, /authorizedHansol && <ArcadeAdminSettings \/>/);
  // 구현 완료 게임 집합으로 도크 상태 라벨 판단 — 테트리스도 '바로 플레이'
  assert.match(houseSource, /PLAYABLE_GAMES[\s\S]*?'snake', 'tetris'/);
});

test('main skips the arcade record webhook when the URL is empty', () => {
  assert.match(mainSource, /if \(!ARCADE_RECORD_WEBHOOK_URL\) return;/);
});

test('RunResultOverlay sequences grade, reward, best banner and achievements', () => {
  assert.match(resultSource, /pg-arcade-result__gauge-fill/);
  assert.match(resultSource, /useCountUp\(result\.rewardPoints/);
  assert.match(resultSource, /result\.rewardCapped/);
  assert.match(resultSource, /오늘 보상 한도에 도달했어요 \(5\/5\)/);
  assert.match(resultSource, /result\.newAlltimeBest/);
  assert.match(resultSource, /result\.unlockedAchievements\.map/);
  assert.match(resultSource, /delay: animate \? index \* 0\.12/); // 스태거
  assert.match(resultSource, /useReducedMotion/);
});
