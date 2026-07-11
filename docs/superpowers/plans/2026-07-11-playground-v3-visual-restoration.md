# 배플레이그라운드 v3 비주얼 복원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 `playground-interactions-v3.html`의 A안 로비·C안 JBBJ 하우스·게임별 무대를 실제 React 프리뷰로 복원하면서 현재 증권 기능과 클릭 지점 도트 전환을 보존한다.

**Architecture:** `PlaygroundView`만 인증·시장 store와 내부 route를 소유하고, 추천·랭킹·복귀·전환 정책은 순수 함수로 분리한다. 표현 계층은 공통 셸/헤더, A 로비, C 하우스, 게임 아트로 나누고 전용 CSS container query로 1440·1024·390px을 처리한다. 승인 HTML과 최종 screenshot/DOM geometry를 함께 보존하여 문자열 존재 테스트만으로 완료를 판단하지 않는다.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3, 전용 CSS container queries, Zustand, Lucide React, Node `node:test`, Vite, Codex in-app Browser

## Global Constraints

- 개발 worktree는 `C:\Bflow-BGonly\.worktrees\jbbj-market-preview`, branch는 `codex/jbbj-market-preview`다.
- `/home/user/Bflow` 참고 레포는 읽기만 하고 수정하지 않는다.
- 승인 시각 기준은 `C:\Bflow-BGonly\.superpowers\brainstorm\1373-1783705059\content\playground-interactions-v3.html`이다.
- 외부 Visual Lab 설명, 가짜 창 프레임, 목업용 사이드바는 실제 앱에 복제하지 않는다.
- 랜덤 추천 대상은 테트리스·스네이크·스도쿠 세 게임뿐이다. JBBJ 증권은 quick card와 House dock에서만 연다.
- JBBJ 증권 메인·종목 상세·내 계좌의 현재 기능과 store 계산은 변경하지 않는다.
- 로비·하우스·게임 준비 화면은 글로벌 테마와 무관하게 승인 목업의 다크 아케이드 색을 쓴다.
- 게임·증권 진입만 클릭 지점 도트 전환을 쓰고 A↔C와 이전 surface 복귀는 짧은 surface 전환을 쓴다.
- reduced-motion 도트 전환은 입자 0개와 총 220ms crossfade를 유지하고 surface 전환은 즉시 완료한다.
- 로비/하우스 fixture는 영구 저장, Electron IPC, Supabase, 서비스 계층에 접근하지 않는다.
- UI 컴포넌트에 store를 직접 연결하지 않는다. `PlaygroundView`가 props로 전달한다.
- 실제 게임 로직, 슬롯 베팅, 실시간 랭킹/접속자/챌린지 백엔드는 범위 밖이다.
- 새 dependency와 package version bump를 추가하지 않는다.
- Tasks 1~6은 각각 focused tests, `npm run test:playground`, `npm run typecheck`를 통과한다. Task 7은 추가로 `npm run build:vite`를 통과한다.
- 커밋은 한국어로 작성하고 각 Task의 명시된 파일만 stage한다.

## File Map

### Tracked design evidence

- Create: `docs/superpowers/mockups/2026-07-11-playground-interactions-v3.html` — 승인 HTML의 byte-for-byte 보존본
- Create: `docs/superpowers/mockups/2026-07-11-playground-v3-comparison.md` — viewport별 geometry와 screenshot 비교 기록
- Create: `docs/superpowers/mockups/2026-07-11-playground-v3-reference-1440.png` — 승인 HTML 내부 app screenshot
- Create: `docs/superpowers/mockups/2026-07-11-playground-v3-actual-1440.png` — 실제 React app screenshot

### Pure feature contracts

- Create: `src/features/playground/catalog.ts` — 세 게임과 quick/dock entry의 정확한 copy·tone·status
- Modify: `src/features/playground/recommendation.ts` — 세 게임 shuffle bag session
- Create: `src/features/playground/ranking.ts` — teammate fixture와 현재 사용자의 결정적 포인트 순위
- Modify: `src/features/playground/routes.ts` — `returnTo`를 포함하는 game/market route
- Create: `src/features/playground/transition/playgroundTransitionPolicy.ts` — action별 dot/surface/none 정책과 target copy
- Modify: `src/features/playground/transition/usePlaygroundEntryStore.ts` — dot request target 저장
- Modify: `src/features/playground/transition/dotWipeMath.ts` — reduced-motion frame 순수 함수
- Modify: `src/features/playground/transition/DotWipeTransition.tsx` — target별 dark palette와 두 줄 copy

### Presentation components

- Create: `src/views/playground/PlaygroundShell.tsx` — 공통 다크 surface와 local header frame
- Create: `src/views/playground/PlaygroundHeader.tsx` — back/House/points/rank header
- Create: `src/views/playground/PlaygroundGameArt.tsx` — hero/icon/stage art
- Create: `src/views/playground/PlaygroundRecommendationHero.tsx` — non-nested hero actions
- Create: `src/views/playground/PlaygroundGameCard.tsx` — 네 quick entry 카드
- Create: `src/views/playground/PlaygroundRankingRail.tsx` — wallet/ranking/House teaser
- Modify: `src/views/playground/PlaygroundLobby.tsx` — v3 A안 1.72:0.68 layout
- Modify: `src/views/playground/JbbjHouse.tsx` — challenge/podium/five dock C안
- Modify: `src/views/playground/ComingSoonGame.tsx` — 게임별 준비 무대
- Create: `src/views/playground/playground.css` — semantic tokens, art, container queries, surface motion
- Modify: `src/views/PlaygroundView.tsx` — stores/session/routes/transition integration

### Tests and gates

- Create: `tests/playgroundPresentation.test.ts` — catalog, shuffle bag, ranking
- Create: `tests/playgroundV3UiWiring.test.ts` — component/CSS structural contract
- Modify: `tests/playgroundRoutes.test.ts` — return surface route contract
- Modify: `tests/playgroundTransition.test.ts` — target copy/palette/policy/reduced motion
- Modify: `tests/playgroundMarketUiWiring.test.ts` — integration wiring and return source
- Modify: `package.json` — two new Playground tests in `test:playground`

---

### Task 1: 승인 목업과 순수 로비 모델 고정

**Files:**
- Create: `docs/superpowers/mockups/2026-07-11-playground-interactions-v3.html`
- Create: `src/features/playground/catalog.ts`
- Modify: `src/features/playground/recommendation.ts`
- Create: `src/features/playground/ranking.ts`
- Create: `tests/playgroundPresentation.test.ts`
- Modify: `tests/playgroundRoutes.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `GAME_DEFINITIONS`, `PLAYABLE_GAMES`, `QUICK_ENTRIES`, `HOUSE_DOCK_ENTRIES`
- Produces: `RecommendationSession`, `createRecommendationSession()`, `advanceRecommendation()`
- Produces: `PointRankingModel`, `buildPointRanking()`
- Consumes: `PreviewGame` from `src/features/playground/routes.ts`

- [ ] **Step 1: Write the failing catalog, shuffle-bag, and ranking tests**

Create `tests/playgroundPresentation.test.ts` with executable assertions rather than source-string-only checks:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GAME_DEFINITIONS,
  HOUSE_DOCK_ENTRIES,
  PLAYABLE_GAMES,
  QUICK_ENTRIES,
} from '../src/features/playground/catalog.ts';
import {
  advanceRecommendation,
  createRecommendationSession,
} from '../src/features/playground/recommendation.ts';
import { buildPointRanking } from '../src/features/playground/ranking.ts';

test('approved catalog recommends only the three playable games', () => {
  assert.deepEqual(PLAYABLE_GAMES.map((game) => game.id), ['tetris', 'snake', 'sudoku']);
  assert.deepEqual(QUICK_ENTRIES.map((entry) => entry.kind === 'game' ? entry.gameId : entry.id), [
    'tetris', 'snake', 'sudoku', 'market',
  ]);
  assert.deepEqual(HOUSE_DOCK_ENTRIES.map((entry) => entry.kind === 'game' ? entry.gameId : entry.id), [
    'tetris', 'snake', 'sudoku', 'slots', 'market',
  ]);
  assert.equal(GAME_DEFINITIONS.tetris.heroMeta, '평균 4분 · 현재 최고 기록 18,420점');
  assert.equal(GAME_DEFINITIONS.snake.heroReward, '실버 등급부터 45 포인트를 획득합니다.');
  assert.equal(GAME_DEFINITIONS.sudoku.quickReward, 'PLATINUM +120 P');
});

test('one shuffled bag shows all three games before refill', () => {
  const randomValues = [0.99, 0, 0.5, 0.25];
  let cursor = 0;
  const random = () => randomValues[cursor++] ?? 0;
  const first = createRecommendationSession(random);
  const second = advanceRecommendation(first, random);
  const third = advanceRecommendation(second, random);
  assert.equal(new Set([first.current, second.current, third.current]).size, 3);
  const refill = advanceRecommendation(third, random);
  assert.notEqual(refill.current, third.current);
});

test('ranking is dynamic, deterministic, and never invents zero while unavailable', () => {
  const fourth = buildPointRanking({ id: 'me', name: '한솔', points: 2480 });
  assert.equal(fourth.current.rank, 4);
  assert.equal(fourth.statusText, '앞 순위까지 340P 남았어요');

  const first = buildPointRanking({ id: 'me', name: '한솔', points: 5000 });
  assert.equal(first.current.rank, 1);
  assert.equal(first.statusText, '현재 포인트 1위예요');

  const tied = buildPointRanking({ id: 'me', name: '한솔', points: 2820 });
  assert.match(tied.statusText, /동점이에요/);

  const unavailable = buildPointRanking({ id: 'me', name: '한솔', points: null });
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.balanceLabel, '— P');
  assert.equal(unavailable.current.rank, null);
  assert.equal(unavailable.entries.filter((entry) => entry.points !== null).length, 4);
});
```

- [ ] **Step 2: Run the new test and verify red state**

Run:

```powershell
node --test ./tests/playgroundPresentation.test.ts
```

Expected: FAIL because `catalog.ts` and `ranking.ts` do not exist and the current recommendation helper has no session API.

- [ ] **Step 3: Preserve the approved HTML and implement the exact catalog**

Mechanically copy the approved asset without editing its contents:

```powershell
Copy-Item -LiteralPath 'C:\Bflow-BGonly\.superpowers\brainstorm\1373-1783705059\content\playground-interactions-v3.html' -Destination 'docs\superpowers\mockups\2026-07-11-playground-interactions-v3.html'
```

Create `src/features/playground/catalog.ts`:

```ts
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
```

- [ ] **Step 4: Replace one-shot recommendation with a session shuffle bag**

Replace `src/features/playground/recommendation.ts` with:

```ts
import type { PreviewGame } from './routes';
import { PLAYABLE_GAMES } from './catalog';

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
```

- [ ] **Step 5: Implement deterministic point ranking and unavailable state**

Create `src/features/playground/ranking.ts`:

