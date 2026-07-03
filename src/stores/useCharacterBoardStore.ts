/**
 * 캐릭터 현황판 store.
 *
 * - characters: 전역 캐릭터 (episodeIds 조립 완료 상태)
 * - costumes: 모든 복장 (캐릭터 무관 평면 배열)
 * - byCharacter: characterId → 복장 배열 (파생, load/머지 시 재계산)
 *
 * 모든 변경은 컴포지팅 대시보드(useCompositingDashboardStore)와 동일하게
 *   낙관적 업데이트 → IPC 동기화 → 실패 시 롤백 패턴.
 * Realtime 수신(세 테이블)은 receiveRealtime 로 머지.
 *
 * 데이터를 useDataStore 에 두지 않고 피처 전용 store 로 자급 — 컴포지팅 store 패턴 미러링.
 */

import { create } from 'zustand';
import type {
  Character, CharacterCostume, EpisodeCharacterLink, CostumeActivityLogContext,
} from '@/types';
import {
  loadCharacters as svcLoadCharacters,
  loadCharacterCostumes as svcLoadCostumes,
  loadEpisodeCharacterMap as svcLoadMap,
  addCharacter as svcAddCharacter,
  updateCharacter as svcUpdateCharacter,
  deleteCharacter as svcDeleteCharacter,
  addCharacterCostume as svcAddCostume,
  updateCharacterCostume as svcUpdateCostume,
  deleteCharacterCostume as svcDeleteCostume,
  linkCharacterEpisode as svcLinkEpisode,
  unlinkCharacterEpisode as svcUnlinkEpisode,
  updateEpisodeCharacterMapping as svcUpdateEpisodeMapping,
  rowToCharacter,
  rowToCostume,
  subscribeCharacterBoardRealtime,
} from '@/services/supabaseService';
import { useAuthStore } from '@/stores/useAuthStore';
import { toast } from 'sonner';

/** 단계 값 → 활동 피드에 표시할 사람이 읽는 단계 이름. */
const DESIGN_STAGE_LABEL: Record<CharacterCostume['designStage'], string> = {
  waiting: '대기',
  in_progress: '진행 중',
  feedback: '피드백',
  done: '완료',
};
const RIGGING_STAGE_LABEL: Record<CharacterCostume['riggingStage'], string> = {
  waiting: '대기',
  vectorized: '벡터화',
  rigging: '리깅',
  feedback: '피드백',
  done: '완성',
};

type PendingLocalField = { value: unknown; expiresAt: number };
const PENDING_LOCAL_FIELD_MS = 15_000;
const pendingCharacterFields = new Map<string, Map<string, PendingLocalField>>();
const pendingCostumeFields = new Map<string, Map<string, PendingLocalField>>();
const pendingEpisodeLinkFields = new Map<string, Map<string, PendingLocalField>>();

function buildByCharacter(costumes: CharacterCostume[]): Map<string, CharacterCostume[]> {
  const map = new Map<string, CharacterCostume[]>();
  for (const c of costumes) {
    const arr = map.get(c.characterId);
    if (arr) arr.push(c);
    else map.set(c.characterId, [c]);
  }
  for (const arr of map.values()) {
    arr.sort(compareCostumes);
  }
  return map;
}

function compareNullableText(a: string | null | undefined, b: string | null | undefined): number {
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function compareCharacters(a: Character, b: Character): number {
  return a.sortOrder - b.sortOrder
    || compareNullableText(a.createdAt, b.createdAt)
    || compareNullableText(a.name, b.name)
    || compareNullableText(a.id, b.id);
}

function compareCostumes(a: CharacterCostume, b: CharacterCostume): number {
  return a.sortOrder - b.sortOrder
    || compareNullableText(a.createdAt, b.createdAt)
    || compareNullableText(a.name, b.name)
    || compareNullableText(a.id, b.id);
}

function sortCharacters(characters: Character[]): Character[] {
  return characters.slice().sort(compareCharacters);
}

function sortCostumes(costumes: CharacterCostume[]): CharacterCostume[] {
  return costumes.slice().sort(compareCostumes);
}

type RawMapping = {
  characterId: string;
  episodeNumber: number;
  memo: string | null;
  costumeId: string | null;
};

/** 매핑 목록 → characterId → EpisodeCharacterLink[] (episodeNumber 오름차순). */
function buildEpisodeLinks(mappings: RawMapping[]): Map<string, EpisodeCharacterLink[]> {
  const map = new Map<string, EpisodeCharacterLink[]>();
  for (const m of mappings) {
    const link: EpisodeCharacterLink = {
      episodeNumber: m.episodeNumber,
      memo: m.memo ?? null,
      costumeId: m.costumeId ?? null,
    };
    const arr = map.get(m.characterId);
    if (arr) arr.push(link);
    else map.set(m.characterId, [link]);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.episodeNumber - b.episodeNumber);
  }
  return map;
}

