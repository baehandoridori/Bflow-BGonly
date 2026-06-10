import { useCallback, useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface SheetColumnDefinition<K extends string> {
  key: K;
  defaultWidth: number;
  minWidth: number;
  maxWidth?: number;
}

function clampWidth(width: number, min: number, max?: number) {
  return Math.max(min, Math.min(max ?? 720, width));
}

function sumWidths<K extends string>(columns: Array<SheetColumnDefinition<K>>, widths: Record<K, number>) {
  return columns.reduce((sum, column) => sum + widths[column.key], 0);
}

function buildVisualWidthBaseline<K extends string>(
  columns: Array<SheetColumnDefinition<K>>,
  visualStartWidths?: Partial<Record<K, number>>,
) {
  if (!visualStartWidths) return null;

  const baseline = {} as Partial<Record<K, number>>;
  let hasBaseline = false;
  for (const column of columns) {
    const value = visualStartWidths[column.key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      baseline[column.key] = Math.max(column.minWidth, value);
      hasBaseline = true;
    }
  }

  return hasBaseline ? baseline : null;
}

function buildResizeStartWidths<K extends string>(
  columns: Array<SheetColumnDefinition<K>>,
  widthOf: (key: K) => number,
  visualStartWidths?: Partial<Record<K, number>>,
) {
  const baseline = buildVisualWidthBaseline(columns, visualStartWidths);
  return Object.fromEntries(
    columns.map((column) => {
      const width = baseline?.[column.key] ?? widthOf(column.key);
      return [column.key, clampWidth(width, column.minWidth, column.maxWidth)];
    }),
  ) as Record<K, number>;
}

function getColumnMax<K extends string>(column: SheetColumnDefinition<K>) {
  return column.maxWidth ?? 720;
}

function getResizeCompensationKeys<K extends string>(
  columns: Array<SheetColumnDefinition<K>>,
  key: K,
) {
  const index = columns.findIndex((column) => column.key === key);
  if (index < 0) return [];

  const rightKeys = columns.slice(index + 1).map((column) => column.key);
  const leftKeys = columns.slice(0, index).reverse().map((column) => column.key);
  return [...rightKeys, ...leftKeys];
}

function buildContainedResizeWidths<K extends string>(
  columns: Array<SheetColumnDefinition<K>>,
  startWidths: Record<K, number>,
  key: K,
  rawDelta: number,
) {
  const columnByKey = new Map(columns.map((column) => [column.key, column]));
  const column = columnByKey.get(key);
  if (!column) return startWidths;

  const next = { ...startWidths };
  const startWidth = startWidths[key];
  const minDelta = column.minWidth - startWidth;
  const maxDelta = getColumnMax(column) - startWidth;
  let delta = Math.max(minDelta, Math.min(maxDelta, rawDelta));

  const compensationKeys = getResizeCompensationKeys(columns, key);
  if (delta > 0) {
    let remaining = delta;
    let consumed = 0;
    for (const compensationKey of compensationKeys) {
      const compensationColumn = columnByKey.get(compensationKey);
      if (!compensationColumn) continue;
      const capacity = Math.max(0, next[compensationKey] - compensationColumn.minWidth);
      const amount = Math.min(remaining, capacity);
      next[compensationKey] -= amount;
      consumed += amount;
      remaining -= amount;
      if (remaining <= 0.01) break;
    }
    delta = consumed;
  } else if (delta < 0) {
    let remaining = Math.abs(delta);
    let consumed = 0;
    for (const compensationKey of compensationKeys) {
      const compensationColumn = columnByKey.get(compensationKey);
      if (!compensationColumn) continue;
      const capacity = Math.max(0, getColumnMax(compensationColumn) - next[compensationKey]);
      const amount = Math.min(remaining, capacity);
      next[compensationKey] += amount;
      consumed += amount;
      remaining -= amount;
      if (remaining <= 0.01) break;
    }
    delta = -consumed;
  }

  next[key] = clampWidth(startWidth + delta, column.minWidth, column.maxWidth);
  return next;
}

function shrinkColumns<K extends string>(
  widths: Record<K, number>,
  columnsByKey: Map<K, SheetColumnDefinition<K>>,
  keys: K[],
  overflow: number,
) {
  let remaining = overflow;
  let guard = 0;

  while (remaining > 0.5 && guard < 12) {
    guard += 1;
    const shrinkable = keys.filter((key) => {
      const minWidth = columnsByKey.get(key)?.minWidth ?? 0;
      return widths[key] > minWidth + 0.5;
    });

    if (shrinkable.length === 0) break;

    const share = remaining / shrinkable.length;
    let consumed = 0;
    for (const key of shrinkable) {
      const minWidth = columnsByKey.get(key)?.minWidth ?? 0;
      const delta = Math.min(share, widths[key] - minWidth);
      widths[key] -= delta;
      consumed += delta;
    }

    if (consumed <= 0.01) break;
    remaining -= consumed;
  }

  return remaining;
}

export function fitSheetColumnWidths<K extends string>(
  columns: Array<SheetColumnDefinition<K>>,
  widths: Record<K, number>,
  viewportWidth: number,
  fillColumnKeys: K[],
  enabled = true,
) {
  const next = { ...widths };
  if (!enabled) {
    return {
      widths: next,
      totalWidth: sumWidths(columns, next),
    };
  }

  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const baseTotal = sumWidths(columns, next);
  const minTotal = columns.reduce((sum, column) => sum + column.minWidth, 0);
  const targetWidth = viewportWidth > 0 ? Math.max(viewportWidth, minTotal) : baseTotal;
  const fillKeys = fillColumnKeys.filter((key) => columnsByKey.has(key));

  if (baseTotal < targetWidth && fillKeys.length > 0) {
    const share = (targetWidth - baseTotal) / fillKeys.length;
    for (const key of fillKeys) {
      next[key] += share;
    }
  } else if (baseTotal > targetWidth) {
    const overflow = baseTotal - targetWidth;
    const remaining = shrinkColumns(next, columnsByKey, fillKeys, overflow);
    if (remaining > 0.5) {
      const fallbackKeys = columns
        .map((column) => column.key)
        .filter((key) => !fillKeys.includes(key));
      shrinkColumns(next, columnsByKey, fallbackKeys, remaining);
    }
  }

  return {
    widths: next,
    totalWidth: sumWidths(columns, next),
  };
}

export function useFittedSheetColumnWidths<K extends string>(
  columns: Array<SheetColumnDefinition<K>>,
  widthOf: (key: K) => number,
  viewportWidth: number,
  fillColumnKeys: K[],
  enabled = true,
) {
  return useMemo(() => {
    const baseWidths = Object.fromEntries(
      columns.map((column) => [column.key, widthOf(column.key)]),
    ) as Record<K, number>;

    return fitSheetColumnWidths(columns, baseWidths, viewportWidth, fillColumnKeys, enabled);
  }, [columns, enabled, fillColumnKeys, viewportWidth, widthOf]);
}

function readStoredWidths<K extends string>(
  storageKey: string,
  columns: Array<SheetColumnDefinition<K>>,
): { widths: Record<K, number>; hasStoredWidths: boolean } {
  const defaults = Object.fromEntries(columns.map((column) => [column.key, column.defaultWidth])) as Record<K, number>;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { widths: defaults, hasStoredWidths: false };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next = { ...defaults };
    let hasStoredWidths = false;
    for (const column of columns) {
      const value = parsed[column.key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        next[column.key] = clampWidth(value, column.minWidth, column.maxWidth);
        hasStoredWidths = true;
      }
    }
    return { widths: next, hasStoredWidths };
  } catch {
    return { widths: defaults, hasStoredWidths: false };
  }
}

