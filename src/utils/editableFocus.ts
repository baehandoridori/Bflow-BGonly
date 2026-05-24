const EDITABLE_SELECTOR = [
  'textarea',
  'select',
  'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="hidden"])',
  '[contenteditable="true"]',
].join(',');

export function getEditableElementFromTarget(target: EventTarget | null): HTMLElement | null {
  const node = target instanceof Node ? target : null;
  const el = target instanceof HTMLElement ? target : node?.parentElement ?? null;
  if (el?.isContentEditable) return el;
  const editable = el?.closest(EDITABLE_SELECTOR) as HTMLElement | null;
  if (!editable) return null;
  if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
    if (editable.disabled || editable.readOnly) return null;
  }
  if (editable instanceof HTMLSelectElement && editable.disabled) {
    return null;
  }
  return editable;
}

function focusEditable(editable: HTMLElement): void {
  window.setTimeout(() => {
    if (!editable.isConnected) return;
    if (document.activeElement === editable) return;
    try {
      editable.focus({ preventScroll: true });
    } catch {
      editable.focus();
    }
  }, 0);
}

export function installEditableFocusRecovery(): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const editable = getEditableElementFromTarget(event.target);
    if (!editable) return;
    focusEditable(editable);
  };

  const onFocusIn = (event: FocusEvent) => {
    const editable = getEditableElementFromTarget(event.target);
    if (editable) lastEditable = editable;
  };

  const onWindowFocus = () => {
    if (!lastEditable?.isConnected) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    focusEditable(lastEditable);
  };

  let lastEditable: HTMLElement | null = null;
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('focus', onWindowFocus);

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('focus', onWindowFocus);
  };
}
