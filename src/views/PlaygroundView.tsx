import { useEffect, useMemo, useRef, useState } from 'react';

import { createBackInterceptionStack } from '@/features/playground/backInterception';
import { GAME_DEFINITIONS } from '@/features/playground/catalog';
import {
  createPlaygroundHistory,
  requestPlaygroundBack,
  type PlaygroundMarketRestoreRequest,
} from '@/features/playground/history';
import { advanceRecommendation, createRecommendationSession } from '@/features/playground/recommendation';
import { buildPointRanking, mergeRankingTeammates } from '@/features/playground/ranking';
import { useArcadeStore } from '@/features/playground/arcade/useArcadeStore';
import { initArcadeWalletBridge } from '@/features/playground/arcade/walletBridge';
import { subscribePlaygroundNativeBack } from '@/features/playground/nativeBackBridge';
import {
  getPlaygroundRouteIdentity,
  initialPlaygroundRoute,
  navigatePlayground,
  shouldReplacePlaygroundNavigation,
  type PlaygroundAction,
  type PlaygroundRoute,
} from '@/features/playground/routes';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { DotWipeTransition } from '@/features/playground/transition/DotWipeTransition';
import { getPlaygroundMovePlan } from '@/features/playground/transition/playgroundTransitionPolicy';
import type { DotWipeRequest } from '@/features/playground/transition/usePlaygroundEntryStore';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { GameHost } from './playground/arcade/GameHost';
import { JbbjHouse } from './playground/JbbjHouse';
import { PlaygroundBackProvider } from './playground/PlaygroundBackProvider';
import { PlaygroundLobby } from './playground/PlaygroundLobby';
import { PlaygroundShell } from './playground/PlaygroundShell';
import { MarketRouter } from './playground/market/MarketRouter';

interface StoredMarketSurface {
  scrollTop: number;
  openerId: string | null;
}

function marketScrollSelector(route: PlaygroundRoute): string | null {
  if (route.kind !== 'market') return null;
  return route.page.kind === 'stock'
    ? '[data-market-scroll-container]'
    : '[data-market-page-scroll-container]';
}

interface PlaygroundViewProps {
  authorizedHansol: boolean;
}

