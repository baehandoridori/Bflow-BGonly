/**
 * 테스트 모드(?preview=1)의 BAE경 저장소. 서버와 같은 규칙(관리자 · 명단 · 모두에게 열기, 판 번호와 충돌, 본문은 관리자만)을
 * 이 브라우저의 localStorage 로 흉내 낸다. 다른 창은 BroadcastChannel 로 '바뀌었다'만 듣고 다시 읽는다 (내용 없는 신호).
 * 키는 여기서도 글자를 남기지 않는다: '있음'과 바꾼 날짜만 적는다.
 * node --test 가 바로 읽을 수 있게 '@/' 별칭을 쓰지 않는다.
 */
import { BAE_BODY_KEYS, baeSettingProblem, isBaeSettingKey, textVersion, type BaeSettingKey, type BaeSettingRow } from '../../shared/bae/settings.ts';
import { baeMemberChangeProblem, type BaeAccess, type BaeMember, type BaeMemberRole } from '../../shared/bae/access.ts';
import { baeKeyProblem, type BaeKeyStatus } from '../../shared/bae/secrets.ts';
import { parseBaeJob, type BaeJob, type BaeJobWrite, type BaeUsageLine, type BaeUsageSummary } from '../../shared/bae/jobs.ts';
import type { BaeChange, BaeGateway, BaeSettingsView } from './types.ts';

export interface PreviewIdentity { id: string; name: string; role: string }
export interface PreviewOptions {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  identity: () => PreviewIdentity | null;
  knownUserIds: () => string[];
  channel?: { postMessage(m: unknown): void; addEventListener(t: 'message', l: (e: { data: unknown }) => void): void; removeEventListener(t: 'message', l: (e: { data: unknown }) => void): void } | null;
  now?: () => string;
  /** 만들기 흐름(가짜 PD · 가짜 그림 모델). 화면 쪽(previewMake.ts)이 넣는다 — node 시험에서는 비워 둔다. */
  make?: (ctx: PreviewMakeContext) => PreviewMakeMethods;
}
export type PreviewMakeMethods = Pick<BaeGateway, 'order' | 'draw' | 'abort' | 'jobPatch' | 'active' | 'localFile' | 'saveAs' | 'draftSave' | 'draftLoad' | 'draftClear' | 'online' | 'onProgress'>;
export interface PreviewMakeContext {
  me(): PreviewIdentity;
  requireUse(): void;
  writeJob(w: BaeJobWrite): BaeJob;
  logUsage(line: BaeUsageLine): { duplicate: boolean };
}
const notReady = () => Promise.reject(new Error('테스트 모드의 만들기가 준비되지 않았어요.'));
const noMake: PreviewMakeMethods = {
  order: notReady, draw: notReady, abort: async () => false, jobPatch: notReady, active: async () => [], localFile: async () => null, saveAs: async () => null,
  draftSave: async () => false, draftLoad: async () => null, draftClear: async () => true, online: async () => true, onProgress: () => () => {},
};

const K = { settings: 'bflow:preview:bae-settings', history: 'bflow:preview:bae-settings-history', members: 'bflow:preview:bae-members', key: 'bflow:preview:bae-key',
  jobs: 'bflow:preview:bae-jobs', usage: 'bflow:preview:bae-usage' };
/** 테스트 모드의 처음 글: 진짜 매뉴얼은 메인에만 있어서, 판 번호만 같은 대역 글을 쓴다. */
export type { BaeJobWrite };
export const PREVIEW_DEFAULT_TEXTS = {
  manual: '# BAE PD manual v1.7\n\n(테스트 모드의 대역 글이에요. 진짜 매뉴얼은 앱의 메인 프로세스에만 있어요.)',
  fixed: '# BAE fixed sentences v1\n\n## STYLE\n(테스트 모드의 대역 글이에요.)',
};

type StoredRow = { value: unknown; revision: number; updatedAt: string; updatedBy: string };

