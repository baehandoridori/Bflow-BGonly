import { useLayoutEffect, useMemo } from 'react';
import {
  ENTRY_WINDOW_MS,
  dashboardEntryGate,
  entryCurtain,
  entryRanks,
  setDashEntryAttr,
  type EntryLayoutItem,
} from '@/utils/firstEntryMotion';

/**
 * 대시보드 첫 진입 (움직임 폴리싱 13번).
 *
 * - 앱을 켠 뒤 처음 그려지는 대시보드에서만 html[data-dash-entry] 를 켜 위젯이 (y,x) 순서로 또렷해지고
 *   막대·원이 0에서 차오르게 한다(CSS — motion-view-entry.css '13.' 절). 다른 화면에 갔다 와도 반복하지 않는다.
 * - 'Bflow.' 덮개 아래에서 미리 그려졌으면(html[data-entry-curtain='down']) CSS 가 연출을 멈춰 두고,
 *   덮개가 걷히기 시작하면 그때부터 흐른다. 표시는 덮개가 걷히기 시작한 뒤 ENTRY_WINDOW_MS 에 지운다
 *   (그 뒤 위젯을 더하거나 탭을 바꿔 위젯이 새로 생겨도 다시 차오르지 않게).
 * - 대시보드가 그려졌다는 신호(viewReady)를 덮개에 알린다 — 덮개는 대시보드가 그려진 뒤에 걷힌다.
 *
 * 돌려주는 값: 위젯 id → 등장 순위(0~8). 위젯 칸의 data-entry-rank 로 넘긴다.
 */
export function useFirstDashboardEntry(layout: readonly EntryLayoutItem[]): ReadonlyMap<string, number> {
  const ranks = useMemo(() => entryRanks(layout), [layout]);

  useLayoutEffect(() => {
    if (!dashboardEntryGate.claim()) {
      entryCurtain.setViewReady(true);
      return () => entryCurtain.setViewReady(false);
    }

    setDashEntryAttr(true);
    let timer: number | undefined;
    let unsubscribe: (() => void) | undefined;
    const finish = () => {
      timer = undefined;
      setDashEntryAttr(false);
      dashboardEntryGate.finish();
    };
    const startWindow = () => {
      if (timer !== undefined) return;
      unsubscribe?.();
      unsubscribe = undefined;
      timer = window.setTimeout(finish, ENTRY_WINDOW_MS);
    };
    if (entryCurtain.state === 'down') {
      unsubscribe = entryCurtain.subscribe(() => {
        if (entryCurtain.state !== 'down') startWindow();
      });
    } else {
      startWindow();
    }
    // 덮개가 이 신호를 받고 같은 순간 걷히기 시작할 수 있으니 구독을 건 뒤에 알린다.
    entryCurtain.setViewReady(true);

    return () => {
      entryCurtain.setViewReady(false);
      unsubscribe?.();
      if (timer !== undefined) window.clearTimeout(timer);
      if (dashboardEntryGate.phase !== 'active') return;
      // 연출 도중 사라짐. StrictMode 의 두 번 실행이면 곧바로 다시 맡고, 진짜로 떠난 것이면 다음 틱에 끝낸다.
      setDashEntryAttr(false);
      dashboardEntryGate.release();
      window.setTimeout(() => dashboardEntryGate.settle(), 0);
    };
  }, []);

  return ranks;
}
