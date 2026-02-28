import { useRef, useCallback, useState } from 'react';
import type { WhiteboardStroke, WhiteboardLayer, WhiteboardTool, StrokePoint, WhiteboardData } from '@/types/whiteboard';

// ─── 상수 ───────────────────────────────────────────────────

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;

// ─── 엔진 상태 타입 ────────────────────────────────────────

export interface EngineState {
  strokes: WhiteboardStroke[];
  layers: WhiteboardLayer[];
  activeLayerId: string;
  tool: WhiteboardTool;
  color: string;
  brushWidth: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface WhiteboardEngine {
  state: EngineState;
  // 상태 변경
  setTool: (tool: WhiteboardTool) => void;
  setColor: (color: string) => void;
  setBrushWidth: (width: number) => void;
  setActiveLayer: (layerId: string) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  // 레이어 관리
  addLayer: () => void;
  removeLayer: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  moveLayerUp: (id: string) => void;
  moveLayerDown: (id: string) => void;
  // 스트로크 관리
  addStroke: (stroke: WhiteboardStroke) => void;
  setStrokes: (strokes: WhiteboardStroke[]) => void;
  setLayers: (layers: WhiteboardLayer[]) => void;
  clearAll: () => void;
  // Undo/Redo
  undo: (userId: string) => void;
  redo: (userId: string) => void;
  canUndo: (userId: string) => boolean;
  canRedo: (userId: string) => boolean;
  // 포인터 이벤트 (캔버스에서 호출)
  handlePointerDown: (x: number, y: number, userId: string, userName: string) => void;
  handlePointerMove: (x: number, y: number) => void;
  handlePointerUp: () => WhiteboardStroke | null;
  isDrawing: () => boolean;
  getCurrentStrokePoints: () => StrokePoint[];
  // 렌더링
  renderToCanvas: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  renderActiveStroke: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  // 데이터 import/export
  toData: (canvasW: number, canvasH: number) => Pick<WhiteboardData, 'layers' | 'strokes' | 'canvasWidth' | 'canvasHeight'>;
  loadData: (data: Pick<WhiteboardData, 'layers' | 'strokes'>) => void;
}

// ─── 렌더링 유틸 ────────────────────────────────────────────

function drawStroke(ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke) {
  if (stroke.points.length === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width;

  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
  }

  ctx.beginPath();
  const first = stroke.points[0];
  ctx.moveTo(first.x, first.y);

  if (stroke.points.length === 1) {
    // 점 하나 → 원 그리기
    ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
    ctx.fill();
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }

  ctx.restore();
}

// ─── 훅 ─────────────────────────────────────────────────────

export function useWhiteboardEngine(): WhiteboardEngine {
  const [state, setState] = useState<EngineState>({
    strokes: [],
    layers: [{ id: 'layer-1', name: '레이어 1', visible: true, order: 0 }],
    activeLayerId: 'layer-1',
    tool: 'brush',
    color: '#FFFFFF',
    brushWidth: 3,
    zoom: 1,
    panX: 0,
    panY: 0,
  });

  // Undo/Redo 스택 (userId별)
  const undoStackRef = useRef<Map<string, WhiteboardStroke[]>>(new Map());
  const redoStackRef = useRef<Map<string, WhiteboardStroke[]>>(new Map());

  // 현재 그리고 있는 스트로크
  const drawingRef = useRef<{
    active: boolean;
    stroke: WhiteboardStroke;
  } | null>(null);

  // 최신 state를 ref로 유지 (콜백 내에서 사용)
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── 도구 설정 ──

  const setTool = useCallback((tool: WhiteboardTool) => {
    setState((s) => ({ ...s, tool }));
  }, []);

  const setColor = useCallback((color: string) => {
    setState((s) => ({ ...s, color }));
  }, []);

  const setBrushWidth = useCallback((width: number) => {
    setState((s) => ({ ...s, brushWidth: Math.max(1, Math.min(50, width)) }));
  }, []);

  const setActiveLayer = useCallback((layerId: string) => {
    setState((s) => ({ ...s, activeLayerId: layerId }));
  }, []);

  const setZoom = useCallback((zoom: number) => {
    setState((s) => ({ ...s, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) }));
  }, []);

