import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatHeaderPoints } from '../src/components/layout/headerPointsFormat.ts';
import { buildPointRanking, type RankingTeammate } from '../src/features/playground/ranking.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const badgeSource = readFileSync(path.join(root, 'src', 'components', 'layout', 'HeaderPointsBadge.tsx'), 'utf8');
const rankingSource = readFileSync(path.join(root, 'src', 'features', 'playground', 'ranking.ts'), 'utf8');

test('formatHeaderPoints renders ko-KR thousands with a P suffix', () => {
  assert.equal(formatHeaderPoints(1_234_567), '1,234,567 P');
  assert.equal(formatHeaderPoints(0), '0 P');
  assert.equal(formatHeaderPoints(20), '20 P');
});

test('formatHeaderPoints falls back to a dash for missing or invalid values', () => {
  assert.equal(formatHeaderPoints(null), '— P');
  assert.equal(formatHeaderPoints(Number.NaN), '— P');
});

test('the header badge gates on playground access and enters the playground on click', () => {
  assert.match(badgeSource, /canAccessPlayground\(currentUser\)/);
  assert.match(badgeSource, /if \(!canAccess\) return null;/);
  assert.match(badgeSource, /setView\('playground'\)/);
  assert.match(badgeSource, /'— P'/);
  assert.match(badgeSource, /tabular-nums/);
  assert.match(badgeSource, /aria-label=/);
  // 획득 연출(펄스/플로팅)은 PR B 이므로 아직 framer-motion 을 끌어오지 않는다.
  assert.doesNotMatch(badgeSource, /framer-motion/);
});

const teammate = (id: string, name: string, lifetimeEarnedPoints: number | null): RankingTeammate => ({
  id,
  name,
  lifetimeEarnedPoints,
});

test('buildPointRanking ranks the current user first when they lead', () => {
  const model = buildPointRanking(
    { id: 'me', name: '배한솔', walletPoints: 12_500, lifetimeEarnedPoints: 5_000 },
    [teammate('minji', '민지', 4_920), teammate('doyoon', '도윤', 3_860)],
  );
  assert.equal(model.status, 'ready');
  assert.equal(model.current.rank, 1);
  assert.equal(model.rankLabel, '#1');
  assert.equal(model.statusText, '현재 포인트 1위예요');
  assert.equal(model.balanceLabel, '12,500 P');
});

test('buildPointRanking reports the gap to the next rank up', () => {
  const model = buildPointRanking(
    { id: 'me', name: '배한솔', walletPoints: 3_000, lifetimeEarnedPoints: 3_000 },
    [teammate('minji', '민지', 4_920)],
  );
  assert.equal(model.current.rank, 2);
  assert.equal(model.statusText, '앞 순위까지 1,920P 남았어요');
});

test('buildPointRanking flags a tie and keeps the shared status copy', () => {
  const model = buildPointRanking(
    { id: 'me', name: '배한솔', walletPoints: 4_920, lifetimeEarnedPoints: 4_920 },
    [teammate('doyoon', '도윤', 5_000), teammate('minji', '민지', 4_920)],
  );
  assert.notEqual(model.current.rank, 1);
  assert.equal(model.statusText, '동점이에요 · 이름순으로 표시 중');
});

test('teammates without a wallet drop to the bottom in name order with null rank', () => {
  const model = buildPointRanking(
    { id: 'me', name: '배한솔', walletPoints: 5_000, lifetimeEarnedPoints: 5_000 },
    [teammate('a', '하늘', null), teammate('b', '가람', null), teammate('minji', '민지', 4_920)],
  );
  const tail = model.entries.slice(-2);
  assert.deepEqual(tail.map((entry) => entry.name), ['가람', '하늘']);
  assert.deepEqual(tail.map((entry) => entry.points), [null, null]);
  assert.deepEqual(tail.map((entry) => entry.rank), [null, null]);
  // 점수 있는 두 명은 정상 랭크
  assert.equal(model.entries[0]?.rank, 1);
  assert.equal(model.entries[1]?.rank, 2);
});

test('buildPointRanking is unavailable until the current wallet loads', () => {
  const model = buildPointRanking(
    { id: 'me', name: '배한솔', walletPoints: null, lifetimeEarnedPoints: null },
    [teammate('minji', '민지', 4_920)],
  );
  assert.equal(model.status, 'unavailable');
  assert.equal(model.rankLabel, '순위 계산 중');
  assert.equal(model.balanceLabel, '— P');
  assert.equal(model.current.rank, null);
});

test('the hardcoded teammate fixture is gone from ranking.ts', () => {
  assert.doesNotMatch(rankingSource, /TEAMMATES/);
  assert.doesNotMatch(rankingSource, /'민지'|4920/);
});
