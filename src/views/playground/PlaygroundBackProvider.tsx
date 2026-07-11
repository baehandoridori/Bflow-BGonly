import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';

import type { PlaygroundBackInterceptionStack } from '@/features/playground/backInterception';

const PlaygroundBackContext = createContext<PlaygroundBackInterceptionStack | null>(null);

export function PlaygroundBackProvider({
  registry,
  children,
}: {
  registry: PlaygroundBackInterceptionStack;
  children: ReactNode;
}) {
  return (
    <PlaygroundBackContext.Provider value={registry}>
      {children}
    </PlaygroundBackContext.Provider>
  );
}

export function usePlaygroundBackInterceptor(
  active: boolean,
  interceptor: () => unknown,
): void {
  const registry = useContext(PlaygroundBackContext);
  const interceptorRef = useRef(interceptor);
  interceptorRef.current = interceptor;

  useEffect(() => {
    if (!active || !registry) return;
    return registry.register(() => interceptorRef.current());
  }, [active, registry]);
}
