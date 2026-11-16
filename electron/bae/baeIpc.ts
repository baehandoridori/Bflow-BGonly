/**
 * BAE경 화면 ↔ 메인 통로. 화면은 Supabase 를 직접 부르지 않는다 (preload epoch → 여기 → baeStore → bae_gyeong_session_*).
 * - 응답은 요청 때의 로그인 세션(epoch)과 같을 때만 돌려준다 (배경 라이브러리와 같은 방식).
 * - 키는 들어오기만 한다: 키를 화면으로 돌려주는 채널은 없다. 키를 받은 채널의 오류 글은 가린다.
 * - 매뉴얼 · 고정 문장 · 덧붙일 지침의 본문은 관리자 화면에만 준다 (팀원 화면에는 판 번호만).
 */
import { BAE_BODY_KEYS, baeSettingProblem, isBaeSettingKey, textVersion, type BaeSettingKey, type BaeSettingRow } from '../../src/shared/bae/settings';
import { baeMemberChangeProblem, type BaeAccess, type BaeMemberRole } from '../../src/shared/bae/access';
import { baeKeyProblem, maskSecrets } from '../../src/shared/bae/secrets';
import { baeTeamCursorProblem, baeTeamFilterProblem, isBaeJobId, type BaeTeamCursor, type BaeTeamFilter } from '../../src/shared/bae/jobs';
import { BAE_COST_BUCKETS, baeStampNote, baeStampProblem, baeUsageCsv, baeUsageCsvName, type BaeCostBucket, type BaeStamp } from '../../src/shared/bae/review';
import { BAE_SETTING_DEFAULTS } from '../../src/shared/bae/settings';
import type { BaeStore } from './baeStore';
import type { BaeKeyring } from './baeKeyring';
import { BAE_DEFAULT_FIXED, BAE_DEFAULT_MANUAL } from './defaultTexts';

/** 'stamps' = 이 PC 의 창들에만 알리는 '새 도장을 봤다' (서버 신호가 아니다 — 다른 창의 景 숫자를 맞춘다). */
export type BaeChangeKind = 'settings' | 'members' | 'jobs' | 'stamps';

