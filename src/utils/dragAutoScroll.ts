/**
 * 드래그 자동 스크롤 (확정 시안 A) — 드래그 중 컨테이너 가장자리 근처에서 자동 스크롤.
 * computeEdgeScrollSpeed 는 순수 함수(단위 테스트 대상), bindVerticalDragAutoScroll 은 DOM 바인더.
 * 주의: node --test 가 직접 import 한다 — '@/' alias import 금지.
 */

/** 가장자리 근접 비례 속도. edge(px) 안에 들어오면 최대 max 까지 선형 증가. 음수=위로. */
export function computeEdgeScrollSpeed(pos: number, start: number, end: number, edge = 72, max = 14): number {
  const dStart = pos - start;
  const dEnd = end - pos;
  if (dStart < edge) return -max * (1 - Math.max(0, dStart) / edge);
  if (dEnd < edge) return max * (1 - Math.max(0, dEnd) / edge);
  return 0;
}

/** el 에 dragover 기반 세로 자동 스크롤을 바인딩. 해제 함수를 반환한다. rAF 루프는 드래그 중에만 돈다. */
export function bindVerticalDragAutoScroll(el: HTMLElement): () => void {
  let vy = 0;
  let raf = 0;
  let active = false;
  const tick = () => {
    if (vy !== 0) el.scrollTop += vy;
    raf = active ? requestAnimationFrame(tick) : 0;
  };
  const stop = () => {
    vy = 0;
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  const onDragOver = (e: DragEvent) => {
    const r = el.getBoundingClientRect();
    vy = computeEdgeScrollSpeed(e.clientY, r.top, r.bottom);
    if (!active) { active = true; raf = requestAnimationFrame(tick); }
  };
  const onDragLeave = (e: DragEvent) => {
    // 자식 요소로 들어갈 때도 dragleave 가 발화한다 — 컨테이너를 실제로 벗어났을 때만 멈춘다.
    if (!el.contains(e.relatedTarget as Node | null)) stop();
  };
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('drop', stop);
  el.addEventListener('dragleave', onDragLeave);
  document.addEventListener('dragend', stop);
  return () => {
    stop();
    el.removeEventListener('dragover', onDragOver);
    el.removeEventListener('drop', stop);
    el.removeEventListener('dragleave', onDragLeave);
    document.removeEventListener('dragend', stop);
  };
}
