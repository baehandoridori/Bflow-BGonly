/* ═══════════════════════════════════════════════════════════════
   저장의 로그인 세션 시기 (움직임 폴리싱 20번 safety-net — 코덱스 2차 지적 4172094259)

   자동 재전송은 저장을 앱 전역에 최대 60초 붙들고 있다. 그 사이 로그아웃하고 다른 사람이 로그인하면
   앞 사람의 클릭 값·작성자 id 가 다음 사람 세션 중에 서버로 나갈 수 있다. 그래서 저장은 클릭한 순간의 세션을
   붙잡아 두고(capture), 요청을 보내기 직전마다 그 세션이 아직 지금 세션인지 확인한다(assertCurrent).
   세션이 바뀌면(end) 앞서 붙잡은 세션은 모두 지난 것이 되어, 그 저장은 아무것도 더 보내지 않는다.

   node --test 가 그대로 import 하도록 런타임 의존이 없다.
   ═══════════════════════════════════════════════════════════════ */

/** 로그인 세션이 바뀌어 저장 요청을 보내지 않았다. 재전송 진행기는 이 실패로 되돌리거나 알리지 않는다(cancelAll 로 이미 그만둠). */
export class SaveSessionEndedError extends Error {
  constructor() {
    super('로그인 세션이 바뀌어 저장을 보내지 않았어요');
    this.name = 'SaveSessionEndedError';
  }
}

export interface SaveSession {
  /** 이 저장을 시작한 로그인 세션이 아직 지금 세션인가. */
  isCurrent(): boolean;
  /** 세션이 바뀌었으면 던진다(SaveSessionEndedError) — 저장 요청을 보내기 직전마다 부른다. */
  assertCurrent(): void;
}

export interface SaveSessionTracker {
  /** 지금 로그인 세션을 붙잡는다(저장을 시작한 순간에 부른다). */
  capture(): SaveSession;
  /** 로그인 세션이 바뀌었다 — 앞서 붙잡은 세션은 모두 지난 것이 된다. */
  end(): void;
}

export function createSaveSessionTracker(): SaveSessionTracker {
  let generation = 0;
  return {
    capture() {
      const mine = generation;
      const isCurrent = () => mine === generation;
      return {
        isCurrent,
        assertCurrent() {
          if (!isCurrent()) throw new SaveSessionEndedError();
        },
      };
    },
    end() {
      generation += 1;
    },
  };
}

/**
 * 로그인 사용자가 바뀌었는가 — 로그아웃(사람 → 없음)·로그인(없음 → 사람)·다른 사람으로 바뀜.
 * 같은 사람의 정보만 새로 받은 것(이름·권한·비밀번호 변경 표시)은 바뀐 것이 아니다.
 */
export function saveSessionUserChanged(previousUserId: string | null | undefined, nextUserId: string | null | undefined): boolean {
  return (previousUserId ?? null) !== (nextUserId ?? null);
}
