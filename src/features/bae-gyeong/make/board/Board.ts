/**
 * BAE경 그림판 엔진 (HTML v0.4.11 script_4.js 248~780줄 `Board` 를 옮김).
 * 배경 그림 + 칠 층(그림 모델에 감) + 빨간 메모 층(PD만 봄) + 투시 가이드(그림에 들어가지 않음).
 * HTML의 $('…') 화면 요소는 attach() 로 받은 요소로, 전역 state·LS·toast 는 옵션 콜백으로 바꿨다.
 * HTML의 open/close(완료로 닫는 전체 화면 창)는 없다: 재료 창 안에 늘 펼쳐져 있고, attach 가 open, detach 가 close.
 * 도구 글쇠(P·L·G …)는 옮기지 않았다. 그림판에 포커스가 있을 때 Ctrl+Z · Ctrl+Shift+Z · Ctrl+Y 와 메모 지우기(Delete)만 받는다.
 */
import { GUIDE_INITIAL, NOTE_COLOR, type GuideState, type PerspectiveId, type RatioId } from '@/shared/bae/order/constants';
import {
  CHIP_FONT, GEO0, GLYPH_FONT, HANDLE, clamp, dimsFor, dragGuide, frameGeo, guideFor, guideHit, guideScene, tiltStep, unturn, withGuideParam,
  type Geo, type GuideHandle, type GuideHandleId, type GuideParam, type GuideScene, type Pt,
} from './guideMath';
import { fitNotes, moveNote, noteAt, noteBox, noteWidth, notesSummary as notesSummaryText, ratioFit, textFont, textSizeFor, type BoardNote, type BoardPoint } from './notesMath';
import { applyFillMask, floodMask, hasColorOf, hexToRgb, paintShareOf, rgbToHex } from './fillMath';
import { dims, isPhotoLike, loadImg, makeCanvas, normalizeSrc, scaled, toBlob } from './image';

export type BoardTool = 'pen' | 'line' | 'rect' | 'ellipse' | 'fill' | 'eraser' | 'picker' | 'arrow' | 'text' | 'mark' | 'select' | 'guide';
export type BoardMode = 'rough' | 'guide';
export type BoardFit = 'contain' | 'cover';
export type FillMode = 'fill' | 'stroke';
export interface PlaceColor { hex: string; name?: string }
export interface BoardBg { img: HTMLImageElement; src: string; fit: BoardFit }

