/**
 * 요소를 가장 가까운 '스크롤 가능한' 조상 안에서 가운데로 옮긴다.
 *
 * element.scrollIntoView 는 overflow:hidden 인 바깥 상자(메인 화면 등)까지 끌고 가서,
 * 사이드바 목록 하나를 맞추려다 화면 전체가 움찔할 수 있다. 실제로 스크롤되는 상자 하나만 움직인다.
 */
export function scrollIntoNearestScroller(element: HTMLElement, behavior: ScrollBehavior): void {
  let scroller = element.parentElement;
  while (scroller) {
    const { overflowY } = getComputedStyle(scroller);
    if ((overflowY === 'auto' || overflowY === 'scroll') && scroller.scrollHeight > scroller.clientHeight) break;
    scroller = scroller.parentElement;
  }
  if (!scroller) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const top = scroller.scrollTop + (rect.top - scrollerRect.top) - (scroller.clientHeight - rect.height) / 2;
  const maxTop = scroller.scrollHeight - scroller.clientHeight;
  scroller.scrollTo({ top: Math.min(maxTop, Math.max(0, top)), behavior });
}
