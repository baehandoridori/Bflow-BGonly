/**
 * 피드백 58 후속(구현 후 리뷰): 댓글 목록 바로 위의 '팀 할 일' 섹션이 커질 때 댓글 목록 스크롤을 어떻게 맞출지 정한다.
 *
 * 섹션은 목록을 늦게 받아 온다(IPC → main → DB). 그 사이 댓글 패널은 이미 맨 아래(최신 댓글)로 스크롤해 둔다.
 * 섹션이 커지면 댓글 목록은 아래쪽에서 그만큼 잘리고 scrollTop 은 그대로라, 최신 댓글이 화면 밖으로 밀린다.
 * - 커지기 전에 맨 아래(여유 8px)를 보고 있었으면 곧바로 다시 맨 아래에 붙인다.
 * - 패널을 막 열어(섹션 마운트 뒤 1초 안) 첫 목록이 들어온 경우엔 패널이 맨 아래로 부드럽게 스크롤하는 중일 수 있다.
 *   이때는 곧바로 끌어내리지 않고('follow') 잠깐 뒤 다시 보아, 목록이 아래로 움직이고 있거나 옛 바닥에 닿아 있을 때만
 *   새 바닥까지 이어 준다. 사용자가 그사이 위로 올렸거나 멈춰 읽고 있으면 건드리지 않는다(코덱스 4·10차).
 *   안 읽은 댓글 구분선이나 알림에서 온 특정 댓글로 이동하는 중이면 그 이동을 방해하지 않는다.
 * - 그 밖(위쪽 댓글을 읽는 중)에는 건드리지 않는다.
 * 런타임 import 가 없어 node --test 에서 바로 불러 쓴다.
 */

export const COMMENT_LIST_BOTTOM_SLACK_PX = 8;
/** 섹션 마운트 뒤 이 시간 안에 첫 목록이 들어와야 '막 연 패널' 로 본다. */
export const COMMENT_LIST_OPENING_WINDOW_MS = 1000;
/** 'follow' 판단 뒤 목록의 움직임을 다시 볼 때까지 기다리는 시간. */
export const COMMENT_LIST_FOLLOW_CHECK_MS = 60;

export interface CommentListGrowInput {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  /** 섹션이 커진 높이(px). 0 이하면 아무것도 하지 않는다. */
  grewBy: number;
  /** 섹션의 첫 목록 조회가 끝난 렌더에서 커졌으면 섹션 마운트부터 걸린 시간(ms), 아니면 null */
  firstLoadAfterMs: number | null;
  /** 안 읽은 댓글 구분선·특정 댓글로 이동하는 중인지 */
  jumpingToComment: boolean;
}

/** 'auto' = 곧바로 맨 아래, 'follow' = 잠깐 뒤 shouldFollowCommentListToBottom 로 다시 보고 이어 주기, null = 건드리지 않음. */
export function commentListScrollAfterSectionGrow(input: CommentListGrowInput): 'auto' | 'follow' | null {
  if (!(input.grewBy > 0)) return null;
  // 섹션이 커진 만큼 목록 높이가 줄었으므로, 커지기 전 바닥까지의 거리 = 지금 거리 - 커진 높이.
  const distanceBeforeGrow = input.scrollHeight - input.clientHeight - input.scrollTop - input.grewBy;
  if (distanceBeforeGrow <= COMMENT_LIST_BOTTOM_SLACK_PX) return 'auto';
  const opening = input.firstLoadAfterMs !== null && input.firstLoadAfterMs <= COMMENT_LIST_OPENING_WINDOW_MS;
  if (opening && !input.jumpingToComment) return 'follow';
  return null;
}

export interface CommentListFollowCheck {
  /** 'follow' 판단 시점의 scrollTop */
  startTop: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  grewBy: number;
}

/** 목록이 아래로 움직였거나(열 때의 부드러운 스크롤이 진행 중) 옛 바닥 근처에 있으면 true. 위로 올렸거나 위쪽에 멈춰 있으면 false. */
export function shouldFollowCommentListToBottom(input: CommentListFollowCheck): boolean {
  const movedDown = input.scrollTop > input.startTop;
  const nearOldBottom = input.scrollHeight - input.clientHeight - input.scrollTop <= input.grewBy + COMMENT_LIST_BOTTOM_SLACK_PX;
  return movedDown || nearOldBottom;
}
