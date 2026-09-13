/**
 * 피드백 58 후속(구현 후 리뷰): 팀 할 일 섹션이 커질 때 댓글 목록 스크롤 보정 판단(src/utils/commentListAnchor.ts).
 * 섹션이 목록을 늦게 받아 커지면 바로 아래 댓글 목록이 아래에서 잘려 최신 댓글이 가려지던 회귀를 막는다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMENT_LIST_BOTTOM_SLACK_PX, COMMENT_LIST_FOLLOW_CHECK_MS, COMMENT_LIST_OPENING_WINDOW_MS, commentListScrollAfterSectionGrow, shouldFollowCommentListToBottom } from '../src/utils/commentListAnchor.ts';

// 미리보기 재현 수치: 댓글 내용 1285px, 할 일 6개가 늦게 들어와 섹션이 192px 커지며 목록 높이가 552 → 360 으로 줄었다.
const grown = { scrollHeight: 1285, clientHeight: 360, grewBy: 192 };
const BOTTOM_BEFORE_GROW = 1285 - 552; // 커지기 전 맨 아래 scrollTop

test('맨 아래를 보던 중 섹션이 커지면 곧바로 다시 맨 아래에 붙인다', () => {
  assert.equal(COMMENT_LIST_BOTTOM_SLACK_PX, 8);
  assert.equal(commentListScrollAfterSectionGrow({ ...grown, scrollTop: BOTTOM_BEFORE_GROW, firstLoadAfterMs: null, jumpingToComment: false }), 'auto');
  assert.equal(commentListScrollAfterSectionGrow({ ...grown, scrollTop: BOTTOM_BEFORE_GROW - COMMENT_LIST_BOTTOM_SLACK_PX, firstLoadAfterMs: null, jumpingToComment: false }), 'auto');
  // 이미 바닥이던 화면은 댓글 이동 중이어도 바닥을 유지한다
  assert.equal(commentListScrollAfterSectionGrow({ ...grown, scrollTop: BOTTOM_BEFORE_GROW, firstLoadAfterMs: 200, jumpingToComment: true }), 'auto');
});

test('위쪽 댓글을 읽는 중이면 건드리지 않는다', () => {
  assert.equal(commentListScrollAfterSectionGrow({ ...grown, scrollTop: 0, firstLoadAfterMs: null, jumpingToComment: false }), null);
  assert.equal(commentListScrollAfterSectionGrow({ ...grown, scrollTop: BOTTOM_BEFORE_GROW - COMMENT_LIST_BOTTOM_SLACK_PX - 1, firstLoadAfterMs: null, jumpingToComment: false }), null);
});

test('패널을 막 열어 첫 목록이 들어오면 맨 아래로 가는 부드러운 스크롤을 다시 건다 — 안 읽은 댓글·특정 댓글로 이동 중이면 제외', () => {
  assert.equal(commentListScrollAfterSectionGrow({ ...grown, scrollTop: 120, firstLoadAfterMs: 200, jumpingToComment: false }), 'follow');
  assert.equal(commentListScrollAfterSectionGrow({ ...grown, scrollTop: 120, firstLoadAfterMs: 200, jumpingToComment: true }), null);
});

test('줄었거나 그대로거나 값이 이상하면 아무것도 하지 않는다', () => {
  for (const grewBy of [0, -37, Number.NaN]) {
    assert.equal(commentListScrollAfterSectionGrow({ scrollHeight: 1285, clientHeight: 552, scrollTop: BOTTOM_BEFORE_GROW, grewBy, firstLoadAfterMs: 200, jumpingToComment: false }), null);
  }
});

test('판단 파일은 런타임 import 가 없다 (node --test 가 직접 불러 쓴다)', () => {
  const src = readFileSync('src/utils/commentListAnchor.ts', 'utf8');
  assert.doesNotMatch(src, /^import /m);
});

test('첫 목록이 늦게(1초 넘게) 오면 막 연 패널로 보지 않는다 — 그사이 위로 올려 읽던 사람을 끌어내리지 않는다 (코덱스 4차)', () => {
  assert.equal(COMMENT_LIST_OPENING_WINDOW_MS, 1000);
  assert.equal(commentListScrollAfterSectionGrow({ ...grown, scrollTop: 120, firstLoadAfterMs: COMMENT_LIST_OPENING_WINDOW_MS, jumpingToComment: false }), 'follow');
  assert.equal(commentListScrollAfterSectionGrow({ ...grown, scrollTop: 120, firstLoadAfterMs: COMMENT_LIST_OPENING_WINDOW_MS + 1, jumpingToComment: false }), null);
  // 늦게 왔어도 바닥을 보고 있었다면 바닥 유지
  assert.equal(commentListScrollAfterSectionGrow({ ...grown, scrollTop: BOTTOM_BEFORE_GROW, firstLoadAfterMs: 5000, jumpingToComment: false }), 'auto');
});

// ── 코덱스 10차: 'follow' 는 목록이 실제로 바닥 쪽으로 가는 중일 때만 이어 준다 ──
test('follow 확인: 아래로 움직이는 중이거나 옛 바닥 근처면 이어 주고, 위로 올렸거나 위쪽에 멈춰 있으면 두 번째로 끌어내리지 않는다', () => {
  assert.equal(COMMENT_LIST_FOLLOW_CHECK_MS, 60);
  const base = { scrollHeight: 1285, clientHeight: 360, grewBy: 192 };
  // 열 때의 부드러운 스크롤이 진행 중: 120 → 400 으로 내려가는 중
  assert.equal(shouldFollowCommentListToBottom({ ...base, startTop: 120, scrollTop: 400 }), true);
  // 부드러운 스크롤이 옛 바닥(1285-552=733)에 막 멈춤: 지금 기준 바닥 거리 192 ≤ 192+8
  assert.equal(shouldFollowCommentListToBottom({ ...base, startTop: 733, scrollTop: 733 }), true);
  // 사용자가 위로 올리는 중
  assert.equal(shouldFollowCommentListToBottom({ ...base, startTop: 400, scrollTop: 250 }), false);
  // 위쪽에 멈춰 읽는 중
  assert.equal(shouldFollowCommentListToBottom({ ...base, startTop: 120, scrollTop: 120 }), false);
});
