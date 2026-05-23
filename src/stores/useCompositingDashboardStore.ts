/**
 * 컴포지팅 현황 대시보드 UI 상태.
 *
 * - 현재 보고 있는 EP / 뷰 모드 / 펼침 / 핀 / 필터 / 솔로·뮤트 / 호버
 * - 데이터(`compositing_states` 행) 자체는 useDataStore.compositingStates 에 저장,
 *   여기는 순수 UI 토글/선택 상태만 보관.
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (10. Store)
 */

import { create } from 'zustand';
import type { CompositingStatus } from '@/types';

/** 향후 matrix / cinema 확장 가능. MVP 는 timeline 고정. */
export type CompositingViewMode = 'timeline';

/** 안내 띠 노출 여부를 localStorage 에 영구 저장하는 키 */
const GUIDE_SEEN_KEY = 'bflow:compositing:guide-seen';

interface CompositingDashboardStore {
  /** 현재 보고 있는 EP. 진입 시 preferences.lastCompositingEpisode 로 초기화. */
  episodeNumber: number | null;

  /** 뷰 모드 (현재 timeline 고정) */
  viewMode: CompositingViewMode;

  /** 펼침/접힘 — 파트 ID set. 기본 모든 파트 접힘. */
  expandedParts: Set<string>;

  /** 1 클릭 핀 (씬 카드 옅게 강조). mergedKey 또는 sceneKey. */
  pinnedScene: string | null;

  /** 2 클릭 또는 더블 클릭으로 여는 상세 모달의 대상 씬. */
  detailScene: string | null;

  /** 상태 필터 (단일 선택, MVP). null 이면 전체. */
  statusFilter: CompositingStatus | null;

  /** 솔로 — 해당 씬만 강조, 다른 씬 dim. */
  soloScene: string | null;

  /** 뮤트 — 해당 씬 숨김 처리 (집합). */
  mutedScenes: Set<string>;

  /** 호버 중인 파트 (linked highlight 용). */
  hoveredPart: string | null;

  /** 핀된 파트 (호버 해제 후에도 강조 유지). */
  pinnedPart: string | null;

  /** 첫 진입 안내 띠 표시 여부. localStorage 플래그로 영구 dismiss. */
  guideStripVisible: boolean;

  /**
   * 사용자가 드래그로 지정한 파트 순서 (EP 별).
   * 키: episodeNumber, 값: partId 배열. 비어있으면 기본 (알파벳 순) 사용.
   * Timeline 패널에서 파트 행을 드래그하면 이 배열이 업데이트되어
   * Timeline / 카드 그리드 양쪽이 같은 순서로 재배치된다.
   */
  partsOrderByEpisode: Record<number, string[]>;

  /**
   * 일괄 선택된 씬 키 (Cmd/Ctrl 클릭, Shift 클릭, 드래그 박스로 추가).
   * Key = compositingKey(episodeNumber, sceneId).
   * Floating action bar 가 이 set 의 크기로 노출 여부 결정.
   */
  selectedSceneKeys: Set<string>;
  /** 마지막 단일 클릭으로 선택한 sceneKey — Shift+클릭 range 선택의 anchor. */
  lastSelectedSceneKey: string | null;

  // ─── Actions ───
  setEpisode: (n: number) => void;
  setViewMode: (mode: CompositingViewMode) => void;
  toggleExpand: (partId: string) => void;
  setPinnedScene: (key: string | null) => void;
  setDetailScene: (key: string | null) => void;
  setStatusFilter: (s: CompositingStatus | null) => void;
  toggleSolo: (sceneKey: string) => void;
  toggleMute: (sceneKey: string) => void;
  setHoveredPart: (p: string | null) => void;
  setPinnedPart: (p: string | null) => void;
  dismissGuideStrip: () => void;
  showGuideStrip: () => void;
  /** EP 별 파트 순서 지정. partIds 가 빈 배열이면 기본 순서로 reset. */
  setPartsOrder: (episodeNumber: number, partIds: string[]) => void;

  /** expandedParts 를 주어진 partId 들로 강제 set — EP 전환 시 새 EP partId 로 초기화. */
  resetExpandedParts: (partIds: string[]) => void;

