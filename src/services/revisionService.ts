/**
 * 컴포지팅 리테이크 서비스
 *
 * Google Sheets _COMP_REVISIONS 탭 동기화
 * - 시트 연결 시: _COMP_REVISIONS 탭에서 전체 로딩 + 캐시
 * - 미연결 시: %APPDATA%/Bflow-BGonly/revisions.json 로컬 폴백
 *
 * sceneKey 형식: "EP01:A:1" (에피소드:파트:정규화된 씬번호 — 시트명 비의존)
 */

import type { CompRevision, Part, RevisionAssigneeState, RevisionPriority, RevisionStatus } from '../types';
import { useDataStore } from '../stores/useDataStore';
import {
  buildDistinctRevisionSceneId,
  buildRevisionSceneKeyLookupKeys,
  buildUnifiedRevisionSceneKey,
  normalizeRevisionSceneKey,
  type RevisionSceneKeyOptions,
} from '../utils/revisionSceneKey';
import { normalizeSceneIdKey } from '../utils/sceneIdKey';
import { normalizePartIdKey } from '../utils/partId';
import { buildRevisionNotificationUserIds } from '../utils/revisionNotificationRecipients';
import {
  startAssignee, completeAssignee, revertAssignee, deriveRevisionStatus, sanitizeAssignees,
} from '../utils/revisionWorkflow';

const REVISIONS_FILE = 'revisions.json';
const DIGITS_ONLY_RE = /^\d+$/;

type RevisionsStore = Record<string, CompRevision[]>; // sceneKey → revisions

let revisionContextSignature: string | null = null;

function parseRevisionSceneKey(sceneKey: string) {
  const [episode = '', part = '', sceneId = ''] = sceneKey.split(':');
  return { episode, part, sceneId };
}

function parseSheetContext(sheetName: string) {
  const [episode = '', part = ''] = sheetName.split('_');
  return { episode, part };
}

function normalizeRawRevisionSceneId(sceneId: string): string {
  const normalized = sceneId.trim().toLowerCase();
  if (!normalized.startsWith('raw-')) return normalized;

  try {
    return decodeURIComponent(normalized.slice(4));
  } catch {
    return normalized.slice(4);
  }
}

function buildRevisionContextSignature(): string {
  return useDataStore.getState().episodes
    .map((episode) => episode.parts
      .map((part) => `${part.sheetName}:${part.scenes.map((scene) => scene.sceneId.trim().toLowerCase()).join(',')}`)
      .join('|'))
    .join('||');
}

function syncRevisionContextSignature(): void {
  const nextSignature = buildRevisionContextSignature();
  if (revisionContextSignature === null) {
    revisionContextSignature = nextSignature;
    return;
  }
  if (revisionContextSignature === nextSignature) return;

  revisionContextSignature = nextSignature;
  sheetsCache = null;
  localCache = null;
}

function getPartsForRevisionContext(episode: string, part: string) {
  const episodes = useDataStore.getState().episodes;
  const parts: Part[] = [];
  const partKey = normalizePartIdKey(part);
  for (const candidateEpisode of episodes) {
    for (const candidatePart of candidateEpisode.parts) {
      const { episode: candidateEpisodeId, part: candidatePartId } = parseSheetContext(candidatePart.sheetName);
      if (candidateEpisodeId !== episode || normalizePartIdKey(candidatePartId) !== partKey) continue;
      parts.push(candidatePart);
    }
  }
  return parts;
}

