/**
 * '지금 마우스가 올라간 항목' 하나를 담는 작은 저장소(움직임 폴리싱 2번 tooltip-anchor).
 *
 * 캘린더 월 보기는 막대에 마우스를 올리고 뗄 때마다 부모 상태가 바뀌어 달력 전체(42칸 + 막대 전부)를
 * 다시 그렸다. 여기서는 바뀐 키(이전 키·새 키)를 구독한 항목에게만 알린다 — 다시 그려지는 건 그 두 막대뿐이다.
 * 여러 주에 걸친 일정은 같은 키를 쓰므로 모든 조각이 함께 밝아진다.
 *
 * node --test 가 그대로 import 하도록 런타임 의존이 없다.
 */
export interface HoverKeyStore {
  get(): string | null;
  set(key: string | null): void;
  /** key 의 '올라감' 여부가 바뀔 때만 listener 를 부른다. 해제 함수를 돌려준다. */
  subscribe(key: string, listener: () => void): () => void;
}

export function createHoverKeyStore(): HoverKeyStore {
  let current: string | null = null;
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key: string | null) => {
    if (key === null) return;
    listeners.get(key)?.forEach((listener) => listener());
  };
  return {
    get: () => current,
    set(key) {
      if (key === current) return;
      const previous = current;
      current = key;
      notify(previous);
      notify(key);
    },
    subscribe(key, listener) {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        const registered = listeners.get(key);
        if (!registered) return;
        registered.delete(listener);
        if (registered.size === 0) listeners.delete(key);
      };
    },
  };
}
