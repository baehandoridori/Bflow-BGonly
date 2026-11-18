// GPT 에게 보낼 그림 만들기 (HTML v0.4.11 의 makeItem · prepareInputs · buildInputs · libItem · currentList · scaled 를 그대로).
// 그림판은 BoardLike 로만 부른다. 만든 그림의 순서 · 크기 · 형식은 HTML 과 같아야 한다 (C:\BAE_stage0\order_port\compare_inputs.mjs 가 견준다).
import { currentPickIds, drawSizes, finalList, hashStr, levelMap } from '@/shared/bae/order';
import type { BaeOrder, DrawSizes, GuideState, LibEntry, OrderInputs, RatioId, StyleMode, TierId } from '@/shared/bae/order';
import { BAE_BASE_SEND_SIDE, BAE_PLACE_LABEL, baePlaceItemNotes, baePlaceKey, baePlaceMode, baePlaceOrderBases } from '@/shared/bae/place';
import type { BaePlaceBase } from '@/shared/bae/place';
import { composeSheet, loadBaseImages } from './place';
import type { BaeBaseImages } from './place';

/** 그림판이 내주는 것 (HTML Board 의 같은 이름 함수와 같은 값). */
export interface BoardLike {
  /** 배경 + 칠 (메모 없음), 그림판 크기(긴 변 1536). */
  exportClean(): HTMLCanvasElement;
  /** exportClean + 빨간 메모. HTML 은 늘 캔버스를 준다. */
  exportAnnotated(): HTMLCanvasElement | null;
  hasColor(): boolean;
  /** 메모 목록 글. map = 러프의 점(0..1) → PD 가 보는 그림의 점 (기울기면 levelMap). HTML 은 문자열을 돌려준다. */
  notesSummary(map?: ((u: number, v: number) => [number, number]) | null): string;
  isGuide(): boolean;
  tilt(): number;
  guide(): GuideState;
  ratio(): RatioId;
  mode(): 'rough' | 'guide';
  hasBg(): boolean;
  hasContent(): boolean;
  noteCount(): number;
  rev(): number;
  /** 러프가 색으로 칠해진 몫 (HTML Board.paintShare). 기준 배경(3단계)의 '칠한 러프'에만 쓴다. 없으면 0. */
  paintShare?(): number;
}

export type BaeItemKind = 'rough' | 'guide' | 'ref' | 'style' | 'example' | 'sheet' | 'basebg';
export interface BaeInputItem {
  kind: BaeItemKind;
  label: string;
  note?: string;
  canvas: HTMLCanvasElement;
  /** 그림 모델에게 가는 PNG. */
  blob: Blob;
  url: string;
  /** PD 에게 가는 JPEG (긴 변 1024, 품질 0.86) 데이터 주소. */
  small: string;
  id?: string;
  src?: string;
  /** 예시 썸네일 (긴 변 384, JPEG 0.8): PD 에게 detail low 로. */
  thumb?: string;
}
export interface BaeRoughItem extends BaeInputItem {
  key: string;
  tilt: number;
  orig: string | null;
  noteCount: number;
  annotated: string | null;
  notesText: string;
  hasColor: boolean;
  painted: boolean;
}
export interface BaePlaceItems { mode: 'sheet' | 'base'; items: BaeInputItem[]; n: number; painted?: boolean; bases?: Array<{ note: string; parts: Array<{ name?: string }> }> }
export interface BaeInputs { rough: BaeRoughItem; refs: BaeInputItem[]; base: BaeInputItem; refIds: Array<number | string>; place: BaePlaceItems | null }

export interface BaeRefSource { id: number | string; img: HTMLImageElement | HTMLCanvasElement | ImageBitmap; note: string }

