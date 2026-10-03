/**
 * 움직임 폴리싱 검증 지적 수정 — fx-comments 갈래(설명 말풍선·알림 종·댓글 패널 폭·댓글 보내기·반응·이모지 창·라이트 모드 대비).
 * 판단은 동작으로, 화면 배선·CSS 는 소스 가드로 본다. 실제 화면은 미리보기에서 재현 절차를 다시 해 확인했다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { inBelowTooltipZone, placeFollowTooltip } from '../../src/utils/tooltipPosition.ts';
import {
  REACTION_CHIP_REST,
  REACTION_CHIP_START,
  emojiPickerPlacement,
  isCommentAlreadySavedError,
} from '../../src/utils/commentSendReact.ts';
import { isCallingMeNotification, mergeLiveArrival } from '../../src/utils/notificationArrival.ts';
import { computeAutoCommentPanelWidth } from '../../src/utils/commentPanelResize.ts';
import { THEME_PRESETS, getLightColors } from '../../src/themes.ts';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const tooltip = read('src/components/ui/GlobalTooltip.tsx');
const bell = read('src/components/NotificationPanel.tsx');
const widthHook = read('src/hooks/useCommentPanelWidth.ts');
const panel = read('src/components/scenes/CommentPanel.tsx');
const picker = read('src/components/scenes/EmojiPicker.tsx');
const service = read('src/services/commentService.ts');
const mock = read('src/mocks/devElectronAPI.ts');
const css = read('src/styles/motion-comments-notify.css');

function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} 없음`);
  const open = source.indexOf('{', start + signature.length - 1);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${signature} 본문이 닫히지 않음`);
}

/* ─── 설명 말풍선: 헤더 막대 안의 버튼만 아래로 (acc-chrome-popups-1 · review-correctness-2) ─── */

test('아래로 띄우기는 헤더 막대 안에서 시작하는 대상만 — 알림 창 안(막대 아래에서 시작)은 평소처럼 위', () => {
  const headerBottom = 56; // h-14
  assert.equal(inBelowTooltipZone(11, headerBottom), true, '헤더 버튼(종·새로고침)');
  assert.equal(inBelowTooltipZone(62, headerBottom), false, '알림 창 너비 조절 손잡이(창 높이만큼 긴 대상)');
  assert.equal(inBelowTooltipZone(118, headerBottom), false, '알림 줄 삭제 버튼');
  // 손잡이 위쪽(커서 y=92)을 가리키면 말풍선은 커서 위에 붙는다 — 예전엔 손잡이 아래 끝(484) 밑 490 에 떴다.
  const tall = placeFollowTooltip({ x: 1023, y: 92 }, { width: 257, height: 30 }, { width: 1600, height: 900 }, {
    preferBelow: false,
    targetBottom: undefined,
  });
  assert.equal(tall.below, false);
  assert.equal(tall.top + 30, 92 - 12, '커서 위 12px');
});

test('GlobalTooltip 배선: 영역의 아래 끝과 대상 위 끝을 비교해 아래로 띄울지 정한다', () => {
  assert.match(tooltip, /const belowZone = target\.closest\('\[data-tooltip-placement="below"\]'\);/);
  assert.match(tooltip, /inBelowTooltipZone\(targetRect\.top, belowZone\.getBoundingClientRect\(\)\.bottom\)/);
  assert.match(tooltip, /targetBottom\.current = preferBelow\.current && targetRect \? targetRect\.bottom : undefined;/);
  assert.doesNotMatch(tooltip, /preferBelow\.current = target\.closest\('\[data-tooltip-placement="below"\]'\) !== null;/);
});

/* ─── 알림 종: 창이 열려 있으면 설명 말풍선 없음 (acc-comments-notify-6) ─── */

test('종 버튼: 알림 창이 열려 있으면 title 을 빼서 창 머리 버튼을 덮지 않는다(이름은 aria-label 로 유지)', () => {
  const bellFn = bodyOf(bell, 'export function NotificationBell()');
  assert.match(bellFn, /title=\{panelOpen \? undefined : bellLabel\}/);
  assert.match(bellFn, /aria-label=\{bellLabel\}/);
  assert.match(bellFn, /aria-expanded=\{panelOpen\}/);
});

/* ─── 댓글 패널 폭: 창이 열려 있는 동안 늘어나기만 (acc-comments-notify-4 · acc-scene-flow-4) ─── */

