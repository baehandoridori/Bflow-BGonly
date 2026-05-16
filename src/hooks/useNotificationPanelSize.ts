import { useCallback, useEffect, useRef, useState } from 'react';
import { loadPreferences, savePreferences, type UserPreferences } from '@/services/settingsService';

const DEFAULT_WIDTH = 340;
const DEFAULT_HEIGHT = 440;
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 800;

interface UseNotificationPanelSizeResult {
  /** 현재 적용 너비 (px) */
  width: number;
  /** 현재 적용 높이 (px) */
  height: number;
  /** 영구 저장 — drag 종료 시 1회만 호출. null 이면 기본값 복귀. */
  commit: (size: { width?: number | null; height?: number | null }) => Promise<void>;
  /** 사용자 조정값 사용 중인지 (UI hint). */
  isUserOverride: boolean;
}

/**
 * v1.27.0: 알림 패널 너비·높이 — preferences 에 저장. 댓글 패널 훅과 비슷한 패턴.
 */
export function useNotificationPanelSize(): UseNotificationPanelSizeResult {
  const [savedWidth, setSavedWidth] = useState<number | null>(null);
  const [savedHeight, setSavedHeight] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((prefs) => {
      if (cancelled) return;
      const w = prefs?.notificationPanelWidthPx;
      const h = prefs?.notificationPanelHeightPx;
      if (typeof w === 'number' && Number.isFinite(w) && w >= MIN_WIDTH && w <= MAX_WIDTH) {
        setSavedWidth(w);
      }
      if (typeof h === 'number' && Number.isFinite(h) && h >= MIN_HEIGHT && h <= MAX_HEIGHT) {
        setSavedHeight(h);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const commit = useCallback(
    async (size: { width?: number | null; height?: number | null }) => {
      // v1.27.0 코덱스 2차 P2 fix: width-only / height-only 드래그 시 반대 축이
      // 디스크에서 지워지는 race 방지. preferences async load 가 끝나기 전 (savedHeight===null)
      // width-only commit 호출하면 nextH 가 null 로 평가돼 notificationPanelHeightPx 가 wipe 됨.
      //
      // 정책: 'undefined' = 건드리지 말것, 'null' = reset (delete), number = 저장.
      // → 호출자가 명시한 축만 갱신.
      const clampW =
        size.width === undefined
          ? undefined
          : size.width === null
            ? null
            : Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, size.width));
      const clampH =
        size.height === undefined
          ? undefined
          : size.height === null
            ? null
            : Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, size.height));

      // local state — undefined 면 그대로, null 이면 reset, number 면 update.
      if (clampW !== undefined) setSavedWidth(clampW);
      if (clampH !== undefined) setSavedHeight(clampH);

      // disk — prefs 의 반대 축은 그대로 보존.
      const prefs = (await loadPreferences()) ?? {};
      const merged: UserPreferences = { ...prefs };
      if (clampW === null) delete merged.notificationPanelWidthPx;
      else if (clampW !== undefined) merged.notificationPanelWidthPx = clampW;
      if (clampH === null) delete merged.notificationPanelHeightPx;
      else if (clampH !== undefined) merged.notificationPanelHeightPx = clampH;
      await savePreferences(merged);
    },
    [],
  );

  return {
    width: savedWidth ?? DEFAULT_WIDTH,
    height: savedHeight ?? DEFAULT_HEIGHT,
    commit,
    isUserOverride: savedWidth != null || savedHeight != null,
  };
}

/**
 * 알림 패널의 8방향 리사이저 헬퍼 — 좌측(너비↑), 하단(높이↑), 좌하단 코너(둘 다).
 * 댓글 패널은 좌측 1방향만 쓰지만 알림 패널은 dropdown 이라 2방향 + 코너 필요.
 *
 * NotificationPanel 은 right-anchored 라 너비 증가 = 좌측으로 늘어남 (handle 좌측에 위치).
 * mousedown 에서 시작 좌표 + 시작 크기 캡처, mousemove 에서 live 너비/높이 즉시 갱신,
 * mouseup 에서 commit 1회.
 */
type Axis = 'w' | 's' | 'sw';

export function useNotificationPanelResizer(opts: {
  liveSetSize: (size: { width?: number; height?: number }) => void;
  commitSize: (size: { width?: number; height?: number }) => void;
}) {
  const { liveSetSize, commitSize } = opts;
  const dragStateRef = useRef<{
    axis: Axis;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);
  const moveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const upRef = useRef<((e: MouseEvent) => void) | null>(null);

  const startDrag = useCallback(
    (axis: Axis, e: React.MouseEvent, currentW: number, currentH: number) => {
      e.preventDefault();
      dragStateRef.current = {
        axis,
        startX: e.clientX,
        startY: e.clientY,
        startW: currentW,
        startH: currentH,
      };
      document.body.style.cursor = axis === 'w' ? 'w-resize' : axis === 's' ? 's-resize' : 'sw-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        const s = dragStateRef.current;
        if (!s) return;
        const next: { width?: number; height?: number } = {};
        if (s.axis === 'w' || s.axis === 'sw') {
          // 좌측 핸들 — 왼쪽으로 끌면 너비 증가.
          const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, s.startW - (ev.clientX - s.startX)));
          next.width = w;
        }
        if (s.axis === 's' || s.axis === 'sw') {
          // 하단 핸들 — 아래로 끌면 높이 증가.
          const h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, s.startH + (ev.clientY - s.startY)));
          next.height = h;
        }
        liveSetSize(next);
      };
      const onUp = (ev: MouseEvent) => {
        const s = dragStateRef.current;
        dragStateRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (moveRef.current) window.removeEventListener('mousemove', moveRef.current);
        if (upRef.current) window.removeEventListener('mouseup', upRef.current);
        moveRef.current = null;
        upRef.current = null;
        if (!s) return;
        const final: { width?: number; height?: number } = {};
        if (s.axis === 'w' || s.axis === 'sw') {
          final.width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, s.startW - (ev.clientX - s.startX)));
        }
        if (s.axis === 's' || s.axis === 'sw') {
          final.height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, s.startH + (ev.clientY - s.startY)));
        }
        commitSize(final);
      };
      moveRef.current = onMove;
      upRef.current = onUp;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [liveSetSize, commitSize],
  );

  useEffect(() => {
    return () => {
      if (moveRef.current) window.removeEventListener('mousemove', moveRef.current);
      if (upRef.current) window.removeEventListener('mouseup', upRef.current);
      moveRef.current = null;
      upRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragStateRef.current = null;
    };
  }, []);

  return { startDrag };
}
