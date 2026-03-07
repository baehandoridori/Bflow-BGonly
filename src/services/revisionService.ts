/**
 * 컴포지팅 리비전 서비스
 *
 * Google Sheets _COMP_REVISIONS 탭 동기화
 * - 시트 연결 시: _COMP_REVISIONS 탭에서 전체 로딩 + 캐시
 * - 미연결 시: %APPDATA%/Bflow-BGonly/revisions.json 로컬 폴백
 *
 * sceneKey 형식: "EP01:A:a001" (에피소드:파트:씬ID — 시트명 비의존)
 */

import type { CompRevision, RevisionStatus } from '../types';

const REVISIONS_FILE = 'revisions.json';

type RevisionsStore = Record<string, CompRevision[]>; // sceneKey → revisions

// ─── 모드 관리 ──────────────────────────────────

let sheetsMode = false;

export function setRevisionsSheetsMode(enabled: boolean): void {
  sheetsMode = enabled;
  if (!enabled) sheetsCache = null;
}

// ─── 로컬 파일 ──────────────────────────────────

let localCache: RevisionsStore | null = null;

async function loadLocalAll(): Promise<RevisionsStore> {
  if (localCache) return localCache;
  try {
    const data = await window.electronAPI.readSettings(REVISIONS_FILE);
    if (data && typeof data === 'object') {
      localCache = data as RevisionsStore;
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
}): CompRevision {
  return {
    id: row.id,
    sceneKey: row.sceneKey,
    revisionNo: Number(row.revisionNo) || 0,
    status: (row.status as RevisionStatus) || 'open',
    description: row.description || '',
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
  };
}

export async function loadAllRevisions(): Promise<RevisionsStore> {
  if (sheetsCache) return sheetsCache;

  const result = await window.electronAPI.sheetsReadRevisions();
  if (!result.ok) {
    console.warn('[리비전] 시트 로드 실패:', result.error);
    return {};
  }

  const store: RevisionsStore = {};
  for (const row of result.data ?? []) {
    const rev = rowToRevision(row);
    if (!store[rev.sceneKey]) store[rev.sceneKey] = [];
    store[rev.sceneKey].push(rev);
  }

  sheetsCache = store;
  return store;
}

/** 시트 캐시 무효화 */
export function invalidateRevisionsCache(): void {
  sheetsCache = null;
}

// ─── 통합 API ───────────────────────────────────

export async function getRevisions(sceneKey: string): Promise<CompRevision[]> {
  if (sheetsMode) {
    const store = await loadAllRevisions();
    return [...(store[sceneKey] ?? [])];
  }
  const all = await loadLocalAll();
  return [...(all[sceneKey] ?? [])];
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

function nextRevisionNo(store: RevisionsStore, sceneKey: string): number {
  const existing = store[sceneKey] ?? [];
  if (existing.length === 0) return 1;
  return Math.max(...existing.map(r => r.revisionNo)) + 1;
}

export async function createRevision(
  sceneKey: string,
  data: {
    description: string;
    imageUrl?: string;
    department?: 'bg' | 'acting';
    requesterId: string;
    requesterName: string;
    assignee?: string;
  },
): Promise<CompRevision> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  if (sheetsMode) {
    const store = await loadAllRevisions();
    const revisionNo = nextRevisionNo(store, sceneKey);
    const revision: CompRevision = {
      id,
      sceneKey,
      revisionNo,
      status: 'open',
      description: data.description,
      imageUrl: data.imageUrl,
      department: data.department,
      requesterId: data.requesterId,
      requesterName: data.requesterName,
      assignee: data.assignee,
      createdAt: now,
      updatedAt: now,
    };

    await window.electronAPI.sheetsAddRevision(
      id, sceneKey, revisionNo, 'open',
      data.description, data.imageUrl || '', data.department || '',
      data.requesterId, data.requesterName, data.assignee || '', now,
    );

    // 캐시 업데이트
    if (!store[sceneKey]) store[sceneKey] = [];
    store[sceneKey].push(revision);

    return revision;
  }

  // 로컬 모드
  const all = await loadLocalAll();
  const revisionNo = nextRevisionNo(all, sceneKey);
  const revision: CompRevision = {
    id,
    sceneKey,
    revisionNo,
    status: 'open',
    description: data.description,
    imageUrl: data.imageUrl,
    department: data.department,
    requesterId: data.requesterId,
    requesterName: data.requesterName,
    assignee: data.assignee,
    createdAt: now,
    updatedAt: now,
  };

  if (!all[sceneKey]) all[sceneKey] = [];
  all[sceneKey].push(revision);
  await saveLocal(all);

  return revision;
}

export async function updateRevisionStatus(
  id: string,
  sceneKey: string,
  status: RevisionStatus,
  extra?: { resolvedBy?: string; resolvedNote?: string },
): Promise<void> {
  const now = new Date().toISOString();
  const updates: Record<string, string> = { status, updatedAt: now };
  if (status === 'resolved') {
    updates.resolvedAt = now;
    if (extra?.resolvedBy) updates.resolvedBy = extra.resolvedBy;
    if (extra?.resolvedNote) updates.resolvedNote = extra.resolvedNote;
  }

  if (sheetsMode) {
    await window.electronAPI.sheetsUpdateRevision(id, updates);
    // 캐시 업데이트
    if (sheetsCache) {
      const list = sheetsCache[sceneKey];
      if (list) {
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
        }
      }
    }
    return;
  }

  // 로컬 모드
  const all = await loadLocalAll();
  const list = all[sceneKey];
  if (!list) return;
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
  }
  await saveLocal(all);
}

/**
 * 씬별 오픈 리비전 수 계산 (뱃지용)
 */
export async function getOpenRevisionCounts(): Promise<Record<string, number>> {
  let store: RevisionsStore;
  if (sheetsMode) {
    store = await loadAllRevisions();
  } else {
    store = await loadLocalAll();
  }

  const counts: Record<string, number> = {};
  for (const [sceneKey, list] of Object.entries(store)) {
    const openCount = list.filter(r => r.status !== 'resolved').length;
    if (openCount > 0) counts[sceneKey] = openCount;
  }
  return counts;
}

/**
 * sheetName + sceneId → sceneKey 변환 헬퍼
 * 시트이름 형식: EP01_A_BG → EP01:A
 */
export function buildSceneKey(sheetName: string, sceneId: string): string {
  // EP01_A_BG → EP01, A, BG
  // EP01_A → EP01, A (legacy)
  const parts = sheetName.split('_');
  const ep = parts[0] || sheetName; // EP01
  const part = parts[1] || '';       // A
  return `${ep}:${part}:${sceneId}`;
}
