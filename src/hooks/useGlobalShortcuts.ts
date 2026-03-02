/**
 * 글로벌 키보드 단축키 훅
 * - preferences.json에서 커스텀 바인딩을 로드
 * - 단축키 → 액션 매핑을 전역 keydown 이벤트로 처리
 */

import { useEffect, useRef } from 'react';
import { useAppStore, type ViewMode } from '@/stores/useAppStore';
import { loadPreferences } from '@/services/settingsService';

/* ── 단축키 ID → 기본 키 (ShortcutsSection과 동기화) ── */

const DEFAULT_BINDINGS: Record<string, string> = {
  'spotlight':       'Ctrl+Space',
  'escape':          'Escape',
  'nav-dashboard':   'Ctrl+1',
  'nav-episode':     'Ctrl+2',
  'nav-scenes':      'Ctrl+3',
  'nav-assignee':    'Ctrl+4',
  'nav-team':        'Ctrl+5',
  'nav-timeline':    'Ctrl+6',
  'nav-calendar':    'Ctrl+7',
  'nav-vacation':    'Ctrl+8',
  'nav-settings':    'Ctrl+,',
  'edit-mode':       'Ctrl+E',
  'sidebar-toggle':  'Ctrl+B',
  'reload':          'Ctrl+R',
  'fullscreen':      'F11',
};

/** 뷰 전환 매핑 */
const NAV_MAP: Record<string, ViewMode> = {
  'nav-dashboard':  'dashboard',
  'nav-episode':    'episode',
  'nav-scenes':     'scenes',
  'nav-assignee':   'assignee',
  'nav-team':       'team',
  'nav-timeline':   'calendar',
  'nav-calendar':   'schedule',
  'nav-vacation':   'vacation',
  'nav-settings':   'settings',
};

/** KeyboardEvent → 'Ctrl+1' 형태 문자열 */
function eventToKeyString(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const key = e.key;
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return '';

  if (key === ' ') parts.push('Space');
  else if (key === ',') parts.push(',');
  else if (key.length === 1) parts.push(key.toUpperCase());
  else parts.push(key); // F1, F11, Escape, etc.

  return parts.join('+');
}

interface UseGlobalShortcutsOptions {
  /** 데이터 새로고침 콜백 (Ctrl+R) */
  onReload?: () => void;
}

export function useGlobalShortcuts({ onReload }: UseGlobalShortcutsOptions = {}) {
  const bindingsRef = useRef<Record<string, string>>({ ...DEFAULT_BINDINGS });
  // 역방향 맵: 'Ctrl+1' → 'nav-dashboard'
  const reverseRef = useRef<Map<string, string>>(new Map());

  const setView = useAppStore((s) => s.setView);
  const setEditMode = useAppStore((s) => s.setEditMode);
  const isEditMode = useAppStore((s) => s.isEditMode);
  const toggleSidebar = useAppStore((s) => s.toggleSidebarExpanded);

  // onReload을 ref로 유지 (의존성 깨지지 않게)
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;

  // 바인딩 로드 + 역방향 맵 구축 (설정 변경 시 자동 재로드)
  useEffect(() => {
    let cancelled = false;
    const loadBindings = async () => {
      const prefs = await loadPreferences();
      if (cancelled) return;
      const custom = prefs?.shortcuts ?? {};
      const merged = { ...DEFAULT_BINDINGS, ...custom };
      bindingsRef.current = merged;

      const reverse = new Map<string, string>();
      for (const [id, keys] of Object.entries(merged)) {
        reverse.set(keys, id);
      }
      reverseRef.current = reverse;
    };
    loadBindings();

    // ShortcutsSection에서 저장 시 재로드
    const onChanged = () => { loadBindings(); };
    window.addEventListener('bflow:shortcuts-changed', onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('bflow:shortcuts-changed', onChanged);
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 입력 필드에선 대부분 무시 (Escape, F11 등은 허용)
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || (document.activeElement as HTMLElement)?.isContentEditable;

      const keyStr = eventToKeyString(e);
      if (!keyStr) return;

      const id = reverseRef.current.get(keyStr);
      if (!id) return;

      // spotlight/escape는 커스텀 이벤트로 위임 (SpotlightSearch 등이 처리)
      if (id === 'spotlight') {
        window.dispatchEvent(new CustomEvent('bflow:spotlight-toggle', {
          detail: { originalEvent: e, isEditable },
        }));
        return;
      }
      if (id === 'escape') {
        window.dispatchEvent(new CustomEvent('bflow:escape', {
          detail: { originalEvent: e },
        }));
        return;
      }

      // 입력 필드에서는 뷰 전환/편집 단축키 무시 (F11, reload은 허용)
      if (isEditable && id !== 'fullscreen' && id !== 'reload') return;

      e.preventDefault();

      // 뷰 전환
      if (id in NAV_MAP) {
        setView(NAV_MAP[id]);
        return;
      }

      switch (id) {
        case 'edit-mode':
          setEditMode(!isEditMode);
          break;
        case 'sidebar-toggle':
          toggleSidebar();
          break;
        case 'reload':
          onReloadRef.current?.();
          break;
        case 'fullscreen':
          if (document.fullscreenElement) {
            document.exitFullscreen?.();
          } else {
            document.documentElement.requestFullscreen?.();
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setView, setEditMode, isEditMode, toggleSidebar]);
}
