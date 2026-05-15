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
}

type Point = { x: number; y: number };

export const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, AnnotationCanvasProps>(
  function AnnotationCanvas({ imageUrl, baseVersionNo }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [tool, setTool] = useState<DrawTool>('pen');
    const [color, setColor] = useState<string>('#EB5757');
    const [strokeWidth, setStrokeWidth] = useState<number>(4);
    const [opacity, setOpacity] = useState<number>(100);

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

    // 이미지 자연 크기에 맞춰 캔버스 크기 설정
    useEffect(() => {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      if (!img || !canvas) return;
      const setSize = () => {
        if (img.naturalWidth === 0) return;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      };
      if (img.complete && img.naturalWidth > 0) setSize();
      else img.addEventListener('load', setSize);
      return () => img.removeEventListener('load', setSize);
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
          ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
        } else if (t === 'circle') {
          const rx = Math.abs(end.x - start.x) / 2;
          const ry = Math.abs(end.y - start.y) / 2;
          const cx = (start.x + end.x) / 2;
          const cy = (start.y + end.y) / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
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
      [],
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
      ctx.fillStyle = color;
      ctx.globalAlpha = opacity / 100;
      ctx.globalCompositeOperation = 'source-over';
      const fontSize = strokeWidth * 4 * scale;
      ctx.font = `${fontSize}px "Pretendard", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(textValue, textInput.canvasX, textInput.canvasY);
      saveSnapshot();
      setTextInput(null);
      setTextValue('');
    }, [textInput, textValue, color, opacity, strokeWidth, getCtx, saveSnapshot]);

    return (
      <div ref={containerRef} className="relative w-full h-full flex items-center justify-center bg-[#0a0c12] overflow-hidden select-none">
        <img
          ref={imgRef}
          src={imageUrl}
          className="max-w-full max-h-full select-none pointer-events-none object-contain"
          alt=""
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          className="absolute"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: imgRef.current?.clientWidth ?? '100%',
            height: imgRef.current?.clientHeight ?? '100%',
            cursor: tool === 'text' ? 'text' : tool === 'erase' ? 'cell' : 'crosshair',
            userSelect: 'none',
          }}
          onMouseDown={(e) => { e.preventDefault(); handleMouseDown(e); }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { drawingRef.current = false; }}
        />

        {/* v1.26.1: 텍스트 inline 입력 박스 — window.prompt 차단 환경 대응 */}
        {textInput && (
          <input
            ref={textInputRef}
            type="text"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitText(); }
              else if (e.key === 'Escape') { e.preventDefault(); setTextInput(null); setTextValue(''); }
            }}
            onBlur={commitText}
            placeholder="텍스트 입력 후 Enter"
            className="absolute z-30 bg-bg-card border border-accent rounded px-2 py-1 text-sm outline-none shadow-lg"
            style={{
              left: textInput.screenX,
              top: textInput.screenY,
              color: color,
              minWidth: 140,
            }}
          />
        )}

        <AnnotationToolbar
          tool={tool}
          color={color}
          strokeWidth={strokeWidth}
          opacity={opacity}
          onToolChange={setTool}
          onColorChange={setColor}
          onStrokeChange={setStrokeWidth}
          onOpacityChange={setOpacity}
          onUndo={handleUndo}
          onClear={handleClear}
        />

        <div className="absolute bottom-3 left-3 text-[11px] text-text-secondary bg-bg-primary/70 backdrop-blur px-2.5 py-1 rounded">
          <strong className="text-text-primary">대상</strong>: v{baseVersionNo} 위에 그리는 중 · <strong className="text-text-primary">저장 시</strong>: v{baseVersionNo + 1} (주석) 자동 생성
        </div>
      </div>
    );
  },
);
