import { useCallback, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
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

function readStoredWidths<K extends string>(
  storageKey: string,
  columns: Array<SheetColumnDefinition<K>>,
): Record<K, number> {
  const defaults = Object.fromEntries(columns.map((column) => [column.key, column.defaultWidth])) as Record<K, number>;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next = { ...defaults };
    for (const column of columns) {
      const value = parsed[column.key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        next[column.key] = clampWidth(value, column.minWidth, column.maxWidth);
      }
    }
    return next;
  } catch {
    return defaults;
  }
}

export function useResizableSheetColumns<K extends string>(
  storageKey: string,
  columns: Array<SheetColumnDefinition<K>>,
) {
  const [widths, setWidths] = useState<Record<K, number>>(() => readStoredWidths(storageKey, columns));
  const columnByKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);

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

  const startResize = useCallback((key: K, event: ReactPointerEvent) => {
    const column = columnByKey.get(key);
    if (!column) return;

    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(key);
    let latest = startWidth;

    document.documentElement.classList.add('is-resizing', 'is-sheet-column-resizing');

    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampWidth(startWidth + moveEvent.clientX - startX, column.minWidth, column.maxWidth);
      latest = nextWidth;
      setWidths((prev) => ({ ...prev, [key]: nextWidth }));
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.documentElement.classList.remove('is-resizing', 'is-sheet-column-resizing');
      setWidths((prev) => {
        const next = { ...prev, [key]: latest };
        persist(next);
        return next;
      });
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp, { once: true });
  }, [columnByKey, persist, widthOf]);

  return { widthOf, totalWidth, startResize };
}

export function ResizableHeaderCell<K extends string>({
  columnKey,
  width,
  className,
  style,
  align = 'left',
  onResizeStart,
  children,
}: {
  columnKey: K;
  width: number;
  className?: string;
  style?: CSSProperties;
  align?: 'left' | 'center';
  onResizeStart: (key: K, event: ReactPointerEvent) => void;
  children?: ReactNode;
}) {
  return (
    <th
      className={cn(
        'sheet-resizable-th px-2 py-2 text-xs font-medium text-text-secondary',
        align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      style={{ ...style, width, minWidth: width, maxWidth: width }}
    >
      <span className="block truncate pr-2">{children}</span>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label="컬럼 너비 조절"
        className="sheet-column-resizer"
        onPointerDown={(event) => onResizeStart(columnKey, event)}
        onClick={(event) => event.stopPropagation()}
      />
    </th>
  );
}