test('자동 폭은 창이 열려 있는 동안 본 가장 많은 댓글 수로 — 씬을 넘겨 댓글이 줄어도 창 틀이 움직이지 않는다', () => {
  assert.match(widthHook, /const \[peakCount, setPeakCount\] = useState\(commentCount\);/);
  assert.match(widthHook, /if \(commentCount > peakCount\) setPeakCount\(commentCount\);/);
  assert.match(widthHook, /computeAutoCommentPanelWidth\(viewportW, autoCount\)/);
  assert.match(widthHook, /if \(savedWidth != null\) return savedWidth;/, '직접 정한 폭이 먼저');
  // a001(댓글 7) → a002(0): 예전엔 456 → 416 으로 줄어 가운데 정렬된 창 틀이 20px 밀렸다.
  const peak = Math.max(7, 0);
  assert.equal(computeAutoCommentPanelWidth(1600, peak), computeAutoCommentPanelWidth(1600, 7));
  assert.notEqual(computeAutoCommentPanelWidth(1600, 7), computeAutoCommentPanelWidth(1600, 0), '줄었다면 폭이 바뀌었을 경우');
});

/* ─── 보내는 중인 댓글: 지우기·수정·답글·반응 막기 (acc-comments-notify-2) ─── */

test('보내는 중(아직 서버에 없음)인 댓글은 지우기·수정·답글·반응이 모두 막힌다 — 지운 댓글이 저장 완료로 되살아나지 않게', () => {
  // 0.4초 전 'sending' 도 화면 상태에 둔다(겉모습은 그대로, 버튼만 막음).
  const begin = bodyOf(panel, 'const beginCommentSend = (draft: UnsentCommentDraft) =>');
  assert.match(begin, /setCommentSendStatus\(id, 'sending'\);/);
  assert.match(panel, /useState<ReadonlyMap<string, CommentSendStatus>>/);
  // 처리기마다 같은 막음 — 화면 버튼을 숨겨도 키보드·다른 길로 들어오면 여기서 멈춘다.
  for (const signature of [
    'const handleDelete = (commentId: string) =>',
    'const handleEdit = async (commentId: string) =>',
    'const handleReactionToggle = useCallback(async (commentId: string, emoji: string) =>',
  ]) {
    assert.match(bodyOf(panel, signature), /if \(unsentCommentsRef\.current\.has\(commentId\)\) return;/, signature);
  }
  for (const signature of [
    'const openContextualThreadReply = useCallback((target: SceneCommentWithSource) =>',
    'const replyInActiveThread = useCallback((target: SceneCommentWithSource) =>',
  ]) {
    assert.match(bodyOf(panel, signature), /if \(unsentCommentsRef\.current\.has\(target\.id\)\) return;/, signature);
  }
  // 반응 줄·답글 버튼: 세 곳(본문·답글·스레드 창) 모두 보내는 동안 누를 수 없다(겉모습은 그대로 — 깜빡임 없게).
  assert.equal([...panel.matchAll(/disabled=\{!!(sendStatus|replySendStatus|messageSendStatus)\}/g)].length, 6);
  const area = bodyOf(panel, '}: ReactionsAreaProps) {');
  assert.match(area, /disabled=\{disabled\}/);
  assert.match(area, /'disabled:invisible'/);
  assert.match(area, /open=\{pickerOpen && !disabled\}/);
  const replyButton = panel.slice(panel.indexOf('function ThreadReplyButton('), panel.indexOf('function CommentSendClock('));
  assert.match(replyButton, /disabled=\{disabled\}/);
  assert.match(replyButton, /disabled:pointer-events-none/);
});

/* ─── 저장됐는데 응답만 끊긴 댓글 (review-data-safety-6) ─── */

test('다시 보내기의 기본 키 중복은 저장된 것 — 문구로 넘어오는 Postgres 오류를 알아본다', () => {
  assert.equal(isCommentAlreadySavedError(new Error('duplicate key value violates unique constraint "comments_pkey"')), true);
  assert.equal(isCommentAlreadySavedError(new Error("Error invoking remote method 'supabase:add-comment': Error: duplicate key value violates unique constraint \"comments_pkey\"")), true);
  assert.equal(isCommentAlreadySavedError({ message: 'code 23505' }), true);
  assert.equal(isCommentAlreadySavedError(new Error('fetch failed')), false);
  assert.equal(isCommentAlreadySavedError(new Error('댓글 저장 실패: 씬을 찾을 수 없음')), false);
  assert.equal(isCommentAlreadySavedError(null), false);
  assert.equal(isCommentAlreadySavedError(undefined), false);
});