/** HTML 전역 대신 받는 재료. */
export interface InputsSources {
  board: BoardLike;
  /** state.ratio (그림판 비율과 같다). */
  ratio: RatioId;
  /** 크기 단계 (settings.tier). */
  tier: TierId;
  refs: BaeRefSource[];
  /** 그림체 기준 띠 주소 (설정의 것, 없으면 assets/library/strip.jpg). */
  styleSrc: string;
  /** 띠가 바뀌었는지 보는 열쇠 (HTML: 'default' 또는 'u' + 글 길이). */
  styleKey: string;
  /** 불러온 배경이 사진 같다고 본 것 (HTML state.photoLike, isPhotoLike). */
  photoLike: boolean;
  /** 기준 배경(3단계): 없으면 null. */
  place?: (() => Promise<BaePlaceItems | null>) | null;
  placeKey?: string;
  /**
   * 기준 배경들 (HTML state.bases, 최대 3장). 하나라도 있으면 Image 2 부터 '같은 장소' 그림(부품 시트 한 장 또는 기준 배경 통째로)이 들어가고
   * place · placeKey 대신 이것으로 만든다 (HTML placeItems · placeKey). 없거나 빈 목록이면 2단계와 글자까지 같은 요청.
   */
  bases?: readonly BaePlaceBase[];
}

/* ---------- 캔버스 도우미 (HTML 그대로) ---------- */
export function makeCanvas(w: number, h: number): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function dims(src: any): [number, number] { return [src.naturalWidth || src.width, src.naturalHeight || src.height]; }
export function fit(w: number, h: number, max: number): [number, number] { const s = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]; }
/** 긴 변 max 로 줄인 그림 (흰 바탕, 부드럽게 'high'). 키우지는 않는다. */
export function scaled(src: CanvasImageSource, max: number): HTMLCanvasElement {
  const [w0, h0] = dims(src); const [w, h] = fit(w0, h0, max);
  const c = makeCanvas(w, h); const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
  return c;
}
export const toBlob = (c: HTMLCanvasElement, type = 'image/png', q?: number) => new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('그림을 만들지 못했어요'))), type, q));
export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('이미지를 열 수 없어요')); im.src = src; });
}
/** HTML levelCanvas: 기울인 러프를 수평으로 돌려 더 큰 종이 가운데에 (흰 모서리). */
export function levelCanvas(src: CanvasImageSource, tilt: number, z: DrawSizes): HTMLCanvasElement {
  const k = 1536 / Math.max(z.gen[0], z.gen[1]); const c = makeCanvas(Math.round(z.gen[0] * k), Math.round(z.gen[1] * k)); const x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.translate(c.width / 2, c.height / 2); x.rotate(tilt * Math.PI / 180); x.drawImage(src, -z.out[0] * k / 2, -z.out[1] * k / 2, z.out[0] * k, z.out[1] * k);
  return c;
}
/** HTML isPhotoLike: 선 러프로 넣은 사진 · AI 그림이면 '흐리게' 모드를 권한다. */
export function isPhotoLike(img: CanvasImageSource): boolean {
  try {
    const w = 96, h = 54; const c = makeCanvas(w, h); const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data; let white = 0; const colors = new Set<number>();
    for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (r > 225 && g > 225 && b > 225) white++; colors.add((r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)); }
    return white / (w * h) < 0.35 && colors.size > 180;
  } catch (e) { return false; }
}

/** HTML makeItem: 그림 모델용 PNG + PD 용 작은 JPEG. */
export async function makeItem(kind: BaeItemKind, label: string, canvas: HTMLCanvasElement, note?: string): Promise<BaeInputItem> {
  const blob = await toBlob(canvas, 'image/png');
  return { kind, label, note, canvas, blob, url: URL.createObjectURL(blob), small: scaled(canvas, 1024).toDataURL('image/jpeg', 0.86) };
}

