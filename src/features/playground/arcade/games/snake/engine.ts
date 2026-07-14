import { nextRandom } from '../prng.ts';
import type { SnakeApple, SnakeDirection, SnakePoint, SnakeState } from './types.ts';

// 스네이크 순수 엔진 — 규칙은 계획서 §Task 8 표가 정본.
// 21×21, 시작 길이 4(동쪽), 틱 160ms(사과당 −4, 하한 80), 방향 큐 최대 2,
// 5의 배수번째 사과는 골든(+2), 일반 +1. 모든 업데이트는 불변.

const GRID = 21;
const START_TICK_MS = 160;
const MIN_TICK_MS = 80;
const TICK_STEP_MS = 4;
const MAX_QUEUE = 2;

const VECTORS: Record<SnakeDirection, SnakePoint> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function isOpposite(a: SnakePoint, b: SnakePoint): boolean {
  return a.x === -b.x && a.y === -b.y;
}

function samePoint(a: SnakePoint, b: SnakePoint): boolean {
  return a.x === b.x && a.y === b.y;
}

// 빈 칸을 y·x 오름차순으로 모아 균등 선택. 스폰될 사과가 (eaten+1)번째이므로 5의 배수면 골든.
function spawnApple(
  body: readonly SnakePoint[],
  eaten: number,
  rngState: number,
): { apple: SnakeApple; rngState: number } {
  const occupied = new Set(body.map((p) => `${p.x},${p.y}`));
  const freeCells: SnakePoint[] = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (!occupied.has(`${x},${y}`)) freeCells.push({ x, y });
    }
  }
  const draw = nextRandom(rngState);
  // freeCells 는 호출부(stepSnake)에서 만석을 먼저 걸러 항상 1개 이상이다. 방어적으로 0 idx 를 하한한다.
  const idx = freeCells.length === 0
    ? 0
    : Math.min(freeCells.length - 1, Math.max(0, Math.floor(draw.value * freeCells.length)));
  const golden = (eaten + 1) % 5 === 0;
  return { apple: { pos: freeCells[idx] ?? body[0], golden }, rngState: draw.next };
}

export function createSnakeGame(seed: number): SnakeState {
  const body: SnakePoint[] = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
    { x: 7, y: 10 },
  ];
  const { apple, rngState } = spawnApple(body, 0, seed);
  return {
    grid: GRID,
    body,
    dir: VECTORS.right,
    queue: [],
    apple,
    eaten: 0,
    goldenEaten: 0,
    tickMs: START_TICK_MS,
    status: 'running',
    length: body.length,
    grow: 0,
    rngState,
  };
}

export function enqueueDirection(state: SnakeState, dir: SnakeDirection): SnakeState {
  if (state.status !== 'running') return state;
  if (state.queue.length >= MAX_QUEUE) return state; // 큐가 가득이면 무시
  return { ...state, queue: [...state.queue, dir] };
}

// 큐에서 1개 꺼내 방향 결정. 정반대면 버리고 그 틱은 기존 방향 유지(다음 것도 보지 않음).
function resolveDirection(
  dir: SnakePoint,
  queue: readonly SnakeDirection[],
): { dir: SnakePoint; queue: readonly SnakeDirection[] } {
  if (queue.length === 0) return { dir, queue };
  const next = VECTORS[queue[0]];
  const rest = queue.slice(1);
  if (isOpposite(next, dir)) return { dir, queue: rest };
  return { dir: next, queue: rest };
}

export function stepSnake(state: SnakeState): SnakeState {
  if (state.status !== 'running') return state;

  const { dir, queue } = resolveDirection(state.dir, state.queue);
  const head = state.body[0];
  const nextHead: SnakePoint = { x: head.x + dir.x, y: head.y + dir.y };

  const eating = samePoint(nextHead, state.apple.pos);

  // 죽음 판정: 벽 밖 / 몸(단, 이번 틱에 꼬리가 빠지는 칸은 제외). grow>0 또는 취식 시 꼬리 유지.
  const outOfBounds = nextHead.x < 0 || nextHead.x >= GRID || nextHead.y < 0 || nextHead.y >= GRID;
  const keepTail = state.grow > 0 || eating;
  const occupied = keepTail ? state.body : state.body.slice(0, -1);
  const hitsSelf = occupied.some((p) => samePoint(p, nextHead));
  if (outOfBounds || hitsSelf) {
    return { ...state, dir, queue, status: 'dead' };
  }

  let body = [nextHead, ...state.body];
  let grow = state.grow;
  let length = state.length;
  if (eating) {
    const growth = state.apple.golden ? 2 : 1;
    grow += growth;
    // 점수(길이)는 보드 칸 수(441)를 넘을 수 없다 — 마지막 칸이 골든(+2)이어도 만점은 441.
    length = Math.min(GRID * GRID, length + growth);
  }
  if (grow > 0) {
    grow -= 1; // 꼬리 유지(성장)
  } else {
    body = body.slice(0, -1); // 꼬리 제거(이동)
  }

  if (!eating) {
    return { ...state, dir, queue, body, grow, length };
  }

  const eaten = state.eaten + 1;
  const goldenEaten = state.goldenEaten + (state.apple.golden ? 1 : 0);
  const tickMs = Math.max(MIN_TICK_MS, state.tickMs - TICK_STEP_MS);
  // 보드를 가득 채우면(만점) 스폰할 빈 칸이 없다 — 여기서 판을 끝낸다(승리).
  if (body.length >= GRID * GRID) {
    return { ...state, dir, queue, body, grow, length, eaten, goldenEaten, tickMs, status: 'dead' };
  }
  const spawned = spawnApple(body, eaten, state.rngState);
  return {
    ...state,
    dir,
    queue,
    body,
    grow,
    length,
    eaten,
    goldenEaten,
    tickMs,
    apple: spawned.apple,
    rngState: spawned.rngState,
  };
}
