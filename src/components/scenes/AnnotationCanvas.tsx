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
  /** 합성용 캔버스 element (stage 비율로 확장된 자연 크기) */
  getCanvas(): HTMLCanvasElement | null;
  /** 캔버스 비우기 + 히스토리 초기화 */
  clear(): void;
  /** 빈 캔버스 여부 — 저장 가드 */
  isEmpty(): boolean;
  /** v1.26.2: 캔버스 안의 이미지 위치/크기 (합성 시 사용) */
  getImageRect(): { imgX: number; imgY: number; imgW: number; imgH: number } | null;
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
    // v1.26.2: 도형 채움 토글 + 모든 도구 공통 외곽선 + 외곽선 색상 분리
    const [shapeFill, setShapeFill] = useState<boolean>(false);
    const [outlineEnabled, setOutlineEnabled] = useState<boolean>(false);
    const [outlineColor, setOutlineColor] = useState<string>('#0F1117');
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
    // v1.26.2: 펜/지우개 segment-by-segment 그리기를 위한 이전 좌표 추적 (outline 지원)
    const prevPointRef = useRef<Point | null>(null);

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
        // v1.26.3: 캔버스 영역을 더 크게 — 이미지 사방으로 충분한 여백 (zoom out 시 외부 그리기 영역).
        //          stage 비율을 유지하면서 이미지가 캔버스 중앙 60%~70% 정도 차지.
        const cRect = container.getBoundingClientRect();
        const stageRatio = cRect.width / cRect.height;
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        const imgRatio = imgW / imgH;
        const EXPAND = 1.6; // 이미지 크기 대비 캔버스 배수 (사방 30% 여백)
        // 캔버스가 stage 비율을 가지면서 이미지 + 여백 포함
        let canvasW: number;
        let canvasH: number;
        if (stageRatio > imgRatio) {
          canvasH = Math.round(imgH * EXPAND);
          canvasW = Math.round(canvasH * stageRatio);
        } else {
          canvasW = Math.round(imgW * EXPAND);
          canvasH = Math.round(canvasW / stageRatio);
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
        // v1.30.2 (한솔 보고 2026-05-24): 이전 선이 연해지던 버그.
        //   원인: pen tool 등으로 globalAlpha < 1 가 남아있는 상태에서 drawImage 가 그 alpha 를 곱함.
        //   해결: undo 시점에는 항상 globalAlpha=1 + source-over 로 명시. save/restore 로 격리.
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
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
      getImageRect: () => canvasImageRect ? {
        imgX: canvasImageRect.imgX,
        imgY: canvasImageRect.imgY,
        imgW: canvasImageRect.imgW,
        imgH: canvasImageRect.imgH,
      } : null,
    }), [handleClear, canvasImageRect]);

    const getCanvasPos = useCallback((e: React.MouseEvent): Point => {
      const c = canvasRef.current;
      if (!c) return { x: 0, y: 0 };
      const rect = c.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * c.width) / rect.width,
        y: ((e.clientY - rect.top) * c.height) / rect.height,
      };
    }, []);

    // v1.26.2: outline 모드 지원 — 같은 path 를 outline 색으로 더 두껍게 stroke 한 뒤
    //          main 색으로 원래 두께로 stroke. fill 모드는 fill 후 추가 outline stroke.
    //          drawShape 호출자가 strokeStyle/lineWidth/fillStyle 를 main 으로 설정한 상태로 들어옴.
    const drawShape = useCallback(
      (ctx: CanvasRenderingContext2D, t: DrawTool, start: Point, end: Point, baseW: number) => {
        const mainStroke = ctx.strokeStyle as string;
        const mainWidth = ctx.lineWidth;
        const outlineLineWidth = mainWidth * 2.2;
        const applyOutlineStroke = (drawPath: () => void) => {
          if (!outlineEnabled) {
            drawPath();
            return;
          }
          // 1) outline 두껍게
          ctx.strokeStyle = outlineColor;
          ctx.lineWidth = outlineLineWidth;
          drawPath();
          // 2) main 원래 두께로
          ctx.strokeStyle = mainStroke;
          ctx.lineWidth = mainWidth;
          drawPath();
        };

        if (t === 'rect') {
          if (shapeFill) {
            ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
            if (outlineEnabled) {
              ctx.strokeStyle = outlineColor;
              ctx.lineWidth = mainWidth;
              ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
              ctx.strokeStyle = mainStroke;
            }
          } else {
            applyOutlineStroke(() => ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y));
          }
        } else if (t === 'circle') {
          const rx = Math.abs(end.x - start.x) / 2;
          const ry = Math.abs(end.y - start.y) / 2;
          const cx = (start.x + end.x) / 2;
          const cy = (start.y + end.y) / 2;
          const drawEllipse = () => {
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          };
          if (shapeFill) {
            drawEllipse();
            ctx.fill();
            if (outlineEnabled) {
              ctx.strokeStyle = outlineColor;
              ctx.lineWidth = mainWidth;
              drawEllipse();
              ctx.stroke();
              ctx.strokeStyle = mainStroke;
            }
          } else {
            applyOutlineStroke(() => { drawEllipse(); ctx.stroke(); });
          }
        } else if (t === 'line') {
          applyOutlineStroke(() => {
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
          });
        } else if (t === 'arrow') {
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const head = baseW * 3;
          applyOutlineStroke(() => {
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
          });
        }
      },
      [shapeFill, outlineEnabled, outlineColor],
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
        // window.prompt 차단 환경 대응 — 캔버스 위 inline input.
        // v1.26.3: wrapper 의 left/top 을 click 위치 - (drag handle + input padding) 로 저장.
        //          이렇게 하면 wrapper 안 input 의 텍스트 시작 위치가 정확히 click 위치와 일치.
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;
        const WRAPPER_OFFSET_X = 30; // drag handle (22) + input padding-l (8)
        const WRAPPER_OFFSET_Y = 5;  // border-t (1) + padding-t (4)
        setTextInput({
          screenX: e.clientX - containerRect.left - WRAPPER_OFFSET_X,
          screenY: e.clientY - containerRect.top - WRAPPER_OFFSET_Y,
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
        // v1.26.3: 펜 path 누적 — segment-by-segment 그리기가 만든 "브러쉬 느낌" 제거.
        //          mousedown 시 beginPath + moveTo. mousemove 시 lineTo + stroke (outline OFF) 또는
        //          path 전체에 outline+main 두 번 stroke (outline ON).
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        prevPointRef.current = p;
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
        // v1.26.3: path 누적 + outline 모드면 outline 한 번 + main 한 번 (path 전체)
        const mainStroke = ctx.strokeStyle as string;
        const mainWidth = ctx.lineWidth;
        ctx.lineTo(p.x, p.y);
        if (tool === 'pen' && outlineEnabled) {
          // outline 두꺼움 (먼저)
          ctx.strokeStyle = outlineColor;
          ctx.lineWidth = mainWidth + Math.max(2, mainWidth * 0.6);
          ctx.stroke();
          // main 얇음 (위)
          ctx.strokeStyle = mainStroke;
          ctx.lineWidth = mainWidth;
        }
        ctx.stroke();
        prevPointRef.current = p;
      } else if (snapshotRef.current) {
        ctx.putImageData(snapshotRef.current, 0, 0);
        drawShape(ctx, tool, startPosRef.current, p, ctx.lineWidth);
      }
    };

    // v1.28.0 (코덱스 1차 P2): mouseup 이 캔버스 밖에서 일어나도 finalize.
    //   사용자가 캔버스 안에서 누르고 밖에서 떼면 stroke 가 화면엔 남지만
    //   saveSnapshot 이 호출되지 않아 undo/isEmpty 체크가 어긋났다.
    //   document level pointerup 으로 일관되게 마무리.
    const handleMouseUp = useCallback(() => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      saveSnapshot();
    }, [saveSnapshot]);

    useEffect(() => {
      const onDocPointerUp = () => {
        if (drawingRef.current) {
          drawingRef.current = false;
          saveSnapshot();
        }
      };
      document.addEventListener('pointerup', onDocPointerUp);
      return () => document.removeEventListener('pointerup', onDocPointerUp);
    }, [saveSnapshot]);

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
      if (outlineEnabled) {
        // 윤곽선 — outlineColor 사용, 두께는 fontSize 비율
        ctx.lineWidth = Math.max(2, fontSize * 0.1);
        ctx.strokeStyle = outlineColor;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(textValue, textInput.canvasX, textInput.canvasY);
      }
      ctx.fillStyle = color;
      ctx.fillText(textValue, textInput.canvasX, textInput.canvasY);
      saveSnapshot();
      setTextInput(null);
      setTextValue('');
    }, [textInput, textValue, color, opacity, strokeWidth, outlineEnabled, outlineColor, getCtx, saveSnapshot]);

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

    // 텍스트 드래그 후 캔버스 좌표 동기화.
    // textInput.screenX/Y = wrapper 의 left/top (container 기준, 보정 적용).
    // 실제 텍스트 시작 위치 = (screenX + 30, screenY + 5).
    // 캔버스 그릴 좌표 = 텍스트 시작 위치를 캔버스 좌표계로 변환.
    useEffect(() => {
      if (!textInput) return;
      const c = canvasRef.current;
      const container = containerRef.current;
      if (!c || !container) return;
      const cRect = c.getBoundingClientRect();
      const contRect = container.getBoundingClientRect();
      const WRAPPER_OFFSET_X = 30;
      const WRAPPER_OFFSET_Y = 5;
      const textScreenX = textInput.screenX + WRAPPER_OFFSET_X;
      const textScreenY = textInput.screenY + WRAPPER_OFFSET_Y;
      const xOnCanvas = textScreenX - (cRect.left - contRect.left);
      const yOnCanvas = textScreenY - (cRect.top - contRect.top);
      const newCanvasX = (xOnCanvas * c.width) / cRect.width;
      const newCanvasY = (yOnCanvas * c.height) / cRect.height;
      if (Math.abs(newCanvasX - textInput.canvasX) > 0.5 || Math.abs(newCanvasY - textInput.canvasY) > 0.5) {
        setTextInput((prev) => prev ? { ...prev, canvasX: newCanvasX, canvasY: newCanvasY } : prev);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [textInput?.screenX, textInput?.screenY]);

    // v1.26.2: 휠 줌 — React onWheel 은 passive listener 라 preventDefault 가 막힘.
    //          native listener 를 { passive: false } 로 등록해 경고 제거 + 부모 스크롤 방지.
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const handler = (e: WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom((z) => Math.min(4, Math.max(0.25, Math.round((z + delta) * 100) / 100)));
      };
      el.addEventListener('wheel', handler, { passive: false });
      return () => el.removeEventListener('wheel', handler);
    }, []);

    return (
      <div
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center bg-[#0a0c12] overflow-hidden select-none"
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
            // v1.28.0 (코덱스 1차 P2): mouseLeave 에서 drawing 을 그냥 끊지 말고
            //   stroke 를 finalize 한다. document pointerup 안전망도 함께.
            onMouseLeave={() => {
              if (drawingRef.current) {
                drawingRef.current = false;
                saveSnapshot();
              }
            }}
          />
        </div>

        {/* 줌 컨트롤 — 좌상단 (저장 버튼은 우상단이므로 겹치지 않게) */}
        <div className="absolute top-3 left-3 z-20 flex items-center gap-1 bg-bg-card/95 backdrop-blur border border-bg-border/60 rounded-lg px-2 py-1 text-xs">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))}
            className="w-6 h-6 hover:bg-bg-border/50 rounded text-text-secondary hover:text-text-primary"
            title="축소 (휠 아래)"
          >−</button>
          <span className="tabular-nums w-12 text-center text-text-primary">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(4, Math.round((z + 0.1) * 100) / 100))}
            className="w-6 h-6 hover:bg-bg-border/50 rounded text-text-secondary hover:text-text-primary"
            title="확대 (휠 위)"
          >+</button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="ml-1 px-1.5 h-6 hover:bg-bg-border/50 rounded text-text-secondary hover:text-text-primary text-[11px]"
            title="100%"
          >1:1</button>
        </div>

        {/* v1.26.1: 텍스트 inline 입력 박스 — window.prompt 차단 환경 대응 + 드래그로 위치 이동.
            v1.26.3: textInput.screenX/Y 자체가 wrapper 의 left/top (mousedown 시 보정해서 저장).
                     이렇게 하면 wrapper 안 input 의 텍스트 시작 위치가 정확히 click 위치와 일치. */}
        {textInput && (
          <div
            className="absolute z-30 flex items-stretch shadow-lg"
            style={{
              left: textInput.screenX,
              top: textInput.screenY,
            }}
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
              onBlur={(e) => {
                // 드래그 중에는 blur 로 확정 X — 핸들 mousedown 으로 인한 일시 blur 가드
                if (textDragRef.current) {
                  setTimeout(() => textInputRef.current?.focus(), 0);
                  return;
                }
                // v1.26.3: 새로 focus 되는 element 가 도구바/옵션바 안이면 무시 + 다시 focus.
                //          (슬라이더 input[range] 조작 시 텍스트 박스가 닫히지 않게)
                const rt = e.relatedTarget as HTMLElement | null;
                if (rt && rt.closest('[data-annotation-toolbar]')) {
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
                // v1.26.2: 굵기 슬라이더 값에 따라 실제 렌더 폰트 사이즈/박스 폭/높이가 실시간 갱신.
                //          캔버스에 그려질 텍스트 크기와 화면에서 보이는 미리보기 크기가 일치.
                fontSize: `${strokeWidth * 4}px`,
                minWidth: Math.max(140, strokeWidth * 4 * 5),
                fontFamily: '"Pretendard", sans-serif',
                // 윤곽선 미리보기 — outline ON 일 때 텍스트에 stroke 효과 (CSS text-shadow 4방향)
                textShadow: outlineEnabled
                  ? `-1px -1px 0 ${outlineColor}, 1px -1px 0 ${outlineColor}, -1px 1px 0 ${outlineColor}, 1px 1px 0 ${outlineColor}`
                  : undefined,
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
          outlineEnabled={outlineEnabled}
          outlineColor={outlineColor}
          onToolChange={setTool}
          onColorChange={setColor}
          onStrokeChange={setStrokeWidth}
          onOpacityChange={setOpacity}
          onShapeFillChange={setShapeFill}
          onOutlineEnabledChange={setOutlineEnabled}
          onOutlineColorChange={setOutlineColor}
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
