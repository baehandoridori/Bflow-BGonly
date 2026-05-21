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
}));
