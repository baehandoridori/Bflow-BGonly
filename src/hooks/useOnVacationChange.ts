import { useEffect, useRef } from 'react';

/**
 * 휴가 변경 신호 디바운스. DB 트리거는 문장마다 한 번씩 보내므로(연속 등록·이관·등록 직후 캘린더 ID 기록)
 * 몰아서 한 번만 다시 읽는다. 팀 할 일 섹션과 같은 값이다.
 */
export const VACATION_SIGNAL_DEBOUNCE_MS = 300;

/**
 * 휴가 데이터가 어디선가 바뀌면 onChange 를 부른다.
 *
 * "어디선가" — 슬랙 워크플로·/휴가, 다른 사람의 B flow, 관리자의 대휴 지급 등 **이 창 밖**의 변경이다.
 * 신호에는 내용이 없다(공개 채널이라 이름·날짜를 싣지 않는다). 받은 쪽이 휴가 API 로 다시 읽는다.
 *
 * onChange 는 매 렌더 새 함수여도 된다 — ref 로 최신 것을 부르므로 구독을 다시 걸지 않는다.
 */
export function useOnVacationChange(onChange: () => void): void {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });

  useEffect(() => {
    const subscribe = window.electronAPI?.onVacationChanged;
    if (!subscribe) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        latest.current();
      }, VACATION_SIGNAL_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);
}