```ts
interface RankingFixture { id: string; name: string; points: number }
export interface PointRankingEntry {
  id: string;
  name: string;
  points: number | null;
  rank: number | null;
  isCurrentUser: boolean;
}
export interface PointRankingModel {
  status: 'ready' | 'unavailable';
  entries: readonly PointRankingEntry[];
  current: PointRankingEntry;
  balanceLabel: string;
  rankLabel: string;
  statusText: string;
}

const TEAMMATES: readonly RankingFixture[] = [
  { id: 'minji', name: '민지', points: 4920 },
  { id: 'doyoon', name: '도윤', points: 3860 },
  { id: 'seoa', name: '서아', points: 2820 },
  { id: 'yujin', name: '유진', points: 2115 },
];
const collator = new Intl.Collator('ko-KR');

export function buildPointRanking(user: {
  id: string;
  name: string;
  points: number | null;
}): PointRankingModel {
  if (user.points === null) {
    const teammates = TEAMMATES.map((entry, index) => ({
      ...entry, rank: index + 1, isCurrentUser: false,
    }));
    const current: PointRankingEntry = {
      ...user, rank: null, isCurrentUser: true,
    };
    return {
      status: 'unavailable', entries: [...teammates, current], current,
      balanceLabel: '— P', rankLabel: '순위 계산 중', statusText: '순위 계산 중',
    };
  }

  const sorted = [
    ...TEAMMATES.map((entry) => ({ ...entry, isCurrentUser: false })),
    { ...user, points: user.points, isCurrentUser: true },
  ].sort((left, right) => (
    right.points - left.points || collator.compare(left.id, right.id)
  ));
  const entries = sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
  const current = entries.find((entry) => entry.isCurrentUser)!;
  const previous = current.rank === 1 ? null : entries[current.rank - 2];
  const tied = entries.some((entry) => !entry.isCurrentUser && entry.points === current.points);
  const statusText = current.rank === 1
    ? '현재 포인트 1위예요'
    : tied
      ? '동점이에요 · 이름순으로 표시 중'
      : `앞 순위까지 ${(previous!.points! - current.points!).toLocaleString('ko-KR')}P 남았어요`;
  return {
    status: 'ready', entries, current,
    balanceLabel: `${user.points.toLocaleString('ko-KR')} P`,
    rankLabel: `#${current.rank}`,
    statusText,
  };
}
```

- [ ] **Step 6: Register the presentation test and remove the obsolete generic recommendation assertion**

In `tests/playgroundRoutes.test.ts`, remove the `pickRecommendation` import and the last generic randomness test. In `package.json`, set `test:playground` to include the new test immediately after routes:

```json
"test:playground": "node --test ./tests/playgroundNavigationWiring.test.ts ./tests/playgroundTransition.test.ts ./tests/playgroundRoutes.test.ts ./tests/playgroundPresentation.test.ts ./tests/playgroundMarketDomain.test.ts ./tests/playgroundMarketPreviewStore.test.ts ./tests/playgroundMarketUiWiring.test.ts ./tests/playgroundMarketTheme.test.ts"
```

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
node --test ./tests/playgroundPresentation.test.ts ./tests/playgroundRoutes.test.ts
npm run test:playground
npm run typecheck
```

Expected: presentation, full Playground gate and TypeScript PASS. The v3 UI test is not registered until its Task 3 implementation exists.

Commit:

```powershell
git add docs/superpowers/mockups/2026-07-11-playground-interactions-v3.html src/features/playground/catalog.ts src/features/playground/recommendation.ts src/features/playground/ranking.ts tests/playgroundPresentation.test.ts tests/playgroundRoutes.test.ts package.json
git commit -m "승인 목업과 플레이그라운드 로비 모델 고정"
```

---

### Task 2: 복귀 surface와 목표별 도트 전환 계약

**Files:**
- Modify: `src/features/playground/routes.ts`
- Create: `src/features/playground/transition/playgroundTransitionPolicy.ts`
- Modify: `src/features/playground/transition/usePlaygroundEntryStore.ts`
- Modify: `src/features/playground/transition/dotWipeMath.ts`
- Modify: `src/features/playground/transition/DotWipeTransition.tsx`
- Modify: `tests/playgroundRoutes.test.ts`
- Modify: `tests/playgroundTransition.test.ts`

**Interfaces:**
- Produces: `PlaygroundReturnSurface`, route-level `returnTo`, `return-to-source`
- Produces: `DotWipeTarget`, `PlaygroundNavigationTransition`, `getPlaygroundNavigationTransition()`
- Produces: `getDotWipePresentation()`, `getReducedMotionFrame()`
- Consumes: `PlaygroundAction`, `PreviewGame`, `Point`

- [ ] **Step 1: Write failing executable route, transition policy, and reduced-motion tests**

Extend `tests/playgroundRoutes.test.ts`:

```ts
test('game and market remember whether lobby or house opened them', () => {
  const house = navigatePlayground(initialPlaygroundRoute, { kind: 'open-house' });
  const houseGame = navigatePlayground(house, { kind: 'open-game', game: 'tetris' });
  assert.deepEqual(houseGame, { kind: 'coming-soon', game: 'tetris', returnTo: 'house' });
  assert.deepEqual(navigatePlayground(houseGame, { kind: 'return-to-source' }), { kind: 'house' });

  const lobbyMarket = navigatePlayground(initialPlaygroundRoute, { kind: 'open-market' });
  assert.deepEqual(lobbyMarket, { kind: 'market', page: { kind: 'home' }, returnTo: 'lobby' });
  const detail = navigatePlayground(lobbyMarket, { kind: 'open-stock', stockId: 'jbbj' });
  assert.equal(detail.kind === 'market' ? detail.returnTo : null, 'lobby');
});
```

Extend `tests/playgroundTransition.test.ts` imports and assertions:

```ts
import { getReducedMotionFrame } from '../src/features/playground/transition/dotWipeMath.ts';
import {
  getDotWipePresentation,
  getPlaygroundNavigationTransition,
} from '../src/features/playground/transition/playgroundTransitionPolicy.ts';

test('only game and market entry use target-specific dot wipes', () => {
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'open-house' }), { mode: 'surface' });
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'go-lobby' }), { mode: 'surface' });
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'return-to-source' }), { mode: 'surface' });
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'open-game', game: 'snake' }), {
    mode: 'dot', target: 'snake',
  });
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'open-market' }), {
    mode: 'dot', target: 'market',
  });
  assert.deepEqual(getPlaygroundNavigationTransition({ kind: 'open-account' }), { mode: 'none' });
});

test('dot target copy and palette are exact', () => {
  assert.deepEqual(getDotWipePresentation('tetris'), {
    eyebrow: 'BAE PLAYGROUND', label: 'LOADING TETRIS',
    accessibleLabel: 'BAE PLAYGROUND / LOADING TETRIS',
    palette: { cover: '#07090d', text: '#ffffff', accent: '#45e0b5' },
  });
  assert.equal(getDotWipePresentation('market').label, 'OPENING JBBJ MARKET');
  assert.equal(getDotWipePresentation('playground-entry').label, '지금은 쉬는 시간!');
});

test('reduced motion is a zero-particle 220ms crossfade', () => {
  assert.deepEqual(getReducedMotionFrame(0), { opacity: 0, shouldCommit: false, shouldFinish: false });
  assert.deepEqual(getReducedMotionFrame(110), { opacity: 1, shouldCommit: true, shouldFinish: false });
  assert.deepEqual(getReducedMotionFrame(220), { opacity: 0, shouldCommit: true, shouldFinish: true });
});
```

- [ ] **Step 2: Run the focused tests and verify red state**

Run:

```powershell
node --test ./tests/playgroundRoutes.test.ts ./tests/playgroundTransition.test.ts
```

Expected: FAIL because `returnTo`, `return-to-source`, transition policy, and `getReducedMotionFrame` do not exist.

- [ ] **Step 3: Make routes carry their source surface**

Update `src/features/playground/routes.ts` around the public unions and reducer:

```ts
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

export function getPlaygroundReturnSurface(route: PlaygroundRoute): PlaygroundReturnSurface {
  if (route.kind === 'house') return 'house';
  if (route.kind === 'coming-soon' || route.kind === 'market') return route.returnTo;
  return 'lobby';
}

function surfaceRoute(surface: PlaygroundReturnSurface): PlaygroundRoute {
  return surface === 'house' ? { kind: 'house' } : { kind: 'lobby' };
}

export function navigatePlayground(current: PlaygroundRoute, action: PlaygroundAction): PlaygroundRoute {
  const returnTo = getPlaygroundReturnSurface(current);
  switch (action.kind) {
    case 'go-lobby': return { kind: 'lobby' };
    case 'return-to-source': return surfaceRoute(returnTo);
    case 'open-house': return { kind: 'house' };
    case 'open-game': return { kind: 'coming-soon', game: action.game, returnTo };
    case 'open-market': return { kind: 'market', page: { kind: 'home' }, returnTo };
    case 'market-home': return { kind: 'market', page: { kind: 'home', focusRequest: action.focusRequest }, returnTo };
    case 'open-stock': return { kind: 'market', page: { kind: 'stock', stockId: action.stockId }, returnTo };
    case 'open-account': return { kind: 'market', page: { kind: 'account' }, returnTo };
  }
}
```

In the same step, update every pre-existing market expectation in `tests/playgroundRoutes.test.ts` to include `returnTo: 'lobby'` unless House opened it. Keep full-object assertions; do not weaken them to partial matching.

- [ ] **Step 4: Add target-aware transition policy**

Create `src/features/playground/transition/playgroundTransitionPolicy.ts`:

```ts
import type { PlaygroundAction, PreviewGame } from '../routes';

export type DotWipeTarget = 'playground-entry' | PreviewGame | 'market';
export interface DotWipePresentation {
  eyebrow: string | null;
  label: string;
  accessibleLabel: string;
  palette: { cover: string; text: string; accent: string };
}
export type PlaygroundNavigationTransition =
  | { mode: 'dot'; target: Exclude<DotWipeTarget, 'playground-entry'> }
  | { mode: 'surface' }
  | { mode: 'none' };

const PALETTE = { cover: '#07090d', text: '#ffffff', accent: '#45e0b5' } as const;
const LABELS: Record<DotWipeTarget, { eyebrow: string | null; label: string }> = {
  'playground-entry': { eyebrow: null, label: '지금은 쉬는 시간!' },
  tetris: { eyebrow: 'BAE PLAYGROUND', label: 'LOADING TETRIS' },
  snake: { eyebrow: 'BAE PLAYGROUND', label: 'LOADING SNAKE' },
  sudoku: { eyebrow: 'BAE PLAYGROUND', label: 'LOADING SUDOKU' },
  market: { eyebrow: 'BAE PLAYGROUND', label: 'OPENING JBBJ MARKET' },
};

export function getDotWipePresentation(target: DotWipeTarget): DotWipePresentation {
  const copy = LABELS[target];
  return {
    ...copy,
    accessibleLabel: copy.eyebrow ? `${copy.eyebrow} / ${copy.label}` : copy.label,
    palette: { ...PALETTE },
  };
}

export function getPlaygroundNavigationTransition(
  action: PlaygroundAction,
): PlaygroundNavigationTransition {
  if (action.kind === 'open-game') return { mode: 'dot', target: action.game };
  if (action.kind === 'open-market') return { mode: 'dot', target: 'market' };
  if (action.kind === 'open-house' || action.kind === 'go-lobby' || action.kind === 'return-to-source') {
    return { mode: 'surface' };
  }
  return { mode: 'none' };
}
```

- [ ] **Step 5: Store the target on every dot request**

Update `src/features/playground/transition/usePlaygroundEntryStore.ts`:

```ts
import { create } from 'zustand';
import type { Point } from './dotWipeMath';
import type { DotWipeTarget } from './playgroundTransitionPolicy';

export interface DotWipeRequest { id: number; origin: Point; target: DotWipeTarget }

interface PlaygroundEntryState {
  active: DotWipeRequest | null;
  request(origin: Point): void;
  finish(id: number): void;
}

export const usePlaygroundEntryStore = create<PlaygroundEntryState>((set, get) => ({
  active: null,
  request(origin) {
    if (get().active) return;
    set({ active: { id: Date.now(), origin, target: 'playground-entry' } });
  },
  finish(id) {
    if (get().active?.id === id) set({ active: null });
  },
}));
```

Internal requests created by `PlaygroundView` in Task 6 must include the target from `getPlaygroundNavigationTransition()`.

- [ ] **Step 6: Extract reduced-motion timing into a pure function**

Add to `src/features/playground/transition/dotWipeMath.ts`:

```ts
export const REDUCED_MOTION_TOTAL_MS = 220;

export interface ReducedMotionFrame {
  opacity: number;
  shouldCommit: boolean;
  shouldFinish: boolean;
}

export function getReducedMotionFrame(elapsedMs: number): ReducedMotionFrame {
  const elapsed = Math.max(0, elapsedMs);
  const midpoint = REDUCED_MOTION_TOTAL_MS / 2;
  if (elapsed >= REDUCED_MOTION_TOTAL_MS) {
    return { opacity: 0, shouldCommit: true, shouldFinish: true };
  }
  if (elapsed >= midpoint) {
    return {
      opacity: 1 - (elapsed - midpoint) / midpoint,
      shouldCommit: true,
      shouldFinish: false,
    };
  }
  return { opacity: elapsed / midpoint, shouldCommit: false, shouldFinish: false };
}
```

