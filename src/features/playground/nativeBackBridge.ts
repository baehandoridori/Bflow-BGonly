const noop = () => undefined;

export function subscribePlaygroundNativeBack(listener: () => void): () => void {
  if (typeof window === 'undefined') return noop;
  return window.electronAPI?.onPlaygroundNativeBack?.(listener) ?? noop;
}
