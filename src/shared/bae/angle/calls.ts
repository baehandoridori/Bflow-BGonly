/**
 * BAE경 '다른 각도로' 통로의 모양 (화면 → 메인 'bae:angle-draw', 테스트 모드도 같은 모양). DOM · Electron · '@/' 없이.
 * 화면은 입체 판에서 밑그림 · 원래 그림 · 같은 공간 그림(PNG)과 카메라 문장을 만들고, 메인은 PD메모를 읽힌 뒤 주문서를 마저 써서 그림을 부른다
 * (HTML agGo 의 순서: 메모 → 주문서 → 그림). 키는 메인만 안다.
 */
import type { AngleKind, AnglePreset } from './order';
import type { BaeJobSummary } from '../jobs';

/** 결과 기록의 '다른 각도로' (HTML rec.angle). 메모(memo)는 메인이 PD 를 부른 뒤 채운다. */
export interface BaeAngleRecord {
  fromId: string | null; fromName: string; fromKind: 'result' | 'file';
  preset: AnglePreset | null; pos: number[]; target: number[]; shift: number[] | null; kind: AngleKind; hfov: number; camH: number;
  orbit: number; pitch: number; floorH: number; dist: number;
  label: string; ko: string; sentence: string;
  /** 새로 그릴 곳 (회색 · 늘어난 곳 · 밑면 · 모두, 0..1) */
  unseen: { grey: number; smear: number; under: number; all: number } | null;
  /** 깊이를 잰 곳 ('dml' · 'cpu') */
  ep: string;
  set: { Zp: number; Zback: number; xmin: number; xmax: number; fitOk: boolean };
  /** v0.4.6~ 같은 공간 그림 (주문서의 image 3 …) */
  sources: Array<{ letter: string; kind: 'result' | 'file'; id: string | null; name: string; pos: number[]; yaw: number; size: number; eye: number | null; wall: string | null; dist: number; anchors: boolean; ep: string; sent: boolean; key: string }>;
  /** 붓 획 수 */
  notes: number;
  /** B 그림에서 각 그림이 차지한 몫 [없음, A, C, …] */
  shares: number[] | null;
  /** v0.4.9 가까이 잡은 샷: 원래 그림에서 B 가 보는 상자 */
  crop: { box: number[]; area: number } | null;
  /** v0.4.8 PD메모 */
  memo: { n: number; pd: string | null; ko: string; raw: boolean; err: string; cost: number | null } | null;
}
/** 서버 기록의 요약 칸 (기본 칸 + 다른 각도로). */
export type BaeAngleSummary = BaeJobSummary & { angle: BaeAngleRecord & { line: string; fileName: string } };

export interface BaeAngleDrawCall {
  jobId: string;
  /** 원래 그림이 BAE경 결과면 그 작업 */
  parentJobId: string | null;
  createdAt: string;
  /** 그림 모델에 보낼 PNG: [B 에서 본 입체 판 (+ 붓), 원래 그림 (가까이 잡은 샷이면 그 부분), 보낼 같은 공간 그림 …] */
  images: Uint8Array[];
  /** 그림 크기 (HTML agOutSize) */
  size: [number, number];
  /** 주문서 재료: 카메라 문장 (가까이 잡은 샷이면 tight 문장) 과 켬/끔. 메모 문장은 메인이 PD 답으로 넣는다. */
  order: { kind: AngleKind; sentence: string; n: number; notes: boolean; crop: boolean; under: boolean };
  /** PD메모: 메모 없는 · 있는 밑그림 (1024 JPEG 데이터 주소), PD 에게 줄 목록 글, PD 를 못 부르면 넣을 글 */
  memo: { clean: string; noted: string; summary: string; raw: string[]; n: number } | null;
  record: BaeAngleRecord;
  /** 결과 줄 이름 ('오른쪽 45°' …) · 요약 줄 · 파일 이름 */
  label: string; line: string; fileName: string;
  /** 기록에 남길 재료 미리보기 (1024 JPEG): 밑그림 · 메모 있는 밑그림 · 원래 그림과 같은 공간 그림 */
  previews: { rough: string; roughNotes: string | null; refs: string[] };
}
export interface BaeAngleDrawOutcome {
  ok: true; jobId: string; png: Uint8Array; w: number; h: number; sec: number;
  costUsd: number | null; imageUsd: number | null; memoUsd: number | null; model: string; prompt: string;
  memo: BaeAngleRecord['memo'];
  label: string;
}
export const BAE_ANGLE_MAX_IMAGES = 10;
const JPEG_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const isPng = (b: unknown): b is Uint8Array => b instanceof Uint8Array && b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

/** 메인이 받기 전에 보는 모양 (문제면 한국어 글, 없으면 null). */
export function baeAngleCallProblem(q: unknown): string | null {
  const c = q as BaeAngleDrawCall | null;
  if (!c || typeof c !== 'object') return '보낼 재료가 올바르지 않아요.';
  if (!Array.isArray(c.images) || c.images.length < 2 || c.images.length > BAE_ANGLE_MAX_IMAGES || !c.images.every(isPng)) return '보낼 그림을 준비하지 못했어요. 다시 해 주세요.';
  if (!Array.isArray(c.size) || c.size.length !== 2 || !c.size.every((v) => Number.isSafeInteger(v) && v >= 256 && v <= 4096 && v % 16 === 0)) return '그림 크기가 올바르지 않아요.';
  const o = c.order;
  if (!o || (o.kind !== 'interior' && o.kind !== 'exterior') || typeof o.sentence !== 'string' || !o.sentence || o.sentence.length > 4000) return '주문서 재료가 올바르지 않아요.';
  if (!Number.isSafeInteger(o.n) || o.n < 0 || o.n > 8 || o.n !== c.images.length - 2) return '같은 공간 그림 수가 맞지 않아요.';
  if (c.memo != null) {
    const m = c.memo;
    if (typeof m !== 'object' || !JPEG_URL.test(String(m.clean)) || !JPEG_URL.test(String(m.noted)) || typeof m.summary !== 'string' || m.summary.length > 20000
      || !Array.isArray(m.raw) || !m.raw.every((t) => typeof t === 'string' && t.length <= 2000) || !Number.isSafeInteger(m.n) || m.n < 1) return 'PD메모가 올바르지 않아요.';
  }
  if (!c.record || typeof c.record !== 'object' || typeof c.label !== 'string' || c.label.length > 200 || typeof c.line !== 'string' || typeof c.fileName !== 'string') return '기록 칸이 올바르지 않아요.';
  const p = c.previews;
  if (!p || !JPEG_URL.test(String(p.rough)) || (p.roughNotes != null && !JPEG_URL.test(String(p.roughNotes))) || !Array.isArray(p.refs) || !p.refs.every((r) => JPEG_URL.test(String(r)))) return '미리보기가 올바르지 않아요.';
  return null;
}
