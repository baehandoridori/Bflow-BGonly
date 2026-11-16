/**
 * 테스트 모드(?preview=1)의 모델 통로 — 앱의 window.baeModelAPI (electron/bae/model/modelIpc.ts) 를 같은 모양으로 흉내 낸다.
 * 진짜 모델 · 모델 일꾼 · 서버를 부르지 않는다:
 *   - 모델 받기: 처음 한 번은 모델 창고에서 복사하는 것처럼 진행 알림을 보내고(이 탭에서만 기억), 그다음은 바로 '준비됨'
 *   - 4K A: 타일 수만큼 진행 알림을 보낸 뒤 그림을 2배로 (캔버스 다시 뽑기 — 진짜 모델이 아님)
 *   - 4K B: 같은 2배를 두 배쯤 느리게 (화면 쪽 일꾼 · onnxruntime-web 을 띄우지 않는다)
 *   - 이 PC 점검: 정해 둔 사실을 shared buildBaePcCheck 에 넣어 앱과 같은 줄 · 정리
 *   - 서버 표: 이 브라우저 localStorage (시험 계정 셋의 줄 + 올린 내 줄). 올리면 'pc-checks' 신호를 BAE경 통로 이름으로 보낸다
 * node --test 가 바로 읽을 수 있게 '@/' 별칭 없이 상대 경로만 (캔버스는 enlarge 로 바꿔 끼울 수 있다).
 */
import { BAE_MODELS, BAE_MODEL_IDS, baeModelBytes, isBaeModelId, type BaeModelId, type BaeModelProgress, type BaeModelState } from '../../shared/bae/models.ts';
import { baeUpscaleInputProblem, baeUpscaleTileCount, type BaeUpscaleKey } from '../../shared/bae/upscaleTiles.ts';
import { buildBaePcCheck, type BaePcCheck, type BaePcCheckRow, type BaePcFacts, type BaeWebGpuInfo } from '../../shared/bae/pcCheck.ts';
import type { BaeModelGateway, BaeUpscaleAReply, BaeUpscaleTick } from './modelApi';

export interface PreviewModelOptions {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  identity: () => { id: string; name: string } | null;
  canUse: () => boolean;
  canReview: () => boolean;
  userName?: (id: string) => string | undefined;
  /** 'pc-checks' 신호를 보낼 통로 (BroadcastChannel 'bflow-preview-bae-gyeong'). 같은 창의 BAE경 통로도 받는다. */
  channel?: { postMessage(m: unknown): void } | null;
  now?: () => Date;
  /** 진행 한 칸의 기본 시간 (ms). 시험은 0 */
  tickMs?: number;
  /** 2배로 키우기 (화면: 캔버스). 시험은 바꿔 끼운다 */
  enlarge?: (rgba: Uint8Array | Uint8ClampedArray, w: number, h: number) => Promise<Uint8ClampedArray>;
  /** 처음부터 받아 둔 모델 (기본: 레이어 · 각도 모델은 받아 둠, 4K 둘은 아직 — 처음 쓰는 모습이 보이게) */
  readyAtStart?: BaeModelId[];
}
export type PreviewModelGateway = BaeModelGateway & {
  readonly preview: true;
  /** B '원본 그대로'의 가짜 (A 와 같은 2배를 더 느리게). 답의 ep 는 화면이 'webgpu' 로 바꿔 적는다 */
  upscaleBFake(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, ticket: string): Promise<BaeUpscaleAReply>;
};

const K = { checks: 'bflow:preview:bae-pc-checks', pcId: 'bflow:preview:bae-pc-id' };
const SEED_NAMES: Record<string, string> = { '2': '장삐쭈', '3': '허혜원', '4': '안류천' };
const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000001');