  /** 일괄 선택 — 토글 (Cmd/Ctrl + 클릭). lastSelectedSceneKey 도 업데이트. */
  toggleSelectedScene: (sceneKey: string) => void;
  /** 일괄 선택 — 한 키만 선택 (단일 클릭, 기존 선택 모두 해제). */
  selectOnlyScene: (sceneKey: string) => void;
  /** 일괄 선택 — 여러 키 한 번에 set (드래그 박스 결과). */
  setSelectedSceneKeys: (keys: Set<string>) => void;
  /** 일괄 선택 — 추가 (드래그 박스 + Cmd 누름 시 기존 + 새 set). */
  addSelectedSceneKeys: (keys: string[]) => void;
  /** 일괄 선택 전체 해제. */
  clearSelectedScenes: () => void;
}

function readGuideSeen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeGuideSeen(seen: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (seen) localStorage.setItem(GUIDE_SEEN_KEY, '1');
    else localStorage.removeItem(GUIDE_SEEN_KEY);
  } catch {
    // localStorage 사용 불가 환경(시크릿 모드 등) — silent skip
  }
}

export const useCompositingDashboardStore = create<CompositingDashboardStore>((set) => ({
  episodeNumber: null,
  viewMode: 'timeline',
  expandedParts: new Set<string>(),
  pinnedScene: null,
  detailScene: null,
  statusFilter: null,
  soloScene: null,
  mutedScenes: new Set<string>(),
  hoveredPart: null,
  pinnedPart: null,
  guideStripVisible: !readGuideSeen(),
  partsOrderByEpisode: {},
  selectedSceneKeys: new Set<string>(),
  lastSelectedSceneKey: null,

  setEpisode: (n) => set({ episodeNumber: n }),
  setViewMode: (mode) => set({ viewMode: mode }),

  toggleExpand: (partId) =>
    set((state) => {
      const next = new Set(state.expandedParts);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return { expandedParts: next };
    }),

  setPinnedScene: (key) => set({ pinnedScene: key }),
  setDetailScene: (key) => set({ detailScene: key }),
  setStatusFilter: (s) => set({ statusFilter: s }),

  toggleSolo: (sceneKey) =>
    set((state) => ({
      soloScene: state.soloScene === sceneKey ? null : sceneKey,
    })),

  toggleMute: (sceneKey) =>
    set((state) => {
      const next = new Set(state.mutedScenes);
      if (next.has(sceneKey)) next.delete(sceneKey);
      else next.add(sceneKey);
      return { mutedScenes: next };
    }),

  setHoveredPart: (p) => set({ hoveredPart: p }),
  setPinnedPart: (p) => set({ pinnedPart: p }),

  dismissGuideStrip: () => {
    writeGuideSeen(true);
    set({ guideStripVisible: false });
  },

  showGuideStrip: () => {
    writeGuideSeen(false);
    set({ guideStripVisible: true });
  },

  setPartsOrder: (episodeNumber, partIds) =>
    set((state) => {
      const next = { ...state.partsOrderByEpisode };
      if (partIds.length === 0) {
        delete next[episodeNumber];
      } else {
        next[episodeNumber] = partIds;
      }
      return { partsOrderByEpisode: next };
    }),

  resetExpandedParts: (partIds) =>
    set({ expandedParts: new Set(partIds) }),

  toggleSelectedScene: (sceneKey) =>
    set((state) => {
      const next = new Set(state.selectedSceneKeys);
      if (next.has(sceneKey)) next.delete(sceneKey);
      else next.add(sceneKey);
      return { selectedSceneKeys: next, lastSelectedSceneKey: sceneKey };
    }),

  selectOnlyScene: (sceneKey) =>
    set({ selectedSceneKeys: new Set([sceneKey]), lastSelectedSceneKey: sceneKey }),

  setSelectedSceneKeys: (keys) =>
    set({ selectedSceneKeys: new Set(keys) }),

  addSelectedSceneKeys: (keys) =>
    set((state) => {
      const next = new Set(state.selectedSceneKeys);
      for (const k of keys) next.add(k);
      return { selectedSceneKeys: next };
    }),

  clearSelectedScenes: () => set({ selectedSceneKeys: new Set(), lastSelectedSceneKey: null }),
}));
