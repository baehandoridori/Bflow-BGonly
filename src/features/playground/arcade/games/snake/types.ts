export type SnakeDirection = 'up' | 'down' | 'left' | 'right';

export interface SnakePoint {
  readonly x: number;
  readonly y: number;
}

export interface SnakeApple {
  readonly pos: SnakePoint;
  readonly golden: boolean;
}

export type SnakeStatus = 'running' | 'dead';

export interface SnakeState {
  readonly grid: number; // 21
  readonly body: readonly SnakePoint[]; // 머리가 첫 번째
  readonly dir: SnakePoint; // 현재 진행 방향 벡터
  readonly queue: readonly SnakeDirection[]; // 최대 2개 예약
  readonly apple: SnakeApple;
  readonly eaten: number; // 먹은 사과 수
  readonly goldenEaten: number; // 먹은 골든 사과 수(meta 보고)
  readonly tickMs: number; // 현재 틱 간격
  readonly status: SnakeStatus;
  readonly length: number; // 점수 = 길이(성장은 즉시 반영, body 는 틱마다 따라붙음)
  readonly grow: number; // 남은 꼬리 유지 틱 수(성장 대기)
  readonly rngState: number; // 결정론 PRNG 상태
}