function rowToRealtimeMapping(row: any | null): RawMapping | null {
  if (!row || typeof row !== 'object') return null;
  const characterId = typeof row.character_id === 'string' ? row.character_id : null;
  const episodeNumber = typeof row.episode_number === 'number' ? row.episode_number : null;
  if (!characterId || episodeNumber == null) return null;
  return {
    characterId,
    episodeNumber,
    memo: typeof row.memo === 'string' ? row.memo : null,
    costumeId: typeof row.costume_id === 'string' ? row.costume_id : null,
  };
}

function pendingLinkKey(characterId: string, episodeNumber: number): string {
  return `${characterId}:${episodeNumber}`;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function cleanupPending(bucket: Map<string, Map<string, PendingLocalField>>, id: string) {
  const fields = bucket.get(id);
  if (!fields) return;
  const now = Date.now();
  for (const [field, pending] of fields) {
    if (pending.expiresAt <= now) fields.delete(field);
  }
  if (fields.size === 0) bucket.delete(id);
}

function trackPendingFields(
  bucket: Map<string, Map<string, PendingLocalField>>,
  id: string,
  updates: Record<string, unknown>,
) {
  cleanupPending(bucket, id);
  let fields = bucket.get(id);
  if (!fields) {
    fields = new Map();
    bucket.set(id, fields);
  }
  const expiresAt = Date.now() + PENDING_LOCAL_FIELD_MS;
  for (const [field, value] of Object.entries(updates)) {
    fields.set(field, { value, expiresAt });
  }
}

function mergeIncomingWithPending<T extends { id: string; updatedAt?: string | null }>(
  bucket: Map<string, Map<string, PendingLocalField>>,
  existing: T | undefined,
  incoming: T,
): T {
  if (existing && incoming.updatedAt && existing.updatedAt && Date.parse(incoming.updatedAt) < Date.parse(existing.updatedAt)) {
    return existing;
  }

  cleanupPending(bucket, incoming.id);
  const fields = bucket.get(incoming.id);
  if (!existing || !fields) return incoming;

  const merged = { ...incoming } as Record<string, unknown>;
  const existingRecord = existing as unknown as Record<string, unknown>;
  const incomingRecord = incoming as unknown as Record<string, unknown>;
  for (const [field, pending] of fields) {
    if (valuesEqual(incomingRecord[field], pending.value)) {
      fields.delete(field);
    } else if (valuesEqual(existingRecord[field], pending.value)) {
      merged[field] = existingRecord[field];
    }
  }
  if (fields.size === 0) bucket.delete(incoming.id);
  return merged as T;
}

function trackPendingEpisodeLinkField<K extends 'memo' | 'costumeId'>(
  characterId: string,
  episodeNumber: number,
  field: K,
  value: EpisodeCharacterLink[K],
) {
  trackPendingFields(pendingEpisodeLinkFields, pendingLinkKey(characterId, episodeNumber), { [field]: value });
}

function mergeEpisodeLinkPatchWithPending(
  links: Map<string, EpisodeCharacterLink[]>,
  characterId: string,
  episodeNumber: number,
  patch: Partial<Pick<EpisodeCharacterLink, 'memo' | 'costumeId'>>,
): Partial<Pick<EpisodeCharacterLink, 'memo' | 'costumeId'>> {
  const key = pendingLinkKey(characterId, episodeNumber);
  cleanupPending(pendingEpisodeLinkFields, key);
  const fields = pendingEpisodeLinkFields.get(key);
  if (!fields) return patch;

  const current = links.get(characterId)?.find((link) => link.episodeNumber === episodeNumber) ?? null;
  if (!current) return patch;

  const merged = { ...patch } as Record<string, unknown>;
  for (const [field, pending] of fields) {
    const incoming = merged[field];
    if (valuesEqual(incoming, pending.value)) {
      fields.delete(field);
    } else if (valuesEqual((current as unknown as Record<string, unknown>)[field], pending.value)) {
      merged[field] = (current as unknown as Record<string, unknown>)[field];
    }
  }
  if (fields.size === 0) pendingEpisodeLinkFields.delete(key);
  return merged as Partial<Pick<EpisodeCharacterLink, 'memo' | 'costumeId'>>;
}

interface CharacterBoardStore {
  characters: Character[];
  costumes: CharacterCostume[];
  byCharacter: Map<string, CharacterCostume[]>;
  /** characterId → 이 캐릭터의 에피소드 연결 상세(메모/복장). episodeIds 와 병렬 유지. */
  episodeLinks: Map<string, EpisodeCharacterLink[]>;
  loaded: boolean;
  loading: boolean;
  /** 초기 로드 실패 — UI 가 무한 스피너 대신 에러+재시도를 보이도록. */
  loadError: boolean;

  load: (opts?: { silent?: boolean }) => Promise<void>;
  startRealtime: () => () => void;
  ensureLoadedAndRealtime: (opts?: { silent?: boolean }) => () => void;

  addCharacter: (name: string, memo?: string) => Promise<Character | null>;
  updateCharacterFolder: (id: string, workFolderPath: string | null) => Promise<boolean>;
  archiveCharacter: (id: string) => Promise<void>;
  restoreCharacter: (id: string) => Promise<void>;
  renameCharacter: (id: string, name: string) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;

  addCostume: (characterId: string, name: string) => Promise<CharacterCostume | null>;
  /** 디자인/리깅 단계 토글 — 단일 update. */
  updateCostumeStage: (
    id: string,
    stage: 'design' | 'rigging',
    value: CharacterCostume['designStage'] | CharacterCostume['riggingStage'],
  ) => Promise<void>;
  /** 임의 필드 부분 업데이트 — 여러 컬럼 한 번에 (split-state 금지). */
  updateCostumeField: (
    id: string,
    updates: Partial<Pick<CharacterCostume,
      | 'name'
      | 'versionNo'
      | 'featuredImageUrl'
      | 'workFilePath'
      | 'imageBackground'
      | 'imageFit'
      | 'assignee'
      | 'designAssignee'
      | 'riggingAssignee'
      | 'memo'>>,
  ) => Promise<boolean>;
  setCostumeTags: (id: string, kind: 'structure' | 'asset', tags: string[]) => Promise<void>;
  setVersion: (id: string, versionNo: number) => Promise<void>;
  deleteCostume: (id: string) => Promise<void>;

  linkEpisode: (characterId: string, episodeNumber: number) => Promise<void>;
  unlinkEpisode: (characterId: string, episodeNumber: number) => Promise<void>;
  /** 이 편 주의점 메모 — 낙관적 업데이트. */
  setEpisodeMemo: (characterId: string, episodeNumber: number, memo: string) => Promise<void>;
  /** 이 편에 쓰는 복장 선택/해제 — 낙관적 업데이트. */
  setEpisodeCostume: (characterId: string, episodeNumber: number, costumeId: string | null) => Promise<void>;

  receiveRealtime: (payload: {
    table: 'characters' | 'character_costumes' | 'episode_character_mapping';
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    row: any | null;
    old: any | null;
  }) => void;
}

let characterBoardRealtimeRefCount = 0;
let stopCharacterBoardRealtime: (() => void) | null = null;

export const useCharacterBoardStore = create<CharacterBoardStore>((set, get) => ({
  characters: [],
  costumes: [],
  byCharacter: new Map(),
  episodeLinks: new Map(),
  loaded: false,
  loading: false,
  loadError: false,

  load: async (opts) => {
    if (get().loading) return;
    set({ loading: true, loadError: false });
    try {
      const [characters, costumes, mappings] = await Promise.all([
        svcLoadCharacters(),
        svcLoadCostumes(),
        svcLoadMap(),
      ]);
      // episodeIds 조립
      const epByChar = new Map<string, number[]>();
      for (const m of mappings) {
        const arr = epByChar.get(m.characterId);
        if (arr) arr.push(m.episodeNumber);
        else epByChar.set(m.characterId, [m.episodeNumber]);
      }
      // catch-up reload가 in-flight 낙관 쓰기를 되돌리지 않도록, realtime 머지와 동일하게
      // pending 필드 보호를 거쳐 반영한다 (15초 TTL — applyCharacterUpdate/applyCostumeUpdate가 추적).
      const prev = get();
      const prevCharacterById = new Map(prev.characters.map((c) => [c.id, c]));
      const prevCostumeById = new Map(prev.costumes.map((c) => [c.id, c]));
      const assembled = sortCharacters(characters.map((c) => {
        const withEpisodes = {
          ...c,
          episodeIds: (epByChar.get(c.id) ?? []).slice().sort((a, b) => a - b),
        };
        const merged = mergeIncomingWithPending(pendingCharacterFields, prevCharacterById.get(c.id), withEpisodes);
        // characters.updated_at 과 별개로 매핑 테이블에서 재조립한 episodeIds 는 항상 최신 load 결과를 쓴다.
        return { ...merged, episodeIds: withEpisodes.episodeIds };
      }));
      const sortedCostumes = sortCostumes(costumes.map((c) =>
        mergeIncomingWithPending(pendingCostumeFields, prevCostumeById.get(c.id), c)));
      const freshLinks = buildEpisodeLinks(mappings);
      for (const [characterId, links] of freshLinks) {
        for (let i = 0; i < links.length; i++) {
          const link = links[i];
          const patched = mergeEpisodeLinkPatchWithPending(prev.episodeLinks, characterId, link.episodeNumber, {
            memo: link.memo,
            costumeId: link.costumeId,
          });
          links[i] = { ...link, ...patched };
        }
      }
      set({
        characters: assembled,
        costumes: sortedCostumes,
        byCharacter: buildByCharacter(sortedCostumes),
        episodeLinks: freshLinks,
        loaded: true,
        loading: false,
        loadError: false,
      });
    } catch (err) {
      console.error('[character-board] load 실패:', err);
      set({ loading: false, loadError: true });
      if (!opts?.silent) toast.error('캐릭터 현황판을 불러오지 못했어요');
    }
  },

  startRealtime: () => {
    const stopRows = subscribeCharacterBoardRealtime((payload) => {
      get().receiveRealtime(payload);
    });
    const catchUp = () => {
      // loadError 포함 — 위젯의 silent 초기 로드가 실패한 채 방치되지 않도록 재연결/온라인 복귀 시 재시도.
      const s = get();
      if (!s.loading && (s.loaded || s.loadError)) void s.load({ silent: true });
    };
    const stopStatus = window.electronAPI?.onSupabaseStatus?.((status) => {
      if (status === 'SUBSCRIBED') catchUp();
    });
    // character_board 채널 자체의 재합류 — 이 채널만 단독으로 끊겼다 붙는 경우를 커버 (GAP-B).
    const stopChannelStatus = window.electronAPI?.onCharacterBoardRealtimeStatus?.((status) => {
      if (status === 'SUBSCRIBED') catchUp();
    });
    window.addEventListener('online', catchUp);
    return () => {
      stopRows();
      stopStatus?.();
      stopChannelStatus?.();
      window.removeEventListener('online', catchUp);
    };
  },

  ensureLoadedAndRealtime: (opts) => {
    const state = get();
    if (!state.loaded && !state.loading) {
      void state.load(opts);
    } else if (characterBoardRealtimeRefCount === 0 && state.loaded && !state.loading) {
      // Realtime 미구독 구간(스포트라이트 선로드 등)에 쌓인 다른 사용자 변경 회수 —
      // 이미 로드된 데이터로 구독을 새로 시작할 때 한 번 조용히 최신화한다.
      void state.load({ silent: true });
    }
    if (characterBoardRealtimeRefCount === 0) {
      stopCharacterBoardRealtime = state.startRealtime();
    }
    characterBoardRealtimeRefCount++;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      characterBoardRealtimeRefCount = Math.max(0, characterBoardRealtimeRefCount - 1);
      if (characterBoardRealtimeRefCount === 0) {
        stopCharacterBoardRealtime?.();
        stopCharacterBoardRealtime = null;
      }
    };
  },

  // ─── 캐릭터 ───

  addCharacter: async (name, memo) => {
    const createdBy = useAuthStore.getState().currentUser?.id ?? null;
    try {
      const created = await svcAddCharacter({ name, memo: memo ?? null, createdBy });
      // 서버 결과(정확한 id/sortOrder)로 머지 — realtime 도착 전 즉시 반영.
      set((s) => {
        if (s.characters.some((c) => c.id === created.id)) return s;
        return { characters: sortCharacters([...s.characters, { ...created, episodeIds: [] }]) };
      });
      try {
        const firstCostume = await svcAddCostume({ characterId: created.id, name: '복장 1', createdBy });
        set((s) => {
          if (s.costumes.some((c) => c.id === firstCostume.id)) return s;
          const costumes = sortCostumes([...s.costumes, firstCostume]);
          return { costumes, byCharacter: buildByCharacter(costumes) };
        });
      } catch (costumeErr) {
        console.warn('[character-board] 첫 복장 자동 생성 실패:', costumeErr);
      }
      return created;
    } catch (err) {
      console.error('[character-board] addCharacter 실패:', err);
      toast.error('캐릭터 추가에 실패했어요');
      return null;
    }
  },

  updateCharacterFolder: async (id, workFolderPath) => {
    return applyCharacterUpdate(set, get, id, { workFolderPath }, { work_folder_path: workFolderPath }, '작업 폴더 저장에 실패했어요');
  },

  renameCharacter: async (id, name) => {
    await applyCharacterUpdate(set, get, id, { name }, { name }, '이름 변경에 실패했어요');
  },

  archiveCharacter: async (id) => {
    const saved = await applyCharacterUpdate(set, get, id, { status: 'archived' }, { status: 'archived' }, '캐릭터 보관에 실패했어요');
    if (saved) {
      toast.success('캐릭터를 보관했어요');
    }
  },

  restoreCharacter: async (id) => {
    const saved = await applyCharacterUpdate(set, get, id, { status: 'active' }, { status: 'active' }, '캐릭터 복원에 실패했어요');
    if (saved) {
      toast.success('캐릭터를 복원했어요');
    }
  },

  deleteCharacter: async (id) => {
    const prevChars = get().characters;
    const prevCostumes = get().costumes;
    const prevLinks = get().episodeLinks;
    const removedCharacter = prevChars.find((c) => c.id === id) ?? null;
    const removedCostumes = prevCostumes.filter((c) => c.characterId === id);
    const removedLinks = prevLinks.get(id)?.slice() ?? null;
    const nextCostumes = prevCostumes.filter((c) => c.characterId !== id);
    const nextLinks = new Map(prevLinks); nextLinks.delete(id);
    set({
      characters: prevChars.filter((c) => c.id !== id),
      costumes: nextCostumes,
      byCharacter: buildByCharacter(nextCostumes),
      episodeLinks: nextLinks,
    });
    try {
      await svcDeleteCharacter(id);
    } catch (err) {
      console.error('[character-board] deleteCharacter 실패:', err);
      set((s) => {
        const characters = removedCharacter && !s.characters.some((c) => c.id === id)
          ? sortCharacters([...s.characters, removedCharacter])
          : s.characters;
        const existingCostumeIds = new Set(s.costumes.map((c) => c.id));
        const missingCostumes = removedCostumes.filter((c) => !existingCostumeIds.has(c.id));
        const costumes = missingCostumes.length > 0
          ? sortCostumes([...s.costumes, ...missingCostumes])
          : s.costumes;
        const episodeLinks = new Map(s.episodeLinks);
        if (removedLinks && !episodeLinks.has(id)) episodeLinks.set(id, removedLinks);
        return {
          characters,
          costumes,
          byCharacter: buildByCharacter(costumes),
          episodeLinks,
        };
      });
      toast.error('캐릭터 삭제에 실패했어요');
    }
  },

  // ─── 복장 ───

  addCostume: async (characterId, name) => {
    const createdBy = useAuthStore.getState().currentUser?.id ?? null;
    try {
      const created = await svcAddCostume({ characterId, name, createdBy });
      set((s) => {
        if (s.costumes.some((c) => c.id === created.id)) return s;
        const costumes = sortCostumes([...s.costumes, created]);
        return { costumes, byCharacter: buildByCharacter(costumes) };
      });
      return created;
    } catch (err) {
      console.error('[character-board] addCostume 실패:', err);
      toast.error('복장 추가에 실패했어요');
      return null;
    }
  },

  updateCostumeStage: async (id, stage, value) => {
    const costume = get().costumes.find((c) => c.id === id);
    // 이미 같은 단계를 다시 누르면 no-op — 불필요한 쓰기·중복 활동 로그(특히 리깅 '완성' 재클릭) 방지.
    if (costume && (stage === 'design' ? costume.designStage : costume.riggingStage) === value) return;
    const updates = stage === 'design'
      ? { designStage: value as CharacterCostume['designStage'] }
      : { riggingStage: value as CharacterCostume['riggingStage'] };
    // 활동 피드 표시용 컨텍스트 조립 — 캐릭터명·복장명은 store 에서 바로 얻는다(추가 DB 조회 불필요).
    //   "누가" 변경했는지는 메인 세션 사용자에서 가져오므로 여기 신원은 담지 않는다.
    let logContext: CostumeActivityLogContext | undefined;
    if (costume) {
      const characterName = get().characters.find((ch) => ch.id === costume.characterId)?.name ?? '캐릭터';
      const stageLabel = stage === 'design'
        ? DESIGN_STAGE_LABEL[value as CharacterCostume['designStage']] ?? String(value)
        : RIGGING_STAGE_LABEL[value as CharacterCostume['riggingStage']] ?? String(value);
      logContext = {
        characterId: costume.characterId,
        characterName,
        costumeName: costume.name,
        kind: stage,
        stage: String(value),
        stageLabel,
      };
    }
    await applyCostumeUpdate(set, get, id, updates, '단계 변경에 실패했어요', logContext);
  },

  updateCostumeField: async (id, updates) => applyCostumeUpdate(set, get, id, updates, '저장에 실패했어요'),

  setCostumeTags: async (id, kind, tags) => {
    const updates = kind === 'structure' ? { structureTags: tags } : { assetTags: tags };
    await applyCostumeUpdate(set, get, id, updates, '태그 저장에 실패했어요');
  },

  setVersion: async (id, versionNo) => {
    await applyCostumeUpdate(set, get, id, { versionNo }, '버전 변경에 실패했어요');
  },

  deleteCostume: async (id) => {
    const prev = get().costumes;
    const removed = prev.find((c) => c.id === id) ?? null;
    const next = prev.filter((c) => c.id !== id);
    set({ costumes: next, byCharacter: buildByCharacter(next) });
    try {
      await svcDeleteCostume(id);
    } catch (err) {
      console.error('[character-board] deleteCostume 실패:', err);
      set((s) => {
        if (!removed || s.costumes.some((c) => c.id === id)) return s;
        const costumes = sortCostumes([...s.costumes, removed]);
        return { costumes, byCharacter: buildByCharacter(costumes) };
      });
      toast.error('복장 삭제에 실패했어요');
    }
  },

  // ─── 에피소드 매핑 ───

  linkEpisode: async (characterId, episodeNumber) => {
    set({
      characters: setCharacterEpisodePresence(get().characters, characterId, episodeNumber, true),
      episodeLinks: upsertLink(get().episodeLinks, characterId, episodeNumber, {}),
    });
    try {
      await svcLinkEpisode(episodeNumber, characterId, useAuthStore.getState().currentUser?.id ?? null);
    } catch (err) {
      console.error('[character-board] linkEpisode 실패:', err);
      set((s) => {
        const currentLink = s.episodeLinks.get(characterId)?.find((l) => l.episodeNumber === episodeNumber);
        const shouldRemove = !currentLink || (!currentLink.memo && !currentLink.costumeId);
        return {
          characters: shouldRemove ? setCharacterEpisodePresence(s.characters, characterId, episodeNumber, false) : s.characters,
          episodeLinks: shouldRemove ? removeLink(s.episodeLinks, characterId, episodeNumber) : s.episodeLinks,
        };
      });
      toast.error('에피소드 연결에 실패했어요');
    }
  },

  unlinkEpisode: async (characterId, episodeNumber) => {
    const previousLink = get().episodeLinks.get(characterId)?.find((l) => l.episodeNumber === episodeNumber) ?? null;
    set({
      characters: setCharacterEpisodePresence(get().characters, characterId, episodeNumber, false),
      episodeLinks: removeLink(get().episodeLinks, characterId, episodeNumber),
    });
    try {
      await svcUnlinkEpisode(episodeNumber, characterId);
    } catch (err) {
      console.error('[character-board] unlinkEpisode 실패:', err);
      set((s) => ({
        characters: setCharacterEpisodePresence(s.characters, characterId, episodeNumber, true),
        episodeLinks: upsertLink(s.episodeLinks, characterId, episodeNumber, {
          memo: previousLink?.memo ?? null,
          costumeId: previousLink?.costumeId ?? null,
        }),
      }));
      toast.error('에피소드 연결 해제에 실패했어요');
    }
  },

  setEpisodeMemo: async (characterId, episodeNumber, memo) => {
    const previousLink = get().episodeLinks.get(characterId)?.find((l) => l.episodeNumber === episodeNumber) ?? null;
    trackPendingEpisodeLinkField(characterId, episodeNumber, 'memo', memo);
    set({ episodeLinks: upsertLink(get().episodeLinks, characterId, episodeNumber, { memo }) });
    try {
      await svcUpdateEpisodeMapping(episodeNumber, characterId, { memo });
    } catch (err) {
      console.error('[character-board] setEpisodeMemo 실패:', err);
      set((s) => ({
        episodeLinks: revertLinkFieldIfUnchanged(s.episodeLinks, characterId, episodeNumber, 'memo', memo, previousLink),
      }));
      toast.error('이 편 메모 저장에 실패했어요');
    }
  },

  setEpisodeCostume: async (characterId, episodeNumber, costumeId) => {
    const previousLink = get().episodeLinks.get(characterId)?.find((l) => l.episodeNumber === episodeNumber) ?? null;
    trackPendingEpisodeLinkField(characterId, episodeNumber, 'costumeId', costumeId);
    set({ episodeLinks: upsertLink(get().episodeLinks, characterId, episodeNumber, { costumeId }) });
    try {
      await svcUpdateEpisodeMapping(episodeNumber, characterId, { costumeId });
    } catch (err) {
      console.error('[character-board] setEpisodeCostume 실패:', err);
      set((s) => ({
        episodeLinks: revertLinkFieldIfUnchanged(s.episodeLinks, characterId, episodeNumber, 'costumeId', costumeId, previousLink),
      }));
      toast.error('이 편 복장 선택에 실패했어요');
    }
  },

  // ─── Realtime 머지 ───

  receiveRealtime: (payload) => {
    const { table, eventType, row, old } = payload;
    if (table === 'characters') {
      if (eventType === 'DELETE') {
        const id = old?.id;
        if (!id) return;
        set((s) => {
          const costumes = s.costumes.filter((c) => c.characterId !== id);
          const episodeLinks = new Map(s.episodeLinks); episodeLinks.delete(id);
          return {
            characters: s.characters.filter((c) => c.id !== id),
            costumes,
            byCharacter: buildByCharacter(costumes),
            episodeLinks,
          };
        });
        return;
      }
      if (!row) return;
      const incoming = rowToCharacter(row);
      set((s) => {
        const existing = s.characters.find((c) => c.id === incoming.id);
        // episodeIds 는 매핑 테이블 소관 — 기존 값 보존. 신규 캐릭터인데 매핑이 먼저 도착했으면 episodeLinks 에서 파생.
        const linkEpisodeIds = (s.episodeLinks.get(incoming.id) ?? [])
          .map((l) => l.episodeNumber)
          .sort((a, b) => a - b);
        const merged = mergeIncomingWithPending(
          pendingCharacterFields,
          existing,
          { ...incoming, episodeIds: existing?.episodeIds ?? linkEpisodeIds },
        );
        return {
          characters: existing
            ? sortCharacters(s.characters.map((c) => (c.id === incoming.id ? merged : c)))
            : sortCharacters([...s.characters, merged]),
        };
      });
      return;
    }

    if (table === 'character_costumes') {
      if (eventType === 'DELETE') {
        const id = old?.id;
        if (!id) return;
        set((s) => {
          const costumes = s.costumes.filter((c) => c.id !== id);
          return { costumes, byCharacter: buildByCharacter(costumes) };
        });
        return;
      }
      if (!row) return;
      const incoming = rowToCostume(row);
      set((s) => {
        const existing = s.costumes.find((c) => c.id === incoming.id);
        const merged = mergeIncomingWithPending(pendingCostumeFields, existing, incoming);
        const exists = !!existing;
        const costumes = exists
          ? sortCostumes(s.costumes.map((c) => (c.id === incoming.id ? merged : c)))
          : sortCostumes([...s.costumes, merged]);
        return { costumes, byCharacter: buildByCharacter(costumes) };
      });
      return;
    }

    if (table === 'episode_character_mapping') {
      const mapping = rowToRealtimeMapping(eventType === 'DELETE' ? old : row);
      if (!mapping) {
        void reloadEpisodeMappings(set, get);
        return;
      }
      if (eventType === 'DELETE') {
        set((s) => ({
          characters: setCharacterEpisodePresence(s.characters, mapping.characterId, mapping.episodeNumber, false),
          episodeLinks: removeLink(s.episodeLinks, mapping.characterId, mapping.episodeNumber),
        }));
        return;
      }
      set((s) => ({
        characters: setCharacterEpisodePresence(s.characters, mapping.characterId, mapping.episodeNumber, true),
        episodeLinks: upsertLink(
          s.episodeLinks,
          mapping.characterId,
          mapping.episodeNumber,
          mergeEpisodeLinkPatchWithPending(s.episodeLinks, mapping.characterId, mapping.episodeNumber, {
            memo: mapping.memo,
            costumeId: mapping.costumeId,
          }),
        ),
      }));
    }
  },
}));

