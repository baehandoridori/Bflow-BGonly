/**
 * BAE경 모델 통로 (화면 → 메인 → 모델 보관함 · 모델 일꾼). 다른 BAE경 통로와 같이, 요청 때의 로그인 세션(epoch)을 보고
 * BAE경을 쓸 권한이 있을 때만 일한다. 키 · 토큰은 이 통로를 지나지 않는다.
 *   bae:model-status    (epoch)                     → { models: BaeModelState[], worker }
 *   bae:model-ensure    (id, epoch)                 → { id, sources }        받는 중 알림은 모든 창에 'bae:model-progress'
 *   bae:model-files     (id, epoch)                 → { files: {자리: 바이트} }  화면에서 도는 모델(4K B)만
 *   bae:upscale-a       (rgba, w, h, ticket, epoch) → { w, h, rgba, ep, ms, tiles, fellBack }  타일 알림은 그 창에 'bae:upscale-progress' { ticket, done, total }
 *   bae:pc-check        (webgpu, epoch)             → BaePcCheck (서버에 올리지 않음)
 *   bae:pc-check-put    (epoch)                     → 서버 표의 내 줄 (마지막 점검을 올림)
 *   bae:pc-check-list   (epoch)                     → 관리자 · 검수자: 모두의 줄
 *   bae:model-port      (epoch)                     → nonce. 그 창에 webContents.postMessage('bae:model-port', { nonce }, [port])
 * 일꾼이 내려가면 모든 창에 'bae:model-worker' { running: false, expected, reason } (화면은 전용 통로를 새로 받는다).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BAE_MODELS, isBaeModelId, type BaeModelId, type BaeModelProgress } from '../../../src/shared/bae/models';
import type { BaeUpscaleAResult, BaeWorkerProbe } from '../../../src/shared/bae/modelProtocol';
import { baeUpscaleInputProblem } from '../../../src/shared/bae/upscaleTiles';
import type { BaePcCheck, BaeWebGpuInfo } from '../../../src/shared/bae/pcCheck';
import { readFile } from 'node:fs/promises';
import type { BaeRpcClient } from '../baeStore';
import { createBaeModelStore, type BaeModelStore } from './modelStore';
import { createBaeModelHost, type BaeModelChild, type BaeModelHost } from './modelHost';
import { readVideoMemoryWindows, reachUrl, runBaePcCheck } from './pcCheck';
import { baePcId, createBaePcCheckStore, type BaePcCheckStore } from './pcCheckStore';

interface IpcEventLike {
  sender?: { send(channel: string, payload: unknown): void; postMessage?(channel: string, message: unknown, transfer?: unknown[]): void; isDestroyed?(): boolean };
}
export interface BaeModelIpcDeps {
  ipc: { handle(channel: string, handler: (event: IpcEventLike, ...args: unknown[]) => Promise<unknown>): void };
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  canUse(actorId: string): Promise<boolean>;
  store: Pick<BaeModelStore, 'ensure' | 'states' | 'filePath'>;
  host: Pick<BaeModelHost, 'request' | 'connectPort' | 'state'>;
  runCheck(webgpu: BaeWebGpuInfo | null): Promise<BaePcCheck>;
  pcChecks: Pick<BaePcCheckStore, 'put' | 'list'>;
  pcId(): Promise<string>;
  /** 전용 통로 한 쌍 (main: new MessageChannelMain()) */
  makeChannel(): { port1: unknown; port2: unknown };
  broadcast(channel: string, payload: unknown): void;
}

export const BAE_MODEL_CHANNELS = ['bae:model-status', 'bae:model-ensure', 'bae:model-files', 'bae:upscale-a', 'bae:pc-check', 'bae:pc-check-put', 'bae:pc-check-list', 'bae:model-port'] as const;

const TICKET = /^[A-Za-z0-9_-]{1,40}$/;

function webgpuInfo(v: unknown): BaeWebGpuInfo | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return { ok: o.ok === true, f16: typeof o.f16 === 'boolean' ? o.f16 : undefined, name: typeof o.name === 'string' ? o.name.slice(0, 120) : undefined, why: typeof o.why === 'string' ? o.why.slice(0, 200) : undefined };
}

