/**
 * 위젯 새 창이 화면에 뜰 크기·자리 계산 — main.ts 의 openWidgetPopup 이 쓴다 (창을 만들지 않는 순수 계산).
 *
 * 왜 크기까지 맞추나: 큰 모니터에서 쓰던 크기를 작은 화면(노트북·원격 접속)에서 되살리면 아래·오른쪽이
 * 화면 밖으로 나가 내용과 크기 조절 모서리에 손이 닿지 않는다. 자리만 화면 안으로 옮겨서는 풀리지 않는다.
 * 처음 여는 창은 Electron 이 스스로 화면에 맞춰 주지만(실측: 2960×1692 요청 → 2560×1392),
 * 기억한 크기를 되살리는 setBounds 는 준 값을 그대로 받는다(실측: 2960×1692 그대로).
 */

export interface WidgetPopupSize {
  width: number;
  height: number;
}

export interface WidgetPopupRect extends WidgetPopupSize {
  x: number;
  y: number;
}

/** 새 창의 최소 크기 — BrowserWindow 의 minWidth/minHeight 와 같은 값 */
export const WIDGET_POPUP_MIN_WIDTH = 280;
export const WIDGET_POPUP_MIN_HEIGHT = 200;

/** 새 창 크기를 그 창이 뜰 화면의 작업 영역 안으로 줄인다 (최소 크기보다 작아지지는 않는다) */
export function fitWidgetPopupSize(size: WidgetPopupSize, workArea: WidgetPopupSize): WidgetPopupSize {
  return {
    width: Math.max(WIDGET_POPUP_MIN_WIDTH, Math.min(size.width, workArea.width)),
    height: Math.max(WIDGET_POPUP_MIN_HEIGHT, Math.min(size.height, workArea.height)),
  };
}

/** 기억해 둔 자리·크기가 작업 영역 안에 다 들어오게 맞춘다 — 크기를 먼저 줄이고, 그 크기로 자리를 안으로 민다 */
export function fitWidgetPopupBounds(saved: WidgetPopupRect, workArea: WidgetPopupRect): WidgetPopupRect {
  const { width, height } = fitWidgetPopupSize(saved, workArea);
  return {
    x: Math.max(workArea.x, Math.min(workArea.x + workArea.width - width, saved.x)),
    y: Math.max(workArea.y, Math.min(workArea.y + workArea.height - height, saved.y)),
    width,
    height,
  };
}
