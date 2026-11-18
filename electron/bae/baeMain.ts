/**
 * BAE경 메인 쪽을 한데 세우는 곳 (main.ts 는 이것만 부른다): 이 PC 보관함 · 못 보낸 것 줄 · 지금 설정 · 작업 흐름 · 통로.
 * 보관함 뿌리는 %LOCALAPPDATA%\Bflow-BGonly\bae (계획 14 5-3). 사용자 데이터(%APPDATA%)와 다른 곳이다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BaeJobWrite, BaeUsageLine, BaePreviewName } from '../../src/shared/bae/jobs';
import type { BaeStore } from './baeStore';
import type { BaeKeyring } from './baeKeyring';
import { createBaeLocalStore } from './localStore';
import { createBaeOutbox } from './outbox';
import { createBaeSettingsCache } from './baeSettingsCache';
import { createBaeJobs, type BaeProgress } from './baeJobs';
import { registerBaeJobsIpc } from './baeJobsIpc';
import { registerBaeAngleIpc } from './baeAngleIpc';
import { registerBaeLayersIpc } from './baeLayersIpc';
import { makeJpegPreview, uploadBaePreview, type BaeStorageLike } from './baePreviews';
import type { BaeImageFieldName } from './openaiClient';
import { registerBaeFeedbackExportIpc } from './baeFeedbackExport';
import { app, BrowserWindow, dialog, MessageChannelMain, shell, utilityProcess } from 'electron';
import type { BaeRpcClient } from './baeStore';
import { startBaeModelMain } from './model/modelIpc';
import { baeModelWarehouseDir } from './model/modelPaths';

export interface BaeMainDeps {
  ipc: Parameters<typeof registerBaeJobsIpc>[0]['ipc'];
  store: BaeStore;
  /** Supabase 클라이언트 (세션 래퍼 rpc) — 이 PC 점검을 올리고 읽을 때 (4단계) */
  rpc: BaeRpcClient;
  keyring: BaeKeyring;
  storage: () => BaeStorageLike;
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  tokenFor(userId: string): string;
  broadcast(channel: string, payload: unknown): void;
  saveAs(defaultName: string, bytes: Uint8Array): Promise<string | null>;
  appVersion: string;
  localAppData: string;
}

