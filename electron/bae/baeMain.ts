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
import { makeJpegPreview, uploadBaePreview, type BaeStorageLike } from './baePreviews';
import type { BaeImageFieldName } from './openaiClient';

export interface BaeMainDeps {
  ipc: Parameters<typeof registerBaeJobsIpc>[0]['ipc'];
  store: BaeStore;
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

  const jobs = createBaeJobs({
    settings,
    keyFor: async (origin) => (await deps.keyring.keyFor(origin)).key,
    local,
    outbox,
    progress: (p: BaeProgress) => deps.broadcast('bae:progress', p),
    imagePrefs,
    publicUrl: (p) => deps.storage().getPublicUrl(p).data.publicUrl,
    appVersion: deps.appVersion,
    origin: os.hostname().slice(0, 120),
  });

  registerBaeJobsIpc({
    ipc: deps.ipc,
    getSessionOriginOrThrow: deps.getSessionOriginOrThrow,
    canUse: async (u) => (await deps.store.access(u)).canUse,
    jobs,
    local,
    flushOutbox: () => { void outbox.flush({ all: true }); },
    saveAs: deps.saveAs,
  });

  return {
    /** 'settings' 신호: 매뉴얼 · 모델 · 가격을 다음 호출 때 다시 읽는다. */
    settingsChanged() { settings.forget(); },
    flush() { void outbox.flush({ all: true }); },
    stop() { jobs.abortAll(); outbox.stop(); },
  };
}