/* ---------- 준비한 그림 기억 (HTML itemCache · libCache · state.inputs) ---------- */
export interface InputsCache {
  refs: Record<string, BaeInputItem>;
  base: BaeInputItem | null;
  baseKey: string;
  inputs: BaeInputs | null;
  inputsKey: string;
  job: Promise<BaeInputs> | null;
  jobKey: string;
  lib: Record<string, BaeInputItem>;
  /** HTML itemCache.place · itemCache.placeKey · placeJob · placeJobKey (기준 배경, 3단계). */
  place?: BaeInputItem[] | null;
  placeKey?: string;
  placeJob?: Promise<BaeInputItem[]> | null;
  placeJobKey?: string;
  /** 기준 배경 그림 (주소 → 연 그림). */
  baseImgs?: BaeBaseImages;
}
export const createInputsCache = (): InputsCache => ({ refs: {}, base: null, baseKey: '', inputs: null, inputsKey: '', job: null, jobKey: '', lib: {}, place: null, placeKey: '', placeJob: null, placeJobKey: '', baseImgs: new Map() });

/** 기준 배경이 하나라도 있는지 (없으면 2단계 그대로). */
const hasBases = (s: InputsSources): s is InputsSources & { bases: readonly BaePlaceBase[] } => !!s.bases && s.bases.length > 0;

/** HTML prepareInputs 의 열쇠: 그림판 판 · 비율 · 레퍼런스 · 그림체 띠 · 기준 배경 · 기울기/크기. */
export function inputsKey(s: InputsSources): string {
  const b = s.board;
  return [b.rev(), b.ratio(), s.refs.map((r) => r.id).join(','), s.styleKey === 'default' ? 0 : s.styleKey.replace(/^u/, ''), hasBases(s) ? baePlaceKey(s.bases) : (s.placeKey || ''), b.tilt() ? b.tilt() + '/' + s.tier : ''].join('|');
}

/* ---------- 같은 장소 (HTML buildPlace · placeItems, 3단계) ---------- */
/** HTML buildPlace(mode): 부품 시트 한 장, 또는 기준 배경마다 긴 변 1536 그림. 부품 시트가 종이에 들어가지 않으면 빈 목록. */
export async function buildPlace(mode: 'sheet' | 'base', bases: readonly BaePlaceBase[], cache: InputsCache): Promise<BaeInputItem[]> {
  const imgs = await loadBaseImages(bases, cache.baseImgs || (cache.baseImgs = new Map()));
  if (mode === 'sheet') { const sc = composeSheet(bases, (b) => imgs.get(b.src) as HTMLImageElement); return sc ? [await makeItem('sheet', BAE_PLACE_LABEL.sheet, sc)] : []; }
  const items: BaeInputItem[] = []; for (const b of bases.slice()) items.push(await makeItem('basebg', BAE_PLACE_LABEL.basebg, scaled(imgs.get(b.src) as HTMLImageElement, BAE_BASE_SEND_SIDE), b.note)); return items;
}

/**
 * HTML placeItems(): Image 1 다음에 들어갈 것 — 부품 시트 한 장, 또는 기준 배경 통째로. 같은 열쇠(baePlaceKey)면 만든 그림을 다시 쓰고
 * 메모만 지금 것으로 바꾼다. 같은 열쇠로 만드는 중이면 그것을 기다린다. 부를 때마다 제 열쇠의 그림만 받는다 (둘이 섞이지 않는다).
 * 기준 배경이 없거나 그림이 없으면 null. bases 는 부품 시트 문장(sheetLine)에 쓰는 메모 · 부품 이름.
 */
