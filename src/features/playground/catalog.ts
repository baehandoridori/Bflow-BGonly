import type { PreviewGame } from './routes';

export type PlaygroundTone = 'mint' | 'lavender' | 'blue';

export interface PlaygroundGameDefinition {
  id: PreviewGame;
  koName: string;
  enName: string;
  heroTitle: readonly [string, string];
  heroMeta: string;
  heroReward: string;
  quickRecord: string;
  quickReward: string;
  stageReward: string;
  tone: PlaygroundTone;
}

export type PlaygroundQuickEntry =
  | { kind: 'game'; gameId: PreviewGame }
  | { kind: 'market'; id: 'market'; label: 'JBBJ 증권'; tone: 'blue' };

export type PlaygroundDockEntry = PlaygroundQuickEntry
  | { kind: 'disabled'; id: 'slots'; label: '슬롯머신'; status: '준비 중' };

export const GAME_DEFINITIONS: Record<PreviewGame, PlaygroundGameDefinition> = {
  tetris: {
    id: 'tetris', koName: '테트리스', enName: 'TETRIS',
    heroTitle: ['TETRIS', 'QUICK RUN'],
    heroMeta: '평균 4분 · 현재 최고 기록 18,420점',
    heroReward: '골드 등급부터 80 포인트를 획득합니다.',
    quickRecord: '최고 기록 18,420점', quickReward: 'GOLD +80 P',
    stageReward: '점수별 등급에 따라 최대 80 포인트를 받을 예정이에요.', tone: 'mint',
  },
  snake: {
    id: 'snake', koName: '스네이크', enName: 'SNAKE',
    heroTitle: ['SNAKE', 'ONE MORE RUN'],
    heroMeta: '평균 3분 · 현재 최고 길이 62',
    heroReward: '실버 등급부터 45 포인트를 획득합니다.',
    quickRecord: '최고 길이 62', quickReward: 'SILVER +45 P',
    stageReward: '길이별 등급에 따라 최대 45 포인트를 받을 예정이에요.', tone: 'lavender',
  },
  sudoku: {
    id: 'sudoku', koName: '스도쿠', enName: 'SUDOKU',
    heroTitle: ['SUDOKU', 'FOCUS MODE'],
    heroMeta: '평균 6분 · 현재 최고 기록 04:21',
    heroReward: '플래티넘 등급은 120 포인트를 획득합니다.',
    quickRecord: '최고 기록 04:21', quickReward: 'PLATINUM +120 P',
    stageReward: '완료 시간별 등급에 따라 최대 120 포인트를 받을 예정이에요.', tone: 'blue',
  },
};

export const PLAYABLE_GAMES = [
  GAME_DEFINITIONS.tetris,
  GAME_DEFINITIONS.snake,
  GAME_DEFINITIONS.sudoku,
] as const;

export const QUICK_ENTRIES: readonly PlaygroundQuickEntry[] = [
  { kind: 'game', gameId: 'tetris' },
  { kind: 'game', gameId: 'snake' },
  { kind: 'game', gameId: 'sudoku' },
  { kind: 'market', id: 'market', label: 'JBBJ 증권', tone: 'blue' },
];

export const HOUSE_DOCK_ENTRIES: readonly PlaygroundDockEntry[] = [
  { kind: 'game', gameId: 'tetris' },
  { kind: 'game', gameId: 'snake' },
  { kind: 'game', gameId: 'sudoku' },
  { kind: 'disabled', id: 'slots', label: '슬롯머신', status: '준비 중' },
  { kind: 'market', id: 'market', label: 'JBBJ 증권', tone: 'blue' },
];
