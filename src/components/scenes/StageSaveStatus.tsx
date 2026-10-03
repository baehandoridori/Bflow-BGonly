import { useLayoutEffect, useMemo, useRef } from 'react';
import { useMotionPref } from '@/hooks/useMotionPref';
import { useStageSaveStatusStore, type StageRollbackFlash as StageRollbackFlashState } from '@/stores/useStageSaveStatusStore';
import {
  ROLLBACK_BORDER_KEYFRAMES,
  ROLLBACK_BORDER_MS,
  ROLLBACK_SHAKE_EASE,
  ROLLBACK_SHAKE_KEYFRAMES,
  ROLLBACK_SHAKE_MS,
  flattenPendingCells,
} from './stageSaveFeedback';

const EMPTY_CELLS: ReadonlySet<string> = new Set();

/**
 * 이 씬의 '다시 보내는 중' 칸과 방금 되돌린 칸(움직임 폴리싱 20번). 씬 UUID 가 없으면(옛 시트 모드) 표시 없음.
 * 다른 씬의 저장 상태가 바뀌어도 이 씬 몫이 그대로면 다시 그리지 않는다(같은 객체를 돌려받는다).
 */
export function useStageSaveStatus(sceneUuid: string | null | undefined): {
  pending: ReadonlySet<string>;
  rollback: StageRollbackFlashState | undefined;
} {
  const bySlot = useStageSaveStatusStore((state) => (sceneUuid ? state.retrying[sceneUuid] : undefined));
  const rollback = useStageSaveStatusStore((state) => (sceneUuid ? state.rollbacks[sceneUuid] : undefined));
  const pending = useMemo(() => (bySlot ? new Set(flattenPendingCells(bySlot)) : EMPTY_CELLS), [bySlot]);
  return { pending, rollback };
}

/**
 * 되돌린 칸 표시 — 버튼(칸) 안에 둔다. 나타나는 순간 한 번:
 * - 칸(부모 요소)이 고개를 젓듯 좌우로(translate, 0.24초). 누름의 transform(scale)과 더해진다.
 * - 빨간 테두리 층이 번졌다 사라진다(opacity, 0.9초).
 * 다시 되돌리면 key(at) 를 바꿔 새로 마운트한다(클래스 토글 X).
 * 동작 줄이기: 흔들림 없이 테두리만. 테두리는 WAAPI 라 전역 '동작 줄이기' CSS 가 길이를 0 으로 만들지 않는다.
 */
export function StageRollbackFlash() {
  const { reduce } = useMotionPref();
  const ref = useRef<HTMLSpanElement>(null);
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    const border = el.animate(ROLLBACK_BORDER_KEYFRAMES, { duration: ROLLBACK_BORDER_MS, easing: 'linear' });
    const host = el.parentElement;
    const shake =
      !reduceRef.current && host && typeof host.animate === 'function'
        ? host.animate(ROLLBACK_SHAKE_KEYFRAMES, { duration: ROLLBACK_SHAKE_MS, easing: ROLLBACK_SHAKE_EASE })
        : null;
    return () => {
      border.cancel();
      shake?.cancel();
    };
  }, []);

  return <span ref={ref} aria-hidden="true" className="stage-seg-rollback" />;
}
