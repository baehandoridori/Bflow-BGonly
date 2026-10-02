import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useMotionPref } from '@/hooks/useMotionPref';
import { animateEl } from '@/utils/motion';
import { placeAnchoredTooltip, tooltipTransform, type TooltipAnchor } from '@/utils/tooltipPosition';

/*
 * 대시보드 그래프 말풍선 (움직임 폴리싱 2번 tooltip-anchor)
 * - '최근 작업' 칸 그림·막대, '부서별 비교' 막대에 마우스를 올리면 그 칸/막대 바로 위 가운데에 뜬다.
 * - 예전에는 위젯이 말풍선 위치를 상태로 들고 있어 마우스가 움직일 때마다 위젯 전체를 다시 그렸다.
 *   여기서는 위젯이 show/hide 만 부르고, 말풍선이 자기 내용만 다시 그린다. 자리는 transform 하나로 놓는다.
 * - 등장·퇴장은 투명도만 120ms(동작 줄이기 100ms). 칸 사이를 옮길 때 깜빡이지 않게 숨김은 60ms 기다린다.
 * - 뒤를 흐리게 하는 효과(backdrop-filter)는 쓰지 않는다 — 움직일 때마다 흐림을 다시 계산해 무겁다.
 */
export interface ChartHoverTooltipHandle {
  /**
   * 말풍선을 anchor 위에 띄운다. key·identity 가 지금 내용과 같으면 내용은 그대로 두고 자리만 옮긴다
   * (React 재렌더 없음). identity 에는 보여 줄 데이터 객체를 넘긴다 — 데이터가 새로 오면 내용도 새로 그린다.
   */
  show(key: string, identity: unknown, content: ReactNode, anchor: TooltipAnchor): void;
  hide(): void;
}

interface ChartHoverTooltipProps {
  className?: string;
  style?: CSSProperties;
  /** 가리킨 칸/막대와의 간격(px). */
  gap?: number;
}

const HIDE_DELAY = 60;
const FADE_MS = 120;
const REDUCED_FADE_MS = 100;

interface TooltipContent {
  key: string;
  identity: unknown;
  node: ReactNode;
}

export const ChartHoverTooltip = forwardRef<ChartHoverTooltipHandle, ChartHoverTooltipProps>(
  function ChartHoverTooltip({ className, style, gap = 8 }, ref) {
    const { reduce } = useMotionPref();
    const reduceRef = useRef(reduce);
    reduceRef.current = reduce;

    const [content, setContent] = useState<TooltipContent | null>(null);
    const contentRef = useRef<TooltipContent | null>(null);
    const posRef = useRef<HTMLDivElement | null>(null);
    const boxRef = useRef<HTMLDivElement | null>(null);
    const anchorRef = useRef<TooltipAnchor | null>(null);
    const visible = useRef(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout>>();

    const place = useCallback(() => {
      const pos = posRef.current;
      const box = boxRef.current;
      const anchor = anchorRef.current;
      if (!pos || !box || !anchor) return;
      const placement = placeAnchoredTooltip(
        anchor,
        { width: box.offsetWidth, height: box.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { gapAbove: gap },
      );
      pos.style.transform = tooltipTransform(placement);
    }, [gap]);

    const fadeTo = useCallback((to: 0 | 1) => {
      const box = boxRef.current;
      if (!box) return;
      const from = getComputedStyle(box).opacity;
      box.getAnimations?.().forEach((animation) => animation.cancel());
      box.style.opacity = String(to);
      animateEl(
        box,
        [{ opacity: from }, { opacity: to }],
        { duration: reduceRef.current ? REDUCED_FADE_MS : FADE_MS, easing: 'ease-out' },
        false, // 투명도만 바뀌므로 동작 줄이기에서도 그대로(길이만 짧게)
      );
    }, []);

    const reveal = useCallback(() => {
      if (visible.current) return;
      visible.current = true;
      fadeTo(1);
    }, [fadeTo]);

    useImperativeHandle(ref, () => ({
      show(key, identity, node, anchor) {
        clearTimeout(hideTimer.current);
        anchorRef.current = anchor;
        const current = contentRef.current;
        if (current && current.key === key && current.identity === identity) {
          place();
          reveal();
          return;
        }
        const next = { key, identity, node };
        contentRef.current = next;
        setContent(next);
      },
      hide() {
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => {
          if (!visible.current) return;
          visible.current = false;
          fadeTo(0);
        }, HIDE_DELAY);
      },
    }), [fadeTo, place, reveal]);

    // 새 내용이 그려진 직후(칠하기 전) 실측 크기로 자리를 잡고 보인다.
    useLayoutEffect(() => {
      if (!content) return;
      place();
      reveal();
    }, [content, place, reveal]);

    useEffect(() => () => clearTimeout(hideTimer.current), []);

    return createPortal(
      <div ref={posRef} className="fixed left-0 top-0 z-[9999] pointer-events-none">
        <div ref={boxRef} className={className} style={{ opacity: 0, ...style }}>
          {content?.node}
        </div>
      </div>,
      document.body,
    );
  },
);
