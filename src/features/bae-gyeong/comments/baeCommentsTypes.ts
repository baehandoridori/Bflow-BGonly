// BAE경 9단계 코멘트 — 화면이 쓰는 통로의 모양. 앱은 preload 의 window.baeCommentsAPI(메인 → bae_gyeong_session_comment_*),
// 테스트 모드는 previewBaeComments.ts. 값 import 가 없다(node --test 가 바로 읽는다).
import type {
  BaeCommentAddResult, BaeCommentDeleteResult, BaeCommentDraft, BaeCommentEditResult, BaeCommentReaction, BaeCommentThread,
} from '../../../shared/bae/comments.ts';

export interface BaeCommentsGateway {
  /** 기록 한 건의 스레드(만든 사람 · 검수자만 — 아니면 서버가 거절). */
  list(jobId: string): Promise<BaeCommentThread>;
  add(jobId: string, draft: BaeCommentDraft): Promise<BaeCommentAddResult>;
  /** images 가 null 이면 그림은 그대로. */
  edit(commentId: string, text: string, mentions: string[], images: string[] | null): Promise<BaeCommentEditResult>;
  remove(commentId: string): Promise<BaeCommentDeleteResult>;
  react(commentId: string, emoji: string, on: boolean): Promise<BaeCommentReaction[]>;
  reactions(commentIds: string[]): Promise<Record<string, BaeCommentReaction[]>>;
  /** 어느 기록이든 코멘트가 바뀌었다(내용 없음) — 열린 칸이 다시 읽는다. 끊는 함수를 돌려준다. */
  onChanged(callback: () => void): () => void;
}