In `DotWipeTransition.tsx`, remove `label?: string` from `DotWipeTransitionProps`, remove the `label = '지금은 쉬는 시간!'` parameter, remove the private `REDUCED_MOTION_TOTAL_MS`, import the helper, resolve `const presentation = getDotWipePresentation(request.target)`, and replace the theme background block with:

```ts
const fillColor = presentation.palette.cover;
```

Replace the reduced-motion opacity math with:

```ts
const frame = getReducedMotionFrame(performance.now() - startedAt);
overlay.style.opacity = String(frame.opacity);
if (frame.shouldCommit) commitOnce();
if (frame.shouldFinish) {
  finishOnce();
  return;
}
rafId = window.requestAnimationFrame(renderReducedMotionFrame);
```

Replace the status pill with target-aware markup:

```tsx
<div
  role="status"
  aria-live="polite"
  aria-label={presentation.accessibleLabel}
  className="pointer-events-none absolute inset-0 z-10 grid place-content-center text-center"
>
  {presentation.eyebrow && (
    <span className="font-mono text-[10px] font-bold tracking-[0.16em]" style={{ color: presentation.palette.accent }}>
      {presentation.eyebrow}
    </span>
  )}
  <strong className="mt-2 text-2xl tracking-[-0.04em]" style={{ color: presentation.palette.text }}>
    {presentation.label}
  </strong>
</div>
```

Add `request.target` and the three palette values to the effect dependency list. Keep the existing exactly-once gate, Escape, hidden-window, resize/DPR and safety-timeout code unchanged.

- [ ] **Step 7: Run focused tests and commit**

Run:

```powershell
node --test ./tests/playgroundRoutes.test.ts ./tests/playgroundTransition.test.ts
npm run test:playground
npm run typecheck
```

Expected: all route, transition, exactly-once, hidden-window, DPR, reduced-motion, full Playground and TypeScript checks PASS.

Commit:

```powershell
git add src/features/playground/routes.ts src/features/playground/transition/playgroundTransitionPolicy.ts src/features/playground/transition/usePlaygroundEntryStore.ts src/features/playground/transition/dotWipeMath.ts src/features/playground/transition/DotWipeTransition.tsx tests/playgroundRoutes.test.ts tests/playgroundTransition.test.ts
git commit -m "플레이그라운드 복귀 경로와 목표별 도트 전환 고정"
```

---

### Task 3: Playground 공통 셸·헤더·container 기반 CSS

**Files:**
- Create: `src/views/playground/PlaygroundHeader.tsx`
- Create: `src/views/playground/PlaygroundShell.tsx`
- Create: `src/views/playground/playground.css`
- Modify: `tests/playgroundV3UiWiring.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PointRankingModel` from Task 1
- Produces: `PlaygroundHeaderProps`, `PlaygroundShellProps`
- Produces: `data-pg-shell`, `data-pg-header`, `data-pg-surface` geometry anchors
- Produces: named CSS container `playground`

- [ ] **Step 1: Create the shell test with exact header and CSS contracts**

