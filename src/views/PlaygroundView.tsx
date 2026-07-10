import { useEffect, useRef, useState } from 'react';

import {
  initialPlaygroundRoute,
  navigatePlayground,
  type PlaygroundAction,
  type PlaygroundRoute,
} from '@/features/playground/routes';
import type { Point } from '@/features/playground/transition/dotWipeMath';
import { DotWipeTransition } from '@/features/playground/transition/DotWipeTransition';
import type { DotWipeRequest } from '@/features/playground/transition/usePlaygroundEntryStore';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';
import { ComingSoonGame } from './playground/ComingSoonGame';
import { JbbjHouse } from './playground/JbbjHouse';
import { PlaygroundLobby } from './playground/PlaygroundLobby';
import { MarketRouter } from './playground/market/MarketRouter';

export default function PlaygroundView() {
  const [route, setRoute] = useState<PlaygroundRoute>(initialPlaygroundRoute);
  const [wipe, setWipe] = useState<DotWipeRequest | null>(null);
  const pendingAction = useRef<PlaygroundAction | null>(null);
  const transitionInFlight = useRef(false);
  const sequence = useRef(0);
  const loadMarket = useMarketPreviewStore((state) => state.load);

  useEffect(() => {
    const state = useMarketPreviewStore.getState();
    if (!state.visible && !state.loading) void loadMarket();
  }, [loadMarket]);

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
    if (!origin) {
      setRoute((current) => navigatePlayground(current, action));
      return;
    }
    if (wipe || transitionInFlight.current) return;
    transitionInFlight.current = true;
    pendingAction.current = action;
    setWipe({ id: ++sequence.current, origin });
  };

  return (
    <section className="relative h-full overflow-hidden bg-bg-primary text-text-primary" aria-labelledby="playground-title">
      <h1 id="playground-title" tabIndex={-1} className="sr-only outline-none">
        배플레이그라운드
      </h1>
      {route.kind === 'lobby' && <PlaygroundLobby onMove={move} />}
      {route.kind === 'house' && (
        <JbbjHouse onBack={(origin) => move({ kind: 'go-lobby' }, origin)} />
      )}
      {route.kind === 'coming-soon' && (
        <ComingSoonGame
          game={route.game}
          onBack={(origin) => move({ kind: 'go-lobby' }, origin)}
        />
      )}
      {route.kind === 'market' && (
        <MarketRouter
          route={route.page}
          onNavigate={(action) => move(action)}
          onExit={(origin) => move({ kind: 'go-lobby' }, origin)}
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