export function createBaePreviewGateway(opts: PreviewOptions): BaeGateway {
  const now = opts.now ?? (() => new Date().toISOString());
  const listeners = new Set<(what: BaeChange) => void>();
  const read = <T>(key: string, fallback: T): T => { try { const t = opts.storage.getItem(key); return t === null ? fallback : JSON.parse(t) as T; } catch { return fallback; } };
  const write = (key: string, value: unknown) => opts.storage.setItem(key, JSON.stringify(value));
  const signal = (what: BaeChange) => { for (const l of [...listeners]) l(what); try { opts.channel?.postMessage({ bae: what }); } catch { /* ignore */ } };
  const me = () => { const id = opts.identity(); if (!id) throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.'); return id; };
  const members = (): BaeMember[] => { const known = new Set(opts.knownUserIds()); return read<BaeMember[]>(K.members, []).filter((m) => known.has(m.userId)).sort((a, b) => a.userId.localeCompare(b.userId)); };
  const rows = () => read<Record<string, StoredRow>>(K.settings, {});
  const isOpen = () => { const a = rows().access?.value as { open?: unknown } | undefined; return a?.open === true; };
  const accessOf = (u: PreviewIdentity): BaeAccess => {
    const admin = u.role === 'admin'; const m = members().find((x) => x.userId === u.id);
    return { isAdmin: admin, canUse: admin || !!m || isOpen(), canReview: admin || m?.role === 'reviewer', open: isOpen() };
  };
  const requireUse = () => { const u = me(); const a = accessOf(u); if (!a.canUse) throw new Error('BAE경을 쓸 권한이 없습니다. 관리자에게 BAE경 사용자로 지정해 달라고 요청해 주세요.'); return { u, a }; };
  const requireAdmin = (what: string) => { const u = me(); if (u.role !== 'admin') throw new Error(`${what}은(는) 관리자만 할 수 있습니다.`); return u; };
  const toRow = (key: BaeSettingKey, r: StoredRow): BaeSettingRow => ({ key, value: r.value, revision: r.revision, version: null, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
  const forScreen = (list: BaeSettingRow[], admin: boolean): BaeSettingRow[] => list.map((row) => {
    const isBody = BAE_BODY_KEYS.includes(row.key);
    const text = isBody && row.value && typeof (row.value as { text?: unknown }).text === 'string' ? (row.value as { text: string }).text : null;
    const version = isBody && row.key !== 'guidance' && text !== null ? textVersion(text) : row.version;
    return isBody && !admin ? { ...row, value: null, version, bodyHidden: true } : { ...row, version };
  });
  function save(key: BaeSettingKey, value: unknown, expected: number): BaeSettingRow {
    const u = requireAdmin('BAE경 설정 바꾸기');
    const problem = baeSettingProblem(key, value); if (problem) throw new Error(problem);
    const all = rows(); const cur = all[key];
    if ((cur?.revision ?? 0) !== expected) throw new Error('다른 관리자가 먼저 바꿨습니다. 다시 불러와 주세요.');
    const next: StoredRow = { value, revision: expected + 1, updatedAt: now(), updatedBy: u.id };
    all[key] = next; write(K.settings, all);
    const hist = read<Array<StoredRow & { key: string }>>(K.history, []); hist.push({ ...next, key }); write(K.history, hist.slice(-500));
    signal('settings');
    return forScreen([toRow(key, next)], true)[0];
  }
  // ── 작업 기록 · 장부: 서버 함수(bae_gyeong_session_job_* · usage_*)와 같은 규칙 ──
  const jobs = () => read<BaeJob[]>(K.jobs, []);
  const rank = (st: string) => (st === 'ordering' ? 0 : st === 'ordered' ? 1 : st === 'drawing' ? 2 : 3);
  /** 메인의 작업 흐름 대신 테스트 모드의 만들기 흐름이 부른다. 누가 · 이름표는 여기서 정한다. */
  function writeJob(w: BaeJobWrite): BaeJob {
    const u = me(); const all = jobs(); const i = all.findIndex((j) => j.id === w.id); const at = now();
    if (i < 0) {
      requireUse();
      const job = parseBaeJob({ id: w.id, userId: u.id, userName: u.name, kind: w.kind ?? 'new', status: w.status, name: w.name ?? null, parentJobId: w.parentJobId ?? null,
        summary: w.summary ?? {}, pd: w.pd ?? {}, result: w.result ?? {}, images: w.images ?? {}, selfReview: w.selfReview ?? null, costUsd: w.costUsd ?? 0,
        origin: w.origin ?? '', appVersion: w.appVersion ?? '', hidden: false, createdAt: w.createdAt ?? at, finishedAt: rank(w.status) === 3 ? (w.finishedAt ?? at) : null, updatedAt: at });
      all.unshift(job); write(K.jobs, all.slice(0, 300)); signal('jobs'); return job;
    }
    const cur = all[i];
    if (cur.userId !== u.id) throw new Error('다른 사람의 BAE경 작업 기록은 고칠 수 없습니다.');
    const status = rank(cur.status) === 3 && rank(w.status) < 3 ? cur.status : w.status;
    const next: BaeJob = { ...cur, status, name: 'name' in w ? (w.name ?? null) : cur.name, summary: w.summary ?? cur.summary, pd: w.pd ?? cur.pd, result: w.result ?? cur.result,
      images: w.images ?? cur.images, selfReview: 'selfReview' in w ? (w.selfReview ?? null) : cur.selfReview, costUsd: w.costUsd ?? cur.costUsd,
      finishedAt: rank(status) === 3 ? (cur.finishedAt ?? w.finishedAt ?? at) : null, updatedAt: at };
    all[i] = next; write(K.jobs, all); signal('jobs'); return next;
  }
  function logUsage(line: BaeUsageLine): { duplicate: boolean } {
    const u = me(); const all = read<Array<BaeUsageLine & { userId: string }>>(K.usage, []);
    if (all.some((x) => x.userId === u.id && x.requestId === line.requestId)) return { duplicate: true };
    all.push({ ...line, userId: u.id }); write(K.usage, all.slice(-2000)); return { duplicate: false };
  }
  const listShape = (j: BaeJob): BaeJob => { const { pd: _pd, stampBy: _b, stampNote: _n, ...rest } = j; return rest; };
  const make = opts.make ? opts.make({ me, requireUse: () => { requireUse(); }, writeJob, logUsage }) : noMake;
  return {
    ...make,
    async access() { return accessOf(me()); },
    async settings(): Promise<BaeSettingsView> {
      const u = me(); const a = accessOf(u);
      const defaults = { manual: textVersion(PREVIEW_DEFAULT_TEXTS.manual), fixed: textVersion(PREVIEW_DEFAULT_TEXTS.fixed) };
      if (!a.canUse) return { access: a, rows: [], defaults };
      const list = Object.entries(rows()).filter(([k]) => isBaeSettingKey(k)).map(([k, r]) => toRow(k as BaeSettingKey, r)).sort((x, y) => x.key.localeCompare(y.key));
      return { access: a, rows: forScreen(list, a.isAdmin), defaults };
    },
    async settingsSave(key, value, expected) { if (!isBaeSettingKey(key)) throw new Error('알 수 없는 BAE경 설정이에요.'); return save(key, value, expected); },
    async settingsSeed(key, expected) { return save(key, { text: PREVIEW_DEFAULT_TEXTS[key] }, expected); },
    async settingsHistory(key) {
      requireAdmin('BAE경 설정 기록 보기');
      const list = read<Array<StoredRow & { key: string }>>(K.history, []).filter((h) => h.key === key).sort((a, b) => b.revision - a.revision).slice(0, 50);
      return forScreen(list.map((h) => toRow(key, h)), true);
    },
    async keyStatus(): Promise<BaeKeyStatus> { requireUse(); const k = read<{ updatedAt: string } | null>(K.key, null); return { hasKey: !!k, updatedAt: k?.updatedAt ?? null, label: 'team' }; },
    async keySet(key: string): Promise<BaeKeyStatus> {
      requireAdmin('OpenAI 키 넣기'); const problem = baeKeyProblem(key); if (problem) throw new Error(problem);
      const at = now(); write(K.key, { updatedAt: at }); signal('settings');   // 키 글자는 적지 않는다
      return { hasKey: true, updatedAt: at, label: 'team' };
    },
    async membersList() { requireAdmin('BAE경 명단 보기'); return members(); },
    async membersSet(userId: string, role: BaeMemberRole | null) {
      const u = requireAdmin('BAE경 명단 바꾸기'); void u;
      const problem = baeMemberChangeProblem(userId, role); if (problem) throw new Error(problem);
      if (!opts.knownUserIds().includes(userId)) throw new Error('BAE경 명단에 넣을 사용자를 찾을 수 없습니다.');
      const next = read<BaeMember[]>(K.members, []).filter((m) => m.userId !== userId);
      if (role) next.push({ userId, role }); write(K.members, next); signal('members');
      return members();
    },
    async jobsMine(since, limit = 100) {
      const u = me(); const n = Math.min(300, Math.max(1, limit));
      const mine = jobs().filter((j) => j.userId === u.id).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      const picked = since === null ? mine.slice(0, n) : mine.filter((j) => j.updatedAt > since).reverse().slice(0, n);
      return { rows: picked.map(listShape), more: picked.length >= n, serverTime: now(), total: mine.length };
    },
    async jobGet(jobId) {
      const u = me(); const j = jobs().find((x) => x.id === jobId);
      if (!j) throw new Error('BAE경 작업 기록을 찾을 수 없습니다.');
      if (j.userId !== u.id && !accessOf(u).canReview) throw new Error('다른 사람의 BAE경 작업 기록은 볼 수 없습니다.');
      return j;
    },
    async jobHide(jobId, hidden) {
      const u = me(); const all = jobs(); const i = all.findIndex((x) => x.id === jobId);
      if (i < 0) throw new Error('BAE경 작업 기록을 찾을 수 없습니다.');
      if (all[i].userId !== u.id) throw new Error('내 BAE경 작업 기록만 숨길 수 있습니다.');
      all[i] = { ...all[i], hidden, updatedAt: now() }; write(K.jobs, all); signal('jobs');
      return listShape(all[i]);
    },
    async usageSummary(from, to): Promise<BaeUsageSummary> {
      const u = me(); const rows = read<Array<BaeUsageLine & { userId: string }>>(K.usage, []).filter((x) => x.userId === u.id && (!from || x.at >= from) && (!to || x.at < to));
      const groups = new Map<string, { kind: string; model: string; n: number; usd: number }>();
      for (const r of rows) { const k = r.kind + '|' + r.model; const g = groups.get(k) ?? { kind: r.kind, model: r.model, n: 0, usd: 0 }; g.n++; g.usd += r.usd; groups.set(k, g); }
      return { usd: rows.reduce((a, r) => a + r.usd, 0), images: rows.filter((r) => r.kind === 'image').length, orders: rows.filter((r) => r.kind === 'order').length,
        lines: [...groups.values()].sort((a, b) => (a.kind + a.model).localeCompare(b.kind + b.model)) };
    },
    onChanged(callback) {
      listeners.add(callback);
      const onMsg = (e: { data: unknown }) => { const w = (e.data as { bae?: unknown } | null)?.bae; if (w === 'settings' || w === 'members' || w === 'jobs') callback(w); };
      opts.channel?.addEventListener('message', onMsg);
      return () => { listeners.delete(callback); opts.channel?.removeEventListener('message', onMsg); };
    },
  };
}
