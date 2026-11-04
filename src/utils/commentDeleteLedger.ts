/**
 * 지운 댓글 장부 — 휴지통을 누른 댓글이 '되돌리기 기다림(waiting) → 서버에서 지우는 중(deleting) → 끝' 으로
 * 한 길로만 가게 한다(움직임 폴리싱 20번 규칙, 씬 댓글 B안 §8 에서 패널 밖으로 뺌 — v1.146.1).
 *
 *  - 같은 댓글을 두 번 지우지 않는다(이미 장부에 있으면 begin 이 false).
 *  - 되돌리기는 기다리는 동안만(서버로 보낸 뒤에는 되돌리지 않는다).
 *  - 확정은 한 번만(5초 만료·창 숨김·씬 이동이 겹쳐도 서버 삭제는 한 번).
 *  - 장부에 있는 동안은 다시 불러온 목록에서도 뺀다(has) — 실시간 재조회로 되살아나지 않게.
 * 말풍선 움직임(밀려남·미끄러짐)은 패널이 맡는다. node --test 로 바로 검사한다.
 */

export interface CommentDeleteEntryBase {
  phase: 'waiting' | 'deleting';
  undoWindow: { expire(): void } | null;
}

export interface CommentDeleteLedger<E extends CommentDeleteEntryBase> {
  has(commentId: string): boolean;
  get(commentId: string): E | undefined;
  values(): E[];
  /** 지우기 시작 — 이미 장부에 있으면 false(두 번 누름). */
  begin(commentId: string, entry: E): boolean;
  /** '되돌리기' — 기다리는 중이면 장부에서 빼고 돌려준다. 이미 서버로 보냈으면 null. */
  takeForUndo(commentId: string): E | null;
  /** 확정 — 기다리는 중이면 '지우는 중'으로 바꾸고 돌려준다. 이미 보냈으면 null(서버 삭제는 한 번). */
  beginCommit(commentId: string): E | null;
  /** 서버 삭제가 끝났다(성공·실패 모두) — 장부에서 뺀다. */
  finish(commentId: string): void;
  /** 기다리는 것을 모두 지금 확정(창 숨김·앱 종료) — 각자의 되돌리기 창을 만료시킨다. */
  expireAll(): void;
}

export function createCommentDeleteLedger<E extends CommentDeleteEntryBase>(): CommentDeleteLedger<E> {
  const entries = new Map<string, E>();
  return {
    has: (commentId) => entries.has(commentId),
    get: (commentId) => entries.get(commentId),
    values: () => [...entries.values()],
    begin(commentId, entry) {
      if (entries.has(commentId)) return false;
      entries.set(commentId, entry);
      return true;
    },
    takeForUndo(commentId) {
      const entry = entries.get(commentId);
      if (!entry || entry.phase !== 'waiting') return null;
      entries.delete(commentId);
      return entry;
    },
    beginCommit(commentId) {
      const entry = entries.get(commentId);
      if (!entry || entry.phase !== 'waiting') return null;
      entry.phase = 'deleting';
      return entry;
    },
    finish(commentId) {
      entries.delete(commentId);
    },
    expireAll() {
      for (const entry of [...entries.values()]) entry.undoWindow?.expire();
    },
  };
}