/** episodeLinks 맵에 (characterId, episodeNumber) 링크를 upsert (필드 부분 갱신). 새 Map 반환(불변). */
function upsertLink(
  links: Map<string, EpisodeCharacterLink[]>,
  characterId: string,
  episodeNumber: number,
  patch: Partial<Pick<EpisodeCharacterLink, 'memo' | 'costumeId'>>,
): Map<string, EpisodeCharacterLink[]> {
  const next = new Map(links);
  const arr = (next.get(characterId) ?? []).slice();
  const idx = arr.findIndex((l) => l.episodeNumber === episodeNumber);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...patch };
  } else {
    arr.push({ episodeNumber, memo: patch.memo ?? null, costumeId: patch.costumeId ?? null });
    arr.sort((a, b) => a.episodeNumber - b.episodeNumber);
  }
  next.set(characterId, arr);
  return next;
}

/** episodeLinks 맵에서 (characterId, episodeNumber) 링크 제거. 새 Map 반환(불변). */
function removeLink(
  links: Map<string, EpisodeCharacterLink[]>,
  characterId: string,
  episodeNumber: number,
): Map<string, EpisodeCharacterLink[]> {
  const next = new Map(links);
  const arr = (next.get(characterId) ?? []).filter((l) => l.episodeNumber !== episodeNumber);
  if (arr.length > 0) next.set(characterId, arr);
  else next.delete(characterId);
  return next;
}

