export type PlaygroundBackInterceptor = () => unknown;

export interface PlaygroundBackInterceptionStack {
  register(interceptor: PlaygroundBackInterceptor): () => void;
  interceptTop(): boolean;
  clear(): void;
}

interface InterceptorEntry {
  token: symbol;
  interceptor: PlaygroundBackInterceptor;
}

export function createBackInterceptionStack(): PlaygroundBackInterceptionStack {
  const entries: InterceptorEntry[] = [];

  return {
    register(interceptor) {
      const entry = { token: Symbol('playground-back-interceptor'), interceptor };
      entries.push(entry);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        const index = entries.findIndex((candidate) => candidate.token === entry.token);
        if (index >= 0) entries.splice(index, 1);
      };
    },
    interceptTop() {
      const top = entries[entries.length - 1];
      if (!top) return false;
      top.interceptor();
      return true;
    },
    clear() {
      entries.length = 0;
    },
  };
}
