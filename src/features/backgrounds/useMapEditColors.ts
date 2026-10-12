import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import { mapEditColors } from './mapEditColor.ts';

/**
 * Paints the edit band of this editor in a colour that stands apart from the theme. The two accents and the page colour
 * are read as they are on screen, and again whenever the theme or the colour mode changes while the editor is open.
 */
export function useMapEditColors(rootRef: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const apply = () => {
      const theme = getComputedStyle(document.documentElement);
      const colors = mapEditColors(theme.getPropertyValue('--color-accent'), theme.getPropertyValue('--color-accent-sub'), theme.getPropertyValue('--color-bg-primary'));
      if (root.style.getPropertyValue('--bmap-edit') !== colors.strip) root.style.setProperty('--bmap-edit', colors.strip);
      if (root.style.getPropertyValue('--bmap-edit-ink') !== colors.ink) root.style.setProperty('--bmap-edit-ink', colors.ink);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'class', 'style'] });
    return () => observer.disconnect();
  }, [rootRef]);
}