export async function placeItems(bases: readonly BaePlaceBase[], cache: InputsCache): Promise<BaePlaceItems | null> {
  const mode = baePlaceMode(bases); if (!mode) return null; const key = baePlaceKey(bases);
  let items: BaeInputItem[];
  if (cache.place && cache.placeKey === key) items = cache.place;
  else {
    if (!cache.placeJob || cache.placeJobKey !== key) {
      const job: Promise<BaeInputItem[]> = buildPlace(mode, bases, cache).then((built) => {
        if (cache.placeJobKey === key) { const old = cache.place || []; setTimeout(() => old.forEach((it) => URL.revokeObjectURL(it.url)), 15000); cache.place = built; cache.placeKey = key; }
        else setTimeout(() => built.forEach((it) => URL.revokeObjectURL(it.url)), 15000);   // 그사이 기준 배경이 바뀌었다: 기억해 두지 않는다
        return built;
      }).finally(() => { if (cache.placeJob === job) cache.placeJob = null; });
      cache.placeJob = job; cache.placeJobKey = key;
    }
    items = await (cache.placeJob as Promise<BaeInputItem[]>);
  }
  const notes = baePlaceItemNotes(mode, bases);
  if (mode === 'base') items.forEach((it, i) => { it.note = notes[i] !== undefined ? notes[i] : ''; });
  if (mode === 'sheet' && items[0]) items[0].note = notes[0];
  return items.length ? { mode, items, n: items.length, bases: baePlaceOrderBases(bases) } : null;
}

/** HTML prepareInputs: 같은 재료면 만든 것을 다시 쓰고(메모 글만 새로), 만드는 중이면 그것을 기다린다. 러프가 비었으면 null. */
export async function prepareInputs(s: InputsSources, cache: InputsCache): Promise<BaeInputs | null> {
  if (!s.board.hasContent()) return null;
  const key = inputsKey(s);
  if (cache.inputs && cache.inputsKey === key) {
    cache.inputs.refs.forEach((it, i) => { if (s.refs[i]) it.note = s.refs[i].note; });
    if (cache.inputs.place && hasBases(s)) { const pl = await placeItems(s.bases, cache); if (pl) { cache.inputs.place.items = pl.items; cache.inputs.place.bases = pl.bases; } }
    else if (cache.inputs.place && s.place) { const pl = await s.place(); if (pl) cache.inputs.place.items = pl.items; }
    return cache.inputs;
  }
  if (cache.job && cache.jobKey === key) return cache.job;
  cache.jobKey = key; const job = buildInputs(s, cache, key).finally(() => { if (cache.jobKey === key) cache.job = null; });
  cache.job = job; return job;
}

/** HTML buildInputs. */
export async function buildInputs(s: InputsSources, cache: InputsCache, key: string): Promise<BaeInputs> {
  const B = s.board; const refsNow = s.refs.slice(); const guide = B.isGuide();
  const z = drawSizes(s.ratio, s.tier, B.tilt()), tilt = z.tilt, clean = B.exportClean();
  const rough = await makeItem(guide ? 'guide' : 'rough', (guide ? '구도 가이드 (흐리게)' : '러프') + (tilt ? ' · 수평으로 돌림' : ''), tilt ? levelCanvas(clean, tilt, z) : clean) as BaeRoughItem;
  const n = B.noteCount();
  rough.key = hashStr(rough.small); rough.tilt = tilt; rough.orig = tilt ? scaled(clean, 1024).toDataURL('image/jpeg', 0.86) : null;
  rough.noteCount = n;
  const ann = n ? B.exportAnnotated() : null;
  rough.annotated = ann ? scaled(tilt ? levelCanvas(ann, tilt, z) : ann, 1024).toDataURL('image/jpeg', 0.86) : null;
  rough.notesText = n ? B.notesSummary(tilt ? levelMap(tilt, z) : null) : ''; rough.hasColor = B.hasColor();
  rough.painted = !guide && !s.photoLike && (B.paintShare ? B.paintShare() : 0) > 0.25;
  const refs: BaeInputItem[] = [];
  for (const r of refsNow) { let it = cache.refs[String(r.id)]; if (!it) { it = await makeItem('ref', '레퍼런스', scaled(r.img, 1536), r.note); cache.refs[String(r.id)] = it; } it.note = r.note; refs.push(it); }
  if (!cache.base || cache.baseKey !== s.styleKey) { cache.base = await makeItem('style', '그림체 기준 (원경)', scaled(await loadImg(s.styleSrc), 1536)); cache.baseKey = s.styleKey; }
  if (cache.inputs && cache.inputs.rough && cache.inputs.rough.url) { const old = cache.inputs.rough.url; setTimeout(() => URL.revokeObjectURL(old), 15000); }
  const pl = hasBases(s) ? await placeItems(s.bases, cache) : s.place ? await s.place() : null; const place = pl ? Object.assign(pl, { painted: rough.painted }) : null;
  cache.inputs = { rough, refs, base: cache.base, refIds: refsNow.map((r) => r.id), place }; cache.inputsKey = key;
  return cache.inputs;
}