function setCharacterEpisodePresence(
  characters: Character[],
  characterId: string,
  episodeNumber: number,
  present: boolean,
): Character[] {
  return characters.map((c) => {
    if (c.id !== characterId) return c;
    const hasEpisode = c.episodeIds.includes(episodeNumber);
    if (present) {
      if (hasEpisode) return c;
      return { ...c, episodeIds: [...c.episodeIds, episodeNumber].sort((a, b) => a - b) };
    }
    if (!hasEpisode) return c;
    return { ...c, episodeIds: c.episodeIds.filter((e) => e !== episodeNumber) };
  });
}

function revertLinkFieldIfUnchanged<K extends 'memo' | 'costumeId'>(
  links: Map<string, EpisodeCharacterLink[]>,
  characterId: string,
  episodeNumber: number,
  field: K,
  optimisticValue: EpisodeCharacterLink[K],
  previousLink: EpisodeCharacterLink | null,
): Map<string, EpisodeCharacterLink[]> {
  const arr = links.get(characterId);
  if (!arr) return links;
  const idx = arr.findIndex((l) => l.episodeNumber === episodeNumber);
  if (idx < 0 || arr[idx][field] !== optimisticValue) return links;

  const restored = {
    ...arr[idx],
    [field]: previousLink ? previousLink[field] : null,
  };
  if (!previousLink && !restored.memo && !restored.costumeId) {
    return removeLink(links, characterId, episodeNumber);
  }

  const next = new Map(links);
  const nextArr = arr.slice();
  nextArr[idx] = restored;
  next.set(characterId, nextArr);
  return next;
}

