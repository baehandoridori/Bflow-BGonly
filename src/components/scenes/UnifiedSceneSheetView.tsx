import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { MessageCircle, Trash2 } from 'lucide-react';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { MergedScene, Stage, Scene } from '@/types';
import type { SceneGroupMode } from '@/stores/useAppStore';
import { sceneProgress, progressGradient } from '@/utils/calcStats';
import { cn } from '@/utils/cn';
import { HighlightText } from '@/components/common/HighlightText';
import { AssigneeSelect } from '@/components/common/AssigneeSelect';

// ─── Props ───────────────────────────────────────────────────

interface UnifiedSceneSheetViewProps {
  mergedScenes: MergedScene[];
  bgSheetName: string | null;
  actSheetName: string | null;
  commentCounts: Record<string, number>;
  searchQuery?: string;
  selectedSceneIds: Set<string>;
  sceneGroupMode: SceneGroupMode;
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onDelete: (sheetName: string, sceneIndex: number) => void;
  onOpenDetail: (sheetName: string, sceneIndex: number) => void;
  /** 통합 상세 모달 열기 — 설정된 경우 onOpenDetail 대신 사용 */
  onOpenMerged?: (merged: MergedScene) => void;
  onFieldUpdate: (sheetName: string, sceneIndex: number, field: string, value: string) => void;
  onCtrlClick?: (sceneId: string) => void;
}

// ─── 셀 선택 타입 ───────────────────────────────────────────

interface CellId { row: number; col: number }
// 편집 가능 필드: 메모(0), BG담당(1), ACT담당(2)
const EDITABLE_FIELDS = ['memo', 'bgAssignee', 'actAssignee'] as const;

function cellKey(row: number, col: number) { return `${row}:${col}`; }

// ─── 인라인 편집 셀 ─────────────────────────────────────────

