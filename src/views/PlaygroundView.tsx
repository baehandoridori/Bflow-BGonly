import { useEffect, useMemo, useRef, useState } from 'react';

import { GAME_DEFINITIONS } from '@/features/playground/catalog';
import { advanceRecommendation, createRecommendationSession } from '@/features/playground/recommendation';
import { buildPointRanking } from '@/features/playground/ranking';
import {
  initialPlaygroundRoute,
  navigatePlayground,
  type PlaygroundAction,
  type PlaygroundRoute,
} from '@/features/playground/routes';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { DotWipeTransition } from '@/features/playground/transition/DotWipeTransition';
import { getPlaygroundMovePlan } from '@/features/playground/transition/playgroundTransitionPolicy';
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
  const lifetimeEarnedPoints = visible?.account.lifetimeEarnedPoints ?? null;
  const marketCashWon = visible?.account.cashWon ?? null;
  const ranking = useMemo(() => buildPointRanking({
    id: currentUser?.id ?? 'preview-user',
    name: userName,
    walletPoints,
    lifetimeEarnedPoints,
  }), [currentUser?.id, lifetimeEarnedPoints, userName, walletPoints]);

  useEffect(() => {
    if (!currentUser?.id) return;
    void loadMarket(currentUser.id);
  }, [currentUser?.id, loadMarket]);

  useEffect(() => {
    if (wipe || route.kind === 'market') return;
    const targetId = route.kind === 'lobby'
      ? 'playground-lobby-title'
      : route.kind === 'house'
        ? 'playground-house-title'
        : 'playground-game-title';
    const frame = requestAnimationFrame(() => document.getElementById(targetId)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [route, wipe]);

  const move = (action: PlaygroundAction, origin?: Point) => {
    if (wipe || transitionInFlight.current) return;
    const resolvedOrigin = origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const plan = getPlaygroundMovePlan(
      route,
      action,
      resolvedOrigin,
    );
    if (plan.mode !== 'dot') {
      setRoute((current) => {
        const currentPlan = getPlaygroundMovePlan(current, action, resolvedOrigin);
        return currentPlan.mode === 'dot' ? current : currentPlan.route;
      });
      return;
    }
    transitionInFlight.current = true;
    pendingAction.current = action;
    setWipe({
      id: ++sequence.current,
      ...plan.request,
    });
  };

  return (
    <section className="relative h-full overflow-hidden" aria-labelledby="playground-title">
      <h1 id="playground-title" tabIndex={-1} className="sr-only outline-none">
        배플레이그라운드
      </h1>
      {route.kind === 'lobby' && (
        <PlaygroundShell
          header={{
            titleId: 'playground-lobby-title',
            title: '배플레이그라운드',
            description: '입장할 때마다 추천 게임이 달라집니다',
            showHouse: true,
            onOpenHouse: () => move({ kind: 'open-house' }),
            ranking,
          }}
          surfaceKey="lobby"
        >
          <PlaygroundLobby
            userName={userName}
            recommendation={recommendation.current}
            ranking={ranking}
            marketCashWon={marketCashWon}
            onShuffle={() => setRecommendation((current) => advanceRecommendation(current))}
            onPlayGame={(game, origin) => move({ kind: 'open-game', game }, origin)}
            onOpenMarket={(origin) => move({ kind: 'open-market' }, origin)}
            onOpenHouse={() => move({ kind: 'open-house' })}
          />
        </PlaygroundShell>
      )}
      {route.kind === 'house' && (
        <PlaygroundShell
          header={{
            titleId: 'playground-house-title',
            title: 'JBBJ 하우스',
            description: '팀 챌린지와 함께 노는 공간',
            backLabel: '게임 로비',
            onBack: () => move({ kind: 'go-lobby' }),
            showHouse: false,
            ranking,
          }}
          surfaceKey="house"
        >
          <JbbjHouse
            ranking={ranking}
            onPlayGame={(game, origin) => move({ kind: 'open-game', game }, origin)}
            onOpenMarket={(origin) => move({ kind: 'open-market' }, origin)}
          />
        </PlaygroundShell>
      )}
      {route.kind === 'coming-soon' && (
        <PlaygroundShell
          header={{
            titleId: 'playground-game-title',
            title: GAME_DEFINITIONS[route.game].koName,
            description: '기록과 보상 규칙을 준비하고 있어요',
            backLabel: route.returnTo === 'house' ? 'JBBJ 하우스' : '게임 로비',
            onBack: () => move({ kind: 'return-to-source' }),
            showHouse: false,
            ranking,
          }}
          surfaceKey={`coming-soon-${route.game}`}
        >
          <ComingSoonGame
            game={GAME_DEFINITIONS[route.game]}
            returnLabel={route.returnTo === 'house' ? 'JBBJ 하우스' : '게임 로비'}
            onBack={() => move({ kind: 'return-to-source' })}
          />
        </PlaygroundShell>
      )}
      {route.kind === 'market' && (
        <MarketRouter
          route={route.page}
          authorizedHansol={currentUser?.name.trim() === '배한솔'}
          onNavigate={(action) => move(action)}
          onExit={() => move({ kind: 'return-to-source' })}
        />
      )}
      {wipe && (
        <DotWipeTransition
          request={wipe}
          onCovered={() => {
            if (pendingAction.current) {
              setRoute((current) => navigatePlayground(current, pendingAction.current!));
            }
          }}
          onFinished={() => {
            pendingAction.current = null;
            transitionInFlight.current = false;
            setWipe(null);
          }}
        />
      )}
    </section>
  );
}
