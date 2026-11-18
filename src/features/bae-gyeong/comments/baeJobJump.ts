/**
 * 'BAE경 → 그 기록(→ 그 코멘트)'로 가기 — 알림(종 · Windows 알림) · 슬랙 바로가기(bflow://bae/…) · 댓글 링크가 모두 이것을 부른다.
 * 요청은 이 작은 저장소에 남고, BAE경 화면이 열려 있거나 열리면 꺼내 그 기록을 연다(consume). 기록을 볼 수 있는지는 열 때 서버가 다시 정한다.
 * 2단계(phase B): BAE경 화면(BaeGyeongView)이 usePendingBaeJobJump() 로 요청을 꺼내 '기록' 탭의 그 한 건을 연다.
 */
import { create } from 'zustand';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { canAccessBaeGyeong } from '@/features/playground/featureFlag';
import { isBaeCommentId, isBaeCommentJobId } from '@/shared/bae/comments';

export interface BaeJobJumpRequest {
  jobId: string;
  /** 그 기록 스레드에서 강조할 코멘트(없으면 기록만). */
  commentId: string | null;
  /** 같은 기록을 다시 눌러도 다시 열리게. */
  seq: number;
}

interface BaeJobJumpState {
  request: BaeJobJumpRequest | null;
  open(jobId: string, commentId?: string | null): boolean;
  /** 화면이 요청을 꺼낸다(한 번만). seq 가 다르면(그 사이 새 요청) 꺼내지 않는다. */
  consume(seq: number): BaeJobJumpRequest | null;
}

let sequence = 0;

export const useBaeJobJumpStore = create<BaeJobJumpState>((set, get) => ({
  request: null,
  open: (jobId, commentId = null) => {
    if (!isBaeCommentJobId(jobId)) return false;
    set({ request: { jobId, commentId: commentId && isBaeCommentId(commentId) ? commentId : null, seq: ++sequence } });
    return true;
  },
  consume: (seq) => {
    const current = get().request;
    if (!current || current.seq !== seq) return null;
    set({ request: null });
    return current;
  },
}));

/**
 * BAE경 화면으로 가서 그 기록을 연다(뒤로 가기 자리도 남긴다). 작업 번호 모양이 아니거나, BAE경 메뉴가 없는 사람이면
 * 아무 데도 가지 않는다(뒤로 가기 자리도 남기지 않는다 — featureFlag 의 canAccessBaeGyeong, 화면 진입과 같은 문).
 */
export function openBaeJobInApp(jobId: string, commentId?: string | null): boolean {
  if (!isBaeCommentJobId(jobId) || !canAccessBaeGyeong(useAuthStore.getState().currentUser)) return false;
  if (!useBaeJobJumpStore.getState().open(jobId, commentId ?? null)) return false;
  const app = useAppStore.getState();
  app.pushNavigationBackTarget();
  app.setView('bae-gyeong');
  return true;
}

/** BAE경 화면이 쓰는 고리: 남은 요청(없으면 null). 꺼낼 때는 consume(request.seq). */
export function usePendingBaeJobJump(): BaeJobJumpRequest | null {
  return useBaeJobJumpStore((s) => s.request);
}
