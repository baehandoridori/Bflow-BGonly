/**
 * 그림판 투시 가이드의 순수 계산 (HTML v0.4.11 script_4.js `Board` 455~600줄).
 * DOM 없음 — node 시험이 바로 읽게 '@/' 대신 상대 경로를 쓴다. 숫자는 HTML 코드 값 그대로.
 */
import { CORRIDOR_STEPS, FONT, GUIDE_DEFAULTS, type GuideState, type PerspectiveId, type RatioId } from '../../../../shared/bae/order/constants.ts';

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** 무대 안 종이 자리 (HTML `geo`): 무대 왼쪽 위에서 종이까지 fx·fy, 종이 크기 fw·fh, 1px 당 화면 배율 s */
export interface Geo { fx: number; fy: number; fw: number; fh: number; s: number }
export const GEO0: Geo = { fx: 0, fy: 0, fw: 1, fh: 1, s: 1 };

/* 파랑 = 소실점으로 모이는 선, 주황 = 2점 투시에서 두 면이 만나는 모서리 (종이 위라 다크/라이트 한 벌) */
export const BLUE = 'rgba(30,140,255,.42)';
export const BLUE_STRONG = 'rgba(30,140,255,.85)';
export const FRAME = 'rgba(30,140,255,.55)';
export const CORNER = '#E8603C';
export const HORIZON = 'rgba(30,140,255,.95)';
export const HANDLE = '#1E8CFF';
export const CHIP_FONT = '700 12px ' + FONT;
export const GLYPH_FONT = '700 11px ' + FONT;

/** 2점·3점은 소실점이 종이 밖이라 둘레 여백을 넓힌다 */
export const WIDE_GUIDES: readonly PerspectiveId[] = ['2p', '3pu', '3pd'];

/** 비율 → 그림판 픽셀 크기 (긴 변 1536) */
export function dimsFor(r: RatioId | string): [number, number] {
  const [a, b] = r.split(':').map(Number);
  return a >= b ? [1536, Math.round(1536 * b / a)] : [Math.round(1536 * a / b), 1536];
}

/** setGuideType: 투시 종류의 기본 자리 (GUIDE_DEFAULTS + 빈 값은 기본값) */
export function guideFor(type: PerspectiveId): GuideState {
  const d = GUIDE_DEFAULTS[type] || GUIDE_DEFAULTS.auto;
  const pick = (k: 'v1' | 'v2' | 'v3' | 'depth' | 'cx' | 'ct' | 'cb', dv: number): number => (d[k] == null ? dv : d[k] as number);
  return { type, placed: false, hy: d.hy, v1: pick('v1', 0.5), v2: pick('v2', 1.6), v3: pick('v3', -0.9), depth: pick('depth', 0.16), cx: pick('cx', 0.42), ct: pick('ct', 0.14), cb: pick('cb', 0.86) };
}

export type GuideParam = 'spread' | 'depth' | 'use';

/** setGuideParam: 소실점 간격 · 복도 길이(1~10칸) · '지평선 및 투시 참고하게 하기' */
export function withGuideParam(G: GuideState, k: GuideParam, v: number | boolean): GuideState {
  const n = { ...G };
  if (k === 'spread') { const c = (n.v1 + n.v2) / 2, s = Number(v); n.v1 = c - s / 2; n.v2 = c + s / 2; n.placed = true; }
  else if (k === 'depth') { n.depth = CORRIDOR_STEPS[clamp(Math.round(Number(v)) - 1, 0, CORRIDOR_STEPS.length - 1)]; n.placed = true; }
  else if (k === 'use') n.placed = !!v;
  return n;
}

/** 손잡이 이름: 지평선(hz), 소실점(v1·v2·v3), 모서리 선(cx), 모서리 위·아래 점(ct·cb) */
export type GuideHandleId = 'hz' | 'v1' | 'v2' | 'v3' | 'cx' | 'ct' | 'cb';

/**
 * 가이드 끌기: 누른 곳에서 움직인 만큼(종이 크기 비율)으로 옮긴다. 범위는 HTML 코드 값 그대로
 * (지평선 -150%~250%, 소실점 -600%~700%, 모서리 -30%~130%). placed 는 바꾸지 않는다 (Board 가 켜고 알린다).
 */