function getPartWideAliasCollisionSceneIds(
  episode: string,
  part: string,
  targetSceneId?: string,
): string[] | undefined {
  if (!episode || !part) return undefined;

  const parts = getPartsForRevisionContext(episode, part);
  if (parts.length === 0) return undefined;

  const collidingKeys = new Set<string>();
  for (const candidatePart of parts) {
    const rawIdsByKey = new Map<string, Set<string>>();
    candidatePart.scenes.forEach((scene) => {
      const rawSceneId = scene.sceneId.trim();
      const normalizedKey = normalizeSceneIdKey(rawSceneId, part);
      if (!rawSceneId || !normalizedKey) return;

      if (!rawIdsByKey.has(normalizedKey)) rawIdsByKey.set(normalizedKey, new Set());
      rawIdsByKey.get(normalizedKey)?.add(rawSceneId.toLowerCase());
    });

    rawIdsByKey.forEach((rawIds, normalizedKey) => {
      if (rawIds.size > 1) collidingKeys.add(normalizedKey);
    });
  }

  const targetKey = targetSceneId ? normalizeSceneIdKey(targetSceneId, part) : '';
  if (targetKey && !collidingKeys.has(targetKey)) return undefined;

  const collisionSceneIds: string[] = [];
  const seen = new Set<string>();
  for (const candidatePart of parts) {
    for (const scene of candidatePart.scenes) {
      const rawSceneId = scene.sceneId.trim();
      const normalizedKey = normalizeSceneIdKey(rawSceneId, part);
      const dedupeKey = rawSceneId.toLowerCase();
      if (!rawSceneId || !collidingKeys.has(normalizedKey) || seen.has(dedupeKey)) continue;

      collisionSceneIds.push(rawSceneId);
      seen.add(dedupeKey);
    }
  }

  return collisionSceneIds.length > 0 ? collisionSceneIds : undefined;
}

function getSiblingSceneIdsForStoredSceneKey(sceneKey: string): string[] | undefined {
  const { episode, part, sceneId } = parseRevisionSceneKey(sceneKey);
  const rawSceneId = normalizeRawRevisionSceneId(sceneId);
  if (!rawSceneId) return undefined;

  return getPartWideAliasCollisionSceneIds(episode, part, rawSceneId);
}

function hasPartsForRevisionContext(sceneKey: string): boolean {
  const { episode, part } = parseRevisionSceneKey(sceneKey);
  return getPartsForRevisionContext(episode, part).length > 0;
}

function preserveRawStoredRevisionSceneKey(sceneKey: string): string {
  const { episode, part, sceneId } = parseRevisionSceneKey(sceneKey);
  const rawSceneId = normalizeRawRevisionSceneId(sceneId);
  if (!rawSceneId || DIGITS_ONLY_RE.test(rawSceneId)) {
    return normalizeRevisionSceneKey(sceneKey);
  }
  return `${episode}:${part}:${buildDistinctRevisionSceneId(rawSceneId)}`;
}

function getSiblingSceneIdsForSheetScene(sheetName: string, sceneId: string): string[] | undefined {
  const { episode, part } = parseSheetContext(sheetName);
  return getPartWideAliasCollisionSceneIds(episode, part, sceneId);
}

function normalizeStoredRevisionSceneKey(sceneKey: string): string {
  if (!hasPartsForRevisionContext(sceneKey)) {
    return preserveRawStoredRevisionSceneKey(sceneKey);
  }

  return normalizeRevisionSceneKey(sceneKey, {
    siblingSceneIds: getSiblingSceneIdsForStoredSceneKey(sceneKey),
  });
}

export function getRevisionLookupSceneKeys(sceneKey: string): string[] {
  const lookupKeys = buildRevisionSceneKeyLookupKeys(sceneKey, {
    siblingSceneIds: getSiblingSceneIdsForStoredSceneKey(sceneKey),
  });
  const primarySceneId = parseRevisionSceneKey(lookupKeys[0] ?? sceneKey).sceneId.trim().toLowerCase();

  if (!primarySceneId.startsWith('raw-')) {
    getRawAliasSceneKeysForSharedSceneKey(lookupKeys[0] ?? sceneKey).forEach((aliasKey) => {
      if (!lookupKeys.includes(aliasKey)) lookupKeys.push(aliasKey);
    });
  }

  return lookupKeys;
}

function collectRevisionsForSceneKey(store: RevisionsStore, sceneKey: string): CompRevision[] {
  const revisions: CompRevision[] = [];
  const seen = new Set<string>();

  getRevisionLookupSceneKeys(sceneKey).forEach((lookupKey) => {
    (store[lookupKey] ?? []).forEach((revision) => {
      if (seen.has(revision.id)) return;
      revisions.push(revision);
      seen.add(revision.id);
    });
  });

  return revisions;
}

