import { create } from 'zustand';
import type { WidgetLayoutItem, SheetsConfig } from '@/types';

export type ViewMode = 'dashboard' | 'episode' | 'scenes' | 'settings';

interface AppState {
  // 앱 모드
  isTestMode: boolean;
  setTestMode: (v: boolean) => void;

  // Google Sheets 연결 상태
  sheetsConnected: boolean;
  sheetsConfig: SheetsConfig | null;
  setSheetsConnected: (v: boolean) => void;
  setSheetsConfig: (config: SheetsConfig | null) => void;

  // 현재 뷰
  currentView: ViewMode;
  setView: (view: ViewMode) => void;

  // 위젯 레이아웃
  widgetLayout: WidgetLayoutItem[] | null;
  isEditMode: boolean;
  setWidgetLayout: (layout: WidgetLayoutItem[]) => void;
  setEditMode: (v: boolean) => void;

  // 필터 상태
  selectedEpisode: number | null;
  selectedPart: string | null;
  selectedAssignee: string | null;
  searchQuery: string;
  setSelectedEpisode: (ep: number | null) => void;
  setSelectedPart: (part: string | null) => void;
  setSelectedAssignee: (name: string | null) => void;
  setSearchQuery: (q: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isTestMode: false,
  setTestMode: (v) => set({ isTestMode: v }),

  sheetsConnected: false,
  sheetsConfig: null,
  setSheetsConnected: (v) => set({ sheetsConnected: v }),
  setSheetsConfig: (config) => set({ sheetsConfig: config }),

  currentView: 'dashboard',
  setView: (view) => set({ currentView: view }),

  widgetLayout: null,
  isEditMode: false,
  setWidgetLayout: (layout) => set({ widgetLayout: layout }),
  setEditMode: (v) => set({ isEditMode: v }),

  selectedEpisode: null,
  selectedPart: null,
  selectedAssignee: null,
  searchQuery: '',
  setSelectedEpisode: (ep) => set({ selectedEpisode: ep }),
  setSelectedPart: (part) => set({ selectedPart: part }),
  setSelectedAssignee: (name) => set({ selectedAssignee: name }),
  setSearchQuery: (q) => set({ searchQuery: q }),
}));
