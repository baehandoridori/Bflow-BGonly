/**
 * BAE경 '이 PC 점검' (HTML pcCheck() 4936줄을 Bflow 로, 계획 14 9-4).
 * 메인이 사실을 모으고(electron/bae/model/pcCheck.ts), 여기서 줄 · 한 줄 정리를 만든다. 화면과 서버 표가 같은 모양을 쓴다.
 * 서버에는 이 결과 한 벌이 사람 · PC 마다 한 줄로 올라가고 관리자가 표로 본다 (bae_gyeong_session_pc_check_*).
 */
import { BAE_MODELS, type BaeModelId, type BaeModelState } from './models';

export type BaePcLevel = 'ok' | 'warn' | 'bad';
export interface BaePcRow { level: BaePcLevel; name: string; text: string }

/** 화면(렌더러)의 WebGPU — 4K '원본 그대로'가 쓴다. 화면이 재서 넣는다 (없으면 null). */
export interface BaeWebGpuInfo { ok: boolean; f16?: boolean; name?: string; why?: string }

export interface BaePcFacts {
  appVersion: string;
  pcName: string;
  gpu: { name: string | null; vendor: string | null; driver: string | null; vramMB: number | null; software: boolean };
  dml: { ok: boolean; ms: number; error?: string };
  cpu: { ok: boolean; ms: number; error?: string };
  webgpu: BaeWebGpuInfo | null;
  models: BaeModelState[];
  warehouse: boolean;
  /** Hugging Face 에 닿나 (모르면 null) */
  internet: boolean | null;
  freeBytes: number | null;
  openai: { ok: boolean; status?: number };
}

export interface BaePcCheck extends BaePcFacts {
  version: 1;
  checkedAt: string;
  can: { upscale: boolean; layers: boolean; angle: boolean; edge: boolean };
  level: BaePcLevel;
  summary: string;
  rows: BaePcRow[];
}

/** BiRefNet(full fp16)이 DirectML 에서 그래픽카드 메모리를 약 10GB 쓴다 (진행 기록 0-6). */
export const BAE_BIREFNET_VRAM_MB = 10 * 1024;

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);
const mb = (bytes: number) => Math.round(bytes / 1e6);

