/**
 * BAE경 '레이어로 나누기' (5단계, 계획 14 3-2 ~ 3-4 · 14d 3-2) 의 화면 ↔ 메인 말과 GPT 요청 모양.
 *   - 레이어 엔진(v0.4.4, src/features/bae-gyeong/layers/engine)은 화면 쪽 일꾼에서 돌고, GPT 는 메인이 부른다 (키는 메인만).
 *   - 요청 몸은 HTML v0.4.4 엔진의 browserGpt(adapters/browser.js, HTML 의 lyWorkerSrc 와 같은 코드) 그대로:
 *       PD   POST /responses   { model, input:[{ role:'user', content:[글, (이름표, 그림)…] }], text:{ format:{ json_schema, strict } }, store:false }
 *       그림 POST /images/edits model · prompt · size · quality=high · n=1 · output_format=png · background=opaque · image[] · mask
 *   - GPT 답 저장(같은 그림을 다시 나누면 0원)은 메인이 이 PC 디스크에: 그림 해시(SHA-256) 폴더 안, 엔진의 열쇠 이름을 정해 둔 파일 이름으로.
 * DOM · Electron · '@/' 없이 상대 경로만 (메인 · 화면 · node 시험이 같이 쓴다).
 */
import type { BaeFailure } from './makeCalls';

export type { BaeFailure };

/** 엔진이 PD 에게 묻는 세 가지 (gptjobs.js 의 schema name). */
export const BAE_LAYERS_PD_NAMES = ['inventory', 'depth', 'describe'] as const;
export type BaeLayersPdName = (typeof BAE_LAYERS_PD_NAMES)[number];

export interface BaeLayersPdImage { label: string; url: string; detail?: 'high' | 'low' | 'auto' }

/** 작업 한 건 (창에서 그림 하나를 나누는 동안). 서버 기록 줄은 돈이 처음 나갈 때나 다 나눴을 때 생긴다. */
export interface BaeLayersBeginCall {
  jobId: string;
  createdAt: string;
  /** 결과 화면에서 연 그림이면 그 작업 id, 불러온 파일이면 null */
  parentJobId: string | null;
  /** 그림 이름 (불러온 파일 이름 · 원래 작업 이름). 기록 · 미리보기에만 쓰고 경로에는 넣지 않는다 */
  label: string;
  /** 나눌 그림 원본 (PNG · JPEG 바이트) — 이 PC 작업 폴더의 source.png (JPEG 면 source.jpg) 가 된다 */
  source: Uint8Array;
  /** 그림 크기 (기록용) */
  w: number; h: number;
}
export interface BaeLayersPdCall { jobId: string; name: BaeLayersPdName; prompt: string; images: BaeLayersPdImage[]; schema: unknown }
export interface BaeLayersEditCall { jobId: string; prompt: string; image: Uint8Array; mask: Uint8Array | null; size: string }
export interface BaeLayersDoneCall {
  jobId: string;
  /** writePsd(…, { noBackground: true }) 결과 */
  psd: Uint8Array;
  /** 나눈 결과 요약 (기록에 남길 숫자) */
  summary: BaeLayersSummaryLite;
}
/** 나눈 결과에서 기록에 남기는 것 (엔진 assemblePlan 의 summary 중 숫자만). */
export interface BaeLayersSummaryLite {
  W: number; H: number;
  layers: number; shadows: number;
  bins: { OL: number; ML: number; UL: number };
  left: number; merged: number;
  /** 다 켠 그림과 원래 그림의 평균 차이 */
  stackDiff: number;
  /** 이 나누기에 걸린 초 (조립만 다시면 몇 초) */
  sec: number;
  /** GPT 없이 조립만 다시 했는지 */
  again: boolean;
  /** 물건 수 */
  props: number;
}

export interface BaeLayersPdOutcome { ok: true; json: unknown; usd: number }
export interface BaeLayersEditOutcome { ok: true; png: Uint8Array; usd: number }
export interface BaeLayersDoneOutcome { ok: true; jobId: string; psdPath: string; costUsd: number; sec: number }

