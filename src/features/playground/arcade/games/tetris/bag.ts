import { nextRandom } from '../prng.ts';
import type { TetrisPiece } from './types.ts';

const ALL_PIECES: readonly TetrisPiece[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

// 7-bag: 7종을 Fisher–Yates(주입 PRNG)로 셔플해 한 봉지를 만든다. 소진되면 재충전.
export function makeBag(rngState: number): { bag: TetrisPiece[]; rngState: number } {
  const bag = [...ALL_PIECES];
  let state = rngState;
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const draw = nextRandom(state);
    state = draw.next;
    const j = Math.floor(draw.value * (i + 1));
    const tmp = bag[i];
    bag[i] = bag[j];
    bag[j] = tmp;
  }
  return { bag, rngState: state };
}

// queue 를 최소 minLen 개 이상 채운다(Next 표시 보장). bag 이 비면 새 봉지로 재충전.
export function refillQueue(
  queue: readonly TetrisPiece[],
  bag: readonly TetrisPiece[],
  rngState: number,
  minLen: number,
): { queue: TetrisPiece[]; bag: TetrisPiece[]; rngState: number } {
  const nextQueue = [...queue];
  let nextBag = [...bag];
  let state = rngState;
  while (nextQueue.length < minLen) {
    if (nextBag.length === 0) {
      const made = makeBag(state);
      nextBag = made.bag;
      state = made.rngState;
    }
    nextQueue.push(nextBag.shift() as TetrisPiece);
  }
  return { queue: nextQueue, bag: nextBag, rngState: state };
}
