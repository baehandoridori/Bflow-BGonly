export type PreviewGame = 'tetris' | 'sudoku' | 'snake';

export type MarketRoute =
  | { kind: 'home'; focusRequest?: { target: 'all-stocks'; id: number } }
  | { kind: 'stock'; stockId: string }
  | { kind: 'account' };

export type PlaygroundRoute =
  | { kind: 'lobby' }
  | { kind: 'house' }
  | { kind: 'coming-soon'; game: PreviewGame }
  | { kind: 'market'; page: MarketRoute };

export type PlaygroundAction =
  | { kind: 'go-lobby' }
  | { kind: 'open-house' }
  | { kind: 'open-game'; game: PreviewGame }
  | { kind: 'open-market' }
  | { kind: 'market-home'; focusRequest?: { target: 'all-stocks'; id: number } }
  | { kind: 'open-stock'; stockId: string }
  | { kind: 'open-account' };

export const initialPlaygroundRoute: PlaygroundRoute = { kind: 'lobby' };

export function navigatePlayground(
  _current: PlaygroundRoute,
  action: PlaygroundAction,
): PlaygroundRoute {
  switch (action.kind) {
    case 'go-lobby':
      return { kind: 'lobby' };
    case 'open-house':
      return { kind: 'house' };
    case 'open-game':
      return { kind: 'coming-soon', game: action.game };
    case 'open-market':
      return { kind: 'market', page: { kind: 'home' } };
    case 'market-home':
      return { kind: 'market', page: { kind: 'home', focusRequest: action.focusRequest } };
    case 'open-stock':
      return { kind: 'market', page: { kind: 'stock', stockId: action.stockId } };
    case 'open-account':
      return { kind: 'market', page: { kind: 'account' } };
  }
}