/** preload 가 `window.baeLayersAPI` 로 여는 통로 (모든 요청은 지금 로그인 세션의 epoch 를 붙여 메인으로 간다). */
export interface BaeLayersGateway {
  begin(call: BaeLayersBeginCall): Promise<{ ok: true; jobId: string } | BaeFailure>;
  pd(call: BaeLayersPdCall): Promise<BaeLayersPdOutcome | BaeFailure>;
  edit(call: BaeLayersEditCall): Promise<BaeLayersEditOutcome | BaeFailure>;
  done(call: BaeLayersDoneCall): Promise<BaeLayersDoneOutcome | BaeFailure>;
  /** 나누다 실패 · 그만둠, 또는 계획만 고치고 창을 닫음 (돈이 나간 작업만 기록 줄이 바뀐다) */
  end(jobId: string, how: 'failed' | 'stopped' | 'closed', message: string): Promise<boolean>;
  /** 진행 중인 GPT 요청 그만두기 */
  abort(jobId: string): Promise<boolean>;
  /** GPT 답 · 계획 저장 (그림 해시 = SHA-256 16진수 64자, key = 엔진의 열쇠 이름) */
  storeGet(pic: string, key: string): Promise<unknown>;
  storeSet(pic: string, key: string, value: unknown): Promise<boolean>;
  /** '저장해 둔 단계 지우기': 그 그림의 GPT 답 · 계획을 다음부터 쓰지 않는다 (파일은 지우지 않고 새 칸으로) */
  storeForget(pic: string): Promise<boolean>;
  /** 나눈 PSD 가 있는 폴더 열기 */
  showPsd(jobId: string): Promise<boolean>;
}

/* ---------------------------------------------------------------- 요청 몸 (HTML browserGpt 그대로) */

/** PD 요청 몸 (adapters/browser.js browserGpt.pd 와 키 순서까지 같게). */
export function baeLayersPdBody(o: { model: string; prompt: string; images: BaeLayersPdImage[]; schema: unknown; name: string }) {
  const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: o.prompt }];
  for (const im of o.images || []) { content.push({ type: 'input_text', text: im.label }); content.push({ type: 'input_image', image_url: im.url, detail: im.detail || 'high' }); }
  return { model: o.model, input: [{ role: 'user', content }], text: { format: { type: 'json_schema', name: o.name, strict: true, schema: o.schema } }, store: false };
}

/** 그림 요청 필드 (browserGpt.edit 의 FormData 순서): 글자 칸 일곱 · 그림 · (마스크). 그림 칸 이름은 openaiClient 가 image[] / image 로 바꾼다. */
export type BaeLayersFormField = { name: string; value: string } | { name: string; file: { bytes: Uint8Array; filename: string; type: string } };
export function baeLayersEditFields(o: { model: string; prompt: string; size: string; image: Uint8Array; mask: Uint8Array | null }): BaeLayersFormField[] {
  const f: BaeLayersFormField[] = [
    { name: 'model', value: o.model }, { name: 'prompt', value: o.prompt }, { name: 'size', value: o.size }, { name: 'quality', value: 'high' },
    { name: 'n', value: '1' }, { name: 'output_format', value: 'png' }, { name: 'background', value: 'opaque' },
    { name: 'image[]', file: { bytes: o.image, filename: 'image1.png', type: 'image/png' } },
  ];
  if (o.mask) f.push({ name: 'mask', file: { bytes: o.mask, filename: 'mask.png', type: 'image/png' } });
  return f;
}

/* ---------------------------------------------------------------- 받은 말 확인 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isBaeLayersJobId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export const BAE_LAYERS_PIC_RE = /^[0-9a-f]{64}$/;
export const BAE_LAYERS_MAX_PROMPT = 60_000;
export const BAE_LAYERS_MAX_SCHEMA = 20_000;
export const BAE_LAYERS_MAX_DATA_URL = 12 * 1024 * 1024;
export const BAE_LAYERS_MAX_PICTURE = 64 * 1024 * 1024;
export const BAE_LAYERS_MAX_PSD = 512 * 1024 * 1024;
/** GPT Image 가 받는 크기: 엔진 workingSize 는 긴 변 2048 안의 16 배수. */
export const BAE_LAYERS_SIZE_RE = /^(\d{2,4})x(\d{2,4})$/;

export const isPngBytes = (b: unknown): b is Uint8Array => b instanceof Uint8Array && b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const isJpegBytes = (b: unknown): b is Uint8Array => b instanceof Uint8Array && b.length > 4 && b[0] === 0xff && b[1] === 0xd8;
export const isPictureBytes = (b: unknown): b is Uint8Array => (isPngBytes(b) || isJpegBytes(b)) && (b as Uint8Array).byteLength <= BAE_LAYERS_MAX_PICTURE;

