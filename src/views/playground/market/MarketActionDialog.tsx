import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { usePlaygroundBackInterceptor } from '../PlaygroundBackProvider';

interface MarketActionDialogProps {
  open: boolean;
  title: string;
  description?: string;
  focusKey?: string | number | null;
  initialFocusId?: string;
  initialFocusFallbackId?: string;
  presentation?: 'dialog' | 'sheet';
  openerRef: RefObject<HTMLElement>;
  children: ReactNode;
  onClose(): void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const dialogBackdropClass = 'fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-bg-primary/80 p-0 backdrop-blur-sm sm:items-center sm:p-5';
const sheetBackdropClass = 'fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-bg-primary/80 p-0 backdrop-blur-sm xl:items-center xl:p-5';
const dialogPanelClass = 'max-h-[calc(100dvh-1rem)] w-full max-w-lg overscroll-contain overflow-y-auto rounded-t-3xl border border-bg-border bg-bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-text-primary shadow-2xl outline-none sm:max-h-[90dvh] sm:rounded-3xl sm:p-6 sm:pb-6';
const sheetPanelClass = 'max-h-[calc(100dvh-1rem)] w-full max-w-lg overscroll-contain overflow-y-auto rounded-t-3xl border border-bg-border bg-bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-text-primary shadow-2xl outline-none xl:max-h-[90dvh] xl:rounded-3xl xl:p-6 xl:pb-6';

function enabledControls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null);
}

function canReceiveProgrammaticFocus(container: HTMLElement, element: HTMLElement | null): element is HTMLElement {
  return element !== null
    && container.contains(element)
    && element.offsetParent !== null
    && element.getAttribute('aria-hidden') !== 'true'
    && !element.matches(':disabled');
}

export function MarketActionDialog({
  open,
  title,
  description,
  focusKey,
  initialFocusId,
  initialFocusFallbackId,
  presentation = 'dialog',
  openerRef,
  children,
  onClose,
}: MarketActionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  usePlaygroundBackInterceptor(open, () => onCloseRef.current());

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;

    const root = document.getElementById('root');
    const previousBodyOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    document.body.style.overflow = 'hidden';
    if (root) {
      root.inert = true;
      root.setAttribute('aria-hidden', 'true');
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const controls = enabledControls(panel);
      if (controls.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = document.activeElement;
      const activeControl = active instanceof HTMLElement && controls.includes(active)
        ? active
        : null;
      if (activeControl === null) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeControl === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeControl === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (root) {
        root.inert = false;
        root.removeAttribute('aria-hidden');
      }
      document.body.style.overflow = previousBodyOverflow;
      if (openerRef.current && document.contains(openerRef.current)) openerRef.current.focus();
      else if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, openerRef]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const focusFrame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const preferredControl = initialFocusId
        ? document.getElementById(initialFocusId)
        : null;
      const fallbackControl = initialFocusFallbackId
        ? document.getElementById(initialFocusFallbackId)
        : null;
      const controls = enabledControls(panel);
      const focusTarget = canReceiveProgrammaticFocus(panel, preferredControl)
        ? preferredControl
        : canReceiveProgrammaticFocus(panel, fallbackControl)
          ? fallbackControl
          : controls[0] ?? panel;
      focusTarget.focus();
    });
    return () => cancelAnimationFrame(focusFrame);
  }, [focusKey, initialFocusFallbackId, initialFocusId, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={presentation === 'sheet' ? sheetBackdropClass : dialogBackdropClass}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={presentation === 'sheet' ? sheetPanelClass : dialogPanelClass}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-bold leading-7 text-text-primary">
              {title}
            </h2>
            <p
              id={descriptionId}
              className={description ? 'mt-2 text-sm leading-6 text-text-secondary' : 'sr-only'}
            >
              {description ?? `${title} 대화상자입니다.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-text-secondary transition-[background-color,color,transform] duration-150 ease-out motion-reduce:transition-none hover:bg-bg-border/45 hover:text-text-primary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="대화상자 닫기"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
