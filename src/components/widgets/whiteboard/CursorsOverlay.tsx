import { useOthersMapped, useUpdateMyPresence } from '@liveblocks/react';
import { useCallback } from 'react';

// ─── 사용자별 커서 색상 ─────────────────────────────────────

const CURSOR_COLORS = [
  '#FF6B6B', '#FDCB6E', '#00B894', '#74B9FF',
  '#A29BFE', '#FD79A8', '#00CEC9', '#E17055',
];

function getCursorColor(connectionId: number): string {
  return CURSOR_COLORS[connectionId % CURSOR_COLORS.length];
}

// ─── 커서 SVG ───────────────────────────────────────────────

function CursorIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M1 1L5.5 18L8 10.5L15 8L1 1Z"
        fill={color}
        stroke="#000"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Props ──────────────────────────────────────────────────

interface CursorsOverlayProps {
  /** 캔버스 논리 좌표 → 화면 좌표 변환에 필요한 zoom */
  zoom: number;
  /** 캔버스 panX */
  panX: number;
  /** 캔버스 panY */
  panY: number;
}

/**
 * 다른 사용자의 실시간 커서를 표시하는 오버레이.
 * RoomProvider 안에서만 렌더링됨 (공유 탭).
 */
export function CursorsOverlay({ zoom, panX, panY }: CursorsOverlayProps) {
  const others = useOthersMapped((other) => ({
    cursor: other.presence.cursor,
    userName: other.presence.userName,
    activeTool: other.presence.activeTool,
    activeColor: other.presence.activeColor,
  }));

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 50 }}>
      {others.map(([connectionId, presence]) => {
        if (!presence.cursor) return null;

        // 캔버스 논리 좌표 → 화면 좌표
        const screenX = presence.cursor.x * zoom + panX;
        const screenY = presence.cursor.y * zoom + panY;
        const color = getCursorColor(connectionId);

        return (
          <div
            key={connectionId}
            className="absolute transition-transform duration-75"
            style={{
              transform: `translate(${screenX}px, ${screenY}px)`,
              willChange: 'transform',
            }}
          >
            <CursorIcon color={color} />
            <span
              className="absolute left-4 top-3 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap"
              style={{
                backgroundColor: color,
                color: '#000',
              }}
            >
              {presence.userName || '익명'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── 커서 위치 업데이트 훅 ──────────────────────────────────

/**
 * 캔버스에서 호출하여 마우스 위치를 Liveblocks Presence에 반영.
 * 마우스가 캔버스를 벗어나면 cursor: null.
 */
export function useCursorUpdater() {
  const updateMyPresence = useUpdateMyPresence();

  const updateCursor = useCallback(
    (canvasX: number, canvasY: number) => {
      updateMyPresence({ cursor: { x: canvasX, y: canvasY } });
    },
    [updateMyPresence],
  );

  const clearCursor = useCallback(() => {
    updateMyPresence({ cursor: null });
  }, [updateMyPresence]);

  return { updateCursor, clearCursor };
}