async function canvasEnlarge(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Promise<Uint8ClampedArray> {
  const a = document.createElement('canvas'); a.width = w; a.height = h;
  a.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  const b = document.createElement('canvas'); b.width = w * 2; b.height = h * 2;
  const x = b.getContext('2d')!; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(a, 0, 0, b.width, b.height);
  return x.getImageData(0, 0, b.width, b.height).data;
}

/** 시험 계정의 PC 점검 사실 (테스트 모드의 관리자 표가 '누구 PC 에서 무엇이 되는지'를 보이게). */
export function previewPcFacts(kind: 'gpu' | 'nogpu' | 'offline' | 'mine', models: BaeModelState[], webgpu: BaeWebGpuInfo | null): BaePcFacts {
  const base: BaePcFacts = {
    appVersion: 'preview', pcName: '이 PC (테스트 모드)',
    gpu: { name: 'NVIDIA GeForce RTX 3060', vendor: 'NVIDIA', driver: '32.0.15.6094', vramMB: 12288, software: false },
    dml: { ok: true, ms: 280 }, cpu: { ok: true, ms: 35 }, webgpu, models, warehouse: true, internet: true, freeBytes: 182e9, openai: { ok: true, status: 401 },
  };
  if (kind === 'gpu') return { ...base, pcName: 'JBBJ-PC-03', appVersion: '1.151.0' };
  if (kind === 'nogpu') return { ...base, pcName: 'JBBJ-NOTE-11', appVersion: '1.151.0', gpu: { name: 'Intel(R) UHD Graphics 620', vendor: 'Intel', driver: '31.0.101.2111', vramMB: 128, software: false },
    dml: { ok: false, ms: 6, error: 'DirectML 장치를 만들지 못했어요' }, webgpu: { ok: false, why: 'no adapter' }, freeBytes: 21e9 };
  if (kind === 'offline') return { ...base, pcName: 'JBBJ-PC-08', appVersion: '1.150.2', gpu: { name: 'NVIDIA GeForce RTX 4070', vendor: 'NVIDIA', driver: '32.0.15.6094', vramMB: 12282, software: false },
    warehouse: false, internet: false, openai: { ok: false }, models: models.map((m) => ({ ...m, ready: m.id === 'depth', haveBytes: m.id === 'depth' ? m.totalBytes : 0 })) };
  return base;
}

export function createPreviewModelGateway(opts: PreviewModelOptions): PreviewModelGateway {
  const tick = opts.tickMs ?? 120;
  const now = opts.now ?? (() => new Date());
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
  const enlarge = opts.enlarge ?? canvasEnlarge;
  const ready = new Set<BaeModelId>(opts.readyAtStart ?? ['sam', 'birefnet', 'depth']);
  const inflight = new Map<BaeModelId, Promise<{ id: BaeModelId; sources: Record<string, 'local' | 'warehouse' | 'internet'> }>>();
  const progress = new Set<(p: BaeModelProgress) => void>();
  const ticks = new Set<(p: BaeUpscaleTick) => void>();
  let last: BaePcCheck | null = null;
  const me = () => { const u = opts.identity(); if (!u) throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.'); return u; };
  const requireUse = () => { me(); if (!opts.canUse()) throw new Error('BAE경을 쓸 권한이 없습니다. 관리자에게 BAE경 사용자로 지정해 달라고 요청해 주세요.'); };
  const emit = (p: BaeModelProgress) => { for (const l of [...progress]) { try { l(p); } catch { /* 듣는 쪽 오류는 무시 */ } } };
  const stateOf = (id: BaeModelId): BaeModelState => {
    const total = baeModelBytes(BAE_MODELS[id]);
    return { id, ready: ready.has(id), haveBytes: ready.has(id) ? total : 0, totalBytes: total, internet: BAE_MODELS[id].files.every((f) => !!f.url) };
  };
  const states = () => BAE_MODEL_IDS.map(stateOf);
  const read = <T>(key: string, fallback: T): T => { try { const t = opts.storage.getItem(key); return t === null ? fallback : JSON.parse(t) as T; } catch { return fallback; } };
  const nameOf = (id: string) => opts.userName?.(id) ?? SEED_NAMES[id] ?? id;

  function ensure(id: BaeModelId) {
    const have = inflight.get(id); if (have) return have;
    const spec = BAE_MODELS[id]; const total = baeModelBytes(spec);
    const job = (async () => {
      emit({ id, phase: 'check', file: spec.files[0].path, source: 'local', doneBytes: 0, totalBytes: total });
      if (!ready.has(id)) {
        // 창고에서 복사하는 것처럼: 12칸
        for (let i = 1; i <= 12; i++) {
          await sleep(tick * 2.5);
          const done = Math.round((total * i) / 12);
          const file = spec.files[Math.min(spec.files.length - 1, Math.floor(((i - 1) / 12) * spec.files.length))].path;
          emit({ id, phase: 'copy', file, source: 'warehouse', doneBytes: done, totalBytes: total });
        }
        emit({ id, phase: 'verify', file: null, source: 'warehouse', doneBytes: total, totalBytes: total });
        await sleep(tick * 2);
        ready.add(id);
      }
      emit({ id, phase: 'done', file: null, source: null, doneBytes: total, totalBytes: total });
      return { id, sources: Object.fromEntries(spec.files.map((f) => [f.path, 'warehouse' as const])) };
    })().finally(() => { inflight.delete(id); });
    inflight.set(id, job);
    return job;
  }
  async function fakeUpscale(key: BaeUpscaleKey, rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, ticket: string): Promise<BaeUpscaleAReply> {
    requireUse();
    const problem = baeUpscaleInputProblem(w, h, rgba?.byteLength); if (problem) throw new Error(problem);
    const t0 = Date.now();
    await ensure(key === 'A' ? 'up-a' : 'up-b');
    await sleep(tick * (key === 'A' ? 6 : 8));   // 엔진 준비 (모델 일꾼 · 화면 쪽 일꾼을 띄우는 것처럼)
    const total = baeUpscaleTileCount(key, w, h);
    const per = Math.min(tick * (key === 'A' ? 2 : 4), (key === 'A' ? 2600 : 5200) / Math.max(1, total));
    for (let done = 1; done <= total; done++) {
      await sleep(per);
      for (const l of [...ticks]) { try { l({ ticket, done, total }); } catch { /* ignore */ } }
    }
    const out = await enlarge(rgba, w, h);
    return { w: w * 2, h: h * 2, rgba: out, ep: 'dml', ms: Date.now() - t0, tiles: total, fellBack: false };
  }
  function seedRows(): BaePcCheckRow[] {
    const at = (hoursAgo: number) => new Date(now().getTime() - hoursAgo * 3600_000);
    const row = (userId: string, pcId: string, kind: 'gpu' | 'nogpu' | 'offline', hoursAgo: number): BaePcCheckRow => {
      const webgpu = kind === 'nogpu' ? { ok: false, why: 'no adapter' } : { ok: true, f16: true, name: 'nvidia ampere' };
      const models = states().map((m) => ({ ...m, ready: m.id !== 'birefnet', haveBytes: m.id !== 'birefnet' ? m.totalBytes : 0 }));
      const result = buildBaePcCheck(previewPcFacts(kind, models, webgpu), at(hoursAgo));
      return { userId, userName: nameOf(userId), pcId, pcName: result.pcName, appVersion: result.appVersion, level: result.level, summary: result.summary, result, checkedAt: result.checkedAt };
    };
    return [row('2', '5eed0000-0000-4000-8000-00000000ac02', 'gpu', 3), row('3', '5eed0000-0000-4000-8000-00000000ac03', 'nogpu', 26), row('4', '5eed0000-0000-4000-8000-00000000ac04', 'offline', 50)];
  }
  const rows = (): BaePcCheckRow[] => {
    const stored = read<BaePcCheckRow[] | null>(K.checks, null);
    if (stored) return stored;
    const seeded = seedRows(); opts.storage.setItem(K.checks, JSON.stringify(seeded)); return seeded;
  };
  const pcId = () => { let v = opts.storage.getItem(K.pcId); if (!v) { v = uuid(); opts.storage.setItem(K.pcId, v); } return v; };
  async function runCheck(webgpu: BaeWebGpuInfo | null): Promise<BaePcCheck> {
    await sleep(tick * 10);
    const r = buildBaePcCheck(previewPcFacts('mine', states(), webgpu), now());
    last = r; return r;
  }

  return {
    preview: true,
    async status() { requireUse(); return { models: states(), worker: { running: false, pid: null, starts: 0, crashes: 0 } }; },
    async ensure(id: BaeModelId) { requireUse(); if (!isBaeModelId(id)) throw new Error('알 수 없는 모델이에요.'); return ensure(id); },
    async files() { throw new Error('테스트 모드에서는 모델 파일을 주지 않아요.'); },
    upscaleA: (rgba, w, h, ticket) => fakeUpscale('A', rgba, w, h, ticket),
    upscaleBFake: (rgba, w, h, ticket) => fakeUpscale('B', rgba, w, h, ticket),
    async pcCheck(webgpu) { requireUse(); return runCheck(webgpu); },
    async pcCheckPut() {
      const u = me(); requireUse();
      const check = last && now().getTime() - Date.parse(last.checkedAt) < 30 * 60 * 1000 ? last : await runCheck(null);
      const row: BaePcCheckRow = { userId: u.id, userName: u.name, pcId: pcId(), pcName: check.pcName, appVersion: check.appVersion, level: check.level, summary: check.summary, result: check, checkedAt: now().toISOString() };
      const next = [row, ...rows().filter((r) => !(r.userId === row.userId && r.pcId === row.pcId))];
      opts.storage.setItem(K.checks, JSON.stringify(next.slice(0, 200)));
      try { opts.channel?.postMessage({ bae: 'pc-checks' }); } catch { /* ignore */ }
      return row;
    },
    async pcCheckList() {
      me(); if (!opts.canReview()) throw new Error('PC 점검 표는 관리자와 BAE경 검수자만 볼 수 있습니다.');
      return rows().slice().sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : a.checkedAt > b.checkedAt ? -1 : 0));
    },
    async portRequest() { throw new Error('테스트 모드에는 모델 일꾼이 없어요.'); },
    onProgress(cb) { progress.add(cb); return () => { progress.delete(cb); }; },
    onUpscaleProgress(cb) { ticks.add(cb); return () => { ticks.delete(cb); }; },
    onWorker() { return () => {}; },
  };
}