function getRawAliasSceneKeysForSharedSceneKey(sceneKey: string): string[] {
  const { episode, part, sceneId } = parseRevisionSceneKey(sceneKey);
  const normalizedSceneId = sceneId.trim().toLowerCase();
  if (!episode || !part || !normalizedSceneId || normalizedSceneId.startsWith('raw-')) return [];

  const aliasKeys: string[] = [];
  const seen = new Set<string>();
  for (const candidatePart of getPartsForRevisionContext(episode, part)) {
    for (const scene of candidatePart.scenes) {
      const rawSceneId = scene.sceneId.trim();
      if (!rawSceneId || normalizeSceneIdKey(rawSceneId, part) !== normalizedSceneId) continue;

      const aliasKey = `${episode}:${part}:${buildDistinctRevisionSceneId(rawSceneId)}`;
      if (aliasKey === sceneKey || seen.has(aliasKey)) continue;

      aliasKeys.push(aliasKey);
      seen.add(aliasKey);
    }
  }

  return aliasKeys;
}

export function buildOpenRevisionCountMap(revisions: CompRevision[]): Record<string, number> {
  const counts: Record<string, number> = {};

  revisions.forEach((revision) => {
    if (revision.status === 'resolved') return;

    const sceneKeys = new Set(getRevisionLookupSceneKeys(revision.sceneKey));
    sceneKeys.forEach((sceneKey) => {
      counts[sceneKey] = (counts[sceneKey] || 0) + 1;
    });
  });

  return counts;
}

function normalizeRevisionStore(store: RevisionsStore): RevisionsStore {
  const normalized: RevisionsStore = {};

  for (const [sceneKey, revisions] of Object.entries(store)) {
    const normalizedKey = normalizeStoredRevisionSceneKey(sceneKey);
    if (!normalized[normalizedKey]) normalized[normalizedKey] = [];

    revisions.forEach((revision) => {
      normalized[normalizedKey].push({
        ...revision,
        sceneKey: normalizedKey,
      });
    });
  }

  return normalized;
}

// ─── 모드 관리 ──────────────────────────────────

let sheetsMode = false;

export function setRevisionsSheetsMode(enabled: boolean): void {
  sheetsMode = enabled;
  if (!enabled) sheetsCache = null;
}

// ─── 로컬 파일 ──────────────────────────────────

let localCache: RevisionsStore | null = null;

async function loadLocalAll(): Promise<RevisionsStore> {
  syncRevisionContextSignature();
  if (localCache) return localCache;
  try {
    const data = await window.electronAPI.readSettings(REVISIONS_FILE);
    if (data && typeof data === 'object') {
      localCache = normalizeRevisionStore(data as RevisionsStore);
      return localCache;
    }
  } catch { /* 파일 없음 */ }
  localCache = {};
  return localCache;
}

async function saveLocal(all: RevisionsStore): Promise<void> {
  localCache = all;
  await window.electronAPI.writeSettings(REVISIONS_FILE, all);
}

// ─── 시트 캐시 (전체 로딩) ──────────────────────

let sheetsCache: RevisionsStore | null = null;

function rowToRevision(row: {
  id: string; sceneKey: string; revisionNo: number; status: string;
  description: string; imageUrl: string; department: string;
  requesterId: string; requesterName: string; assignee: string;
  resolvedBy: string; resolvedNote: string;
  createdAt: string; updatedAt: string; resolvedAt: string;
  priority?: string; frameNo?: string;
  notifyUserIds?: string[] | null;
  assigneeIds?: string[] | null;
  assigneeStates?: Record<string, RevisionAssigneeState> | null;
  setId?: string | null;
  finalResolvedBy?: string | null;
  finalResolvedAt?: string | null;
}): CompRevision {
  const p = row.priority as RevisionPriority | undefined;
  const sceneKey = normalizeStoredRevisionSceneKey(row.sceneKey);
  return {
    id: row.id,
    sceneKey,
    revisionNo: Number(row.revisionNo) || 0,
    status: (row.status as RevisionStatus) || 'open',
    priority: (p === 'urgent' || p === 'high' || p === 'normal') ? p : 'normal',
    description: row.description || '',
    frameNo: row.frameNo || undefined,
    imageUrl: row.imageUrl || undefined,
    department: (row.department === 'bg' || row.department === 'acting') ? row.department : undefined,
    requesterId: row.requesterId || '',
    requesterName: row.requesterName || '',
    assignee: row.assignee || undefined,
    resolvedBy: row.resolvedBy || undefined,
    resolvedNote: row.resolvedNote || undefined,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    resolvedAt: row.resolvedAt || undefined,
    notifyUserIds: Array.isArray(row.notifyUserIds) ? row.notifyUserIds : undefined,
    assigneeIds: Array.isArray(row.assigneeIds) ? row.assigneeIds : [],
    assigneeStates: (row.assigneeStates && typeof row.assigneeStates === 'object' && !Array.isArray(row.assigneeStates)) ? row.assigneeStates : {},
    setId: (row.setId as string) ?? null,
    finalResolvedBy: (row.finalResolvedBy as string) ?? '',
    finalResolvedAt: (row.finalResolvedAt as string) || undefined,
  };
}

