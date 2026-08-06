/**
 * 캐릭터 현황판 store.
 *
 * - characters: 전역 캐릭터 (episodeIds 조립 완료 상태)
 * - costumes: 모든 복장 (캐릭터 무관 평면 배열)
 * - byCharacter: characterId → 복장 배열 (파생 — rebuildByCharacter 가 구조적 공유로 재계산)
 *
 * 모든 변경은 컴포지팅 대시보드(useCompositingDashboardStore)와 동일하게
 *   낙관적 업데이트 → IPC 동기화 → 실패 시 롤백 패턴.
 * Realtime 수신(세 테이블)은 receiveRealtime 로 머지.
 *
 * 순수 계산(정렬·머지·pending 보호)은 characterBoardStoreHelpers 로 분리 —
 * 이 파일에는 zustand state, pending 버킷(Map 3종), IPC 호출 흐름, 롤백 정책만 남긴다.
 * 데이터를 useDataStore 에 두지 않고 피처 전용 store 로 자급 — 컴포지팅 store 패턴 미러링.
 */

import { create } from 'zustand';
import type {
  Character, CharacterCostume, CharacterCostumeImage, CostumeImageRole,
  EpisodeCharacterLink, CostumeActivityLogContext,
  CharacterBoardTab, CharacterBoardTabGroup, CharacterBoardTabRow,
} from '@/types';
import {
  buildEpisodeLinks,
  buildImagesByCostume,
  mergeEpisodeLinkPatchWithPending,
  mergeIncomingWithPending,
  pendingLinkKey,
  rebuildByCharacter,
  rebuildImagesByCostume,
  reorderedCostumeSortOrders,
  rowToRealtimeMapping,
  valuesEqual,
  sortCharacters,
  sortCostumes,
  sortCostumeImages,
  trackPendingFields,
} from '@/stores/characterBoardStoreHelpers';
import type { PendingLocalField } from '@/stores/characterBoardStoreHelpers';
import {
  loadCharacters as svcLoadCharacters,
  loadCharacterCostumes as svcLoadCostumes,
  loadCharacterCostumeImages as svcLoadCostumeImages,
  loadEpisodeCharacterMap as svcLoadMap,
  addCharacter as svcAddCharacter,
  updateCharacter as svcUpdateCharacter,
  deleteCharacter as svcDeleteCharacter,
  addCharacterCostume as svcAddCostume,
  updateCharacterCostume as svcUpdateCostume,
  deleteCharacterCostume as svcDeleteCostume,
  addCharacterCostumeImage as svcAddCostumeImage,
  updateCharacterCostumeImage as svcUpdateCostumeImage,
  deleteCharacterCostumeImage as svcDeleteCostumeImage,
  setPrimaryCostumeImage as svcSetPrimaryImage,
  linkCharacterEpisode as svcLinkEpisode,
  unlinkCharacterEpisode as svcUnlinkEpisode,
  updateEpisodeCharacterMapping as svcUpdateEpisodeMapping,
  loadCharacterBoardTabs as svcLoadTabs,
  addCharacterBoardTab as svcAddTab,
  updateCharacterBoardTab as svcUpdateTab,
  deleteCharacterBoardTab as svcDeleteTab,
  rowToCharacter,
  rowToCostume,
  rowToCostumeImage,
  rowToCharacterBoardTab,
  subscribeCharacterBoardRealtime,
} from '@/services/supabaseService';
import { useAuthStore } from '@/stores/useAuthStore';
import { DEFAULT_COSTUME_NAME } from '@/utils/characterCostumeName';
import { nextTempCharacterName } from '@/utils/characterName';
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

// 낙관적 쓰기 보호용 pending 버킷 3종 — 이 모듈(store)이 소유하고,
// 순수 머지 함수(characterBoardStoreHelpers)에 파라미터로 넘긴다.
const pendingCharacterFields = new Map<string, Map<string, PendingLocalField>>();
const pendingCostumeFields = new Map<string, Map<string, PendingLocalField>>();
const pendingCostumeImageFields = new Map<string, Map<string, PendingLocalField>>();
const pendingEpisodeLinkFields = new Map<string, Map<string, PendingLocalField>>();
const pendingTabFields = new Map<string, Map<string, PendingLocalField>>();