export function registerBaeModelIpc(deps: BaeModelIpcDeps): { lastCheck(): BaePcCheck | null } {
  function originFor(requestEpoch: unknown) {
    const origin = { ...deps.getSessionOriginOrThrow() };
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 바뀌었어요. 화면을 다시 열어 주세요.');
    return origin;
  }
  function current(origin: { userId: string; epoch: number }) {
    const n = deps.getSessionOriginOrThrow();
    if (n.userId !== origin.userId || n.epoch !== origin.epoch) throw new Error('로그인 세션이 바뀌어 BAE경 응답을 버렸어요.');
  }
  async function useOrThrow(userId: string) {
    if (!(await deps.canUse(userId))) throw new Error('BAE경을 쓸 권한이 없습니다. 관리자에게 BAE경 사용자로 지정해 달라고 요청해 주세요.');
  }
  const progress = (p: BaeModelProgress) => { try { deps.broadcast('bae:model-progress', p); } catch { /* 창이 닫힘 */ } };
  const sendTo = (e: IpcEventLike, channel: string, payload: unknown) => { try { if (e.sender && !e.sender.isDestroyed?.()) e.sender.send(channel, payload); } catch { /* 창이 닫힘 */ } };
  let last: BaePcCheck | null = null;

  deps.ipc.handle('bae:model-status', async (_e, epoch) => {
    const origin = originFor(epoch); await useOrThrow(origin.userId);
    const models = await deps.store.states(); const w = deps.host.state(); current(origin);
    return { models, worker: { running: w.running, pid: w.pid, starts: w.starts, crashes: w.crashes } };
  });
  deps.ipc.handle('bae:model-ensure', async (_e, id, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeModelId(id)) throw new Error('알 수 없는 모델이에요.');
    await useOrThrow(origin.userId);
    const r = await deps.store.ensure(id, progress); current(origin);
    return { id: r.id, sources: r.sources };
  });
  deps.ipc.handle('bae:model-files', async (_e, id, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeModelId(id) || BAE_MODELS[id].engine !== 'renderer') throw new Error('화면에서 쓰는 모델이 아니에요.');
    await useOrThrow(origin.userId);
    const r = await deps.store.ensure(id, progress);
    const files: Record<string, Uint8Array> = {};
    for (const f of BAE_MODELS[id].files) files[f.path] = new Uint8Array(await readFile(r.files[f.path]));
    current(origin);
    return { files };
  });
  deps.ipc.handle('bae:upscale-a', async (e, rgba, w, h, ticket, epoch) => {
    const origin = originFor(epoch);
    const bytes = rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray ? rgba : null;
    const problem = !bytes ? '그림 데이터가 없어요.' : baeUpscaleInputProblem(w, h, bytes.byteLength); if (problem) throw new Error(problem);
    const t = typeof ticket === 'string' && TICKET.test(ticket) ? ticket : null;
    await useOrThrow(origin.userId);
    await deps.store.ensure('up-a', progress);
    const r = await deps.host.request<BaeUpscaleAResult & Record<string, unknown>>({ type: 'up.a', W: w as number, H: h as number, rgba: bytes! }, {
      onProgress: (done, total) => { if (t) sendTo(e, 'bae:upscale-progress', { ticket: t, done, total }); },
    });
    current(origin);
    return { w: r.w, h: r.h, rgba: r.rgba, ep: r.ep, ms: r.ms, tiles: r.tiles, fellBack: r.fellBack };
  });
  deps.ipc.handle('bae:pc-check', async (_e, webgpu, epoch) => {
    const origin = originFor(epoch); await useOrThrow(origin.userId);
    const r = await deps.runCheck(webgpuInfo(webgpu)); last = r; current(origin);
    return r;
  });
  deps.ipc.handle('bae:pc-check-put', async (_e, epoch) => {
    const origin = originFor(epoch);
    const check = last && Date.now() - Date.parse(last.checkedAt) < 30 * 60 * 1000 ? last : await deps.runCheck(null);
    last = check;
    const row = await deps.pcChecks.put(origin.userId, await deps.pcId(), check); current(origin);
    return row;
  });
  deps.ipc.handle('bae:pc-check-list', async (_e, epoch) => {
    const origin = originFor(epoch);
    const rows = await deps.pcChecks.list(origin.userId); current(origin);
    return rows;
  });
  deps.ipc.handle('bae:model-port', async (e, epoch) => {
    const origin = originFor(epoch); await useOrThrow(origin.userId);
    if (!e.sender?.postMessage) throw new Error('이 창에는 전용 통로를 줄 수 없어요.');
    const { port1, port2 } = deps.makeChannel();
    deps.host.connectPort(port1);
    const nonce = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    e.sender.postMessage('bae:model-port', { nonce }, [port2]);
    return nonce;
  });
  return { lastCheck: () => last };
}

// ───────────── 메인에 세우기 ─────────────
export interface BaeElectronParts {
  utilityProcess: { fork(modulePath: string, args?: string[], options?: { serviceName?: string; stdio?: 'ignore' | 'inherit' | 'pipe'; env?: NodeJS.ProcessEnv }): BaeModelChild };
  MessageChannelMain: new () => { port1: unknown; port2: unknown };
  app: { getGPUInfo(infoType: 'basic' | 'complete'): Promise<unknown> };
}