export async function loadAllRevisions(): Promise<RevisionsStore> {
  syncRevisionContextSignature();
  if (sheetsCache) return sheetsCache;

  let rows: {
    id: string; sceneKey: string; revisionNo: number; status: string;
    description: string; imageUrl: string; department: string;
    requesterId: string; requesterName: string; assignee: string;
    resolvedBy: string; resolvedNote: string;
    createdAt: string; updatedAt: string; resolvedAt: string;
    priority?: string; frameNo?: string;
    notifyUserIds?: string[] | null;
    assigneeIds?: string[] | null;
    assigneeStates?: Record<string, RevisionAssigneeState> | null;
    setId?: string | null;
    finalResolvedBy?: string | null;
    finalResolvedAt?: string | null;
  }[] = [];

  try {
    // Supabase 우선
    const rawData = await window.electronAPI.supabaseReadRevisions();
    rows = (rawData as typeof rows) ?? [];
  } catch {
    // Sheets fallback
    try {
      const result = await window.electronAPI.sheetsReadRevisions();
      if (result.ok) rows = result.data ?? [];
    } catch (err) {
      console.warn('[리테이크] 로드 실패:', err);
      return {};
    }
  }

  const store: RevisionsStore = {};
  for (const row of rows) {
    const rev = rowToRevision(row);
    if (!store[rev.sceneKey]) store[rev.sceneKey] = [];
    store[rev.sceneKey].push(rev);
  }

  sheetsCache = normalizeRevisionStore(store);
  return sheetsCache;
}

/** 시트 캐시 무효화 */
export function invalidateRevisionsCache(): void {
  sheetsCache = null;
}

// ─── 통합 API ───────────────────────────────────

export async function getRevisions(sceneKey: string): Promise<CompRevision[]> {
  if (sheetsMode) {
    const store = await loadAllRevisions();
    return collectRevisionsForSceneKey(store, sceneKey);
  }
  const all = await loadLocalAll();
  return collectRevisionsForSceneKey(all, sceneKey);
}

export async function getAllRevisions(): Promise<CompRevision[]> {
  let store: RevisionsStore;
  if (sheetsMode) {
    store = await loadAllRevisions();
  } else {
    store = await loadLocalAll();
  }
  const all: CompRevision[] = [];
  for (const list of Object.values(store)) {
    all.push(...list);
  }
  return all;
}

function nextRevisionNo(store: RevisionsStore, sceneKeys: string[]): number {
  const existing = sceneKeys.flatMap((sceneKey) => store[sceneKey] ?? []);
  if (existing.length === 0) return 1;
  return Math.max(...existing.map(r => r.revisionNo)) + 1;
}

/**
 * v1.18.0: 리테이크 등록 input 시그니처.
 * 우선순위/프레임/담당자 입력 UI 가 폼에서 제거되어 (한솔 결정 — spec 2026-05-03)
 * 자동값('normal' / '' / '') 으로 처리. 호출자는 핵심 데이터만 전달.
 */
export interface CreateRevisionServiceInput {
  sceneKey: string;
  description: string;
  imageUrl?: string;
  department?: 'bg' | 'acting';
  lookupDepartment?: 'bg' | 'acting';
  requesterId: string;
  requesterName: string;
  notifyUserIds: string[];
  /** 생성 시 담당자 지정 (리테이크 허브 2단계). 항상 notifyUserIds 의 부분집합으로 보정됨. */
  assigneeIds?: string[];
}