/** PD 요청이 엔진이 보내는 모양인지. 문제가 있으면 그 글, 없으면 null. */
export function baeLayersPdProblem(c: unknown): string | null {
  const q = c as Partial<BaeLayersPdCall> | null;
  if (!q || typeof q !== 'object' || !isBaeLayersJobId(q.jobId)) return 'BAE경 작업 번호가 올바르지 않아요.';
  if (!(BAE_LAYERS_PD_NAMES as readonly unknown[]).includes(q.name)) return 'PD에게 물을 수 없는 일이에요.';
  if (typeof q.prompt !== 'string' || !q.prompt || q.prompt.length > BAE_LAYERS_MAX_PROMPT) return 'PD에게 보낼 글이 올바르지 않아요.';
  if (!Array.isArray(q.images) || q.images.length > 2) return 'PD에게 보낼 그림이 올바르지 않아요.';
  for (const im of q.images) {
    if (!im || typeof im.label !== 'string' || im.label.length > 40 || typeof im.url !== 'string' || im.url.length > BAE_LAYERS_MAX_DATA_URL
      || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(im.url) || (im.detail !== undefined && !['high', 'low', 'auto'].includes(im.detail))) return 'PD에게 보낼 그림이 올바르지 않아요.';
  }
  let s = '';
  try { s = JSON.stringify(q.schema); } catch { s = ''; }
  if (!s || s.length > BAE_LAYERS_MAX_SCHEMA || !q.schema || typeof q.schema !== 'object' || (q.schema as { type?: unknown }).type !== 'object') return 'PD 답의 모양이 올바르지 않아요.';
  return null;
}
/** 그림 요청이 엔진이 보내는 모양인지. */
export function baeLayersEditProblem(c: unknown): string | null {
  const q = c as Partial<BaeLayersEditCall> | null;
  if (!q || typeof q !== 'object' || !isBaeLayersJobId(q.jobId)) return 'BAE경 작업 번호가 올바르지 않아요.';
  if (typeof q.prompt !== 'string' || !q.prompt || q.prompt.length > BAE_LAYERS_MAX_PROMPT) return '그림 요청 글이 올바르지 않아요.';
  if (!isPngBytes(q.image) || q.image.byteLength > BAE_LAYERS_MAX_PICTURE || (q.mask != null && (!isPngBytes(q.mask) || q.mask.byteLength > BAE_LAYERS_MAX_PICTURE))) return '보낼 그림이 올바르지 않아요.';
  const m = typeof q.size === 'string' ? BAE_LAYERS_SIZE_RE.exec(q.size) : null;
  if (!m || +m[1] < 16 || +m[2] < 16 || +m[1] > 2048 || +m[2] > 2048 || +m[1] % 16 || +m[2] % 16) return '그림 크기가 올바르지 않아요.';
  return null;
}

/* ---------------------------------------------------------------- GPT 답 저장 (엔진의 jobStore 열쇠 → 파일) */

/**
 * 엔진이 쓰는 열쇠 (README 'v0.4.4': p4.inventory · p4.plate(+ .ids) · p4.plate.add:<해시> · p4.depth:<해시> · p4.edit:<해시> · p4.redraw:<해시> · 계획 p4.plan).
 * 해시는 엔진 split.js 의 hashOf (FNV-1a → 36진수). 파일 이름에는 이 열쇠에서 만든 정해진 모양만 쓴다.
 */
export function baeLayersStoreFile(key: unknown): { file: string; kind: 'json' | 'png' } | null {
  if (typeof key !== 'string' || key.length > 40) return null;
  switch (key) {
    case 'p4.inventory': return { file: 'inventory.json', kind: 'json' };
    case 'p4.plate': return { file: 'plate.png', kind: 'png' };
    case 'p4.plate.ids': return { file: 'plate.ids.json', kind: 'json' };
    case 'p4.plan': return { file: 'plan.json', kind: 'json' };
  }
  const m = /^p4\.(plate\.add|depth|edit|redraw):([0-9a-z]{1,13})$/.exec(key);
  if (!m) return null;
  return m[1] === 'depth' ? { file: `depth.${m[2]}.json`, kind: 'json' } : { file: `${m[1]}.${m[2]}.png`, kind: 'png' };
}
export const BAE_LAYERS_MAX_JSON = 4 * 1024 * 1024;

/* ---------------------------------------------------------------- 기록 */

/** 기록 줄의 summary (BaeJobSummary 의 칸만 쓴다: source · size). */
export function baeLayersJobSummary(label: string, w: number, h: number): { source?: string; size?: [number, number] } {
  const l = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return { ...(l ? { source: l } : {}), ...(w > 0 && h > 0 ? { size: [w, h] as [number, number] } : {}) };
}
/** 비용 안내 (HTML lpEst): 약 n원 (10원 단위). */
export function baeLayersWon(usd: number, rate = 1400): string {
  return '약 ' + (Math.round(usd * rate / 10) * 10).toLocaleString('ko-KR') + '원';
}
