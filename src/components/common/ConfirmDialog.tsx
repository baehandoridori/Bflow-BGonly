import { useEffect, useRef, useState } from 'react';
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
  // 화면에 떠 있는 확인 창을 ref 로도 들고 있는다 — show/언마운트에서 "지금 열려 있는지"를 최신 값으로 봐야 한다.
  const pendingRef = useRef<InternalState | null>(null);

  useEffect(() => {
    externalShow = (opts) =>
      new Promise<boolean>((resolve) => {
        // 이미 확인 창이 떠 있으면 덮어쓰지 않고 새 요청을 '취소'로 닫는다.
        //   덮어쓰면 ① 앞 창을 기다리던 쪽이 영영 응답을 못 받아 멈추고, ② 사용자가 읽던 문구가
        //   손 밑에서 바뀌어 엉뚱한 확인을 누르게 된다(느린 조회 뒤에 뜨는 확인 창이 있어 실제로 겹칠 수 있다).
        if (pendingRef.current) {
          console.warn('[ConfirmDialog] 이미 확인 창이 떠 있어 새 요청을 취소로 처리합니다');
          resolve(false);
          return;
        }
        const next = { ...opts, resolve };
        pendingRef.current = next;
        setState(next);
      });
    return () => {
      externalShow = null;
      // 호스트가 사라지면 대기 중인 확인 창을 취소로 닫는다 — 기다리던 쪽이 영구히 멈추지 않게.
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    };
  }, []);

  const handle = (ok: boolean) => {
    pendingRef.current = null;
    state?.resolve(ok);
    setState(null);
  };

  useEffect(() => {
    if (!state) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handle(false);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [state]);

  if (!state) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onMouseDown={(event) => { if (event.target === event.currentTarget) handle(false); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="확인"
        className="bg-[#1A1D27] border border-[#2D3041] rounded-lg p-6 min-w-[320px] max-w-[480px] shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
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
