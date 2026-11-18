/**
 * 기록 한 건 보기의 코멘트 칸 — 화면 오른쪽 가장자리에 붙은 손잡이('코멘트 3' · '코멘트 남기기')를 누르면 오른쪽에서 밀려 나오는 칸.
 * 기본은 접힘(이 PC 에 기억하지 않는다 — 열 때마다 접힌 채로). 알림 · 바로가기로 들어오면(focusCommentId) 저절로 펼쳐서
 * 그 코멘트로 가고 강조한다(그 일은 댓글 패널이 한다). 접기 버튼 · Esc · 손잡이로 접는다.
 * 접혀 있어도 칸은 그대로 살아 있다(보이지 않고 누를 수 없을 뿐) — 그래서 코멘트 수 · 실시간 새로 읽기 · @멘션 · 답글 · 반응 ·
 * 그림 첨부가 그대로이고, 서버를 더 부르지 않는다. 기록 한 건 보기(records/JobView)가 그 화면 맨 끝에 한 번 붙인다.
 * 칸과 손잡이는 본문 스크롤과 함께 움직이지 않게 고정 위치로 두고, 붙을 자리는 본문 칸 · 기록 화면의 크기에서 잰다.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, MessageSquare, PanelRightClose } from 'lucide-react';
import { BaeJobComments } from './BaeJobComments';
import './bae-comments-dock.css';

export interface BaeJobCommentsDockProps {
  jobId: string;
  jobName: string | null;
  /** 알림 · 바로가기로 온 코멘트 — 있으면 펼친 채로 열고, 바뀌면 다시 펼친다. */
  focusCommentId: string | null;
  /**
   * 붙을 화면(기록 한 건 보기)의 요소. 그 오른쪽 가장자리에 손잡이가 붙는다. ref 객체가 아니라 요소를 받는다 —
   * 이 칸은 그 화면의 자식이라, 처음 그릴 때 자식의 layout effect 가 부모 ref 가 붙기 전에 돈다(콜백 ref 로 state 에 담아 넘긴다).
   */
  anchor: HTMLElement | null;
}

/** 손잡이 너비(px) — 기록 화면 오른쪽 바깥 여백이 이보다 넓으면 바깥에 붙이고, 좁으면 안쪽에 겹친다. */
const TAB_W = 34;
/** 칸 위아래 여백(px). */
const GAP = 12;
/** 손잡이는 보이는 본문 칸 위에서 이만큼 아래 (처음 열었을 때 결과 그림 옆쯤). 스크롤해도 그 자리. */
const TAB_TOP = 112;

interface DockBox { top: number; bottom: number; right: number; tabTop: number; tabLeft: number; outside: boolean }

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

const sameBox = (a: DockBox, b: DockBox) =>
  a.top === b.top && a.bottom === b.bottom && a.right === b.right && a.tabTop === b.tabTop && a.tabLeft === b.tabLeft && a.outside === b.outside;

/** 고정 위치의 자리: 위아래는 보이는 본문 칸(스크롤 상자) 안, 오른쪽은 기록 화면의 오른쪽 가장자리. 크기가 바뀔 때만 다시 잰다. */
function useDockBox(anchor: HTMLElement | null): DockBox | null {
  const [box, setBox] = useState<DockBox | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const scroller = scrollParentOf(anchor);
    let raf = 0;
    const measure = () => {
      raf = 0;
      const a = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      let top = 0;
      let bottom = vh;
      let right = vw;
      if (scroller) {
        const s = scroller.getBoundingClientRect();
        top = s.top + scroller.clientTop;
        bottom = top + scroller.clientHeight;
        right = s.left + scroller.clientLeft + scroller.clientWidth;
      }
      const outside = right - a.right >= TAB_W + 4;
      const next: DockBox = {
        top: Math.round(top + GAP),
        bottom: Math.round(Math.max(0, vh - bottom) + GAP),
        right: Math.round(Math.max(0, vw - a.right) + (outside ? 0 : TAB_W + 4)),
        tabTop: Math.round(top + TAB_TOP),
        tabLeft: Math.round(outside ? a.right - 1 : a.right - TAB_W),
        outside,
      };
      setBox((prev) => (prev && sameBox(prev, next) ? prev : next));
    };
    measure();
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(anchor);
    if (scroller) ro?.observe(scroller);
    window.addEventListener('resize', schedule);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [anchor]);
  return box;
}