Create `tests/playgroundV3UiWiring.test.ts` with:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Playground owns a local header and named inline-size container', () => {
  const shell = readFileSync('src/views/playground/PlaygroundShell.tsx', 'utf8');
  const header = readFileSync('src/views/playground/PlaygroundHeader.tsx', 'utf8');
  const css = readFileSync('src/views/playground/playground.css', 'utf8');
  assert.match(shell, /data-pg-shell/);
  assert.match(shell, /data-pg-surface/);
  assert.match(shell, /<PlaygroundHeader/);
  assert.match(header, /data-pg-header/);
  assert.match(header, /JBBJ 하우스/);
  assert.match(header, /ranking\.balanceLabel/);
  assert.match(header, /ranking\.rankLabel/);
  assert.match(css, /container:\s*playground\s*\/\s*inline-size/);
  assert.match(css, /@container playground \(max-width: 970px\)/);
  assert.match(css, /@container playground \(max-width: 619px\)/);
  assert.match(css, /min-height:\s*88px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
```

- [ ] **Step 2: Run the UI wiring test and verify red state**

Run:

```powershell
node --test ./tests/playgroundV3UiWiring.test.ts
```

Expected: FAIL because the shell, header and CSS files do not exist.

- [ ] **Step 3: Implement a pure local header**

Create `src/views/playground/PlaygroundHeader.tsx`:

```tsx
import { ArrowLeft, Building2 } from 'lucide-react';

import type { PointRankingModel } from '@/features/playground/ranking';

export interface PlaygroundHeaderProps {
  titleId: string;
  title: string;
  description: string;
  backLabel?: '게임 로비' | 'JBBJ 하우스';
  onBack?: () => void;
  showHouse: boolean;
  onOpenHouse?: () => void;
  ranking: PointRankingModel;
}

export function PlaygroundHeader({
  titleId,
  title,
  description,
  backLabel,
  onBack,
  showHouse,
  onOpenHouse,
  ranking,
}: PlaygroundHeaderProps) {
  return (
    <header className="pg-header" data-pg-header>
      <div className="pg-header__identity">
        {backLabel && onBack && (
          <button type="button" className="pg-header__back" onClick={onBack}>
            <ArrowLeft aria-hidden="true" size={16} />
            <span>{backLabel}</span>
          </button>
        )}
        <div className="pg-header__copy">
          <h2 id={titleId} tabIndex={-1}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <div className="pg-header__actions">
        {showHouse && onOpenHouse && (
          <button type="button" className="pg-header__house" onClick={onOpenHouse}>
            <span className="pg-online-dot" aria-hidden="true" />
            <Building2 aria-hidden="true" size={16} />
            <strong>JBBJ 하우스</strong>
            <span className="pg-header__online-copy">4명 접속 중</span>
          </button>
        )}
        <div className="pg-header__balance" aria-label={`현재 보유 포인트 ${ranking.balanceLabel}, ${ranking.rankLabel}`}>
          <strong>{ranking.balanceLabel} · {ranking.rankLabel}</strong>
          <span>현재 보유 포인트</span>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Implement the persistent shell**

Create `src/views/playground/PlaygroundShell.tsx`:

```tsx
import type { ReactNode } from 'react';

import { PlaygroundHeader, type PlaygroundHeaderProps } from './PlaygroundHeader';
import './playground.css';

export interface PlaygroundShellProps {
  header: PlaygroundHeaderProps;
  surfaceKey: string;
  children: ReactNode;
}

export function PlaygroundShell({ header, surfaceKey, children }: PlaygroundShellProps) {
  return (
    <section className="playground-shell" data-pg-shell aria-labelledby={header.titleId}>
      <PlaygroundHeader {...header} />
      <div key={surfaceKey} className="pg-surface pg-surface-enter" data-pg-surface>
        {children}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add exact dark tokens, shell layout, container queries, and reduced motion**

Create `src/views/playground/playground.css` with this base contract. Later tasks append lobby/House/art selectors to the same file.

```css
.playground-shell {
  --pg-bg: 15 17 23;
  --pg-panel: 26 29 39;
  --pg-panel-2: 32 36 49;
  --pg-line: 45 48 65;
  --pg-text: 232 232 238;
  --pg-muted: 139 141 163;
  --pg-accent: 108 92 231;
  --pg-lavender: 162 155 254;
  --pg-mint: 69 224 181;
  --pg-green: 0 184 148;
  --pg-blue: 116 185 255;
  --pg-yellow: 253 203 110;
  container: playground / inline-size;
  display: flex;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  color: rgb(var(--pg-text));
  background:
    radial-gradient(circle at 11% -6%, rgb(var(--pg-accent) / 0.18), transparent 31rem),
    radial-gradient(circle at 94% 4%, rgb(var(--pg-green) / 0.10), transparent 28rem),
    rgb(var(--pg-bg));
}

.pg-header {
  z-index: 10;
  display: flex;
  min-height: 56px;
  flex: 0 0 56px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 1px solid rgb(var(--pg-line) / 0.9);
  padding: 0 19px;
  background: rgb(var(--pg-bg) / 0.94);
}

.pg-header__identity,
.pg-header__actions,
.pg-header__back,
.pg-header__house {
  display: flex;
  min-width: 0;
  align-items: center;
}

.pg-header__identity { gap: 10px; }
.pg-header__actions { gap: 7px; }

.pg-header__copy h2 {
  margin: 0;
  color: rgb(var(--pg-text));
  font-size: 14px;
  font-weight: 750;
}

.pg-header__copy p {
  margin: 2px 0 0;
  color: rgb(var(--pg-muted));
  font-size: 11px;
}

.pg-header__back,
.pg-header__house {
  min-height: 44px;
  cursor: pointer;
  border-radius: 10px;
  border: 1px solid rgb(var(--pg-line));
  padding: 0 11px;
  color: rgb(var(--pg-text));
  background: rgb(var(--pg-panel) / 0.85);
  transition: border-color 180ms ease, background-color 180ms ease;
}

.pg-header__back { gap: 7px; }
.pg-header__house {
  gap: 7px;
  border-color: rgb(var(--pg-mint) / 0.24);
  color: rgb(var(--pg-mint));
  background: rgb(var(--pg-green) / 0.09);
}

.pg-header__back:hover,
.pg-header__house:hover { border-color: rgb(var(--pg-lavender) / 0.65); }

.pg-online-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: rgb(var(--pg-mint));
  box-shadow: 0 0 10px rgb(var(--pg-mint) / 0.8);
}

.pg-header__online-copy { color: rgb(var(--pg-mint) / 0.7); font-size: 11px; }

.pg-header__balance {
  min-width: 118px;
  border: 1px solid rgb(var(--pg-lavender) / 0.22);
  border-radius: 10px;
  padding: 7px 10px;
  text-align: right;
  background: rgb(var(--pg-accent) / 0.11);
}

.pg-header__balance strong {
  display: block;
  color: rgb(var(--pg-text));
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.pg-header__balance span { color: rgb(var(--pg-lavender) / 0.78); font-size: 10px; }

.pg-header button:focus-visible,
.playground-shell button:focus-visible {
  outline: 3px solid rgb(var(--pg-lavender));
  outline-offset: 3px;
}

.pg-surface {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.pg-surface-enter { animation: pg-surface-enter 220ms cubic-bezier(.16, 1, .3, 1) both; }

@keyframes pg-surface-enter {
  from { opacity: 0; transform: translateX(18px); }
  to { opacity: 1; transform: none; }
}

@container playground (max-width: 970px) {
  .pg-header__copy p,
  .pg-header__online-copy { display: none; }
}

@container playground (max-width: 619px) {
  .pg-header {
    min-height: 88px;
    flex-basis: auto;
    align-items: stretch;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 8px 10px;
  }
  .pg-header__identity { min-height: 36px; flex: 1 1 auto; }
  .pg-header__actions { min-width: 0; flex: 1 0 100%; }
  .pg-header__balance { min-width: 0; flex: 1; text-align: left; }
  .pg-header__balance span { display: none; }
  .pg-header__house { margin-left: auto; padding-inline: 10px; }
  .pg-header__house strong { font-size: 12px; }
  .pg-header__back span { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .pg-surface-enter { animation: none; }
  .playground-shell *,
  .playground-shell *::before,
  .playground-shell *::after { scroll-behavior: auto !important; }
}
```

- [ ] **Step 6: Register and run the structural test**

Add `./tests/playgroundV3UiWiring.test.ts` to `test:playground` immediately after `playgroundPresentation.test.ts`, then run:

```powershell
node --test ./tests/playgroundV3UiWiring.test.ts
npm run test:playground
npm run typecheck
```

Expected: shell/CSS contract, full Playground gate and TypeScript PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/views/playground/PlaygroundHeader.tsx src/views/playground/PlaygroundShell.tsx src/views/playground/playground.css tests/playgroundV3UiWiring.test.ts package.json
git commit -m "플레이그라운드 전용 셸과 반응형 헤더 복원"
```

---

### Task 4: A안 로비의 랜덤 hero·네 quick card·랭킹 레일

**Files:**
- Create: `src/views/playground/playgroundActivation.ts`
- Create: `src/views/playground/PlaygroundGameArt.tsx`
- Create: `src/views/playground/PlaygroundRecommendationHero.tsx`
- Create: `src/views/playground/PlaygroundGameCard.tsx`
- Create: `src/views/playground/PlaygroundRankingRail.tsx`
- Modify: `src/views/playground/PlaygroundLobby.tsx`
- Modify: `src/views/playground/playground.css`
- Modify: `tests/playgroundV3UiWiring.test.ts`

**Interfaces:**
- Consumes: `PlaygroundGameDefinition`, `PlaygroundQuickEntry`, `PointRankingModel`
- Produces: `PlaygroundLobbyProps` with pure callbacks and no store import
- Produces: `data-pg-lobby`, `data-pg-hero`, `data-pg-quick-card`, `data-pg-ranking` anchors

- [ ] **Step 1: Add failing A-lobby structure and accessibility assertions**

Append to `tests/playgroundV3UiWiring.test.ts`:

```ts
test('A lobby keeps the approved hero, four quick cards, ranking rail and non-nested actions', () => {
  const lobby = readFileSync('src/views/playground/PlaygroundLobby.tsx', 'utf8');
  const hero = readFileSync('src/views/playground/PlaygroundRecommendationHero.tsx', 'utf8');
  const card = readFileSync('src/views/playground/PlaygroundGameCard.tsx', 'utf8');
  const rail = readFileSync('src/views/playground/PlaygroundRankingRail.tsx', 'utf8');
  const css = readFileSync('src/views/playground/playground.css', 'utf8');
  assert.match(lobby, /data-pg-lobby/);
  assert.match(lobby, /QUICK_ENTRIES\.map/);
  assert.match(hero, /data-pg-hero/);
  assert.match(hero, /바로 플레이/);
  assert.match(hero, /다른 추천/);
  assert.doesNotMatch(hero, /<button[^>]*data-pg-hero/);
  assert.match(card, /data-pg-quick-card/);
  assert.match(rail, /data-pg-ranking/);
  assert.match(rail, /JBBJ 하우스에서 진행 중/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.72fr\)\s+minmax\(220px,\s*\.68fr\)/);
  assert.match(css, /min-height:\s*240px/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
});

test('only PlaygroundView may read auth and market stores', () => {
  for (const file of [
    'src/views/playground/PlaygroundLobby.tsx',
    'src/views/playground/PlaygroundRecommendationHero.tsx',
    'src/views/playground/PlaygroundGameCard.tsx',
    'src/views/playground/PlaygroundRankingRail.tsx',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /useAuthStore|useMarketPreviewStore/, file);
  }
});
```

- [ ] **Step 2: Run the UI test and verify red state**

Run:

```powershell
node --test ./tests/playgroundV3UiWiring.test.ts
```

Expected: FAIL because the hero/card/rail/art files and approved selectors do not exist.

- [ ] **Step 3: Add shared click-origin conversion**

Create `src/views/playground/playgroundActivation.ts`:

```ts
import type { MouseEvent } from 'react';
import { originFromActivation, type Point } from '@/features/playground/transition/dotWipeMath';

export function pointFromButtonActivation(event: MouseEvent<HTMLButtonElement>): Point {
  return originFromActivation(
    event.clientX,
    event.clientY,
    event.detail,
    event.currentTarget.getBoundingClientRect(),
  );
}
```

- [ ] **Step 4: Implement reusable game art**

Create `src/views/playground/PlaygroundGameArt.tsx`:

```tsx
import type { PreviewGame } from '@/features/playground/routes';

const TETRIS_HERO = new Set([0, 1, 2, 8, 9, 15, 16, 17, 23, 24, 25, 30, 31, 38, 39, 40, 44, 45]);
const TETRIS_STAGE = new Set([92, 93, 101, 102, 103, 111, 112, 120, 121, 122, 123, 130, 131, 132, 133, 134]);
const SUDOKU_NUMBERS = ['4', '7', '2', '6', '1', '9', '8', '3', '5'] as const;
const SNAKE_SEGMENTS = [
  [18, 54], [26, 54], [34, 54], [42, 54], [50, 54], [58, 54], [58, 46], [58, 38], [66, 38],
] as const;

export interface PlaygroundGameArtProps {
  game: PreviewGame;
  variant: 'hero' | 'icon' | 'stage';
}

export function PlaygroundGameArt({ game, variant }: PlaygroundGameArtProps) {
  if (variant === 'icon') {
    if (game === 'tetris') return <span className="pg-icon-art pg-icon-art--tetris" aria-hidden="true"><i /><i /><i /><i /></span>;
    if (game === 'snake') return <span className="pg-icon-art pg-icon-art--snake" aria-hidden="true" />;
    return <span className="pg-icon-art pg-icon-art--sudoku" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} />)}</span>;
  }

  if (variant === 'stage') {
    if (game === 'tetris') {
      return <div className="pg-stage-art pg-stage-art--tetris" aria-hidden="true">{Array.from({ length: 140 }, (_, index) => <i key={index} className={TETRIS_STAGE.has(index) ? 'is-on' : ''} />)}</div>;
    }
    if (game === 'snake') {
      return <div className="pg-stage-art pg-stage-art--snake" aria-hidden="true">{SNAKE_SEGMENTS.map(([left, top]) => <i key={`${left}-${top}`} style={{ left: `${left}%`, top: `${top}%` }} />)}</div>;
    }
    return <div className="pg-stage-art pg-stage-art--sudoku" aria-hidden="true">{Array.from({ length: 81 }, (_, index) => <i key={index} className={index % 4 === 0 ? 'is-given' : ''}>{index % 4 === 0 ? SUDOKU_NUMBERS[index % 9] : ''}</i>)}</div>;
  }

  if (game === 'tetris') {
    return <div className="pg-hero-art pg-hero-art--tetris" aria-hidden="true">{Array.from({ length: 49 }, (_, index) => <i key={index} className={TETRIS_HERO.has(index) ? 'is-on' : ''} />)}</div>;
  }
  if (game === 'snake') return <div className="pg-hero-art pg-hero-art--snake" aria-hidden="true" />;
  return <div className="pg-hero-art pg-hero-art--sudoku" aria-hidden="true">{SUDOKU_NUMBERS.map((value) => <i key={value}>{value}</i>)}</div>;
}
```

- [ ] **Step 5: Implement the hero without nested buttons**

Create `src/views/playground/PlaygroundRecommendationHero.tsx`:

```tsx
import { Shuffle } from 'lucide-react';
import type { PlaygroundGameDefinition } from '@/features/playground/catalog';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { PlaygroundGameArt } from './PlaygroundGameArt';
import { pointFromButtonActivation } from './playgroundActivation';

export interface PlaygroundRecommendationHeroProps {
  game: PlaygroundGameDefinition;
  onPlay: (origin: Point) => void;
  onShuffle: () => void;
}

export function PlaygroundRecommendationHero({ game, onPlay, onShuffle }: PlaygroundRecommendationHeroProps) {
  return (
    <section className={`pg-hero pg-tone--${game.tone}`} data-pg-hero aria-labelledby="pg-hero-title">
      <div className="pg-hero__copy">
        <span className="pg-tag pg-tag--live">RANDOM PICK</span>
        <h3 id="pg-hero-title"><span>{game.heroTitle[0]}</span><span>{game.heroTitle[1]}</span></h3>
        <p>{game.heroMeta}<br />{game.heroReward}</p>
        <div className="pg-hero__actions">
          <button type="button" className="pg-hero__play" onClick={(event) => onPlay(pointFromButtonActivation(event))}>
            바로 플레이
          </button>
          <button type="button" className="pg-hero__shuffle" onClick={onShuffle}>
            <Shuffle aria-hidden="true" size={14} /> 다른 추천
          </button>
        </div>
        <span className="sr-only" aria-live="polite">현재 추천 {game.koName}</span>
      </div>
      <PlaygroundGameArt game={game.id} variant="hero" />
    </section>
  );
}
```

- [ ] **Step 6: Implement quick cards and the ranking rail**

Create `src/views/playground/PlaygroundGameCard.tsx`:

```tsx
import { Landmark } from 'lucide-react';
import { GAME_DEFINITIONS, type PlaygroundQuickEntry } from '@/features/playground/catalog';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { PlaygroundGameArt } from './PlaygroundGameArt';
import { pointFromButtonActivation } from './playgroundActivation';

export interface PlaygroundGameCardProps {
  entry: PlaygroundQuickEntry;
  marketCashPoints: number | null;
  onActivate: (entry: PlaygroundQuickEntry, origin: Point) => void;
}

export function PlaygroundGameCard({ entry, marketCashPoints, onActivate }: PlaygroundGameCardProps) {
  const game = entry.kind === 'game' ? GAME_DEFINITIONS[entry.gameId] : null;
  const tone = entry.kind === 'game' ? game!.tone : entry.tone;
  const label = entry.kind === 'game' ? game!.koName : entry.label;
  const badge = entry.kind === 'game' ? game!.quickReward : 'OPEN';
  const detail = entry.kind === 'game'
    ? game!.quickRecord
    : marketCashPoints === null
      ? '예수금 확인 중'
      : `예수금 ${marketCashPoints.toLocaleString('ko-KR')} P`;
  return (
    <button type="button" data-pg-quick-card className={`pg-quick-card pg-tone--${tone}`} onClick={(event) => onActivate(entry, pointFromButtonActivation(event))}>
      <span className="pg-quick-card__top">
        <span className="pg-quick-card__icon">
          {game ? <PlaygroundGameArt game={game.id} variant="icon" /> : <Landmark aria-hidden="true" size={22} />}
        </span>
        <span className={game ? 'pg-reward' : 'pg-tag pg-tag--open'}>{badge}</span>
      </span>
      <strong>{label}</strong>
      <span>{detail}</span>
    </button>
  );
}
```

Create `src/views/playground/PlaygroundRankingRail.tsx`:

```tsx
import type { PointRankingModel } from '@/features/playground/ranking';

export interface PlaygroundRankingRailProps {
  ranking: PointRankingModel;
  onOpenHouse: () => void;
}

export function PlaygroundRankingRail({ ranking, onOpenHouse }: PlaygroundRankingRailProps) {
  return (
    <aside className="pg-ranking" data-pg-ranking aria-labelledby="pg-ranking-title">
      <div className="pg-ranking__head"><h3 id="pg-ranking-title">포인트 랭킹</h3><span>현재 잔액 기준</span></div>
      <div className="pg-wallet"><small>MY BALANCE</small><strong>{ranking.balanceLabel}</strong><p>{ranking.statusText}</p></div>
      <ol className="pg-ranking__list">
        {ranking.entries.map((entry) => (
          <li key={entry.id} className={entry.isCurrentUser ? 'is-me' : ''}>
            <b>{entry.rank === null ? '—' : String(entry.rank).padStart(2, '0')}</b>
            <span>{entry.name}{entry.isCurrentUser ? ' · 나' : ''}</span>
            <span>{entry.points === null ? '—' : entry.points.toLocaleString('ko-KR')}</span>
          </li>
        ))}
      </ol>
      <button type="button" className="pg-house-teaser" onClick={onOpenHouse}>
        <span><b>JBBJ 하우스에서 진행 중</b><i className="pg-online-dot" aria-hidden="true" /></span>
        <small>테트리스 팀 챌린지 68%<br />현재 4명이 쉬고 있어요.</small>
      </button>
    </aside>
  );
}
```

- [ ] **Step 7: Rebuild `PlaygroundLobby` around the approved A layout**

Replace `src/views/playground/PlaygroundLobby.tsx` with:

```tsx
import { GAME_DEFINITIONS, QUICK_ENTRIES, type PlaygroundQuickEntry } from '@/features/playground/catalog';
import type { PreviewGame } from '@/features/playground/routes';
import type { PointRankingModel } from '@/features/playground/ranking';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { PlaygroundGameCard } from './PlaygroundGameCard';
import { PlaygroundRankingRail } from './PlaygroundRankingRail';
import { PlaygroundRecommendationHero } from './PlaygroundRecommendationHero';

export interface PlaygroundLobbyProps {
  userName: string;
  recommendation: PreviewGame;
  ranking: PointRankingModel;
  marketCashPoints: number | null;
  onShuffle: () => void;
  onPlayGame: (game: PreviewGame, origin: Point) => void;
  onOpenMarket: (origin: Point) => void;
  onOpenHouse: () => void;
}

export function PlaygroundLobby(props: PlaygroundLobbyProps) {
  const activate = (entry: PlaygroundQuickEntry, origin: Point) => {
    if (entry.kind === 'game') props.onPlayGame(entry.gameId, origin);
    else props.onOpenMarket(origin);
  };
  return (
    <div className="pg-lobby" data-pg-lobby>
      <main className="pg-lobby__main">
        <header className="pg-welcome">
          <div><small>PLAY · REST · COMPETE</small><h3>{props.userName}님, 잠깐 놀다 갈까요?</h3></div>
          <span className="pg-rank-pill">포인트 랭킹 <b>{props.ranking.rankLabel}</b></span>
        </header>
        <PlaygroundRecommendationHero game={GAME_DEFINITIONS[props.recommendation]} onPlay={(origin) => props.onPlayGame(props.recommendation, origin)} onShuffle={props.onShuffle} />
        <div className="pg-quick-grid">{QUICK_ENTRIES.map((entry) => <PlaygroundGameCard key={entry.kind === 'game' ? entry.gameId : entry.id} entry={entry} marketCashPoints={props.marketCashPoints} onActivate={activate} />)}</div>
      </main>
      <PlaygroundRankingRail ranking={props.ranking} onOpenHouse={props.onOpenHouse} />
    </div>
  );
}
```

- [ ] **Step 8: Append exact lobby, hero, art, quick-card and rail CSS**

Append to `src/views/playground/playground.css`:

```css
.pg-lobby { display: grid; grid-template-columns: minmax(0, 1.72fr) minmax(220px, .68fr); gap: 13px; min-height: 100%; padding: 16px; }
.pg-lobby__main { min-width: 0; }
.pg-welcome { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; margin-bottom: 12px; }
.pg-welcome small { color: rgb(var(--pg-mint)); font: 700 10px/1 ui-monospace, Consolas, monospace; letter-spacing: .14em; }
.pg-welcome h3 { margin: 7px 0 0; color: rgb(var(--pg-text)); font-size: clamp(24px, 2.5cqw, 34px); letter-spacing: -.045em; }
.pg-rank-pill { flex: 0 0 auto; border: 1px solid rgb(var(--pg-line)); border-radius: 10px; padding: 9px 11px; color: rgb(var(--pg-muted)); background: rgb(var(--pg-panel)); font-size: 12px; }
.pg-rank-pill b { color: rgb(var(--pg-text)); font-size: 15px; }
.pg-tone--mint { --pg-tone: var(--pg-mint); --pg-tone-deep: var(--pg-green); }
.pg-tone--lavender { --pg-tone: var(--pg-lavender); --pg-tone-deep: var(--pg-accent); }
.pg-tone--blue { --pg-tone: var(--pg-blue); --pg-tone-deep: 65 126 190; }
.pg-hero { position: relative; min-height: 240px; overflow: hidden; border: 1px solid rgb(var(--pg-line)); border-radius: 17px; padding: 23px; background: linear-gradient(135deg, rgb(var(--pg-panel)), rgb(var(--pg-panel-2)) 58%, rgb(var(--pg-tone-deep) / .32) 132%); }
.pg-hero::before { position: absolute; top: -95px; right: -65px; width: 330px; height: 330px; border-radius: 50%; background: radial-gradient(circle, rgb(var(--pg-tone) / .23), transparent 65%); content: ''; }
.pg-hero__copy { position: relative; z-index: 2; max-width: 390px; }
.pg-tag { display: inline-flex; min-height: 24px; align-items: center; border-radius: 6px; padding: 0 8px; font: 800 10px/1 ui-monospace, Consolas, monospace; }
.pg-tag--live, .pg-tag--open { color: rgb(var(--pg-mint)); background: rgb(var(--pg-green) / .12); }
.pg-hero h3 { margin: 14px 0 9px; color: rgb(var(--pg-text)); font-size: clamp(38px, 4.3cqw, 58px); line-height: .88; letter-spacing: -.065em; }
.pg-hero h3 span { display: block; }
.pg-hero p { margin: 0 0 18px; color: rgb(var(--pg-muted)); font-size: 14px; line-height: 1.6; }
.pg-hero__actions { display: flex; align-items: center; gap: 8px; }
.pg-hero__play, .pg-hero__shuffle { min-height: 44px; cursor: pointer; border-radius: 9px; padding: 0 14px; font-size: 13px; font-weight: 800; }
.pg-hero__play { border: 0; color: rgb(var(--pg-bg)); background: rgb(var(--pg-tone)); box-shadow: 0 9px 27px rgb(var(--pg-tone) / .16); }
.pg-hero__shuffle { display: inline-flex; align-items: center; gap: 7px; border: 1px solid rgb(255 255 255 / .12); color: rgb(var(--pg-text)); background: rgb(var(--pg-bg) / .44); }
.pg-hero-art { position: absolute; right: 7%; bottom: 12%; width: 190px; height: 150px; filter: drop-shadow(0 18px 27px rgb(0 0 0 / .28)); }
.pg-hero-art--tetris { display: grid; grid-template-columns: repeat(7, 21px); align-content: end; gap: 4px; transform: rotate(-8deg); }
.pg-hero-art--tetris i { width: 21px; height: 21px; border-radius: 5px; background: rgb(48 54 72); }
.pg-hero-art--tetris i.is-on { background: linear-gradient(145deg, rgb(var(--pg-mint)), rgb(var(--pg-green))); box-shadow: 0 0 17px rgb(var(--pg-mint) / .34); }
.pg-hero-art--snake::before { position: absolute; inset: 22px 5px 12px; border: 8px solid rgb(var(--pg-lavender)); border-left-color: transparent; border-bottom-color: transparent; border-radius: 70px 70px 0 0; box-shadow: 0 0 24px rgb(var(--pg-lavender) / .2); content: ''; transform: rotate(-12deg); }
.pg-hero-art--snake::after { position: absolute; right: 14px; bottom: 13px; width: 18px; height: 18px; border-radius: 6px; background: rgb(var(--pg-lavender)); box-shadow: 0 0 18px rgb(var(--pg-lavender) / .4); content: ''; }
.pg-hero-art--sudoku { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr); gap: 4px; padding: 12px; transform: rotate(5deg); }
.pg-hero-art--sudoku i { display: grid; place-items: center; border: 1px solid rgb(var(--pg-blue) / .58); border-radius: 5px; color: rgb(216 235 255); background: rgb(var(--pg-blue) / .08); font: 800 18px/1 ui-monospace, Consolas, monospace; }
.pg-quick-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 9px; margin-top: 10px; }
.pg-quick-card { min-width: 0; min-height: 142px; cursor: pointer; border: 1px solid rgb(var(--pg-line)); border-radius: 12px; padding: 13px; text-align: left; color: rgb(var(--pg-text)); background: rgb(var(--pg-panel)); transition: border-color 180ms ease, background-color 180ms ease; }
.pg-quick-card:hover { border-color: rgb(var(--pg-tone) / .58); background: rgb(var(--pg-panel-2)); }
.pg-quick-card__top { display: flex; align-items: center; justify-content: space-between; gap: 7px; }
.pg-quick-card__icon { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 12px; color: rgb(var(--pg-tone)); background: rgb(var(--pg-panel-2)); }
.pg-quick-card > strong { display: block; margin-top: 12px; font-size: 15px; }
.pg-quick-card > span:last-child { display: block; margin-top: 4px; overflow: hidden; color: rgb(var(--pg-muted)); font-size: 12px; text-overflow: ellipsis; }
.pg-reward { color: rgb(var(--pg-lavender)); font: 800 10px/1 ui-monospace, Consolas, monospace; }
.pg-icon-art--tetris { display: grid; grid-template-columns: repeat(3, 7px); gap: 2px; transform: rotate(-5deg); }
.pg-icon-art--tetris i { width: 7px; height: 7px; border-radius: 2px; background: rgb(var(--pg-mint)); }
.pg-icon-art--tetris i:first-child { grid-column: 2; }
.pg-icon-art--snake { width: 26px; height: 17px; border: 3px solid rgb(var(--pg-lavender)); border-left-color: transparent; border-bottom-color: transparent; border-radius: 12px 12px 0 0; }
.pg-icon-art--sudoku { display: grid; grid-template-columns: repeat(3, 7px); gap: 1px; }
.pg-icon-art--sudoku i { width: 7px; height: 7px; border: 1px solid rgb(var(--pg-blue)); }
.pg-ranking { align-self: start; border: 1px solid rgb(var(--pg-line)); border-radius: 15px; padding: 14px; background: rgb(23 26 35); }
.pg-ranking__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 11px; }
.pg-ranking__head h3 { margin: 0; font-size: 15px; }
.pg-ranking__head span { color: rgb(var(--pg-muted)); font-size: 11px; }
.pg-wallet { margin-bottom: 8px; border: 1px solid rgb(var(--pg-lavender) / .24); border-radius: 11px; padding: 12px; background: rgb(var(--pg-accent) / .10); }
.pg-wallet small { color: rgb(var(--pg-lavender)); font: 700 10px/1 ui-monospace, Consolas, monospace; }
.pg-wallet strong { display: block; margin: 7px 0 4px; font: 900 21px/1 ui-monospace, Consolas, monospace; }
.pg-wallet p { margin: 0; color: rgb(var(--pg-muted)); font-size: 11px; }
.pg-ranking__list { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
.pg-ranking__list li { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 7px; border-radius: 8px; padding: 8px 6px; color: rgb(var(--pg-muted)); font-size: 12px; }
.pg-ranking__list li.is-me { color: rgb(var(--pg-text)); background: rgb(36 40 58); }
.pg-ranking__list b, .pg-ranking__list span:last-child { font-family: ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
.pg-house-teaser { width: 100%; min-height: 72px; margin-top: 9px; cursor: pointer; border: 1px solid rgb(var(--pg-mint) / .18); border-radius: 11px; padding: 11px; text-align: left; color: rgb(var(--pg-mint)); background: rgb(var(--pg-green) / .07); }
.pg-house-teaser > span { display: flex; align-items: center; justify-content: space-between; gap: 7px; }
.pg-house-teaser small { display: block; margin-top: 7px; color: rgb(var(--pg-muted)); line-height: 1.5; }
@container playground (max-width: 970px) { .pg-lobby { grid-template-columns: 1fr; } .pg-ranking { display: none; } .pg-quick-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container playground (max-width: 619px) { .pg-lobby { padding: 10px; } .pg-welcome { align-items: flex-start; } .pg-welcome h3 { font-size: 21px; } .pg-rank-pill { display: none; } .pg-hero { min-height: 290px; padding: 18px; } .pg-hero-art { right: -20px; bottom: 10px; opacity: .30; } .pg-quick-card { min-height: 132px; padding: 11px; } }
```

- [ ] **Step 9: Run focused tests and commit**

Run:

```powershell
node --test ./tests/playgroundPresentation.test.ts ./tests/playgroundV3UiWiring.test.ts
npm run test:playground
npm run typecheck
```

Expected: all catalog/ranking/lobby structure contracts, full Playground gate and TypeScript PASS.

Commit:

```powershell
git add src/views/playground/playgroundActivation.ts src/views/playground/PlaygroundGameArt.tsx src/views/playground/PlaygroundRecommendationHero.tsx src/views/playground/PlaygroundGameCard.tsx src/views/playground/PlaygroundRankingRail.tsx src/views/playground/PlaygroundLobby.tsx src/views/playground/playground.css tests/playgroundV3UiWiring.test.ts
git commit -m "승인 목업 기반 A안 게임 로비 복원"
```

---

### Task 5: C안 JBBJ 하우스와 게임별 준비 무대

**Files:**
- Modify: `src/views/playground/JbbjHouse.tsx`
- Modify: `src/views/playground/ComingSoonGame.tsx`
- Modify: `src/views/playground/playground.css`
- Modify: `tests/playgroundV3UiWiring.test.ts`

**Interfaces:**
- Consumes: `HOUSE_DOCK_ENTRIES`, `GAME_DEFINITIONS`, `PointRankingModel`, `PlaygroundGameArt`
- Produces: pure `JbbjHouseProps` and `ComingSoonGameProps`
- Produces: `data-pg-house`, `data-pg-challenge`, `data-pg-podium`, five `data-pg-dock-entry` anchors
- Produces: `data-pg-game-stage` for each of three game variants

- [ ] **Step 1: Add failing C-house and game-stage contracts**

Append to `tests/playgroundV3UiWiring.test.ts`:

```ts
test('C house restores challenge, podium and five dock entries', () => {
  const house = readFileSync('src/views/playground/JbbjHouse.tsx', 'utf8');
  assert.match(house, /data-pg-house/);
  assert.match(house, /data-pg-challenge/);
  assert.match(house, /TEAM CHALLENGE/);
  assert.match(house, /68,400/);
  assert.match(house, /data-pg-podium/);
  assert.match(house, /HOUSE_DOCK_ENTRIES\.map/);
  assert.match(house, /data-pg-dock-entry/);
  assert.match(house, /프리뷰 챌린지/);
  assert.doesNotMatch(house, /useMarketPreviewStore/);
});

test('game preparation screen renders dedicated art and source-aware return copy', () => {
  const source = readFileSync('src/views/playground/ComingSoonGame.tsx', 'utf8');
  assert.match(source, /data-pg-game-stage/);
  assert.match(source, /PlaygroundGameArt/);
  assert.match(source, /returnLabel/);
  assert.match(source, /게임 준비 중/);
  assert.doesNotMatch(source, /START GAME|게임 시작/);
});
```

- [ ] **Step 2: Run the UI test and verify red state**

Run:

```powershell
node --test ./tests/playgroundV3UiWiring.test.ts
```

Expected: FAIL because House is still the single calm-lounge card and ComingSoon is still generic.

- [ ] **Step 3: Replace JBBJ House with challenge, podium, and five-entry dock**

Replace `src/views/playground/JbbjHouse.tsx` with:

```tsx
import { Landmark } from 'lucide-react';
import {
  GAME_DEFINITIONS,
  HOUSE_DOCK_ENTRIES,
  type PlaygroundDockEntry,
} from '@/features/playground/catalog';
import type { PointRankingModel } from '@/features/playground/ranking';
import type { PreviewGame } from '@/features/playground/routes';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { PlaygroundGameArt } from './PlaygroundGameArt';
import { pointFromButtonActivation } from './playgroundActivation';

export interface JbbjHouseProps {
  ranking: PointRankingModel;
  onPlayGame: (game: PreviewGame, origin: Point) => void;
  onOpenMarket: (origin: Point) => void;
}

export function JbbjHouse({ ranking, onPlayGame, onOpenMarket }: JbbjHouseProps) {
  const podium = ranking.entries.filter((entry) => entry.points !== null).slice(0, 3);
  const activate = (entry: PlaygroundDockEntry, origin: Point) => {
    if (entry.kind === 'game') onPlayGame(entry.gameId, origin);
    if (entry.kind === 'market') onOpenMarket(origin);
  };
  return (
    <section className="pg-house" data-pg-house>
      <header className="pg-house__intro">
        <div><small>WELCOME TO JBBJ HOUSE</small><h3>지금, 네 명이 놀고 있어요.</h3></div>
        <span className="pg-house__online"><i className="pg-online-dot" aria-hidden="true" />4 PLAYERS ONLINE</span>
      </header>
      <div className="pg-house__grid">
        <article className="pg-challenge" data-pg-challenge>
          <span className="pg-tag pg-tag--live">TEAM CHALLENGE</span>
          <h3>오늘 안에 테트리스<br />합계 100,000점</h3>
          <p>팀원들의 기록을 합쳐 목표를 달성하면 참여자 전원에게 60 포인트를 지급합니다.</p>
          <span className="pg-challenge__preview">프리뷰 챌린지</span>
          <div className="pg-challenge__progress"><span>현재 68,400점</span><span>68%</span></div>
          <div className="pg-challenge__track" aria-label="프리뷰 챌린지 68퍼센트"><i /></div>
        </article>
        <aside className="pg-podium" data-pg-podium>
          <h3>포인트 명예의 전당</h3>
          <ol>{podium.map((entry) => <li key={entry.id} className={entry.rank === 1 ? 'is-first' : ''}><span>{entry.name.slice(0, 1)}</span><b>{entry.name}</b><small>{entry.points!.toLocaleString('ko-KR')} P</small></li>)}</ol>
          <div className="pg-podium__me"><b>{ranking.current.rank ?? '—'}</b><span>{ranking.current.name} · 나</span><span>{ranking.current.points === null ? '— P' : `${ranking.current.points.toLocaleString('ko-KR')} P`}</span></div>
        </aside>
      </div>
      <div className="pg-house__dock">
        {HOUSE_DOCK_ENTRIES.map((entry) => {
          const key = entry.kind === 'game' ? entry.gameId : entry.id;
          if (entry.kind === 'disabled') return <div key={key} data-pg-dock-entry className="pg-dock is-disabled" aria-disabled="true"><span className="pg-dock__icon">777</span><span><b>{entry.label}</b><small>{entry.status}</small></span></div>;
          const game = entry.kind === 'game' ? GAME_DEFINITIONS[entry.gameId] : null;
          const label = entry.kind === 'game' ? game!.koName : entry.label;
          const status = entry.kind === 'game' ? '플레이 준비 중' : '시장 열기';
          return <button key={key} type="button" data-pg-dock-entry className="pg-dock" onClick={(event) => activate(entry, pointFromButtonActivation(event))}><span className="pg-dock__icon">{game ? <PlaygroundGameArt game={game.id} variant="icon" /> : <Landmark aria-hidden="true" size={21} />}</span><span><b>{label}</b><small>{status}</small></span></button>;
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Replace the generic ComingSoon card with game-specific stage art**

Replace `src/views/playground/ComingSoonGame.tsx` with:

```tsx
import { ArrowLeft } from 'lucide-react';
import type { PlaygroundGameDefinition } from '@/features/playground/catalog';
import { PlaygroundGameArt } from './PlaygroundGameArt';

export interface ComingSoonGameProps {
  game: PlaygroundGameDefinition;
  returnLabel: '게임 로비' | 'JBBJ 하우스';
  onBack: () => void;
}

export function ComingSoonGame({ game, returnLabel, onBack }: ComingSoonGameProps) {
  return (
    <section className={`pg-game-screen pg-tone--${game.tone}`} data-pg-game-stage>
      <div className="pg-game-screen__info">
        <small>NOW PREPARING</small>
        <h3>{game.enName}</h3>
        <p>{game.stageReward}</p>
        <span className="pg-tag pg-tag--soon">게임 준비 중</span>
        <button type="button" className="pg-game-screen__back" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={17} /> {returnLabel}로 돌아가기
        </button>
      </div>
      <div className="pg-game-screen__stage"><PlaygroundGameArt game={game.id} variant="stage" /></div>
    </section>
  );
}
```

- [ ] **Step 5: Append House, dock, and game-stage CSS**

Append to `src/views/playground/playground.css`:

```css
.pg-house { position: relative; min-height: 100%; padding: 16px; background: radial-gradient(circle at 45% 8%, rgb(var(--pg-accent) / .18), transparent 40%); }
.pg-house::before { position: absolute; inset: 0; pointer-events: none; opacity: .17; background-image: linear-gradient(rgb(255 255 255 / .025) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .025) 1px, transparent 1px); background-size: 28px 28px; content: ''; mask-image: linear-gradient(to bottom, #000, transparent 76%); }
.pg-house > * { position: relative; z-index: 1; }
.pg-house__intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 11px; }
.pg-house__intro small { color: rgb(var(--pg-mint)); font: 700 10px/1 ui-monospace, Consolas, monospace; letter-spacing: .13em; }
.pg-house__intro h3 { margin: 7px 0 0; font-size: clamp(28px, 3cqw, 40px); letter-spacing: -.05em; }
.pg-house__online { display: flex; align-items: center; gap: 8px; color: rgb(var(--pg-muted)); font: 700 11px/1 ui-monospace, Consolas, monospace; }
.pg-house__grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(250px, .75fr); gap: 11px; }
.pg-challenge { position: relative; min-height: 260px; overflow: hidden; border: 1px solid rgb(53 58 77); border-radius: 17px; padding: 21px; background: linear-gradient(145deg, rgb(30 34 48 / .97), rgb(23 27 36 / .97)); }
.pg-challenge::after { position: absolute; top: -120px; right: -90px; width: 300px; height: 300px; border: 1px solid rgb(var(--pg-mint) / .2); border-radius: 50%; box-shadow: 0 0 0 25px rgb(var(--pg-mint) / .025), 0 0 0 56px rgb(var(--pg-lavender) / .018); content: ''; }
.pg-challenge h3 { position: relative; z-index: 1; margin: 17px 0 9px; font-size: clamp(30px, 3.5cqw, 48px); line-height: .96; letter-spacing: -.06em; }
.pg-challenge p { position: relative; z-index: 1; max-width: 470px; color: rgb(var(--pg-muted)); font-size: 14px; line-height: 1.6; }
.pg-challenge__preview { color: rgb(var(--pg-muted)); font-size: 11px; }
.pg-challenge__progress { display: flex; justify-content: space-between; margin: 20px 0 7px; color: rgb(var(--pg-muted)); font-size: 12px; }
.pg-challenge__track { height: 7px; overflow: hidden; border-radius: 999px; background: rgb(var(--pg-line)); }
.pg-challenge__track i { display: block; width: 68%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, rgb(var(--pg-accent)), rgb(var(--pg-mint))); }
.pg-podium { border: 1px solid rgb(var(--pg-line)); border-radius: 16px; padding: 14px; background: rgb(23 26 35 / .95); }
.pg-podium h3 { margin: 0 0 16px; font-size: 15px; }
.pg-podium ol { display: grid; min-height: 120px; grid-template-columns: repeat(3, 1fr); align-items: end; gap: 6px; margin: 0; padding: 0; list-style: none; }
.pg-podium li { display: grid; justify-items: center; gap: 5px; color: rgb(var(--pg-muted)); font-size: 11px; }
.pg-podium li > span { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 50%; background: rgb(50 55 71); font-weight: 900; }
.pg-podium li.is-first { transform: translateY(-14px); color: rgb(var(--pg-text)); }
.pg-podium li.is-first > span { width: 42px; height: 42px; border: 2px solid rgb(var(--pg-yellow)); box-shadow: 0 0 19px rgb(var(--pg-yellow) / .18); }
.pg-podium__me { display: grid; grid-template-columns: 24px 1fr auto; gap: 7px; margin-top: 9px; border-radius: 8px; padding: 9px 7px; background: rgb(36 40 58); font-size: 12px; }
.pg-house__dock { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 9px; margin-top: 11px; }
.pg-dock { display: flex; min-width: 0; min-height: 64px; cursor: pointer; align-items: center; gap: 9px; border: 1px solid rgb(var(--pg-line)); border-radius: 12px; padding: 10px; text-align: left; color: rgb(var(--pg-text)); background: rgb(var(--pg-panel) / .96); }
.pg-dock.is-disabled { cursor: not-allowed; opacity: .55; }
.pg-dock__icon { display: grid; width: 38px; height: 38px; flex: 0 0 38px; place-items: center; border-radius: 10px; color: rgb(var(--pg-blue)); background: rgb(var(--pg-panel-2)); }
.pg-dock b, .pg-dock small { display: block; overflow: hidden; text-overflow: ellipsis; }
.pg-dock b { font-size: 13px; }.pg-dock small { margin-top: 3px; color: rgb(var(--pg-muted)); font-size: 11px; }
.pg-game-screen { display: grid; min-height: 100%; grid-template-columns: minmax(280px, .78fr) minmax(0, 1.22fr); gap: 18px; padding: 20px; background: radial-gradient(circle at 75% 20%, rgb(var(--pg-tone) / .12), transparent 40%); }
.pg-game-screen__info { display: flex; flex-direction: column; justify-content: center; padding: 18px; }
.pg-game-screen__info > small { color: rgb(var(--pg-tone)); font: 700 11px/1 ui-monospace, Consolas, monospace; letter-spacing: .15em; }
.pg-game-screen__info h3 { margin: 12px 0 10px; font-size: clamp(48px, 6cqw, 82px); line-height: .86; letter-spacing: -.075em; }
.pg-game-screen__info p { max-width: 390px; color: rgb(var(--pg-muted)); font-size: 14px; line-height: 1.6; }
.pg-tag--soon { align-self: flex-start; color: rgb(var(--pg-muted)); background: rgb(var(--pg-muted) / .1); }
.pg-game-screen__back { display: inline-flex; min-height: 44px; align-self: flex-start; align-items: center; gap: 8px; margin-top: 20px; cursor: pointer; border: 1px solid rgb(var(--pg-line)); border-radius: 9px; padding: 0 14px; color: rgb(var(--pg-text)); background: rgb(var(--pg-panel)); }
.pg-game-screen__stage { display: grid; min-height: 430px; place-items: center; border: 1px solid rgb(var(--pg-line)); border-radius: 17px; background: rgb(18 21 29 / .87); box-shadow: inset 0 0 50px rgb(0 0 0 / .25); }
.pg-stage-art--tetris { display: grid; grid-template-columns: repeat(10, 18px); grid-template-rows: repeat(14, 18px); gap: 2px; border: 1px solid rgb(var(--pg-line)); border-radius: 12px; padding: 12px; background: rgb(20 23 32); }
.pg-stage-art--tetris i { width: 18px; height: 18px; border-radius: 4px; background: rgb(29 33 44); }.pg-stage-art--tetris i.is-on { background: rgb(var(--pg-tone)); box-shadow: 0 0 12px rgb(var(--pg-tone) / .5); }
.pg-stage-art--snake { position: relative; width: min(420px, 80%); aspect-ratio: 1.3; border: 1px solid rgb(var(--pg-line)); border-radius: 14px; background-color: rgb(20 23 32); background-image: linear-gradient(rgb(255 255 255 / .035) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .035) 1px, transparent 1px); background-size: 20px 20px; }
.pg-stage-art--snake i { position: absolute; width: 18px; height: 18px; border-radius: 6px; background: rgb(var(--pg-tone)); box-shadow: 0 0 12px rgb(var(--pg-tone) / .45); }
.pg-stage-art--sudoku { display: grid; grid-template-columns: repeat(9, 38px); grid-template-rows: repeat(9, 38px); overflow: hidden; border: 2px solid rgb(var(--pg-tone)); border-radius: 9px; }
.pg-stage-art--sudoku i { display: grid; place-items: center; border-right: 1px solid rgb(var(--pg-line)); border-bottom: 1px solid rgb(var(--pg-line)); color: rgb(var(--pg-text)); background: rgb(23 26 35); font: 800 14px/1 ui-monospace, Consolas, monospace; }.pg-stage-art--sudoku i.is-given { color: rgb(var(--pg-tone)); background: rgb(var(--pg-panel-2)); }
@container playground (max-width: 970px) { .pg-house__grid, .pg-game-screen { grid-template-columns: 1fr; } .pg-podium { display: none; } .pg-house__dock { grid-template-columns: repeat(2, minmax(0, 1fr)); } .pg-game-screen__stage { min-height: 360px; } }
@container playground (max-width: 619px) { .pg-house { padding: 10px; } .pg-house__intro { align-items: flex-start; } .pg-house__online { display: none; } .pg-house__dock { grid-template-columns: 1fr; } .pg-game-screen { padding: 10px; } .pg-game-screen__info { padding: 10px; } .pg-game-screen__stage { min-height: 320px; overflow: hidden; } .pg-stage-art--sudoku { transform: scale(.72); } }
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```powershell
node --test ./tests/playgroundV3UiWiring.test.ts
npm run test:playground
npm run typecheck
```

Expected: House/game-stage structural contracts, full Playground gate and TypeScript PASS.

Commit:

```powershell
git add src/views/playground/JbbjHouse.tsx src/views/playground/ComingSoonGame.tsx src/views/playground/playground.css tests/playgroundV3UiWiring.test.ts
git commit -m "JBBJ 하우스와 게임별 준비 무대 복원"
```

---

### Task 6: `PlaygroundView` 통합과 실제 return/transition wiring

**Files:**
- Modify: `src/views/PlaygroundView.tsx`
- Modify: `tests/playgroundMarketUiWiring.test.ts`
- Modify: `tests/playgroundV3UiWiring.test.ts`

**Interfaces:**
- Consumes all Task 1–5 contracts
- Produces: one store-aware controller; all child components remain pure
- Preserves: existing MarketRouter, market store, DotWipe exactly-once behavior

- [ ] **Step 1: Replace brittle lobby-return assertions with integration contracts**

In `tests/playgroundMarketUiWiring.test.ts`, replace the old assertions that require all exits to call `go-lobby` with:

```ts
test('Playground controller preserves source-aware return and policy-driven transitions', () => {
  const source = readFileSync('src/views/PlaygroundView.tsx', 'utf8');
  assert.match(source, /getPlaygroundNavigationTransition/);
  assert.match(source, /createRecommendationSession/);
  assert.match(source, /advanceRecommendation/);
  assert.match(source, /buildPointRanking/);
  assert.match(source, /target:\s*transition\.target/);
  assert.match(source, /onExit=\{\(\) => move\(\{ kind: 'return-to-source' \}\)\}/);
  assert.match(source, /returnLabel=\{route\.returnTo === 'house' \? 'JBBJ 하우스' : '게임 로비'\}/);
  assert.match(source, /<PlaygroundShell/);
  assert.doesNotMatch(source, /origin\) \{\s*setRoute/);
});
```

Append to `tests/playgroundV3UiWiring.test.ts`:

```ts
test('PlaygroundView is the only store-aware composition root', () => {
  const source = readFileSync('src/views/PlaygroundView.tsx', 'utf8');
  assert.match(source, /useAuthStore/);
  assert.match(source, /useMarketPreviewStore/);
  assert.match(source, /currentUser\?\.name\.trim\(\) \|\| '팀원'/);
  assert.match(source, /visible\?\.account\.walletPoints \?\? null/);
  assert.match(source, /visible\?\.account\.cashPoints \?\? null/);
});
```

- [ ] **Step 2: Run focused integration tests and verify red state**

Run:

```powershell
node --test ./tests/playgroundMarketUiWiring.test.ts ./tests/playgroundV3UiWiring.test.ts
```

Expected: FAIL because the controller still owns one-shot recommendation, origin-driven policy and lobby-only exits.

- [ ] **Step 3: Rebuild `PlaygroundView` as the only controller**

Replace `src/views/PlaygroundView.tsx` with the following structure, retaining the existing market preload effect and exactly-once refs:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { GAME_DEFINITIONS } from '@/features/playground/catalog';
import { advanceRecommendation, createRecommendationSession } from '@/features/playground/recommendation';
import { buildPointRanking } from '@/features/playground/ranking';
import { initialPlaygroundRoute, navigatePlayground, type PlaygroundAction, type PlaygroundRoute } from '@/features/playground/routes';
import { DotWipeTransition } from '@/features/playground/transition/DotWipeTransition';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { getPlaygroundNavigationTransition } from '@/features/playground/transition/playgroundTransitionPolicy';
import type { DotWipeRequest } from '@/features/playground/transition/usePlaygroundEntryStore';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { ComingSoonGame } from './playground/ComingSoonGame';
import { JbbjHouse } from './playground/JbbjHouse';
import { PlaygroundLobby } from './playground/PlaygroundLobby';
import { PlaygroundShell } from './playground/PlaygroundShell';
import { MarketRouter } from './playground/market/MarketRouter';

export default function PlaygroundView() {
  const [route, setRoute] = useState<PlaygroundRoute>(initialPlaygroundRoute);
  const [recommendation, setRecommendation] = useState(createRecommendationSession);
  const [wipe, setWipe] = useState<DotWipeRequest | null>(null);
  const pendingAction = useRef<PlaygroundAction | null>(null);
  const transitionInFlight = useRef(false);
  const sequence = useRef(0);
  const currentUser = useAuthStore((state) => state.currentUser);
  const visible = useMarketPreviewStore((state) => state.visible);
  const loadMarket = useMarketPreviewStore((state) => state.load);
  const userName = currentUser?.name.trim() || '팀원';
  const walletPoints = visible?.account.walletPoints ?? null;
  const marketCashPoints = visible?.account.cashPoints ?? null;
  const ranking = useMemo(() => buildPointRanking({
    id: currentUser?.id ?? 'preview-user', name: userName, points: walletPoints,
  }), [currentUser?.id, userName, walletPoints]);

  useEffect(() => {
    const state = useMarketPreviewStore.getState();
    if (!state.visible && !state.loading) void loadMarket();
  }, [loadMarket]);

  useEffect(() => {
    if (wipe || route.kind === 'market') return;
    const targetId = route.kind === 'lobby' ? 'playground-lobby-title' : route.kind === 'house' ? 'playground-house-title' : 'playground-game-title';
    const frame = requestAnimationFrame(() => document.getElementById(targetId)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [route, wipe]);

  const move = (action: PlaygroundAction, origin?: Point) => {
    const transition = getPlaygroundNavigationTransition(action);
    if (transition.mode !== 'dot') {
      setRoute((current) => navigatePlayground(current, action));
      return;
    }
    if (wipe || transitionInFlight.current) return;
    transitionInFlight.current = true;
    pendingAction.current = action;
    setWipe({
      id: ++sequence.current,
      origin: origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      target: transition.target,
    });
  };

  const surface = route.kind === 'lobby' ? (
    <PlaygroundLobby
      userName={userName}
      recommendation={recommendation.current}
      ranking={ranking}
      marketCashPoints={marketCashPoints}
      onShuffle={() => setRecommendation((current) => advanceRecommendation(current))}
      onPlayGame={(game, origin) => move({ kind: 'open-game', game }, origin)}
      onOpenMarket={(origin) => move({ kind: 'open-market' }, origin)}
      onOpenHouse={() => move({ kind: 'open-house' })}
    />
  ) : route.kind === 'house' ? (
    <JbbjHouse ranking={ranking} onPlayGame={(game, origin) => move({ kind: 'open-game', game }, origin)} onOpenMarket={(origin) => move({ kind: 'open-market' }, origin)} />
  ) : route.kind === 'coming-soon' ? (
    <ComingSoonGame game={GAME_DEFINITIONS[route.game]} returnLabel={route.returnTo === 'house' ? 'JBBJ 하우스' : '게임 로비'} onBack={() => move({ kind: 'return-to-source' })} />
  ) : null;

  const header = route.kind === 'lobby' ? {
    titleId: 'playground-lobby-title', title: '배플레이그라운드', description: '입장할 때마다 추천 게임이 달라집니다',
    showHouse: true, onOpenHouse: () => move({ kind: 'open-house' }), ranking,
  } : route.kind === 'house' ? {
    titleId: 'playground-house-title', title: 'JBBJ 하우스', description: '팀 챌린지와 함께 노는 공간',
    backLabel: '게임 로비' as const, onBack: () => move({ kind: 'go-lobby' }), showHouse: false, ranking,
  } : route.kind === 'coming-soon' ? {
    titleId: 'playground-game-title', title: GAME_DEFINITIONS[route.game].koName, description: '기록과 보상 규칙을 준비하고 있어요',
    backLabel: route.returnTo === 'house' ? 'JBBJ 하우스' as const : '게임 로비' as const,
    onBack: () => move({ kind: 'return-to-source' }), showHouse: false, ranking,
  } : null;

  return (
    <section className="relative h-full overflow-hidden" aria-labelledby="playground-title">
      <h1 id="playground-title" className="sr-only">배플레이그라운드</h1>
      {route.kind === 'market' ? (
        <MarketRouter route={route.page} onNavigate={(action) => move(action)} onExit={() => move({ kind: 'return-to-source' })} />
      ) : header && (
        <PlaygroundShell header={header} surfaceKey={route.kind === 'coming-soon' ? `${route.kind}-${route.game}` : route.kind}>{surface}</PlaygroundShell>
      )}
      {wipe && <DotWipeTransition request={wipe} onCovered={() => { if (pendingAction.current) setRoute((current) => navigatePlayground(current, pendingAction.current!)); }} onFinished={() => { pendingAction.current = null; transitionInFlight.current = false; setWipe(null); }} />}
    </section>
  );
}
```

- [ ] **Step 4: Update old route fixtures for the new `returnTo` field**

In `tests/playgroundRoutes.test.ts`, update every market expectation to include `returnTo: 'lobby'` unless it is opened from House. Do not loosen with partial matching; assert the full route object.

- [ ] **Step 5: Run the whole Playground gate and commit**

Run:

```powershell
npm run test:playground
npm run typecheck
```

Expected: all prior market/domain/store tests plus new presentation/route/transition/UI contracts PASS.

Commit:

```powershell
git add src/views/PlaygroundView.tsx tests/playgroundRoutes.test.ts tests/playgroundMarketUiWiring.test.ts tests/playgroundV3UiWiring.test.ts
git commit -m "승인 로비와 하우스 이동 흐름 통합"
```

---

### Task 7: 실제 viewport geometry·목업 비교·전체 회귀 검증

**Files:**
- Create: `docs/superpowers/mockups/2026-07-11-playground-v3-reference-1440.png`
- Create: `docs/superpowers/mockups/2026-07-11-playground-v3-actual-1440.png`
- Create: `docs/superpowers/mockups/2026-07-11-playground-v3-comparison.md`
- Modify only if verification finds a concrete defect: Task 1–6 files and their focused tests

**Interfaces:**
- Consumes: complete integrated preview
- Produces: visual evidence, geometry evidence, clean final branch

- [ ] **Step 1: Run all static gates before browser work**

Run:

```powershell
npm run test:playground
npm run typecheck
Remove-Item Env:VITE_ENABLE_PLAYGROUND_PREVIEW -ErrorAction SilentlyContinue
npm run build:vite
```

Expected: all commands exit 0. Existing Vite dynamic-import/chunk-size warnings and development manifest missing-installer warning are non-fatal; any non-zero exit is a blocker.

- [ ] **Step 2: Start the approved QA preview and log in**

Run a hidden renderer server from the feature worktree:

```powershell
Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev','--','--host','127.0.0.1','--port','5173' -WorkingDirectory 'C:\Bflow-BGonly\.worktrees\jbbj-market-preview' -WindowStyle Hidden
```

Use `browser:control-in-app-browser`, open `http://127.0.0.1:5173/?preview=1`, and if the login screen appears enter name `배한솔`, password `1234`. Do not validate before reaching the Playground screen.

- [ ] **Step 3: Execute exact 1440/1024/390 geometry assertions**

At viewport 1440×1000, evaluate the actual DOM once:

```js
const geometry = await tab.playwright.evaluate(() => {
  const lobby = document.querySelector('[data-pg-lobby]');
  const hero = document.querySelector('[data-pg-hero]');
  const rail = document.querySelector('[data-pg-ranking]');
  const cards = Array.from(document.querySelectorAll('[data-pg-quick-card]'));
  if (!(lobby instanceof HTMLElement) || !(hero instanceof HTMLElement) || !(rail instanceof HTMLElement)) throw new Error('missing v3 anchors');
  const style = getComputedStyle(lobby);
  const heroRect = hero.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const cardRects = cards.map((card) => card.getBoundingClientRect());
  const tracks = style.gridTemplateColumns.split(' ').map((value) => Number.parseFloat(value));
  return {
    tracks,
    ratio: tracks[0] / tracks[1],
    railWidth: railRect.width,
    heroHeight: heroRect.height,
    cardCount: cardRects.length,
    cardTopSpread: Math.max(...cardRects.map((rect) => rect.top)) - Math.min(...cardRects.map((rect) => rect.top)),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});
if (geometry.tracks.length !== 2 || geometry.ratio < 2.35 || geometry.ratio > 2.70 || geometry.railWidth < 220 || geometry.heroHeight < 240 || geometry.cardCount !== 4 || geometry.cardTopSpread > 2 || geometry.overflow) throw new Error(JSON.stringify(geometry));
```

At viewport 1024×768, run:

```js
const medium = await tab.playwright.evaluate(() => {
  const lobby = document.querySelector('[data-pg-lobby]');
  const cards = Array.from(document.querySelectorAll('[data-pg-quick-card]'));
  if (!(lobby instanceof HTMLElement) || cards.length !== 4) throw new Error('missing medium anchors');
  const trackCount = getComputedStyle(lobby).gridTemplateColumns.split(' ').length;
  const cardRows = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top))).size;
  return { trackCount, cardRows, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
});
if (medium.trackCount !== 1 || medium.cardRows !== 2 || medium.overflow) throw new Error(JSON.stringify(medium));
```

At viewport 390×844 on the lobby, run:

```js
const compact = await tab.playwright.evaluate(() => {
  const header = document.querySelector('[data-pg-header]');
  const cards = Array.from(document.querySelectorAll('[data-pg-quick-card]'));
  if (!(header instanceof HTMLElement) || cards.length !== 4) throw new Error('missing compact anchors');
  const visibleButtons = Array.from(document.querySelectorAll('button')).filter((button) => {
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  return {
    headerHeight: header.getBoundingClientRect().height,
    cardColumns: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size,
    actionsInside: visibleButtons.every((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth;
    }),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});
if (compact.headerHeight < 88 || compact.cardColumns !== 2 || !compact.actionsInside || compact.overflow) throw new Error(JSON.stringify(compact));
```

Open JBBJ House at the same 390×844 viewport and run:

```js
const houseCompact = await tab.playwright.evaluate(() => {
  const dock = document.querySelector('.pg-house__dock');
  if (!(dock instanceof HTMLElement)) throw new Error('missing House dock');
  return {
    dockTracks: getComputedStyle(dock).gridTemplateColumns.split(' ').length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
});
if (houseCompact.dockTracks !== 1 || houseCompact.overflow) throw new Error(JSON.stringify(houseCompact));
```

Reset the viewport override after testing.

- [ ] **Step 4: Verify interaction, source-aware return, and errors**

In the actual app:

1. `다른 추천`을 두 번 눌러 Tetris/Snake/Sudoku 세 variants의 exact copy, tone and art를 모두 확인한다.
2. 로비 → House → game → back가 House로 돌아오는지 확인한다.
3. House → JBBJ 증권 → `놀이터로`가 House로 돌아오는지 확인한다.
4. 로비 → JBBJ 증권 → `놀이터로`가 로비로 돌아오는지 확인한다.
5. House 왕복에는 transition overlay DOM이 생기지 않고, game/market 진입에는 목표별 label과 `#07090d` cover가 생기는지 확인한다.
6. 키보드 Enter는 버튼 중심에서 dot을 시작하고 Tab focus ring이 보이는지 확인한다.
7. 포인트 1,000P 입금/출금 후 header, wallet, ranking이 즉시 다시 정렬되는지 확인한다.
8. 200% 확대, console error 0, market home/detail/account 회귀를 확인한다.
9. 실제 OS reduced-motion은 변경하지 않는다. 순수 220ms tests와 브라우저의 현재 설정에서 가능한 경로만 확인한다.

- [ ] **Step 5: Save the reference and actual screenshots**

Because the tracked HTML is under the Vite root, open this safe localhost URL:

```text
http://127.0.0.1:5173/docs/superpowers/mockups/2026-07-11-playground-interactions-v3.html
```

At 1440×1000, save the actual app before leaving it, then capture the tracked reference `.device` clip:

```js
const fs = await import('node:fs/promises');
const actualBytes = await tab.screenshot({ fullPage: false });
await fs.writeFile(
  'C:/Bflow-BGonly/.worktrees/jbbj-market-preview/docs/superpowers/mockups/2026-07-11-playground-v3-actual-1440.png',
  actualBytes,
);

await tab.goto('http://127.0.0.1:5173/docs/superpowers/mockups/2026-07-11-playground-interactions-v3.html');
await tab.playwright.waitForLoadState({ state: 'domcontentloaded', timeoutMs: 10000 });
const deviceRect = await tab.playwright.evaluate(() => {
  const device = document.querySelector('.device');
  if (!(device instanceof HTMLElement)) throw new Error('missing reference device');
  const rect = device.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
});
const referenceBytes = await tab.screenshot({ clip: deviceRect });
await fs.writeFile(
  'C:/Bflow-BGonly/.worktrees/jbbj-market-preview/docs/superpowers/mockups/2026-07-11-playground-v3-reference-1440.png',
  referenceBytes,
);
```

Do not rasterize, recolor or post-process either image. Navigate back to `http://127.0.0.1:5173/?preview=1`, log in again only if needed, and leave the final tab on the restored A lobby.

- [ ] **Step 6: Record the comparison result as explicit pass/fail evidence**

Create `docs/superpowers/mockups/2026-07-11-playground-v3-comparison.md`:

```markdown
# 배플레이그라운드 v3 비교 검증

## Evidence

- 승인 기준: `2026-07-11-playground-v3-reference-1440.png`
- 실제 React: `2026-07-11-playground-v3-actual-1440.png`

## Contract results

| 검증 | 기준 | 결과 |
|---|---|---|
| 1440 로비 tracks | 2개 | PASS |
| 왼쪽/오른쪽 비율 | 2.35~2.70 | PASS |
| ranking rail | 220px 이상 | PASS |
| random hero | 240px 이상 | PASS |
| quick cards | 같은 행 4개, top 차이 2px 이하 | PASS |
| 1024 layout | 1열 + quick cards 2열 | PASS |
| 390 header | 88px 이상 두 줄 | PASS |
| 390 House dock | 1열 | PASS |
| horizontal overflow | 모든 viewport에서 없음 | PASS |
| A↔C transition | dot 없음 | PASS |
| game/market transition | target copy + dark cover | PASS |
| House source return | game/market 모두 House 복귀 | PASS |
| market regression | home/detail/account 유지 | PASS |

## Visual decision

승인 v3의 local header, asymmetric hero, four-card row, ranking rail, House challenge/podium/dock을 실제 B flow sidebar 안쪽 화면으로 복원했다. 외부 Visual Lab frame은 의도적으로 제외했다.
```

If any row is not PASS, do not create false evidence. Return to the responsible Task, add a failing focused test, fix one root cause, rerun all affected checks, then write the document.

- [ ] **Step 7: Run a fresh independent review**

Dispatch a fresh reviewer with the spec, this plan, base commit `b4f1fc5`, current HEAD, tracked reference HTML, both screenshots, geometry results and browser QA notes. The reviewer must report Critical/Important/Minor findings and verify that no persistence/API/backend scope leaked into Playground.

Fix every Critical and Important finding with a failing focused test first. Re-run focused tests, `npm run test:playground`, `npm run typecheck`, `npm run build:vite`, and browser checks after each fix batch.

- [ ] **Step 8: Commit visual evidence and verify the final tree**

```powershell
git add docs/superpowers/mockups/2026-07-11-playground-v3-reference-1440.png docs/superpowers/mockups/2026-07-11-playground-v3-actual-1440.png docs/superpowers/mockups/2026-07-11-playground-v3-comparison.md
git commit -m "배플레이그라운드 v3 화면 비교 검증 완료"
git diff --check b4f1fc5..HEAD
git status --short --branch
```

Expected: diff check has no output, the branch is clean, and the final reviewer has 0 Critical and 0 Important findings.

---

## Final Handoff

The implementation is complete only after all seven task commits, the tracked reference, both screenshots, geometry evidence, full build gate and final independent review are present. Keep the dev preview open on the restored A lobby. Do not merge, push, create a PR, bump the package version or deploy without a new explicit user instruction.