test('다시 보내기: 중복으로 거절되면 저장된 것으로 마무리하고 서버 목록을 다시 불러온다', () => {
  const retry = bodyOf(panel, 'const retryUnsentComment = async (commentId: string) =>');
  assert.match(retry, /if \(isCommentAlreadySavedError\(err\)\) \{\s*finishCommentSend\(commentId\);\s*invalidateCommentsForKey\(draft\.targetSceneKey\);\s*afterCommentDelivered\(draft\);\s*return;\s*\}/);
  const invalidate = bodyOf(service, 'export function invalidateCommentsForKey(sceneKey: string): void');
  assert.match(invalidate, /invalidatePartCache\(parseSceneKey\(sceneKey\)\.sheetName\);/);
  assert.match(invalidate, /'bflow:comments-invalidated', \{ detail: \{ characterId \} \}/);
  // 미리보기 mock 도 라이브 DB 처럼 같은 id 를 거절한다(중복 댓글이 생기지 않게).
  assert.match(mock, /if \(comments\.some\(\(comment\) => comment\.id === commentId\)\) \{\s*throw new Error\('duplicate key value violates unique constraint "comments_pkey"'\);/);
});

test('보내지 못한 댓글을 버릴 때는 서버에서 같은 id 를 먼저 지우고, 지워졌을 때만 첨부를 정리한다', () => {
  const drop = bodyOf(panel, 'async function dropUnsentComment(');
  const deleteAt = drop.indexOf('await deleteComment(draft.targetSceneKey, draft.comment.id);');
  const cleanupAt = drop.indexOf('cleanupDraftImages(draft.attached, context);');
  assert.ok(deleteAt > 0 && cleanupAt > deleteAt, '서버 삭제 → 첨부 정리 순서');
  const failure = drop.slice(drop.indexOf('} catch (err) {'), cleanupAt);
  assert.match(failure, /return false;/);
  assert.doesNotMatch(failure, /cleanupDraftImages|storageService/, '서버에 닿지 못하면 첨부를 남겨 둔다');
  // 지우기·씬 이동/패널 닫기·남길 자리 없는 실패 — 모두 같은 길
  assert.match(bodyOf(panel, 'const forgetUnsentComments = (context: string) =>'), /if \(entry\.status === 'failed'\) void dropUnsentComment\(entry, context\);/);
  assert.equal([...panel.matchAll(/void dropUnsentComment\(/g)].length, 5);
  // 지우기가 서버에 닿지 못하면 같은 씬에선 '보내지 못했어요' 말풍선을 되돌려 놓고 알린다(낙관적 → 실패 시 롤백).
  const discard = bodyOf(panel, 'const discardUnsentComment = (commentId: string) =>');
  assert.match(discard, /sonnerToast\.error\('댓글을 지우지 못했어요 · 인터넷 연결을 확인해 주세요'\);/);
  assert.match(discard, /if \(!mountedRef\.current \|\| sceneKeyRef\.current !== panelSceneKey\) return;\s*unsentCommentsRef\.current\.set\(commentId, \{ \.\.\.entry, status: 'failed' \}\);\s*setCommentSendStatus\(commentId, 'failed'\);\s*reinsertComment\(entry\.comment\);/);
});

/* ─── 새 반응 칩: 바깥 칸은 움직이지 않음 (acc-comments-notify-3) ─── */

test('새 반응 칩의 바깥 칸은 머무는 값에서 시작 — scale(0)→1 로 자라며 안쪽 톡을 덮지 않는다', () => {
  assert.deepEqual(REACTION_CHIP_START, { opacity: REACTION_CHIP_REST.opacity, transform: REACTION_CHIP_REST.transform });
  assert.equal('transitionEnd' in REACTION_CHIP_START, false, "transitionEnd('none')이 시작 값에 섞이면 scale(0) 에서 출발한다");
  assert.match(panel, /initial=\{REACTION_CHIP_START\} animate=\{REACTION_CHIP_REST\}/);
  assert.doesNotMatch(panel, /className="inline-flex" initial=\{false\} animate=\{REACTION_CHIP_REST\}/);
});

/* ─── 이모지 창: 펼쳐도 왼쪽으로 튀지 않음 (acc-comments-notify-8) ─── */

test('이모지 창: 화면 오른쪽 끝 가까이서 더 보기를 눌러도 왼쪽 끝·아래 끝이 그대로', () => {
  const anchor = { top: 474, bottom: 494, left: 1333, width: 24 };
  const base = { anchor, viewportWidth: 1600, viewportHeight: 900, expandedWidth: 280 };
  const collapsed = emojiPickerPlacement({ ...base, width: 220 });
  const expanded = emojiPickerPlacement({ ...base, width: 280 });
  assert.equal(collapsed.left, expanded.left, '예전엔 1338 → 1312 로 26px 튀었다');
  assert.equal(collapsed.bottom, expanded.bottom);
  assert.ok(expanded.left + 280 <= 1600 - 8, '펼친 창도 화면 안');
  assert.ok(collapsed.left <= anchor.left && collapsed.left + 220 >= anchor.left + anchor.width, '접힌 창도 버튼을 덮는 자리');
  // 버튼이 화면 끝에 바짝 붙으면 접힌 창이 버튼을 벗어나지 않게 — 그때만 펼칠 때 조금 움직인다.
  const edge = emojiPickerPlacement({ anchor: { top: 600, bottom: 620, left: 1570, width: 20 }, viewportWidth: 1600, viewportHeight: 900, width: 220, expandedWidth: 280 });
  assert.ok(edge.left + 220 >= 1590 && edge.left + 220 <= 1592);
  // 화면 가운데에선 그대로 버튼 왼쪽에 맞춘다.
  assert.equal(emojiPickerPlacement({ ...base, anchor: { ...anchor, left: 300 }, width: 220 }).left, 300);
  assert.match(picker, /expandedWidth: EXPANDED_WIDTH,/);
});

/* ─── 리테이크 담당 지정·다시 알림은 종 '딩동' (acc-comments-notify-9) ─── */

test('리테이크: 나를 지정한 새 리테이크·다시 알림은 나를 부른 알림, 담당 완료 같은 자동 알림은 배지만', () => {
  assert.equal(isCallingMeNotification('revision', { revisionAction: 'add' }), true);
  assert.equal(isCallingMeNotification('revision', { revisionAction: 'reminder' }), true);
  for (const revisionAction of ['assignee_done', 'comment', 'status', undefined]) {
    assert.equal(isCallingMeNotification('revision', { revisionAction }), false, String(revisionAction));
  }
  assert.equal(isCallingMeNotification('revision'), false);
  assert.equal(isCallingMeNotification('comment', { revisionAction: 'add' }), false, '리테이크가 아니면 보지 않는다');
  assert.equal(mergeLiveArrival(null, 'revision', 'me', 1, { revisionAction: 'add' }).callsMe, true);
  assert.equal(mergeLiveArrival(null, 'revision', 'me', 1, { revisionAction: 'assignee_done' }).callsMe, false);
});

/* ─── 라이트 모드 대비 (acc-motion-settings-3 · acc-motion-settings-6) ─── */

type Rgb = [number, number, number];
const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: Rgb, b: Rgb) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a: Rgb, b: Rgb, pa: number): Rgb => [0, 1, 2].map((i) => a[i] * pa + b[i] * (1 - pa)) as Rgb;
const triplet = (t: string) => t.split(' ').map(Number) as Rgb;
const WHITE: Rgb = [255, 255, 255];

