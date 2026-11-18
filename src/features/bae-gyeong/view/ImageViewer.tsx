// 그림 크게 보기 — 창 전체를 덮는 어두운 칸에 그림 한 장. 처음엔 화면에 맞추고, 휠은 커서 둘레로 확대 · 축소,
// 끌면 옮기기, 두 번 누르면 맞춤 ↔ 원본 크기(100%), 오른쪽 아래 길잡이(작은 그림 + 지금 보이는 곳)를 누르거나 끌면 그곳으로.
// 키: + / − / 0(맞추기) / 1(원본 크기) / 화살표(옮기기) / Esc(닫기). 초점은 창 안에 가두고 닫으면 연 자리로 돌려준다.
// 그림은 <img> 하나를 transform 으로만 움직인다(캔버스 복사 없음) — 3840×2160 도 가볍게. 200% 부터는 픽셀을 네모로 보인다.
// BAE경 창들과 같은 층(body 로 띄우고 .bae-root 토큰, z-index 100 — windows/BaeWindow 와 같은 규칙). 움직임은 transform · opacity 만.
//
// 쓰는 법: <ImageViewer src={…} alt={…} title="이름" onClose={…} /> 를 열려 있을 때만 그리거나,
//   const zoom = useImageViewer(); … zoom.open({ src, alt, title }); … {zoom.viewer}
import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Scan, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useModalFocus } from '@/hooks/useModalFocus';
import {
  IV_PIXEL_SCALE, ivAllVisible, ivCenterOn, ivClamp, ivClampScale, ivFit, ivFitScale, ivIsFit, ivMinScale, ivNavRect, ivNavSize,
  ivPercent, ivResize, ivStep, ivWheelFactor, ivZoomTo, type IvSize, type IvView,
} from './imageViewMath';
import './image-viewer.css';

export interface ImageViewerItem {
  src: string;
  alt: string;
  /** 머리 줄 이름 (기록 이름 등). 옆에 그림 크기가 붙는다. */
  title?: string | null;
}
export interface ImageViewerProps extends ImageViewerItem {
  onClose(): void;
}

const PAN_STEP = 80;