/** 탭 정렬: sortOrder → createdAt → id (reorderCharacters 계열과 동일한 tie-break 정신). */
function sortTabs(tabs: CharacterBoardTab[]): CharacterBoardTab[] {
  return tabs.slice().sort((a, b) =>
    a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** 에피소드 링크 pending 버킷에 얇게 묶인 편의 래퍼 — 전역 버킷 의존이라 store 에 남긴다. */
function trackPendingEpisodeLinkField<K extends 'memo' | 'costumeIds'>(
  characterId: string,
  episodeNumber: number,
  field: K,
  value: EpisodeCharacterLink[K],
) {
  trackPendingFields(pendingEpisodeLinkFields, pendingLinkKey(characterId, episodeNumber), { [field]: value });
}

interface CharacterBoardStore {
  characters: Character[];
  costumes: CharacterCostume[];
  byCharacter: Map<string, CharacterCostume[]>;
  /** 모든 복장 이미지 (복장 무관 평면 배열). */
  costumeImages: CharacterCostumeImage[];
  /** costumeId → 이 복장의 이미지 배열 (파생 — rebuildImagesByCostume 가 구조적 공유로 재계산). */
  imagesByCostume: Map<string, CharacterCostumeImage[]>;
  /** characterId → 이 캐릭터의 에피소드 연결 상세(메모/복장). episodeIds 와 병렬 유지. */
  episodeLinks: Map<string, EpisodeCharacterLink[]>;
  /** 사용자 정의 탭 (피드백 41) — sortOrder 오름차순. 그룹은 탭 row 안 JSONB. */
  tabs: CharacterBoardTab[];
  loaded: boolean;
  loading: boolean;
  /** 초기 로드 실패 — UI 가 무한 스피너 대신 에러+재시도를 보이도록. */
  loadError: boolean;

  load: (opts?: { silent?: boolean }) => Promise<void>;
  startRealtime: () => () => void;
  ensureLoadedAndRealtime: (opts?: { silent?: boolean }) => () => void;

  addCharacter: (name: string, memo?: string) => Promise<Character | null>;
  updateCharacterFolder: (id: string, workFolderPath: string | null) => Promise<boolean>;
  /** 캐릭터 기준 키(px) 저장 — 나열 시 상대 크기 비교용 (T2-3). */
  setCharacterReferenceHeight: (id: string, referenceHeightPx: number | null) => Promise<boolean>;
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
      | 'memo'
      | 'dueDate'
      | 'heightPx'>>,
  ) => Promise<boolean>;
  setCostumeTags: (id: string, kind: 'structure' | 'asset', tags: string[]) => Promise<void>;
  setVersion: (id: string, versionNo: number) => Promise<void>;
  deleteCostume: (id: string) => Promise<void>;
  /** 복장 순서 드래그 재배치 — 낙관적 sortOrder 재부여 + 변경분만 저장, 실패 시 롤백. */
  reorderCostumes: (characterId: string, orderedIds: string[]) => Promise<void>;
  reorderCharacters: (orderedIds: string[]) => Promise<void>;

  // ─── 사용자 정의 탭·그룹 (피드백 41) ───
  addTab: (name: string) => Promise<CharacterBoardTab | null>;
  renameTab: (id: string, name: string) => Promise<void>;
  deleteTab: (id: string) => Promise<void>;
  /** 탭의 그룹 배열 교체 — 그룹 CRUD·멤버 이동이 전부 이 액션으로 수렴(탭 단위 LWW). */
  updateTabGroups: (id: string, groups: CharacterBoardTabGroup[]) => Promise<void>;

  // ─── 복장 다중 이미지 ───
  /** 이미지 추가 — 복장의 첫 이미지면 primary 로 지정하고 featured_* 동기화. */
  addCostumeImage: (
    costumeId: string,
    url: string,
    role?: CostumeImageRole,
    /** 업로드 원본 크기(px, 리사이즈 전 측정값) — 기준 키 자동 설정·드래그 조정용 (피드백 33). */
    naturalSize?: { width: number; height: number },
  ) => Promise<CharacterCostumeImage | null>;
  /** 대표 이미지 지정 — 같은 복장 이미지들의 primary 갱신 + featured_* 동기화. */
  setPrimaryImage: (imageId: string) => Promise<void>;
  /** 이미지 부분 필드 수정 — primary 이미지의 배경/맞춤 변경 시 featured_* 동기화. */
  updateCostumeImageField: (
    imageId: string,
    updates: Partial<Pick<CharacterCostumeImage, 'role' | 'label' | 'imageBackground' | 'imageFit'>>,
  ) => Promise<boolean>;
  /** 이미지 순서 드래그 재배치 — reorderCostumes 미러. */
  reorderCostumeImages: (costumeId: string, orderedIds: string[]) => Promise<void>;
  /** 이미지 삭제 — primary 삭제 시 남은 이미지 중 최소 순서를 새 primary 로(없으면 featured 비움). */
  deleteCostumeImage: (imageId: string) => Promise<void>;

  linkEpisode: (characterId: string, episodeNumber: number) => Promise<void>;
  unlinkEpisode: (characterId: string, episodeNumber: number) => Promise<void>;
  /** 이 편 주의점 메모 — 낙관적 업데이트. */
  setEpisodeMemo: (characterId: string, episodeNumber: number, memo: string) => Promise<void>;
  /** 이 편에 쓰는 복장 선택/해제 — 낙관적 업데이트. */
  /** 이 편에 쓰는 복장 배열을 통째로 저장 (피드백 42: 1:N). 호출부가 토글 결과 배열을 계산해 넘긴다. */
  setEpisodeCostumes: (characterId: string, episodeNumber: number, costumeIds: string[]) => Promise<void>;

  receiveRealtime: (payload: {
    table: 'characters' | 'character_costumes' | 'character_costume_images' | 'episode_character_mapping' | 'character_board_tabs';
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    row: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
  }) => void;
}

let characterBoardRealtimeRefCount = 0;
let stopCharacterBoardRealtime: (() => void) | null = null;

export const useCharacterBoardStore = create<CharacterBoardStore>((set, get) => ({
  characters: [],
  costumes: [],
  byCharacter: new Map(),
  costumeImages: [],
  imagesByCostume: new Map(),
  episodeLinks: new Map(),
  tabs: [],
  loaded: false,
  loading: false,
  loadError: false,

  load: async (opts) => {
    if (get().loading) return;
    set({ loading: true, loadError: false });
    try {
      const [characters, costumes, mappings, costumeImages, tabs] = await Promise.all([
        svcLoadCharacters(),
        svcLoadCostumes(),
        svcLoadMap(),
        svcLoadCostumeImages(),
        svcLoadTabs(),
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
      const prevCostumeImageById = new Map(prev.costumeImages.map((i) => [i.id, i]));
      const prevTabById = new Map(prev.tabs.map((t) => [t.id, t]));
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
      const sortedImages = sortCostumeImages(costumeImages.map((i) =>
        mergeIncomingWithPending(pendingCostumeImageFields, prevCostumeImageById.get(i.id), i)));
      const sortedTabs = sortTabs(tabs.map((t) => mergeIncomingWithPending(pendingTabFields, prevTabById.get(t.id), t)));
      const freshLinks = buildEpisodeLinks(mappings);
      for (const [characterId, links] of freshLinks) {
        for (let i = 0; i < links.length; i++) {
          const link = links[i];
          const patched = mergeEpisodeLinkPatchWithPending(pendingEpisodeLinkFields, prev.episodeLinks, characterId, link.episodeNumber, {
            memo: link.memo,
            costumeIds: link.costumeIds,
          });
          links[i] = { ...link, ...patched };
        }
      }
      set({
        characters: assembled,
        costumes: sortedCostumes,
        byCharacter: rebuildByCharacter(prev.byCharacter, sortedCostumes),
        costumeImages: sortedImages,
        imagesByCostume: rebuildImagesByCostume(prev.imagesByCostume, sortedImages),
        episodeLinks: freshLinks,
        tabs: sortedTabs,
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
    // 이름 없이 추가하면 표시 가능한 임시 이름을 부여한다(B4) — 빈 문자열은 목록·댓글·나의할일에서 빈칸으로 샌다.
    const finalName = name.trim() || nextTempCharacterName(get().characters.map((c) => c.name));
    try {
      const created = await svcAddCharacter({ name: finalName, memo: memo ?? null, createdBy });
      // 서버 결과(정확한 id/sortOrder)로 머지 — realtime 도착 전 즉시 반영.
      set((s) => {
        if (s.characters.some((c) => c.id === created.id)) return s;
        return { characters: sortCharacters([...s.characters, { ...created, episodeIds: [] }]) };
      });
      try {
        const firstCostume = await svcAddCostume({ characterId: created.id, name: DEFAULT_COSTUME_NAME, createdBy });
        set((s) => {
          if (s.costumes.some((c) => c.id === firstCostume.id)) return s;
          const costumes = sortCostumes([...s.costumes, firstCostume]);
          return { costumes, byCharacter: rebuildByCharacter(s.byCharacter, costumes) };
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

  setCharacterReferenceHeight: async (id, referenceHeightPx) => {
    return applyCharacterUpdate(set, get, id, { referenceHeightPx }, { reference_height_px: referenceHeightPx }, '키 저장에 실패했어요');
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
    const prevImages = get().costumeImages;
    const prevLinks = get().episodeLinks;
    const removedCharacter = prevChars.find((c) => c.id === id) ?? null;
    const removedCostumes = prevCostumes.filter((c) => c.characterId === id);
    const removedCostumeIds = new Set(removedCostumes.map((c) => c.id));
    const removedImages = prevImages.filter((i) => removedCostumeIds.has(i.costumeId));
    const removedLinks = prevLinks.get(id)?.slice() ?? null;
    const nextCostumes = prevCostumes.filter((c) => c.characterId !== id);
    const nextImages = prevImages.filter((i) => !removedCostumeIds.has(i.costumeId));
    const nextLinks = new Map(prevLinks); nextLinks.delete(id);
    set({
      characters: prevChars.filter((c) => c.id !== id),
      costumes: nextCostumes,
      byCharacter: rebuildByCharacter(get().byCharacter, nextCostumes),
      costumeImages: nextImages,
      imagesByCostume: rebuildImagesByCostume(get().imagesByCostume, nextImages),
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
        const existingImageIds = new Set(s.costumeImages.map((i) => i.id));
        const missingImages = removedImages.filter((i) => !existingImageIds.has(i.id));
        const costumeImages = missingImages.length > 0
          ? sortCostumeImages([...s.costumeImages, ...missingImages])
          : s.costumeImages;
        const episodeLinks = new Map(s.episodeLinks);
        if (removedLinks && !episodeLinks.has(id)) episodeLinks.set(id, removedLinks);
        return {
          characters,
          costumes,
          byCharacter: rebuildByCharacter(s.byCharacter, costumes),
          costumeImages,
          imagesByCostume: rebuildImagesByCostume(s.imagesByCostume, costumeImages),
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
        return { costumes, byCharacter: rebuildByCharacter(s.byCharacter, costumes) };
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
    const prevImages = get().costumeImages;
    const removed = prev.find((c) => c.id === id) ?? null;
    const removedImages = prevImages.filter((i) => i.costumeId === id);
    const next = prev.filter((c) => c.id !== id);
    const nextImages = prevImages.filter((i) => i.costumeId !== id);
    set({
      costumes: next,
      byCharacter: rebuildByCharacter(get().byCharacter, next),
      costumeImages: nextImages,
      imagesByCostume: rebuildImagesByCostume(get().imagesByCostume, nextImages),
    });
    try {
      await svcDeleteCostume(id);
    } catch (err) {
      console.error('[character-board] deleteCostume 실패:', err);
      set((s) => {
        if (!removed || s.costumes.some((c) => c.id === id)) return s;
        const costumes = sortCostumes([...s.costumes, removed]);
        const existingImageIds = new Set(s.costumeImages.map((i) => i.id));
        const missingImages = removedImages.filter((i) => !existingImageIds.has(i.id));
        const costumeImages = missingImages.length > 0
          ? sortCostumeImages([...s.costumeImages, ...missingImages])
          : s.costumeImages;
        return {
          costumes,
          byCharacter: rebuildByCharacter(s.byCharacter, costumes),
          costumeImages,
          imagesByCostume: rebuildImagesByCostume(s.imagesByCostume, costumeImages),
        };
      });
      toast.error('복장 삭제에 실패했어요');
    }
  },

  reorderCostumes: async (characterId, orderedIds) => {
    const prevCostumes = get().costumes;
    const charCostumes = prevCostumes.filter((c) => c.characterId === characterId);
    const changes = reorderedCostumeSortOrders(charCostumes, orderedIds);
    if (changes.length === 0) return;
    const changeMap = new Map(changes.map((ch) => [ch.id, ch.sortOrder]));
    const prevSortById = new Map(charCostumes.map((c) => [c.id, c.sortOrder]));
    // 낙관적 반영 + pending 보호(재연결 catch-up·실시간 에코가 순서를 되돌리지 않게, 다른 필드 update 와 동일 패턴).
    for (const ch of changes) trackPendingFields(pendingCostumeFields, ch.id, { sortOrder: ch.sortOrder });
    const next = prevCostumes.map((c) => (changeMap.has(c.id) ? { ...c, sortOrder: changeMap.get(c.id)! } : c));
    set({ costumes: sortCostumes(next), byCharacter: rebuildByCharacter(get().byCharacter, next) });
    try {
      await Promise.all(changes.map((ch) => svcUpdateCostume(ch.id, { sortOrder: ch.sortOrder })));
    } catch (err) {
      console.error('[character-board] reorderCostumes 실패:', err);
      // 아직 우리 낙관값 그대로인 복장만 이전 순서로 되돌린다(그 사이 다른 편집·실시간 반영은 보존).
      set((s) => {
        const reverted = s.costumes.map((c) => {
          if (!changeMap.has(c.id) || c.sortOrder !== changeMap.get(c.id)) return c;
          const prevSort = prevSortById.get(c.id);
          return prevSort === undefined ? c : { ...c, sortOrder: prevSort };
        });
        return { costumes: sortCostumes(reverted), byCharacter: rebuildByCharacter(s.byCharacter, reverted) };
      });
      toast.error('복장 순서 변경 저장에 실패했어요');
    }
  },

  reorderCharacters: async (orderedIds) => {
    const prev = get().characters;
    const changes = reorderedCostumeSortOrders(prev, orderedIds);
    if (changes.length === 0) return;
    const changeMap = new Map(changes.map((ch) => [ch.id, ch.sortOrder]));
    const prevSortById = new Map(prev.map((c) => [c.id, c.sortOrder]));
    // 낙관적 반영 + pending 보호 — 복장 재배치(reorderCostumes)와 동일 패턴. 캐릭터 버킷 사용.
    for (const ch of changes) trackPendingFields(pendingCharacterFields, ch.id, { sortOrder: ch.sortOrder });
    set({ characters: sortCharacters(prev.map((c) => (changeMap.has(c.id) ? { ...c, sortOrder: changeMap.get(c.id)! } : c))) });
    try {
      await Promise.all(changes.map((ch) => svcUpdateCharacter(ch.id, { sort_order: ch.sortOrder })));
    } catch (err) {
      console.error('[character-board] reorderCharacters 실패:', err);
      // 아직 우리 낙관값 그대로인 캐릭터만 이전 순서로 되돌린다(그 사이 다른 편집·실시간 반영은 보존).
      set((s) => ({
        characters: sortCharacters(s.characters.map((c) => {
          if (!changeMap.has(c.id) || c.sortOrder !== changeMap.get(c.id)) return c;
          const prevSort = prevSortById.get(c.id);
          return prevSort === undefined ? c : { ...c, sortOrder: prevSort };
        })),
      }));
      toast.error('캐릭터 순서 변경 저장에 실패했어요');
    }
  },

  // ─── 사용자 정의 탭·그룹 (피드백 41) ───

  addTab: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const createdBy = useAuthStore.getState().currentUser?.id ?? null;
    const sortOrder = get().tabs.reduce((m, t) => Math.max(m, t.sortOrder + 1), 0);
    try {
      const created = await svcAddTab({ name: trimmed, sortOrder, createdBy });
      // 서버 결과로 머지 — realtime 도착 전 즉시 반영(중복 방지 위해 같은 id 제거 후 삽입).
      set((s) => ({ tabs: sortTabs([...s.tabs.filter((t) => t.id !== created.id), created]) }));
      return created;
    } catch (err) {
      console.error('[character-board] 탭 추가 실패:', err);
      toast.error('탭을 추가하지 못했어요');
      return null;
    }
  },

  renameTab: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await applyTabUpdate(set, get, id, { name: trimmed }, '탭 이름을 저장하지 못했어요');
  },

  deleteTab: async (id) => {
    const removed = get().tabs.find((t) => t.id === id) ?? null;
    set((s) => ({ tabs: s.tabs.filter((t) => t.id !== id) }));
    try {
      await svcDeleteTab(id);
    } catch (err) {
      console.error('[character-board] 탭 삭제 실패:', err);
      if (removed) set((s) => ({ tabs: sortTabs([...s.tabs, removed]) }));
      toast.error('탭을 삭제하지 못했어요');
    }
  },

  updateTabGroups: async (id, groups) => {
    await applyTabUpdate(set, get, id, { groups }, '그룹 변경을 저장하지 못했어요');
  },

  // ─── 복장 다중 이미지 ───

  addCostumeImage: async (costumeId, url, role = 'design', naturalSize) => {
    const createdBy = useAuthStore.getState().currentUser?.id ?? null;
    // 복장의 첫 이미지면 대표(primary)로 지정 — 기존 단일 이미지 소비처가 이 값을 계속 읽는다.
    const isPrimary = (get().imagesByCostume.get(costumeId)?.length ?? 0) === 0;
    try {
      const created = await svcAddCostumeImage({
        costumeId, url, role, isPrimary, createdBy,
        naturalWidth: naturalSize?.width ?? null,
        naturalHeight: naturalSize?.height ?? null,
      });
      set((s) => {
        if (s.costumeImages.some((i) => i.id === created.id)) return s;
        const costumeImages = sortCostumeImages([...s.costumeImages, created]);
        return { costumeImages, imagesByCostume: rebuildImagesByCostume(s.imagesByCostume, costumeImages) };
      });
      // featured_* 의 DB 확정은 트리거(trg_sync_costume_featured_image)가 담당(앱이 featured 를 직접 안 씀 → 이전 primary 파일 보존).
      //   단, mock/preview·전파 지연 대비 로컬 featured 는 즉시 반영한다(코덱스 P2).
      if (created.isPrimary) applyFeaturedLocal(set, get, costumeId, created.url, created.imageBackground, created.imageFit);
      return created;
    } catch (err) {
      console.error('[character-board] addCostumeImage 실패:', err);
      toast.error('이미지 추가에 실패했어요');
      return null;
    }
  },

  setPrimaryImage: async (imageId) => {
    const target = get().costumeImages.find((i) => i.id === imageId);
    if (!target) return;
    const { costumeId } = target;
    const prevCostume = get().costumes.find((c) => c.id === costumeId) ?? null;
    const prevPrimaryById = new Map(
      get().costumeImages.filter((i) => i.costumeId === costumeId).map((i) => [i.id, i.isPrimary]),
    );
    // 낙관 반영 — 대상만 대표(true)로. 실제로 바뀌는 행(대상 + 직전 대표)만 pending 으로 보호한다.
    //   그대로 false 인 형제까지 pending 표시하면, 그 사이 다른 사용자가 그 형제를 대표로 올린 realtime true 를
    //   mergeIncomingWithPending 이 "로컬 false == pending false" 로 보고 떨궈 재로드 전까지 낡은 대표가 남는다(코덱스 P2).
    const prevPrimaryId = [...prevPrimaryById].find(([, isP]) => isP)?.[0] ?? null;
    trackPendingFields(pendingCostumeImageFields, imageId, { isPrimary: true });
    if (prevPrimaryId && prevPrimaryId !== imageId) {
      trackPendingFields(pendingCostumeImageFields, prevPrimaryId, { isPrimary: false });
    }
    const optimistic = get().costumeImages.map((i) =>
      i.costumeId === costumeId ? { ...i, isPrimary: i.id === imageId } : i);
    set({
      costumeImages: sortCostumeImages(optimistic),
      imagesByCostume: rebuildImagesByCostume(get().imagesByCostume, optimistic),
    });
    // 로컬 featured 즉시 반영(DB 는 트리거가 확정). mock/preview·지연 대비(코덱스 P2).
    applyFeaturedLocal(set, get, costumeId, target.url, target.imageBackground, target.imageFit);
    try {
      await svcSetPrimaryImage(costumeId, imageId);
    } catch (err) {
      console.error('[character-board] setPrimaryImage 실패:', err);
      if (prevCostume) applyFeaturedLocal(set, get, costumeId, prevCostume.featuredImageUrl, prevCostume.imageBackground, prevCostume.imageFit);
      // 아직 우리 낙관값 그대로인 이미지만 이전 primary 상태로 되돌린다.
      set((s) => {
        const reverted = s.costumeImages.map((i) => {
          if (i.costumeId !== costumeId) return i;
          const prev = prevPrimaryById.get(i.id);
          if (prev === undefined || i.isPrimary !== (i.id === imageId)) return i;
          return { ...i, isPrimary: prev };
        });
        return {
          costumeImages: sortCostumeImages(reverted),
          imagesByCostume: rebuildImagesByCostume(s.imagesByCostume, reverted),
        };
      });
      toast.error('대표 이미지 지정에 실패했어요');
    }
  },

  updateCostumeImageField: async (imageId, updates) => {
    const saved = await applyCostumeImageUpdate(set, get, imageId, updates, '이미지 저장에 실패했어요');
    if (saved) {
      // primary 이미지의 배경/맞춤 변경 시 로컬 featured 도 즉시 반영(DB 는 트리거가 확정, 코덱스 P2).
      const img = get().costumeImages.find((i) => i.id === imageId);
      if (img?.isPrimary && (updates.imageBackground !== undefined || updates.imageFit !== undefined)) {
        applyFeaturedLocal(set, get, img.costumeId, img.url,
          updates.imageBackground !== undefined ? img.imageBackground : undefined,
          updates.imageFit !== undefined ? img.imageFit : undefined);
      }
    }
    return saved;
  },

  reorderCostumeImages: async (costumeId, orderedIds) => {
    const prevImages = get().costumeImages;
    const costumeImgs = prevImages.filter((i) => i.costumeId === costumeId);
    const changes = reorderedCostumeSortOrders(costumeImgs, orderedIds);
    if (changes.length === 0) return;
    const changeMap = new Map(changes.map((ch) => [ch.id, ch.sortOrder]));
    const prevSortById = new Map(costumeImgs.map((i) => [i.id, i.sortOrder]));
    for (const ch of changes) trackPendingFields(pendingCostumeImageFields, ch.id, { sortOrder: ch.sortOrder });
    const next = prevImages.map((i) => (changeMap.has(i.id) ? { ...i, sortOrder: changeMap.get(i.id)! } : i));
    set({
      costumeImages: sortCostumeImages(next),
      imagesByCostume: rebuildImagesByCostume(get().imagesByCostume, next),
    });
    try {
      await Promise.all(changes.map((ch) => svcUpdateCostumeImage(ch.id, { sortOrder: ch.sortOrder })));
    } catch (err) {
      console.error('[character-board] reorderCostumeImages 실패:', err);
      set((s) => {
        const reverted = s.costumeImages.map((i) => {
          if (!changeMap.has(i.id) || i.sortOrder !== changeMap.get(i.id)) return i;
          const prevSort = prevSortById.get(i.id);
          return prevSort === undefined ? i : { ...i, sortOrder: prevSort };
        });
        return {
          costumeImages: sortCostumeImages(reverted),
          imagesByCostume: rebuildImagesByCostume(s.imagesByCostume, reverted),
        };
      });
      toast.error('이미지 순서 변경 저장에 실패했어요');
    }
  },

  deleteCostumeImage: async (imageId) => {
    const prev = get().costumeImages;
    const removed = prev.find((i) => i.id === imageId) ?? null;
    if (!removed) return;
    const { costumeId } = removed;
    const wasPrimary = removed.isPrimary;
    const next = prev.filter((i) => i.id !== imageId);
    set({
      costumeImages: next,
      imagesByCostume: rebuildImagesByCostume(get().imagesByCostume, next),
    });
    try {
      await svcDeleteCostumeImage(imageId);
      if (wasPrimary) {
        // 대표를 지웠을 때 DB 승격은 트리거가 삭제와 '같은 트랜잭션'에서 원자적으로 처리한다(코덱스 P2):
        //   대표가 없고 남은 이미지가 있으면 최소 순서를 자동 승격 → 삭제 한 번으로 대표 유지 보장(2-step 경합 제거).
        //   앱은 별도 승격 쿼리를 보내지 않고, 깜빡임만 없애기 위해 로컬을 낙관 반영한다(트리거 결과와 동일).
        const remaining = sortCostumeImages(get().costumeImages.filter((i) => i.costumeId === costumeId));
        if (remaining.length > 0) {
          const promote = remaining[0];
          trackPendingFields(pendingCostumeImageFields, promote.id, { isPrimary: true });
          const promoted = get().costumeImages.map((i) =>
            i.costumeId === costumeId ? { ...i, isPrimary: i.id === promote.id } : i);
          set({ costumeImages: sortCostumeImages(promoted), imagesByCostume: rebuildImagesByCostume(get().imagesByCostume, promoted) });
          applyFeaturedLocal(set, get, costumeId, promote.url, promote.imageBackground, promote.imageFit);
        } else {
          applyFeaturedLocal(set, get, costumeId, null); // 남은 이미지 없음 → 로컬 featured 비움(DB 는 트리거가 이미 비움).
        }
      }
    } catch (err) {
      console.error('[character-board] deleteCostumeImage 실패:', err);
      set((s) => {
        if (s.costumeImages.some((i) => i.id === imageId)) return s;
        const restored = sortCostumeImages([...s.costumeImages, removed]);
        return { costumeImages: restored, imagesByCostume: rebuildImagesByCostume(s.imagesByCostume, restored) };
      });
      toast.error('이미지 삭제에 실패했어요');
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
        const shouldRemove = !currentLink || (!currentLink.memo && currentLink.costumeIds.length === 0);
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
          costumeIds: previousLink?.costumeIds ?? [],
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

  setEpisodeCostumes: async (characterId, episodeNumber, costumeIds) => {
    const previousLink = get().episodeLinks.get(characterId)?.find((l) => l.episodeNumber === episodeNumber) ?? null;
    trackPendingEpisodeLinkField(characterId, episodeNumber, 'costumeIds', costumeIds);
    set({ episodeLinks: upsertLink(get().episodeLinks, characterId, episodeNumber, { costumeIds }) });
    try {
      await svcUpdateEpisodeMapping(episodeNumber, characterId, { costumeIds });
    } catch (err) {
      console.error('[character-board] setEpisodeCostumes 실패:', err);
      set((s) => ({
        episodeLinks: revertLinkFieldIfUnchanged(s.episodeLinks, characterId, episodeNumber, 'costumeIds', costumeIds, previousLink),
      }));
      toast.error('이 편 복장 선택에 실패했어요');
    }
  },

  // ─── Realtime 머지 ───

  receiveRealtime: (payload) => {
    const { table, eventType, row, old } = payload;
    // character_board_tabs (피드백 41)
    if (table === 'character_board_tabs') {
      if (eventType === 'DELETE') {
        const id = (old?.id ?? row?.id) as string | undefined;
        if (id) set((s) => ({ tabs: s.tabs.filter((t) => t.id !== id) }));
        return;
      }
      if (!row) return;
      const incoming = rowToCharacterBoardTab(row as unknown as CharacterBoardTabRow);
      set((s) => {
        const prevTab = s.tabs.find((t) => t.id === incoming.id);
        const merged = mergeIncomingWithPending(pendingTabFields, prevTab, incoming);
        return { tabs: sortTabs([...s.tabs.filter((t) => t.id !== incoming.id), merged]) };
      });
      return;
    }

    if (table === 'characters') {
      if (eventType === 'DELETE') {
        const id = old?.id;
        if (typeof id !== 'string' || !id) return;
        set((s) => {
          const removedCostumeIds = new Set(s.costumes.filter((c) => c.characterId === id).map((c) => c.id));
          const costumes = s.costumes.filter((c) => c.characterId !== id);
          const costumeImages = s.costumeImages.filter((i) => !removedCostumeIds.has(i.costumeId));
          const episodeLinks = new Map(s.episodeLinks); episodeLinks.delete(id);
          return {
            characters: s.characters.filter((c) => c.id !== id),
            costumes,
            byCharacter: rebuildByCharacter(s.byCharacter, costumes),
            costumeImages,
            imagesByCostume: rebuildImagesByCostume(s.imagesByCostume, costumeImages),
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
        if (typeof id !== 'string' || !id) return;
        set((s) => {
          const costumes = s.costumes.filter((c) => c.id !== id);
          const costumeImages = s.costumeImages.filter((i) => i.costumeId !== id);
          return {
            costumes,
            byCharacter: rebuildByCharacter(s.byCharacter, costumes),
            costumeImages,
            imagesByCostume: rebuildImagesByCostume(s.imagesByCostume, costumeImages),
          };
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
        return { costumes, byCharacter: rebuildByCharacter(s.byCharacter, costumes) };
      });
      return;
    }

    if (table === 'character_costume_images') {
      if (eventType === 'DELETE') {
        const id = old?.id;
        if (typeof id !== 'string' || !id) return;
        set((s) => {
          const costumeImages = s.costumeImages.filter((i) => i.id !== id);
          return { costumeImages, imagesByCostume: rebuildImagesByCostume(s.imagesByCostume, costumeImages) };
        });
        return;
      }
      if (!row) return;
      const incoming = rowToCostumeImage(row);
      set((s) => {
        const existing = s.costumeImages.find((i) => i.id === incoming.id);
        const merged = mergeIncomingWithPending(pendingCostumeImageFields, existing, incoming);
        const costumeImages = existing
          ? sortCostumeImages(s.costumeImages.map((i) => (i.id === incoming.id ? merged : i)))
          : sortCostumeImages([...s.costumeImages, merged]);
        return { costumeImages, imagesByCostume: rebuildImagesByCostume(s.imagesByCostume, costumeImages) };
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
          mergeEpisodeLinkPatchWithPending(pendingEpisodeLinkFields, s.episodeLinks, mapping.characterId, mapping.episodeNumber, {
            memo: mapping.memo,
            costumeIds: mapping.costumeIds,
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
  patch: Partial<Pick<EpisodeCharacterLink, 'memo' | 'costumeIds'>>,
): Map<string, EpisodeCharacterLink[]> {
  const next = new Map(links);
  const arr = (next.get(characterId) ?? []).slice();
  const idx = arr.findIndex((l) => l.episodeNumber === episodeNumber);
  if (idx >= 0) {
    arr[idx] = { ...arr[idx], ...patch };
  } else {
    arr.push({ episodeNumber, memo: patch.memo ?? null, costumeIds: patch.costumeIds ?? [] });
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

function revertLinkFieldIfUnchanged<K extends 'memo' | 'costumeIds'>(
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
  // costumeIds 는 배열이라 !== 참조 비교로는 '낙관값 그대로'를 판정할 수 없다 — valuesEqual(JSON 딥비교) 사용.
  if (idx < 0 || !valuesEqual(arr[idx][field], optimisticValue)) return links;

  const restored = {
    ...arr[idx],
    [field]: previousLink ? previousLink[field] : (field === 'costumeIds' ? [] : null),
  };
  if (!previousLink && !restored.memo && restored.costumeIds.length === 0) {
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

/** 탭 낙관 갱신 공통 — 즉시 반영 + pending 추적 + 실패 시 조건부 롤백 (applyCharacterUpdate 미러, 피드백 41). */
async function applyTabUpdate(
  set: (partial: Partial<CharacterBoardStore>) => void,
  get: () => CharacterBoardStore,
  id: string,
  updates: Partial<Pick<CharacterBoardTab, 'name' | 'sortOrder' | 'groups'>>,
  failMsg: string,
): Promise<void> {
  const prevTab = get().tabs.find((t) => t.id === id) ?? null;
  trackPendingFields(pendingTabFields, id, updates as Record<string, unknown>);
  set({ tabs: sortTabs(get().tabs.map((t) => (t.id === id ? { ...t, ...updates } : t))) });
  try {
    await svcUpdateTab(id, updates);
  } catch (err) {
    console.error('[character-board] 탭 저장 실패:', err);
    if (prevTab) {
      const updRec = updates as unknown as Record<string, unknown>;
      const prevRec = prevTab as unknown as Record<string, unknown>;
      const reverted = get().tabs.map((t) => {
        if (t.id !== id) return t;
        const curRec = t as unknown as Record<string, unknown>;
        const restored: Record<string, unknown> = { ...curRec };
        for (const k of Object.keys(updates)) {
          if (curRec[k] === updRec[k]) restored[k] = prevRec[k];
        }
        return restored as unknown as CharacterBoardTab;
      });
      set({ tabs: sortTabs(reverted) });
    }
    toast.error(failMsg);
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
  set({ costumes: next, byCharacter: rebuildByCharacter(get().byCharacter, next) });
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
      set({ costumes: reverted, byCharacter: rebuildByCharacter(get().byCharacter, reverted) });
    }
    toast.error(errorMsg);
    return false;
  }
}

/** 복장 이미지 부분 업데이트 공통 헬퍼 — 낙관적 반영 후 단일 update, 실패 시 필드 단위 롤백. applyCostumeUpdate 미러. */
async function applyCostumeImageUpdate(
  set: (partial: Partial<CharacterBoardStore>) => void,
  get: () => CharacterBoardStore,
  id: string,
  updates: Partial<Pick<CharacterCostumeImage, 'role' | 'label' | 'imageBackground' | 'imageFit' | 'isPrimary' | 'sortOrder'>>,
  errorMsg: string,
): Promise<boolean> {
  const prev = get().costumeImages;
  const prevImage = prev.find((i) => i.id === id);
  trackPendingFields(pendingCostumeImageFields, id, updates as Record<string, unknown>);
  const next = prev.map((i) => (i.id === id ? { ...i, ...updates } : i));
  set({ costumeImages: sortCostumeImages(next), imagesByCostume: rebuildImagesByCostume(get().imagesByCostume, next) });
  try {
    await svcUpdateCostumeImage(id, updates);
    return true;
  } catch (err) {
    console.error('[character-board] updateCostumeImage 실패:', err);
    // 이 업데이트가 바꾼 필드만, 아직 우리 낙관값 그대로일 때만 이전 값으로 되돌린다(중간 편집·실시간 머지 보존).
    if (prevImage) {
      const cur = get().costumeImages;
      const updRec = updates as unknown as Record<string, unknown>;
      const prevRec = prevImage as unknown as Record<string, unknown>;
      const reverted = cur.map((i) => {
        if (i.id !== id) return i;
        const curRec = i as unknown as Record<string, unknown>;
        const restored: Record<string, unknown> = { ...curRec };
        for (const k of Object.keys(updates)) {
          if (curRec[k] === updRec[k]) restored[k] = prevRec[k];
        }
        return restored as unknown as CharacterCostumeImage;
      });
      set({ costumeImages: sortCostumeImages(reverted), imagesByCostume: rebuildImagesByCostume(get().imagesByCostume, reverted) });
    }
    toast.error(errorMsg);
    return false;
  }
}

/**
 * primary 이미지 변경을 로컬 costumes.featured_* 에 즉시 반영(DB 쓰기 아님 — DB 트리거가 DB 를 확정).
 * mock/preview(realtime noop)·전파 지연에도 카드/썸네일이 곧바로 갱신되게 하고,
 * pending 으로 트리거발 realtime UPDATE 가 이 값을 되돌리지 않게 15초간 보호한다(코덱스 P2).
 */
function applyFeaturedLocal(
  set: (partial: Partial<CharacterBoardStore>) => void,
  get: () => CharacterBoardStore,
  costumeId: string,
  url: string | null,
  background?: CharacterCostume['imageBackground'],
  imageFit?: CharacterCostume['imageFit'],
): void {
  const prev = get().costumes;
  if (!prev.some((c) => c.id === costumeId)) return;
  const pending: Record<string, unknown> = { featuredImageUrl: url };
  if (background !== undefined) pending.imageBackground = background;
  if (imageFit !== undefined) pending.imageFit = imageFit;
  trackPendingFields(pendingCostumeFields, costumeId, pending);
  const next = prev.map((c) => (c.id === costumeId
    ? {
        ...c,
        featuredImageUrl: url,
        ...(background !== undefined ? { imageBackground: background } : {}),
        ...(imageFit !== undefined ? { imageFit } : {}),
      }
    : c));
  set({ costumes: next, byCharacter: rebuildByCharacter(get().byCharacter, next) });
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