export function dragGuide(g0: GuideState, G: GuideState, h: GuideHandleId, dxn: number, dyn: number): GuideState {
  const n = { ...G };
  if (h === 'hz') n.hy = clamp(g0.hy + dyn, -1.5, 2.5);
  else if (h === 'v3') n.v3 = clamp(g0.v3 + dyn, -6, 7);
  else if (h === 'cx') n.cx = clamp(g0.cx + dxn, -0.3, 1.3);
  else if (h === 'ct') { n.ct = clamp(g0.ct + dyn, -1.5, G.cb - 0.04); n.cx = clamp(g0.cx + dxn, -0.3, 1.3); }
  else if (h === 'cb') { n.cb = clamp(g0.cb + dyn, G.ct + 0.04, 2.5); n.cx = clamp(g0.cx + dxn, -0.3, 1.3); }
  else { n[h] = clamp(g0[h] + dxn, -6, 7); n.hy = clamp(g0.hy + dyn, -1.5, 2.5); }
  return n;
}

/** syncGuideCtl: 가이드 손잡이 줄이 보여 줄 것 (이름표 글자는 HTML 그대로) */
export interface GuideCtl {
  showSpread: boolean; spread: number; spreadLabel: '강하게' | '보통' | '약하게';
  showDepth: boolean; depthStep: number; depthLabel: '짧게' | '보통' | '길게' | '아주 길게';
  showUse: boolean; useOn: boolean; showLegend: boolean; showCornerKey: boolean;
}
export function guideCtl(G: GuideState): GuideCtl {
  const t = G.type, k = G.v2 - G.v1;
  const di = CORRIDOR_STEPS.reduce((best, v, i) => (Math.abs(v - G.depth) < Math.abs(CORRIDOR_STEPS[best] - G.depth) ? i : best), 0);
  return {
    showSpread: WIDE_GUIDES.includes(t), spread: clamp(k, 0.8, 5), spreadLabel: k >= 2.8 ? '약하게' : k <= 1.5 ? '강하게' : '보통',
    showDepth: t === 'corridor', depthStep: di + 1, depthLabel: di <= 2 ? '짧게' : di >= 7 ? '아주 길게' : di >= 5 ? '길게' : '보통',
    showUse: t !== 'auto', useOn: G.placed, showLegend: t !== 'auto', showCornerKey: t === '2p',
  };
}

/** layout: 무대 크기 → 종이 자리. 2점·3점이고 가이드가 보이면 둘레 여백 가로 15%, 세로 10% (아니면 5%, 최소 28px) */
export function frameGeo(sw: number, sh: number, W: number, H: number, type: PerspectiveId, showGuide: boolean): Geo {
  const wideGuide = WIDE_GUIDES.includes(type) && showGuide;
  const padX = Math.max(28, sw * (wideGuide ? 0.15 : 0.05)), padY = Math.max(28, sh * (wideGuide ? 0.1 : 0.05));
  const s = Math.min((sw - padX * 2) / W, (sh - padY * 2) / H); const fw = W * s, fh = H * s;
  return { fx: (sw - fw) / 2, fy: (sh - fh) / 2, fw, fh, s };
}

/** 화면 기울기: 0.5° 단위, -15°~15° */
export const tiltStep = (v: unknown): number => clamp(Math.round((Number(v) || 0) * 2) / 2, -15, 15);
/** gTiltVal 글자 */
export const tiltLabel = (t: number): string => (t ? (t > 0 ? '+' : '') + t + '° (' + (t > 0 ? '오른쪽이 올라감' : '왼쪽이 올라감') + ')' : '0° (수평)');

export interface StagePoint { sx: number; sy: number }
/** unturn: 무대 위 누른 자리 → 기울이기 전 가이드의 같은 자리 */
export function unturn<T extends StagePoint>(sp: T, tilt: number, geo: Geo): T {
  const TL = tilt || 0; if (!TL) return sp;
  const a = TL * Math.PI / 180, ccx = geo.fx + geo.fw / 2, ccy = geo.fy + geo.fh / 2, dx = sp.sx - ccx, dy = sp.sy - ccy;
  return Object.assign({}, sp, { sx: ccx + dx * Math.cos(a) - dy * Math.sin(a), sy: ccy + dx * Math.sin(a) + dy * Math.cos(a) });
}
/** unturn 의 반대: 기울이기 전 가이드 자리 → 무대에 그려진 자리 (시험·도구용) */
export function turn(sp: StagePoint, tilt: number, geo: Geo): StagePoint {
  const TL = tilt || 0; if (!TL) return { sx: sp.sx, sy: sp.sy };
  const a = -TL * Math.PI / 180, ccx = geo.fx + geo.fw / 2, ccy = geo.fy + geo.fh / 2, dx = sp.sx - ccx, dy = sp.sy - ccy;
  return { sx: ccx + dx * Math.cos(a) - dy * Math.sin(a), sy: ccy + dx * Math.sin(a) + dy * Math.cos(a) };
}

