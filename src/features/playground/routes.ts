export type PreviewGame = 'tetris' | 'sudoku' | 'snake';

export type MarketRoute =
  | { kind: 'home'; focusRequest?: { target: 'all-stocks'; id: number } }
  | { kind: 'stock'; stockId: string }
  | { kind: 'account' };

export type PlaygroundReturnSurface = 'lobby' | 'house';

export type PlaygroundRoute =
  | { kind: 'lobby' }
  | { kind: 'house' }
  | { kind: 'coming-soon'; game: PreviewGame; returnTo: PlaygroundReturnSurface }
  | { kind: 'market'; page: MarketRoute; returnTo: PlaygroundReturnSurface };

export type PlaygroundAction =
  | { kind: 'go-lobby' }
  | { kind: 'return-to-source' }
  | { kind: 'open-house' }
  | { kind: 'open-game'; game: PreviewGame }
  | { kind: 'open-market' }
  | { kind: 'market-home'; focusRequest?: { target: 'all-stocks'; id: number } }
  | { kind: 'open-stock'; stockId: string }
  | { kind: 'open-account' };

export const initialPlaygroundRoute: PlaygroundRoute = { kind: 'lobby' };

export function getPlaygroundRouteIdentity(route: PlaygroundRoute): string {
  if (route.kind === 'lobby' || route.kind === 'house') {
    return JSON.stringify([route.kind]);
  }
  if (route.kind === 'coming-soon') {
    return JSON.stringify([route.kind, route.game, route.returnTo]);
  }
  if (route.page.kind === 'stock') {
    return JSON.stringify([route.kind, route.page.kind, route.page.stockId, route.returnTo]);
  }
  return JSON.stringify([route.kind, route.page.kind, route.returnTo]);
}

export function arePlaygroundRoutesSameSurface(
  left: PlaygroundRoute,
  right: PlaygroundRoute,
): boolean {
  return getPlaygroundRouteIdentity(left) === getPlaygroundRouteIdentity(right);
}

export function shouldReplacePlaygroundNavigation(
  _action: PlaygroundAction,
  current: PlaygroundRoute,
  next: PlaygroundRoute,
): boolean {
  return arePlaygroundRoutesSameSurface(current, next);
}

export function getPlaygroundReturnSurface(route: PlaygroundRoute): PlaygroundReturnSurface {
  if (route.kind === 'house') return 'house';
  if (route.kind === 'coming-soon' || route.kind === 'market') return route.returnTo;
  return 'lobby';
}

function surfaceRoute(surface: PlaygroundReturnSurface): PlaygroundRoute {
  return surface === 'house' ? { kind: 'house' } : { kind: 'lobby' };
}

export function navigatePlayground(
  current: PlaygroundRoute,
  action: PlaygroundAction,
): PlaygroundRoute {
  const returnTo = getPlaygroundReturnSurface(current);
  switch (action.kind) {
    case 'go-lobby':
      return { kind: 'lobby' };
    case 'return-to-source':
      return surfaceRoute(returnTo);
    case 'open-house':
      return { kind: 'house' };
    case 'open-game':
      return { kind: 'coming-soon', game: action.game, returnTo };
    case 'open-market':
      return { kind: 'market', page: { kind: 'home' }, returnTo };
    case 'market-home':
      return { kind: 'market', page: { kind: 'home', focusRequest: action.focusRequest }, returnTo };
    case 'open-stock':
      return { kind: 'market', page: { kind: 'stock', stockId: action.stockId }, returnTo };
    case 'open-account':
      return { kind: 'market', page: { kind: 'account' }, returnTo };
  }
}
