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

function buildByCharacter(costumes: CharacterCostume[]): Map<string, CharacterCostume[]> {
  const map = new Map<string, CharacterCostume[]>();
  for (const c of costumes) {
    const arr = map.get(c.characterId);
    if (arr) arr.push(c);
    else map.set(c.characterId, [c]);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return map;
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

  load: () => Promise<void>;
  startRealtime: () => () => void;

  addCharacter: (name: string, memo?: string) => Promise<Character | null>;
  updateCharacterMemo: (id: string, memo: string) => Promise<void>;
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
      'name' | 'versionNo' | 'featuredImageUrl' | 'assignee' | 'memo'>>,
  ) => Promise<void>;
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

export const useCharacterBoardStore = create<CharacterBoardStore>((set, get) => ({
  characters: [],
  costumes: [],
  byCharacter: new Map(),
  episodeLinks: new Map(),
  loaded: false,
  loading: false,
  loadError: false,

  load: async () => {
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
      const assembled = characters.map((c) => ({
        ...c,
        episodeIds: (epByChar.get(c.id) ?? []).slice().sort((a, b) => a - b),
      }));
      set({
        characters: assembled,
        costumes,
        byCharacter: buildByCharacter(costumes),
        episodeLinks: buildEpisodeLinks(mappings),
        loaded: true,
        loading: false,
        loadError: false,
      });
    } catch (err) {
      console.error('[character-board] load 실패:', err);
      set({ loading: false, loadError: true });
      toast.error('캐릭터 현황판을 불러오지 못했어요');
    }
  },

  startRealtime: () => subscribeCharacterBoardRealtime((payload) => {
    get().receiveRealtime(payload);
  }),

  // ─── 캐릭터 ───

  addCharacter: async (name, memo) => {
    const createdBy = useAuthStore.getState().currentUser?.id ?? null;
    try {
      const created = await svcAddCharacter({ name, memo: memo ?? null, createdBy });
      // 서버 결과(정확한 id/sortOrder)로 머지 — realtime 도착 전 즉시 반영.
      set((s) => {
        if (s.characters.some((c) => c.id === created.id)) return s;
        return { characters: [...s.characters, { ...created, episodeIds: [] }] };
      });
      return created;
    } catch (err) {
      console.error('[character-board] addCharacter 실패:', err);
      toast.error('캐릭터 추가에 실패했어요');
      return null;
    }
  },

  updateCharacterMemo: async (id, memo) => {
    const prev = get().characters;
    set({ characters: prev.map((c) => (c.id === id ? { ...c, memo } : c)) });
    try {
      await svcUpdateCharacter(id, { memo });
    } catch (err) {
      console.error('[character-board] updateCharacterMemo 실패:', err);
      set({ characters: prev });
      toast.error('메모 저장에 실패했어요');
    }
  },

  renameCharacter: async (id, name) => {
    const prev = get().characters;
    set({ characters: prev.map((c) => (c.id === id ? { ...c, name } : c)) });
    try {
      await svcUpdateCharacter(id, { name });
    } catch (err) {
      console.error('[character-board] renameCharacter 실패:', err);
      set({ characters: prev });
      toast.error('이름 변경에 실패했어요');
    }
  },

  deleteCharacter: async (id) => {
    const prevChars = get().characters;
    const prevCostumes = get().costumes;
    const prevLinks = get().episodeLinks;
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
      set({
        characters: prevChars,
        costumes: prevCostumes,
        byCharacter: buildByCharacter(prevCostumes),
        episodeLinks: prevLinks,
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
        const costumes = [...s.costumes, created];
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

  updateCostumeField: async (id, updates) => {
    await applyCostumeUpdate(set, get, id, updates, '저장에 실패했어요');
  },

  setCostumeTags: async (id, kind, tags) => {
    const updates = kind === 'structure' ? { structureTags: tags } : { assetTags: tags };
    await applyCostumeUpdate(set, get, id, updates, '태그 저장에 실패했어요');
  },

  setVersion: async (id, versionNo) => {
    await applyCostumeUpdate(set, get, id, { versionNo }, '버전 변경에 실패했어요');
  },

  deleteCostume: async (id) => {
    const prev = get().costumes;
    const next = prev.filter((c) => c.id !== id);
    set({ costumes: next, byCharacter: buildByCharacter(next) });
    try {
      await svcDeleteCostume(id);
    } catch (err) {
      console.error('[character-board] deleteCostume 실패:', err);
      set({ costumes: prev, byCharacter: buildByCharacter(prev) });
      toast.error('복장 삭제에 실패했어요');
    }
  },

  // ─── 에피소드 매핑 ───

  linkEpisode: async (characterId, episodeNumber) => {
    const prevChars = get().characters;
    const prevLinks = get().episodeLinks;
    set({
      characters: prevChars.map((c) =>
        c.id === characterId && !c.episodeIds.includes(episodeNumber)
          ? { ...c, episodeIds: [...c.episodeIds, episodeNumber].sort((a, b) => a - b) }
          : c),
      episodeLinks: upsertLink(prevLinks, characterId, episodeNumber, {}),
    });
    try {
      await svcLinkEpisode(episodeNumber, characterId, useAuthStore.getState().currentUser?.id ?? null);
    } catch (err) {
      console.error('[character-board] linkEpisode 실패:', err);
      set({ characters: prevChars, episodeLinks: prevLinks });
      toast.error('에피소드 연결에 실패했어요');
    }
  },

  unlinkEpisode: async (characterId, episodeNumber) => {
    const prevChars = get().characters;
    const prevLinks = get().episodeLinks;
    set({
      characters: prevChars.map((c) =>
        c.id === characterId
          ? { ...c, episodeIds: c.episodeIds.filter((e) => e !== episodeNumber) }
          : c),
      episodeLinks: removeLink(prevLinks, characterId, episodeNumber),
    });
    try {
      await svcUnlinkEpisode(episodeNumber, characterId);
    } catch (err) {
      console.error('[character-board] unlinkEpisode 실패:', err);
      set({ characters: prevChars, episodeLinks: prevLinks });
      toast.error('에피소드 연결 해제에 실패했어요');
    }
  },

  setEpisodeMemo: async (characterId, episodeNumber, memo) => {
    const prevLinks = get().episodeLinks;
    set({ episodeLinks: upsertLink(prevLinks, characterId, episodeNumber, { memo }) });
    try {
      await svcUpdateEpisodeMapping(episodeNumber, characterId, { memo });
    } catch (err) {
      console.error('[character-board] setEpisodeMemo 실패:', err);
      set({ episodeLinks: prevLinks });
      toast.error('이 편 메모 저장에 실패했어요');
    }
  },

  setEpisodeCostume: async (characterId, episodeNumber, costumeId) => {
    const prevLinks = get().episodeLinks;
    set({ episodeLinks: upsertLink(prevLinks, characterId, episodeNumber, { costumeId }) });
    try {
      await svcUpdateEpisodeMapping(episodeNumber, characterId, { costumeId });
    } catch (err) {
      console.error('[character-board] setEpisodeCostume 실패:', err);
      set({ episodeLinks: prevLinks });
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
        // episodeIds 는 매핑 테이블 소관 — 기존 값 보존.
        const merged = { ...incoming, episodeIds: existing?.episodeIds ?? [] };
        return {
          characters: existing
            ? s.characters.map((c) => (c.id === incoming.id ? merged : c))
            : [...s.characters, merged],
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
        const exists = s.costumes.some((c) => c.id === incoming.id);
        const costumes = exists
          ? s.costumes.map((c) => (c.id === incoming.id ? incoming : c))
          : [...s.costumes, incoming];
        return { costumes, byCharacter: buildByCharacter(costumes) };
      });
      return;
    }

    if (table === 'episode_character_mapping') {
      // episode_number 는 payload row 에 없음(테이블 컬럼 아님) → 전체 매핑 재로드는 과함.
      // 낙관적 업데이트로 이미 로컬 반영됨. 다른 사용자 변경만 누락될 수 있어
      // 가벼운 매핑 재조립을 위해 episodeIds 전체 리로드.
      void reloadEpisodeMappings(set, get);
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
  next.set(characterId, arr);
  return next;
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
): Promise<void> {
  const prev = get().costumes;
  const next = prev.map((c) => (c.id === id ? { ...c, ...updates } : c));
  set({ costumes: next, byCharacter: buildByCharacter(next) });
  try {
    await svcUpdateCostume(id, updates, logContext);
  } catch (err) {
    console.error('[character-board] updateCostume 실패:', err);
    set({ costumes: prev, byCharacter: buildByCharacter(prev) });
    toast.error(errorMsg);
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