export interface BaeIpcDependencies {
  ipc: { handle(channel: string, handler: (_event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  store: Pick<BaeStore, 'access' | 'settingsGet' | 'settingsSave' | 'settingsHistory' | 'keyStatus' | 'setKey' | 'membersList' | 'membersSet'
    | 'jobListMine' | 'jobGet' | 'jobHide' | 'usageSummary'
    | 'jobListTeam' | 'jobFindTeam' | 'jobStamp' | 'jobStampBulk' | 'jobStamps' | 'stampUnseen' | 'stampSeen' | 'usageTeam'>;
  keyring: Pick<BaeKeyring, 'forget'>;
  onChanged(what: BaeChangeKind): void;
  /** 비용 CSV: 저장 창을 띄우고 고른 자리에 글을 쓴다. 고르지 않으면 null. 화면은 기간만 보내고, 글은 메인이 만든다. */
  saveText(defaultName: string, text: string): Promise<string | null>;
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
  const signal = (what: BaeChangeKind) => { try { deps.onChanged(what); } catch (error) { console.warn('[bae] 변경 알림 실패:', maskSecrets(error)); } };

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

  // ── 관리자 화면 (8단계). 검수자인지 · 누구 기록인지는 서버가 세션으로 정한다 — 여기서는 값의 모양만 본다. ──
  /** 팀 기록 '바뀐 것만' (신호가 왔을 때): 기본 SQL 의 job_list_team. */
  deps.ipc.handle('bae:jobs-team', async (_e, since, limit, epoch) => {
    const origin = originFor(epoch);
    const n = Number.isSafeInteger(limit) ? Math.min(300, Math.max(1, limit as number)) : 100;
    const r = await deps.store.jobListTeam(origin.userId, sinceOk(since), n); current(origin); return r;
  });
  /** 팀 기록 거르기 · 다음 쪽 (서버가 거른다). */
  deps.ipc.handle('bae:jobs-team-find', async (_e, filter, before, limit, epoch) => {
    const origin = originFor(epoch);
    const problem = baeTeamFilterProblem(filter) ?? baeTeamCursorProblem(before); if (problem) throw new Error(problem);
    const n = Number.isSafeInteger(limit) ? Math.min(200, Math.max(1, limit as number)) : 60;
    const r = await deps.store.jobFindTeam(origin.userId, filter as BaeTeamFilter, (before ?? null) as BaeTeamCursor | null, n); current(origin); return r;
  });
  deps.ipc.handle('bae:job-stamp', async (_e, jobId, stamp, note, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeJobId(jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    const problem = baeStampProblem(stamp, note ?? null); if (problem) throw new Error(problem);
    const r = await deps.store.jobStamp(origin.userId, jobId, stamp as BaeStamp | null, stamp === null ? null : baeStampNote(note));
    signal('jobs'); current(origin); return r;
  });
  deps.ipc.handle('bae:job-stamp-bulk', async (_e, jobIds, epoch) => {
    const origin = originFor(epoch);
    if (!Array.isArray(jobIds) || jobIds.length < 1 || jobIds.length > 200 || !jobIds.every(isBaeJobId)) throw new Error('한꺼번에 도장을 찍을 기록은 1~200건이에요.');
    const r = await deps.store.jobStampBulk(origin.userId, [...new Set(jobIds as string[])]);
    signal('jobs'); current(origin); return r;
  });
  deps.ipc.handle('bae:job-stamps', async (_e, jobId, epoch) => {
    const origin = originFor(epoch);
    if (!isBaeJobId(jobId)) throw new Error('BAE경 작업 번호가 올바르지 않아요.');
    const r = await deps.store.jobStamps(origin.userId, jobId); current(origin); return r;
  });
  deps.ipc.handle('bae:stamp-unseen', async (_e, epoch) => {
    const origin = originFor(epoch); const r = await deps.store.stampUnseen(origin.userId); current(origin); return r;
  });
  deps.ipc.handle('bae:stamp-seen', async (_e, upto, epoch) => {
    const origin = originFor(epoch);
    if (upto !== null && (!Number.isSafeInteger(upto) || (upto as number) < 0)) throw new Error('도장 확인 위치가 올바르지 않아요.');
    const r = await deps.store.stampSeen(origin.userId, upto as number | null);
    signal('stamps'); current(origin); return r;
  });
  const bucketOk = (v: unknown): BaeCostBucket => {
    if (!(BAE_COST_BUCKETS as readonly unknown[]).includes(v)) throw new Error('비용 표의 기간 단위가 올바르지 않아요.');
    return v as BaeCostBucket;
  };
  deps.ipc.handle('bae:usage-team', async (_e, from, to, bucket, epoch) => {
    const origin = originFor(epoch);
    const r = await deps.store.usageTeam(origin.userId, sinceOk(from), sinceOk(to), bucketOk(bucket)); current(origin); return r;
  });
  /** 비용 CSV 내보내기: 표는 메인이 서버에서 다시 받아 만든다 (화면이 보낸 숫자를 파일에 쓰지 않는다). 원은 설정의 환율. */
  deps.ipc.handle('bae:usage-export', async (_e, from, to, bucket, epoch) => {
    const origin = originFor(epoch);
    const report = await deps.store.usageTeam(origin.userId, sinceOk(from), sinceOk(to), bucketOk(bucket));
    const rows = await deps.store.settingsGet(origin.userId).catch(() => []);
    const rate = Number((rows.find((r) => r.key === 'prices')?.value as { krwPerUsd?: unknown } | undefined)?.krwPerUsd) || BAE_SETTING_DEFAULTS.prices.krwPerUsd;
    current(origin);
    return deps.saveText(baeUsageCsvName(report), baeUsageCsv(report, rate));
  });
}