function SheetEditableCell({
  value,
  field,
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
  onSave: (value: string) => void;
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

  // isEditing 해제 시 자동 commit
  useEffect(() => {
    if (!isEditing) return;
    cancelledRef.current = false;
    return () => {
      if (!cancelledRef.current && draftRef.current !== valueRef.current) {
        onSave(draftRef.current);
      }
      cancelledRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  useEffect(() => {
    if (isEditing && type === 'text' && inputRef.current) {
      inputRef.current.focus();
      if (initialChar == null) inputRef.current.select();
    }
  }, [isEditing, type, initialChar]);

  useEffect(() => {
    if (isEditing && initialChar != null) {
      setDraft(initialChar);
    }
  }, [isEditing, initialChar]);

  useEffect(() => {
    if (isEditing && type === 'assignee' && cellRef.current) {
      const input = cellRef.current.querySelector('input');
      if (input) setTimeout(() => input.focus(), 0);
    }
  }, [isEditing, type]);

  const commit = useCallback(() => {
    if (cancelledRef.current) { cancelledRef.current = false; return; }
    if (draft !== value) onSave(draft);
    onStopEditing();
  }, [draft, value, onSave, onStopEditing]);

  if (isEditing) {
    if (type === 'assignee') {
      return (
        <td
          ref={cellRef}
          className="px-2 py-1"
          style={{ overflow: 'visible', position: 'relative' }}
          onClick={(e) => e.stopPropagation()}
        >
          <AssigneeSelect
            value={draft}
            onChange={(v) => { onSave(v); onStopEditing(); }}
            onClose={onStopEditing}
            className="w-full"
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
        isMemo && 'max-w-0',
        isSelected
          ? 'ring-2 ring-accent ring-inset bg-accent/5'
          : 'hover:bg-accent/5',
      )}
      onMouseDown={(e) => {
        if (e.ctrlKey || e.metaKey) return;
        e.stopPropagation();
        onMouseDown(e);
      }}
      onMouseEnter={onMouseEnter}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEditing();
      }}
    >
      <HighlightText text={value || '-'} query={searchQuery} />
    </td>
  );
}

// ─── 이미지 썸네일 + 호버 미리보기 ──────────────────────────

function SheetThumbnailCell({ url, label }: { url?: string; label: string }) {
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

// ─── 진행률 셀 ───────────────────────────────────────────────

function SheetProgressCell({ pct }: { pct: number }) {
  return (
    <td className="px-1 py-1.5 text-center">
      <div className="flex flex-col items-center gap-0.5">
        <span className={cn(
          'text-[10px] font-mono font-bold leading-none',
          pct >= 100 ? 'text-green-400' : pct >= 50 ? 'text-yellow-400' : 'text-text-secondary',
        )}>
          {Math.round(pct)}%
        </span>
        <div className="w-full h-1 bg-bg-primary rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: progressGradient(pct) }}
          />
        </div>
      </div>
    </td>
  );
}

// ─── 메인 컴포넌트 ──────────────────────────────────────────

export function UnifiedSceneSheetView({
  mergedScenes,
  bgSheetName,
  actSheetName,
  commentCounts,
  searchQuery,
  selectedSceneIds,
  sceneGroupMode,
  onToggle,
  onDelete,
  onOpenDetail,
  onOpenMerged,
  onFieldUpdate,
  onCtrlClick,
}: UnifiedSceneSheetViewProps) {
  const bgCfg = DEPARTMENT_CONFIGS.bg;
  const actCfg = DEPARTMENT_CONFIGS.acting;

  // 레이아웃 그루핑
  const layoutGroups = useMemo(() => {
    if (sceneGroupMode !== 'layout') return null;
    const groups = new Map<string, MergedScene[]>();
    for (const m of mergedScenes) {
      const primary = m.bgScene ?? m.actScene;
      const lid = (primary?.layoutId || '').trim();
      const key = lid || '미분류';
      const arr = groups.get(key) || [];
      arr.push(m);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === '미분류') return 1;
      if (b[0] === '미분류') return -1;
      return a[0].localeCompare(b[0], undefined, { numeric: true });
    });
  }, [mergedScenes, sceneGroupMode]);

  const displayScenes = useMemo(() => {
    if (!layoutGroups) return mergedScenes;
    return layoutGroups.flatMap(([, scenes]) => scenes);
  }, [layoutGroups, mergedScenes]);

  const layoutMeta = useMemo(() => {
    if (!layoutGroups) return new Map<MergedScene, { isFirst: boolean; groupSize: number; layoutKey: string }>();
    const meta = new Map<MergedScene, { isFirst: boolean; groupSize: number; layoutKey: string }>();
    for (const [layoutKey, groupScenes] of layoutGroups) {
      groupScenes.forEach((m, i) => {
        meta.set(m, { isFirst: i === 0, groupSize: groupScenes.length, layoutKey });
      });
    }
    return meta;
  }, [layoutGroups]);

  // ── 셀 선택 상태 ──
  const [anchor, setAnchor] = useState<CellId | null>(null);
  const [rangeEnd, setRangeEnd] = useState<CellId | null>(null);
  const [editingCell, setEditingCell] = useState<CellId | null>(null);
  const [initialEditChar, setInitialEditChar] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  // 드래그 판정 — 단순 클릭이 범위 선택(중복 선택)으로 오해되지 않도록 임계값 설정
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragActiveRef = useRef(false);

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

  // scenes 변경 시 선택 초기화
  useEffect(() => {
    if (editingCell) return;
    setAnchor(null);
    setRangeEnd(null);
    setInitialEditChar(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedScenes]);

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

  // 드래그 판정 + 종료 — 마우스 다운 후 threshold(6px) 초과 시점에 isDragging=true
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragStartRef.current || dragActiveRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        dragActiveRef.current = true;
        setIsDragging(true);
      }
    };
    const onUp = () => {
      dragStartRef.current = null;
      dragActiveRef.current = false;
      setIsDragging(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── 셀 인터랙션 핸들러 ──

  const handleCellMouseDown = useCallback((row: number, col: number, e: React.MouseEvent) => {
    setEditingCell(null);
    setInitialEditChar(null);
    if (e.shiftKey && anchor) {
      setRangeEnd({ row, col });
    } else {
      setAnchor({ row, col });
      setRangeEnd(null);
      // 드래그 시작 좌표만 기록 — 실제 드래그 활성화는 전역 mousemove threshold 에서 판정
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      dragActiveRef.current = false;
    }
    tableRef.current?.focus({ preventScroll: true });
  }, [anchor]);

  const handleCellMouseEnter = useCallback((row: number, col: number) => {
    // threshold 를 넘겨 실제 드래그로 판정된 경우에만 범위 선택 확장
    if (dragActiveRef.current) setRangeEnd({ row, col });
  }, []);

  const handleStartEditing = useCallback((row: number, col: number) => {
    setEditingCell({ row, col });
    setInitialEditChar(null);
    setAnchor({ row, col });
    setRangeEnd(null);
  }, []);

  const handleStopEditing = useCallback(() => {
    setEditingCell(null);
    setInitialEditChar(null);
    tableRef.current?.focus({ preventScroll: true });
  }, []);

  // 필드 저장 헬퍼: col에 따라 올바른 sheetName/sceneIndex 결정
  const saveField = useCallback((row: number, col: number, value: string) => {
    const m = displayScenes[row];
    if (!m) return;
    const fieldDef = EDITABLE_FIELDS[col];
    if (fieldDef === 'memo') {
      // 메모는 BG 우선, 없으면 ACT
      if (m.bgScene && bgSheetName) onFieldUpdate(bgSheetName, m.bgSceneIndex, 'memo', value);
      else if (m.actScene && actSheetName) onFieldUpdate(actSheetName, m.actSceneIndex, 'memo', value);
    } else if (fieldDef === 'bgAssignee') {
      if (m.bgScene && bgSheetName) onFieldUpdate(bgSheetName, m.bgSceneIndex, 'assignee', value);
    } else if (fieldDef === 'actAssignee') {
      if (m.actScene && actSheetName) onFieldUpdate(actSheetName, m.actSceneIndex, 'assignee', value);
    }
  }, [displayScenes, bgSheetName, actSheetName, onFieldUpdate]);

  // 셀 값 읽기 헬퍼
  const getCellValue = useCallback((row: number, col: number): string => {
    const m = displayScenes[row];
    if (!m) return '';
    const fieldDef = EDITABLE_FIELDS[col];
    if (fieldDef === 'memo') return (m.bgScene ?? m.actScene)?.memo || '';
    if (fieldDef === 'bgAssignee') return m.bgScene?.assignee || '';
    if (fieldDef === 'actAssignee') return m.actScene?.assignee || '';
    return '';
  }, [displayScenes]);

  // ── 키보드 핸들러 ──

  const handleTableKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (editingCell) return;
    if (!anchor) return;

    const clampRow = (r: number) => Math.max(0, Math.min(r, maxRow));
    const clampCol = (c: number) => Math.max(0, Math.min(c, maxCol));

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const current = rangeEnd ?? anchor;
      const dr = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      const dc = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (e.shiftKey) {
        setRangeEnd({ row: clampRow(current.row + dr), col: clampCol(current.col + dc) });
      } else {
        setAnchor({ row: clampRow(current.row + dr), col: clampCol(current.col + dc) });
        setRangeEnd(null);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const current = rangeEnd ?? anchor;
      if (e.shiftKey) {
        if (current.col > 0) setAnchor({ row: current.row, col: current.col - 1 });
        else if (current.row > 0) setAnchor({ row: current.row - 1, col: maxCol });
      } else {
        if (current.col < maxCol) setAnchor({ row: current.row, col: current.col + 1 });
        else if (current.row < maxRow) setAnchor({ row: current.row + 1, col: 0 });
      }
      setRangeEnd(null);
      return;
    }

    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      setEditingCell({ ...anchor });
      setInitialEditChar(null);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setAnchor(null);
      setRangeEnd(null);
      return;
    }

    // Ctrl+C
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      const val = getCellValue(anchor.row, anchor.col);
      navigator.clipboard.writeText(val).catch(() => {});
      return;
    }

    // Ctrl+V
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      navigator.clipboard.readText().then((text) => {
        if (!text) return;
        const trimmed = text.trim();
        for (const key of selectedCells) {
          const [r, c] = key.split(':').map(Number);
          saveField(r, c, trimmed);
        }
      }).catch(() => {});
      return;
    }

    // Delete/Backspace
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      for (const key of selectedCells) {
        const [r, c] = key.split(':').map(Number);
        saveField(r, c, '');
      }
      return;
    }

    // 일반 문자 타이핑 → 편집 모드
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setEditingCell({ ...anchor });
      setInitialEditChar(e.key);
      return;
    }
  }, [editingCell, anchor, rangeEnd, maxRow, maxCol, selectedCells, getCellValue, saveField]);

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
        <table className="w-full text-sm border-collapse">
          {/* ── 헤더 ── */}
          <thead className="sticky top-0 z-10">
            {/* 부서 구분 서브헤더 (상단) */}
            <tr className="bg-bg-card border-b border-bg-border/50">
              {sceneGroupMode === 'layout' && <th />}
              <th colSpan={2} />
              <th className="px-2 py-1" />
              <th colSpan={2} />
              <th colSpan={4} className="py-1 text-center">
                <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary/60">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: bgCfg.color }} />
                  {bgCfg.shortLabel}
                </span>
              </th>
              <th colSpan={4} className="py-1 text-center">
                <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary/60">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: actCfg.color }} />
                  {actCfg.shortLabel}
                </span>
              </th>
              <th colSpan={3} />
              <th />
            </tr>
            <tr className="bg-bg-card border-b border-bg-border">
              {sceneGroupMode === 'layout' && (
                <th className="w-20 px-2 py-2 text-left text-xs font-medium text-text-secondary border-r border-bg-border/50">
                  레이아웃
                </th>
              )}
              <th className="w-20 px-2 py-2 text-left text-xs font-medium text-text-secondary">씬번호</th>
              <th className="px-2 py-2 text-left text-xs font-medium text-text-secondary">메모</th>
              <th className="w-14 px-1 py-2 text-center text-xs font-medium text-text-secondary">SB</th>
              <th className="w-14 px-1 py-2 text-center text-xs font-medium text-text-secondary">가이드</th>
              {/* BG 담당 + 스테이지 */}
              <th className="w-20 px-2 py-2 text-left text-xs font-medium" style={{ color: bgCfg.color }}>
                BG담당
              </th>
              {STAGES.map((s) => (
                <th
                  key={`bg-${s}`}
                  className="w-10 px-1 py-2 text-center text-[11px] font-medium"
                  style={{ color: bgCfg.stageColors[s] }}
                >
                  {bgCfg.stageLabels[s]}
                </th>
              ))}
              {/* ACT 담당 + 스테이지 */}
              <th className="w-20 px-2 py-2 text-left text-xs font-medium" style={{ color: actCfg.color }}>
                ACT담당
              </th>
              {STAGES.map((s) => (
                <th
                  key={`act-${s}`}
                  className="w-10 px-1 py-2 text-center text-[11px] font-medium"
                  style={{ color: actCfg.stageColors[s] }}
                >
                  {actCfg.stageLabels[s]}
                </th>
              ))}
              <th className="w-12 px-1 py-2 text-center text-xs font-medium text-text-secondary">BG%</th>
              <th className="w-12 px-1 py-2 text-center text-xs font-medium text-text-secondary">ACT%</th>
              <th className="w-12 px-1 py-2 text-center text-xs font-medium text-text-secondary">합계</th>
              <th className="w-8 px-1 py-2" />
            </tr>
          </thead>

          {/* ── 본문 ── */}
          <tbody>
            {displayScenes.map((m, rowIndex) => {
              const { sceneId, bgScene, actScene, bgSceneIndex, actSceneIndex } = m;
              const primary = bgScene ?? actScene;
              if (!primary) return null;

              const bgPct = bgScene ? sceneProgress(bgScene) : 0;
              const actPct = actScene ? sceneProgress(actScene) : 0;
              const presentCount = (bgScene ? 1 : 0) + (actScene ? 1 : 0);
              const combinedPct = presentCount > 0 ? Math.round((bgPct + actPct) / presentCount) : 0;

              const meta = layoutMeta.get(m);
              const isRowSelected = selectedSceneIds.has(`bg:${sceneId}`) || selectedSceneIds.has(`act:${sceneId}`);
              const isFirstInGroup = meta?.isFirst ?? false;
              const groupSize = meta?.groupSize ?? 1;
              const layoutKey = meta?.layoutKey ?? '';

              const bgCommentCount = bgSheetName ? (commentCounts[`${bgSheetName}:${primary.no}`] ?? 0) : 0;

              return (
                <motion.tr
                  key={sceneId}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: Math.min(rowIndex * 0.01, 0.2) }}
                  className={cn(
                    'border-b border-bg-border/30 transition-colors group cursor-pointer',
                    rowIndex % 2 === 0 ? 'bg-bg-card/20' : 'bg-bg-primary/10',
                    'hover:bg-accent/5',
                    isRowSelected && 'bg-accent/10 hover:bg-accent/15',
                    searchQuery && 'bg-accent/5 border-l-2 border-l-accent/60',
                    sceneGroupMode === 'layout' && isFirstInGroup && rowIndex > 0 && 'border-t-2 border-t-bg-border',
                  )}
                  onClick={(e) => {
                    if ((e.ctrlKey || e.metaKey) && onCtrlClick) {
                      onCtrlClick(sceneId);
                    }
                  }}
                  onDoubleClick={() => {
                    // 통합 모달 콜백 우선 — BG+ACT 를 함께 열기
                    if (onOpenMerged) {
                      onOpenMerged(m);
                      return;
                    }
                    if (bgScene && bgSheetName) onOpenDetail(bgSheetName, bgSceneIndex);
                    else if (actScene && actSheetName) onOpenDetail(actSheetName, actSceneIndex);
                  }}
                >
                  {/* 레이아웃 병합 셀 */}
                  {sceneGroupMode === 'layout' && isFirstInGroup && (
                    <td
                      rowSpan={groupSize}
                      className="px-2 py-2 text-center font-mono text-xs font-bold border-r border-bg-border/50 align-middle text-accent"
                    >
                      {layoutKey !== '미분류' ? `#${layoutKey}` : (
                        <span className="text-text-secondary/40 font-normal">-</span>
                      )}
                    </td>
                  )}

                  {/* 씬번호 + 댓글 뱃지 */}
                  <td className="px-2 py-1.5 font-mono text-xs text-accent">
                    <span className="flex items-center gap-1">
                      <HighlightText text={primary.sceneId || '-'} query={searchQuery} />
                      {bgCommentCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 bg-accent/20 text-accent px-1 py-px rounded-full">
                          <MessageCircle size={9} fill="currentColor" />
                          <span className="text-[10px] font-bold">{bgCommentCount}</span>
                        </span>
                      )}
                    </span>
                  </td>

                  {/* 메모 (인라인 편집) */}
                  <SheetEditableCell
                    value={(bgScene ?? actScene)?.memo || ''}
                    field="memo"
                    onSave={(v) => saveField(rowIndex, 0, v)}
                    searchQuery={searchQuery}
                    isSelected={selectedCells.has(cellKey(rowIndex, 0))}
                    isEditing={editingCell?.row === rowIndex && editingCell?.col === 0}
                    initialChar={editingCell?.row === rowIndex && editingCell?.col === 0 ? initialEditChar : undefined}
                    onMouseDown={(e) => handleCellMouseDown(rowIndex, 0, e)}
                    onMouseEnter={() => handleCellMouseEnter(rowIndex, 0)}
                    onStartEditing={() => handleStartEditing(rowIndex, 0)}
                    onStopEditing={handleStopEditing}
                  />

                  {/* 스토리보드 — BG 전용 (정책 통일) */}
                  <SheetThumbnailCell url={bgScene?.storyboardUrl} label="스토리보드" />

                  {/* 가이드 — BG 전용 */}
                  <SheetThumbnailCell url={bgScene?.guideUrl} label="가이드" />

                  {/* BG 담당자 (인라인 편집) */}
                  {bgScene ? (
                    <SheetEditableCell
                      value={bgScene.assignee || ''}
                      field="bgAssignee"
                      onSave={(v) => saveField(rowIndex, 1, v)}
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
                  ) : (
                    <td className="px-2 py-1.5 text-xs text-text-secondary/20">—</td>
                  )}

                  {/* BG 스테이지 체크박스 */}
                  {STAGES.map((stage) => (
                    <td key={`bg-${stage}`} className="px-1 py-1.5 text-center">
                      {bgScene && bgSheetName ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggle(bgSheetName, sceneId, stage); }}
                          className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all mx-auto cursor-pointer"
                          style={
                            bgScene[stage]
                              ? { backgroundColor: bgCfg.stageColors[stage], color: 'rgb(var(--color-bg-primary))' }
                              : { border: '1px solid #2D3041' }
                          }
                        >
                          {bgScene[stage] ? '✓' : ''}
                        </button>
                      ) : (
                        <span className="text-text-secondary/20 text-xs">—</span>
                      )}
                    </td>
                  ))}

                  {/* ACT 담당자 (인라인 편집) */}
                  {actScene ? (
                    <SheetEditableCell
                      value={actScene.assignee || ''}
                      field="actAssignee"
                      onSave={(v) => saveField(rowIndex, 2, v)}
                      type="assignee"
                      searchQuery={searchQuery}
                      isSelected={selectedCells.has(cellKey(rowIndex, 2))}
                      isEditing={editingCell?.row === rowIndex && editingCell?.col === 2}
                      initialChar={editingCell?.row === rowIndex && editingCell?.col === 2 ? initialEditChar : undefined}
                      onMouseDown={(e) => handleCellMouseDown(rowIndex, 2, e)}
                      onMouseEnter={() => handleCellMouseEnter(rowIndex, 2)}
                      onStartEditing={() => handleStartEditing(rowIndex, 2)}
                      onStopEditing={handleStopEditing}
                    />
                  ) : (
                    <td className="px-2 py-1.5 text-xs text-text-secondary/20">—</td>
                  )}

                  {/* ACT 스테이지 체크박스 */}
                  {STAGES.map((stage) => (
                    <td key={`act-${stage}`} className="px-1 py-1.5 text-center">
                      {actScene && actSheetName ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggle(actSheetName, sceneId, stage); }}
                          className="w-5 h-5 rounded flex items-center justify-center text-xs transition-all mx-auto cursor-pointer"
                          style={
                            actScene[stage]
                              ? { backgroundColor: actCfg.stageColors[stage], color: 'rgb(var(--color-bg-primary))' }
                              : { border: '1px solid #2D3041' }
                          }
                        >
                          {actScene[stage] ? '✓' : ''}
                        </button>
                      ) : (
                        <span className="text-text-secondary/20 text-xs">—</span>
                      )}
                    </td>
                  ))}

                  {/* BG% */}
                  <SheetProgressCell pct={bgScene ? bgPct : 0} />

                  {/* ACT% */}
                  <SheetProgressCell pct={actScene ? actPct : 0} />

                  {/* 합계% */}
                  <SheetProgressCell pct={combinedPct} />

                  {/* 삭제 */}
                  <td className="px-1 py-1.5">
                    <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {bgScene && bgSheetName && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(bgSheetName, bgSceneIndex); }}
                          className="text-[10px] text-text-secondary/50 hover:text-red-400 transition-colors cursor-pointer"
                          title="BG 삭제"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                      {actScene && actSheetName && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(actSheetName, actSceneIndex); }}
                          className="text-[10px] text-text-secondary/50 hover:text-red-400 transition-colors cursor-pointer"
                          title="ACT 삭제"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
