/**
 * 전체 데이터 다시 받아오기(loadData) 요청을 '자동'과 '직접(새로고침 버튼·단축키)'으로 나눠 조율한다.
 * (움직임 폴리싱 3번 header-sync-quiet)
 *
 * - 자동(15초 폴링·실시간 구조 변경·재연결): 예전처럼 바로 실행한다. 겹쳐도 막지 않는다
 *   (구조 변경 직후의 재로드를 앞선 폴링이 삼키면 최신 내용을 놓친다).
 * - 직접: 아무것도 돌고 있지 않으면 바로 실행. 자동이 도는 중이면 무시하지 않고 예약해 두었다가
 *   돌던 것이 모두 끝난 뒤 한 번 더 받아온다. 직접 받아오기가 이미 돌거나 예약돼 있으면 더 쌓지 않는다.
 * - 상태는 겹친 실행 수로 센다 — 먼저 끝난 실행이 '동기화 끝'을 알려 버리던 문제도 함께 막는다.
 *
 * node --test 가 그대로 import 하도록 런타임 의존이 없다.
 */

export type SyncKind = 'auto' | 'manual';

export interface SyncQueueState {
  /** 무엇이든 받아오는 중이거나 직접 받아오기가 예약돼 있다. */
  syncing: boolean;
  /** 직접 받아오기가 돌거나 예약돼 있으면 'manual', 자동만 돌면 'auto', 쉬면 null. */
  kind: SyncKind | null;
}

export interface SyncQueue {
  request(kind?: SyncKind): Promise<void>;
  getState(): SyncQueueState;
}

export function createSyncQueue(
  run: (kind: SyncKind) => Promise<void> | void,
  onState: (state: SyncQueueState) => void,
): SyncQueue {
  let running = 0;
  let manualRunning: Promise<void> | null = null;
  let pendingManual: Promise<void> | null = null;
  let releasePending: (() => void) | null = null;
  let last: SyncQueueState = { syncing: false, kind: null };

  const snapshot = (): SyncQueueState => ({
    syncing: running > 0 || pendingManual !== null,
    kind: manualRunning || pendingManual ? 'manual' : running > 0 ? 'auto' : null,
  });

  const emit = () => {
    const next = snapshot();
    if (next.syncing === last.syncing && next.kind === last.kind) return;
    last = next;
    onState(next);
  };

  const start = (kind: SyncKind): Promise<void> => {
    running += 1;
    let job: Promise<void>;
    try {
      job = Promise.resolve(run(kind));
    } catch (error) {
      job = Promise.reject(error);
    }
    const done = job
      .catch(() => { /* 실패 표시는 run 이 맡는다 — 큐는 멈추지 않는다 */ })
      .then(() => {
        running -= 1;
        if (kind === 'manual') manualRunning = null;
        if (running === 0 && releasePending) {
          // 예약된 직접 받아오기를 이어서 시작한다. 상태는 'manual' 그대로라 아이콘이 끊기지 않는다.
          const release = releasePending;
          releasePending = null;
          release();
          return;
        }
        emit();
      });
    if (kind === 'manual') manualRunning = done;
    emit();
    return done;
  };

  return {
    request(kind: SyncKind = 'auto') {
      // 'manual' 이 아닌 값(이벤트 객체가 잘못 넘어온 경우 포함)은 모두 자동으로 다룬다.
      if (kind !== 'manual') return start('auto');
      if (pendingManual) return pendingManual;
      if (manualRunning) return manualRunning;
      if (running === 0) return start('manual');
      pendingManual = new Promise<void>((resolve) => {
        releasePending = () => {
          const next = start('manual');
          pendingManual = null;
          void next.then(resolve);
        };
      });
      emit();
      return pendingManual;
    },
    getState: snapshot,
  };
}
