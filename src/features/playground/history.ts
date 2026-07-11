import type { PlaygroundRoute } from './routes.ts';
import { arePlaygroundRoutesSameSurface } from './routes.ts';

export interface PlaygroundHistory {
  current(): PlaygroundRoute;
  push(route: PlaygroundRoute): void;
  replace(route: PlaygroundRoute): void;
  canGoBack(): boolean;
  back(): PlaygroundRoute | null;
}

export interface PlaygroundMarketRestoreRequest {
  id: number;
  scrollTop: number;
  openerId: string | null;
}

export function createPlaygroundHistory(initialRoute: PlaygroundRoute): PlaygroundHistory {
  const entries: PlaygroundRoute[] = [initialRoute];

  return {
    current: () => entries[entries.length - 1],
    push(route) {
      if (arePlaygroundRoutesSameSurface(entries[entries.length - 1], route)) return;
      entries.push(route);
    },
    replace(route) {
      entries[entries.length - 1] = route;
    },
    canGoBack: () => entries.length > 1,
    back() {
      if (entries.length <= 1) return null;
      entries.pop();
      return entries[entries.length - 1];
    },
  };
}

export type PlaygroundBackResult =
  | { kind: 'intercepted' }
  | { kind: 'blocked-mutation' }
  | { kind: 'blocked-transition' }
  | { kind: 'navigated'; route: PlaygroundRoute }
  | { kind: 'empty' };

export function requestPlaygroundBack({
  history,
  interceptOverlay,
  mutating,
  transitioning,
  beforeNavigate,
}: {
  history: PlaygroundHistory;
  interceptOverlay(): boolean;
  mutating: boolean;
  transitioning: boolean;
  beforeNavigate?(): void;
}): PlaygroundBackResult {
  if (interceptOverlay()) return { kind: 'intercepted' };
  if (mutating) return { kind: 'blocked-mutation' };
  if (transitioning) return { kind: 'blocked-transition' };
  beforeNavigate?.();
  const route = history.back();
  return route ? { kind: 'navigated', route } : { kind: 'empty' };
}
