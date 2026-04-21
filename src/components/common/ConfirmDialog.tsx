import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type ConfirmOptions = {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
};

type InternalState = ConfirmOptions & { resolve: (ok: boolean) => void };

let externalShow: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

export function ConfirmDialogHost() {
  const [state, setState] = useState<InternalState | null>(null);

  useEffect(() => {
    externalShow = (opts) =>
      new Promise<boolean>((resolve) => {
        setState({ ...opts, resolve });
      });
    return () => {
      externalShow = null;
    };
  }, []);

  if (!state) return null;

  const handle = (ok: boolean) => {
    state.resolve(ok);
    setState(null);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={() => handle(false)}
    >
      <div
        role="dialog"
        className="bg-[#1A1D27] border border-[#2D3041] rounded-lg p-6 min-w-[320px] max-w-[480px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[#E8E8EE] text-sm mb-5 whitespace-pre-line">{state.message}</p>
        <div className="flex justify-end gap-2">
          <button
            className="px-4 py-2 rounded text-sm text-[#8B8DA3] hover:bg-[#2D3041]"
            onClick={() => handle(false)}
            autoFocus
          >
            {state.cancelLabel ?? '취소'}
          </button>
          <button
            className={`px-4 py-2 rounded text-sm font-medium ${
              state.tone === 'danger'
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-[#6C5CE7] hover:bg-[#7D6FFF] text-white'
            }`}
            onClick={() => handle(true)}
          >
            {state.confirmLabel ?? '확인'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const ConfirmDialog = {
  show(opts: ConfirmOptions): Promise<boolean> {
    if (!externalShow) {
      console.warn('[ConfirmDialog] Host not mounted, falling back to window.confirm');
      return Promise.resolve(window.confirm(opts.message));
    }
    return externalShow(opts);
  },
};
