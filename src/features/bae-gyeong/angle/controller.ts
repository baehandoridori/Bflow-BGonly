/**
 * BAE경 '다른 각도로' 창의 움직임 (HTML v0.4.11 script_4.js 3764~4232줄 AG · ag* 함수를 그대로 옮긴 것).
 * React 창(windows/AngleWindow.tsx)은 틀과 글자만 그리고, 캔버스 넷(도면 · 도면 위 표시 · B 그림 · 붓 · 메모)과 끌기 · 그리기는 이 클래스가 한다.
 * HTML 처럼 그림마다 카메라 · 같은 공간 그림 · 붓 · 메모를 기억하고(angleMemory, 창을 닫았다 열어도), 깊이는 그림마다 한 번만 잰다.
 * '이 각도로 그리기'는 prepare() — 밑그림 · 원래 그림 · 같은 공간 그림 PNG 와 카메라 문장 · 기록을 만들어 돌려준다. 그 뒤(메모 읽기 · 주문서 ·
 * 그림 부르기)는 메인이 한다 (electron/bae/baeAngle.ts).
 */
import { ANG, type AngleCam, type AngleInfo, type AnglePart, type AnglePose, type AnglePresets, type AngleScaleRefs, type AngleSet, type AngleView, type AngleWallHit, type Vec3 } from './engine';
import { createAngleGL, type AngleGL, type AngleUnseen } from './gl';
import { anglePaintDraw, anglePaintOn, angleNotesDraw, angleCrop, ANGLE_NOTE_SIZE, type AngleStroke, type AngleNoteDraw } from './paint';
import { createWorkerDepth, angleDepthReady, type AngleDepth, type AngleDepthFn } from './depth';
import {
  ANGLE_EX_COLORS, ANGLE_EX_COLOR_KO, ANGLE_EX_LETTERS, ANGLE_EX_MAX, ANGLE_PRESET_LABEL, ANGLE_SEND_MIN, ANGLE_UNDER_MIN, ANGLE_VP_MUCH,
  angleEst, angleMemoEst, angleNotesRaw, angleNotesSummary, angleOutSize, angleSummaryLine, angleResultName,
  type AngleKind, type AngleNote, type AnglePreset,
} from '@/shared/bae/angle/order';
import type { BaeAngleDrawCall, BaeAngleRecord } from '@/shared/bae/angle/calls';
import type { TierId } from '@/shared/bae/order/constants';
import { FONT } from '@/shared/bae/order/constants';
import { fit, loadImg, makeCanvas, scaled, toBlob } from '../make/inputs';

/** 창이 여는 그림: BAE경 결과 또는 이 PC 의 파일. key 는 같은 그림인지 가르는 이름 (결과: 작업 · 판 · 바이트 수, 파일: 내용 해시). */
export interface AngleTarget {
  kind: 'result' | 'file';
  /** 결과의 작업 id */
  id?: string;
  key: string;
  name: string;
  w: number; h: number;
  /** 그림 주소 (blob: · data: · http) */
  src: string;
  /** 이 결과가 '다른 각도로'로 그린 것이면 그때의 기록 (원래 그림 기준으로 · 장소 · 화각) */
  angle?: BaeAngleRecord | null;
  /** 결과의 장소 (주문서의 장소 칸): 실내 · 실외를 고르는 데 쓴다 */
  place?: string | null;
  /** 결과의 영어 주문서 (장소를 고르는 데 쓴다, HTML agGuessKind) */
  prompt?: string | null;
  thumb?: string | null;
}
/** '+ 같은 공간 그림 더하기'에 보일 결과 하나. */
export interface AngleResultChoice { id: string; thumb: string; w: number; h: number; createdAt: number }

interface Extra {
  uid: number; t: AngleTarget; key: string; name: string; img: HTMLImageElement | null; thumb: string; dp: AngleDepth | null; ref: AngleScaleRefs | null; S: AngleSet | null; gen: number;
  pose: AnglePose & { pos: Vec3 }; size: number; eye: number | null; wall: AngleWallHit | null; dist: number; anch: boolean; status: 'load' | 'depth' | 'ready' | 'err'; msg: string;
}
interface KeptExtra { t: AngleTarget; pose: { pos: Vec3; yaw: number; s: number }; size: number; eye: number | null }
interface Kept { kind: AngleKind; hfov: number; cam: AngleCam; strokes: AngleStroke[]; notes: AngleNote[]; paintCam: string; ex: KeptExtra[] }
interface Pending { pos: number[]; target: number[]; preset: AnglePreset | null; shift: number[] | null; kind: AngleKind; hfov: number; ex: KeptExtra[] }

/** 창을 닫았다 열어도 남는 것 (HTML 은 페이지가 열려 있는 동안 AG 에 남았다): 그림판 · 깊이 · 그림마다 맞춘 것. */
export const angleMemory = { gl: null as AngleGL | null, depth: new Map<string, AngleDepth>(), keep: new Map<string, Kept>(), jobs: new Map<string, Promise<AngleDepth>>() };
const glOf = () => (angleMemory.gl ||= createAngleGL());

const GREY = [128 / 255, 128 / 255, 128 / 255], MAPBG = [228 / 255, 228 / 255, 228 / 255];
const TOOLS = ['brush', 'erase', 'pick', 'text', 'arrow', 'mark'] as const;
export type AngleTool = '' | (typeof TOOLS)[number];
const WALL_KO: Record<string, string> = { back: 'A가 보는 벽', left: '왼쪽 벽', right: '오른쪽 벽' };

export interface AngleChip { i: number; letter: string; color: string; colorKo: string; title: string; sub: string; thumb: string; on: boolean; err: boolean; ready: boolean }
/** 창이 그릴 글자와 손잡이 값 (바뀔 때마다 새 물건). */
export interface AngleUi {
  ready: boolean; drawing: boolean;
  target: string; back: string | null;
  wait: { on: boolean; title: string; hint: string; frac: number | null; retry: boolean };
  preset: AnglePreset | null;
  orbit: number; orbitText: string; dist: number; distText: string; height: number; heightText: string; heightMax: number; pitch: number; pitchText: string;
  kind: AngleKind; fov: number; fovText: string;
  info: string; infoKind: '' | 'ok' | 'warn' | 'err';
  est: string; go: boolean;
  vp: { on: boolean; x: number; y: number; text: string };
  planCap: string; viewTitle: string; viewCap: string;
  chips: AngleChip[]; aChip: { thumb: string; title: string; sub: string } | null; canAdd: boolean; exCount: number;
  exSel: { letter: string; color: string; size: number; sizeText: string; eye: number; eyeMax: number; eyeText: string; enabled: boolean } | null;
  tool: AngleTool; color: string; brush: number; undo: boolean; clear: boolean; showOrig: boolean;
  noteEdit: { on: boolean; left: number; top: number; font: number; text: string };
  origSrc: string;
}
export interface AngleHost {
  depth?: AngleDepthFn;
  depthReady?: () => Promise<boolean>;
  resolveResult?: (id: string) => Promise<AngleTarget | null>;
  toast?: (msg: string) => void;
  tier?: TierId;
  krwPerUsd?: number;
  pdPrice?: [number, number] | null;
  newId?: () => string;
  now?: () => number;
}
export interface AngleEls {
  plan: HTMLCanvasElement; planUi: HTMLCanvasElement; view: HTMLCanvasElement; paint: HTMLCanvasElement; note: HTMLCanvasElement;
  noteText: HTMLTextAreaElement; planWrap: HTMLElement; viewWrap: HTMLElement; vpDot: HTMLElement | null;
}

/** 파일을 창이 여는 그림으로 (HTML agFile: 내용 해시로 이름). */
export async function angleFileTarget(file: File): Promise<AngleTarget> {
  const buf = new Uint8Array(await file.arrayBuffer()); let h = 0; for (let i = 0; i < buf.length; i += 997) h = (h * 31 + buf[i]) | 0;
  const src = URL.createObjectURL(file); const img = await loadImg(src).catch(() => null);
  if (!img) { URL.revokeObjectURL(src); throw new Error('그림을 열 수 없어요'); }
  return { kind: 'file', src, name: file.name, w: img.naturalWidth, h: img.naturalHeight, key: 'f' + (h >>> 0).toString(36) + '_' + buf.length };
}

export class AngleController {
  t: AngleTarget | null = null; key = ''; img: HTMLImageElement | null = null; S: AngleSet | null = null; P: AnglePresets | null = null; cam: AngleCam | null = null;
  kind: AngleKind = 'interior'; hfov = 55; fovShow = 55; drawing = false; pending: Pending | null = null;
  B: AngleView | null = null; B0: AngleView | null = null; drag: string | null = null; raf = 0; err = ''; unseen: AngleUnseen | null = null; unseenT: ReturnType<typeof setTimeout> | 0 = 0;
  ex: Extra[] = []; exSel = -1; exMoved = false; uid = 0; sh: { n: number; by: number[] } | null = null; same = true; part: AnglePart | null = null; tight = false;
  paint = { strokes: [] as AngleStroke[], tool: '' as AngleTool, col: '#a9d6f5', size: 28, cur: null as AngleStroke | null, cam: '', notes: [] as AngleNoteDraw[], curNote: null as AngleNoteDraw | null, edit: null as null | { note?: AngleNoteDraw; at?: [number, number] }, seq: 0 };
  vpDrag = false; heightMax = 3; showOrig = false; back: AngleTarget | null = null; thumbA = { key: '', url: '' };
  private waitS = { on: false, title: '', hint: '', frac: null as number | null, retry: false };
  private infoS = { text: '', kind: '' as AngleUi['infoKind'] };
  private estS = '';
  private noteEditS = { on: false, left: 0, top: 0, font: 12, text: '' };
  private els: AngleEls | null = null;
  private listeners = new Set<() => void>();
  private snap: AngleUi | null = null;
  private off: Array<() => void> = [];
  private closed = false;
  private readonly gl: AngleGL;
  private readonly depthFn: AngleDepthFn;
  constructor(private readonly host: AngleHost = {}) {
    this.gl = glOf();
    this.depthFn = host.depth ?? createWorkerDepth();
  }