export type Pt = [number, number];
/** 그리기 순서 그대로의 가이드 그림 조각 (renderGuide 를 그리기와 계산으로 나눈 것) */
export type GuideOp =
  | { k: 'line'; a: Pt; b: Pt; c: string; w: number }
  | { k: 'chip'; text: string; x: number; y: number; tw: number; bg: string }
  | { k: 'dot'; x: number; y: number; r: number; fill: string; stroke: string }
  | { k: 'glyph'; text: string; x: number; y: number }
  | { k: 'level'; x1: number; x2: number; y: number; text: string; bx: number; by: number; tw: number; tx: number; ty: number };
export interface GuideHandle { id: GuideHandleId; x?: number; y?: number; top?: number; bot?: number }
export interface GuideScene { rot: { cx: number; cy: number; rad: number } | null; ops: GuideOp[]; handles: GuideHandle[] }
/** 글자 폭 재기 (캔버스 measureText). 시험에서는 아무 근사값이나 넣는다 */
export type Measure = (text: string, font: string) => number;

/**
 * renderGuide 의 계산 부분: 가이드 선·이름표·손잡이 자리. sw·sh 는 무대 크기(CSS px), tilt 는 화면 기울기.
 * '가이드 보이기'가 꺼져 있으면 Board 가 이 함수를 부르지 않는다 (손잡이도 없음).
 */
