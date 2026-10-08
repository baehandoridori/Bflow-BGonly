// 휴가 등록·취소 직후 '낙관 가드'와 가드 뒤 다시 읽기 예약.
// node --test 가 직접 import 하는 모듈: @/ alias·외부 의존 금지.
//
// 휴가 탭·프로필의 '나의 휴가'는 등록·취소 직후 30초 동안 서버에서 읽은 값을 버린다(아직 옛 값일 수 있어
// 방금 바꾼 화면이 되돌아가 보이지 않게). 그런데 버리고 끝이라, 그 30초 안에 슬랙 등에서 온 휴가 변경
// 신호로 다시 읽은 결과도 함께 사라졌고 다음 5분 캐시가 끝날 때까지 화면이 늦었다.
// 이제 가드 때문에 버렸으면 가드가 끝난 직후 한 번 다시 읽도록 예약한다.

/** 등록·취소 직후 서버 값을 버리는 시간 */
export const VACATION_MUTATION_GUARD_MS = 30_000;
/** 가드가 확실히 끝난 뒤에 읽도록 더 기다리는 여유 */
export const VACATION_GUARD_RETRY_MARGIN_MS = 250;

/** mutationAt(마지막 등록·취소 시각, 없으면 0) 기준으로 지금 가드 중인지 */
export function isVacationMutationGuardActive(mutationAt: number, now: number): boolean {
  return now - mutationAt <= VACATION_MUTATION_GUARD_MS;
}

/** 가드 중이면 가드가 끝난 직후까지 남은 ms(여유 포함), 아니면 null */
export function vacationGuardRetryDelayMs(mutationAt: number, now: number): number | null {
  if (!isVacationMutationGuardActive(mutationAt, now)) return null;
  return VACATION_MUTATION_GUARD_MS - (now - mutationAt) + VACATION_GUARD_RETRY_MARGIN_MS;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface VacationGuardTimers {
  setTimeout: (run: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
}

export interface VacationGuardRetry {
  /**
   * 서버 결과를 적용해도 되는지 판단한다.
   * - 가드 중이면 가드가 끝난 직후 retry 를 **한 번** 예약하고 true(=이번 결과는 버려라).
   *   이미 예약이 있으면 새 가드 끝에 맞춰 다시 잡는다(예약은 늘 하나).
   * - 가드가 끝났으면 남은 예약을 지우고 false(=적용하라).
   * - dispose() 뒤에는 판정만 같고 예약은 잡지 않는다.
   */
  deferIfGuarded(mutationAt: number, now: number, retry: () => void): boolean;
  /** 남은 예약을 지운다 */
  cancel(): void;
  /**
   * 화면이 붙었다(마운트). 처음부터 붙은 상태로 만들어지므로, StrictMode 가 effect 를
   * 한 번 떼었다(dispose) 다시 붙일 때 예약을 다시 받게 하려고 부른다.
   */
  activate(): void;
  /**
   * 화면이 떨어졌다(언마운트). 남은 예약을 지우고, 그 뒤에 들어오는 deferIfGuarded 는
   * 판정(버릴지·적용할지)만 돌려주고 **새 예약을 잡지 않는다**.
   * cancel() 만으로는 언마운트 뒤에 끝난 로드(취소 8초 뒤 재조회·변경 신호 재조회 등)가
   * 새 타이머를 잡아, 떨어진 화면에서 한 번 더 서버를 읽었다.
   */
  dispose(): void;
}

const defaultTimers: VacationGuardTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export function createVacationGuardRetry(timers: VacationGuardTimers = defaultTimers): VacationGuardRetry {
  let pending: TimerHandle | null = null;
  let active = true;

  const cancel = () => {
    if (pending !== null) {
      timers.clearTimeout(pending);
      pending = null;
    }
  };

  return {
    deferIfGuarded(mutationAt, now, retry) {
      const delay = vacationGuardRetryDelayMs(mutationAt, now);
      cancel();
      if (delay === null) return false;
      // 떨어진 화면: 이번 결과는 버리되 다시 읽기는 예약하지 않는다
      if (!active) return true;
      pending = timers.setTimeout(() => {
        pending = null;
        retry();
      }, delay);
      return true;
    },
    cancel,
    activate() {
      active = true;
    },
    dispose() {
      active = false;
      cancel();
    },
  };
}
