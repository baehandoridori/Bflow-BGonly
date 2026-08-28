import { useEffect } from 'react';

/**
 * 외부 캘린더(ICS) 구독 일정 로드 + 주기 갱신 수신.
 *
 * 구독 일정은 B flow/Google과 별도 캐시라 그 동기화 경로로는 채워지지 않는다.
 * 창을 열 때 한 번 읽고, 메인의 주기 갱신이 끝나면 다시 읽어 화면에 알린다.
 * 메인 창과 위젯 팝업 창이 같은 배선을 쓰도록 훅으로 뽑아 두었다.
 */
export function useIcsEventsFeed(): void {
  useEffect(() => {
    const reloadIcsEvents = async () => {
      const { loadIcsEvents } = await import('@/services/calendarService');
      if (!(await loadIcsEvents())) return;
      window.dispatchEvent(new CustomEvent('bflow:calendar-changed', { detail: { action: 'ics' } }));
    };
    void reloadIcsEvents();
    const cleanup = window.electronAPI?.onIcsChanged?.(() => { void reloadIcsEvents(); });
    return () => { cleanup?.(); };
  }, []);
}
