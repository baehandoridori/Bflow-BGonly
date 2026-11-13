/**
 * BAE경 화면 ↔ 메인 통로. 화면은 Supabase 를 직접 부르지 않는다 (preload epoch → 여기 → baeStore → bae_gyeong_session_*).
 * - 응답은 요청 때의 로그인 세션(epoch)과 같을 때만 돌려준다 (배경 라이브러리와 같은 방식).
 * - 키는 들어오기만 한다: 키를 화면으로 돌려주는 채널은 없다. 키를 받은 채널의 오류 글은 가린다.
 * - 매뉴얼 · 고정 문장 · 덧붙일 지침의 본문은 관리자 화면에만 준다 (팀원 화면에는 판 번호만).
 */
import { BAE_BODY_KEYS, baeSettingProblem, isBaeSettingKey, textVersion, type BaeSettingKey, type BaeSettingRow } from '../../src/shared/bae/settings';
import { baeMemberChangeProblem, type BaeAccess, type BaeMemberRole } from '../../src/shared/bae/access';
import { baeKeyProblem, maskSecrets } from '../../src/shared/bae/secrets';
import { isBaeJobId } from '../../src/shared/bae/jobs';
import type { BaeStore } from './baeStore';
import type { BaeKeyring } from './baeKeyring';
import { BAE_DEFAULT_FIXED, BAE_DEFAULT_MANUAL } from './defaultTexts';

export interface BaeIpcDependencies {
  ipc: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  store: Pick<BaeStore, 'access' | 'settingsGet' | 'settingsSave' | 'settingsHistory' | 'keyStatus' | 'setKey' | 'membersList' | 'membersSet'
    | 'jobListMine' | 'jobGet' | 'jobHide' | 'usageSummary'>;
  keyring: Pick<BaeKeyring, 'forget'>;
  onChanged(what: 'settings' | 'members' | 'jobs'): void;
}

export interface BaeSettingsView {
  access: BaeAccess;
  rows: BaeSettingRow[];
  /** 서버에 줄이 없을 때 쓰이는 처음 글의 판 (본문은 보내지 않는다). */
  defaults: { manual: string | null; fixed: string | null };
}

/** 관리자가 아니면 본문을 빼고 판 번호만 남긴다. 판 번호는 모두에게 보인다. */
export function settingsForScreen(rows: BaeSettingRow[], isAdmin: boolean): BaeSettingRow[] {
  return rows.map((row) => {
    const isBody = BAE_BODY_KEYS.includes(row.key);
    const text = isBody && row.value && typeof (row.value as { text?: unknown }).text === 'string' ? (row.value as { text: string }).text : null;
    const version = isBody && row.key !== 'guidance' && text !== null ? textVersion(text) : row.version;
    if (isBody && !isAdmin) return { ...row, value: null, version, bodyHidden: true };
    return { ...row, version };
  });
}