test('라이트 모드 알림 카드 버튼 글자(되돌리기 등): 모든 기본 테마에서 4.5:1 이상', () => {
  assert.match(css, /\[data-color-mode='light'\] \[data-sonner-toast\] \[data-button\] \{\s*color: color-mix\(in srgb, rgb\(var\(--color-accent\)\) 60%, black\) !important;/);
  for (const preset of THEME_PRESETS) {
    const accent = triplet(getLightColors(preset.id).accent);
    const text = mix(accent, [0, 0, 0], 0.6);
    // 버튼 바탕: 흰 카드 위 강조색 12%
    const bg = mix(accent, WHITE, 0.12);
    assert.ok(contrast(text, bg) >= 4.5, `${preset.id}: ${contrast(text, bg).toFixed(2)}`);
  }
  // 예전 값(보조 보라 #A29BFE)은 약 2:1 이었다.
  assert.ok(contrast([162, 155, 254], mix([108, 92, 231], WHITE, 0.12)) < 2.5);
});

test("라이트 모드 '보내지 못했어요': 4.5:1 이상, 다크 모드는 그대로", () => {
  assert.match(css, /\[data-color-mode='light'\] \.comment-send-failed-label \{\s*color: color-mix\(in srgb, #E17055 62%, rgb\(var\(--color-text-primary\)\)\);/);
  assert.match(panel, /<span className="comment-send-failed-label font-semibold text-status-low">보내지 못했어요<\/span>/);
  const textPrimary = triplet(getLightColors('violet').textPrimary);
  const label = mix([225, 112, 85], textPrimary, 0.62);
  for (const bg of [WHITE, [247, 248, 253] as Rgb, triplet(getLightColors('violet').bgPrimary)]) {
    assert.ok(contrast(label, bg) >= 4.5, `${bg}: ${contrast(label, bg).toFixed(2)}`);
  }
  assert.ok(contrast([225, 112, 85], [247, 248, 253]) < 3.1, '예전 값은 약 3:1');
});