  const setPan = useCallback((x: number, y: number) => {
    setState((s) => ({ ...s, panX: x, panY: y }));
  }, []);

  // ── 레이어 관리 ──

  const addLayer = useCallback(() => {
    setState((s) => {
      const maxOrder = s.layers.reduce((m, l) => Math.max(m, l.order), -1);
      const newLayer: WhiteboardLayer = {
        id: `layer-${Date.now()}`,
        name: `레이어 ${s.layers.length + 1}`,
        visible: true,
        order: maxOrder + 1,
      };
      return { ...s, layers: [...s.layers, newLayer], activeLayerId: newLayer.id };
    });
  }, []);

  const removeLayer = useCallback((id: string) => {
    setState((s) => {
      if (s.layers.length <= 1) return s; // 최소 1개 유지
      const newLayers = s.layers.filter((l) => l.id !== id);
      const newStrokes = s.strokes.filter((st) => st.layerId !== id);
      const newActive = s.activeLayerId === id ? newLayers[0].id : s.activeLayerId;
      return { ...s, layers: newLayers, strokes: newStrokes, activeLayerId: newActive };
    });
  }, []);

  const toggleLayerVisibility = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      layers: s.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    }));
  }, []);

  const renameLayer = useCallback((id: string, name: string) => {
    setState((s) => ({
      ...s,
      layers: s.layers.map((l) => (l.id === id ? { ...l, name } : l)),
    }));
  }, []);

  const moveLayerUp = useCallback((id: string) => {
    setState((s) => {
      const sorted = [...s.layers].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((l) => l.id === id);
      if (idx >= sorted.length - 1) return s;
      const tmpOrder = sorted[idx].order;
      sorted[idx] = { ...sorted[idx], order: sorted[idx + 1].order };
      sorted[idx + 1] = { ...sorted[idx + 1], order: tmpOrder };
      return { ...s, layers: sorted };
    });
  }, []);

  const moveLayerDown = useCallback((id: string) => {
    setState((s) => {
      const sorted = [...s.layers].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((l) => l.id === id);
      if (idx <= 0) return s;
      const tmpOrder = sorted[idx].order;
      sorted[idx] = { ...sorted[idx], order: sorted[idx - 1].order };
      sorted[idx - 1] = { ...sorted[idx - 1], order: tmpOrder };
      return { ...s, layers: sorted };
    });
  }, []);

  // ── 스트로크 관리 ──

  const addStroke = useCallback((stroke: WhiteboardStroke) => {
    setState((s) => ({ ...s, strokes: [...s.strokes, stroke] }));
    // redo 스택 클리어
    redoStackRef.current.delete(stroke.userId);
  }, []);

  const setStrokes = useCallback((strokes: WhiteboardStroke[]) => {
    setState((s) => ({ ...s, strokes }));
  }, []);

  const setLayers = useCallback((layers: WhiteboardLayer[]) => {
    setState((s) => ({ ...s, layers, activeLayerId: layers[0]?.id ?? s.activeLayerId }));
  }, []);

  const clearAll = useCallback(() => {
    setState((s) => ({ ...s, strokes: [] }));
    undoStackRef.current.clear();
    redoStackRef.current.clear();
  }, []);

  // ── Undo / Redo ──

  const undo = useCallback((userId: string) => {
    setState((s) => {
      // 현재 사용자의 마지막 스트로크 찾기
      const myStrokes = s.strokes.filter((st) => st.userId === userId);
      if (myStrokes.length === 0) return s;
      const last = myStrokes[myStrokes.length - 1];

      // undo 스택에 추가
      const stack = undoStackRef.current.get(userId) ?? [];
      stack.push(last);
      undoStackRef.current.set(userId, stack);

      // redo 스택에 추가
      const redoStack = redoStackRef.current.get(userId) ?? [];
      redoStack.push(last);
      redoStackRef.current.set(userId, redoStack);

      return { ...s, strokes: s.strokes.filter((st) => st.id !== last.id) };
    });
  }, []);

  const redo = useCallback((userId: string) => {
    const redoStack = redoStackRef.current.get(userId);
    if (!redoStack || redoStack.length === 0) return;

    const stroke = redoStack.pop()!;
    setState((s) => ({ ...s, strokes: [...s.strokes, stroke] }));
  }, []);

  const canUndo = useCallback((userId: string) => {
    return stateRef.current.strokes.some((st) => st.userId === userId);
  }, []);

  const canRedo = useCallback((userId: string) => {
    const stack = redoStackRef.current.get(userId);
    return !!stack && stack.length > 0;
  }, []);

  // ── 포인터 이벤트 ──

  const handlePointerDown = useCallback((x: number, y: number, userId: string, userName: string) => {
    const s = stateRef.current;
    drawingRef.current = {
      active: true,
      stroke: {
        id: crypto.randomUUID(),
        points: [{ x, y }],
        color: s.color,
        width: s.brushWidth,
        layerId: s.activeLayerId,
        tool: s.tool,
        userId,
        userName,
        timestamp: Date.now(),
      },
    };
  }, []);

  const handlePointerMove = useCallback((x: number, y: number) => {
    if (!drawingRef.current?.active) return;
    drawingRef.current.stroke.points.push({ x, y });
  }, []);

  const handlePointerUp = useCallback((): WhiteboardStroke | null => {
    if (!drawingRef.current?.active) return null;
    const stroke = drawingRef.current.stroke;
    drawingRef.current = null;

    if (stroke.points.length > 0) {
      addStroke(stroke);
      return stroke;
    }
    return null;
  }, [addStroke]);

  const isDrawing = useCallback(() => {
    return drawingRef.current?.active ?? false;
  }, []);

  const getCurrentStrokePoints = useCallback((): StrokePoint[] => {
    return drawingRef.current?.stroke.points ?? [];
  }, []);

  // ── 렌더링 ──

  const renderToCanvas = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const s = stateRef.current;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(s.panX, s.panY);
    ctx.scale(s.zoom, s.zoom);

    // 레이어 순서대로 렌더링
    const sortedLayers = [...s.layers].sort((a, b) => a.order - b.order);

    for (const layer of sortedLayers) {
      if (!layer.visible) continue;

      // OffscreenCanvas로 레이어별 렌더링
      const offscreen = new OffscreenCanvas(s.layers.length > 0 ? 1920 : width, s.layers.length > 0 ? 1080 : height);
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) continue;

      const layerStrokes = s.strokes.filter((st) => st.layerId === layer.id);
      for (const stroke of layerStrokes) {
        drawStroke(offCtx as unknown as CanvasRenderingContext2D, stroke);
      }

      ctx.drawImage(offscreen, 0, 0);
    }

    ctx.restore();
  }, []);

  const renderActiveStroke = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const s = stateRef.current;
    ctx.clearRect(0, 0, width, height);

    if (!drawingRef.current?.active) return;

    ctx.save();
    ctx.translate(s.panX, s.panY);
    ctx.scale(s.zoom, s.zoom);
    drawStroke(ctx, drawingRef.current.stroke);
    ctx.restore();
  }, []);

  // ── 데이터 I/O ──

  const toData = useCallback((canvasW: number, canvasH: number): Pick<WhiteboardData, 'layers' | 'strokes' | 'canvasWidth' | 'canvasHeight'> => {
    const s = stateRef.current;
    return {
      layers: s.layers,
      strokes: s.strokes,
      canvasWidth: canvasW,
      canvasHeight: canvasH,
    };
  }, []);

  const loadData = useCallback((data: Pick<WhiteboardData, 'layers' | 'strokes'>) => {
    setState((s) => ({
      ...s,
      layers: data.layers.length > 0 ? data.layers : s.layers,
      strokes: data.strokes,
      activeLayerId: data.layers.length > 0 ? data.layers[0].id : s.activeLayerId,
    }));
    undoStackRef.current.clear();
    redoStackRef.current.clear();
  }, []);

  return {
    state,
    setTool,
    setColor,
    setBrushWidth,
    setActiveLayer,
    setZoom,
    setPan,
    addLayer,
    removeLayer,
    toggleLayerVisibility,
    renameLayer,
    moveLayerUp,
    moveLayerDown,
    addStroke,
    setStrokes,
    setLayers,
    clearAll,
    undo,
    redo,
    canUndo,
    canRedo,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isDrawing,
    getCurrentStrokePoints,
    renderToCanvas,
    renderActiveStroke,
    toData,
    loadData,
  };
}