export interface BaeModelMainDeps {
  electron: BaeElectronParts;
  ipc: BaeModelIpcDeps['ipc'];
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  canUse(actorId: string): Promise<boolean>;
  /** Supabase 클라이언트 (rpc) 와 사람별 세션 토큰 — baeStore 와 같은 것 */
  rpc: BaeRpcClient;
  tokenFor(actorId: string): string;
  broadcast(channel: string, payload: unknown): void;
  /** %LOCALAPPDATA% */
  localAppData: string;
  /** 빌드된 일꾼 파일 (main 옆의 dist-electron/modelWorker.js) */
  workerPath: string;
  appVersion: string;
  /** 모델 창고 폴더 (modelPaths.ts 의 baeModelWarehouseDir). 못 찾으면 null */
  warehouse(): string | null;
  /** OpenAI API 주소 (기본 https://api.openai.com/v1) */
  openaiBase?: () => Promise<string> | string;
  /** 시험 스위치: BFLOW_BAE_MODEL_EP=cpu · BFLOW_BAE_MODEL_FAKE_NO_GPU=session|run (그래픽카드를 끈 것처럼) */
  env?: NodeJS.ProcessEnv;
  idleMs?: number;
}

export function startBaeModelMain(deps: BaeModelMainDeps) {
  const env = deps.env ?? process.env;
  const base = path.join(deps.localAppData, 'Bflow-BGonly');
  const logFile = path.join(base, 'bae', 'logs', 'model.log');
  const hostLog = (line: string) => { try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, `[${new Date().toISOString()}] [main] ${line}\n`); } catch { /* 기록 실패는 무시 */ } };
  const store = createBaeModelStore({ root: path.join(base, 'models'), warehouse: () => deps.warehouse(), log: hostLog });
  const workerEnv: Record<string, string> = { BAE_MODEL_ROOT: store.root, BAE_MODEL_LOG: logFile, BAE_MODEL_EP: env.BFLOW_BAE_MODEL_EP === 'cpu' ? 'cpu' : 'dml' };
  if (env.BFLOW_BAE_MODEL_FAKE_NO_GPU === 'session' || env.BFLOW_BAE_MODEL_FAKE_NO_GPU === 'run') workerEnv.BAE_MODEL_FAKE_NO_GPU = env.BFLOW_BAE_MODEL_FAKE_NO_GPU;
  const host = createBaeModelHost({
    fork: (extra) => deps.electron.utilityProcess.fork(deps.workerPath, [], { serviceName: 'BAE model worker', stdio: 'ignore', env: { ...process.env, ...extra } }),
    env: workerEnv,
    idleMs: deps.idleMs,
    log: hostLog,
    onExit: (info) => { try { deps.broadcast('bae:model-worker', { running: false, expected: info.expected, reason: info.reason }); } catch { /* ignore */ } },
  });
  const pcChecks = createBaePcCheckStore(deps.rpc, { tokenFor: deps.tokenFor });
  const runCheck = (webgpu: BaeWebGpuInfo | null) => runBaePcCheck({
    appVersion: deps.appVersion,
    pcName: os.hostname().slice(0, 120),
    gpuInfo: () => deps.electron.app.getGPUInfo('complete'),
    videoMemory: () => readVideoMemoryWindows(),
    probe: async () => { const r = await host.request<Record<string, unknown>>({ type: 'probe' }); return { dml: r.dml, cpu: r.cpu } as BaeWorkerProbe; },
    models: () => store.states(),
    warehouse: () => deps.warehouse(),
    modelsDir: store.root,
    openaiReach: async () => reachUrl(String((await deps.openaiBase?.()) || 'https://api.openai.com/v1').replace(/\/$/, '') + '/models'),
    internetReach: () => reachUrl(BAE_MODELS.depth.files[0].url!, { method: 'HEAD' }),
    webgpu,
  });
  const ipc = registerBaeModelIpc({
    ipc: deps.ipc,
    getSessionOriginOrThrow: deps.getSessionOriginOrThrow,
    canUse: deps.canUse,
    store, host, runCheck, pcChecks,
    pcId: () => baePcId(path.join(base, 'bae', 'pc-id')),
    makeChannel: () => new deps.electron.MessageChannelMain(),
    broadcast: deps.broadcast,
  });
  return {
    store, host,
    lastCheck: ipc.lastCheck,
    /** 앱을 닫을 때: 일꾼을 내린다. */
    stop() { host.stop('app quit'); },
  };
}
export type BaeModelMain = ReturnType<typeof startBaeModelMain>;
export type { BaeModelId };
