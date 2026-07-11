import type { PreviewGame } from './routes';
import { PLAYABLE_GAMES } from './catalog.ts';

export interface RecommendationSession {
  current: PreviewGame;
  remaining: readonly PreviewGame[];
}

function shuffle(ids: readonly PreviewGame[], random: () => number): PreviewGame[] {
  const result = [...ids];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const sample = Math.max(0, Math.min(0.999999, random()));
    const swapIndex = Math.floor(sample * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function nextBag(random: () => number, previous?: PreviewGame): PreviewGame[] {
  const bag = shuffle(PLAYABLE_GAMES.map((game) => game.id), random);
  if (previous && bag[0] === previous && bag.length > 1) {
    [bag[0], bag[1]] = [bag[1], bag[0]];
  }
  return bag;
}

export function createRecommendationSession(
  random: () => number = Math.random,
): RecommendationSession {
  const [current, ...remaining] = nextBag(random);
  return { current, remaining };
}

export function advanceRecommendation(
  session: RecommendationSession,
  random: () => number = Math.random,
): RecommendationSession {
  if (session.remaining.length > 0) {
    const [current, ...remaining] = session.remaining;
    return { current, remaining };
  }
  const [current, ...remaining] = nextBag(random, session.current);
  return { current, remaining };
}