export function guideScene(G: GuideState, geo: Geo, sw: number, sh: number, tilt: number, measure: Measure): GuideScene {
  const ops: GuideOp[] = [], handles: GuideHandle[] = [];
  const TL = tilt || 0, ccx = geo.fx + geo.fw / 2, ccy = geo.fy + geo.fh / 2;
  const rot = TL ? { cx: ccx, cy: ccy, rad: -TL * Math.PI / 180 } : null;
  if (G.type === 'auto') { // 투시 가이드 없이 기울였을 때: 러프의 지평선과 나란히 맞출 파란 점선 하나
    if (TL) {
      const y = geo.fy + G.hy * geo.fh, ext = geo.fw;
      const text = '기울기 ' + tilt + '° · 이 선이 러프의 지평선과 나란하게';
      ops.push({ k: 'level', x1: geo.fx - ext, x2: geo.fx + geo.fw + ext, y, text, bx: geo.fx + 8, by: y - 24, tw: measure(text, CHIP_FONT), tx: geo.fx + 15, ty: y - 10 });
    }
    return { rot, ops, handles };
  }
  const { fx, fy, fw, fh } = geo; const P = (a: number, b: number): Pt => [fx + a * fw, fy + b * fh]; const hy = fy + G.hy * fh;
  const line = (a: Pt, b: Pt, c: string, w = 1) => { ops.push({ k: 'line', a, b, c, w }); };
  const ray = (from: Pt, to: Pt, c = BLUE) => { const dx = to[0] - from[0], dy = to[1] - from[1]; const L = Math.hypot(dx, dy) || 1; const k = (sw + sh) * 3 / L; line(from, [from[0] + dx * k, from[1] + dy * k], c); };
  const perim = (n: number): Pt[] => { const pts: Pt[] = []; for (let i = 0; i < n; i++) { const t = i / n * 4, e = Math.floor(t), f = t - e; pts.push(e === 0 ? [fx + f * fw, fy] : e === 1 ? [fx + fw, fy + f * fh] : e === 2 ? [fx + fw - f * fw, fy + fh] : [fx, fy + fh - f * fh]); } return pts; };
  const chip = (text: string, x: number, y: number, bg: string) => { const tw = measure(text, CHIP_FONT); ops.push({ k: 'chip', text, x: clamp(x, 6, sw - tw - 20), y: clamp(y, 4, sh - 22), tw, bg }); };
  const vps: [GuideHandleId, Pt][] = [];
  if (G.type === '1p') { const vp = P(G.v1, G.hy); for (const q of perim(28)) ray(vp, q); vps.push(['v1', vp]); }
  if (G.type === 'corridor') { // 긴 복도: 끝은 작은 틀, 문틀 줄은 끝으로 갈수록 촘촘해진다
    const vp = P(G.v1, G.hy), d = G.depth;
    const corners: Pt[] = [[fx, fy], [fx + fw, fy], [fx + fw, fy + fh], [fx, fy + fh]];
    const at = (s2: number): Pt[] => corners.map((c) => [vp[0] + (c[0] - vp[0]) * s2, vp[1] + (c[1] - vp[1]) * s2] as Pt);
    const far = at(d); const toward = (pt: Pt): Pt => [vp[0] + (pt[0] - vp[0]) * d, vp[1] + (pt[1] - vp[1]) * d];
    for (const t of [0.25, 0.5, 0.75]) { const a: Pt = [fx + t * fw, fy], b: Pt = [fx + t * fw, fy + fh]; line(a, toward(a), BLUE); line(b, toward(b), BLUE); }
    for (const t of [1 / 3, 2 / 3]) { const a: Pt = [fx, fy + t * fh], b: Pt = [fx + fw, fy + t * fh]; line(a, toward(a), BLUE); line(b, toward(b), BLUE); }
    corners.forEach((c, i) => line(c, far[i], BLUE_STRONG, 1.6));
    const Z = 1 / d, N = 7;
    for (let i = 1; i < N; i++) { const r = at(1 / (1 + i * (Z - 1) / N)); for (let k = 0; k < 4; k++) line(r[k], r[(k + 1) % 4], FRAME); }
    for (let i = 0; i < 4; i++) line(far[i], far[(i + 1) % 4], BLUE_STRONG, 1.6);
    vps.push(['v1', vp]);
  }
  if (G.type === '2p' || G.type === '3pu' || G.type === '3pd') {
    const a = P(G.v1, G.hy), b = P(G.v2, G.hy);
    for (const q of perim(18)) { ray(a, q); ray(b, q); }
    vps.push(['v1', a], ['v2', b]);
    if (G.type !== '2p') { const v3 = P(0.5, G.v3); for (let i = 0; i <= 16; i++) ray(v3, [fx - fw * 0.15 + (i / 16) * fw * 1.3, hy]); vps.push(['v3', v3]); }
    else { // 모서리: 세로선 하나와, 그 두 끝에서 소실점으로 가는 선 두 쌍
      const cx = fx + G.cx * fw, top = fy + G.ct * fh, bot = fy + G.cb * fh;
      for (const y of [top, bot]) { line([cx, y], a, BLUE_STRONG, 1.6); line([cx, y], b, BLUE_STRONG, 1.6); }
      line([cx, top], [cx, bot], CORNER, 3);
      for (const [id, y] of [['ct', top], ['cb', bot]] as [GuideHandleId, number][]) {
        const yy = clamp(y, 10, sh - 10); ops.push({ k: 'dot', x: cx, y: yy, r: 7, fill: '#fff', stroke: CORNER });
        handles.push({ id, x: cx, y: yy });
      }
      chip('모서리 ' + Math.round(G.cx * 100) + '%', cx + 12, Math.max(top, fy) + 6, CORNER);
      handles.push({ id: 'cx', x: cx, top, bot });
    }
  }
  line([0, hy], [sw, hy], HORIZON, 2);
  chip('지평선 ' + Math.round((1 - G.hy) * 100) + '%', 8, hy - 24, HORIZON);
  for (const [id, v] of vps) { // 종이 밖 소실점은 가장자리에 작은 점과 화살표로
    const hx = clamp(v[0], 10, sw - 10), hyy = clamp(v[1], 10, sh - 10); const off = hx !== v[0] || hyy !== v[1];
    ops.push({ k: 'dot', x: hx, y: hyy, r: off ? 6 : 8, fill: off ? HANDLE : '#fff', stroke: HANDLE });
    if (off && hx !== v[0]) ops.push({ k: 'glyph', text: hx < sw / 2 ? '◀' : '▶', x: hx < sw / 2 ? hx + 9 : hx - 20, y: hyy + 4 });
    handles.push({ id, x: hx, y: hyy });
  }
  handles.push({ id: 'hz', y: hy });
  return { rot, ops, handles };
}

/** guideHit: 누른 자리(기울기를 되돌린 자리)에 있는 손잡이. 모서리 점 → 소실점 → 모서리 선 → 지평선 순 */
export function guideHit(handles: GuideHandle[], sp: StagePoint): GuideHandleId | null {
  const near = (h: GuideHandle) => Math.hypot(sp.sx - (h.x as number), sp.sy - (h.y as number)) < 14;
  for (const h of handles) if ((h.id === 'ct' || h.id === 'cb') && near(h)) return h.id;
  for (const h of handles) if ((h.id === 'v1' || h.id === 'v2' || h.id === 'v3') && near(h)) return h.id;
  const c = handles.find((h) => h.id === 'cx');
  if (c && Math.abs(sp.sx - (c.x as number)) < 9 && sp.sy > Math.min(c.top as number, c.bot as number) - 4 && sp.sy < Math.max(c.top as number, c.bot as number) + 4) return 'cx';
  const hz = handles.find((h) => h.id === 'hz'); if (hz && Math.abs(sp.sy - (hz.y as number)) < 9) return 'hz';
  return null;
}
