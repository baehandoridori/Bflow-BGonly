/**
 * 팝업 창 → 본 창 화면 이동.
 *
 * 새 창으로 띄운 캘린더에는 캘린더 화면 하나만 있다. 그 안의 '휴가 화면으로', '씬으로 이동', '할일로 이동',
 * '설정에서 연동하기' 같은 버튼은 자기 창에서는 갈 곳이 없으므로, 본 창을 앞으로 가져와 그 화면을 열게 한다.
 * (팝업 → main 프로세스 → 본 창. `widget:navigate-main`·`widget:navigate-to-date` 와 같은 길이다.)
 */
// 타입은 상대 경로로 가져온다 — src/types/index.ts 가 이 파일의 타입을 쓰는데, 그 파일만 따로 타입 검사하는
// 테스트(tests/calendarIpcValidation.test.ts)에는 '@/' 별칭이 없다.
import type { ScenesDeptFilter } from '../types';
import { isWidgetPopupWindow } from './popupWindow.ts';

export type WidgetViewNavigation =
  | { view: 'vacation' }
  | { view: 'settings' }
  | { view: 'dashboard'; todoId?: string }
  | {
    view: 'scenes';
    episodeNumber?: number;
    partId?: string;
    department?: ScenesDeptFilter;
    highlightSceneId?: string;
    toastMessage?: string;
  };

/**
 * 팝업 창이면 본 창에 화면 이동을 부탁하고 true 를 돌려준다(호출한 쪽은 자기 창에서 이동하지 않는다).
 * 본 창이면 아무것도 하지 않고 false — 호출한 쪽이 하던 대로 이동한다.
 */
export function requestMainWindowView(navigation: WidgetViewNavigation): boolean {
  if (!isWidgetPopupWindow()) return false;
  void window.electronAPI?.widgetNavigateView?.(navigation);
  return true;
}

const DEPARTMENTS: readonly string[] = ['bg', 'acting', 'all'];

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 값이 없는(undefined) 키를 뺀다 — 받는 쪽은 '키가 없음'을 '건드리지 않음'으로 읽는다(navigateToSceneView). */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** 본 창이 받은 이동 요청을 확인한다. 아는 화면·맞는 타입만 통과시키고, 그 밖의 값은 null. */
export function parseWidgetViewNavigation(raw: unknown): WidgetViewNavigation | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  switch (value.view) {
    case 'vacation':
    case 'settings':
      return { view: value.view };
    case 'dashboard':
      return withoutUndefined<WidgetViewNavigation>({ view: 'dashboard', todoId: nonEmptyString(value.todoId) });
    case 'scenes':
      return withoutUndefined<WidgetViewNavigation>({
        view: 'scenes',
        episodeNumber: typeof value.episodeNumber === 'number' && Number.isFinite(value.episodeNumber)
          ? value.episodeNumber
          : undefined,
        partId: nonEmptyString(value.partId),
        department: typeof value.department === 'string' && DEPARTMENTS.includes(value.department)
          ? value.department as ScenesDeptFilter
          : undefined,
        highlightSceneId: nonEmptyString(value.highlightSceneId),
        toastMessage: nonEmptyString(value.toastMessage),
      });
    default:
      return null;
  }
}
