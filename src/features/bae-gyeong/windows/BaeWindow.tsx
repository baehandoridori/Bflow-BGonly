// BAE경 팝업 창 틀 (계획 14d 1장 · 9장): 머리 · 몸 · 발, 닫기(X · 창 바깥 · Esc), 포커스 가두기, 뒤 화면 스크롤 잠금.
// 창은 한 번에 하나 — 여는 쪽(useBaeWindows)이 지킨다. 스스로 떠오른 창은 0.4초 동안 바깥 누름을 받지 않는다
// (뜨는 순간 다른 곳을 누르던 손에 닫히지 않게, tasks/lessons '네이티브 dialog 모달 함정').
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '@/hooks/useModalFocus';
import './bae-windows.css';

export type BaeWindowTool = 'new' | 'same' | 'make' | 'layers' | 'angle' | 'upscale' | 'denoise' | 'style';
const TOOL_CLASS: Record<BaeWindowTool, string> = {
  new: '', same: 'bae-tool-same', make: '', layers: 'bae-tool-layers', angle: 'bae-tool-angle', upscale: 'bae-tool-upscale', denoise: 'bae-tool-denoise', style: '',
};

export interface BaeWindowProps {
  tool: BaeWindowTool;
  icon: ReactNode;
  title: string;
  sub: string;
  /** 머리의 닫기 X 앞에 놓을 버튼들 ('재료로 돌아가기', '돌아가기' 등) */
  headActions?: ReactNode;
  footNote?: ReactNode;
  footActions?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** 열릴 때 포커스를 둘 곳. 없으면 제목 (돈이 나가는 버튼에 두지 않는다 — 14e 8장). */
  initialFocus?: RefObject<HTMLElement>;
  /** 사용자가 누르지 않았는데 저절로 떠오른 창 */
  autoOpened?: boolean;
}

export function BaeWindow({ tool, icon, title, sub, headActions, footNote, footActions, children, onClose, initialFocus, autoOpened }: BaeWindowProps) {
  const winRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openedAt = useRef(performance.now());
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { onKeyDown } = useModalFocus(winRef, { active: true });

  useEffect(() => {
    const t = window.setTimeout(() => {
      const target = initialFocus?.current ?? titleRef.current;
      target?.focus({ preventScroll: true });
    }, 0);
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => { window.clearTimeout(t); html.style.overflow = before; };
    // 처음 한 번만 (창이 뜰 때)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScrim = () => {
    if (autoOpened && performance.now() - openedAt.current < 400) return;
    onCloseRef.current();
  };

  return createPortal(
    <div className="bae-root bae-pop">
      <button type="button" className="bae-pop-scrim bf-scrim-in" aria-label="창 닫기" tabIndex={-1} onClick={onScrim} />
      <section
        ref={winRef}
        className={`bae-win bf-modal-in ${TOOL_CLASS[tool]}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bae-win-h"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.stopPropagation(); onCloseRef.current(); return; }
          onKeyDown(e);
        }}
      >
        <header className="bae-win-head">
          <span className="bae-win-ic" aria-hidden="true">{icon}</span>
          <div className="bae-win-names">
            <h2 className="bae-win-title" id="bae-win-h" ref={titleRef} tabIndex={-1}>{title}</h2>
            <p className="bae-win-sub">{sub}</p>
          </div>
          {headActions}
          <button type="button" className="bae-ib" aria-label="창 닫기" title="닫기" onClick={() => onCloseRef.current()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </header>
        <div className="bae-win-body">{children}</div>
        {(footNote || footActions) && (
          <footer className="bae-win-foot">
            {footNote ? <p className="bae-win-note">{footNote}</p> : null}
            {footActions}
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}