/** 캐릭터 부분 업데이트 공통 헬퍼 — 낙관적 반영 후 단일 update, 실패 시 필드 단위 롤백. */
async function applyCharacterUpdate(
  set: (partial: Partial<CharacterBoardStore>) => void,
  get: () => CharacterBoardStore,
  id: string,
  updates: Partial<Character>,
  dbUpdates: Record<string, unknown>,
  errorMsg: string,
): Promise<boolean> {
  const prev = get().characters;
  const prevCharacter = prev.find((c) => c.id === id);
  trackPendingFields(pendingCharacterFields, id, updates as Record<string, unknown>);
  set({ characters: prev.map((c) => (c.id === id ? { ...c, ...updates } : c)) });
  try {
    await svcUpdateCharacter(id, dbUpdates);
    return true;
  } catch (err) {
    console.error('[character-board] updateCharacter 실패:', err);
    if (prevCharacter) {
      const cur = get().characters;
      const updRec = updates as Record<string, unknown>;
      const prevRec = prevCharacter as unknown as Record<string, unknown>;
      const reverted = cur.map((c) => {
        if (c.id !== id) return c;
        const curRec = c as unknown as Record<string, unknown>;
        const restored: Record<string, unknown> = { ...curRec };
        for (const k of Object.keys(updates)) {
          if (curRec[k] === updRec[k]) restored[k] = prevRec[k];
        }
        return restored as unknown as Character;
      });
      set({ characters: reverted });
    }
    toast.error(errorMsg);
    return false;
  }
}

