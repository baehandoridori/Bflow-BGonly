import { useCallback, useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

export function useModalFocus<T extends HTMLElement>(
  ref: RefObject<T>,
  opts: { active?: boolean; autoFocus?: boolean } = {},
) {
  const { active = true, autoFocus = false } = opts;

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let timer = 0;

    if (autoFocus) {
      timer = window.setTimeout(() => {
        const root = ref.current;
        if (!root || root.contains(document.activeElement)) return;
        root.focus({ preventScroll: true });
      }, 0);
    }

    return () => {
      if (timer) window.clearTimeout(timer);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [active, autoFocus, ref]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = getFocusable(ref.current);
    if (focusable.length === 0) {
      event.preventDefault();
      ref.current?.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }, [ref]);

  return { onKeyDown };
}