export async function createRevision(input: CreateRevisionServiceInput): Promise<CompRevision> {
  const lookupSceneKeys = getRevisionLookupSceneKeys(input.sceneKey);
  const normalizedSceneKey = lookupSceneKeys[0];
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  // v1.18.0 자동값: 우선순위/프레임/담당자 입력 UI 제거 → 항상 'normal' / '' / ''.
  const priority: RevisionPriority = 'normal';
  const department = input.department || input.lookupDepartment;
  const notifyUserIds = buildRevisionNotificationUserIds({
    notifyUserIds: input.notifyUserIds,
    requesterId: input.requesterId,
  });
  // 담당자 지정(2단계): 불변식 assignee_ids ⊆ notify_user_ids 복원 후 초기 status 파생.
  // (담당자 있어도 전원 pending 이라 보통 'open'. status 는 읽을 때 mapRevision 이 재파생하는 캐시값.)
  const { assigneeIds, assigneeStates } = sanitizeAssignees(input.assigneeIds ?? [], {}, notifyUserIds);
  const initialStatus = deriveRevisionStatus(assigneeIds, assigneeStates, undefined);

  if (sheetsMode) {
    const store = await loadAllRevisions();
    const revisionNo = nextRevisionNo(store, lookupSceneKeys);
    const revision: CompRevision = {
      id,
      sceneKey: normalizedSceneKey,
      revisionNo,
      status: initialStatus,
      priority,
      description: input.description,
      frameNo: undefined,
      imageUrl: input.imageUrl,
      department,
      requesterId: input.requesterId,
      requesterName: input.requesterName,
      assignee: undefined,
      createdAt: now,
      updatedAt: now,
      notifyUserIds,
      assigneeIds,
      assigneeStates,
      setId: null,
      finalResolvedBy: '',
      finalResolvedAt: undefined,
    };

    // Supabase: partUuid + sceneId로 저장 (sceneKey를 그대로 partUuid 자리에 전달 — 서버에서 해석)
    await window.electronAPI.supabaseAddRevision(
      id, '', normalizedSceneKey, revisionNo, initialStatus, priority,
      input.description, '', input.imageUrl || '', department || '', input.lookupDepartment || department || '',
      input.requesterId, input.requesterName, '', now,
      JSON.stringify(notifyUserIds),
      JSON.stringify(assigneeIds),
    );

    // 캐시 업데이트
    if (!store[normalizedSceneKey]) store[normalizedSceneKey] = [];
    store[normalizedSceneKey].push(revision);

    return revision;
  }

  // 로컬 모드
  const all = await loadLocalAll();
  const revisionNo = nextRevisionNo(all, lookupSceneKeys);
  const revision: CompRevision = {
    id,
    sceneKey: normalizedSceneKey,
    revisionNo,
    status: initialStatus,
    priority,
    description: input.description,
    frameNo: undefined,
    imageUrl: input.imageUrl,
    department,
    requesterId: input.requesterId,
    requesterName: input.requesterName,
    assignee: undefined,
    createdAt: now,
    updatedAt: now,
    notifyUserIds,
    assigneeIds,
    assigneeStates,
    setId: null,
    finalResolvedBy: '',
    finalResolvedAt: undefined,
  };

  if (!all[normalizedSceneKey]) all[normalizedSceneKey] = [];
  all[normalizedSceneKey].push(revision);
  await saveLocal(all);

  return revision;
}

export async function updateRevisionStatus(
  id: string,
  sceneKey: string,
  status: RevisionStatus,
  extra?: { resolvedBy?: string; resolvedNote?: string },
): Promise<void> {
  const lookupSceneKeys = getRevisionLookupSceneKeys(sceneKey);
  const now = new Date().toISOString();
  const updates: Record<string, string> = { status, updatedAt: now };
  if (status === 'resolved') {
    updates.resolvedAt = now;
    if (extra?.resolvedBy) updates.resolvedBy = extra.resolvedBy;
    if (extra?.resolvedNote) updates.resolvedNote = extra.resolvedNote;
  }

  if (sheetsMode) {
    await window.electronAPI.supabaseUpdateRevision(id, updates);
    // 캐시 업데이트
    if (sheetsCache) {
      for (const lookupSceneKey of lookupSceneKeys) {
        const list = sheetsCache[lookupSceneKey];
        if (!list) continue;

        const idx = list.findIndex(r => r.id === id);
        if (idx >= 0) {
          list[idx] = {
            ...list[idx],
            status,
            updatedAt: now,
            resolvedAt: status === 'resolved' ? now : list[idx].resolvedAt,
            resolvedBy: extra?.resolvedBy ?? list[idx].resolvedBy,
            resolvedNote: extra?.resolvedNote ?? list[idx].resolvedNote,
          };
          break;
        }
      }
    }
    return;
  }

  // 로컬 모드
  const all = await loadLocalAll();
  for (const lookupSceneKey of lookupSceneKeys) {
    const list = all[lookupSceneKey];
    if (!list) continue;

    const idx = list.findIndex(r => r.id === id);
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        status,
        updatedAt: now,
        resolvedAt: status === 'resolved' ? now : list[idx].resolvedAt,
        resolvedBy: extra?.resolvedBy ?? list[idx].resolvedBy,
        resolvedNote: extra?.resolvedNote ?? list[idx].resolvedNote,
      };
      break;
    }
  }
  await saveLocal(all);
}

