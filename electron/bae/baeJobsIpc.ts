/**
 * BAE경 만들기 통로 (화면 → 메인). 응답은 요청 때의 로그인 세션(epoch)과 같을 때만 돌려준다.
 * 주문서 · 그림은 오류를 던지지 않고 { ok:false, aborted, message } 로 돌려준다 (ipcMain 오류는 화면에 글만 가서 '그만둠'을 구분할 수 없다).
 */
import { isBaeJobId } from '../../src/shared/bae/jobs';
import { maskSecrets } from '../../src/shared/bae/secrets';
import type { BaeDrawCall, BaeJobs, BaeOrderCall } from './baeJobs';
import type { BaeLocalStore } from './localStore';

export interface BaeJobsIpcDeps {
  ipc: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  canUse(actorId: string): Promise<boolean>;
  jobs: BaeJobs;
  local: BaeLocalStore;
  flushOutbox(): void;
  /** 결과 저장: 저장 창을 띄우고 고른 자리에 쓴다. 고르지 않으면 null. */
  saveAs(defaultName: string, bytes: Uint8Array): Promise<string | null>;
}

const MAX_ORDER_JSON = 40 * 1024 * 1024;
const LOCAL_READ_NAMES = new Set(['result.png', 'gpt.png', 'rough.jpg', 'rough_notes.jpg', 'ref_1.jpg', 'ref_2.jpg', 'ref_3.jpg', 'ref_4.jpg']);

export function registerBaeJobsIpc(deps: BaeJobsIpcDeps): void {
  function originFor(requestEpoch: unknown) {
    const origin = { ...deps.getSessionOriginOrThrow() };
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 바뀌었어요. 화면을 다시 열어 주세요.');
    return origin;
  }
  const same = (origin: { userId: string; epoch: number }) => {
    try { const n = deps.getSessionOriginOrThrow(); return n.userId === origin.userId && n.epoch === origin.epoch; } catch { return false; }
  };
  const gone = { ok: false as const, aborted: false, message: '로그인 세션이 바뀌어 BAE경 응답을 버렸어요.', code: 'SESSION' };
  async function useOrThrow(userId: string) {
    if (!(await deps.canUse(userId))) throw new Error('BAE경을 쓸 권한이 없습니다. 관리자에게 BAE경 사용자로 지정해 달라고 요청해 주세요.');
  }

  deps.ipc.handle('bae:order', async (_e, call, epoch) => {
    const origin = originFor(epoch);
    const q = call as BaeOrderCall;
    if (!q || typeof q !== 'object' || !isBaeJobId(q.jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    if (JSON.stringify(q).length > MAX_ORDER_JSON) throw new Error('보낼 재료가 너무 커요. 그림 수를 줄여 주세요.');
    await useOrThrow(origin.userId);
    const r = await deps.jobs.order(origin, q);
    return same(origin) ? r : gone;
  });
  deps.ipc.handle('bae:draw', async (_e, call, epoch) => {
    const origin = originFor(epoch);
    const q = call as BaeDrawCall;
    if (!q || typeof q !== 'object' || !isBaeJobId(q.jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    if (q.parentJobId !== null && !isBaeJobId(q.parentJobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    if (typeof q.createdAt !== 'string' || !Number.isFinite(Date.parse(q.createdAt))) throw new Error('작업 시각이 올바르지 않아요.');
    await useOrThrow(origin.userId);
    const r = await deps.jobs.draw(origin, q);
    return same(origin) ? r : gone;
  });
  deps.ipc.handle('bae:abort', async (_e, jobId, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeJobId(jobId)) return false;
    return deps.jobs.abort(jobId, origin.userId);
  });
  deps.ipc.handle('bae:job-patch', async (_e, jobId, status, patch, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeJobId(jobId) || typeof status !== 'string' || !['ordering', 'ordered', 'drawing', 'done', 'failed', 'stopped'].includes(status)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    const p = (patch && typeof patch === 'object' ? patch : {}) as { name?: string | null; selfReview?: Record<string, unknown> | null };
    if (JSON.stringify(p).length > 8000) throw new Error('검수 글이 너무 길어요.');
    return deps.jobs.patch(origin.userId, jobId, status as 'done', p);
  });
  deps.ipc.handle('bae:active', async (_e, epoch) => deps.jobs.active(originFor(epoch).userId));
  /** 이 PC 의 원본 (결과 · 재료 미리보기). 없으면 null — 다른 PC 에서 만든 것은 서버 미리보기를 쓴다. */
  deps.ipc.handle('bae:local-file', async (_e, jobId, name, epoch) => {
    originFor(epoch);
    if (!isBaeJobId(jobId) || typeof name !== 'string' || !LOCAL_READ_NAMES.has(name)) throw new Error('보관한 파일 이름이 올바르지 않아요.');
    try { return await deps.local.readJobFile(jobId, name); } catch { return null; }
  });
  deps.ipc.handle('bae:save-as', async (_e, jobId, defaultName, epoch) => {
    originFor(epoch);
    if (!isBaeJobId(jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    const bytes = await deps.local.readJobFile(jobId, 'result.png');
    if (!bytes) throw new Error('이 PC 에 원본이 없어요. 만든 PC 에서 저장해 주세요.');
    // 파일 이름은 사용자가 고르는 저장 창의 처음 값일 뿐 — 경로는 창이 정한다.
    const name = typeof defaultName === 'string' && /^[^\\/:*?"<>|]{1,120}\.png$/.test(defaultName) ? defaultName : 'BAE경.png';
    return deps.saveAs(name, bytes);
  });
  deps.ipc.handle('bae:draft-save', async (_e, draft, epoch) => {
    originFor(epoch);
    const d = draft as { data?: unknown; images?: Record<string, unknown> } | null;
    if (!d || typeof d !== 'object') throw new Error('초안 모양이 올바르지 않아요.');
    const images: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(d.images ?? {})) if (v instanceof Uint8Array) images[k] = v;
    try { await deps.local.saveDraft({ data: d.data ?? null, images }); return true; }
    catch (e) { throw new Error(maskSecrets(e instanceof Error ? e.message : String(e))); }
  });
  deps.ipc.handle('bae:draft-load', async (_e, epoch) => { originFor(epoch); return deps.local.loadDraft(); });
  deps.ipc.handle('bae:draft-clear', async (_e, epoch) => { originFor(epoch); await deps.local.clearDraft(); return true; });
  /** 화면이 다시 연결됐다고 알릴 때 (window 'online') · BAE경을 열 때: 못 보낸 줄을 바로 보낸다. */
  deps.ipc.handle('bae:online', async (_e, epoch) => { originFor(epoch); deps.flushOutbox(); return true; });
}
