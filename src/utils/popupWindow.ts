/**
 * 이 창이 위젯 팝업 창(새 창으로 띄운 위젯·캐릭터 현황판·캘린더)인지.
 *
 * 팝업 창은 같은 앱을 `#widget-popup/<id>` 해시로 연다 — main.tsx 가 그 해시를 보고 WidgetPopup 을 그린다.
 * 팝업인지는 창의 성질이라 창이 살아 있는 동안 바뀌지 않는다.
 *
 * 컴포넌트 안에서는 보통 `IsPopupContext` 를 쓰지만, 훅을 쓸 수 없는 곳(유틸·이벤트 핸들러)이나
 * 훅을 흉내 내어 함수를 직접 부르는 테스트가 있는 컴포넌트(ScheduleView·CalendarRail·EventSidePanel)는 이 함수를 쓴다.
 */
export function isWidgetPopupWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location?.hash;
  return typeof hash === 'string' && hash.startsWith('#widget-popup/');
}

/**
 * 지금 보는 화면을 새 창으로 띄울 수 있는지 — 본 창이고, 새 창 열기 기능이 있을 때만.
 * 이미 새 창 안이면 '새 창으로' 버튼을 숨긴다.
 */
export function canPopOutToWindow(): boolean {
  return typeof window !== 'undefined'
    && !isWidgetPopupWindow()
    && typeof window.electronAPI?.widgetOpenPopup === 'function';
}
