import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export function claimReactKey(event: ReactKeyboardEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation?.();
}
