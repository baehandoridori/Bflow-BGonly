import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface MarketActionDialogProps {
  open: boolean;
  title: string;
  description?: string;
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

function enabledControls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.offsetParent !== null);
}

export function MarketActionDialog({
  open,
  title,
  description,
  openerRef,
  children,
  onClose,
}: MarketActionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;

    const root = document.getElementById('root');
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    if (root) {
      root.inert = true;
      root.setAttribute('aria-hidden', 'true');
    }

    const focusFrame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      (enabledControls(panel)[0] ?? panel).focus();
    });

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
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      if (root) {
        root.inert = false;
        root.removeAttribute('aria-hidden');
      }
      if (openerRef.current && document.contains(openerRef.current)) openerRef.current.focus();
      else if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [open, openerRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-bg-primary/80 p-0 backdrop-blur-sm sm:items-center sm:p-5"
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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-bg-border bg-bg-card p-5 text-text-primary shadow-2xl outline-none sm:rounded-3xl sm:p-6"
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
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-text-secondary transition-colors duration-200 hover:bg-bg-border/45 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
