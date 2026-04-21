import type { CSSProperties } from 'react';

export const floatingGlassStyle: CSSProperties = {
  background: 'rgb(var(--color-bg-card) / 0.92)',
  backdropFilter: 'blur(24px) saturate(1.35)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.35)',
  border: '1px solid rgb(var(--color-bg-border) / 0.42)',
  boxShadow:
    '0 20px 44px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.08)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset',
};

export const elevatedGlassStyle: CSSProperties = {
  background: 'rgb(var(--color-bg-card) / 0.84)',
  backdropFilter: 'blur(20px) saturate(1.3)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.3)',
  border: '1px solid rgb(var(--color-bg-border) / 0.34)',
  boxShadow:
    '0 18px 40px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.05)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset, 0 1px 0 rgb(255 255 255 / 0.16) inset',
};

export const tooltipGlassStyle: CSSProperties = {
  background:
    'linear-gradient(135deg, rgb(var(--color-tooltip-bg) / 0.92) 0%, rgb(var(--color-tooltip-bg) / 0.98) 100%)',
  backdropFilter: 'blur(18px) saturate(1.35)',
  WebkitBackdropFilter: 'blur(18px) saturate(1.35)',
  border: '1px solid rgb(var(--color-bg-border) / 0.34)',
  boxShadow:
    '0 12px 32px rgb(var(--color-shadow) / var(--shadow-alpha)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset, 0 1px 0 rgb(255 255 255 / 0.16) inset',
};

export const glassTopHighlight =
  'linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.48) 50%, transparent 90%)';

export const glassShimmer =
  'linear-gradient(105deg, transparent 38%, rgba(255,255,255,0.06) 45%, rgba(255,255,255,0.16) 50%, rgba(255,255,255,0.06) 55%, transparent 62%)';