export function registerBaeIpc(deps: BaeIpcDependencies): void {
  function originFor(requestEpoch: unknown) {
    const origin = { ...deps.getSessionOriginOrThrow() };
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 바뀌었어요. 화면을 다시 열어 주세요.');
    return origin;
  }
  function current(origin: { userId: string; epoch: number }) {
    const now = deps.getSessionOriginOrThrow();
    if (origin.userId !== now.userId || origin.epoch !== now.epoch) throw new Error('로그인 세션이 바뀌어 BAE경 응답을 버렸어요.');
  }
  const signal = (what: 'settings' | 'members' | 'jobs') => { try { deps.onChanged(what); } catch (error) { console.warn('[bae] 변경 알림 실패:', maskSecrets(error)); } };

  deps.ipc.handle('bae:access', async (_e, epoch) => {
    const origin = originFor(epoch); const r = await deps.store.access(origin.userId); current(origin); return r;
  });
  deps.ipc.handle('bae:settings', async (_e, epoch): Promise<BaeSettingsView> => {
    const origin = originFor(epoch);
    const access = await deps.store.access(origin.userId);
    if (!access.canUse) { current(origin); return { access, rows: [], defaults: { manual: textVersion(BAE_DEFAULT_MANUAL), fixed: textVersion(BAE_DEFAULT_FIXED) } }; }
    const rows = await deps.store.settingsGet(origin.userId);
    current(origin);
    return { access, rows: settingsForScreen(rows, access.isAdmin), defaults: { manual: textVersion(BAE_DEFAULT_MANUAL), fixed: textVersion(BAE_DEFAULT_FIXED) } };
  });
  deps.ipc.handle('bae:settings-save', async (_e, key, value, expectedRevision, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeSettingKey(key)) throw new Error('알 수 없는 BAE경 설정이에요.');
    const problem = baeSettingProblem(key, value); if (problem) throw new Error(problem);
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw new Error('설정 판 번호가 올바르지 않아요.');
    const row = await deps.store.settingsSave(origin.userId, key, value, expectedRevision as number);
    signal('settings'); current(origin);
    return settingsForScreen([row], true)[0];
  });
  /** 관리자: 매뉴얼 · 고정 문장의 처음 글(v1.7 · v1)을 책장에 올린다. 본문이 화면을 거치지 않는다. */
  deps.ipc.handle('bae:settings-seed', async (_e, key, expectedRevision, epoch) => {
    const origin = originFor(epoch);
    if (key !== 'manual' && key !== 'fixed') throw new Error('처음 글은 매뉴얼과 고정 문장만 있어요.');
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) throw new Error('설정 판 번호가 올바르지 않아요.');
    const row = await deps.store.settingsSave(origin.userId, key, { text: key === 'manual' ? BAE_DEFAULT_MANUAL : BAE_DEFAULT_FIXED }, expectedRevision as number);
    signal('settings'); current(origin);
    return settingsForScreen([row], true)[0];
  });
  deps.ipc.handle('bae:settings-history', async (_e, key, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeSettingKey(key)) throw new Error('알 수 없는 BAE경 설정이에요.');
    const rows = await deps.store.settingsHistory(origin.userId, key as BaeSettingKey); current(origin);
    return settingsForScreen(rows, true);
  });
  deps.ipc.handle('bae:key-status', async (_e, epoch) => {
    const origin = originFor(epoch); const r = await deps.store.keyStatus(origin.userId); current(origin); return r;
  });
  deps.ipc.handle('bae:key-set', async (_e, key, epoch) => {
    const origin = originFor(epoch);
    const problem = baeKeyProblem(key); if (problem) throw new Error(problem);
    try {
      const status = await deps.store.setKey(origin.userId, (key as string).trim());
      deps.keyring.forget(); signal('settings'); current(origin);
      return status;
    } catch (error) {
      // 이 채널의 오류는 어떤 경우에도 키 글자를 싣지 않는다.
      throw new Error(maskSecrets(error instanceof Error ? error.message : String(error)));
    }
  });
  deps.ipc.handle('bae:members-list', async (_e, epoch) => {
    const origin = originFor(epoch); const r = await deps.store.membersList(origin.userId); current(origin); return r;
  });
  deps.ipc.handle('bae:members-set', async (_e, userId, role, epoch) => {
    const origin = originFor(epoch);
    const problem = baeMemberChangeProblem(userId, role); if (problem) throw new Error(problem);
    const r = await deps.store.membersSet(origin.userId, userId as string, role as BaeMemberRole | null);
    signal('members'); current(origin);
    return r;
  });
  // ── 작업 기록 · 장부 읽기 (2단계). 쓰기는 메인의 작업 흐름(baeJobs)만 한다 — 화면이 기록을 직접 쓰지 않는다. ──
  const sinceOk = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw new Error('목록 기준 시각이 올바르지 않아요.');
    return v;
  };
  deps.ipc.handle('bae:jobs-mine', async (_e, since, limit, epoch) => {
    const origin = originFor(epoch);
    const n = Number.isSafeInteger(limit) ? Math.min(300, Math.max(1, limit as number)) : 100;
    const r = await deps.store.jobListMine(origin.userId, sinceOk(since), n); current(origin); return r;
  });
  deps.ipc.handle('bae:job-get', async (_e, jobId, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeJobId(jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    const r = await deps.store.jobGet(origin.userId, jobId); current(origin); return r;
  });
  deps.ipc.handle('bae:job-hide', async (_e, jobId, hidden, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeJobId(jobId) || typeof hidden !== 'boolean') throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    const r = await deps.store.jobHide(origin.userId, jobId, hidden); signal('jobs'); current(origin); return r;
  });
  deps.ipc.handle('bae:usage-summary', async (_e, from, to, epoch) => {
    const origin = originFor(epoch);
    const r = await deps.store.usageSummary(origin.userId, sinceOk(from), sinceOk(to)); current(origin); return r;
  });
}