/** 이 PC에 기억할 값 (HTML LS). 지금은 페인트통 틈 메우기(fillGap) 하나 */
export interface BoardMemory { get(key: string, fallback: unknown): unknown; set(key: string, value: unknown): unknown }
const MEMORY_PREFIX = 'bae-gyeong.board.';
export const localBoardMemory: BoardMemory = {
  get(k, d) { try { const v = localStorage.getItem(MEMORY_PREFIX + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(MEMORY_PREFIX + k); else localStorage.setItem(MEMORY_PREFIX + k, JSON.stringify(v)); return true; } catch { return false; } },
};

/** HTML Board.init 의 콜백 (cb.change · guide · tilt · mode · preview · loaded) + 알림 + 비율 */
export interface BoardCallbacks {
  /** 그림이 바뀜 (rev 가 1 늘었다) */
  onChange?: () => void;
  /** 투시 가이드 값이 바뀜 (종류 · 자리 · '지평선 및 투시 참고하게 하기') */
  onGuide?: () => void;
  /** 화면 기울기가 바뀜 */
  onTilt?: (t: number) => void;
  /** 레이아웃 모드를 다시 알림 (HTML syncHead 마다) */
  onMode?: (m: BoardMode) => void;
  /** 미리보기를 다시 만들 때 (바뀐 뒤 0.5초, 떼어 낼 때 바로) */
  onPreview?: () => void;
  /** 그림을 불러옴 (빼면 null) */
  onLoaded?: (img: HTMLImageElement | null) => void;
  /** 짧은 알림 글 (HTML toast) */
  onToast?: (text: string) => void;
  /** setRatio 로 비율이 바뀜 (Bflow 에서 더함: HTML 은 바깥이 먼저 비율을 정했다) */
  onRatio?: (r: RatioId) => void;
}
export interface BoardOptions extends BoardCallbacks { memory?: BoardMemory }

/** 그림판 화면 요소 (BoardView 가 만든다) */
export interface BoardElements { root: HTMLElement; stage: HTMLElement; frame: HTMLElement; guide: HTMLCanvasElement; text: HTMLTextAreaElement; selBar: HTMLElement }

/** 화면이 그릴 상태 한 벌 (바뀔 때만 새 객체) */
export interface BoardUi {
  tool: BoardTool; color: string; width: number; fillMode: FillMode; gap: number; showGuide: boolean; showNotes: boolean; placeColors: PlaceColor[];
  canUndo: boolean; canRedo: boolean; mode: BoardMode; ratio: RatioId; fit: BoardFit; hasBg: boolean; hasContent: boolean; painted: boolean; noteCount: number;
  tilt: number; guide: GuideState; selected: boolean; rev: number;
  /** 불러온 그림이 사진·AI 그림 같다 (HTML state.photoLike: 파일로 불러올 때 정하고, '불러온 이미지 빼기'로 지운다) */
  photoLike: boolean;
}
/** 초안 저장용 (HTML serialize 그대로) */
export interface BoardDraft { ratio: RatioId; mode: BoardMode; bg: { src: string; fit: BoardFit } | null; paint: Blob | null; notes: BoardNote[]; guide: GuideState; tilt: number }

export interface Board {
  attach(els: BoardElements): void;
  detach(): void;
  isOpen(): boolean;
  setCallbacks(cb: BoardCallbacks): void;
  subscribe(fn: () => void): () => void;
  ui(): BoardUi;
  setRatio(r: RatioId): void;
  setMode(v: BoardMode): void;
  loadFile(f: File): Promise<void>;
  loadSrc(src: string): Promise<void>;
  setFit(v: BoardFit): void;
  clearAll(): void;
  clearPaint(): void;
  clearNotes(): void;
  clearBg(): void;
  setGuideType(type: PerspectiveId): void;
  setGuideParam(k: GuideParam, v: number | boolean): void;
  setTilt(v: number): void;
  setPlaceColors(list: PlaceColor[] | null | undefined): void;
  pickPlaceColor(hex: string): void;
  setTool(t: BoardTool): void;
  setColor(c: string): void;
  setWidth(w: number): void;
  setFillMode(v: FillMode): void;
  setGap(v: number): void;
  setShowGuide(v: boolean): void;
  setShowNotes(v: boolean): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  deleteSelected(): void;
  deselect(): void;
  exportClean(): HTMLCanvasElement;
  exportAnnotated(): HTMLCanvasElement;
  hasColor(): boolean;
  notesSummary(map?: ((x: number, y: number) => number[]) | null): string;
  serialize(): Promise<BoardDraft>;
  restore(o: Partial<BoardDraft> | null | undefined): Promise<void>;
  paintShare(): number;
  previewDataUrl(max?: number): string;
  tilt(): number;
  rev(): number;
  ratio(): RatioId;
  mode(): BoardMode;
  hasBg(): boolean;
  isGuide(): boolean;
  guide(): GuideState;
  noteCount(): number;
  hasContent(): boolean;
  /** 알림 글을 onToast 로 보낸다 (그림판 단추의 알림도 한 길로) */
  toast(text: string): void;
}

type StagePt = BoardPoint & { sx: number; sy: number };
type Drag =
  | { type: 'guide'; h: GuideHandleId; sx: number; sy: number; g0: GuideState }
  | { type: 'move'; last: StagePt; moved: boolean }
  | { type: 'stroke'; pts: StagePt[] }
  | { type: 'mark'; pts: Pt[] }
  | { type: 'shape'; a: StagePt; b: StagePt };
interface HistEntry { paint: Blob | null; painted: boolean; notes: string; bg: BoardBg | null; mode: BoardMode }
interface TextEdit { p: BoardPoint; size: number; note: Extract<BoardNote, { type: 'text' }> | null }

const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d') as CanvasRenderingContext2D;

export function createBoard(opts: BoardOptions = {}): Board {
  const cb: BoardCallbacks = { ...opts };
  const memory = opts.memory || localBoardMemory;
  const st = {
    ratio: '16:9' as RatioId, W: 1536, H: 864, bg: null as BoardBg | null, mode: 'rough' as BoardMode, notes: [] as BoardNote[], painted: false, rev: 0, tilt: 0,
    guide: { ...GUIDE_INITIAL } as GuideState,
  };
  const bgC = makeCanvas(st.W, st.H), paintC = makeCanvas(st.W, st.H), noteC = makeCanvas(st.W, st.H), prevC = makeCanvas(st.W, st.H);
  const bx = () => ctx2d(bgC), px = () => ctx2d(paintC), nx = () => ctx2d(noteC), vx = () => ctx2d(prevC);
  const mctx = ctx2d(makeCanvas(4, 4));
  const measure = (text: string, font: string) => { mctx.font = font; return mctx.measureText(text).width; };
  let tool: BoardTool = 'pen', color = '#26251F', width = 10, fillMode: FillMode = 'fill', showNotes = true, showGuide = true;
  let gap = Number(memory.get('fillGap', 4)) || 0, placeColors: PlaceColor[] = [], photoLike = false;
  let isOpen = false, selected: BoardNote | null = null, drag: Drag | null = null, textEdit: TextEdit | null = null, geo: Geo = { ...GEO0 }, handles: GuideHandle[] = [];
  const hist: HistEntry[] = []; let hi = -1; let chain: Promise<unknown> = Promise.resolve();
  let el: BoardElements | null = null; let ro: ResizeObserver | null = null; let raf = 0;

  /* --- 화면 상태 알림 (React useSyncExternalStore) --- */
  const listeners = new Set<() => void>();
  let uiCache: BoardUi | null = null, emitQueued = false;
  function emit() {
    uiCache = null; if (emitQueued) return; emitQueued = true;
    queueMicrotask(() => { emitQueued = false; listeners.forEach((l) => l()); });
  }
  function ui(): BoardUi {
    if (!uiCache) uiCache = {
      tool, color, width, fillMode, gap, showGuide, showNotes, placeColors, canUndo: hi > 0, canRedo: hi < hist.length - 1, mode: st.mode, ratio: st.ratio,
      fit: st.bg ? st.bg.fit : 'contain', hasBg: !!st.bg, hasContent: !!st.bg || st.painted || st.notes.length > 0, painted: st.painted, noteCount: st.notes.length,
      tilt: st.tilt || 0, guide: { ...st.guide }, selected: !!selected, rev: st.rev, photoLike,
    };
    return uiCache;
  }
  const toast = (t: string) => cb.onToast?.(t);

  function changed() { st.rev++; cb.onChange?.(); schedulePreview(); emit(); }
  let pvT: ReturnType<typeof setTimeout> | undefined;
  function schedulePreview() { clearTimeout(pvT); pvT = setTimeout(() => cb.onPreview?.(), isOpen ? 500 : 60); }

  /* --- 그리기 --- */
  function renderBg() {
    const x = bx(); x.setTransform(1, 0, 0, 1, 0, 0); x.filter = 'none'; x.fillStyle = '#fff'; x.fillRect(0, 0, st.W, st.H);
    if (!st.bg) return;
    const [iw, ih] = dims(st.bg.img); const k = st.bg.fit === 'cover' ? Math.max(st.W / iw, st.H / ih) : Math.min(st.W / iw, st.H / ih);
    const dw = iw * k, dh = ih * k, dx = (st.W - dw) / 2, dy = (st.H - dh) / 2;
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    if (st.mode === 'guide') { // 디테일 많은 AI 그림·사진은 일부러 흐리게: 모델이 따라 그리지 않고 새로 그리게
      const sw = Math.max(8, Math.round(st.W / 6.4)), sh = Math.max(8, Math.round(st.H / 6.4)); const kx = sw / st.W, ky = sh / st.H;
      const s1 = makeCanvas(sw, sh); const sx = ctx2d(s1); sx.fillStyle = '#fff'; sx.fillRect(0, 0, sw, sh); sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high'; sx.drawImage(st.bg.img, dx * kx, dy * ky, dw * kx, dh * ky);
      x.drawImage(s1, 0, 0, st.W, st.H); x.filter = 'blur(3px)'; x.drawImage(s1, 0, 0, st.W, st.H); x.filter = 'none';
    } else x.drawImage(st.bg.img, dx, dy, dw, dh);
  }
  function strokePath(ctx: CanvasRenderingContext2D, pts: Pt[]) {
    if (!pts.length) return; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); }
    if (pts.length > 1) { const l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]); }
    ctx.stroke();
  }
  function drawNotes(ctx: CanvasRenderingContext2D, list: BoardNote[], sel?: BoardNote | null) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const n of list) {
      if (n._editing) continue;
      if (n.type === 'arrow') {
        const ang = Math.atan2(n.y2 - n.y1, n.x2 - n.x1), head = Math.max(18, n.w * 3.4);
        const ex = n.x2 - Math.cos(ang) * head * 0.7, ey = n.y2 - Math.sin(ang) * head * 0.7;
        const tri = [[n.x2, n.y2], [n.x2 - Math.cos(ang - 0.45) * head, n.y2 - Math.sin(ang - 0.45) * head], [n.x2 - Math.cos(ang + 0.45) * head, n.y2 - Math.sin(ang + 0.45) * head]];
        for (const pass of [0, 1]) {
          const c = pass ? NOTE_COLOR : 'rgba(255,255,255,.92)'; ctx.strokeStyle = c; ctx.fillStyle = c;
          ctx.lineWidth = n.w + (pass ? 0 : 6); ctx.beginPath(); ctx.moveTo(n.x1, n.y1); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(tri[0][0], tri[0][1]); ctx.lineTo(tri[1][0], tri[1][1]); ctx.lineTo(tri[2][0], tri[2][1]); ctx.closePath();
          if (!pass) { ctx.lineWidth = 6; ctx.stroke(); } ctx.fill();
        }
      } else if (n.type === 'mark') {
        for (const pass of [0, 1]) { ctx.strokeStyle = pass ? NOTE_COLOR : 'rgba(255,255,255,.92)'; ctx.lineWidth = n.w + (pass ? 0 : 6); strokePath(ctx, n.pts); }
      } else if (n.type === 'text') {
        ctx.font = textFont(n.size); ctx.textBaseline = 'top'; const lh = n.size * 1.22;
        n.text.split('\n').forEach((ln, i) => { ctx.lineWidth = Math.max(4, n.size * 0.22); ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(ln, n.x, n.y + i * lh); ctx.fillStyle = NOTE_COLOR; ctx.fillText(ln, n.x, n.y + i * lh); });
      }
    }
    if (sel && list.includes(sel)) { const b = noteBox(sel, measure); ctx.setLineDash([10, 7]); ctx.strokeStyle = '#1E8CFF'; ctx.lineWidth = 2.5; ctx.strokeRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16); ctx.setLineDash([]); }
    ctx.restore();
  }
  function renderNotes() { const x = nx(); x.clearRect(0, 0, st.W, st.H); if (showNotes) drawNotes(x, st.notes, isOpen ? selected : null); }
  const clearPrev = () => vx().clearRect(0, 0, st.W, st.H);

  /* --- 되돌리기: 칠 층이 바뀐 걸음만 PNG 로, 메모는 글로 --- */
  function snapshot(paintChanged: boolean) {
    chain = chain.then(async () => {
      const prev = hist[hi];
      const paint = (paintChanged || !prev) ? (st.painted ? await toBlob(paintC) : null) : prev.paint;
      const entry: HistEntry = { paint, painted: st.painted, notes: JSON.stringify(st.notes), bg: st.bg ? Object.assign({}, st.bg) : null, mode: st.mode };
      hist.splice(hi + 1); hist.push(entry); if (hist.length > 40) hist.shift(); hi = hist.length - 1; undoButtons();
    });
    return chain;
  }
  function resetHistory() { hist.length = 0; hi = -1; return snapshot(true); }
  async function applyEntry(e: HistEntry) {
    const x = px(); x.clearRect(0, 0, st.W, st.H);
    if (e.paint) { const bmp = await createImageBitmap(e.paint); x.drawImage(bmp, 0, 0, st.W, st.H); }
    st.painted = e.painted; st.notes = JSON.parse(e.notes); st.bg = e.bg ? Object.assign({}, e.bg) : null; st.mode = e.mode; selected = null; hideSelBar();
    renderBg(); renderNotes(); clearPrev(); undoButtons(); syncHead(); changed();
  }
  async function undo() { await chain; if (hi <= 0) return; hi--; await applyEntry(hist[hi]); }
  async function redo() { await chain; if (hi >= hist.length - 1) return; hi++; await applyEntry(hist[hi]); }
  function undoButtons() { emit(); }
  function commit(kind: 'paint' | 'notes' | 'bg') { if (kind === 'paint') st.painted = true; snapshot(kind === 'paint' || kind === 'bg'); changed(); }

  /* --- 도구 --- */
  function drawShape(ctx: CanvasRenderingContext2D, kind: BoardTool, a: BoardPoint, b: BoardPoint, shift: boolean) {
    let x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (shift && kind !== 'line') { const s = Math.max(w, h); w = h = s; x = b.x < a.x ? a.x - s : a.x; y = b.y < a.y ? a.y - s : a.y; }
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (kind === 'line') {
      let ex = b.x, ey = b.y;
      if (shift) { const ang = Math.round(Math.atan2(ey - a.y, ex - a.x) / (Math.PI / 4)) * (Math.PI / 4); const L = Math.hypot(ex - a.x, ey - a.y); ex = a.x + Math.cos(ang) * L; ey = a.y + Math.sin(ang) * L; }
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
    } else if (kind === 'rect') { if (fillMode === 'fill') ctx.fillRect(x, y, w, h); else ctx.strokeRect(x, y, w, h); }
    else if (kind === 'ellipse') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2); if (fillMode === 'fill') ctx.fill(); else ctx.stroke(); }
    ctx.restore();
  }
  function composite() { const c = makeCanvas(st.W, st.H); const x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; x.drawImage(bgC, 0, 0); x.drawImage(paintC, 0, 0); return x; }
  function floodFill(p: BoardPoint) {
    const W = st.W, H = st.H, x0 = Math.floor(p.x), y0 = Math.floor(p.y);
    if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return false;
    const rgb = hexToRgb(color);
    const mask = floodMask(composite().getImageData(0, 0, W, H).data, W, H, x0, y0, rgb, gap); if (!mask) return false;
    const img = px().getImageData(0, 0, W, H); applyFillMask(img.data, mask, W, H, rgb);
    px().putImageData(img, 0, 0); return true;
  }
  function pickColor(p: BoardPoint) {
    const x = clamp(Math.floor(p.x), 0, st.W - 1), y = clamp(Math.floor(p.y), 0, st.H - 1);
    const c = makeCanvas(1, 1); const cx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; cx.drawImage(bgC, -x, -y); cx.drawImage(paintC, -x, -y);
    const d = cx.getImageData(0, 0, 1, 1).data; return rgbToHex(d[0], d[1], d[2]);
  }

  /* --- 글씨 메모 --- */
  function positionText() {
    if (!textEdit || !el) return; const ta = el.text; const s = geo.s;
    ta.style.left = (geo.fx + textEdit.p.x * s - 4) + 'px'; ta.style.top = (geo.fy + textEdit.p.y * s - 3) + 'px'; ta.style.fontSize = (textEdit.size * s) + 'px';
    ta.style.width = '10px'; ta.style.height = '10px'; ta.style.width = (ta.scrollWidth + 12) + 'px'; ta.style.height = (ta.scrollHeight + 2) + 'px';
  }
  function startText(p: BoardPoint | null, note?: Extract<BoardNote, { type: 'text' }>) {
    commitText(); if (!el) return; const ta = el.text;
    textEdit = { p: note ? { x: note.x, y: note.y } : { x: (p as BoardPoint).x, y: (p as BoardPoint).y }, size: note ? note.size : textSizeFor(width), note: note || null };
    if (note) { note._editing = true; renderNotes(); }
    ta.value = note ? note.text : ''; ta.hidden = false; positionText(); setTimeout(() => ta.focus(), 0);
  }
  function commitText() {
    if (!textEdit || !el) return; const ta = el.text; const text = ta.value.replace(/\s+$/, ''); ta.hidden = true;
    const { note, p, size } = textEdit; textEdit = null; let touched = false;
    if (note) { delete note._editing; if (text && text !== note.text) { note.text = text; touched = true; } else if (!text) { st.notes = st.notes.filter((n) => n !== note); touched = true; } }
    else if (text) { st.notes.push({ type: 'text', x: p.x, y: p.y, text, size }); touched = true; }
    renderNotes(); if (touched) commit('notes');
  }
  function cancelText() { if (!textEdit || !el) return; el.text.hidden = true; if (textEdit.note) delete textEdit.note._editing; textEdit = null; renderNotes(); }

  /* --- 고른 메모 위의 '메모 지우기' --- */
  function positionSelBar() {
    if (!el) return; const bar = el.selBar; if (!selected || !isOpen || tool !== 'select') { bar.hidden = true; return; }
    const b = noteBox(selected, measure); bar.hidden = false; bar.style.left = (geo.fx + (b.x + b.w + 8) * geo.s - bar.offsetWidth) + 'px'; bar.style.top = (geo.fy + (b.y - 8) * geo.s - 30) + 'px';
  }
  function hideSelBar() { if (el) el.selBar.hidden = true; }
  function deleteSelected() { if (!selected) return; st.notes = st.notes.filter((n) => n !== selected); selected = null; hideSelBar(); renderNotes(); commit('notes'); }
  function deselect() { if (!selected) return; selected = null; renderNotes(); hideSelBar(); emit(); }

  /* --- 투시 가이드 (무대 위에만 그리고, 내보내지 않는다) --- */
  function drawGuide(ctx: CanvasRenderingContext2D, scene: GuideScene) {
    if (scene.rot) { ctx.translate(scene.rot.cx, scene.rot.cy); ctx.rotate(scene.rot.rad); ctx.translate(-scene.rot.cx, -scene.rot.cy); }
    for (const o of scene.ops) {
      if (o.k === 'line') { ctx.strokeStyle = o.c; ctx.lineWidth = o.w; ctx.beginPath(); ctx.moveTo(o.a[0], o.a[1]); ctx.lineTo(o.b[0], o.b[1]); ctx.stroke(); }
      else if (o.k === 'chip') {
        ctx.font = CHIP_FONT; ctx.fillStyle = o.bg; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(o.x, o.y, o.tw + 14, 19, 5); else ctx.rect(o.x, o.y, o.tw + 14, 19);
        ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(o.text, o.x + 7, o.y + 14);
      } else if (o.k === 'dot') { ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fillStyle = o.fill; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = o.stroke; ctx.stroke(); }
      else if (o.k === 'glyph') { ctx.fillStyle = HANDLE; ctx.font = GLYPH_FONT; ctx.fillText(o.text, o.x, o.y); }
      else if (o.k === 'level') {
        ctx.save(); ctx.setLineDash([10, 7]); ctx.strokeStyle = 'rgba(30,140,255,.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(o.x1, o.y); ctx.lineTo(o.x2, o.y); ctx.stroke(); ctx.restore();
        ctx.font = CHIP_FONT; ctx.fillStyle = 'rgba(30,140,255,.95)'; ctx.fillRect(o.bx, o.by, o.tw + 14, 19); ctx.fillStyle = '#fff'; ctx.fillText(o.text, o.tx, o.ty);
      }
    }
  }
  function renderGuide() {
    handles = [];
    if (el) {
      const g = el.guide; const ctx = ctx2d(g); const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, g.width, g.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (showGuide) { const scene = guideScene(st.guide, geo, g.width / dpr, g.height / dpr, st.tilt || 0, measure); drawGuide(ctx, scene); handles = scene.handles; }
    }
    emit(); // HTML syncGuideCtl · syncTiltCtl
  }
  function setTilt(v: number) { const t = tiltStep(v); if (t === st.tilt) return; st.tilt = t; renderGuide(); changed(); cb.onTilt?.(t); }
  function setPlaceColors(list: PlaceColor[] | null | undefined) { placeColors = (list || []).slice(); emit(); }
  function paintShare() { return paintShareOf(composite().getImageData(0, 0, st.W, st.H).data); }
  function setGuideType(type: PerspectiveId) {
    st.guide = guideFor(type);
    if (isOpen) layout(); else emit(); cb.onGuide?.();
  }
  function setGuideParam(k: GuideParam, v: number | boolean) { st.guide = withGuideParam(st.guide, k, v); renderGuide(); cb.onGuide?.(); }

  /* --- 배치와 누르기 --- */
  function layout() {
    if (!isOpen || !el) return;
    const stage = el.stage; const sw = stage.clientWidth, sh = stage.clientHeight; if (!sw || !sh) return;
    geo = frameGeo(sw, sh, st.W, st.H, st.guide.type, showGuide);
    const fr = el.frame; fr.style.left = geo.fx + 'px'; fr.style.top = geo.fy + 'px'; fr.style.width = geo.fw + 'px'; fr.style.height = geo.fh + 'px';
    const g = el.guide; const dpr = window.devicePixelRatio || 1; g.width = Math.round(sw * dpr); g.height = Math.round(sh * dpr);
    renderGuide(); positionSelBar(); positionText();
  }
  function toBoard(e: MouseEvent): StagePt {
    const r = (el as BoardElements).stage.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { x: (sx - geo.fx) / geo.s, y: (sy - geo.fy) / geo.s, sx, sy };
  }
  function onDown(e: PointerEvent) {
    if (!el || e.button !== 0) return; if (e.target === el.text || el.selBar.contains(e.target as Node)) return;
    const p = toBoard(e);
    if (textEdit) { commitText(); if (tool === 'text') return; }
    try { el.stage.setPointerCapture(e.pointerId); } catch { /* 이미 떠난 포인터 */ }
    if (tool === 'guide') { const q = unturn(p, st.tilt, geo); const h = guideHit(handles, q); if (h) drag = { type: 'guide', h, sx: q.sx, sy: q.sy, g0: Object.assign({}, st.guide) }; return; }
    if (tool === 'select') {
      const n = noteAt(st.notes, p, measure); selected = n; renderNotes(); positionSelBar(); emit();
      if (n) drag = { type: 'move', last: p, moved: false }; return;
    }
    if (tool === 'fill') { if (floodFill(p)) commit('paint'); return; }
    if (tool === 'picker') { setColor(pickColor(p)); toast('색을 골랐어요'); return; }
    if (tool === 'text') { const n = noteAt(st.notes, p, measure); if (n && n.type === 'text') startText(null, n); else startText(p); return; }
    if (tool === 'pen' || tool === 'eraser') {
      const x = px(); x.save(); x.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      x.strokeStyle = color; x.fillStyle = color; x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = tool === 'eraser' ? width * 2.2 : width;
      x.beginPath(); x.arc(p.x, p.y, x.lineWidth / 2, 0, Math.PI * 2); x.fill();
      drag = { type: 'stroke', pts: [p] }; return;
    }
    if (tool === 'mark') { drag = { type: 'mark', pts: [[p.x, p.y]] }; drawMarkPreview(drag.pts); return; }
    if (tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'arrow') { drag = { type: 'shape', a: p, b: p }; return; }
  }
  function drawMarkPreview(pts: Pt[]) { clearPrev(); drawNotes(vx(), [{ type: 'mark', pts, w: noteWidth(width) }]); }
  function onMove(e: PointerEvent) {
    if (!isOpen || !el) return;
    const p = toBoard(e);
    if (!drag) {
      if (tool === 'select') el.stage.classList.toggle('is-hovering', !!noteAt(st.notes, p, measure));
      else if (tool === 'guide') el.stage.classList.toggle('is-hovering', !!guideHit(handles, unturn(p, st.tilt, geo)));
      return;
    }
    if (drag.type === 'stroke') {
      const x = px(); drag.pts.push(p); const n = drag.pts.length;
      if (n >= 3) { const a = drag.pts[n - 3], b = drag.pts[n - 2], c = drag.pts[n - 1]; x.beginPath(); x.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2); x.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2); x.stroke(); }
      else { x.beginPath(); x.moveTo(drag.pts[0].x, drag.pts[0].y); x.lineTo(p.x, p.y); x.stroke(); }
    } else if (drag.type === 'mark') { const l = drag.pts[drag.pts.length - 1]; if (Math.hypot(p.x - l[0], p.y - l[1]) > 2) { drag.pts.push([p.x, p.y]); drawMarkPreview(drag.pts); } }
    else if (drag.type === 'shape') {
      drag.b = p; clearPrev();
      if (tool === 'arrow') drawNotes(vx(), [{ type: 'arrow', x1: drag.a.x, y1: drag.a.y, x2: p.x, y2: p.y, w: noteWidth(width) }]);
      else drawShape(vx(), tool, drag.a, p, e.shiftKey);
    } else if (drag.type === 'move') { if (selected) moveNote(selected, p.x - drag.last.x, p.y - drag.last.y); drag.last = p; drag.moved = true; renderNotes(); positionSelBar(); }
    else if (drag.type === 'guide') { // 손잡이는 누른 곳에서 움직인 만큼 옮긴다: 종이 밖 소실점도 더 멀리 끌 수 있게
      const q = unturn(p, st.tilt, geo); const dxn = (q.sx - drag.sx) / geo.fw, dyn = (q.sy - drag.sy) / geo.fh;
      st.guide = dragGuide(drag.g0, st.guide, drag.h, dxn, dyn);
      if (!st.guide.placed) { st.guide.placed = true; toast('가이드를 옮겨서 \'지평선 및 투시 참고하게 하기\'를 켰어요'); }
      renderGuide();
    }
  }
  function onUp(e: PointerEvent) {
    if (!drag || !el) return; const d = drag; drag = null;
    try { el.stage.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (d.type === 'stroke') { px().restore(); commit('paint'); }
    else if (d.type === 'mark') { clearPrev(); st.notes.push({ type: 'mark', pts: d.pts, w: noteWidth(width) }); renderNotes(); commit('notes'); }
    else if (d.type === 'shape') {
      clearPrev(); const a = d.a, b = d.b; if (Math.hypot(b.x - a.x, b.y - a.y) < 4) return;
      if (tool === 'arrow') { st.notes.push({ type: 'arrow', x1: a.x, y1: a.y, x2: b.x, y2: b.y, w: noteWidth(width) }); renderNotes(); commit('notes'); }
      else { drawShape(px(), tool, a, b, e.shiftKey); commit('paint'); }
    } else if (d.type === 'move') { if (d.moved) commit('notes'); }
    else if (d.type === 'guide') cb.onGuide?.();
  }
  function onKey(e: KeyboardEvent) {
    if (!isOpen || textEdit || !el || e.target === el.text) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) void redo(); else void undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); e.stopPropagation(); void redo(); return; }
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag && /INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (e.key === 'Escape' && selected) { e.stopPropagation(); deselect(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); e.stopPropagation(); deleteSelected(); }
  }
  const onDbl = (e: MouseEvent) => { if (tool !== 'select') return; const n = noteAt(st.notes, toBoard(e), measure); if (n && n.type === 'text') startText(null, n); };
  const onDragOver = (e: DragEvent) => e.preventDefault();
  const onDrop = (e: DragEvent) => { e.preventDefault(); const f = [...(e.dataTransfer ? e.dataTransfer.files : [])].find((x) => x.type.startsWith('image/')); if (f) void loadFile(f); };
  const onTextKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); commitText(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelText(); } };
  const onTextBlur = () => setTimeout(commitText, 0);

  /* --- 도구 고르기 · 색 · 굵기 --- */
  function setTool(t: BoardTool) {
    commitText(); tool = t;
    if (el) { el.stage.dataset.tool = t; el.stage.classList.remove('is-hovering'); }
    if (t !== 'select') { selected = null; renderNotes(); } positionSelBar(); emit();
  }
  function setColor(c: string) { color = c.toUpperCase(); emit(); }
  function syncHead() { emit(); cb.onMode?.(st.mode); }

  function attach(els: BoardElements) {
    if (el) detach();
    el = els; isOpen = true;
    el.frame.append(bgC, paintC, noteC, prevC);
    el.text.hidden = true; el.selBar.hidden = true;
    const s = el.stage;
    s.addEventListener('pointerdown', onDown); s.addEventListener('pointermove', onMove); s.addEventListener('pointerup', onUp); s.addEventListener('pointercancel', onUp);
    s.addEventListener('dblclick', onDbl); s.addEventListener('dragover', onDragOver); s.addEventListener('drop', onDrop);
    el.text.addEventListener('keydown', onTextKey); el.text.addEventListener('input', positionText); el.text.addEventListener('blur', onTextBlur);
    el.root.addEventListener('keydown', onKey);
    setTool(tool); syncHead(); undoButtons(); renderNotes();
    layout(); raf = requestAnimationFrame(layout); // 바로 한 번, 그린 뒤 한 번 더
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => layout()); ro.observe(s); }
  }
  function detach() {
    if (!el) return;
    commitText(); selected = null; isOpen = false; drag = null; renderNotes(); hideSelBar();
    const s = el.stage;
    s.removeEventListener('pointerdown', onDown); s.removeEventListener('pointermove', onMove); s.removeEventListener('pointerup', onUp); s.removeEventListener('pointercancel', onUp);
    s.removeEventListener('dblclick', onDbl); s.removeEventListener('dragover', onDragOver); s.removeEventListener('drop', onDrop);
    el.text.removeEventListener('keydown', onTextKey); el.text.removeEventListener('input', positionText); el.text.removeEventListener('blur', onTextBlur);
    el.root.removeEventListener('keydown', onKey);
    cancelAnimationFrame(raf); if (ro) { ro.disconnect(); ro = null; }
    [bgC, paintC, noteC, prevC].forEach((c) => c.remove());
    el = null; handles = [];
    cb.onPreview?.(); emit();
  }
  function setMode(v: BoardMode) { if (st.mode === v) return; st.mode = v; renderBg(); syncHead(); if (st.bg) commit('bg'); else { void snapshot(false); emit(); } }
  async function loadFile(f: File) {
    try { const { src, img } = await normalizeSrc(f); st.bg = { img, src, fit: st.mode === 'guide' ? 'cover' : 'contain' }; renderBg(); syncHead(); commit('bg'); photoLike = isPhotoLike(img); cb.onLoaded?.(img); }
    catch (e) { toast((e as Error).message || '이미지를 열 수 없어요'); }
  }
  async function loadSrc(src: string) {
    const img = await loadImg(src);
    st.bg = { img, src, fit: st.mode === 'guide' ? 'cover' : 'contain' }; renderBg(); syncHead(); commit('bg');
  }
  function setFit(v: BoardFit) { if (!st.bg) return; st.bg.fit = v; renderBg(); commit('bg'); }
  function setRatio(r: RatioId) {
    if (r === st.ratio) return; const [W, H] = dimsFor(r); const oW = st.W, oH = st.H;
    let old: HTMLCanvasElement | null = null; if (st.painted) { old = makeCanvas(oW, oH); ctx2d(old).drawImage(paintC, 0, 0); }
    [bgC, paintC, noteC, prevC].forEach((c) => { c.width = W; c.height = H; });
    st.ratio = r; st.W = W; st.H = H;
    const { s, ox, oy } = ratioFit(oW, oH, W, H); // 그린 것과 메모는 잘리지 않게 새 종이 안에 맞춰 넣는다
    if (old) px().drawImage(old, ox, oy, oW * s, oH * s);
    fitNotes(st.notes, s, ox, oy);
    renderBg(); renderNotes(); clearPrev(); syncHead(); if (isOpen) layout(); void resetHistory(); changed(); cb.onRatio?.(r);
  }
  function clearAll() {
    st.bg = null; st.notes = []; px().clearRect(0, 0, st.W, st.H); st.painted = false; selected = null; hideSelBar(); const hadTilt = !!st.tilt; st.tilt = 0;
    if (isOpen) renderGuide(); renderBg(); renderNotes(); syncHead(); void snapshot(true); changed(); if (hadTilt) cb.onTilt?.(0);
  }
  function clearPaint() { if (!st.painted) return; px().clearRect(0, 0, st.W, st.H); st.painted = false; void snapshot(true); changed(); }
  function clearNotes() { if (!st.notes.length) return; st.notes = []; selected = null; hideSelBar(); renderNotes(); commit('notes'); }
  function clearBg() { if (!st.bg) return; st.bg = null; renderBg(); commit('bg'); syncHead(); photoLike = false; cb.onLoaded?.(null); }
  function exportClean() { const c = makeCanvas(st.W, st.H); const x = ctx2d(c); x.drawImage(bgC, 0, 0); x.drawImage(paintC, 0, 0); return c; }
  function exportAnnotated() { const c = exportClean(); drawNotes(ctx2d(c), st.notes); return c; }
  function hasColor() { if (!st.painted) return false; return hasColorOf(px().getImageData(0, 0, st.W, st.H).data); }
  async function serialize(): Promise<BoardDraft> {
    return {
      ratio: st.ratio, mode: st.mode, bg: st.bg ? { src: st.bg.src, fit: st.bg.fit } : null, paint: st.painted ? await toBlob(paintC) : null,
      notes: st.notes.map((n) => { const o = Object.assign({}, n); delete o._editing; return o; }), guide: Object.assign({}, st.guide), tilt: st.tilt || 0,
    };
  }
  async function restore(o: Partial<BoardDraft> | null | undefined) {
    if (!o) return;
    if (o.ratio && o.ratio !== st.ratio) { const [W, H] = dimsFor(o.ratio); [bgC, paintC, noteC, prevC].forEach((c) => { c.width = W; c.height = H; }); st.ratio = o.ratio; st.W = W; st.H = H; }
    st.mode = o.mode || 'rough';
    st.bg = null; if (o.bg && o.bg.src) { try { st.bg = { img: await loadImg(o.bg.src), src: o.bg.src, fit: o.bg.fit || 'contain' }; } catch { st.bg = null; } }
    px().clearRect(0, 0, st.W, st.H); st.painted = false;
    if (o.paint) { try { const bmp = await createImageBitmap(o.paint); px().drawImage(bmp, 0, 0, st.W, st.H); st.painted = true; } catch { /* ignore */ } }
    st.notes = Array.isArray(o.notes) ? o.notes : []; if (o.guide) st.guide = Object.assign({}, st.guide, o.guide);
    st.tilt = clamp(Number(o.tilt) || 0, -15, 15);
    renderBg(); renderNotes(); syncHead(); if (isOpen) layout(); await resetHistory(); changed();
  }

  // HTML init: 색 · 배경 · 되돌리기 첫 걸음
  setColor(color); renderBg(); void resetHistory(); syncHead();

  return {
    attach, detach, isOpen: () => isOpen,
    setCallbacks(next) { Object.assign(cb, next); },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    ui,
    setRatio, setMode, loadFile, loadSrc, setFit, clearAll, clearPaint, clearNotes, clearBg,
    setGuideType, setGuideParam, setTilt, setPlaceColors,
    pickPlaceColor(hex) { setColor(hex); if (tool !== 'fill' && tool !== 'pen' && tool !== 'rect' && tool !== 'ellipse' && tool !== 'line') setTool('fill'); },
    setTool, setColor,
    setWidth(w) { width = Number(w); emit(); },
    setFillMode(v) { fillMode = v; emit(); },
    setGap(v) { gap = Number(v) || 0; memory.set('fillGap', gap); emit(); },
    setShowGuide(v) { showGuide = !!v; if (isOpen) layout(); else emit(); },
    setShowNotes(v) { showNotes = !!v; renderNotes(); emit(); },
    undo, redo, deleteSelected, deselect,
    exportClean, exportAnnotated, hasColor,
    notesSummary: (map) => notesSummaryText(st.notes, st.W, st.H, measure, map),
    serialize, restore, paintShare,
    previewDataUrl(max = 720) { const c = scaled(exportAnnotated(), max); return c.toDataURL('image/jpeg', 0.85); },
    tilt: () => st.tilt || 0, rev: () => st.rev, ratio: () => st.ratio, mode: () => st.mode, hasBg: () => !!st.bg, isGuide: () => !!st.bg && st.mode === 'guide',
    guide: () => ({ ...st.guide }), noteCount: () => st.notes.length,
    hasContent: () => !!st.bg || st.painted || st.notes.length > 0,
    toast,
  };
}