  /* ---------- 화면과 잇기 ---------- */
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  getUi = (): AngleUi => (this.snap ||= this.compute());
  private emit() { this.snap = null; for (const fn of this.listeners) fn(); }
  private toast(m: string) { this.host.toast?.(m); }

  attach(els: AngleEls) {
    this.els = els; this.closed = false;
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, ev: K, fn: (e: HTMLElementEventMap[K]) => void) => { el.addEventListener(ev, fn as EventListener); this.off.push(() => el.removeEventListener(ev, fn as EventListener)); };
    on(els.planUi, 'pointerdown', (e) => this.mapDown(e));
    on(els.planUi, 'pointermove', (e) => { const p = this.pt(e); if (this.drag) this.moveTo(p); else els.planUi.style.cursor = this.hit(p) ? 'grab' : 'crosshair'; });
    for (const ev of ['pointerup', 'pointercancel'] as const) on(els.planUi, ev, () => this.mapUp());
    on(els.planUi, 'keydown', (e) => this.mapKey(e));
    on(els.paint, 'pointerdown', (e) => this.paintDown(e));
    on(els.paint, 'pointermove', (e) => this.paintMove(e));
    for (const ev of ['pointerup', 'pointercancel'] as const) on(els.paint, ev, () => this.paintUp());
    on(els.noteText, 'keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.noteCommit(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.noteCommit(true); }   // Esc while typing leaves the note, not the window
    });
    on(els.noteText, 'input', () => { this.noteEditS.text = els.noteText.value; });
    on(els.noteText, 'blur', () => this.noteCommit());
    if (els.vpDot) {
      const d = els.vpDot;
      on(d, 'pointerdown', (e) => { if (e.button || !this.S || this.drawing) return; this.vpDrag = true; try { d.setPointerCapture(e.pointerId); } catch { /* 창이 받는다 */ } e.preventDefault(); e.stopPropagation(); });
      // 끄는 동안의 움직임은 창(window)에서 받는다: 점이 손가락 아래에서 비켜 가도 (붙잡기가 안 되는 입력이어도) 놓치지 않게
      const move = (e: PointerEvent) => { if (!this.vpDrag || !this.els) return; const r = this.els.viewWrap.getBoundingClientRect(); this.vpTo((e.clientX - r.left) / r.width * 2 - 1, 1 - (e.clientY - r.top) / r.height * 2); };
      const up = () => { this.vpDrag = false; };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
      this.off.push(() => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); });
      on(d, 'keydown', (e) => {
        const dd = ({ ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, 0.02], ArrowDown: [0, -0.02] } as Record<string, [number, number]>)[e.key]; if (!dd || !this.cam || this.cam.preset !== 'vp' || !this.cam.shift) return;
        e.preventDefault(); this.vpTo(this.cam.shift[0] + dd[0], this.cam.shift[1] + dd[1]);
      });
    }
    let rt: ReturnType<typeof setTimeout> | 0 = 0;
    const relayout = () => { if (rt) clearTimeout(rt); rt = setTimeout(() => this.layout(), 150); };
    window.addEventListener('resize', relayout); this.off.push(() => window.removeEventListener('resize', relayout));
    if (typeof ResizeObserver !== 'undefined') { const ro = new ResizeObserver(relayout); ro.observe(els.planWrap); ro.observe(els.viewWrap); this.off.push(() => ro.disconnect()); }
    this.layout();
  }
  /** 창을 닫을 때 (HTML agDlg 'close'): 이 그림의 카메라 · 같은 공간 그림 · 붓 · 메모를 기억한다. */
  close() {
    if (this.closed) return; this.closed = true;
    if (this.S && this.cam) angleMemory.keep.set(this.key, this.keepOf());
    this.paintToolSet('');
    for (const f of this.off) f(); this.off = []; cancelAnimationFrame(this.raf); if (this.unseenT) clearTimeout(this.unseenT);
    this.els = null;   // (그림 주소는 부르는 쪽 것: 여기서 풀지 않는다. 구독은 React 가 푼다)
  }

  /* ---------- 열기 (HTML agOpen · agSwitch · agHead · agLoad) ---------- */
  async open(t: AngleTarget) {
    if (this.drawing) { this.toast('그리는 중이에요. 끝난 뒤에 해 주세요.'); return; }
    this.switchTo(t); await this.head(); await this.load();
  }
  private switchTo(t: AngleTarget) {     // another picture: the old set must not answer the controls while the new one is made
    const o = this.t, same = !!o && o.kind === t.kind && (t.kind === 'file' ? o.key === t.key : o.id === t.id);
    if (this.S && this.cam) angleMemory.keep.set(this.key, this.keepOf());   // the picture we leave keeps its camera, added pictures and strokes
    this.t = t; if (same) return;
    this.exDropAll(); this.noteCommit(true); this.paint.strokes = []; this.paint.cur = null; this.paint.notes = []; this.paint.curNote = null;
    this.S = null; this.P = null; this.cam = null; this.B = null; this.key = ''; this.clear(); this.sync(); this.wait(true, '입체 판 만드는 중', '');
  }
  private async head() {
    const t = this.t as AngleTarget; let src: AngleTarget | null = null;
    if (t.kind === 'result' && t.angle && t.angle.fromId != null && this.host.resolveResult) { try { src = await this.host.resolveResult(t.angle.fromId); } catch { src = null; } }
    this.back = src; this.emit();
  }
  async load() {
    const t = this.t as AngleTarget; const key = t.key;
    if (t !== this.t) return;   // another picture was chosen meanwhile
    const pend = this.pending; this.pending = null;
    if (this.key === key && this.S) { if (pend) { this.applyCam(pend); if (pend.ex && pend.ex.length) { this.exDropAll(); await this.exRestore(pend.ex); } } this.layout(); this.sync(); return; }
    this.key = key; this.S = null; this.P = null; this.cam = null; this.B = null; this.clear();
    let img: HTMLImageElement; try { img = await loadImg(t.src); } catch (e) { this.wait(true, '그림을 열지 못했어요', ''); return; }
    if (t !== this.t || this.key !== key) return;
    this.img = img;
    const kept = angleMemory.keep.get(key);
    this.kind = pend && pend.kind ? pend.kind : kept ? kept.kind : guessKind(t); this.hfov = pend && pend.hfov ? pend.hfov : kept ? kept.hfov : 55; this.fovShow = this.hfov;
    this.layout();
    if (!this.gl.ready()) { this.wait(true, '이 PC에서는 입체 판을 그릴 수 없어요', '그래픽 기능(WebGL2)을 쓸 수 없어요. 그래픽카드 드라이버를 확인하거나 앱을 다시 실행해 주세요.'); return; }
    let dp = angleMemory.depth.get(key);
    if (!dp) {
      const cached = this.host.depthReady ? await this.host.depthReady().catch(() => false) : await angleDepthReady();
      this.wait(true, cached ? '깊이 재는 중' : '깊이 모델 받는 중 (처음 한 번, 약 99MB)', cached ? '이 PC가 그림의 깊이를 재요 (0원)' : '받은 모델은 이 PC에 저장해 두고 다음부터 바로 써요. 깊이 계산과 입체 판은 0원이에요.', cached ? null : 0);
      try {
        let job = angleMemory.jobs.get(key);
        if (!job) {
          job = this.depthFn(img, {
            onProgress: (got, total) => { if (this.key === key) this.wait(true, '깊이 모델 받는 중 (처음 한 번, 약 99MB)', Math.round(got / 1048576) + 'MB' + (total ? ' / ' + Math.round(total / 1048576) + 'MB' : '') + ' · 받은 모델은 이 PC에 저장해 둬요', total ? got / total : null); },
            onStage: () => { if (this.key === key) this.wait(true, '깊이 재는 중', '이 PC 그래픽카드로 그림의 깊이를 재요 (0원)'); },
          }).finally(() => angleMemory.jobs.delete(key));
          angleMemory.jobs.set(key, job);
        }
        dp = await job; angleMemory.depth.set(key, dp);
      } catch (e) {
        if (this.key === key) { this.wait(true, '깊이를 재지 못했어요', String((e && (e as Error).message) || e).slice(0, 300)); this.waitS.retry = true; this.emit(); }
        return;
      }
      if (this.key !== key) return;
    }
    this.wait(false); this.build(pend || (kept ? kept.cam : null));
    if (this.S) {
      await this.exRestore((pend && pend.ex) || (kept && kept.ex) || []);
      if (!pend && kept && (kept.strokes || kept.notes)) {
        this.paint.strokes = (kept.strokes || []).slice(); this.paint.notes = (kept.notes || []).map((n) => Object.assign({}, n));
        this.paint.seq = Math.max(0, ...this.paint.strokes.map((x) => x.seq || 0), ...this.paint.notes.map((x) => x.seq || 0)); this.paint.cam = kept.paintCam || '';
        this.paintRedraw(); this.noteRedraw(); this.estLine(); this.infoLine(); this.emit();
      }
    }
  }
  retry() { this.waitS.retry = false; this.key = ''; void this.load(); }
  private clear() {
    const els = this.els; if (els) for (const c of [els.plan, els.planUi, els.view, els.paint, els.note]) (c.getContext('2d') as CanvasRenderingContext2D | null)?.clearRect(0, 0, c.width, c.height);
    this.waitS.retry = false; this.info(''); this.estS = ''; this.emit();
  }
  private build(cam0: { pos: number[]; target: number[]; preset?: AnglePreset | null; shift?: number[] | null } | null) {
    const dp = angleMemory.depth.get(this.key) as AngleDepth, t = this.t as AngleTarget;
    this.S = ANG.build(dp.disp, dp.dw, dp.dh, t.w, t.h, { kind: this.kind, hfov: this.hfov }); this.P = ANG.presets(this.S);
    try { this.gl.setScene(this.key + '|' + this.kind + '|' + this.hfov, this.S, this.img as HTMLImageElement); }
    catch (e) { this.wait(true, '이 PC에서는 입체 판을 그릴 수 없어요', '그래픽 기능(WebGL2)을 쓸 수 없어요. 앱을 다시 실행해 주세요.'); this.S = null; return; }
    const S = this.S, hi = ANG.yHigh(S) + S.camH; this.heightMax = Math.max(0.5, Math.floor(hi * 20) / 20);
    this.cam = this.P.orig; if (cam0) this.applyCam(cam0);
    for (const e of this.ex) if (e.dp) this.exBuild(e);   // the added pictures follow the new room (a new set A drops them from the renderer)
    this.exSync(true);
    this.B = null; this.layout(); this.sync();
  }
  private applyCam(c: { pos: number[]; target: number[]; preset?: AnglePreset | null; shift?: number[] | null }) {
    if (!this.S || !this.P) return;
    this.cam = c.preset === 'vp' && c.shift ? ANG.vpCam(this.S, c.shift) : c.preset && c.preset !== 'vp' && this.P[c.preset] ? this.P[c.preset] : ANG.fixCam(this.S, { pos: c.pos.slice(), target: c.target.slice() });
  }
  // canvas sizes follow the dialog; the map is drawn once per size, the live view on every change
  layout() {
    const els = this.els; if (!els || !this.t || !this.S) { this.draw(); return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1), size = (el: HTMLElement, cap: number): [number, number] => { const k = Math.min(dpr, cap / Math.max(1, el.clientWidth)); return [Math.max(64, Math.round(el.clientWidth * k)), Math.max(40, Math.round(el.clientHeight * k))]; };
    const [mw, mh] = size(els.planWrap, 1600);
    for (const c of [els.plan, els.planUi]) { c.width = mw; c.height = mh; }
    this.B0 = ANG.birdView(this.S, mw, mh); this.B = this.mapFits(this.B0) ? this.B0 : ANG.birdView(this.S, mw, mh, this.mapPts());
    this.renderMap();
    const [vw, vh] = size(els.viewWrap, 1280); for (const v of [els.view, els.paint, els.note]) { v.width = vw; v.height = vh; }
    this.paintRedraw(); this.noteRedraw(); this.draw();
  }
  // v0.4.8 카메라 빼기: the map is v0.4.7's (the room as big as it fits) while every camera stands in it; when one goes out of it
  // (pulled back behind A with the distance slider, or a drag let go off the map), the map backs off to show them all, and comes
  // back when they are all in again - never in the middle of a drag, so the map does not slide under the pointer.
  private baseStage() { return ANG.stage(Object.assign({}, this.S as AngleSet, { ext: null })); }
  private exZmax() { return this.baseStage().zmax + 1; }   // where an added picture's camera may stand, at the back
  private mapPts(): Vec3[] {
    const S = this.S as AngleSet, y = -S.camH, out: Vec3[] = [], add = (p: number[]) => out.push(p.slice() as Vec3, [p[0], y, p[2]]);
    if (this.cam) add(this.cam.pos); for (const e of this.ex) if (e.status !== 'err') add(e.pose.pos);
    return out;
  }
  private mapFits(B: AngleView | null): boolean {
    const c = this.els?.plan; if (!B || !c) return false;
    return this.mapPts().every((q) => { const p = B.project(q); return !!p && Math.abs(p[0] / c.width * 2 - 1) <= 0.975 && Math.abs(p[1] / c.height * 2 - 1) <= 0.975; });
  }
  private mapCheck() {
    if (!this.S || !this.B || !this.B0 || this.drag || !this.els) return; const c = this.els.plan;
    const want = this.mapFits(this.B0) ? this.B0 : this.mapFits(this.B) ? this.B : ANG.birdView(this.S, c.width, c.height, this.mapPts());
    if (want !== this.B) { this.B = want; this.renderMap(); }
  }
  private renderMap() { if (this.S && this.B && this.els) this.gl.copy(this.B, { cull: true, zCut: this.S.ZMAX * 0.97, bg: MAPBG, mip: true, all: true }, this.els.plan); }
  private draw() { cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(() => { this.mapCheck(); this.drawView(); this.drawMap(); }); }
  /** 그림 하나를 바로 다시 그린다 (시험 · 화면 찍기용: 다음 그림틀을 기다리지 않고). */
  flush() { cancelAnimationFrame(this.raf); this.mapCheck(); this.drawView(); this.drawMap(); }
  // v0.4.7 투시만 바꾸기: the vanishing point (red circle) and the horizon (red line) over the B view
  vpTo(sx: number, sy: number) { if (this.S && !this.drawing) this.set(ANG.vpCam(this.S, [sx, sy])); }
  private drawView() {
    if (!this.S || !this.cam || !this.els) return; const c = this.els.view;
    try { this.gl.copy(ANG.camView(this.S, this.cam, c.width, c.height), { bg: GREY, mip: true, merge: this.gl.count() > 1, cull: true, under: true }, c); }
    catch (e) { this.exFail(); this.gl.copy(ANG.camView(this.S, this.cam, c.width, c.height), { bg: GREY, mip: true, cull: true, under: true }, c); }
  }
  private drawMap() {
    const els = this.els; if (!els) return;
    const c = els.planUi, x = c.getContext('2d') as CanvasRenderingContext2D, S = this.S, B = this.B; x.clearRect(0, 0, c.width, c.height); if (!S || !B || !this.cam) return;
    const k = c.width / Math.max(1, c.clientWidth), hf = 2 * Math.atan((S.W / 2) / S.f), L = Math.min(8, Math.max(2.5, 0.28 * S.Zback));
    const font = (px: number) => '700 ' + Math.round(px * k) + 'px system-ui, sans-serif';
    const dash = (a: number[], b: number[], col: string, w: number) => { x.save(); x.setLineDash([5 * k, 4 * k]); x.strokeStyle = col; x.lineWidth = w * k; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); x.restore(); };
    const mark = (pos: number[], yaw: number, col: string, letter: string) => {
      const pt = (a: number): Vec3 => [pos[0] + Math.sin(a) * L, pos[1], pos[2] - Math.cos(a) * L];
      const p = B.project(pos), l = B.project(pt(yaw - hf / 2)), r = B.project(pt(yaw + hf / 2)), fl = B.project([pos[0], -S.camH, pos[2]]);
      if (!p) return;
      if (l && r) { x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(l[0], l[1]); x.lineTo(r[0], r[1]); x.closePath(); x.fillStyle = col + '44'; x.fill(); x.strokeStyle = col; x.lineWidth = 2.5 * k; x.lineJoin = 'round'; x.beginPath(); x.moveTo(l[0], l[1]); x.lineTo(p[0], p[1]); x.lineTo(r[0], r[1]); x.stroke(); }
      if (fl && Math.abs(fl[1] - p[1]) > 6 * k) { dash(p, fl, col, 2); x.fillStyle = col; x.beginPath(); x.arc(fl[0], fl[1], 3.5 * k, 0, 7); x.fill(); }
      x.fillStyle = col; x.strokeStyle = '#fff'; x.lineWidth = 2.5 * k; x.beginPath(); x.arc(p[0], p[1], 8 * k, 0, 7); x.fill(); x.stroke();
      x.font = font(16); x.lineWidth = 4 * k; x.strokeStyle = '#fff'; x.strokeText(letter, p[0] + 11 * k, p[1] - 9 * k); x.fillText(letter, p[0] + 11 * k, p[1] - 9 * k);
    };
    // v0.4.8: where B may stand, a faint dashed line on the floor
    const LB = ANG.limits(S), cs = [[LB.x[0], LB.z[0]], [LB.x[1], LB.z[0]], [LB.x[1], LB.z[1]], [LB.x[0], LB.z[1]]].map((q) => B.project([q[0], -S.camH, q[1]]));
    if (cs.every(Boolean)) { x.save(); x.setLineDash([4 * k, 5 * k]); x.strokeStyle = 'rgba(224,40,40,.38)'; x.lineWidth = 1.3 * k; x.beginPath(); cs.forEach((q, i) => i ? x.lineTo(q![0], q![1]) : x.moveTo(q![0], q![1])); x.closePath(); x.stroke(); x.restore(); }
    mark([0, 0, 0], 0, '#5a5a5a', 'A');
    const it = ANG.info(S, this.cam), tp = B.project(this.cam.target), bp = B.project(this.cam.pos);
    if (tp && bp) dash(bp, tp, 'rgba(224,40,40,.55)', 1.5);
    mark(this.cam.pos, it.yaw * Math.PI / 180, '#e02828', 'B');
    const plus = (q: number[], col: string) => { x.strokeStyle = '#fff'; x.lineWidth = 5 * k; x.beginPath(); x.arc(q[0], q[1], 7 * k, 0, 7); x.stroke(); x.strokeStyle = col; x.lineWidth = 2 * k; x.beginPath(); x.arc(q[0], q[1], 7 * k, 0, 7); x.moveTo(q[0] - 11 * k, q[1]); x.lineTo(q[0] + 11 * k, q[1]); x.moveTo(q[0], q[1] - 11 * k); x.lineTo(q[0], q[1] + 11 * k); x.stroke(); };
    this.ex.forEach((e, i) => {
      if (e.status === 'err') return; const col = ANGLE_EX_COLORS[i % ANGLE_EX_COLORS.length], ep = B.project(e.pose.pos), et = B.project(this.exTarget(e));
      if (ep && et) dash(ep, et, col + '99', 1.5);
      mark(e.pose.pos, e.pose.yaw * Math.PI / 180, col, ANGLE_EX_LETTERS[i] || '?');
      if (i === this.exSel && ep) { x.strokeStyle = col; x.lineWidth = 2 * k; x.beginPath(); x.arc(ep[0], ep[1], 13 * k, 0, 7); x.stroke(); }
      if (et) plus(et, col);
    });
    if (tp) plus(tp, '#e02828');
  }
  // the controls show what the camera is now (the room may have stopped it)
  sync() {
    const S = this.S, cam = this.cam; const on = !!(S && cam);
    if (!on) { this.emit(); return; }
    this.same = ANG.isSame(S as AngleSet, cam as AngleCam);
    this.part = this.same ? null : ANG.part(S as AngleSet, cam as AngleCam); this.tight = !!this.part && ANG.tightOf(S as AngleSet, cam as AngleCam, this.part);
    this.unseen = null; this.sh = null; this.estLine(); this.infoLine(); this.draw();
    if (this.unseenT) clearTimeout(this.unseenT);
    const same = this.same;
    this.unseenT = setTimeout(() => {
      if (!this.S || !this.cam || same || !this.t) return; const w = 192, h = Math.max(24, Math.round(192 * this.t.h / this.t.w)), V = ANG.camView(this.S, this.cam, w, h);
      try { this.unseen = this.gl.unseen(V, undefined, true, true); } catch (e) { this.unseen = null; }
      try { this.sh = this.exReady().length ? { n: this.gl.count(), by: this.gl.shares(V, true, true).by } : null; } catch (e) { this.sh = null; }
      this.estLine(); this.infoLine(); this.emit();
    }, 220);
    this.emit();
  }
  /** 220ms 뒤에 재는 '새로 그릴 곳'을 바로 잰다 (시험 · 화면 찍기용). */
  measureNow() {
    if (this.unseenT) { clearTimeout(this.unseenT); this.unseenT = 0; }
    if (!this.S || !this.cam || this.same || !this.t) return; const w = 192, h = Math.max(24, Math.round(192 * this.t.h / this.t.w)), V = ANG.camView(this.S, this.cam, w, h);
    try { this.unseen = this.gl.unseen(V, undefined, true, true); } catch (e) { this.unseen = null; }
    try { this.sh = this.exReady().length ? { n: this.gl.count(), by: this.gl.shares(V, true, true).by } : null; } catch (e) { this.sh = null; }
    this.estLine(); this.infoLine(); this.emit();
  }
  // v0.4.8: the added pictures that go to GPT - those that show in the B view (0.5 % of it or more; all of them until it is measured).
  private exSend(by?: number[] | null): Extra[] { const xs = this.exReady(); by = by || (this.sh && this.sh.n === xs.length + 1 ? this.sh.by : null); return by ? xs.filter((e, i) => (by as number[])[i + 2] >= ANGLE_SEND_MIN) : xs; }
  private estLine() {
    if (!this.S || !this.cam || this.same) { this.estS = ''; return; }
    const all = this.exReady(), sent = this.exSend(), off = all.filter((e) => !sent.includes(e)).map((e) => ANGLE_EX_LETTERS[this.ex.indexOf(e)]), nm = this.paint.notes.length;
    const rate = this.host.krwPerUsd || 1400;
    this.estS = 'GPT 그림 1장 ' + angleEst(sent.length, rate) + (all.length ? ' (보내는 그림 ' + (sent.length + 2) + '장' + (off.length ? ' · B에 안 보이는 ' + off.join('·') + '는 안 보내요' : '') + ')' : '') +
      (nm ? ' + PD 메모 읽기 ' + angleMemoEst(this.host.pdPrice ?? null, rate) : '') + ' · 깊이와 입체 판은 0원';
  }
  private info(text: string, kind: AngleUi['infoKind'] = '') { this.infoS = { text: text || '', kind }; }
  private infoLine() {
    const S = this.S, cam = this.cam; if (!S || !cam) return;
    if (this.err) { this.info(this.err, 'err'); return; }
    if (cam.preset === 'vp' && cam.shift && Math.abs(cam.shift[0]) < 0.02 && Math.abs(cam.shift[1]) < 0.02) { this.info('투시만 바꾸기: B 그림의 빨간 점(소실점)을 끌면 뒷벽은 그대로 두고 소실점과 지평선만 옮겨요.', ''); return; }
    if (ANG.near(S, cam) && cam.preset !== 'vp') { this.info('원래 카메라 그대로예요. 도면에서 빨간 B를 끌거나 위 버튼을 골라 보세요.', ''); return; }
    const it = ANG.info(S, cam); let note = '';
    if (cam.preset && /^(left|right)(20|45)$/.test(cam.preset) && Math.abs(Math.abs(it.orbit) - +cam.preset.replace(/\D/g, '')) > 3) note = ' · ' + ANGLE_PRESET_LABEL[cam.preset] + ' 자리는 방 밖이라 벽 안쪽에 섰어요 (실험에서 가장 잘 나온 자리)';
    const u = this.unseen, much = !!u && u.all >= 0.6, vpMuch = !much && cam.preset === 'vp' && !!u && u.all >= ANGLE_VP_MUCH;
    const nx = this.exReady().length;
    if (nx) note += ' · 그림 ' + (nx + 1) + '장 합침';
    if (this.tight && this.part) note += ' · 가까이 잡은 샷 (원래 그림의 ' + Math.round(this.part.area * 100) + '%만 보여요): GPT에게 그 부분만 잘라 보내고 화면 밖은 그리지 말라고 적어요';
    if (cam.pos[2] > 0.3) note += ' · A보다 ' + cam.pos[2].toFixed(1) + 'm 뒤로 뺐어요';
    if (u && u.under >= ANGLE_UNDER_MIN) note += ' · 눈보다 높은 것의 밑면 ' + Math.round(u.under * 100) + '% (탁자 윗면 같은 것: 어둡게 칠해서 보내고, 주문서에 윗면은 안 보인다고 적어요)';
    if (u && u.all >= 0.1) note += ' · GPT가 새로 그릴 곳 약 ' + Math.round(u.all * 100) + '% (회색 ' + Math.round(u.grey * 100) + '% · 늘어난 곳 ' + Math.round(u.smear * 100) + '%' + (u.under >= 0.005 ? ' · 밑면 ' + Math.round(u.under * 100) + '%' : '') + ')' +
      (vpMuch ? ': 투시를 많이 옮겨서 GPT가 지어낼 곳이 많아요 (탁자 · 의자 자리가 틀어질 수 있어요). 덜 옮기거나, 붓 · 메모 · 같은 공간 그림으로 알려 주세요' : '') + (much ? ': 너무 많으면 같은 장소로 안 보일 수 있어요. ' + (nx ? '덜 돌리거나, 같은 공간 그림을 더하거나, 러프로 칠해 보세요' : '덜 돌리거나 가까이 가 보세요') : '');
    const ns = this.paint.strokes.length, nm = this.paint.notes.length;
    if (ns || nm) note += this.paint.cam && this.paint.cam !== this.camSig() ? ' · 칠한 러프와 메모는 화면에 붙어 있어요: B를 옮겼다면 맞는 자리인지 봐 주세요' : (ns ? ' · 러프 덧댄 곳 ' + ns + '획' : '') + (nm ? ' · 메모 ' + nm + '개 (PD가 읽어요)' : '');
    this.info('B: ' + ANG.ko(S, cam) + note, much || vpMuch ? 'warn' : 'ok');
  }
  set(cam: AngleCam) { if (!this.S) return; this.cam = cam; this.err = ''; this.sync(); }
  /** 보내기 전에 실패한 글을 창에 남긴다 (HTML: 창이 열려 있으면 AG.err). 빈 글이면 지운다. */
  setError(msg: string) { this.err = msg || ''; if (this.S && this.cam) this.infoLine(); else this.info(this.err, this.err ? 'err' : ''); this.emit(); }
  private wait(on: boolean, title = '', hint = '', frac: number | null = null) { this.waitS = { on, title, hint, frac: on ? frac : null, retry: on ? this.waitS.retry : false }; this.emit(); }

  /* ---------- 도면: B(서는 곳) · +(보는 곳) 끌기, 바닥을 누르면 B 가 그 자리로 ---------- */
  private pt(e: PointerEvent): [number, number, number] { const c = (this.els as AngleEls).planUi, r = c.getBoundingClientRect(), k = c.width / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k, k]; }
  private hit(p: [number, number, number]): string | null {
    const B = this.B, cam = this.cam; if (!B || !cam) return null;
    const tp = B.project(cam.target), bp = B.project(cam.pos), d = (q: number[] | null) => q ? Math.hypot(q[0] - p[0], q[1] - p[1]) / p[2] : 1e9;
    if (d(tp) < 14) return 'tgt'; if (d(bp) < 18) return 'cam';
    const order = this.ex.map((e, i) => i).sort((a, b) => Number(b === this.exSel) - Number(a === this.exSel));
    for (const i of order) { const e = this.ex[i]; if (e.status === 'err') continue; if (d(B.project(this.exTarget(e))) < 14) return 'xt' + i; if (d(B.project(e.pose.pos)) < 18) return 'xc' + i; }
    return null;
  }
  private moveTo(p: [number, number, number]) {
    const S = this.S, B = this.B, cam = this.cam; if (!S || !B || !cam) return;
    if (this.drag && this.drag[0] === 'x') {    // an added picture's camera (where it stands) or its + (where it looks)
      const e = this.ex[+this.drag.slice(2)]; if (!e) return; const h = ANG.hitY(B, p[0], p[1], e.pose.pos[1]); if (!h) return;
      if (this.drag[1] === 'c') { e.pose.pos[0] = Math.min(Math.max(h[0], S.xmin - 1), S.xmax + 1); e.pose.pos[2] = Math.min(Math.max(h[2], -S.Zback - 1), this.exZmax()); }
      else { const dx = h[0] - e.pose.pos[0], dz = h[2] - e.pose.pos[2]; if (Math.hypot(dx, dz) > 0.2) e.pose.yaw = Math.atan2(dx, -dz) * 180 / Math.PI; }
      this.exMoved = true; this.exSync(); this.emit(); return;
    }
    if (this.drag === 'tgt') { const h = ANG.hitY(B, p[0], p[1], cam.target[1]); if (h) this.set(ANG.fixCam(S, { pos: cam.pos.slice(), target: [h[0], cam.target[1], h[2]] })); }
    else { const h = ANG.hitY(B, p[0], p[1], cam.pos[1]); if (h) this.set(ANG.fixCam(S, { pos: [h[0], cam.pos[1], h[2]], target: cam.target.slice() })); }
  }
  private mapDown(e: PointerEvent) {
    if (!this.S || this.drawing || e.button) return; const p = this.pt(e), hit = this.hit(p); this.drag = hit || 'cam'; this.exMoved = false;
    if (hit && hit[0] === 'x') { this.exSel = +hit.slice(2); this.emit(); this.draw(); }
    (this.els as AngleEls).planUi.setPointerCapture(e.pointerId); if (this.drag === 'cam' && !hit) this.moveTo(p); e.preventDefault();
  }
  private mapUp() {
    const d = this.drag; this.drag = null; if (d) this.draw();
    if (d && d[0] === 'x' && this.exMoved) { const e = this.ex[+d.slice(2)]; this.exMoved = false; if (e && e.dp) { this.exBuild(e); this.exSync(); this.sync(); } }   // let go: its size follows the wall it now faces
  }
  private mapKey(e: KeyboardEvent) {
    if (!this.S || !this.cam) return; const it = ANG.info(this.S, this.cam), m = ({ ArrowLeft: ['o', -2], ArrowRight: ['o', 2], ArrowUp: ['d', -0.03], ArrowDown: ['d', 0.03] } as Record<string, [string, number]>)[e.key]; if (!m) return;
    e.preventDefault(); this.set(m[0] === 'o' ? ANG.setOrbit(this.S, this.cam, it.orbit + m[1]) : ANG.setDist(this.S, this.cam, Math.max(0.2, it.dist + m[1])));
  }
  /** 바로 고르기 (HTML agPre). 투시만 바꾸기는 한 번 더 누르면 원래대로. */
  preset(p: AnglePreset) {
    if (!this.P || !this.S || this.drawing) return;
    if (p === 'vp') { this.set(this.cam && this.cam.preset === 'vp' ? this.P.orig : ANG.vpCam(this.S, [0, 0])); return; }   // 투시만 바꾸기 on (from camera A) / off
    this.set(this.P[p]);
  }
  orbit(v: number) { if (this.S && this.cam) this.set(ANG.setOrbit(this.S, this.cam, v)); }
  dist(pct: number) { if (this.S && this.cam) this.set(ANG.setDist(this.S, this.cam, pct / 100)); }
  height(v: number) { if (this.S && this.cam) this.set(ANG.setHeight(this.S, this.cam, v)); }
  pitch(v: number) { if (this.S && this.cam) this.set(ANG.setPitch(this.S, this.cam, v)); }
  setKind(v: AngleKind) { if (v === this.kind) return; this.kind = v; if (this.S) this.build(this.cam); else this.emit(); }   // a new set: the same preset, or the hand-placed camera kept inside the new room
  fovInput(v: number) { this.fovShow = v; this.emit(); }
  fovChange(v: number) { this.fovShow = v; this.hfov = v; if (this.S) this.build(this.cam); else this.emit(); }
  setShowOrig(on: boolean) { if (this.showOrig !== on) { this.showOrig = on; this.emit(); } }
  /** '원래 그림 기준으로' (HTML agBack): 원래 그림을 기준으로, 이 결과의 카메라 자리에서 다시 시작 (같은 공간 그림도). */
  async goBack() {
    const cur = this.t, src = this.back; if (!cur || !cur.angle || !src) return; const a = cur.angle;
    const ex: KeptExtra[] = [];
    for (const x of a.sources || []) {
      let t: AngleTarget | null = null;
      if (x.kind === 'result' && x.id != null && this.host.resolveResult) { try { t = await this.host.resolveResult(x.id); } catch { t = null; } }
      else if (x.kind === 'file' && x.key) t = this.keptFile(x.key);
      if (t) ex.push({ t, pose: { pos: x.pos.slice() as Vec3, yaw: x.yaw, s: 1 }, size: x.size || 1, eye: x.eye || null });
    }
    this.pending = { pos: a.pos, target: a.target, preset: a.preset, shift: a.shift || null, kind: a.kind, hfov: a.hfov, ex };
    this.switchTo(src); await this.head(); await this.load();
  }
  // a picture added from a file is not kept with the results: while the app is open the memory still has it
  private keptFile(key: string): AngleTarget | null { for (const k of angleMemory.keep.values()) for (const x of k.ex || []) if (x.t && x.t.kind === 'file' && x.t.key === key) return x.t; for (const e of this.ex) if (e.t.kind === 'file' && e.t.key === key) return e.t; return null; }

  /* ---------- v0.4.6: 같은 공간 그림 ---------- */
  exReady(): Extra[] { return this.ex.filter((e) => e.status === 'ready' && !!e.S); }
  private keepOf(): Kept {
    return { kind: this.kind, hfov: this.hfov, cam: this.cam as AngleCam, strokes: this.paint.strokes.slice(), notes: this.paint.notes.map((n) => { const o = Object.assign({}, n); delete o._editing; return o; }), paintCam: this.paint.cam,
      ex: this.ex.filter((e) => e.status !== 'err').map((e) => ({ t: e.t, pose: { pos: e.pose.pos.slice() as Vec3, yaw: e.pose.yaw, s: 1 }, size: e.size, eye: e.eye })) };
  }
  // where an added picture's camera looks, for its + on the map
  private exTarget(e: Extra): Vec3 { const L = Math.max(0.8, Math.min(3, 0.6 * (e.dist || 3))), t = e.pose.yaw * Math.PI / 180; return [e.pose.pos[0] + Math.sin(t) * L, e.pose.pos[1], e.pose.pos[2] - Math.cos(t) * L]; }
  // a new picture starts in the middle of the room facing a side wall (then the right, the left, the way back); the artist moves it
  private exDefaultPose(i: number): Extra['pose'] { const S = this.S as AngleSet, r = Math.floor(i / 3); return { pos: [(S.xmin + S.xmax) / 2 + (r % 2 ? 0.6 : 0), 0, -S.Zback / 2 + 1.2 * r], yaw: [90, -90, 180][i % 3], s: 1 }; }   // (the next three a little apart)
  private exDropAll() { this.ex = []; this.exSel = -1; try { this.gl.setExtras([]); } catch (err) { /* no renderer yet */ } this.emit(); }
  async exAdd(t: AngleTarget, opt: { pose?: KeptExtra['pose']; size?: number; eye?: number | null; quiet?: boolean } = {}) {     // a kept or restored picture
    if (!this.S || this.drawing) return;
    if (this.ex.length >= ANGLE_EX_MAX) { this.toast('같은 공간 그림은 ' + ANGLE_EX_MAX + '장까지 더할 수 있어요'); return; }
    if (!this.gl.canMerge) { this.toast('이 PC에서는 그림을 합칠 수 없어요 (그래픽 기능이 모자라요). 이 PC 점검을 확인해 주세요.'); return; }
    const key = t.key;
    if (key === this.key || this.ex.some((e) => e.key === key)) { if (!opt.quiet) this.toast(key === this.key ? '지금 기준 그림이에요. 다른 그림을 골라 주세요' : '이미 들어 있는 그림이에요'); return; }
    const host = this.key, i = this.ex.length;
    const e: Extra = { uid: ++this.uid, t, key, name: t.name || '', img: null, thumb: t.thumb || '', dp: null, ref: null, S: null, gen: 0,
      pose: opt.pose ? { pos: opt.pose.pos.slice() as Vec3, yaw: opt.pose.yaw, s: 1 } : this.exDefaultPose(i), size: opt.size || 1, eye: opt.eye || null,
      wall: null, dist: 0, anch: false, status: 'load', msg: '그림 여는 중' };
    this.ex.push(e); this.exSel = this.ex.length - 1; this.emit(); this.draw();
    try { e.img = await loadImg(t.src); if (!e.thumb) e.thumb = scaled(e.img, 160).toDataURL('image/jpeg', .8); }
    catch (err) { e.status = 'err'; e.msg = '그림을 열지 못했어요'; this.emit(); return; }
    if (!this.ex.includes(e) || this.key !== host) return;
    let dp = angleMemory.depth.get(key);
    if (!dp) {
      e.status = 'depth'; e.msg = '깊이 재는 중 (0원)'; this.emit();
      try { let job = angleMemory.jobs.get(key); if (!job) { job = this.depthFn(e.img).finally(() => angleMemory.jobs.delete(key)); angleMemory.jobs.set(key, job); } dp = await job; angleMemory.depth.set(key, dp); }
      catch (err) { if (this.ex.includes(e)) { e.status = 'err'; e.msg = '깊이를 재지 못했어요'; this.emit(); } return; }
    }
    if (!this.ex.includes(e) || this.key !== host || !this.S) return;
    e.dp = dp; e.status = 'ready'; e.msg = ''; this.exBuild(e); this.exSync(); this.sync();
  }
  private async exRestore(list: KeptExtra[]) {
    for (const k of list || []) {
      let t = k.t; if (!t) continue;
      if (t.kind === 'result' && t.id && this.host.resolveResult) { const r = await this.host.resolveResult(t.id).catch(() => null); if (!r) continue; t = r; }
      await this.exAdd(t, { pose: k.pose, size: k.size, eye: k.eye, quiet: true });
    }
  }
  // an added picture's set: its floor rows sit on camera A's floor (its eye height), its back on the wall it faces on the map
  private exBuild(e: Extra) {
    const S = this.S; if (!S || !e.dp) return;
    const eye = e.eye || S.camH; e.pose.pos[1] = eye - S.camH;
    e.ref = ANG.scaleRefs(e.dp.disp, e.dp.dw, e.dp.dh, e.t.w, e.t.h, { kind: this.kind, hfov: this.hfov, h: eye });
    const wa = ANG.wallAhead(S, e.pose.pos, e.pose.yaw), base = wa ? wa.dist : Math.max(2.5, 0.6 * S.Zback), an = ANG.anchorsFor(e.ref, base * e.size);
    e.wall = wa; e.S = ANG.build(e.dp.disp, e.dp.dw, e.dp.dh, e.t.w, e.t.h, an ? { kind: this.kind, hfov: this.hfov, h: eye, anchors: an } : { kind: this.kind, hfov: this.hfov, h: eye });
    e.anch = !!an; e.dist = an ? base * e.size : e.S.Zback; e.gen++;
  }
  private exSync(quiet?: boolean) {
    if (!this.S) return;
    const xs = this.exReady(), ps = xs.map((e) => e.pose.pos);   // v0.4.8: B may go where the added pictures' cameras stand
    this.S.ext = ps.length ? { xmin: Math.min(...ps.map((p) => p[0])) - 0.3, xmax: Math.max(...ps.map((p) => p[0])) + 0.3, zmax: Math.max(...ps.map((p) => p[2])) } : null;
    if (this.cam && !this.cam.preset) this.cam = ANG.fixCam(this.S, this.cam);
    try { this.gl.setExtras(xs.map((e) => ({ key: e.key + '#' + e.gen, S: e.S as AngleSet, img: e.img as HTMLImageElement, pose: e.pose }))); }
    catch (err) { this.exFail(); return; }
    if (!quiet) { this.renderMap(); this.draw(); }
  }
  private exFail() {
    for (const e of this.ex) if (e.status === 'ready') { e.status = 'err'; e.msg = '이 PC에서는 합치지 못했어요'; }
    try { this.gl.setExtras([]); } catch (err) { /* nothing to drop */ } this.emit();
  }
  exRemove(i: number) {
    const e = this.ex[i]; if (!e || this.drawing) return;
    this.ex.splice(i, 1); this.exSel = Math.min(this.exSel, this.ex.length - 1); this.exSync(); this.sync();
  }
  exPick(i: number) { this.exSel = i; this.emit(); this.draw(); }
  private exSub(e: Extra): string {
    if (!e.anch) return '자기 그림으로 잰 크기 · 벽까지 ' + e.dist.toFixed(1) + 'm';
    return (e.wall ? WALL_KO[e.wall.wall] + '까지 ' : 'A가 못 본 쪽 · 벽까지 ') + e.dist.toFixed(1) + 'm' + (Math.abs(e.size - 1) > 0.005 ? ' (' + Math.round(e.size * 100) + '%)' : '');
  }
  exSize(pct: number) { const e = this.ex[this.exSel]; if (!e || !e.dp) return; e.size = pct / 100; this.exBuild(e); this.exSync(); this.sync(); }
  exEye(v: number) { const e = this.ex[this.exSel]; if (!e || !e.dp || !this.S) return; e.eye = Math.abs(v - this.S.camH) < 0.026 ? null : v; this.exBuild(e); this.exSync(); this.sync(); }

  /* ---------- v0.4.6 러프 덧대기 · v0.4.8 PD메모 ---------- */
  private camSig() { return this.cam ? this.cam.pos.concat(this.cam.target).map((v) => v.toFixed(2)).join(',') : ''; }
  private paintRedraw() { const c = this.els?.paint; if (!c) return; const x = c.getContext('2d') as CanvasRenderingContext2D; x.clearRect(0, 0, c.width, c.height); anglePaintDraw(x, c.width, c.height, this.paint.cur ? this.paint.strokes.concat([this.paint.cur]) : this.paint.strokes); }
  private noteRedraw() { const c = this.els?.note; if (!c) return; const x = c.getContext('2d') as CanvasRenderingContext2D; x.clearRect(0, 0, c.width, c.height); angleNotesDraw(x, c.width, c.height, this.paint.curNote ? this.paint.notes.concat([this.paint.curNote]) : this.paint.notes); }
  private noteHit(p: [number, number]): AngleNoteDraw | null {    // the text note under a point (its letters' box, a little wider)
    const c = (this.els as AngleEls).note, x = c.getContext('2d') as CanvasRenderingContext2D, w = Math.max(1, c.width), h = Math.max(1, c.height);
    for (let i = this.paint.notes.length - 1; i >= 0; i--) {
      const n = this.paint.notes[i]; if (n.type !== 'text') continue;
      const fs = Math.max(10, n.size * w), ls = n.text.split('\n'); x.save(); x.font = '800 ' + fs + 'px ' + FONT; const tw = Math.max(...ls.map((l) => x.measureText(l).width)); x.restore();
      if (p[0] >= n.x - 0.01 && p[0] <= n.x + tw / w + 0.01 && p[1] >= n.y - 0.01 && p[1] <= n.y + ls.length * fs * 1.22 / h + 0.01) return n;
    }
    return null;
  }
  // a text note: typed in a box where it goes (Enter puts it in, Shift+Enter a new line, Esc leaves it); a note clicked again is edited, and emptied it goes
  private noteEdit(p: [number, number]) {
    this.noteCommit();
    const els = this.els as AngleEls, hit = this.noteHit(p), ta = els.noteText, r = els.paint.getBoundingClientRect(), at = hit && hit.type === 'text' ? [hit.x, hit.y] : p;
    this.paint.edit = hit ? { note: hit } : { at: p };
    ta.value = hit && hit.type === 'text' ? hit.text : '';
    this.noteEditS = { on: true, left: at[0] * 100, top: at[1] * 100, font: Math.max(11, Math.round((hit && hit.type === 'text' ? hit.size : ANGLE_NOTE_SIZE) * r.width)), text: ta.value };
    ta.hidden = false; ta.style.left = (at[0] * 100) + '%'; ta.style.top = (at[1] * 100) + '%'; ta.style.fontSize = this.noteEditS.font + 'px';
    if (hit) { hit._editing = true; this.noteRedraw(); }
    this.emit();
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);   // (right away: the pointer press does not move the focus itself)
  }
  noteCommit(cancel?: boolean) {
    const ed = this.paint.edit; if (!ed) return; this.paint.edit = null;
    const ta = this.els?.noteText; const txt = (ta ? ta.value : this.noteEditS.text).replace(/\s+$/, ''); if (ta) { ta.hidden = true; ta.value = ''; } this.noteEditS = { ...this.noteEditS, on: false, text: '' };
    if (ed.note) { delete ed.note._editing; if (!cancel && ed.note.type === 'text') { if (txt.trim()) ed.note.text = txt; else this.paint.notes.splice(this.paint.notes.indexOf(ed.note), 1); } }
    else if (!cancel && txt.trim() && ed.at) this.paint.notes.push({ type: 'text', x: ed.at[0], y: ed.at[1], text: txt, size: ANGLE_NOTE_SIZE, seq: ++this.paint.seq });
    if (!cancel) this.paint.cam = this.camSig();
    this.noteRedraw(); this.estLine(); this.infoLine(); this.emit();
  }
  /** 고치는 중인 글씨 메모가 있으면 Esc 는 그 메모만 그만둔다 (창을 닫지 않는다). */
  get editingNote() { return !!this.paint.edit; }
  paintToolSet(t: AngleTool) {
    if (t !== 'text') this.noteCommit();
    this.paint.tool = t; const c = this.els?.paint;
    if (c) { c.classList.toggle('on', !!t && t !== 'pick' && t !== 'text'); c.classList.toggle('pick', t === 'pick'); c.classList.toggle('txt', t === 'text'); }
    this.emit();
  }
  toggleTool(t: Exclude<AngleTool, ''>) { this.paintToolSet(this.paint.tool === t ? '' : t); }
  setColor(hex: string) { this.paint.col = hex; if (this.paint.tool !== 'brush') this.paintToolSet('brush'); else this.emit(); }
  setBrush(px: number) { this.paint.size = px; this.emit(); }
  undo() {   // the newest stroke or note
    this.noteCommit(true); const st = this.paint.strokes, nt = this.paint.notes, ls = st.length ? st[st.length - 1].seq || 0 : -1, ln = nt.length ? nt[nt.length - 1].seq || 0 : -1;
    if (ln > ls) nt.pop(); else st.pop();
    this.paintRedraw(); this.noteRedraw(); this.estLine(); this.infoLine(); this.emit();
  }
  clearPaint() { this.noteCommit(true); this.paint.strokes = []; this.paint.notes = []; this.paintRedraw(); this.noteRedraw(); this.estLine(); this.infoLine(); this.emit(); }
  private paintXY(e: PointerEvent): [number, number] { const r = (this.els as AngleEls).paint.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; }
  private paintDown(e: PointerEvent) {
    const els = this.els as AngleEls;
    if (e.button || !this.S || this.drawing) return; const p = this.paintXY(e), c = els.paint, t = this.paint.tool, cw = Math.max(1, c.getBoundingClientRect().width);
    if (t === 'pick') {   // the colour under the pointer: a stroke there, else the B view
      const px = Math.min(c.width - 1, Math.floor(p[0] * c.width)), py = Math.min(c.height - 1, Math.floor(p[1] * c.height));
      let d = (c.getContext('2d') as CanvasRenderingContext2D).getImageData(px, py, 1, 1).data; if (d[3] < 128) d = (els.view.getContext('2d') as CanvasRenderingContext2D).getImageData(px, py, 1, 1).data;
      const hex = '#' + [d[0], d[1], d[2]].map((n) => n.toString(16).padStart(2, '0')).join(''); this.paint.col = hex; this.paintToolSet('brush'); e.preventDefault(); return;
    }
    if (t === 'text') { e.preventDefault(); this.noteEdit(p); return; }
    if (t === 'arrow' || t === 'mark') {
      this.paint.curNote = t === 'arrow' ? { type: 'arrow', x1: p[0], y1: p[1], x2: p[0], y2: p[1], w: 4 / cw } : { type: 'mark', pts: [p], w: 4 / cw };
      c.setPointerCapture(e.pointerId); this.noteRedraw(); e.preventDefault(); return;
    }
    if (t !== 'brush' && t !== 'erase') return;
    this.paint.cur = { col: this.paint.col, w: this.paint.size / cw, pts: [p] }; if (t === 'erase') this.paint.cur.erase = true;
    c.setPointerCapture(e.pointerId); this.paintRedraw(); e.preventDefault();
  }
  private paintMove(e: PointerEvent) {
    const n = this.paint.curNote;
    if (n) { const p = this.paintXY(e); if (n.type === 'arrow') { n.x2 = p[0]; n.y2 = p[1]; } else if (n.type === 'mark') { const q = n.pts[n.pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.002) return; n.pts.push(p); } this.noteRedraw(); return; }
    const s = this.paint.cur; if (!s) return; const p = this.paintXY(e), q = s.pts[s.pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.002) return; s.pts.push(p); this.paintRedraw();
  }
  private paintUp() {
    const n = this.paint.curNote;
    if (n) {
      this.paint.curNote = null;
      if (n.type === 'arrow' ? Math.hypot(n.x2 - n.x1, n.y2 - n.y1) > 0.015 : n.type === 'mark' && n.pts.length > 1) { n.seq = ++this.paint.seq; this.paint.notes.push(n); this.paint.cam = this.camSig(); }
      this.noteRedraw(); this.estLine(); this.infoLine(); this.emit(); return;
    }
    const s = this.paint.cur; if (!s) return; this.paint.cur = null; s.seq = ++this.paint.seq; this.paint.strokes.push(s); this.paint.cam = this.camSig(); this.paintRedraw(); this.infoLine(); this.emit();
  }

  /* ---------- 창이 그릴 글자 ---------- */
  private compute(): AngleUi {
    const S = this.S, cam = this.cam, on = !!(S && cam), t = this.t;
    const it: AngleInfo | null = on ? ANG.info(S as AngleSet, cam as AngleCam) : null;
    const nx = this.exReady().length;
    if (t && this.img && this.thumbA.key !== this.key) this.thumbA = { key: this.key, url: scaled(this.img, 160).toDataURL('image/jpeg', .8) };
    const e = this.ex[this.exSel], exOn = !!(e && e.status === 'ready' && S);
    const eyeA = e ? (e.eye || (S ? S.camH : 1.2)) : 1.2;
    const vpOn = !!(S && cam && cam.preset === 'vp' && cam.shift);
    return {
      ready: on, drawing: this.drawing,
      target: t ? (t.kind === 'file' ? '기준: 불러온 그림 ' : '기준: 지금 결과 ') + (t.name || '') + ' (' + t.w + '×' + t.h + ')' : '',
      back: this.back ? '이 그림은 \'' + (this.back.name || '원래 그림') + '\'에서 다른 각도로 그린 거예요. 원래 그림을 기준으로, 이 그림의 카메라 자리에서 다시 시작해요' : null,
      wait: { ...this.waitS },
      preset: on ? (cam as AngleCam).preset : null,
      orbit: it ? Math.round(it.orbit) : 0, orbitText: it ? (Math.abs(it.orbit) < 0.5 ? '0' : (it.orbit > 0 ? '오른쪽 ' : '왼쪽 ') + Math.round(Math.abs(it.orbit))) + '°' : '',
      dist: it ? Math.round(it.dist * 100) : 100, distText: it ? Math.round(it.dist * 100) + '%' : '',
      height: it ? +it.floorH.toFixed(2) : 1.2, heightText: it ? ANG.mKo(it.floorH) + 'm' + (Math.abs(it.dy) < 0.05 ? ' (눈높이)' : '') : '', heightMax: this.heightMax,
      pitch: it ? Math.round(it.pitch) : 0, pitchText: it ? (Math.abs(it.pitch) < 0.5 ? '수평' : (it.pitch < 0 ? '아래 ' : '위 ') + Math.round(Math.abs(it.pitch)) + '°') : '',
      kind: this.kind, fov: this.fovShow, fovText: this.fovShow + '°',
      info: this.infoS.text, infoKind: this.infoS.kind,
      est: this.estS, go: on && !this.same && !this.drawing,
      vp: { on: vpOn, x: vpOn ? ((cam as AngleCam).shift![0] + 1) / 2 * 100 : 50, y: vpOn ? (1 - (cam as AngleCam).shift![1]) / 2 * 100 : 50, text: vpOn ? ANG.ko(S as AngleSet, cam as AngleCam) : '' },
      planCap: '위에서 본 입체 판 · 회색 A = 원래 카메라 · ' + (this.ex.length ? this.ex.map((x, i) => ANGLE_EX_COLOR_KO[i] + ' ' + ANGLE_EX_LETTERS[i]).join(' · ') + ' = 더한 그림의 카메라 · ' : '') + '빨간 B = 새 카메라 · + = 보는 곳 · 점선 = B가 설 수 있는 곳 · 끌어서 옮겨요',
      viewTitle: 'B에서 본 입체 판' + (nx ? ' (그림 ' + (nx + 1) + '장 합침)' : ''),
      viewCap: nx ? 'GPT에게 가는 밑그림 · 회색 = 어느 그림에도 없던 곳' : '이 그림이 GPT에게 가는 밑그림이에요 · 회색 = 원래 그림에 없던 곳 (GPT가 채워요)',
      aChip: t && this.img ? { thumb: this.thumbA.url, title: 'A · ' + (t.name || '원래 그림'), sub: '기준 (' + (t.kind === 'file' ? '불러온 그림' : '지금 결과') + ')' } : null,
      chips: this.ex.map((x, i) => ({ i, letter: ANGLE_EX_LETTERS[i] || '?', color: ANGLE_EX_COLORS[i % ANGLE_EX_COLORS.length], colorKo: ANGLE_EX_COLOR_KO[i] || '', title: (ANGLE_EX_LETTERS[i] || '?') + ' · ' + (x.name || '같은 공간 그림'),
        sub: x.status === 'ready' ? this.exSub(x) : x.msg || '', thumb: x.thumb, on: i === this.exSel, err: x.status === 'err', ready: x.status === 'ready' })),
      canAdd: !!S && !this.drawing && this.ex.length < ANGLE_EX_MAX, exCount: this.ex.length,
      exSel: exOn && S ? { letter: ANGLE_EX_LETTERS[this.exSel] || '?', color: ANGLE_EX_COLORS[this.exSel % ANGLE_EX_COLORS.length], size: Math.round(e.size * 100), sizeText: Math.round(e.size * 100) + '% · 벽까지 ' + e.dist.toFixed(1) + 'm',
        eye: +eyeA.toFixed(2), eyeMax: Math.floor(Math.max(2, ANG.yHigh(S) + S.camH) * 20) / 20, eyeText: eyeA.toFixed(2) + 'm' + (e.eye ? '' : ' (A와 같게)'), enabled: !this.drawing && e.anch } : null,
      tool: this.paint.tool, color: this.paint.col, brush: this.paint.size,
      undo: (this.paint.strokes.length + this.paint.notes.length) > 0 && !this.drawing, clear: (this.paint.strokes.length + this.paint.notes.length) > 0 && !this.drawing,
      showOrig: this.showOrig, noteEdit: { ...this.noteEditS }, origSrc: t ? t.src : '',
    };
  }

  /* ---------- '이 각도로 그리기' (HTML agGo 의 보내기 전 부분) ---------- */
  /**
   * 밑그림(B 에서 본 입체 판 + 붓) · 원래 그림(가까이 잡은 샷이면 그 부분) · B 에 보이는 같은 공간 그림을 PNG 로, 카메라 문장 · 기록과 함께.
   * 실패하면 창에 글을 남기고 null. 성공하면 이 그림의 카메라 · 붓 · 메모를 기억해 둔다 (닫았다 열어도).
   */
  async prepare(): Promise<BaeAngleDrawCall | null> {
    if (!this.S || !this.cam || this.drawing || !this.t || !this.img) return null;
    if (ANG.isSame(this.S, this.cam)) { this.info('카메라가 원래 자리예요. 도면에서 빨간 B를 옮기거나 위 버튼을 골라 주세요.', 'err'); this.emit(); return null; }
    this.noteCommit();
    const S = this.S, cam = this.cam, t = this.t, img = this.img, dp = angleMemory.depth.get(this.key), size = angleOutSize(t, this.host.tier ?? 'm'), exs = this.exReady(), strokes = this.paint.strokes.slice(), notes = this.paint.notes.map((n) => { const o = Object.assign({}, n); delete o._editing; return o as AngleNote; });
    this.drawing = true; this.sync(); this.paintToolSet('');
    try {
      const [gw, gh] = fit(size[0], size[1], 1536);
      const pt = ANG.part(S, cam), tight = ANG.tightOf(S, cam, pt);   // v0.4.9 가까이 잡은 샷: image 2 = the part B sees, cut out
      const guide = anglePaintOn(this.gl.copy(ANG.camView(S, cam, gw, gh), { bg: GREY, mip: false, merge: exs.length > 0, cull: true, under: true, once: true }), strokes), orig = tight && pt ? angleCrop(img, pt.box) : scaled(img, 1536);
      let unseen: BaeAngleRecord['unseen'] = null; try { const u = this.gl.unseen(ANG.camView(S, cam, 192, Math.max(24, Math.round(192 * gh / gw))), undefined, true, true); unseen = { grey: Math.round(u.grey * 1000) / 1000, smear: Math.round(u.smear * 1000) / 1000, under: Math.round(u.under * 1000) / 1000, all: Math.round(u.all * 1000) / 1000 }; } catch (e) { /* not measured */ }
      let shares: number[] | null = null; if (exs.length) try { const sh = this.gl.shares(ANG.camView(S, cam, 192, Math.max(24, Math.round(192 * gh / gw))), true, true); shares = sh.by.map((v) => Math.round(v * 1000) / 1000); } catch (e) { /* not measured */ }
      const sendX = shares ? this.exSend(shares) : exs;   // v0.4.8: an added picture that does not show in B stays home
      const item = async (c: HTMLCanvasElement) => ({ png: new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer()), small: scaled(c, 1024).toDataURL('image/jpeg', 0.86) });
      const gItem = await item(guide), oItem = await item(orig);
      const xItems: Array<{ png: Uint8Array; small: string }> = []; for (const e of sendX) xItems.push(await item(scaled(e.img as HTMLImageElement, 1536)));
      // PD메모: the rough with and without the notes, for the PD only
      let noted: string | null = null, cleanUrl: string | null = null;
      if (notes.length) { const nc = makeCanvas(gw, gh), nx = nc.getContext('2d') as CanvasRenderingContext2D; nx.drawImage(guide, 0, 0); angleNotesDraw(nx, gw, gh, notes); noted = scaled(nc, 1024).toDataURL('image/jpeg', 0.86); cleanUrl = scaled(guide, 1024).toDataURL('image/jpeg', 0.86); }
      const label = ANG.label(S, cam), it = ANG.info(S, cam);
      angleMemory.keep.set(this.key, this.keepOf());
      const record: BaeAngleRecord = {
        fromId: t.kind === 'result' ? t.id ?? null : null, fromName: t.name || '', fromKind: t.kind, preset: cam.preset || null, pos: cam.pos.slice(), target: cam.target.slice(), shift: cam.shift ? cam.shift.slice() : null, kind: this.kind, hfov: this.hfov, camH: S.camH,
        orbit: Math.round(it.orbit * 10) / 10, pitch: Math.round(it.pitch * 10) / 10, floorH: Math.round(it.floorH * 100) / 100, dist: Math.round(it.dist * 100) / 100,
        label, ko: ANG.ko(S, cam), sentence: ANG.sentence(S, cam), unseen, ep: dp ? dp.ep : '', set: { Zp: S.Zp, Zback: S.Zback, xmin: S.xmin, xmax: S.xmax, fitOk: S.fitOk },
        // v0.4.6: the added pictures (ref2, ref3, ... in the order) and how many strokes the artist painted over the rough
        sources: exs.map((e, i) => ({ letter: ANGLE_EX_LETTERS[i], kind: e.t.kind, id: e.t.kind === 'result' ? e.t.id ?? null : null, name: e.name, pos: e.pose.pos.map((v) => Math.round(v * 1000) / 1000), yaw: Math.round(e.pose.yaw * 10) / 10,
          size: e.size, eye: e.eye || null, wall: e.wall ? e.wall.wall : null, dist: Math.round(e.dist * 100) / 100, anchors: e.anch, ep: e.dp ? e.dp.ep : '', sent: sendX.includes(e), key: e.key })),
        notes: strokes.length, shares,
        crop: tight && pt ? { box: pt.box.map((v) => Math.round(v * 1000) / 1000), area: Math.round(pt.area * 1000) / 1000 } : null,   // v0.4.9 가까이 잡은 샷
        memo: null,
      };
      const newId = this.host.newId ?? (() => crypto.randomUUID());
      const now = this.host.now ?? Date.now;
      return {
        jobId: newId(), parentJobId: t.kind === 'result' ? t.id ?? null : null, createdAt: new Date(now()).toISOString(),
        images: ([gItem.png, oItem.png] as Uint8Array[]).concat(xItems.map((x) => x.png)), size,
        order: { kind: S.kind, sentence: tight ? ANG.sentence(S, cam, { tight: true }) : ANG.sentence(S, cam), n: xItems.length, notes: strokes.length > 0, crop: tight, under: !!unseen && unseen.under >= ANGLE_UNDER_MIN },
        memo: notes.length && cleanUrl && noted ? { clean: cleanUrl, noted, summary: angleNotesSummary(notes), raw: angleNotesRaw(notes), n: notes.length } : null,
        record, label, line: angleSummaryLine(label, exs.length, strokes.length, notes.length, t.kind, t.name), fileName: angleResultName(t.name, label),
        previews: { rough: gItem.small, roughNotes: noted, refs: [oItem.small].concat(xItems.map((x) => x.small)) },
      };
    } catch (e) {
      this.err = '다른 각도로 그리지 못했어요: ' + ((e && (e as Error).message) || e); this.infoLine(); this.emit(); return null;
    } finally { this.drawing = false; this.sync(); }
  }
}

/** 실내 / 실외 (HTML agGuessKind): 다른 각도로 그린 결과면 그때 고른 것, 주문서의 장소, 시간대 문장, 아니면 실내. */
export function guessKind(t: Pick<AngleTarget, 'angle' | 'place' | 'prompt'> | null): AngleKind {
  if (!t) return 'interior';
  if (t.angle && t.angle.kind) return t.angle.kind;
  if (t.place === 'interior' || t.place === 'exterior') return t.place;
  const p = t.prompt || '';
  if (/The interior (is|keeps)/.test(p)) return 'interior';
  if (/flat-bottomed white clouds|The sky is two or three flat horizontal bands|for walls, ground and sky/.test(p)) return 'exterior';
  return 'interior';
}
