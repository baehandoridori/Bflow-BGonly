import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Grid3X3, Maximize2, Move, RotateCcw } from 'lucide-react';
import { cn } from '@/utils/cn';

type LayoutKind = 'section' | 'detailPanel' | 'slider' | 'toggle' | 'action';

interface DraftItem {
  id: string;
  label: string;
  note: string;
  kind: LayoutKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragMode = 'move' | 'resize';

interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  startY: number;
  startItem: DraftItem;
  boardRect: DOMRect;
}

const STORAGE_KEY = 'bflow.effects.layoutDraft.v4';
const LAYOUT_VERSION = 4;
const BOARD_W = 560;
const BOARD_H = 980;
const GRID = 8;

const DEFAULT_ITEMS: DraftItem[] = [
  { id: 'completion', label: '씬 완료 색상 표시', note: '공통 토글', kind: 'toggle', x: 24, y: 24, w: 512, h: 72 },
  { id: 'global-bg', label: '전체 그라데이션', note: '공통 배경 토글', kind: 'toggle', x: 24, y: 112, w: 512, h: 72 },
  { id: 'login-surface', label: '로그인 화면 배경 설정', note: '선택 버튼 / 프리뷰 / 선택한 효과 세부 설정', kind: 'section', x: 24, y: 208, w: 512, h: 192 },
  { id: 'login-bflow-details', label: '로그인 Bflow식 StarNest 세부 설정', note: '이미지 톤 / 반응 크기 / 연결선 / 잔향 입자', kind: 'detailPanel', x: 48, y: 424, w: 464, h: 104 },
  { id: 'dashboard-surface', label: '대시보드 화면 배경 설정', note: '선택 버튼 / 프리뷰 / 선택한 효과 세부 설정', kind: 'section', x: 24, y: 552, w: 512, h: 192 },
  { id: 'dashboard-presentation', label: '대시보드 표시값', note: 'StarNest/Bflow 불투명도와 블러', kind: 'slider', x: 48, y: 768, w: 464, h: 80 },
  { id: 'dashboard-bflow-details', label: '대시보드 Bflow식 StarNest 세부 설정', note: '이미지 톤 / 반응 크기 / 연결선 / 잔향 입자', kind: 'detailPanel', x: 48, y: 872, w: 464, h: 84 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

function readStoredLayout(): DraftItem[] {
  if (typeof window === 'undefined') return DEFAULT_ITEMS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ITEMS;
    const payload = JSON.parse(raw) as { version?: number; items?: Partial<DraftItem>[] };
    if (payload.version !== LAYOUT_VERSION || !Array.isArray(payload.items)) return DEFAULT_ITEMS;
    const stored = payload.items;
    if (!Array.isArray(stored)) return DEFAULT_ITEMS;
    return DEFAULT_ITEMS.map((item) => {
      const match = stored.find((candidate) => candidate.id === item.id);
      if (!match) return item;
      return {
        ...item,
        x: clamp(Number(match.x), 0, BOARD_W - 64),
        y: clamp(Number(match.y), 0, BOARD_H - 48),
        w: clamp(Number(match.w), 88, BOARD_W),
        h: clamp(Number(match.h), 48, BOARD_H),
      };
    });
  } catch {
    return DEFAULT_ITEMS;
  }
}

function renderMockControl(item: DraftItem) {
  if (item.kind === 'detailPanel') {
    return (
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 flex-1 rounded-full bg-bg-border">
            <span className="block h-full w-full rounded-full bg-accent" />
          </span>
          <span className="w-8 text-right font-mono text-[10px] text-accent">1</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-1.5 flex-1 rounded-full bg-bg-border">
            <span className="block h-full w-[78%] rounded-full bg-accent/80" />
          </span>
          <span className="w-8 text-right font-mono text-[10px] text-accent">1.95</span>
        </div>
      </div>
    );
  }

  if (item.kind === 'slider') {
    return (
      <div className="mt-4 flex items-center gap-2">
        <span className="h-1.5 flex-1 rounded-full bg-bg-border">
          <span className="block h-full w-[68%] rounded-full bg-accent" />
        </span>
        <span className="w-9 text-right font-mono text-[10px] text-accent">0.72</span>
      </div>
    );
  }

  if (item.kind === 'toggle') {
    return (
      <div className="mt-3 flex items-center justify-between">
        <span className="h-1.5 w-16 rounded-full bg-bg-border/80" />
        <span className="relative h-6 w-11 rounded-full bg-accent">
          <span className="absolute right-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm" />
        </span>
      </div>
    );
  }

  if (item.kind === 'action') {
    return (
      <div className="mt-3 inline-flex rounded-lg border border-bg-border/60 bg-bg-primary/70 px-3 py-1.5 text-[11px] font-semibold text-text-secondary">
        버튼
      </div>
    );
  }

  return (
    <div className="mt-3 grid grid-cols-3 gap-1.5">
      <span className="h-7 rounded-md bg-accent text-center text-[10px] font-bold leading-7 text-white">Bflow</span>
      <span className="h-7 rounded-md bg-bg-border/55" />
      <span className="h-7 rounded-md bg-bg-border/35" />
    </div>
  );
}

export function EffectLayoutDesigner() {
  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [items, setItems] = useState<DraftItem[]>(() => readStoredLayout());
  const [activeId, setActiveId] = useState(DEFAULT_ITEMS[0]?.id ?? '');
  const activeItem = useMemo(() => items.find((item) => item.id === activeId), [activeId, items]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: LAYOUT_VERSION, items }));
    } catch {
      // 임시 디자인 보드라 저장 실패는 무시한다.
    }
  }, [items]);

  const resetLayout = useCallback(() => {
    setItems(DEFAULT_ITEMS);
    setActiveId(DEFAULT_ITEMS[0]?.id ?? '');
  }, []);

  const updateDragging = useCallback((clientX: number, clientY: number) => {
    const state = dragRef.current;
    if (!state) return;
    const scaleX = BOARD_W / state.boardRect.width;
    const scaleY = BOARD_H / state.boardRect.height;
    const dx = (clientX - state.startX) * scaleX;
    const dy = (clientY - state.startY) * scaleY;
    setItems((current) => current.map((item) => {
      if (item.id !== state.id) return item;
      if (state.mode === 'resize') {
        return {
          ...item,
          w: snap(clamp(state.startItem.w + dx, 88, BOARD_W - state.startItem.x)),
          h: snap(clamp(state.startItem.h + dy, 48, BOARD_H - state.startItem.y)),
        };
      }
      return {
        ...item,
        x: snap(clamp(state.startItem.x + dx, 0, BOARD_W - state.startItem.w)),
        y: snap(clamp(state.startItem.y + dy, 0, BOARD_H - state.startItem.h)),
      };
    }));
  }, []);

  const onWindowPointerMove = useCallback((event: PointerEvent) => {
    updateDragging(event.clientX, event.clientY);
  }, [updateDragging]);

  const stopDragging = useCallback(() => {
    dragRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', stopDragging);
  }, [onWindowPointerMove]);

  const startDrag = useCallback((event: React.PointerEvent, item: DraftItem, mode: DragMode) => {
    const board = boardRef.current;
    if (!board) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveId(item.id);
    dragRef.current = {
      id: item.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startItem: item,
      boardRect: board.getBoundingClientRect(),
    };
    document.body.style.cursor = mode === 'resize' ? 'nwse-resize' : 'grabbing';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', stopDragging);
  }, [onWindowPointerMove, stopDragging]);

  useEffect(() => () => {
    dragRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', stopDragging);
  }, [onWindowPointerMove, stopDragging]);

  return (
    <div className="mb-5 rounded-xl border border-accent/25 bg-bg-primary/70 p-3 shadow-[0_18px_50px_rgb(0_0_0_/_0.18)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-text-primary">임시 설정창 레이아웃 보드</p>
          <p className="text-[10px] text-text-secondary/55">
            실제 설정 폭에 맞춘 세로 프레임입니다. 위치와 크기는 이 브라우저에만 저장됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeItem && (
            <span className="rounded-md border border-bg-border/45 bg-bg-card/70 px-2 py-1 font-mono text-[10px] text-text-secondary">
              X {activeItem.x} Y {activeItem.y} W {activeItem.w} H {activeItem.h}
            </span>
          )}
          <button
            type="button"
            onClick={resetLayout}
            className="inline-flex items-center gap-1 rounded-md border border-bg-border/45 bg-bg-card px-2 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:border-accent/45 hover:text-text-primary"
          >
            <RotateCcw size={12} />
            리셋
          </button>
        </div>
      </div>

      <div
        ref={boardRef}
        className="relative w-full overflow-hidden rounded-lg border border-bg-border/45 bg-bg-card/75"
        style={{
          aspectRatio: `${BOARD_W}/${BOARD_H}`,
          backgroundImage:
            'linear-gradient(rgb(var(--color-bg-border) / 0.28) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--color-bg-border) / 0.28) 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      >
        <div className="pointer-events-none absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-bg-border/40 bg-bg-primary/80 px-2 py-1 text-[10px] font-semibold text-text-secondary">
          <Grid3X3 size={11} />
          실제 설정 폭 · 8px grid
        </div>

        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              onPointerDown={(event) => startDrag(event, item, 'move')}
              onFocus={() => setActiveId(item.id)}
              className={cn(
                'absolute overflow-hidden rounded-lg border bg-bg-primary/90 p-3 text-left shadow-lg transition-[border-color,box-shadow]',
                active
                  ? 'border-accent shadow-[0_0_0_2px_rgb(var(--color-accent)_/_0.22),0_16px_30px_rgb(0_0_0_/_0.24)]'
                  : 'border-bg-border/55 hover:border-accent/45',
              )}
              style={{
                left: `${(item.x / BOARD_W) * 100}%`,
                top: `${(item.y / BOARD_H) * 100}%`,
                width: `${(item.w / BOARD_W) * 100}%`,
                height: `${(item.h / BOARD_H) * 100}%`,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-text-primary">{item.label}</p>
                  <p className="mt-0.5 truncate text-[10px] text-text-secondary/55">{item.note}</p>
                </div>
                <Move size={13} className="shrink-0 text-text-secondary/45" />
              </div>
              {renderMockControl(item)}
              <button
                type="button"
                aria-label={`${item.label} 크기 조절`}
                onPointerDown={(event) => startDrag(event, item, 'resize')}
                className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-md text-text-secondary/50 transition-colors hover:bg-accent/12 hover:text-accent"
              >
                <Maximize2 size={11} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
