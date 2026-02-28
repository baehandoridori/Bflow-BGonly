import { useState, useCallback, useRef } from 'react';

interface Position { x: number; y: number; }

export function useFloatingPanel(defaultPos: Position) {
  const [position, setPosition] = useState<Position>(defaultPos);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };
  }, [position]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPosition({
      x: dragRef.current.startPosX + dx,
      y: dragRef.current.startPosY + dy,
    });
  }, []);

  const onDragEnd = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }, []);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((v) => !v);
  }, []);

  return {
    position,
    isCollapsed,
    toggleCollapse,
    dragHandlers: {
      onPointerDown: onDragStart,
      onPointerMove: onDragMove,
      onPointerUp: onDragEnd,
    },
  };
}
