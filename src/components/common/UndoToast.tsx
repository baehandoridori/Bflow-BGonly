import type { CSSProperties } from 'react';
import { toast as sonnerToast } from 'sonner';
import { UNDO_WINDOW_MS, createUndoWindow, type UndoWindow } from '@/utils/undoDelete';

/**
 * 움직임 폴리싱 20번 '되돌리기' 알림 카드 — '알림을 모두 지웠어요 · 되돌리기', '댓글을 지웠어요 · 되돌리기'.
 * 아래 2px 막대가 5초 동안 줄어든다(motion-comments-notify.css .bflow-undo-countdown). 5초가 지나거나 카드를 닫으면 확정.
 * 카드는 마우스를 올려도 5초에 맞춰 닫힌다 — 막대와 실제 확정 시각이 어긋나지 않게(창은 여기 시계가 정한다).
 */

/** 이 카드를 누를 때 알림 창이 '바깥 클릭'으로 닫히지 않게 고르는 클래스. */
export const UNDO_TOAST_CLASS = 'bflow-undo-toast';

function UndoToastTitle({ message, durationMs }: { message: string; durationMs: number }) {
  return (
    <>
      {message}
      <span
        aria-hidden
        className="bflow-undo-countdown"
        style={{ '--bflow-undo-ms': `${durationMs}ms` } as CSSProperties}
      />
    </>
  );
}

export interface UndoToastOptions {
  message: string;
  onUndo: () => void;
  onExpire: () => void;
  durationMs?: number;
}

/** 되돌리기 카드를 띄우고 그 시간 창을 돌려준다. 창을 먼저 확정(expire)·되돌리면(undo) 카드도 닫힌다. */
export function showUndoToast({ message, onUndo, onExpire, durationMs = UNDO_WINDOW_MS }: UndoToastOptions): UndoWindow {
  let toastId: string | number | null = null;
  // 카드 쪽(되돌리기 버튼·닫기·스스로 닫힘)에서 정해졌으면 카드는 sonner 가 닫는다.
  let closedByToast = false;
  const undoWindow = createUndoWindow({
    durationMs,
    onUndo,
    onExpire,
    onSettle: () => {
      if (!closedByToast && toastId !== null) sonnerToast.dismiss(toastId);
    },
  });
  toastId = sonnerToast(<UndoToastTitle message={message} durationMs={durationMs} />, {
    className: UNDO_TOAST_CLASS,
    // 창은 위 시계가 닫는다. 이건 혹시 시계가 멈췄을 때의 뒷받침(마우스를 올리면 sonner 는 멈춘다).
    duration: durationMs + 1000,
    action: {
      label: '되돌리기',
      onClick: () => {
        closedByToast = true;
        undoWindow.undo();
      },
    },
    onDismiss: () => {
      closedByToast = true;
      undoWindow.expire();
    },
    onAutoClose: () => {
      closedByToast = true;
      undoWindow.expire();
    },
  });
  return undoWindow;
}
