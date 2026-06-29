/**
 * ModalPortal — 재사용 모달 포털 래퍼
 *
 * 위젯 트리 안에서 `position: fixed` 모달을 띄우면, react-grid-layout 카드나
 * framer-motion 등 transform이 걸린 조상 요소를 기준으로 위치가 잡혀
 * 작은 팝업 창에서 모달이 잘리거나 찌그러진다.
 *
 * createPortal로 document.body에 렌더링해 transform 조상에서 벗어나게 하고,
 * 실제 뷰포트 기준으로 모달이 자리 잡도록 한다. 백드롭/ESC/포커스 트랩 같은
 * 공통 동작을 한 곳에 모아 다른 모달들도 재사용할 수 있게 한다.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';

export interface ModalPortalProps {
  onClose: () => void;
  children: React.ReactNode;
  /** 모달 제목 요소의 id (aria-labelledby 연결용) */
  labelledBy?: string;
  /** 모달 최대 너비(px). 실제 너비는 뷰포트에 맞춰 줄어든다. */
  maxWidth?: number;
}

/** 포커스 트랩 대상이 되는 요소 셀렉터 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function ModalPortal({ onClose, children, labelledBy, maxWidth = 520 }: ModalPortalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // ESC/백드롭 닫기 시, 포커스 중이던 입력칸의 onBlur(→커밋)가 먼저 실행되도록
  // active 요소를 blur 한 뒤 닫는다. (X/닫기 버튼은 클릭 시 자연스레 blur 되지만
  // ESC/백드롭은 그렇지 않아 진행 중이던 메모 편집이 조용히 사라지던 문제를 막는다.)
  const requestClose = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    onClose();
  };

  // ESC 닫기 + Tab 포커스 트랩
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose();
        return;
      }
      if (e.key === 'Tab') {
        const container = containerRef.current;
        if (!container) return;
        const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) {
          // 포커스 가능한 요소가 없으면 모달 밖으로 나가지 않게 막는다.
          e.preventDefault();
          container.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || active === container || !container.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // 마운트 시 모달 컨테이너(다이얼로그)로 포커스 이동, 언마운트 시 직전 포커스 복원.
  // 첫 포커스 가능 자식이 아니라 컨테이너(tabIndex={-1}) 자체에 포커스를 둔다 —
  // 모달에 따라 첫 포커스 자식이 '본체 씬 상세로 이동' 같은 네비게이션 버튼이라,
  // 반사적인 Enter/Space 가 의도치 않은 이동을 일으키던 문제를 막는다.
  // (AddTaskModal 의 제목 입력 자동 포커스는 별도 setTimeout 으로 그대로 동작한다.)
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  const content = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 backdrop-blur-sm"
      onClick={requestClose}
    >
      <motion.div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-bg-card border border-bg-border/50 rounded-2xl shadow-2xl flex flex-col overflow-hidden outline-none"
        style={{ width: `min(${maxWidth}px, 100vw - 32px)`, maxHeight: '85dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </div>
  );

  return createPortal(content, document.body);
}