/** 복장 부분 업데이트 공통 헬퍼 — 낙관적 반영 후 단일 update, 실패 시 롤백. */
async function applyCostumeUpdate(
  set: (partial: Partial<CharacterBoardStore>) => void,
  get: () => CharacterBoardStore,
  id: string,
  updates: Partial<CharacterCostume>,
  errorMsg: string,
  /** 단계 변경일 때만 — 메인이 활동 피드에 기록할 표시용 컨텍스트. */
  logContext?: CostumeActivityLogContext,
): Promise<boolean> {
  const prev = get().costumes;
  const prevCostume = prev.find((c) => c.id === id);
  trackPendingFields(pendingCostumeFields, id, updates as Record<string, unknown>);
  const next = prev.map((c) => (c.id === id ? { ...c, ...updates } : c));
  set({ costumes: next, byCharacter: buildByCharacter(next) });
  try {
    await svcUpdateCostume(id, updates, logContext);
    return true;
  } catch (err) {
    console.error('[character-board] updateCostume 실패:', err);
    // 전체 스냅샷을 되돌리면 그 사이 성공한 다른 업데이트/실시간 머지를 덮어쓴다.
    //   이 업데이트가 바꾼 필드만, 그것도 아직 우리 낙관값 그대로일 때만(더 나중 편집이 없을 때) 이전 값으로 되돌린다.
    if (prevCostume) {
      const cur = get().costumes;
      const updRec = updates as unknown as Record<string, unknown>;
      const prevRec = prevCostume as unknown as Record<string, unknown>;
      const reverted = cur.map((c) => {
        if (c.id !== id) return c;
        const curRec = c as unknown as Record<string, unknown>;
        const restored: Record<string, unknown> = { ...curRec };
        for (const k of Object.keys(updates)) {
          if (curRec[k] === updRec[k]) restored[k] = prevRec[k];
        }
        return restored as unknown as CharacterCostume;
      });
      set({ costumes: reverted, byCharacter: buildByCharacter(reverted) });
    }
    toast.error(errorMsg);
    return false;
  }
}

/** 다른 사용자의 에피소드 매핑 변경 수신 시 episodeIds 만 가볍게 재조립. */
async function reloadEpisodeMappings(
  set: (partial: Partial<CharacterBoardStore>) => void,
  get: () => CharacterBoardStore,
): Promise<void> {
  try {
    const mappings = await svcLoadMap();
    const epByChar = new Map<string, number[]>();
    for (const m of mappings) {
      const arr = epByChar.get(m.characterId);
      if (arr) arr.push(m.episodeNumber);
      else epByChar.set(m.characterId, [m.episodeNumber]);
    }
    set({
      characters: get().characters.map((c) => ({
        ...c,
        episodeIds: (epByChar.get(c.id) ?? []).slice().sort((a, b) => a - b),
      })),
      episodeLinks: buildEpisodeLinks(mappings),
    });
  } catch (err) {
    console.warn('[character-board] 에피소드 매핑 재조립 실패:', err);
  }
}