export function useResizableSheetColumns<K extends string>(
  storageKey: string,
  columns: Array<SheetColumnDefinition<K>>,
) {
  const [initialStoredWidths] = useState(() => readStoredWidths(storageKey, columns));
  const [widths, setWidths] = useState<Record<K, number>>(initialStoredWidths.widths);
  const [hasCustomWidths, setHasCustomWidths] = useState(initialStoredWidths.hasStoredWidths);
  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);

  useEffect(() => {
    const next = readStoredWidths(storageKey, columns);
    setWidths(next.widths);
    setHasCustomWidths(next.hasStoredWidths);
  }, [columns, storageKey]);

  const widthOf = useCallback((key: K) => {
    const column = columnByKey.get(key);
    return widths[key] ?? column?.defaultWidth ?? 80;
  }, [columnByKey, widths]);

  const totalWidth = useMemo(
    () => columns.reduce((sum, column) => sum + (widths[column.key] ?? column.defaultWidth), 0),
    [columns, widths],
  );

  const persist = useCallback((next: Record<K, number>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // PC 로컬 저장 실패는 표 표시 자체를 막지 않는다.
    }
  }, [storageKey]);

  const startResize = useCallback((
    key: K,
    event: ReactPointerEvent,
    visualStartWidth?: number,
    visualStartWidths?: Partial<Record<K, number>>,
  ) => {
    const column = columnByKey.get(key);
    if (!column) return;

    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidths = buildResizeStartWidths(columns, widthOf, visualStartWidths);
    const columnStartWidth = visualStartWidth ?? startWidths[key];
    startWidths[key] = clampWidth(columnStartWidth, column.minWidth, column.maxWidth);
    let latestWidths = startWidths;
    let moved = false;

    document.documentElement.classList.add('is-resizing', 'is-sheet-column-resizing');

    const onMove = (moveEvent: PointerEvent) => {
      latestWidths = buildContainedResizeWidths(columns, startWidths, key, moveEvent.clientX - startX);
      moved = true;
      setHasCustomWidths(true);
      setWidths(latestWidths);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.documentElement.classList.remove('is-resizing', 'is-sheet-column-resizing');
      if (!moved) return;
      setWidths(latestWidths);
      persist(latestWidths);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
  }, [columnByKey, columns, persist, widthOf]);

  const startBoundaryResize = useCallback((
    leftKey: K,
    rightKey: K,
    event: ReactPointerEvent,
    leftVisualStartWidth?: number,
    rightVisualStartWidth?: number,
    visualStartWidths?: Partial<Record<K, number>>,
  ) => {
    const leftColumn = columnByKey.get(leftKey);
    const rightColumn = columnByKey.get(rightKey);
    if (!leftColumn || !rightColumn) return;

    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidths = buildResizeStartWidths(columns, widthOf, visualStartWidths);
    const leftStartWidth = clampWidth(leftVisualStartWidth ?? startWidths[leftKey], leftColumn.minWidth, leftColumn.maxWidth);
    const rightStartWidth = clampWidth(rightVisualStartWidth ?? startWidths[rightKey], rightColumn.minWidth, rightColumn.maxWidth);
    startWidths[leftKey] = leftStartWidth;
    startWidths[rightKey] = rightStartWidth;
    const pairWidth = leftStartWidth + rightStartWidth;
    const leftMax = leftColumn.maxWidth ?? 720;
    const rightMax = rightColumn.maxWidth ?? 720;
    const minLeft = Math.max(leftColumn.minWidth, pairWidth - rightMax);
    const maxLeft = Math.min(leftMax, pairWidth - rightColumn.minWidth);
    const min = Math.min(minLeft, maxLeft);
    const max = Math.max(minLeft, maxLeft);
    let latestLeft = leftStartWidth;
    let latestRight = rightStartWidth;
    let latestWidths = startWidths;
    let moved = false;

    document.documentElement.classList.add('is-resizing', 'is-sheet-column-resizing');

    const onMove = (moveEvent: PointerEvent) => {
      const nextLeft = Math.max(min, Math.min(max, leftStartWidth + moveEvent.clientX - startX));
      const nextRight = pairWidth - nextLeft;
      latestLeft = nextLeft;
      latestRight = nextRight;
      latestWidths = { ...startWidths, [leftKey]: nextLeft, [rightKey]: nextRight };
      moved = true;
      setHasCustomWidths(true);
      setWidths(latestWidths);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.documentElement.classList.remove('is-resizing', 'is-sheet-column-resizing');
      if (!moved) return;
      latestWidths = { ...latestWidths, [leftKey]: latestLeft, [rightKey]: latestRight };
      setWidths(latestWidths);
      persist(latestWidths);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
  }, [columnByKey, columns, persist, widthOf]);

  return { widthOf, totalWidth, hasCustomWidths, startResize, startBoundaryResize };
}

export function ResizableHeaderCell<K extends string>({
  columnKey,
  width,
  leftBoundaryColumnKey,
  leftBoundaryWidth,
  rightBoundaryColumnKey,
  rightBoundaryWidth,
  shortLabel,
  className,
  style,
  align = 'left',
  onResizeStart,
  onBoundaryResizeStart,
  children,
}: {
  columnKey: K;
  width: number;
  leftBoundaryColumnKey?: K;
  leftBoundaryWidth?: number;
  rightBoundaryColumnKey?: K;
  rightBoundaryWidth?: number;
  shortLabel?: string;
  className?: string;
  style?: CSSProperties;
  align?: 'left' | 'center';
  onResizeStart: (
    key: K,
    event: ReactPointerEvent,
    visualStartWidth?: number,
    visualStartWidths?: Partial<Record<K, number>>,
  ) => void;
  onBoundaryResizeStart?: (
    leftKey: K,
    rightKey: K,
    event: ReactPointerEvent,
    leftVisualStartWidth?: number,
    rightVisualStartWidth?: number,
    visualStartWidths?: Partial<Record<K, number>>,
  ) => void;
  children?: ReactNode;
}) {
  const fullLabel = typeof children === 'string' ? children : undefined;
  const handleRightResize = (event: ReactPointerEvent) => {
    if (rightBoundaryColumnKey && onBoundaryResizeStart) {
      onBoundaryResizeStart(columnKey, rightBoundaryColumnKey, event, width, rightBoundaryWidth);
      return;
    }
    onResizeStart(columnKey, event, width);
  };

  return (
    <th
      className={cn(
        'sheet-resizable-th px-2 py-2 text-xs font-medium text-text-secondary',
        align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      style={{ ...style, width, minWidth: width, maxWidth: width }}
      title={fullLabel}
    >
      <span className="sheet-header-label-wrap truncate">
        <span data-sheet-header-full-label>{children}</span>
        {shortLabel && <span data-sheet-header-short-label>{shortLabel}</span>}
      </span>
      {leftBoundaryColumnKey && onBoundaryResizeStart && (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="컬럼 경계 너비 조절"
          className="sheet-column-resizer sheet-column-resizer-left"
          onPointerDown={(event) =>
            onBoundaryResizeStart(leftBoundaryColumnKey, columnKey, event, leftBoundaryWidth, width)
          }
          onClick={(event) => event.stopPropagation()}
        />
      )}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={rightBoundaryColumnKey ? '컬럼 경계 너비 조절' : '컬럼 너비 조절'}
        className="sheet-column-resizer"
        onPointerDown={handleRightResize}
        onClick={(event) => event.stopPropagation()}
      />
    </th>
  );
}