/** HTML libItem: 팀 예시 한 장 (그림 모델용 긴 변 1024 PNG + PD 용 썸네일). e.src = 그림 주소. */
export async function libItem(e: LibEntry & { src: string }, cache: InputsCache): Promise<BaeInputItem> {
  const c = cache.lib[e.id]; if (c && c.src === e.src) return c;
  const canvas = scaled(await loadImg(e.src), 1024);
  const it = await makeItem('example', '레퍼런스 이미지 예시 ' + e.id, canvas, e.name);
  it.id = e.id; it.src = e.src; it.thumb = scaled(canvas, 384).toDataURL('image/jpeg', 0.8);
  cache.lib[e.id] = it; return it;
}

/** HTML currentList: 그림 모델에게 보낼 그림 (finalList 순서). 고른 예시를 아직 모르면 null. */
export async function currentList(s: InputsSources, cache: InputsCache, pick: { styleMode: StyleMode; manualPicks: string[]; order: Pick<BaeOrder, 'picks'> | null; library: Array<LibEntry & { src: string }> }): Promise<BaeInputItem[] | null> {
  // HTML currentPickIds 는 기준 배경이 있으면(placeMode) 예시를 넣지 않는다 — 부품 시트가 종이에 들어가지 않아 place 가 null 이어도.
  const inp = await prepareInputs(s, cache); const ids = currentPickIds(hasBases(s) ? baePlaceMode(s.bases) : inp && inp.place ? inp.place.mode : '', pick.styleMode, pick.manualPicks, pick.order, pick.library);
  if (!inp || ids === null) return null;
  const picks: BaeInputItem[] = []; for (const id of ids) picks.push(await libItem(pick.library.find((e) => e.id === id)!, cache));
  return finalList<BaeInputItem>(inp, picks);
}

/** PD 요청에 넣을 썸네일: 보여 줄 예시마다 libItem(e).thumb. */
export async function libThumbs(entries: Array<LibEntry & { src: string }>, cache: InputsCache): Promise<Record<string, string>> {
  const out: Record<string, string> = {}; for (const e of entries) out[e.id] = (await libItem(e, cache)).thumb as string; return out;
}

/** 메인에 넘길 글자 · 데이터 주소만 (buildPdRequest 의 inputs). */
export function orderInputsOf(inp: BaeInputs): OrderInputs {
  const r = inp.rough;
  return {
    rough: { kind: r.kind as 'rough' | 'guide', small: r.small, annotated: r.annotated, notesText: r.notesText, hasColor: r.hasColor, tilt: r.tilt, noteCount: r.noteCount, key: r.key, painted: r.painted },
    refs: inp.refs.map((it) => ({ small: it.small, note: it.note })), base: { small: inp.base.small }, refIds: inp.refIds.slice(),
    place: inp.place ? { mode: inp.place.mode, n: inp.place.n, painted: inp.place.painted, items: inp.place.items.map((it) => ({ small: it.small, note: it.note })), bases: inp.place.bases } : null,
  };
}

/** 그림 요청에 실을 PNG 바이트 (finalList 순서 그대로, 'image' + (i + 1) + '.png'). */
export async function listPngBytes(list: BaeInputItem[]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []; for (const it of list) out.push(new Uint8Array(await it.blob.arrayBuffer())); return out;
}