export function startBaeMain(deps: BaeMainDeps) {
  const root = path.join(deps.localAppData, 'Bflow-BGonly', 'bae');
  const local = createBaeLocalStore({ root });
  const settings = createBaeSettingsCache((actorId) => deps.store.settingsGet(actorId));
  const ownerNow = () => { try { return deps.getSessionOriginOrThrow().userId; } catch { return null; } };
  const must = (owner: string | null) => { if (!owner) throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.'); return owner; };
  const outbox = createBaeOutbox({
    dir: local.outboxDir,
    ownerNow,
    forbiddenValues: () => { const u = ownerNow(); if (!u) return []; try { return [deps.tokenFor(u)]; } catch { return []; } },
    handlers: {
      usage: (payload, _id, ctx) => deps.store.usageLog(must(ctx.owner), payload as BaeUsageLine),
      job: (payload, _id, ctx) => deps.store.jobUpsert(must(ctx.owner), payload as BaeJobWrite),
      preview: async (payload) => {
        const p = payload as { jobId: string; file: string; name: BaePreviewName; max: number };
        const bytes = await local.readJobFile(p.jobId, p.file);
        if (!bytes) throw Object.assign(new Error('미리보기를 만들 원본이 이 PC 에 없어요.'), { permanent: true });
        const { jpeg } = makeJpegPreview(bytes, p.max);
        await uploadBaePreview(deps.storage(), p.jobId, p.name, jpeg);
      },
    },
  });
  void outbox.start();

  const prefsFile = path.join(root, 'image-prefs.json');
  const imagePrefs = {
    get(): { imageField: BaeImageFieldName; stream: boolean } {
      try {
        const v = JSON.parse(fs.readFileSync(prefsFile, 'utf8')) as { imageField?: unknown; stream?: unknown };
        return { imageField: v.imageField === 'image' ? 'image' : 'image[]', stream: v.stream !== false };
      } catch { return { imageField: 'image[]', stream: true }; }
    },
    set(p: { imageField: BaeImageFieldName; stream: boolean }) {
      try { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(prefsFile, JSON.stringify(p)); } catch { /* 기억 못 해도 다음에 다시 바꿔 보낸다 */ }
    },
  };

  const canUse = async (u: string) => (await deps.store.access(u)).canUse;
  const keyFor = async (o: { userId: string; epoch: number }) => (await deps.keyring.keyFor(o)).key;
  const publicUrl = (p: string) => deps.storage().getPublicUrl(p).data.publicUrl;
  const origin = os.hostname().slice(0, 120);

  const jobs = createBaeJobs({
    settings,
    keyFor,
    local,
    outbox,
    progress: (p: BaeProgress) => deps.broadcast('bae:progress', p),
    imagePrefs,
    publicUrl,
    appVersion: deps.appVersion,
    origin,
  });

  // 7단계 '다른 각도로': 화면이 입체 판에서 만든 재료로 PD메모 → 그림 (기록 kind 'angle', 장부 'note' · 'angle'). 진행 알림은 같은 'bae:progress' (+ memo).
  const angle = registerBaeAngleIpc({
    ipc: deps.ipc, getSessionOriginOrThrow: deps.getSessionOriginOrThrow, canUse, settings, keyFor, local, outbox,
    progress: (p) => deps.broadcast('bae:progress', p),
    imagePrefs, publicUrl, appVersion: deps.appVersion, origin,
  });
  // 5단계 '레이어로 나누기': 엔진은 화면 쪽 일꾼, 여기는 GPT · 기록 kind 'layers' · PSD 저장과 폴더 열기.
  const layers = registerBaeLayersIpc({
    ipc: deps.ipc, getSessionOriginOrThrow: deps.getSessionOriginOrThrow, canUse, settings, keyFor, local, outbox, imagePrefs, publicUrl,
    showItemInFolder: (p) => shell.showItemInFolder(p),
    appVersion: deps.appVersion, origin,
  });

  registerBaeJobsIpc({
    ipc: deps.ipc,
    getSessionOriginOrThrow: deps.getSessionOriginOrThrow,
    canUse,
    // '지금 진행 중'에 다른 각도로 그리는 것도 넣는다
    jobs: { ...jobs, active: (owner: string) => [...jobs.active(owner), ...angle.active(owner)] },
    local,
    flushOutbox: () => { void outbox.flush({ all: true }); },
    saveAs: deps.saveAs,
  });

  // 피드백 내보내기 (HTML exportFeedback): 검수한 그림을 설명과 함께 zip 하나로. 글은 서버에서 내 세션으로, 그림은 이 PC 에서. 돈 드는 호출 없음.
  registerBaeFeedbackExportIpc({
    ipc: deps.ipc,
    getSessionOriginOrThrow: deps.getSessionOriginOrThrow,
    canUse,
    jobGet: (u, id) => deps.store.jobGet(u, id),
    versions: async (u) => (await settings.get(u)).versions,
    local,
    publicUrl,
    appVersion: deps.appVersion,
    pickZipPath: async (event, defaultName) => {
      const sender = (event as { sender?: Electron.WebContents } | null)?.sender;
      const win = (sender ? BrowserWindow.fromWebContents(sender) : null) ?? BrowserWindow.getFocusedWindow();
      const opts = { defaultPath: path.join(app.getPath('downloads'), defaultName), filters: [{ name: 'ZIP', extensions: ['zip'] }] };
      const r = win && !win.isDestroyed() ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      return r.canceled || !r.filePath ? null : r.filePath;
    },
  });

  // 4단계: 모델 일꾼 프로세스(SAM · BiRefNet · 깊이 · 4K A) · 모델 창고 · 이 PC 점검. 일꾼은 처음 쓸 때 뜨고 5분 쉬면 내려간다.
  const models = startBaeModelMain({
    electron: { utilityProcess, MessageChannelMain, app },
    ipc: deps.ipc,
    getSessionOriginOrThrow: deps.getSessionOriginOrThrow,
    canUse,
    rpc: deps.rpc,
    tokenFor: deps.tokenFor,
    broadcast: deps.broadcast,
    localAppData: deps.localAppData,
    workerPath: path.join(__dirname, 'modelWorker.js'),
    appVersion: deps.appVersion,
    warehouse: baeModelWarehouseDir,
  });

  return {
    /** 'settings' 신호: 매뉴얼 · 모델 · 가격을 다음 호출 때 다시 읽는다. */
    settingsChanged() { settings.forget(); },
    flush() { void outbox.flush({ all: true }); },
    stop() { jobs.abortAll(); angle.abortAll(); layers.abortAll(); outbox.stop(); models.stop(); },
  };
}
