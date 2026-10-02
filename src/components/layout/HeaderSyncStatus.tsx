import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import { useMotionPref } from '@/hooks/useMotionPref';
import { animateEl } from '@/utils/motion';
import { cn } from '@/utils/cn';
import {
  CHECK_BREATH_KEYFRAMES,
  CHECK_BREATH_TIMING,
  CHECK_POP_KEYFRAMES,
  CHECK_POP_TIMING,
  SPIN_KEYFRAMES,
  SPIN_PERIOD_MS,
  angleFromTransform,
  planSpinStop,
  resolveSyncLabel,
  syncKindChange,
} from './headerSyncMotion';

/**
 * 헤더 오른쪽 '최신 상태' 칸 + 새로고침 버튼 (움직임 폴리싱 3번 header-sync-quiet).
 * 규칙은 headerSyncMotion.ts 머리말 참고. 회전·숨쉬기·'톡'은 모두 WAAPI(합성 스레드) —
 * 클래스를 넣었다 빼지 않아 멈출 때 0° 로 튀지 않는다. WAAPI 는 전역 '동작 줄이기' CSS 가 막지 못하므로
 * useMotionPref 로 직접 분기한다(줄이기: 회전·숨쉬기·톡 없이 문구만 바뀐다).
 */
export function HeaderSyncStatus({ onRefresh }: { onRefresh: () => void }) {
  const isSyncing = useDataStore((s) => s.isSyncing);
  const syncKind = useDataStore((s) => s.syncKind);
  const lastSyncTime = useDataStore((s) => s.lastSyncTime);
  const { reduce } = useMotionPref();

  const iconRef = useRef<SVGSVGElement>(null);
  const checkRef = useRef<SVGSVGElement>(null);
  const spinRef = useRef<Animation | null>(null);
  // null 에서 출발 — 직접 새로고침 도중에 헤더가 다시 붙어도(몰입 화면에서 돌아올 때) 아이콘이 돈다.
  const prevKindRef = useRef<typeof syncKind>(null);
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  const lastSyncRef = useRef(lastSyncTime);
  lastSyncRef.current = lastSyncTime;
  // 아이콘이 돌거나 멈추는 중 — 멈춤이 끝나야 '최신 상태'로 바뀌며 체크가 '톡' 나타난다.
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    const prev = prevKindRef.current;
    prevKindRef.current = syncKind;
    const change = syncKindChange(prev, syncKind);

    if (change.spin === 'start') {
      const el = iconRef.current;
      if (reduceRef.current || !el || typeof el.animate !== 'function') return;
      // 멈추는 중에 다시 눌렸으면 그 각도에서 이어 돈다.
      const previous = spinRef.current;
      const angle = previous ? angleFromTransform(getComputedStyle(el).transform) : 0;
      if (previous) {
        previous.onfinish = null;
        previous.cancel();
      }
      spinRef.current = el.animate(SPIN_KEYFRAMES, {
        duration: SPIN_PERIOD_MS,
        iterations: Infinity,
        easing: 'linear',
        iterationStart: angle / 360,
      });
      setSpinning(true);
      return;
    }

    if (change.spin === 'stop') {
      const el = iconRef.current;
      const running = spinRef.current;
      if (!running) return;
      if (!el || reduceRef.current) {
        running.cancel();
        spinRef.current = null;
        setSpinning(false);
        return;
      }
      // 돌던 바퀴를 마저 돌며 감속 → 0°(360 의 배수)에서 멈추니 transform 이 비어도 튀지 않는다.
      const plan = planSpinStop(angleFromTransform(getComputedStyle(el).transform));
      running.cancel();
      const stop = el.animate(
        [{ transform: `rotate(${plan.fromDeg}deg)` }, { transform: `rotate(${plan.toDeg}deg)` }],
        { duration: plan.durationMs, easing: plan.easing },
      );
      spinRef.current = stop;
      stop.onfinish = () => {
        if (spinRef.current !== stop) return;
        spinRef.current = null;
        setSpinning(false);
        animateEl(checkRef.current, CHECK_POP_KEYFRAMES, CHECK_POP_TIMING, reduceRef.current);
      };
      return;
    }

    // 자동 받아오기: 문구·버튼은 그대로, 체크만 한 번 숨쉬기. 15초마다 반복되는 장식이라 '동작 줄이기'면 생략.
    if (change.breathe && !spinRef.current && !reduceRef.current && lastSyncRef.current !== null) {
      animateEl(checkRef.current, CHECK_BREATH_KEYFRAMES, CHECK_BREATH_TIMING, false);
    }
  }, [syncKind]);

  useEffect(() => () => {
    const running = spinRef.current;
    spinRef.current = null;
    if (running) {
      running.onfinish = null;
      running.cancel();
    }
  }, []);

  const label = resolveSyncLabel({ isSyncing, syncKind, lastSyncTime, spinning });
  const busy = label === 'syncing';
  const manualBusy = syncKind === 'manual' || spinning;

  const lastSyncLabel = lastSyncTime
    ? `마지막 동기화: ${new Date(lastSyncTime).toLocaleTimeString('ko-KR')}`
    : '동기화 대기 중';

  return (
    <>
      {/* 동기화 상태 — 두 문구를 한 칸에 겹쳐 opacity 로 교차. 칸 폭이 고정돼 왼쪽 연결 아이콘이 밀리지 않는다. */}
      <div
        className="mr-1 grid min-w-[78px] whitespace-nowrap text-xs text-text-secondary"
        title={lastSyncLabel}
        data-sync-label={label}
      >
        <span
          aria-hidden={!busy}
          className={cn(
            'col-start-1 row-start-1 flex items-center justify-end gap-1.5 transition-opacity duration-[160ms]',
            busy ? 'opacity-100' : 'opacity-0',
          )}
        >
          <span className="h-2 w-2 rounded-full bg-accent" />
          동기화 중...
        </span>
        <span
          aria-hidden={busy}
          className={cn(
            'col-start-1 row-start-1 flex items-center justify-end gap-1.5 transition-opacity duration-[160ms]',
            busy ? 'opacity-0' : 'opacity-100',
          )}
        >
          <CheckCircle2 ref={checkRef} size={14} className="text-emerald-500" />
          최신 상태
        </span>
      </div>

      {/* 새로고침 — 눌림 반응은 버튼, 회전은 안쪽 아이콘만(한 요소에 둘을 겹치지 않는다).
          자동 받아오는 중에 눌러도 무시하지 않고 끝난 뒤 한 번 더 받아온다. */}
      <button
        type="button"
        onClick={() => onRefresh()}
        title="데이터 새로고침"
        aria-busy={manualBusy}
        className={cn(
          'bf-press p-2 rounded-lg hover:bg-bg-border/50',
          manualBusy ? 'text-accent' : 'text-text-secondary hover:text-text-primary',
        )}
      >
        <RefreshCw ref={iconRef} size={18} data-sync-spinner="" />
      </button>
    </>
  );
}