export function BaeJobCommentsDock({ jobId, jobName, focusCommentId, anchor }: BaeJobCommentsDockProps) {
  // 기본은 접힘. 알림 · 바로가기로 왔으면 처음부터 펼친 채(밀려 나오는 움직임 없이).
  const [open, setOpen] = useState(() => !!focusCommentId);
  /** 아직 모름(불러오는 중) = null */
  const [count, setCount] = useState<number | null>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const panelId = useId();
  const box = useDockBox(anchor);

  // 같은 기록을 보는 중에 새 알림으로 다른 코멘트가 오면 다시 펼친다.
  useEffect(() => {
    if (focusCommentId) setOpen(true);
  }, [focusCommentId]);

  // 접힌 칸은 누를 수도, 초점이 들어갈 수도, 읽어 줄 수도 없다.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (el) el.inert = !open;
  }, [open]);

  // 손잡이로 펼쳤으면 초점을 칸으로 (Esc 로 바로 접을 수 있게). 알림으로 펼친 때는 초점을 옮기지 않는다.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const raf = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const openPanel = useCallback(() => {
    focusOnOpen.current = true;
    setOpen(true);
  }, []);
  const closePanel = useCallback(() => {
    const panel = panelRef.current;
    if (panel && panel.contains(document.activeElement)) tabRef.current?.focus({ preventScroll: true });
    setOpen(false);
  }, []);

  // Esc 로 접기 — 칸 안의 다른 것(수정 중인 글 · @멘션 목록 · 메뉴 · 이모지 창 · 그림 확대 · 답글 칸)이 Esc 를 쓰면 그쪽이 먼저다.
  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.nativeEvent.isComposing || e.nativeEvent.defaultPrevented) return;
    const panel = panelRef.current;
    const target = e.target as Element | null;
    if (!panel || !target || !panel.contains(target)) return; // 칸 밖으로 띄운 것(그림 확대 등)의 키
    if (target.closest('[role="menu"], [role="listbox"], [role="dialog"], .cmt-menu')) return;
    if (document.querySelector('[aria-modal="true"]')) return; // 위에 뜬 창이 있다
    e.preventDefault();
    e.stopPropagation();
    closePanel();
  };

  const label = count === null ? '코멘트' : count === 0 ? '코멘트 남기기' : '코멘트';
  const action = open ? '코멘트 접기' : count ? `코멘트 ${count}개 열기` : count === 0 ? '코멘트 남기기' : '코멘트 열기';

  return (
    <>
      <button
        ref={tabRef}
        type="button"
        className={`bae-cmt-tab${open ? ' is-open' : ''}${count ? ' has-count' : ''}${box && !box.outside ? ' is-inside' : ''}`}
        style={box ? { top: box.tabTop, left: box.tabLeft } : { visibility: 'hidden' }}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={action}
        title={action}
        onClick={() => (open ? closePanel() : openPanel())}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); closePanel(); }
        }}
      >
        <MessageSquare size={16} aria-hidden="true" />
        {count ? <span key={count} className="bae-cmt-tab-count bae-num" aria-hidden="true">{count > 99 ? '99+' : count}</span> : null}
        <span className="bae-cmt-tab-label" aria-hidden="true">{label}</span>
        {open ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronLeft size={14} aria-hidden="true" />}
      </button>
      <div
        ref={panelRef}
        id={panelId}
        className={`bae-cmt-dock${open ? ' is-open' : ''}`}
        style={box ? { top: box.top, bottom: box.bottom, right: box.right } : undefined}
        role="region"
        aria-label="코멘트"
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
      >
        <BaeJobComments
          jobId={jobId}
          jobName={jobName}
          focusCommentId={focusCommentId}
          heightClass="h-full"
          onCount={setCount}
          headerRight={(
            <button type="button" className="bae-cmt-fold" title="코멘트 접기 (Esc)" onClick={closePanel}>
              <PanelRightClose size={14} aria-hidden="true" />접기
            </button>
          )}
        />
      </div>
    </>
  );
}
