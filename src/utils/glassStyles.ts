import type { CSSProperties } from 'react';

export const floatingGlassStyle: CSSProperties = {
  background: 'rgb(var(--color-bg-card) / 0.92)',
  backdropFilter: 'blur(24px) saturate(1.35)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.35)',
  border: '1px solid rgb(var(--color-bg-border) / 0.42)',
  boxShadow:
    '0 20px 44px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.08)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset',
};

/**
 * floatingGlassStyle 의 흐림 없는 짝 — 열리며 움직이는 펼침 메뉴·팝오버용 (움직임 폴리싱 바탕 C).
 * 뒤 흐림(backdrop-filter)은 요소가 움직이는 동안 매 프레임 다시 계산된다. 바탕이 92% 불투명이라 흐림은
 * 눈에 거의 안 보이므로, 흐림을 빼고 바탕을 97% 로 올려 같은 느낌을 낸다. 테두리·그림자는 같다.
 */
export const floatingSolidStyle: CSSProperties = {
  background: 'rgb(var(--color-bg-card) / 0.97)',
  border: floatingGlassStyle.border,
  boxShadow: floatingGlassStyle.boxShadow,
};

export const elevatedGlassStyle: CSSProperties = {
  background: 'rgb(var(--color-bg-card) / 0.84)',
  backdropFilter: 'blur(20px) saturate(1.3)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
  border: '1px solid rgb(var(--color-bg-border) / 0.34)',
  boxShadow:
    '0 18px 40px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.05)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset, 0 1px 0 rgb(255 255 255 / 0.16) inset',
};

/** elevatedGlassStyle 의 흐림 없는 짝 — 떠오르며 움직이는 카드(인사 말풍선 등)용. 84% → 97%. */
export const elevatedSolidStyle: CSSProperties = {
  background: 'rgb(var(--color-bg-card) / 0.97)',
  border: elevatedGlassStyle.border,
  boxShadow: elevatedGlassStyle.boxShadow,
};

/**
 * 설명 카드(캘린더 일정·타임라인 막대·차트 말풍선). 이 카드들은 마우스를 따라 뜨고 옮겨 다니므로
 * 뒤를 흐리게 하는 효과(backdrop-filter)를 쓰지 않는다 — 움직일 때마다 흐림을 새로 계산해 무겁다.
 * 대신 배경을 거의 불투명하게 해서 겉모습을 유지한다(움직임 폴리싱 2번).
 */
export const tooltipGlassStyle: CSSProperties = {
  background:
    'linear-gradient(135deg, rgb(var(--color-tooltip-bg) / 0.97) 0%, rgb(var(--color-tooltip-bg) / 0.99) 100%)',
  border: '1px solid rgb(var(--color-bg-border) / 0.34)',
  boxShadow:
    '0 12px 32px rgb(var(--color-shadow) / var(--shadow-alpha)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset, 0 1px 0 rgb(255 255 255 / 0.16) inset',
};

export const glassTopHighlight =
  'linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.48) 50%, transparent 90%)';

export const glassShimmer =
  'linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.06) 45%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0.06) 55%, transparent 62%)';
