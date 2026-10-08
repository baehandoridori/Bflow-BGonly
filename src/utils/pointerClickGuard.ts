/* ═══════════════════════════════════════════════════════════════
   누르는 순간(pointerdown) 바로 반응한 버튼의 뒤따르는 click 걸러내기

   단계 버튼·액팅 칩은 손맛 때문에 pointerdown 에서 바로 켜고 끈다. 그러면 같은 누름의 click 이 한 번 더
   오므로 그 click 은 무시해야 한다. 예전에는 '처리함' 표시를 600ms 타이머로 지웠는데, 앞 누름이 건 타이머가
   다음 누름이 세운 표시를 지워 버려 다음 누름의 click 이 한 번 더 토글했다(0.5~0.6초 안에 되돌리면
   꺼졌다가 곧바로 다시 켜짐 — 움직임 폴리싱 검증 지적 acc-scene-flow-6). 0.6초 넘게 누르고 있어도 두 번 토글됐다.

   이제 타이머 없이 누름과 click 을 짝지운다.
   - 마우스·펜·터치 click(detail ≥ 1)은 언제나 같은 버튼의 pointerdown 뒤에 온다 → 그 pointerdown 이 처리했으면 건너뛴다.
   - 키보드(Enter·Space)가 만든 click 은 detail 0 → 그대로 토글한다.
   건너뛰면 호출한 쪽이 표시를 지운다(한 누름에 click 하나).

   node --test 가 그대로 import 하도록 런타임 의존이 없다.
   ═══════════════════════════════════════════════════════════════ */

/** 이 click 을 건너뛸지. pointerHandled 는 pointerdown 이 이미 토글했고 아직 click 이 오지 않았는지. */
export function shouldSkipClickAfterPointer(pointerHandled: boolean, clickDetail: number): boolean {
  return pointerHandled && clickDetail > 0;
}
