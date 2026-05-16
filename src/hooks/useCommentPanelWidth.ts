import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadPreferences, savePreferences } from '@/services/settingsService';

/**
 * v1.27.0: 댓글 패널 너비 계산 (자동 모드).
 * - clamp(320, viewport*0.26, 480) 을 base 로 함
 * - 댓글 갯수에 따라 boost: 6~15건 → +40, 16건+ → +80
 * - 자동 모드 상한은 600px. (사용자 드래그는 720까지 허용 — useCommentPanelWidth.setWidth 참조)
 *
 * 순수 함수라 React 없이도 단위 테스트 가능.
 */
export function computeAutoCommentPanelWidth(viewportW: number, commentCount: number): number {
  const base = Math.max(320, Math.min(480, viewportW * 0.26));
  const boost = commentCount > 15 ? 80 : commentCount > 5 ? 40 : 0;
  return Math.min(600, base + boost);
}

/** 화면 너비 변화 추적용 — 윈도우 리사이즈 시 컴포넌트 재렌더. */
function useViewportWidth(): number {
  const [w, setW] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

interface UseCommentPanelWidthResult {
  /** 현재 적용해야 할 패널 너비 (px). 자동 모드 또는 사용자 저장 값. */
  width: number;
  /**
   * 드래그 종료(mouseup) 시 호출. px=null 이면 자동 모드로 복귀 (preferences 의 commentPanelWidthPx 제거).
   * mousemove 마다 호출하지 말 것 — 디스크 I/O 폭주 위험.
   */
  setWidth: (px: number | null) => Promise<void>;
  /** 사용자가 직접 조정한 값인지 (UI hint 용). */
  isUserOverride: boolean;
}

/**
 * 댓글 패널 너비 훅 — 3-레이어 우선순위.
 * 1. 사용자 드래그 저장값 (`preferences.json.commentPanelWidthPx`) 최우선.
 * 2. 댓글 갯수 boost.
 * 3. viewport 기반 clamp.
 */
export function useCommentPanelWidth(commentCount: number): UseCommentPanelWidthResult {
  const [savedWidth, setSavedWidth] = useState<number | null>(null);

  // 최초 마운트 시 preferences 에서 1회 로드.
  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((prefs) => {
      if (cancelled) return;
      const v = prefs?.commentPanelWidthPx;
      if (typeof v === 'number' && Number.isFinite(v) && v >= 280 && v <= 720) {
        setSavedWidth(v);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const viewportW = useViewportWidth();

  const width = useMemo(() => {
    if (savedWidth != null) return savedWidth;
    return computeAutoCommentPanelWidth(viewportW, commentCount);
  }, [savedWidth, viewportW, commentCount]);

  const setWidth = useCallback(async (px: number | null) => {
    if (px == null) {
      setSavedWidth(null);
    } else {
      // 280..720 범위 강제. UI 단의 드래그 핸들러도 이 범위로 clamp 하지만 방어적 한 번 더.
      const clamped = Math.max(280, Math.min(720, px));
      setSavedWidth(clamped);
    }
    // 디스크 동기화 — 다른 preference 필드 보존하면서 commentPanelWidthPx 만 갱신.
    const prefs = (await loadPreferences()) ?? {};
    if (px == null) {
      const { commentPanelWidthPx: _omit, ...rest } = prefs;
      await savePreferences(rest);
    } else {
      const clamped = Math.max(280, Math.min(720, px));
      await savePreferences({ ...prefs, commentPanelWidthPx: clamped });
    }
  }, []);

  return { width, setWidth, isUserOverride: savedWidth != null };
}

/**
 * 댓글 패널 좌측 드래그 핸들용 헬퍼.
 * - mousedown 에서 startX/startW 캡처 + window 리스너 등록
 * - mousemove: liveSetWidth 콜백으로 화면만 즉시 갱신 (디스크 저장 X)
 * - mouseup: commitWidth 콜백으로 최종 너비 1회 영구 저장
 * - cleanup useEffect 에서 unmount 시 리스너 해제 보장.
 */
export function useCommentPanelResizer(opts: {
  liveSetWidth: (px: number) => void;
  commitWidth: (px: number) => void;
}) {
  const { liveSetWidth, commitWidth } = opts;
  const dragStateRef = useRef<{ startX: number; startW: number } | null>(null);
  const mouseMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const mouseUpRef = useRef<((e: MouseEvent) => void) | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent, currentWidth: number) => {
      e.preventDefault();
      dragStateRef.current = { startX: e.clientX, startW: currentWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (ev: MouseEvent) => {
        if (!dragStateRef.current) return;
        const { startX, startW } = dragStateRef.current;
        // 좌측 핸들이라 부호 반대 — 왼쪽으로 끌면 너비 증가.
        const next = Math.max(280, Math.min(720, startW - (ev.clientX - startX)));
        liveSetWidth(next);
      };
      const onUp = (ev: MouseEvent) => {
        const state = dragStateRef.current;
        dragStateRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (mouseMoveRef.current) window.removeEventListener('mousemove', mouseMoveRef.current);
        if (mouseUpRef.current) window.removeEventListener('mouseup', mouseUpRef.current);
        mouseMoveRef.current = null;
        mouseUpRef.current = null;
        if (!state) return;
        const finalW = Math.max(280, Math.min(720, state.startW - (ev.clientX - state.startX)));
        commitWidth(finalW);
      };
      mouseMoveRef.current = onMove;
      mouseUpRef.current = onUp;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [liveSetWidth, commitWidth],
  );

  // unmount/언마운트 시 글로벌 리스너 강제 해제 + body 스타일 복귀.
  useEffect(() => {
    return () => {
      if (mouseMoveRef.current) window.removeEventListener('mousemove', mouseMoveRef.current);
      if (mouseUpRef.current) window.removeEventListener('mouseup', mouseUpRef.current);
      mouseMoveRef.current = null;
      mouseUpRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      dragStateRef.current = null;
    };
  }, []);

  return { onMouseDown };
}
