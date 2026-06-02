import { useEffect, useRef, useState } from 'react';

type LabelMode = 'text' | 'icon';

function estimateLabelWidth(label: string, compact: boolean) {
  const fontSize = compact ? 10 : 11;
  const horizontalPadding = compact ? 18 : 22;
  const glyphCount = Array.from(label).length;
  return Math.ceil(glyphCount * fontSize + horizontalPadding);
}

export function useStageLabelDisplayMode<K extends string>(
  labels: Record<K, string>,
  compact: boolean,
  enabled: boolean,
) {
  const [modes, setModes] = useState<Record<string, LabelMode>>({});
  const nodesRef = useRef(new Map<K, HTMLElement>());

  useEffect(() => {
    if (!enabled) {
      setModes({});
      return;
    }

    const measure = () => {
      const next: Record<string, LabelMode> = {};
      for (const [key, node] of nodesRef.current.entries()) {
        const label = labels[key];
        if (!label) continue;
        const availableWidth = node.getBoundingClientRect().width;
        next[key] = availableWidth > 0 && availableWidth < estimateLabelWidth(label, compact)
          ? 'icon'
          : 'text';
      }
      setModes(next);
    };

    const observers: ResizeObserver[] = [];
    for (const node of nodesRef.current.values()) {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      observers.push(observer);
    }

    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      observers.forEach((observer) => observer.disconnect());
    };
  }, [compact, enabled, labels]);

  const setNode = (key: K) => (node: HTMLElement | null) => {
    if (node) nodesRef.current.set(key, node);
    else nodesRef.current.delete(key);
  };

  const modeOf = (key: K): LabelMode => modes[key] ?? 'text';

  return { modeOf, setNode };
}