// ─── 담당 워크플로우 (리테이크 허브 1단계, 2단계에서 local mode 지원 추가) ─────────────
// 모두 deriveRevisionStatus 로 status 를 파생해 저장한다.
// supabaseUpdateRevision 은 Record<string,string> 만 받으므로 객체/배열은 JSON 문자열로 직렬화한다.

/**
 * 담당 워크플로우 변경을 sheetsMode 면 IPC(+ sheetsCache 패치), 아니면 local revisions.json 에 반영.
 * (Codex P2: 기존 헬퍼가 sheetsMode 분기 없이 IPC 만 호출해 local/preview/test 모드에서 액션이 손실되던 문제.)
 * @param supabaseUpdates IPC 로 보낼 Record<string,string> (JSON 문자열·__op 포함)
 * @param localPatch 로컬/캐시 CompRevision 에 머지할 부분 객체
 */
async function persistRevisionWorkflow(
  rev: CompRevision,
  supabaseUpdates: Record<string, string>,
  localPatch: Partial<CompRevision>,
): Promise<void> {
  const lookupSceneKeys = getRevisionLookupSceneKeys(rev.sceneKey);
  if (sheetsMode) {
    await window.electronAPI.supabaseUpdateRevision(rev.id, supabaseUpdates);
    if (sheetsCache) {
      for (const key of lookupSceneKeys) {
        const list = sheetsCache[key];
        if (!list) continue;
        const idx = list.findIndex((r) => r.id === rev.id);
        if (idx >= 0) { list[idx] = { ...list[idx], ...localPatch }; break; }
      }
    }
    return;
  }
  // 로컬 모드 (preview/test fallback)
  const all = await loadLocalAll();
  for (const key of lookupSceneKeys) {
    const list = all[key];
    if (!list) continue;
    const idx = list.findIndex((r) => r.id === rev.id);
    if (idx >= 0) { list[idx] = { ...list[idx], ...localPatch }; break; }
  }
  await saveLocal(all);
}

/** 담당자 본인이 작업 시작 (none/pending → in_progress). */
export async function startAssigneeWork(rev: CompRevision, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const states = startAssignee(rev.assigneeStates ?? {}, userId, now);
  const status = deriveRevisionStatus(rev.assigneeIds ?? [], states, rev.finalResolvedAt);
  await persistRevisionWorkflow(rev,
    { assigneeStates: JSON.stringify(states), status, updatedAt: now },
    { assigneeStates: states, status, updatedAt: now });
}

/** 담당자 본인 완료 (멘트 포함). */
export async function completeAssigneeWork(rev: CompRevision, userId: string, note: string): Promise<void> {
  const now = new Date().toISOString();
  const states = completeAssignee(rev.assigneeStates ?? {}, userId, note, now);
  const status = deriveRevisionStatus(rev.assigneeIds ?? [], states, rev.finalResolvedAt);
  await persistRevisionWorkflow(rev,
    { assigneeStates: JSON.stringify(states), status, updatedAt: now },
    { assigneeStates: states, status, updatedAt: now });
}

/** 담당자 재배정 (요청자/컴포지터급). assigneeIds 는 notify 의 부분집합으로 sanitize. */
export async function reassignRevision(rev: CompRevision, nextAssigneeIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  const { assigneeIds, assigneeStates } = sanitizeAssignees(
    nextAssigneeIds, rev.assigneeStates ?? {}, rev.notifyUserIds ?? [],
  );
  const status = deriveRevisionStatus(assigneeIds, assigneeStates, rev.finalResolvedAt);
  await persistRevisionWorkflow(rev,
    {
      assigneeIds: JSON.stringify(assigneeIds),
      assigneeStates: JSON.stringify(assigneeStates),
      status, updatedAt: now,
      // 활동기록 분기 전용 신호. main 핸들러가 분리해 DB 로는 보내지 않는다(fieldMap 미등록).
      __op: 'reassign',
    },
    { assigneeIds, assigneeStates, status, updatedAt: now });
}

