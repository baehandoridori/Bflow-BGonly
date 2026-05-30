import { useState, useRef, useEffect, useMemo, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { MessageCircle, Trash2 } from 'lucide-react';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { Scene, Stage, Department, ScenePhaseState } from '@/types';
import type { SceneGroupMode } from '@/stores/useAppStore';
import { useAppStore } from '@/stores/useAppStore';
import { isFullyDone } from '@/utils/calcStats';
import { cn } from '@/utils/cn';
import { HighlightText } from '@/components/common/HighlightText';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
import { AssigneeSelect } from '@/components/common/AssigneeSelect';
import { AssigneeMultiSelect, AssigneeChipList } from '@/components/common/AssigneeMultiSelect';
import {
  ResizableHeaderCell,
  useResizableSheetColumns,
  type SheetColumnDefinition,
} from './SheetColumnResize';
import { ScenePhaseToggle } from './ScenePhaseToggle';

// ─── Props ───────────────────────────────────────────────────

interface SceneSheetViewProps {
  scenes: Scene[];
  allScenes: Scene[];
  department: Department;
  commentCounts: Record<string, number>;
  commentUnreadByKey?: Record<string, boolean>;
  sheetName: string;
  searchQuery?: string;
  selectedSceneIds?: Set<string>;
  sceneGroupMode: SceneGroupMode;
  /** 한솔 결정 (8번): 토스트 클릭 후 진입 시 강조할 sceneId */
  highlightSceneId?: string | null;
  onToggle: (sceneId: string, stage: Stage) => void;
  onActPhaseStateClick?: (sheetName: string, sceneId: string, newState: ScenePhaseState) => void;
  onActFeedbackRequest?: (sheetName: string, sceneId: string) => void;
  onActRoundBump?: (sheetName: string, sceneId: string, kind: 'work' | 'feedback', delta: 1 | -1) => void;
  onDelete: (sceneIndex: number) => void;
  onOpenDetail: (sceneIndex: number) => void;
  onFieldUpdate: (sceneIndex: number, field: string, value: string) => void;
  onCtrlClick?: (sceneId: string) => void;
}

// ─── 셀 선택 타입 ───────────────────────────────────────────

interface CellId { row: number; col: number }
const EDITABLE_FIELDS = ['memo', 'assignee'] as const;

function cellKey(row: number, col: number) { return `${row}:${col}`; }

type SingleSheetColumnKey =
  | 'scene'
  | 'memo'
  | 'storyboard'
  | 'guide'
  | 'assignee'
  | 'lo'
  | 'done'
  | 'review'
  | 'png'
  | 'actions';

const SINGLE_SHEET_COLUMNS: Array<SheetColumnDefinition<SingleSheetColumnKey>> = [
  { key: 'scene', defaultWidth: 96, minWidth: 76, maxWidth: 180 },
  { key: 'memo', defaultWidth: 300, minWidth: 80, maxWidth: 620 },
  { key: 'storyboard', defaultWidth: 82, minWidth: 52, maxWidth: 150 },
  { key: 'guide', defaultWidth: 82, minWidth: 52, maxWidth: 150 },
  { key: 'assignee', defaultWidth: 120, minWidth: 76, maxWidth: 240 },
  { key: 'lo', defaultWidth: 54, minWidth: 36, maxWidth: 108 },
  { key: 'done', defaultWidth: 58, minWidth: 36, maxWidth: 112 },
  { key: 'review', defaultWidth: 58, minWidth: 36, maxWidth: 112 },
  { key: 'png', defaultWidth: 58, minWidth: 36, maxWidth: 112 },
  { key: 'actions', defaultWidth: 40, minWidth: 32, maxWidth: 72 },
];

const STAGE_SHORT_LABELS: Record<Stage, string> = {
  lo: 'LO',
  done: '완',
  review: '검',
  png: 'PNG',
};

// ─── 인라인 편집 셀 (controlled) ─────────────────────────────

function SheetEditableCell({
  value,
  field,
  sceneIndex,
  onSave,
  type = 'text',
  searchQuery,
  isSelected,
  isEditing,
  initialChar,
  onMouseDown,
  onMouseEnter,
  onStartEditing,
  onStopEditing,
}: {
  value: string;
  field: string;
  sceneIndex: number;
  onSave: (sceneIndex: number, field: string, value: string) => void;
  type?: 'text' | 'assignee';
  searchQuery?: string;
  isSelected: boolean;
  isEditing: boolean;
  initialChar?: string | null;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onStartEditing: () => void;
  onStopEditing: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const valueRef = useRef(value);
  valueRef.current = value;
  const cancelledRef = useRef(false);

  useEffect(() => { setDraft(value); }, [value]);

  // BUG-1 fix: isEditing이 해제될 때(언마운트 포함) 자동 commit
  // Escape 취소 시에는 cancelledRef로 저장 방지
  useEffect(() => {
    if (!isEditing) return;
    cancelledRef.current = false;
    return () => {
      if (!cancelledRef.current && draftRef.current !== valueRef.current) {
        onSave(sceneIndex, field, draftRef.current);
      }
      cancelledRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  // 편집 모드 진입 시 포커스 (BUG-2 fix: initialChar 있으면 select 건너뜀)
  useEffect(() => {
    if (isEditing && type === 'text' && inputRef.current) {
      inputRef.current.focus();
      if (initialChar == null) inputRef.current.select();
    }
  }, [isEditing, type, initialChar]);

  // initialChar로 편집 시작 시 draft 초기화
  useEffect(() => {
    if (isEditing && initialChar != null) {
      setDraft(initialChar);
    }
  }, [isEditing, initialChar]);

  // 담당자 편집 모드 진입 시 AssigneeSelect 내부 input 자동 포커스
  useEffect(() => {
    if (isEditing && type === 'assignee' && cellRef.current) {
      const input = cellRef.current.querySelector('input');
      if (input) setTimeout(() => input.focus(), 0);
    }
  }, [isEditing, type]);

  const commit = useCallback(() => {
    if (cancelledRef.current) { cancelledRef.current = false; return; }
    if (draft !== value) onSave(sceneIndex, field, draft);
    onStopEditing();
  }, [draft, value, onSave, sceneIndex, field, onStopEditing]);

  if (isEditing) {
    if (type === 'assignee') {
      return (
        <td
          ref={cellRef}
          className="px-2 py-1"
          style={{ overflow: 'visible', position: 'relative' }}
          onClick={(e) => e.stopPropagation()}
        >
          <AssigneeMultiSelect
            value={draft}
            onChange={(v) => onSave(sceneIndex, field, v)}
            onClose={onStopEditing}
            className="w-full"
            autoFocus
          />
        </td>
      );
    }
    return (
      <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { cancelledRef.current = true; setDraft(value); onStopEditing(); }
            // 편집 중 키 이벤트가 테이블까지 전파되지 않도록
            e.stopPropagation();
          }}
          className="w-full bg-bg-primary border border-accent/50 rounded px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent transition-colors"
        />
      </td>
    );
  }

  const isMemo = field === 'memo';
  return (
    <td
      className={cn(
        'px-2 py-1.5 text-xs text-text-secondary cursor-cell truncate transition-colors',
        isMemo && 'min-w-0',
        isSelected
          ? 'ring-2 ring-accent ring-inset bg-accent/5'
          : 'hover:bg-accent/5',
      )}
      onMouseDown={(e) => {
        // Ctrl+클릭은 행 선택이므로 셀 선택 처리하지 않음
        if (e.ctrlKey || e.metaKey) return;
        e.stopPropagation();
        onMouseDown(e);
      }}
      onMouseEnter={onMouseEnter}
      onDoubleClick={(e) => {
        e.stopPropagation(); // 행의 상세 모달 방지
        onStartEditing();
      }}
    >
      {type === 'assignee'
        ? (value ? <AssigneeChipList value={value} size="sm" maxVisible={1} /> : <span className="text-text-secondary/50">-</span>)
        : <HighlightText text={value || '-'} query={searchQuery} />
      }
    </td>
  );
}

// ─── 이미지 썸네일 + 호버 미리보기 ──────────────────────────

function SheetThumbnailCell({ url, label }: { url: string; label: string }) {
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const cellRef = useRef<HTMLTableCellElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (!url || !cellRef.current) return;
    const rect = cellRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    let x = rect.right + 8;
    let y = rect.top + rect.height / 2;
    if (x + 288 > viewportW) x = rect.left - 288 - 8;
    if (y + 120 > viewportH) y = viewportH - 130;
    if (y - 120 < 0) y = 130;
    setHoverPos({ x, y });
  }, [url]);

  return (
    <td
      ref={cellRef}
      className="px-1 py-1 text-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHoverPos(null)}
    >
      {url ? (
        <img
          src={url}
          alt={label}
          className="w-10 h-10 object-contain rounded border border-bg-border/50 mx-auto"
          draggable={false}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <span className="text-[10px] text-text-secondary/30">-</span>
      )}

      {hoverPos && url && createPortal(
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          className="fixed z-[999] pointer-events-none"
          style={{
            left: hoverPos.x,
            top: hoverPos.y,
            transform: 'translateY(-50%)',
          }}
        >
          <img
            src={url}
            alt={label}
            className="max-w-[280px] max-h-[240px] object-contain rounded-lg shadow-2xl border border-bg-border bg-bg-card"
          />
        </motion.div>,
        document.body,
      )}
    </td>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────

export function SceneSheetView({
  scenes,
  allScenes,
  department,
  commentCounts,
  commentUnreadByKey,
  sheetName,
  searchQuery,
  selectedSceneIds,
  sceneGroupMode,
  highlightSceneId,
  onToggle,
  onActPhaseStateClick,
  onActFeedbackRequest,
  onActRoundBump,
  onDelete,
  onOpenDetail,
  onFieldUpdate,
  onCtrlClick,
}: SceneSheetViewProps) {
  const deptConfig = DEPARTMENT_CONFIGS[department];
  const completionTintEnabled = useAppStore((s) => s.completionTintEnabled);
  const stagePointerHandledRef = useRef(false);
  const useActingPhaseControls = department === 'acting' && !!onActPhaseStateClick && !!onActFeedbackRequest && !!onActRoundBump;
  const {
    widthOf,
    totalWidth,
    startResize,
  } = useResizableSheetColumns(`bflow_scene_sheet_columns_${department}_v1`, SINGLE_SHEET_COLUMNS);

  // ── 레이아웃 그룹핑 ──
  const layoutGroups = useMemo(() => {
    if (sceneGroupMode !== 'layout') return null;
    const groups = new Map<string, Scene[]>();
    for (const scene of scenes) {
      const lid = (scene.layoutId || '').trim();
      const key = lid || '미분류';
      const arr = groups.get(key) || [];
      arr.push(scene);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '미분류') return 1;
      if (b[0] === '미분류') return -1;
      return a[0].localeCompare(b[0], undefined, { numeric: true });
    });
  }, [scenes, sceneGroupMode]);

  const layoutMeta = useMemo(() => {
    if (!layoutGroups) return new Map<Scene, { isFirst: boolean; isLast: boolean; groupSize: number; layoutKey: string }>();
    const meta = new Map<Scene, { isFirst: boolean; isLast: boolean; groupSize: number; layoutKey: string }>();
    for (const [layoutKey, groupScenes] of layoutGroups) {
      groupScenes.forEach((scene, i) => {
        meta.set(scene, {
          isFirst: i === 0,
          isLast: i === groupScenes.length - 1,
          groupSize: groupScenes.length,
          layoutKey,
        });
      });
    }
    return meta;
  }, [layoutGroups]);

  const orderedScenes = useMemo(() => {
    if (!layoutGroups) return scenes;
    return layoutGroups.flatMap(([, groupScenes]) => groupScenes);
  }, [layoutGroups, scenes]);

  const displayScenes = layoutGroups ? orderedScenes : scenes;

  // ── 셀 선택 상태 ──
  const [anchor, setAnchor] = useState<CellId | null>(null);
  const [rangeEnd, setRangeEnd] = useState<CellId | null>(null);
  const [editingCell, setEditingCell] = useState<CellId | null>(null);
  const [initialEditChar, setInitialEditChar] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);

  const maxRow = Math.max(0, displayScenes.length - 1);
  const maxCol = EDITABLE_FIELDS.length - 1;

  // 선택 범위 계산
  const selectedCells = useMemo(() => {
    if (!anchor) return new Set<string>();
    const end = rangeEnd ?? anchor;
    const minRow = Math.min(anchor.row, end.row);
    const maxR = Math.max(anchor.row, end.row);
    const minCol = Math.min(anchor.col, end.col);
    const maxC = Math.max(anchor.col, end.col);
    const set = new Set<string>();
    for (let r = minRow; r <= maxR; r++)
      for (let c = minCol; c <= maxC; c++)
        set.add(cellKey(r, c));
    return set;
  }, [anchor, rangeEnd]);

  // scenes 변경 시 선택 초기화 (편집 중이면 보호)
  useEffect(() => {
    if (editingCell) return;
    setAnchor(null);
    setRangeEnd(null);
    setInitialEditChar(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes]);

  // 테이블 외부 클릭 시 선택 해제
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
        if (!editingCell) {
          setAnchor(null);
          setRangeEnd(null);
        }
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [editingCell]);

  // 드래그 종료 (global mouseup)
  useEffect(() => {
    if (!isDragging) return;
    const handleMouseUp = () => setIsDragging(false);
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [isDragging]);

  // ── 셀 인터랙션 핸들러 ──

  const handleCellMouseDown = useCallback((row: number, col: number, e: React.MouseEvent) => {
    // 편집 중이면 먼저 편집 종료
    setEditingCell(null);
    setInitialEditChar(null);

    if (e.shiftKey && anchor) {
      // Shift+클릭: 범위 확장
      setRangeEnd({ row, col });
    } else {
      // 일반 클릭: 단일 선택 + 드래그 시작
      setAnchor({ row, col });
      setRangeEnd(null);
      setIsDragging(true);
    }
    // 테이블에 포커스
    tableRef.current?.focus();
  }, [anchor]);

  const handleCellMouseEnter = useCallback((row: number, col: number) => {
    if (isDragging) {
      setRangeEnd({ row, col });
    }
  }, [isDragging]);

  const handleStartEditing = useCallback((row: number, col: number) => {
    setEditingCell({ row, col });
    setInitialEditChar(null);
    setAnchor({ row, col });
    setRangeEnd(null);
  }, []);

  const handleStopEditing = useCallback(() => {
    setEditingCell(null);
    setInitialEditChar(null);
    tableRef.current?.focus();
  }, []);

  // ── 키보드 핸들러 ──

  const handleTableKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 편집 중이면 테이블 키보드 무시 (input에서 stopPropagation)
    if (editingCell) return;
    if (!anchor) return;

    const clampRow = (r: number) => Math.max(0, Math.min(r, maxRow));
    const clampCol = (c: number) => Math.max(0, Math.min(c, maxCol));

    // 방향키
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const current = rangeEnd ?? anchor;
      const dr = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      const dc = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;

      if (e.shiftKey) {
        // Shift+방향키: 범위 확장
        const newEnd = { row: clampRow(current.row + dr), col: clampCol(current.col + dc) };
        setRangeEnd(newEnd);
      } else {
        // 단일 이동
        const newAnchor = { row: clampRow(current.row + dr), col: clampCol(current.col + dc) };
        setAnchor(newAnchor);
        setRangeEnd(null);
      }
      return;
    }

    // Tab/Shift+Tab
    if (e.key === 'Tab') {
      e.preventDefault();
      const current = rangeEnd ?? anchor;
      if (e.shiftKey) {
        // 이전 셀
        if (current.col > 0) {
          setAnchor({ row: current.row, col: current.col - 1 });
        } else if (current.row > 0) {
          setAnchor({ row: current.row - 1, col: maxCol });
        }
      } else {
        // 다음 셀
        if (current.col < maxCol) {
          setAnchor({ row: current.row, col: current.col + 1 });
        } else if (current.row < maxRow) {
          setAnchor({ row: current.row + 1, col: 0 });
        }
      }
      setRangeEnd(null);
      return;
    }

    // Enter / F2 → 편집
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      setEditingCell({ ...anchor });
      setInitialEditChar(null);
      return;
    }

    // Escape
    if (e.key === 'Escape') {
      e.preventDefault();
      setAnchor(null);
      setRangeEnd(null);
      return;
    }

    // Ctrl+C → 복사
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      const scene = displayScenes[anchor.row];
      if (scene) {
        const fieldName = EDITABLE_FIELDS[anchor.col];
        const val = (fieldName === 'memo' ? scene.memo : scene.assignee) || '';
        navigator.clipboard.writeText(val).catch(() => {});
      }
      return;
    }

    // Ctrl+V → 일괄 붙여넣기
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      navigator.clipboard.readText().then((text) => {
        if (!text) return;
        const trimmed = text.trim();
        for (const key of selectedCells) {
          const [r, c] = key.split(':').map(Number);
          const scene = displayScenes[r];
          if (!scene) continue;
          const globalIdx = allScenes.indexOf(scene);
          if (globalIdx < 0) continue;
          const fieldName = EDITABLE_FIELDS[c];
          onFieldUpdate(globalIdx, fieldName, trimmed);
        }
      }).catch(() => {});
      return;
    }

    // Delete/Backspace → 선택된 셀 내용 삭제
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      for (const key of selectedCells) {
        const [r, c] = key.split(':').map(Number);
        const scene = displayScenes[r];
        if (!scene) continue;
        const globalIdx = allScenes.indexOf(scene);
        if (globalIdx < 0) continue;
        const fieldName = EDITABLE_FIELDS[c];
        onFieldUpdate(globalIdx, fieldName, '');
      }
      return;
    }

    // 일반 문자 타이핑 → 편집 모드 진입
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setEditingCell({ ...anchor });
      setInitialEditChar(e.key);
      return;
    }
  }, [editingCell, anchor, rangeEnd, maxRow, maxCol, displayScenes, allScenes, selectedCells, onFieldUpdate]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      <div
        ref={tableRef}
        tabIndex={0}
        className="overflow-auto rounded-lg border border-bg-border focus:outline-none"
        onKeyDown={handleTableKeyDown}
        onMouseUp={() => setIsDragging(false)}
        style={{ userSelect: isDragging ? 'none' : undefined }}
      >
        <table
          className="w-full text-sm border-collapse"
          style={{ tableLayout: 'fixed', minWidth: totalWidth }}
        >
          <colgroup>
            {SINGLE_SHEET_COLUMNS.map((column) => (
              <col key={column.key} style={{ width: widthOf(column.key) }} />
            ))}
          </colgroup>
          {/* ── 헤더 ── */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-bg-card border-b border-bg-border">
              {/* 한솔 결정 (1-B): 레이아웃 별 보기 시 별도 컬럼 대신 행 위에 그룹 헤더 행을 삽입.
                  컬럼 수가 일반 모드와 동일하게 유지된다. */}
              <ResizableHeaderCell columnKey="scene" width={widthOf('scene')} onResizeStart={startResize} shortLabel="씬">씬번호</ResizableHeaderCell>
              <ResizableHeaderCell columnKey="memo" width={widthOf('memo')} onResizeStart={startResize} shortLabel="메모">메모</ResizableHeaderCell>
              <ResizableHeaderCell columnKey="storyboard" width={widthOf('storyboard')} onResizeStart={startResize} align="center" shortLabel="SB">스토리보드</ResizableHeaderCell>
              <ResizableHeaderCell columnKey="guide" width={widthOf('guide')} onResizeStart={startResize} align="center" shortLabel="Guide">가이드</ResizableHeaderCell>
              <ResizableHeaderCell columnKey="assignee" width={widthOf('assignee')} onResizeStart={startResize} shortLabel="담">담당자</ResizableHeaderCell>
              {useActingPhaseControls ? (
                <th
                  colSpan={4}
                  className="px-1 py-2 text-center text-[11px] font-medium"
                  style={{ color: deptConfig.color }}
                >
                  액팅 단계
                </th>
              ) : (
                STAGES.map((s) => (
                  <ResizableHeaderCell
                    key={s}
                    columnKey={s}
                    width={widthOf(s)}
                    onResizeStart={startResize}
                    align="center"
                    className="px-1 text-[11px]"
                    style={{ color: deptConfig.stageColors[s] }}
                    shortLabel={STAGE_SHORT_LABELS[s]}
                  >
                    {deptConfig.stageLabels[s]}
                  </ResizableHeaderCell>
                ))
              )}
              <ResizableHeaderCell columnKey="actions" width={widthOf('actions')} onResizeStart={startResize} align="center" className="px-1" />
            </tr>
          </thead>

          {/* ── 본문 ── */}
          <tbody>
            {displayScenes.map((scene, rowIndex) => {
              const idx = allScenes.indexOf(scene);
              const meta = layoutMeta.get(scene);
              const isRowSelected = selectedSceneIds?.has(scene.sceneId);
              const isFirstInGroup = meta?.isFirst ?? false;
              const isLastInGroup = meta?.isLast ?? false;
              const groupSize = meta?.groupSize ?? 1;
              const layoutKey = meta?.layoutKey ?? '';
              const isLayoutMode = sceneGroupMode === 'layout';

              return (
                <Fragment key={`${scene.sceneId}-${idx}`}>
                  {/* 한솔 결정 (1-B 시안 2 + 굵은 보더): 카드 박스 헤더 + 그룹 사이 빈 간격 */}
                  {isLayoutMode && isFirstInGroup && rowIndex > 0 && (
                    <tr className="scene-row-group-gap"><td colSpan={100}></td></tr>
                  )}
                  {isLayoutMode && isFirstInGroup && (
                    <tr className="scene-group-header">
                      <td colSpan={100}>
                        <span className="inline-flex items-center gap-2">
                          <span className="text-sm font-bold text-accent">
                            {layoutKey !== '미분류' ? `L#${layoutKey}` : '레이아웃 미분류'}
                          </span>
                          <span className="text-[11px] text-text-secondary">{groupSize}개 씬</span>
                        </span>
                      </td>
                    </tr>
                  )}
                  <motion.tr
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15, delay: Math.min(rowIndex * 0.01, 0.2) }}
                    className={cn(
                      'border-b border-bg-border/30 transition-colors group',
                      rowIndex % 2 === 0 ? 'bg-bg-card/20' : 'bg-bg-primary/10',
                      'hover:bg-accent/5',
                      isRowSelected && 'bg-accent/10 hover:bg-accent/15',
                      searchQuery && 'bg-accent/5 border-l-2 border-l-accent/60',
                      highlightSceneId && scene.sceneId === highlightSceneId && 'scene-row-highlighted',
                      completionTintEnabled && isFullyDone(scene) && 'scene-completion-tint-row',
                      isLayoutMode && !isLastInGroup && 'scene-row-group-mid',
                      isLayoutMode && isLastInGroup && 'scene-row-group-last',
                    )}
                    onClick={(e) => {
                      if ((e.ctrlKey || e.metaKey) && onCtrlClick) {
                        onCtrlClick(scene.sceneId);
                      }
                    }}
                    onDoubleClick={() => onOpenDetail(idx)}
                  >
                  {/* 씬번호 + 레이아웃 뱃지 + 댓글 뱃지.
                      한솔 결정 (5번): 1+3 합본 효과 — 텍스트 네온 펄스 + wrap 회전 보더. */}
                  <td className="px-2 py-1.5 font-mono text-xs">
                    <span className="flex items-center gap-2">
                      <span className="scene-num-glow-wrap">
                        <span className="scene-num-glow-text">
                          <HighlightText text={scene.sceneId || '-'} query={searchQuery} />
                        </span>
                      </span>
                      {scene.layoutId && (
                        <span className="text-[11px] italic font-medium text-accent flex-shrink-0">
                          L#{scene.layoutId}
                        </span>
                      )}
                      {(() => {
                        const commentKey = `${sheetName}:${scene.no}`;
                        const cc = commentCounts[commentKey];
                        const isUnread = commentUnreadByKey?.[commentKey] ?? false;
                        return cc > 0 ? (
                          <span
                            className={cn(
                              'compact-label-container inline-flex min-w-0 shrink items-center gap-0.5 rounded-full border px-1 py-px transition-colors',
                              isUnread
                                ? 'comment-unread-badge border-accent/25 bg-accent/20 text-accent'
                                : 'border-bg-border/40 bg-text-secondary/10 text-text-secondary/55',
                            )}
                            title={`${isUnread ? '새 댓글' : '확인한 댓글'} ${cc}개`}
                          >
                            <CompactIconLabel
                              icon={<MessageCircle size={9} fill="currentColor" />}
                              label={`${cc}개`}
                              textClassName="text-[10px] font-bold"
                            />
                          </span>
                        ) : null;
                      })()}
                    </span>
                  </td>

                  {/* 메모 (인라인 편집) */}
                  <SheetEditableCell
                    value={scene.memo || ''}
                    field="memo"
                    sceneIndex={idx}
                    onSave={onFieldUpdate}
                    searchQuery={searchQuery}
                    isSelected={selectedCells.has(cellKey(rowIndex, 0))}
                    isEditing={editingCell?.row === rowIndex && editingCell?.col === 0}
                    initialChar={editingCell?.row === rowIndex && editingCell?.col === 0 ? initialEditChar : undefined}
                    onMouseDown={(e) => handleCellMouseDown(rowIndex, 0, e)}
                    onMouseEnter={() => handleCellMouseEnter(rowIndex, 0)}
                    onStartEditing={() => handleStartEditing(rowIndex, 0)}
                    onStopEditing={handleStopEditing}
                  />

                  {/* 스토리보드 썸네일 */}
                  <SheetThumbnailCell url={scene.storyboardUrl} label="스토리보드" />

                  {/* 가이드 썸네일 */}
                  <SheetThumbnailCell url={scene.guideUrl} label="가이드" />

                  {/* 담당자 (인라인 편집) */}
                  <SheetEditableCell
                    value={scene.assignee || ''}
                    field="assignee"
                    sceneIndex={idx}
                    onSave={onFieldUpdate}
                    type="assignee"
                    searchQuery={searchQuery}
                    isSelected={selectedCells.has(cellKey(rowIndex, 1))}
                    isEditing={editingCell?.row === rowIndex && editingCell?.col === 1}
                    initialChar={editingCell?.row === rowIndex && editingCell?.col === 1 ? initialEditChar : undefined}
                    onMouseDown={(e) => handleCellMouseDown(rowIndex, 1, e)}
                    onMouseEnter={() => handleCellMouseEnter(rowIndex, 1)}
                    onStartEditing={() => handleStartEditing(rowIndex, 1)}
                    onStopEditing={handleStopEditing}
                  />

                  {/* 진행상황: ACT 단독은 새 액팅 단계, 그 외는 기존 BG 스테이지 체크박스 */}
                  {useActingPhaseControls ? (
                    <td colSpan={4} className="px-1 py-1.5">
                      <div onClick={(e) => e.stopPropagation()}>
                        <ScenePhaseToggle
                          scene={scene}
                          compact
                          onStateClick={(next) => onActPhaseStateClick(sheetName, scene.sceneId, next)}
                          onRequestFeedback={() => onActFeedbackRequest(sheetName, scene.sceneId)}
                          onRoundBump={(kind, delta) => onActRoundBump(sheetName, scene.sceneId, kind, delta)}
                        />
                      </div>
                    </td>
                  ) : (
                    STAGES.map((stage) => (
                      <td key={stage} className="px-1 py-1.5 text-center">
                        <button
                          type="button"
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.preventDefault();
                            e.stopPropagation();
                            stagePointerHandledRef.current = true;
                            onToggle(scene.sceneId, stage);
                            window.setTimeout(() => {
                              stagePointerHandledRef.current = false;
                            }, 600);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (stagePointerHandledRef.current) {
                              stagePointerHandledRef.current = false;
                              return;
                            }
                            onToggle(scene.sceneId, stage);
                          }}
                          className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all mx-auto"
                          style={
                            scene[stage]
                              ? { backgroundColor: deptConfig.stageColors[stage], color: 'rgb(var(--color-bg-primary))' }
                              : { border: '1px solid #2D3041' }
                          }
                        >
                          {scene[stage] ? '✓' : ''}
                        </button>
                      </td>
                    ))
                  )}

                  {/* 삭제 */}
                  <td className="px-1 py-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(idx); }}
                      className="opacity-0 group-hover:opacity-100 text-text-secondary/50 hover:text-red-400 transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                  </motion.tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
