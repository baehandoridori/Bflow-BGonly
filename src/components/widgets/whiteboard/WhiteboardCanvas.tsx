import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { WhiteboardEngine } from './useWhiteboardEngine';
import { loadPreferences } from '@/services/settingsService';

interface WhiteboardCanvasProps {
  engine: WhiteboardEngine;
  userId: string;
  userName: string;
  readOnly?: boolean;
  /** 커서 위치 업데이트 콜백 (캔버스 논리좌표) — 공유 탭에서 Liveblocks Presence 반영용 */
  onCursorMove?: (canvasX: number, canvasY: number) => void;
  /** 커서가 캔버스를 벗어났을 때 호출 */
  onCursorLeave?: () => void;
  /** 캔버스 위에 표시할 오버레이 (커서 등) */
  overlay?: ReactNode;
}

export function WhiteboardCanvas({ engine, userId, userName, readOnly, onCursorMove, onCursorLeave, overlay }: WhiteboardCanvasProps) {
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const isPanningRef = useRef(false);
  const lastPanRef = useRef({ x: 0, y: 0 });
  const spaceDownRef = useRef(false);
  const [bgColor, setBgColor] = useState('#1A1D27');

  useEffect(() => {
    loadPreferences().then((prefs) => {
      setBgColor(prefs?.whiteboardBgColor ?? '#1A1D27');
    });
  }, []);

  // 최신 engine/props를 ref로 유지 (콜백 안정화)
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const userRef = useRef({ userId, userName });
  userRef.current = { userId, userName };

  // ── 리사이즈 처리 ──

  const resizeCanvases = useCallback(() => {
    const container = containerRef.current;
    const main = mainCanvasRef.current;
    const active = activeCanvasRef.current;
    if (!container || !main || !active) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;

    for (const canvas of [main, active]) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    }
  }, []);

  useEffect(() => {
    resizeCanvases();
    const observer = new ResizeObserver(resizeCanvases);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [resizeCanvases]);

  // ── 렌더 루프 ──

  useEffect(() => {
    const loop = () => {
      const main = mainCanvasRef.current;
      const active = activeCanvasRef.current;
      if (!main || !active) { rafRef.current = requestAnimationFrame(loop); return; }

      const mainCtx = main.getContext('2d');
      const activeCtx = active.getContext('2d');
      if (!mainCtx || !activeCtx) { rafRef.current = requestAnimationFrame(loop); return; }

      const dpr = window.devicePixelRatio || 1;
      const w = main.width / dpr;
      const h = main.height / dpr;

      engineRef.current.renderToCanvas(mainCtx, w, h);
      engineRef.current.renderActiveStroke(activeCtx, w, h);

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ── 좌표 변환 (스크린 → 캔버스 논리좌표) ──

  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const { zoom, panX, panY } = engineRef.current.state;
    const x = (clientX - rect.left - panX) / zoom;
    const y = (clientY - rect.top - panY) / zoom;
    return { x, y };
  }, []);

  // ── 포인터 이벤트 ──

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (readOnly) return;

    // Space 누른 상태 → 팬 모드
    if (spaceDownRef.current || e.button === 1) {
      isPanningRef.current = true;
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return;
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    const { userId: uid, userName: uname } = userRef.current;
    engineRef.current.handlePointerDown(x, y, uid, uname);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [readOnly, screenToCanvas]);

  // ref로 유지하여 콜백 안정성 확보
  const onCursorMoveRef = useRef(onCursorMove);
  onCursorMoveRef.current = onCursorMove;
  const onCursorLeaveRef = useRef(onCursorLeave);
  onCursorLeaveRef.current = onCursorLeave;

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // 커서 위치 → Liveblocks Presence 업데이트 (항상, 그리기 중이 아닐 때도)
    const { x: cx, y: cy } = screenToCanvas(e.clientX, e.clientY);
    onCursorMoveRef.current?.(cx, cy);

    if (isPanningRef.current) {
      const eng = engineRef.current;
      const dx = e.clientX - lastPanRef.current.x;
      const dy = e.clientY - lastPanRef.current.y;
      eng.setPan(eng.state.panX + dx, eng.state.panY + dy);
      lastPanRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!engineRef.current.isDrawing()) return;
    engineRef.current.handlePointerMove(cx, cy);
  }, [screenToCanvas]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    engineRef.current.handlePointerUp();
  }, []);

  // ── 마우스 휠 (줌) — addEventListener로 non-passive 등록 ──

  useEffect(() => {
    const el = activeCanvasRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const eng = engineRef.current;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      eng.setZoom(eng.state.zoom + delta);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── 키보드 (Space 팬) ──

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceDownRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ backgroundColor: bgColor }}
    >
      {/* 체커보드 배경 */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: 'linear-gradient(45deg, #444 25%, transparent 25%), linear-gradient(-45deg, #444 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #444 75%), linear-gradient(-45deg, transparent 75%, #444 75%)',
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
      }} />

      {/* 메인 캔버스 (완성된 스트로크) */}
      <canvas
        ref={mainCanvasRef}
        className="absolute inset-0"
      />

      {/* 활성 캔버스 (현재 그리고 있는 스트로크) */}
      <canvas
        ref={activeCanvasRef}
        className="absolute inset-0 cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => onCursorLeaveRef.current?.()}
        style={{ touchAction: 'none' }}
      />

      {/* 오버레이 (커서 등 — 공유 탭에서만 사용) */}
      {overlay}
    </div>
  );
}