/** 최종 완료 (요청자/컴포지터급). */
export async function finalResolveRevision(rev: CompRevision, byName: string): Promise<void> {
  const now = new Date().toISOString();
  await persistRevisionWorkflow(rev,
    { finalResolvedAt: now, finalResolvedBy: byName, status: 'resolved', updatedAt: now },
    { finalResolvedAt: now, finalResolvedBy: byName, status: 'resolved', updatedAt: now });
}

/** 최종 완료 되돌리기. */
export async function revertFinalResolve(rev: CompRevision): Promise<void> {
  const now = new Date().toISOString();
  const status = deriveRevisionStatus(rev.assigneeIds ?? [], rev.assigneeStates ?? {}, null);
  await persistRevisionWorkflow(rev,
    { finalResolvedAt: '', finalResolvedBy: '', status, updatedAt: now },
    { finalResolvedAt: undefined, finalResolvedBy: '', status, updatedAt: now });
}

/** 담당자 본인 완료 되돌리기 (done → in_progress). 최종완료 상태면 차단. */
export async function revertAssigneeWork(rev: CompRevision, userId: string): Promise<void> {
  if (rev.finalResolvedAt) {
    throw new Error('최종 완료된 리테이크는 먼저 최종 완료를 되돌려야 합니다.');
  }
  const now = new Date().toISOString();
  const states = revertAssignee(rev.assigneeStates ?? {}, userId);
  const status = deriveRevisionStatus(rev.assigneeIds ?? [], states, rev.finalResolvedAt);
  await persistRevisionWorkflow(rev,
    { assigneeStates: JSON.stringify(states), status, updatedAt: now },
    { assigneeStates: states, status, updatedAt: now });
}

/**
 * 리테이크 삭제 — Supabase 모드에서는 Storage 이미지도 함께 정리 (서버 측),
 * 로컬 모드에서는 단순히 로컬 파일에서만 제거.
 */
export async function deleteRevision(id: string, sceneKey: string): Promise<void> {
  const lookupSceneKeys = getRevisionLookupSceneKeys(sceneKey);

  if (sheetsMode) {
    await window.electronAPI.supabaseDeleteRevision(id);
    if (sheetsCache) {
      for (const lookupSceneKey of lookupSceneKeys) {
        const list = sheetsCache[lookupSceneKey];
        if (!list) continue;
        const idx = list.findIndex((r) => r.id === id);
        if (idx >= 0) { list.splice(idx, 1); break; }
      }
    }
    return;
  }

  // 로컬 모드
  const all = await loadLocalAll();
  for (const lookupSceneKey of lookupSceneKeys) {
    const list = all[lookupSceneKey];
    if (!list) continue;
    const idx = list.findIndex((r) => r.id === id);
    if (idx >= 0) { list.splice(idx, 1); break; }
  }
  await saveLocal(all);
}

/**
 * 씬별 오픈 리테이크 수 계산 (뱃지용)
 */
export async function getOpenRevisionCounts(): Promise<Record<string, number>> {
  let store: RevisionsStore;
  if (sheetsMode) {
    store = await loadAllRevisions();
  } else {
    store = await loadLocalAll();
  }

  return buildOpenRevisionCountMap(Object.values(store).flat());
}

/**
 * sheetName + sceneId → sceneKey 변환 헬퍼
 * 시트이름 형식: EP01_A_BG → EP01:A
 */
export function buildSceneKey(
  sheetName: string,
  sceneId: string,
  options: RevisionSceneKeyOptions = {},
): string {
  const fallbackSiblingSceneIds = getSiblingSceneIdsForSheetScene(sheetName, sceneId) ?? [];
  const siblingSceneIds = Array.from(new Set([
    ...(options.siblingSceneIds ?? []),
    ...fallbackSiblingSceneIds,
  ]));

  return buildUnifiedRevisionSceneKey(sheetName, sceneId, {
    ...options,
    siblingSceneIds,
  });
}
