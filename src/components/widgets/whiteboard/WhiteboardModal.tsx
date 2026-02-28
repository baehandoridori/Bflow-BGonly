import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Maximize2, Minimize2, Wifi, WifiOff } from 'lucide-react';
import { LiveMap, LiveObject, LiveList } from '@liveblocks/client';
import { LiveblocksProvider, RoomProvider, ClientSideSuspense, useStatus } from '@liveblocks/react';
import { WhiteboardCanvas } from './WhiteboardCanvas';
import { WhiteboardToolbar } from './WhiteboardToolbar';
import { WhiteboardLayerPanel } from './WhiteboardLayerPanel';
import { useWhiteboardEngine } from './useWhiteboardEngine';
import { LiveWhiteboardSync } from './LiveWhiteboardSync';
import { CursorsOverlay, useCursorUpdater } from './CursorsOverlay';
import {
  loadLocalWhiteboard,
  saveLocalWhiteboard,
  createDefaultWhiteboardData,
  checkDataWarnings,
} from '@/services/whiteboardService';
import { LIVEBLOCKS_PUBLIC_KEY } from '@/liveblocks.config';
import { useAuthStore } from '@/stores/useAuthStore';
import type { WhiteboardTab, WhiteboardData } from '@/types/whiteboard';
import { cn } from '@/utils/cn';

// ─── 리사이즈 핸들 방향 ─────────────────────────────────────
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const RESIZE_HANDLES: { dir: ResizeDir; className: string; cursor: string }[] = [
  { dir: 'n',  className: 'top-0 left-2 right-2 h-1.5', cursor: 'ns-resize' },
  { dir: 's',  className: 'bottom-0 left-2 right-2 h-1.5', cursor: 'ns-resize' },
  { dir: 'e',  className: 'top-2 bottom-2 right-0 w-1.5', cursor: 'ew-resize' },
  { dir: 'w',  className: 'top-2 bottom-2 left-0 w-1.5', cursor: 'ew-resize' },
  { dir: 'ne', className: 'top-0 right-0 w-3 h-3', cursor: 'nesw-resize' },
  { dir: 'nw', className: 'top-0 left-0 w-3 h-3', cursor: 'nwse-resize' },
  { dir: 'se', className: 'bottom-0 right-0 w-3 h-3', cursor: 'nwse-resize' },
  { dir: 'sw', className: 'bottom-0 left-0 w-3 h-3', cursor: 'nesw-resize' },
];

const MIN_W = 480;
const MIN_H = 360;

// Liveblocks Room ID
const ROOM_ID = 'bflow-whiteboard-shared';

interface WhiteboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: WhiteboardTab;
}