export default function PlaygroundView({ authorizedHansol }: PlaygroundViewProps) {
  const [route, setRoute] = useState<PlaygroundRoute>(initialPlaygroundRoute);
  const [recommendation, setRecommendation] = useState(createRecommendationSession);
  const [wipe, setWipe] = useState<DotWipeRequest | null>(null);
  const [marketRestoreRequest, setMarketRestoreRequest] = useState<PlaygroundMarketRestoreRequest | null>(null);
  const historyRef = useRef(createPlaygroundHistory(initialPlaygroundRoute));
  const routeRef = useRef<PlaygroundRoute>(initialPlaygroundRoute);
  const pendingAction = useRef<PlaygroundAction | null>(null);
  const transitionInFlight = useRef(false);
  const sequence = useRef(0);
  const restoreSequence = useRef(0);
  const marketSurfaceState = useRef(new Map<string, StoredMarketSurface>());
  const backInterceptors = useRef(createBackInterceptionStack()).current;
  const requestBackRef = useRef<() => void>(() => undefined);
  const currentUser = useAuthStore((state) => state.currentUser);
  const currentUserId = currentUser?.id ?? null;
  const userScopeRef = useRef(currentUserId);
  const users = useAuthStore((state) => state.users);
  const visible = useMarketPreviewStore((state) => state.visible);
  const loadMarket = useMarketPreviewStore((state) => state.load);
  const arcadeSnapshot = useArcadeStore((state) => state.snapshot);
  const loadArcade = useArcadeStore((state) => state.load);
  const userName = currentUser?.name.trim() || '팀원';
  const marketCashWon = visible?.account.cashWon ?? null;
  const arcadeWalletPoints = arcadeSnapshot?.wallet.walletPoints ?? null;
  const arcadeLifetimePoints = arcadeSnapshot?.wallet.lifetimeEarnedPoints ?? null;
  const walletLeaderboard = arcadeSnapshot?.walletLeaderboard;
  const teammates = useMemo(
    () => mergeRankingTeammates(currentUserId, walletLeaderboard ?? [], users),
    [users, walletLeaderboard, currentUserId],
  );
  const ranking = useMemo(() => buildPointRanking({
    id: currentUser?.id ?? 'preview-user',
    name: userName,
    walletPoints: arcadeWalletPoints,
    lifetimeEarnedPoints: arcadeLifetimePoints,
  }, teammates), [currentUser?.id, arcadeLifetimePoints, userName, arcadeWalletPoints, teammates]);

  const captureMarketSurface = (targetRoute: PlaygroundRoute) => {
    const selector = marketScrollSelector(targetRoute);
    if (!selector) return;
    const scroller = document.querySelector<HTMLElement>(selector);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    marketSurfaceState.current.set(getPlaygroundRouteIdentity(targetRoute), {
      scrollTop: scroller?.scrollTop ?? 0,
      openerId: active?.id || null,
    });
  };

  const restoreRequestFor = (targetRoute: PlaygroundRoute): PlaygroundMarketRestoreRequest | null => {
    if (targetRoute.kind !== 'market') return null;
    const stored = marketSurfaceState.current.get(getPlaygroundRouteIdentity(targetRoute));
    if (!stored) return null;
    return { id: ++restoreSequence.current, ...stored };
  };

  const renderRoute = (
    nextRoute: PlaygroundRoute,
    restoreRequest: PlaygroundMarketRestoreRequest | null = null,
  ) => {
    routeRef.current = nextRoute;
    setMarketRestoreRequest(restoreRequest);
    setRoute(nextRoute);
  };

  const commitNavigation = (action: PlaygroundAction) => {
    const current = historyRef.current.current();
    captureMarketSurface(current);
    const next = navigatePlayground(current, action);
    if (shouldReplacePlaygroundNavigation(action, current, next)) {
      historyRef.current.replace(next);
    } else {
      historyRef.current.push(next);
    }
    renderRoute(next);
  };

  const requestBack = () => {
    const result = requestPlaygroundBack({
      history: historyRef.current,
      interceptOverlay: () => backInterceptors.interceptTop(),
      mutating: useMarketPreviewStore.getState().mutating,
      transitioning: transitionInFlight.current,
      beforeNavigate: () => captureMarketSurface(historyRef.current.current()),
    });
    if (result.kind === 'navigated') {
      renderRoute(result.route, restoreRequestFor(result.route));
      return;
    }
    if (result.kind !== 'empty') return;

    const current = historyRef.current.current();
    const fallback = current.kind === 'house'
      ? navigatePlayground(current, { kind: 'go-lobby' })
      : current.kind === 'game' || current.kind === 'market'
        ? navigatePlayground(current, { kind: 'return-to-source' })
        : null;
    if (!fallback) return;
    historyRef.current.replace(fallback);
    renderRoute(fallback, restoreRequestFor(fallback));
  };
  requestBackRef.current = requestBack;

  useEffect(() => {
    if (!currentUser?.id) return;
    void loadMarket(currentUser.id);
  }, [currentUser?.id, loadMarket]);

  useEffect(() => {
    if (!currentUser?.id) return;
    // 몰입형 playground 로 바로 복원되면 Header(포인트 배지)가 안 뜨므로 여기서도 브릿지를
    // 초기화한다(중복 등록 가드가 있어 배지와 함께 켜져도 안전). 이후 지갑 push·마켓 변경 수신.
    initArcadeWalletBridge();
    void loadArcade(currentUser.id);
  }, [currentUser?.id, loadArcade]);

  useEffect(() => {
    if (userScopeRef.current === currentUserId) return;
    userScopeRef.current = currentUserId;
    historyRef.current = createPlaygroundHistory(initialPlaygroundRoute);
    routeRef.current = initialPlaygroundRoute;
    pendingAction.current = null;
    transitionInFlight.current = false;
    marketSurfaceState.current.clear();
    setMarketRestoreRequest(null);
    setWipe(null);
    setRoute(initialPlaygroundRoute);
  }, [currentUserId]);

  useEffect(() => {
    const dispose = subscribePlaygroundNativeBack(() => requestBackRef.current());
    return dispose;
  }, []);

  useEffect(() => () => backInterceptors.clear(), [backInterceptors]);

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
    if (transitionInFlight.current) return;
    const resolvedOrigin = origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const plan = getPlaygroundMovePlan(
      routeRef.current,
      action,
      resolvedOrigin,
    );
    if (plan.mode !== 'dot') {
      commitNavigation(action);
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
    <PlaygroundBackProvider registry={backInterceptors}>
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
              onBack: requestBack,
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
        {route.kind === 'game' && (
          <PlaygroundShell
            header={{
              titleId: 'playground-game-title',
              title: GAME_DEFINITIONS[route.game].koName,
              description: route.game === 'snake' ? '포인트를 내고 시작해 등급 보상을 받아요' : '기록과 보상 규칙을 준비하고 있어요',
              backLabel: route.returnTo === 'house' ? 'JBBJ 하우스' : '게임 로비',
              onBack: requestBack,
              showHouse: false,
              ranking,
            }}
            surfaceKey={`game-${route.game}`}
          >
            <GameHost
              game={route.game}
              returnLabel={route.returnTo === 'house' ? 'JBBJ 하우스' : '게임 로비'}
              // 게임 종료(확인 후)·결과 '로비로' 는 뒤로가기 인터셉터를 거치지 않는 직접 이탈로 나간다.
              // requestBack 을 쓰면 진행 중 인터셉터가 그 요청을 다시 가로채 갇힌다(Codex P1).
              onExit={() => move({ kind: 'return-to-source' })}
            />
          </PlaygroundShell>
        )}
        {route.kind === 'market' && (
          <MarketRouter
            route={route.page}
            authorizedHansol={authorizedHansol}
            restoreRequest={marketRestoreRequest}
            onNavigate={(action) => move(action)}
            onBack={requestBack}
          />
        )}
        {wipe && (
          <DotWipeTransition
            request={wipe}
            onCovered={() => {
              const action = pendingAction.current;
              if (action) {
                pendingAction.current = null;
                commitNavigation(action);
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
    </PlaygroundBackProvider>
  );
}
