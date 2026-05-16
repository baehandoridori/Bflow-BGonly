/**
 * v1.26.0 — 드로잉 주석 캔버스.
 *
 * 원본 이미지 위에 투명 캔버스를 덮어 그린다.
 * 도구: pen(하이라이터, 반투명), line, arrow, rect, circle, text, erase
 * 단축키: Ctrl+Z 실행취소
 * 저장: getCanvas() 로 캔버스 element 반환 → 호출자가 composeAnnotation 으로 합성.
 */

import {
  useRef,
  useState,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react';
import { AnnotationToolbar, type DrawTool } from './AnnotationToolbar';

export interface AnnotationCanvasHandle {
  /** 합성용 캔버스 element (이미지 자연 크기와 동일) */
  getCanvas(): HTMLCanvasElement | null;
  /** 캔버스 비우기 + 히스토리 초기화 */
  clear(): void;
  /** 빈 캔버스 여부 — 저장 가드 */
  isEmpty(): boolean;
}

interface AnnotationCanvasProps {
  imageUrl: string;
  /** 좌하단 메타용 — "v{N} 위에 그리는 중 · 저장 시 v{N+1} (주석)" */
  baseVersionNo: number;
  /** v1.26.2: 외부에서 텍스트 메모를 받기 위한 controlled value (옵셔널) */
  description?: string;
  onDescriptionChange?: (v: string) => void;
}

type Point = { x: number; y: number };

export const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, AnnotationCanvasProps>(
  function AnnotationCanvas({ imageUrl, baseVersionNo, description, onDescriptionChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [tool, setTool] = useState<DrawTool>('pen');
    const [color, setColor] = useState<string>('#EB5757');
    const [strokeWidth, setStrokeWidth] = useState<number>(4);
    const [opacity, setOpacity] = useState<number>(100);
    // v1.26.2: 도형 채움/외곽선 토글 + 텍스트 윤곽선 토글
    const [shapeFill, setShapeFill] = useState<boolean>(false);
    const [textOutline, setTextOutline] = useState<boolean>(false);
    // v1.26.2: 캔버스 줌 (0.25 ~ 4)
    const [zoom, setZoom] = useState<number>(1);
    // v1.26.2: 내부 description (controlled 옵션 없으면 자체 state)
    const [localDescription, setLocalDescription] = useState('');
    const descValue = description ?? localDescription;
    const setDescValue = (v: string) => {
      if (onDescriptionChange) onDescriptionChange(v);
      else setLocalDescription(v);
    };

    const drawingRef = useRef(false);
    const startPosRef = useRef<Point | null>(null);
    const snapshotRef = useRef<ImageData | null>(null);
    const historyRef = useRef<string[]>([]);
    const historyIndexRef = useRef(-1);
    const hasDrawnRef = useRef(false);

    // v1.26.1: window.prompt 가 Electron renderer 에서 차단되므로
    //          텍스트 도구는 캔버스 위 inline input 으로 입력받는다.
    //          screenPos: 입력 박스 표시 위치 (display pixel)
    //          canvasPos: 그릴 때 사용할 캔버스 좌표
    const [textInput, setTextInput] = useState<{
      screenX: number;
      screenY: number;
      canvasX: number;
      canvasY: number;
    } | null>(null);
    const [textValue, setTextValue] = useState('');
    const textInputRef = useRef<HTMLInputElement>(null);

    // v1.26.2: 캔버스를 stage 영역 전체로 확장 (이미지 영역 바깥에도 그릴 수 있게).
    //          캔버스 픽셀 크기 = 이미지 자연 비율 유지하며 stage 비율에 맞게 확장.
    //          이미지는 캔버스 중앙에 그려져 저장 시 자동 포함됨.
    const [canvasImageRect, setCanvasImageRect] = useState<{
      canvasW: number;
      canvasH: number;
      imgX: number;
      imgY: number;
      imgW: number;
      imgH: number;
    } | null>(null);

    useEffect(() => {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!img || !canvas || !container) return;
      const setSize = () => {
        if (img.naturalWidth === 0) return;
        // 스테이지 비율 기반 캔버스 크기 — 이미지의 자연 픽셀 밀도를 유지하면서 stage 영역 전체를 덮음
        const cRect = container.getBoundingClientRect();
        const stageRatio = cRect.width / cRect.height;
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        const imgRatio = imgW / imgH;
        // 캔버스가 stage 비율을 가지면서 이미지가 100% contain
        let canvasW: number;
        let canvasH: number;
        if (stageRatio > imgRatio) {
          // stage 가 더 가로로 길면 → 캔버스 높이 = 이미지 높이, 너비 = 이미지 높이 × stageRatio
          canvasH = imgH;
          canvasW = Math.round(imgH * stageRatio);
        } else {
          canvasW = imgW;
          canvasH = Math.round(imgW / stageRatio);
        }
        canvas.width = canvasW;
        canvas.height = canvasH;
        const imgX = Math.round((canvasW - imgW) / 2);
        const imgY = Math.round((canvasH - imgH) / 2);
        setCanvasImageRect({ canvasW, canvasH, imgX, imgY, imgW, imgH });
      };
      if (img.complete && img.naturalWidth > 0) setSize();
      else img.addEventListener('load', setSize);
      const ro = new ResizeObserver(setSize);
      ro.observe(container);
      return () => {
        img.removeEventListener('load', setSize);
        ro.disconnect();
      };
    }, [imageUrl]);

    const getCtx = useCallback((): CanvasRenderingContext2D | null => {
      return canvasRef.current?.getContext('2d') ?? null;
    }, []);

    const saveSnapshot = useCallback(() => {
      const c = canvasRef.current;
      if (!c) return;
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push(c.toDataURL());
      historyIndexRef.current++;
      if (historyRef.current.length > 50) {
        historyRef.current.shift();
        historyIndexRef.current--;
      }
      hasDrawnRef.current = true;
    }, []);

    const handleUndo = useCallback(() => {
      const c = canvasRef.current;
      const ctx = getCtx();
      if (!c || !ctx) return;
      if (historyIndexRef.current <= 0) {
        ctx.clearRect(0, 0, c.width, c.height);
        historyIndexRef.current = -1;
        hasDrawnRef.current = false;
        return;
      }
      historyIndexRef.current--;
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = historyRef.current[historyIndexRef.current];
    }, [getCtx]);

    const handleClear = useCallback(() => {
      const c = canvasRef.current;
      const ctx = getCtx();
      if (!c || !ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      historyRef.current = [];
      historyIndexRef.current = -1;
      hasDrawnRef.current = false;
    }, [getCtx]);

    useImperativeHandle(ref, () => ({
      getCanvas: () => canvasRef.current,
      clear: handleClear,
      isEmpty: () => !hasDrawnRef.current,
    }), [handleClear]);

    const getCanvasPos = useCallback((e: React.MouseEvent): Point => {
      const c = canvasRef.current;
      if (!c) return { x: 0, y: 0 };
      const rect = c.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * c.width) / rect.width,
        y: ((e.clientY - rect.top) * c.height) / rect.height,
      };
    }, []);

    const drawShape = useCallback(
      (ctx: CanvasRenderingContext2D, t: DrawTool, start: Point, end: Point, baseW: number) => {
        if (t === 'rect') {
          if (shapeFill) ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
          else ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
        } else if (t === 'circle') {
          const rx = Math.abs(end.x - start.x) / 2;
          const ry = Math.abs(end.y - start.y) / 2;
          const cx = (start.x + end.x) / 2;
          const cy = (start.y + end.y) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          if (shapeFill) ctx.fill();
          else ctx.stroke();
        } else if (t === 'line') {
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        } else if (t === 'arrow') {
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const head = baseW * 3;
          ctx.beginPath();
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
          ctx.moveTo(end.x, end.y);
          ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        }
      },
      [shapeFill],
    );

    const handleMouseDown = (e: React.MouseEvent) => {
      const c = canvasRef.current;
      const ctx = getCtx();
      if (!c || !ctx) return;
      const p = getCanvasPos(e);

      // 캔버스 스케일에 맞춰 strokeWidth 조정 (디스플레이 vs 자연 크기)
      const displayW = containerRef.current?.clientWidth ?? c.width;
      const scale = c.width / Math.max(1, displayW);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = strokeWidth * scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = tool === 'pen' ? (opacity / 100) * 0.5 : opacity / 100;
      ctx.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';

      if (tool === 'text') {
        // window.prompt 차단 환경 대응 — 캔버스 위 inline input
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;
        setTextInput({
          screenX: e.clientX - containerRect.left,
          screenY: e.clientY - containerRect.top,
          canvasX: p.x,
          canvasY: p.y,
        });
        setTextValue('');
        setTimeout(() => textInputRef.current?.focus(), 0);
        return;
      }

      drawingRef.current = true;
      startPosRef.current = p;
      if (tool === 'pen' || tool === 'erase') {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
      } else {
        // 도형 미리보기용 스냅샷
        snapshotRef.current = ctx.getImageData(0, 0, c.width, c.height);
      }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
      if (!drawingRef.current) return;
      const ctx = getCtx();
      const c = canvasRef.current;
      if (!ctx || !c || !startPosRef.current) return;
      const p = getCanvasPos(e);
      if (tool === 'pen' || tool === 'erase') {
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (snapshotRef.current) {
        ctx.putImageData(snapshotRef.current, 0, 0);
        drawShape(ctx, tool, startPosRef.current, p, ctx.lineWidth);
      }
    };

    const handleMouseUp = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      saveSnapshot();
    };

    // Ctrl+Z
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        }
      };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }, [handleUndo]);

    const commitText = useCallback(() => {
      if (!textInput || !textValue.trim()) {
        setTextInput(null);
        setTextValue('');
        return;
      }
      const ctx = getCtx();
      const c = canvasRef.current;
      if (!ctx || !c) return;
      const displayW = c.getBoundingClientRect().width;
      const scale = c.width / Math.max(1, displayW);
      ctx.globalAlpha = opacity / 100;
      ctx.globalCompositeOperation = 'source-over';
      const fontSize = strokeWidth * 4 * scale;
      ctx.font = `${fontSize}px "Pretendard", sans-serif`;
      ctx.textBaseline = 'top';
      if (textOutline) {
        // 윤곽선 — strokeWidth 기반 lineWidth, 흰색은 검정으로 대비
        ctx.lineWidth = Math.max(2, fontSize * 0.08);
        ctx.strokeStyle = color === '#FFFFFF' ? '#0F1117' : '#FFFFFF';
        ctx.strokeText(textValue, textInput.canvasX, textInput.canvasY);
      }
      ctx.fillStyle = color;
      ctx.fillText(textValue, textInput.canvasX, textInput.canvasY);
      saveSnapshot();
      setTextInput(null);
      setTextValue('');
    }, [textInput, textValue, color, opacity, strokeWidth, textOutline, getCtx, saveSnapshot]);

    // 텍스트 입력 박스 드래그 이동 (확정 전 위치 조정)
    const textDragRef = useRef<{ startScreenX: number; startScreenY: number; startMouseX: number; startMouseY: number } | null>(null);
    const handleTextDragMouseMove = useCallback((e: MouseEvent) => {
      if (!textDragRef.current) return;
      const { startScreenX, startScreenY, startMouseX, startMouseY } = textDragRef.current;
      const dx = e.clientX - startMouseX;
      const dy = e.clientY - startMouseY;
      setTextInput((prev) => prev ? {
        ...prev,
        screenX: startScreenX + dx,
        screenY: startScreenY + dy,
        canvasX: prev.canvasX + dx * (canvasRef.current ? canvasRef.current.width / canvasRef.current.getBoundingClientRect().width : 1) - (prev.canvasX - prev.canvasX), // 단순화 — 실제 canvasX 갱신은 별도
      } : prev);
    }, []);
    const handleTextDragMouseUp = useCallback(() => {
      textDragRef.current = null;
      document.removeEventListener('mousemove', handleTextDragMouseMove);
      document.removeEventListener('mouseup', handleTextDragMouseUp);
    }, [handleTextDragMouseMove]);
    const beginTextDrag = useCallback((e: React.MouseEvent) => {
      if (!textInput) return;
      e.preventDefault();
      e.stopPropagation();
      textDragRef.current = {
        startScreenX: textInput.screenX,
        startScreenY: textInput.screenY,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
      };
      document.addEventListener('mousemove', handleTextDragMouseMove);
      document.addEventListener('mouseup', handleTextDragMouseUp);
    }, [textInput, handleTextDragMouseMove, handleTextDragMouseUp]);

    // 텍스트 드래그 후 캔버스 좌표도 동기화
    useEffect(() => {
      if (!textInput) return;
      const c = canvasRef.current;
      const container = containerRef.current;
      if (!c || !container) return;
      const cRect = c.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      // screenX/Y 는 container 기준 → canvas 화면 좌표 = screen - (cRect.left - contRect.left)
      const xOnCanvas = textInput.screenX - (cRect.left - contRect.left);
      const yOnCanvas = textInput.screenY - (cRect.top - contRect.top);
      const newCanvasX = (xOnCanvas * c.width) / cRect.width;
      const newCanvasY = (yOnCanvas * c.height) / cRect.height;
      if (newCanvasX !== textInput.canvasX || newCanvasY !== textInput.canvasY) {
        setTextInput((prev) => prev ? { ...prev, canvasX: newCanvasX, canvasY: newCanvasY } : prev);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [textInput?.screenX, textInput?.screenY]);

    // 캔버스/이미지 display 크기 계산 — stage 비율 기준, zoom 적용
    // (canvas 가 stage 비율을 가지므로 화면에서도 stage 100% × zoom 으로 표시)
    return (
      <div
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center bg-[#0a0c12] overflow-hidden select-none"
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          const delta = e.deltaY > 0 ? -0.1 : 0.1;
          setZoom((z) => Math.min(4, Math.max(0.25, Math.round((z + delta) * 100) / 100)));
        }}
      >
        {/* 줌 wrapper — 캔버스 + 이미지를 함께 transform */}
        <div
          className="relative"
          style={{
            width: '100%',
            height: '100%',
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          {/* 숨김 이미지 — naturalWidth/Height 측정용. 표시는 캔버스 위에 함 */}
          <img
            ref={imgRef}
            src={imageUrl}
            className="hidden"
            alt=""
            draggable={false}
          />
          {/* 화면용 이미지 — 캔버스 위치에 contained */}
          {canvasImageRect && (
            <img
              src={imageUrl}
              className="absolute pointer-events-none select-none"
              alt=""
              draggable={false}
              style={{
                top: `${(canvasImageRect.imgY / canvasImageRect.canvasH) * 100}%`,
                left: `${(canvasImageRect.imgX / canvasImageRect.canvasW) * 100}%`,
                width: `${(canvasImageRect.imgW / canvasImageRect.canvasW) * 100}%`,
                height: `${(canvasImageRect.imgH / canvasImageRect.canvasH) * 100}%`,
              }}
            />
          )}
          <canvas
            ref={canvasRef}
            className="absolute inset-0"
            style={{
              width: '100%',
              height: '100%',
              cursor: tool === 'text' ? 'text' : tool === 'erase' ? 'cell' : 'crosshair',
              userSelect: 'none',
            }}
            onMouseDown={(e) => { e.preventDefault(); handleMouseDown(e); }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { drawingRef.current = false; }}
          />
        </div>

        {/* 줌 컨트롤 (좌상단) */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1 bg-bg-card/95 backdrop-blur border border-bg-border/60 rounded-lg px-2 py-1 text-xs">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))}
            className="w-6 h-6 hover:bg-bg-border/50 rounded text-text-secondary hover:text-text-primary"
            title="축소 (Ctrl + 휠)"
          >−</button>
          <span className="tabular-nums w-12 text-center text-text-primary">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 100) / 100))}
            className="w-6 h-6 hover:bg-bg-border/50 rounded text-text-secondary hover:text-text-primary"
            title="확대 (Ctrl + 휠)"
          >+</button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="ml-1 px-1.5 h-6 hover:bg-bg-border/50 rounded text-text-secondary hover:text-text-primary text-[11px]"
            title="100%"
          >1:1</button>
        </div>

        {/* v1.26.1: 텍스트 inline 입력 박스 — window.prompt 차단 환경 대응 + 드래그로 위치 이동 */}
        {textInput && (
          <div
            className="absolute z-30 flex items-stretch shadow-lg"
            style={{ left: textInput.screenX, top: textInput.screenY }}
            data-allow-context-menu
          >
            {/* 드래그 핸들 */}
            <div
              onMouseDown={beginTextDrag}
              className="bg-accent text-white px-1.5 rounded-l flex items-center cursor-move select-none"
              title="드래그로 이동"
              aria-label="텍스트 위치 이동"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
            </div>
            <input
              ref={textInputRef}
              type="text"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitText(); }
                else if (e.key === 'Escape') { e.preventDefault(); setTextInput(null); setTextValue(''); }
              }}
              onBlur={() => {
                // 드래그 중에는 blur 로 확정 X — 핸들 mousedown 으로 인한 일시 blur 가드
                if (textDragRef.current) {
                  setTimeout(() => textInputRef.current?.focus(), 0);
                  return;
                }
                commitText();
              }}
              placeholder="텍스트 입력 후 Enter"
              className="bg-bg-card border border-accent border-l-0 rounded-r px-2 py-1 outline-none leading-none"
              style={{
                color,
                opacity: opacity / 100,
                minWidth: 140,
                // v1.26.2: 굵기 슬라이더 값에 따라 실제 렌더 폰트 사이즈와 동일하게 미리보기.
                //          fontSize = strokeWidth × 4 (캔버스/화면 비율은 캔버스 좌표계와 동일하므로 그대로).
                fontSize: `${strokeWidth * 4}px`,
                fontFamily: '"Pretendard", sans-serif',
              }}
            />
          </div>
        )}

        <AnnotationToolbar
          tool={tool}
          color={color}
          strokeWidth={strokeWidth}
          opacity={opacity}
          shapeFill={shapeFill}
          textOutline={textOutline}
          onToolChange={setTool}
          onColorChange={setColor}
          onStrokeChange={setStrokeWidth}
          onOpacityChange={setOpacity}
          onShapeFillChange={setShapeFill}
          onTextOutlineChange={setTextOutline}
          onUndo={handleUndo}
          onClear={handleClear}
        />

        {/* 좌하단 — 메타 + 주석 텍스트 메모 입력 */}
        <div className="absolute bottom-3 left-3 right-3 z-20 flex items-end gap-3 pointer-events-none">
          <div className="text-[11px] text-text-secondary bg-bg-primary/70 backdrop-blur px-2.5 py-1 rounded shrink-0">
            <strong className="text-text-primary">대상</strong>: v{baseVersionNo} 위 · <strong className="text-text-primary">저장 시</strong>: v{baseVersionNo + 1} (주석)
          </div>
          {/* v1.26.2: 주석 텍스트 메모 — 캔버스 그림 + 함께 저장 */}
          <textarea
            value={descValue}
            onChange={(e) => setDescValue(e.target.value)}
            placeholder="이 주석에 대한 설명을 입력하세요 (선택)"
            className="pointer-events-auto flex-1 max-w-xl bg-bg-primary/75 backdrop-blur border border-bg-border/70 rounded px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent/70 resize-none"
            rows={2}
            data-allow-context-menu
          />
        </div>
      </div>
    );
  },
);