export function ImageViewer({ src, alt, title, onClose }: ImageViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // 먼저 불러야 연 자리(초점)를 기억한다 — 닫히면 그리로 돌려준다.
  const { onKeyDown: trapTab } = useModalFocus(rootRef, { active: true });
  const titleId = useId();

  const [img, setImg] = useState<IvSize | null>(null);
  const [failed, setFailed] = useState(false);
  const [box, setBox] = useState<IvSize | null>(null);
  const [view, setView] = useState<IvView | null>(null);
  const [anim, setAnim] = useState(false);
  const [dragging, setDragging] = useState(false);
  // 그리는 사이 여러 번 온 휠 · 끌기가 서로 덮지 않게 지금 값은 ref 가 쥔다.
  const viewRef = useRef<IvView | null>(null);
  const imgRef = useRef<IvSize | null>(null);
  const boxRef = useRef<IvSize | null>(null);
  imgRef.current = img;
  boxRef.current = box;
  /** 아직 맞춘 그대로다 → 칸 크기가 바뀌면 다시 맞춘다. */
  const fitRef = useRef(true);
  const prevBoxRef = useRef<IvSize | null>(null);
  const dragRef = useRef<{ id: number; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);
  const navDragRef = useRef<number | null>(null);

  const commit = useCallback((next: IvView, opts: { anim?: boolean; fit?: boolean } = {}) => {
    viewRef.current = next;
    fitRef.current = !!opts.fit;
    setAnim(!!opts.anim);
    setView(next);
  }, []);

  // 열리면 창에 초점 (키가 바로 듣는다)
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // 보는 칸 크기
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      setBox((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // 그림 크기를 알거나 칸이 바뀌면: 처음 · 맞춘 그대로면 다시 맞추고, 아니면 보던 가운데를 지킨다.
  useLayoutEffect(() => {
    if (!img || !box || box.w <= 0 || box.h <= 0) return;
    const prev = prevBoxRef.current;
    prevBoxRef.current = box;
    const v = viewRef.current;
    if (!v || fitRef.current) commit(ivFit(img, box), { fit: true });
    else commit(prev ? ivResize(v, prev, box, img) : ivClamp(v, img, box));
  }, [img, box, commit]);

  // 그림 크기를 안다 (load 와, 이미 받아 둔 그림이라 load 가 먼저 끝났을 때 — 같은 크기면 다시 맞추지 않는다)
  const imgElRef = useRef<HTMLImageElement>(null);
  const takeSize = useCallback((el: HTMLImageElement | null) => {
    if (!el || !el.complete || el.naturalWidth <= 0 || el.naturalHeight <= 0) return;
    const w = el.naturalWidth;
    const h = el.naturalHeight;
    setFailed(false);
    setImg((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);
  useEffect(() => { takeSize(imgElRef.current); }, [takeSize]);

  // 휠: 커서 둘레로 확대 · 축소 (페이지 확대 · 뒤 화면 스크롤이 되지 않게 passive 가 아닌 듣기)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const i = imgRef.current;
      const b = boxRef.current;
      const v = viewRef.current;
      if (!i || !b || !v) return;
      const r = stage.getBoundingClientRect();
      commit(ivZoomTo(v, v.s * ivWheelFactor(e.deltaY, e.deltaMode), e.clientX - r.left, e.clientY - r.top, i, b));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [commit]);

  const ready = !!(img && box && view);

  const zoomStep = (dir: 1 | -1) => {
    const i = imgRef.current; const b = boxRef.current; const v = viewRef.current;
    if (!i || !b || !v) return;
    commit(ivZoomTo(v, ivStep(v.s, dir, i, b), b.w / 2, b.h / 2, i, b), { anim: true });
  };
  const fit = () => {
    const i = imgRef.current; const b = boxRef.current;
    if (!i || !b) return;
    commit(ivFit(i, b), { anim: true, fit: true });
  };
  const actual = (cx?: number, cy?: number) => {
    const i = imgRef.current; const b = boxRef.current; const v = viewRef.current;
    if (!i || !b || !v) return;
    commit(ivZoomTo(v, 1, cx ?? b.w / 2, cy ?? b.h / 2, i, b), { anim: true, fit: Math.abs(ivFitScale(i, b) - 1) < 0.001 });
  };
  const pan = (dx: number, dy: number) => {
    const i = imgRef.current; const b = boxRef.current; const v = viewRef.current;
    if (!i || !b || !v) return;
    const next = ivClamp({ s: v.s, x: v.x + dx, y: v.y + dy }, i, b);
    if (next.x !== v.x || next.y !== v.y) commit(next, { anim: true });
  };
  const close = () => onCloseRef.current();

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // 이 창이 맨 위다 — 키는 뒤(작업 창 · 앱 단축키)로 넘기지 않는다.
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const root = rootRef.current;
      if (root && document.activeElement === root) {
        const list = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])'));
        if (list.length) { e.preventDefault(); (e.shiftKey ? list[list.length - 1] : list[0]).focus(); }
        return;
      }
      trapTab(e);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const step = e.shiftKey ? PAN_STEP * 4 : PAN_STEP;
    switch (e.key) {
      case '+': case '=': zoomStep(1); break;
      case '-': case '_': zoomStep(-1); break;
      case '0': fit(); break;
      case '1': actual(); break;
      case 'ArrowLeft': pan(step, 0); break;
      case 'ArrowRight': pan(-step, 0); break;
      case 'ArrowUp': pan(0, step); break;
      case 'ArrowDown': pan(0, -step); break;
      default: return;
    }
    e.preventDefault();
  };

  // 끌어서 옮기기
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const v = viewRef.current;
    if (e.button !== 0 || !v) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: v.x, y: v.y, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const i = imgRef.current; const b = boxRef.current; const v = viewRef.current;
    if (!d || d.id !== e.pointerId || !i || !b || !v) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      d.moved = true;
      setDragging(true);
    }
    const next = ivClamp({ s: v.s, x: d.x + dx, y: d.y + dy }, i, b);
    if (next.x !== v.x || next.y !== v.y) commit(next);
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };
  // 두 번 누르기: 맞춤 ↔ 원본 크기 (누른 자리 둘레로)
  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const i = imgRef.current; const b = boxRef.current; const v = viewRef.current;
    if (!i || !b || !v || (e.target as Element).closest('.bae-iv-nav')) return;
    if (!ivIsFit(v, i, b)) { fit(); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const target = Math.abs(ivFitScale(i, b) - 1) < 0.01 ? 2 : 1;
    commit(ivZoomTo(v, target, e.clientX - r.left, e.clientY - r.top, i, b), { anim: true });
  };

  // 길잡이: 누르거나 끈 자리가 가운데로
  const nav = img ? ivNavSize(img) : null;
  const navMove = (e: ReactPointerEvent<HTMLDivElement>, animate: boolean) => {
    const el = navRef.current;
    const i = imgRef.current; const b = boxRef.current; const v = viewRef.current;
    if (!el || !nav || !i || !b || !v) return;
    const r = el.getBoundingClientRect();
    const nx = Math.min(nav.w, Math.max(0, e.clientX - r.left));
    const ny = Math.min(nav.h, Math.max(0, e.clientY - r.top));
    commit(ivCenterOn(v, nx, ny, nav.k, i, b), { anim: animate });
  };

  const showNav = ready && !ivAllVisible(view!, img!, box!);
  const navRect = showNav && nav ? ivNavRect(view!, img!, box!, nav.k) : null;
  const scale = view?.s ?? 0;
  // 끝에 닿아도 disabled 로 두지 않는다 — 누르던 버튼이 꺼지면 초점이 창 밖으로 빠져 Esc · 단축키가 듣지 않는다.
  const atMin = ready && scale <= ivMinScale(img!, box!) * 1.001;
  const atMax = ready && scale >= ivClampScale(Infinity, img!, box!) * 0.999;
  const name = title?.trim() || '그림 크게 보기';

  return createPortal(
    <div ref={rootRef} className="bae-root bae-iv" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="bae-iv-bar">
        <h2 className="bae-iv-title" id={titleId}>
          <span className="bae-iv-name">{name}</span>
          {img ? <span className="bae-iv-size bae-num">{`· ${img.w} × ${img.h}`}</span> : null}
        </h2>
        <div className="bae-iv-tools" role="group" aria-label="보는 크기">
          <button type="button" className="bae-iv-btn bae-iv-ib" aria-label="작게 보기" title="작게 보기 (−)" disabled={!ready} aria-disabled={atMin || undefined} onClick={() => zoomStep(-1)}>
            <ZoomOut size={16} aria-hidden="true" />
          </button>
          <span className="bae-iv-pct bae-num" title="지금 보는 크기">{ready ? ivPercent(scale) : '—'}</span>
          <button type="button" className="bae-iv-btn bae-iv-ib" aria-label="크게 보기" title="크게 보기 (+)" disabled={!ready} aria-disabled={atMax || undefined} onClick={() => zoomStep(1)}>
            <ZoomIn size={16} aria-hidden="true" />
          </button>
          <span className="bae-iv-sep" aria-hidden="true" />
          <button type="button" className="bae-iv-btn" aria-label="화면에 맞추기" title="그림 전체가 화면에 들어오게 (0)" disabled={!ready} onClick={fit}>
            <Scan size={15} aria-hidden="true" /><span className="bae-iv-lbl">화면에 맞추기</span>
          </button>
          <button type="button" className="bae-iv-btn" aria-label="원본 크기" title="그림 1픽셀을 화면 1픽셀로 (1)" disabled={!ready} onClick={() => actual()}>
            <span className="bae-iv-one" aria-hidden="true">1:1</span><span className="bae-iv-lbl">원본 크기</span>
          </button>
        </div>
        <button type="button" className="bae-iv-btn bae-iv-ib bae-iv-close" aria-label="닫기" title="닫기 (Esc)" onClick={close}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div
        ref={stageRef}
        className={`bae-iv-stage${ready && !ivAllVisible(view!, img!, box!) ? ' can-pan' : ''}${dragging ? ' is-drag' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      >
        <img
          ref={imgElRef}
          className={`bae-iv-img${ready ? ' is-ready' : ''}${anim ? ' is-anim' : ''}${scale >= IV_PIXEL_SCALE ? ' is-px' : ''}`}
          src={src}
          alt={alt}
          draggable={false}
          decoding="async"
          style={img && view ? { width: img.w, height: img.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` } : undefined}
          onLoad={(e) => takeSize(e.currentTarget)}
          onError={() => setFailed(true)}
        />
        {!img && !failed ? <p className="bae-iv-msg" role="status">그림을 불러오고 있어요</p> : null}
        {failed ? <p className="bae-iv-msg" role="alert">그림을 불러오지 못했어요. 닫고 다시 열어 주세요.</p> : null}
        {ready ? <p className="bae-iv-hint" aria-hidden="true">휠로 확대 · 끌어서 옮기기 · 두 번 눌러 맞춤과 원본 크기</p> : null}
        {showNav && nav && navRect ? (
          <div
            ref={navRef}
            className="bae-iv-nav"
            style={{ width: nav.w, height: nav.h }}
            title="누르거나 끌어서 보는 곳을 옮겨요"
            aria-hidden="true"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              navDragRef.current = e.pointerId;
              navMove(e, true);
            }}
            onPointerMove={(e) => { e.stopPropagation(); if (navDragRef.current === e.pointerId) navMove(e, false); }}
            onPointerUp={(e) => {
              e.stopPropagation();
              if (navDragRef.current !== e.pointerId) return;
              navDragRef.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={(e) => { e.stopPropagation(); navDragRef.current = null; }}
          >
            <img className="bae-iv-nav-img" src={src} alt="" draggable={false} decoding="async" />
            <span
              className="bae-iv-nav-box"
              style={{ width: navRect.width, height: navRect.height, transform: `translate(${navRect.left}px, ${navRect.top}px)` }}
            />
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 어디서든 그림 크게 보기를 여는 작은 고리.
 *   const zoom = useImageViewer();
 *   <button onClick={() => zoom.open({ src, alt, title })}>크게 보기</button>
 *   {zoom.viewer}
 */
export function useImageViewer(): { open(item: ImageViewerItem): void; close(): void; isOpen: boolean; viewer: ReactNode } {
  const [item, setItem] = useState<ImageViewerItem | null>(null);
  const open = useCallback((next: ImageViewerItem) => setItem(next), []);
  const close = useCallback(() => setItem(null), []);
  const viewer = item ? <ImageViewer key={item.src} src={item.src} alt={item.alt} title={item.title} onClose={close} /> : null;
  return { open, close, isOpen: !!item, viewer };
}