export function buildBaePcCheck(f: BaePcFacts, checkedAt: Date = new Date()): BaePcCheck {
  const state = (id: BaeModelId) => f.models.find((m) => m.id === id) ?? null;
  const ready = (id: BaeModelId) => !!state(id)?.ready;
  // 받을 수 있나: 이 PC 에 있음 · 창고에 닿음 · (주소가 모두 있는 모델만) 인터넷에 닿음
  const obtainable = (id: BaeModelId) => ready(id) || f.warehouse || (!!state(id)?.internet && f.internet === true);
  const engine = f.cpu.ok || f.dml.ok;
  const fast = f.dml.ok;
  const can = {
    upscale: engine && (obtainable('up-a') || obtainable('up-b')),
    layers: engine && obtainable('sam'),
    angle: engine && obtainable('depth'),
    edge: engine && obtainable('birefnet'),
  };
  const rows: BaePcRow[] = [];
  const add = (level: BaePcLevel, name: string, text: string) => rows.push({ level, name, text });

  const gpuName = [f.gpu.vendor && !(f.gpu.name ?? '').toLowerCase().includes(f.gpu.vendor.toLowerCase()) ? f.gpu.vendor : null, f.gpu.name].filter(Boolean).join(' ');
  add(fast ? 'ok' : 'warn', '그래픽카드', fast
    ? (gpuName || '쓸 수 있어요') + (f.gpu.vramMB ? ` · 메모리 약 ${Math.round(f.gpu.vramMB / 1024)}GB` : '')
    : `쓸 수 없어요${f.dml.error ? ` (${f.dml.error.slice(0, 80)})` : ''}. 레이어 · 4K · 각도 계산이 CPU로 돌아서 몇 배 느려요`);
  if (fast && f.gpu.vramMB !== null && f.gpu.vramMB < BAE_BIREFNET_VRAM_MB) {
    add('warn', '그래픽카드 메모리', `약 ${Math.round(f.gpu.vramMB / 1024)}GB라 가장자리 모델(약 10GB)은 CPU로 이어 가거나 윤곽 모델만으로 나눠요 (느리거나 조금 거칠어요)`);
  }
  if (!engine) add('bad', '계산 엔진', `모델 계산 엔진이 돌지 않아요${f.cpu.error ? ` (${f.cpu.error.slice(0, 80)})` : ''}. 앱을 다시 설치해 주세요`);
  if (f.webgpu) {
    add(f.webgpu.ok ? 'ok' : 'warn', '화면 그래픽 (WebGPU)', f.webgpu.ok
      ? (f.webgpu.name ? f.webgpu.name + ' · ' : '') + '4K 원본 그대로를 그래픽카드로 해요'
      : '쓸 수 없어요. 4K 원본 그대로가 CPU로 돌아서 2분 넘게 걸려요');
  }
  const missing = f.models.reduce((n, m) => n + (m.ready ? 0 : Math.max(0, m.totalBytes - m.haveBytes)), 0);
  if (f.freeBytes !== null) {
    const enough = f.freeBytes > missing + 1e9;
    add(enough ? 'ok' : 'warn', '저장 공간', `모델 폴더 드라이브에 약 ${gb(f.freeBytes)}GB 남음` + (enough ? '' : ` · 모델(남은 약 ${mb(missing)}MB)을 받아 두기에 모자랄 수 있어요`));
  }
  add(f.warehouse ? 'ok' : 'warn', '모델 창고 (G 드라이브)', f.warehouse ? '연결돼요' : '찾지 못했어요. G 드라이브가 연결돼 있는지 확인해 주세요 (윤곽 · 4K 모델은 창고에서만 받아요)');
  for (const id of ['sam', 'birefnet', 'depth', 'up-a', 'up-b'] as BaeModelId[]) {
    const s = state(id); if (!s) continue;
    const label = BAE_MODELS[id].label;
    if (s.ready) add('ok', label, '이 PC에 받아 뒀어요');
    else if (obtainable(id)) add('ok', label, `처음 쓸 때 약 ${mb(s.totalBytes - s.haveBytes)}MB를 받아요`);
    else add('bad', label, `받을 곳이 없어요. ${BAE_MODELS[id].use}이(가) 안 돼요`);
  }
  if (f.internet !== null) add(f.internet ? 'ok' : 'warn', '인터넷 모델 (huggingface.co)', f.internet ? '연결돼요 (창고가 안 될 때 받는 곳)' : '연결이 안 돼요. 창고에서만 받아요');
  add(f.openai.ok ? 'ok' : 'bad', 'OpenAI 연결', f.openai.ok ? '연결돼요' : '연결이 안 돼요. 주문서와 그림을 만들 수 없어요 (회사 네트워크나 보안 프로그램이 막는지 확인)');

  const say = (b: boolean) => (b ? '돼요' : '안 돼요');
  const summary = `4K로 키우기 ${say(can.upscale)} · 레이어로 나누기 ${say(can.layers)} · 다른 각도로 ${say(can.angle)}` + (engine && !fast ? ' (그래픽카드가 없어서 느려요)' : '');
  const level: BaePcLevel = !engine || !f.openai.ok ? 'bad' : (can.upscale && can.layers && can.angle && rows.every((r) => r.level !== 'bad')) ? (fast ? 'ok' : 'warn') : 'warn';
  rows.unshift({ level, name: '정리', text: summary });
  return { ...f, version: 1, checkedAt: checkedAt.toISOString(), can, level, summary, rows };
}

/** 서버 표 한 줄 (관리자 화면). result 는 위 BaePcCheck. */
export interface BaePcCheckRow {
  userId: string;
  userName: string;
  pcId: string;
  pcName: string;
  appVersion: string;
  level: BaePcLevel;
  summary: string;
  result: BaePcCheck | null;
  checkedAt: string;
}

const LEVELS = new Set(['ok', 'warn', 'bad']);
export function parseBaePcCheckRows(data: unknown): BaePcCheckRow[] {
  if (!Array.isArray(data) || data.length > 1000) throw new Error('이 PC 점검 표 응답이 올바르지 않아요.');
  return data.map((item) => {
    const r = item as Record<string, unknown> | null;
    if (!r || typeof r.userId !== 'string' || typeof r.pcId !== 'string' || typeof r.level !== 'string' || !LEVELS.has(r.level) || typeof r.checkedAt !== 'string') throw new Error('이 PC 점검 줄이 올바르지 않아요.');
    return {
      userId: r.userId, userName: typeof r.userName === 'string' ? r.userName : '', pcId: r.pcId,
      pcName: typeof r.pcName === 'string' ? r.pcName : '', appVersion: typeof r.appVersion === 'string' ? r.appVersion : '',
      level: r.level as BaePcLevel, summary: typeof r.summary === 'string' ? r.summary : '',
      result: r.result && typeof r.result === 'object' ? (r.result as BaePcCheck) : null, checkedAt: r.checkedAt,
    };
  });
}

/** 서버로 보내는 모양 (서버가 사람을 정한다 — 여기에는 사람 id 가 없다). */
export function baePcCheckPayload(pcId: string, check: BaePcCheck): Record<string, unknown> {
  return { pcId, pcName: check.pcName.slice(0, 120), appVersion: check.appVersion.slice(0, 40), level: check.level, summary: check.summary.slice(0, 300), result: check };
}