export function WhiteboardModal({ isOpen, onClose, initialTab = 'local' }: WhiteboardModalProps) {
  const [tab, setTab] = useState<WhiteboardTab>(initialTab);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isMaximized, setIsMaximized] = useState(false);
  const engine = useWhiteboardEngine();
  const currentUser = useAuthStore((s) => s.currentUser);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef<WhiteboardData | null>(null);
  const loadKeyRef = useRef(0);

  // ── 리사이즈 상태 (항상 화면 중앙에서 시작) ──
  const [modalRect, setModalRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const resizeRef = useRef<{ dir: ResizeDir; startX: number; startY: number; startRect: { x: number; y: number; w: number; h: number } } | null>(null);

  const engineRef = useRef(engine);
  engineRef.current = engine;

  const userId = currentUser?.id ?? 'anonymous';
  const userName = currentUser?.name ?? '익명';

  // ── 초기 위치: 항상 화면 중앙 ──
  useEffect(() => {
    if (!isOpen) return;
    if (modalRect) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(vw * 0.85, 1400);
    const h = Math.min(vh * 0.85, 900);
    setModalRect({ x: (vw - w) / 2, y: (vh - h) / 2, w, h });
  }, [isOpen, modalRect]);

  // 닫힐 때 리셋
  useEffect(() => {
    if (!isOpen) {
      setModalRect(null);
      setIsMaximized(false);
    }
  }, [isOpen]);

  // ── 데이터 로드 (로컬 탭 전용 — 공유 탭은 Liveblocks가 담당) ──

  useEffect(() => {
    if (!isOpen) return;
    if (tab !== 'local') return;
    const key = ++loadKeyRef.current;

    (async () => {
      try {
        const data = await loadLocalWhiteboard();
        if (key !== loadKeyRef.current) return;

        dataRef.current = data;
        engineRef.current.loadData(data);
      } catch {
        if (key !== loadKeyRef.current) return;
        const blank = createDefaultWhiteboardData();
        dataRef.current = blank;
        engineRef.current.loadData(blank);
      }
    })();
  }, [isOpen, tab]);

  // ── 디바운스 저장 (로컬 탭 전용 — 공유 탭은 Liveblocks가 담당) ──

  useEffect(() => {
    if (!isOpen || tab !== 'local') return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const eng = engineRef.current;
      const s = eng.state;
      const data: WhiteboardData = {
        version: 1,
        layers: s.layers,
        strokes: s.strokes,
        canvasWidth: 1920,
        canvasHeight: 1080,
        lastModified: Date.now(),
      };

      dataRef.current = data;
      setSaveStatus('saving');

      try {
        await saveLocalWhiteboard(data);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }

      setWarnings(checkDataWarnings(data));
    }, 500);

    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [engine.state.strokes, engine.state.layers, isOpen, tab]);

  // ── 키보드 단축키 ──

  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      const eng = engineRef.current;

      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) { e.preventDefault(); eng.undo(userId); return; }
      if (e.ctrlKey && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); eng.redo(userId); return; }

      if (e.key === 'b' || e.key === 'B') { eng.setTool('brush'); return; }
      if (e.key === 'e' || e.key === 'E') { eng.setTool('eraser'); return; }
      if (e.key === '[') { eng.setBrushWidth(eng.state.brushWidth - 2); return; }
      if (e.key === ']') { eng.setBrushWidth(eng.state.brushWidth + 2); return; }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, userId]);

  // ── 리사이즈 드래그 ──

  const onResizeStart = useCallback((dir: ResizeDir, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!modalRect) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = { dir, startX: e.clientX, startY: e.clientY, startRect: { ...modalRect } };
  }, [modalRect]);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    const { dir, startX, startY, startRect } = resizeRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let { x, y, w, h } = startRect;

    if (dir.includes('e')) w = Math.max(MIN_W, w + dx);
    if (dir.includes('w')) { w = Math.max(MIN_W, w - dx); x = startRect.x + startRect.w - w; }
    if (dir.includes('s')) h = Math.max(MIN_H, h + dy);
    if (dir.includes('n')) { h = Math.max(MIN_H, h - dy); y = startRect.y + startRect.h - h; }

    setModalRect({ x, y, w, h });
  }, []);

  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    resizeRef.current = null;
  }, []);

  const toggleMaximize = useCallback(() => {
    setIsMaximized((prev) => !prev);
  }, []);

  if (!isOpen || !modalRect) return null;

  const displayRect = isMaximized
    ? { x: 8, y: 8, w: window.innerWidth - 16, h: window.innerHeight - 16 }
    : modalRect;

  // Liveblocks 공개 키 확인
  const hasLiveblocksKey = !!LIVEBLOCKS_PUBLIC_KEY;

  return createPortal(
    <AnimatePresence>
      {/* 백드롭 */}
      <motion.div
        key="wb-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="fixed inset-0 z-50"
        style={{ backgroundColor: 'rgb(var(--color-overlay) / var(--overlay-alpha))', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {/* 모달 카드 */}
        <motion.div
          key="wb-modal"
          initial={{ opacity: 0, scale: 0.92, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 24 }}
          transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          className="absolute bg-bg-card rounded-2xl shadow-2xl border border-bg-border flex flex-col overflow-hidden"
          style={{
            left: displayRect.x,
            top: displayRect.y,
            width: displayRect.w,
            height: displayRect.h,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── 헤더 ── */}
          <div className="flex items-center gap-3 px-5 py-3 bg-bg-card/95 backdrop-blur-md border-b border-bg-border rounded-t-2xl shrink-0">
            <div className="flex gap-0.5 bg-bg-primary/50 rounded-lg p-0.5">
              <TabButton active={tab === 'local'} onClick={() => setTab('local')}>개인</TabButton>
              <TabButton active={tab === 'public'} onClick={() => setTab('public')}>공유</TabButton>
            </div>

            <div className="flex-1" />

            {tab === 'local' && (
              <span className="text-[11px] text-text-secondary/40 mr-2">
                {saveStatus === 'saved' && '저장됨'}
                {saveStatus === 'saving' && '저장 중...'}
                {saveStatus === 'error' && '저장 실패'}
                {' · '}
                {Math.round(engine.state.zoom * 100)}%
              </span>
            )}

            {tab === 'public' && (
              <span className="text-[11px] text-text-secondary/40 mr-2">
                실시간 동기화{' · '}
                {Math.round(engine.state.zoom * 100)}%
              </span>
            )}

            <button
              onClick={toggleMaximize}
              className="p-1.5 rounded-lg text-text-secondary/40 hover:text-text-primary hover:bg-bg-border/20 transition-colors cursor-pointer"
              title={isMaximized ? '원래 크기' : '최대화'}
            >
              {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-secondary/60 hover:text-text-primary hover:bg-bg-border/20 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {warnings.length > 0 && (
            <div className="flex items-center gap-2 px-5 py-1.5 bg-orange-500/10 border-b border-orange-500/20 text-orange-400 text-[11px] shrink-0">
              <AlertTriangle size={12} />
              <span>{warnings[0]}</span>
            </div>
          )}

          {/* ── 캔버스 영역 ── */}
          <div className="flex-1 relative overflow-hidden">
            {tab === 'public' && hasLiveblocksKey ? (
              <LiveblocksProvider publicApiKey={LIVEBLOCKS_PUBLIC_KEY}>
                <RoomProvider
                  id={ROOM_ID}
                  initialPresence={{
                    cursor: null,
                    activeTool: 'brush',
                    activeColor: '#FFFFFF',
                    userName,
                  }}
                  initialStorage={{
                    strokes: new LiveMap(),
                    layers: new LiveMap([
                      ['layer-1', new LiveObject({ id: 'layer-1', name: '레이어 1', visible: true, order: 0 })],
                    ]),
                    layerOrder: new LiveList(['layer-1']),
                    canvasWidth: 1920,
                    canvasHeight: 1080,
                  }}
                >
                  <ClientSideSuspense fallback={<LiveLoadingFallback />}>
                    <LiveCanvasArea
                      engine={engine}
                      userId={userId}
                      userName={userName}
                    />
                  </ClientSideSuspense>
                </RoomProvider>
              </LiveblocksProvider>
            ) : tab === 'public' && !hasLiveblocksKey ? (
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="text-center text-text-secondary/60 space-y-2">
                  <WifiOff size={32} className="mx-auto opacity-50" />
                  <p className="text-sm">Liveblocks 공개 키가 설정되지 않았습니다</p>
                  <p className="text-xs text-text-secondary/40">
                    .env 파일에 VITE_LIVEBLOCKS_PUBLIC_KEY를 설정해주세요
                  </p>
                </div>
              </div>
            ) : (
              // 로컬 탭: 기존 그대로
              <WhiteboardCanvas
                engine={engine}
                userId={userId}
                userName={userName}
              />
            )}

            <WhiteboardToolbar
              tool={engine.state.tool}
              color={engine.state.color}
              brushWidth={engine.state.brushWidth}
              canUndo={engine.canUndo(userId)}
              canRedo={engine.canRedo(userId)}
              onToolChange={engine.setTool}
              onColorChange={engine.setColor}
              onBrushWidthChange={engine.setBrushWidth}
              onUndo={() => engine.undo(userId)}
              onRedo={() => engine.redo(userId)}
              onClearAll={engine.clearAll}
            />

            <WhiteboardLayerPanel
              layers={engine.state.layers}
              activeLayerId={engine.state.activeLayerId}
              onSelectLayer={engine.setActiveLayer}
              onToggleVisibility={engine.toggleLayerVisibility}
              onAddLayer={engine.addLayer}
              onRemoveLayer={engine.removeLayer}
              onRenameLayer={engine.renameLayer}
              onMoveUp={engine.moveLayerUp}
              onMoveDown={engine.moveLayerDown}
            />
          </div>

          {/* ── 리사이즈 핸들 ── */}
          {!isMaximized && RESIZE_HANDLES.map(({ dir, className, cursor }) => (
            <div
              key={dir}
              className={cn('absolute z-10', className)}
              style={{ cursor }}
              onPointerDown={(e) => onResizeStart(dir, e)}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
            />
          ))}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

// ─── 공유 탭 캔버스 영역 (RoomProvider 안에서 렌더링) ───────

function LiveCanvasArea({ engine, userId, userName }: { engine: ReturnType<typeof useWhiteboardEngine>; userId: string; userName: string }) {
  const status = useStatus();
  const { updateCursor, clearCursor } = useCursorUpdater();

  return (
    <>
      {/* 연결 상태 배너 */}
      {status !== 'connected' && (
        <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-center gap-2 py-1.5 bg-yellow-500/15 text-yellow-400 text-xs">
          {status === 'connecting' || status === 'reconnecting' ? (
            <>
              <Wifi size={12} className="animate-pulse" />
              <span>{status === 'connecting' ? '연결 중...' : '재연결 중...'}</span>
            </>
          ) : (
            <>
              <WifiOff size={12} />
              <span>연결 끊김 — 개인 탭으로 전환해주세요</span>
            </>
          )}
        </div>
      )}

      {/* 동기화 브릿지 (화면 출력 없음) */}
      <LiveWhiteboardSync engine={engine} userId={userId} userName={userName} />

      {/* 캔버스 + 커서 오버레이 */}
      <WhiteboardCanvas
        engine={engine}
        userId={userId}
        userName={userName}
        onCursorMove={updateCursor}
        onCursorLeave={clearCursor}
        overlay={
          <CursorsOverlay
            zoom={engine.state.zoom}
            panX={engine.state.panX}
            panY={engine.state.panY}
          />
        }
      />
    </>
  );
}

// ─── 로딩 스피너 ────────────────────────────────────────────

function LiveLoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center text-text-secondary/60 space-y-2">
        <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto" />
        <p className="text-xs">실시간 화이트보드 연결 중...</p>
      </div>
    </div>
  );
}

// ─── 탭 버튼 ────────────────────────────────────────────────

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1 rounded-md text-xs transition-all cursor-pointer',
        active ? 'bg-accent/20 text-accent font-medium' : 'text-text-secondary/60 hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}
