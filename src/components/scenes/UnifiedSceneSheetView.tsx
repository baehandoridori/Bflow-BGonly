import { useState, useRef, useEffect, useMemo, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { MergedScene, Stage, Scene, ScenePhaseState } from '@/types';
import { ScenePhaseToggle } from './ScenePhaseToggle';
import type { SceneGroupMode } from '@/stores/useAppStore';
import { isFullyDone } from '@/utils/calcStats';
import { cn } from '@/utils/cn';
import { getMergedCommentBadgeCounts } from '@/utils/mergedSceneHelpers';
import { HighlightText } from '@/components/common/HighlightText';
import { PathLinkifiedText } from '@/components/common/PathLinkifiedText';
import { AssigneeSelect } from '@/components/common/AssigneeSelect';
import { AssigneeMultiSelect, AssigneeChipList } from '@/components/common/AssigneeMultiSelect';
import { useDataStore } from '@/stores/useDataStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { buildSceneKey } from '@/services/revisionService';
import { LengthIcon } from './LengthIcon';
import { SceneContextMenu } from './SceneContextMenu';
import {
  ResizableHeaderCell,
  useFittedSheetColumnWidths,
  useResizableSheetColumns,
  type SheetColumnDefinition,
} from './SheetColumnResize';
import { useAppStore } from '@/stores/useAppStore';
import { StageSegmentToggle } from './StageSegmentToggle';
import { SheetAlertBadges } from './SheetAlertBadges';

// ─── Props ───────────────────────────────────────────────────

interface UnifiedSceneSheetViewProps {
  mergedScenes: MergedScene[];
  bgSheetName: string | null;
  actSheetName: string | null;
  commentCounts: Record<string, number>;
  /** Codex P2 6차(2026-04-23): ambiguous skip 케이스에서 정확한 union 크기 계산을 위한 id 맵. */
  commentIdsByKey?: Record<string, string[]>;
  commentUnreadByKey?: Record<string, boolean>;
  searchQuery?: string;
  selectedSceneIds: Set<string>;
  sceneGroupMode: SceneGroupMode;
  /** 한솔 결정 (8번): 토스트 클릭 후 시트 뷰 진입 시 강조할 sceneId */
  highlightSceneId?: string | null;
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onDelete: (sheetName: string, sceneIndex: number) => void;
  onOpenDetail: (sheetName: string, sceneIndex: number) => void;
  /** 통합 상세 모달 열기 — 설정된 경우 onOpenDetail 대신 사용 */
  onOpenMerged?: (merged: MergedScene) => void;
  onFieldUpdate: (sheetName: string, sceneIndex: number, field: string, value: string) => void;
  onCtrlClick?: (sceneId: string) => void;
  /** v1.25.2~ 액팅 단계 토글 핸들러 (전달 시 ACT 4셀 대신 ScenePhaseToggle 표시) */
  onActPhaseStateClick?: (sheetName: string, sceneId: string, newState: ScenePhaseState) => void;
  onActFeedbackRequest?: (sheetName: string, sceneId: string) => void;
  onActRoundBump?: (sheetName: string, sceneId: string, kind: 'work' | 'feedback', delta: 1 | -1) => void;
}

// ─── 셀 선택 타입 ───────────────────────────────────────────

interface CellId { row: number; col: number }
// 편집 가능 필드: BG메모(0), ACT메모(1), BG담당(2), ACT담당(3)
// v1.16.0 — BG/ACT 메모를 별도 컬럼으로 분리 (한솔 결정 B2)
const EDITABLE_FIELDS = ['bgMemo', 'actMemo', 'bgAssignee', 'actAssignee'] as const;

function cellKey(row: number, col: number) { return `${row}:${col}`; }

type UnifiedSheetColumnKey =
  | 'scene'
  | 'alerts'
  | 'bgMemo'
  | 'actMemo'
  | 'storyboard'
  | 'guide'
  | 'bgAssignee'
  | 'bgLo'
  | 'bgDone'
  | 'bgReview'
  | 'bgPng'
  | 'actAssignee'
  | 'actWait'
  | 'actWork'
  | 'actFeedback'
  | 'actDone'
  | 'actions';

const UNIFIED_SHEET_COLUMNS: Array<SheetColumnDefinition<UnifiedSheetColumnKey>> = [
  { key: 'scene', defaultWidth: 104, minWidth: 78, maxWidth: 180 },
  { key: 'alerts', defaultWidth: 58, minWidth: 44, maxWidth: 84 },
  { key: 'bgMemo', defaultWidth: 220, minWidth: 72, maxWidth: 900 },
  { key: 'actMemo', defaultWidth: 220, minWidth: 72, maxWidth: 900 },
  { key: 'storyboard', defaultWidth: 64, minWidth: 48, maxWidth: 140 },
  { key: 'guide', defaultWidth: 64, minWidth: 48, maxWidth: 140 },
  { key: 'bgAssignee', defaultWidth: 112, minWidth: 72, maxWidth: 220 },
  { key: 'bgLo', defaultWidth: 48, minWidth: 36, maxWidth: 96 },
  { key: 'bgDone', defaultWidth: 52, minWidth: 36, maxWidth: 104 },
  { key: 'bgReview', defaultWidth: 52, minWidth: 36, maxWidth: 104 },
  { key: 'bgPng', defaultWidth: 52, minWidth: 36, maxWidth: 104 },
  { key: 'actAssignee', defaultWidth: 112, minWidth: 72, maxWidth: 220 },
  { key: 'actWait', defaultWidth: 52, minWidth: 36, maxWidth: 104 },
  { key: 'actWork', defaultWidth: 56, minWidth: 36, maxWidth: 112 },
  { key: 'actFeedback', defaultWidth: 64, minWidth: 44, maxWidth: 128 },
  { key: 'actDone', defaultWidth: 56, minWidth: 36, maxWidth: 112 },
  { key: 'actions', defaultWidth: 40, minWidth: 32, maxWidth: 72 },
];
const UNIFIED_SHEET_FILL_COLUMNS: UnifiedSheetColumnKey[] = ['bgMemo', 'actMemo'];

const BG_STAGE_SHORT_LABELS: Record<Stage, string> = {
  lo: 'LO',
  done: '완',
  review: '검',
  png: 'PNG',
};

const ACT_STAGE_SHORT_LABELS: Record<Stage, string> = {
  lo: '대',
  done: '작',
  review: '피',
  png: '완',
};

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
          <AssigneeMultiSelect
            value={draft}
            onChange={onSave}
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
            e.stopPropagation();
          }}
          className="w-full bg-bg-primary border border-accent/50 rounded px-1.5 py-0.5 text-xs text-text-primary outline-none focus:border-accent transition-colors"
        />
      </td>
    );
  }

  const isMemo = field === 'bgMemo' || field === 'actMemo';
  return (
    <td
      ref={cellRef}
      title={isMemo && value ? value : undefined}
      className={cn(
        'px-2 py-1.5 text-xs text-text-secondary cursor-cell truncate transition-colors',
        isMemo && 'min-w-0',
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
      {/* v1.16.0: 메모 컬럼은 G드라이브 경로 클릭 가능 (PathBadge) */}
      {isMemo ? (
        <PathLinkifiedText
          text={value || '-'}
          renderTextSegment={(seg, idx) => <HighlightText key={idx} text={seg} query={searchQuery} />}
        />
      ) : type === 'assignee' ? (
        value
          ? <AssigneeChipList value={value} size="sm" maxVisible={1} />
          : <span className="text-text-secondary/50">-</span>
      ) : (
        <HighlightText text={value || '-'} query={searchQuery} />
      )}
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

// ─── 메인 컴포넌트 ──────────────────────────────────────────

export function UnifiedSceneSheetView({
  mergedScenes,
  bgSheetName,
  actSheetName,
  commentCounts,
  commentIdsByKey,
  commentUnreadByKey,
  searchQuery,
  selectedSceneIds,
  sceneGroupMode,
  highlightSceneId,
  onToggle,
  onDelete,
  onOpenDetail,
  onOpenMerged,
  onFieldUpdate,
  onCtrlClick,
  onActPhaseStateClick,
  onActFeedbackRequest,
  onActRoundBump,
}: UnifiedSceneSheetViewProps) {
  const bgCfg = DEPARTMENT_CONFIGS.bg;
  const actCfg = DEPARTMENT_CONFIGS.acting;
  const completionTintEnabled = useAppStore((s) => s.completionTintEnabled);
  const {
    widthOf,
    startResize,
    startBoundaryResize,
  } = useResizableSheetColumns('bflow_unified_scene_sheet_columns_v1', UNIFIED_SHEET_COLUMNS);

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

  // v1.18.0: 리비전 시각 표시 — 행마다 미해결 카운트 lookup.
  // useRevisionStore.revisions 변경 시 재계산되도록 store selector 사용 (rerender 트리거).
  // store 의 getOpenCount 는 revisionService.getRevisionLookupSceneKeys 로 alias 까지 처리하므로
  // 단순 sceneKey 비교보다 안전하다.
  const revisions = useRevisionStore((s) => s.revisions);
  const getOpenCount = useRevisionStore((s) => s.getOpenCount);
  const episodes = useDataStore((s) => s.episodes);
  const revisionCountByMergedKey = useMemo(() => {
    if (!bgSheetName && !actSheetName) return new Map<string, number>();
    const sheetForKey = bgSheetName ?? actSheetName ?? '';
    // sibling scene id 들 — 같은 part 안의 모든 scene id (한 번만 계산해 재사용)
    let siblings: string[] = [];
    for (const ep of episodes) {
      const part = ep.parts.find((p) => p.sheetName === sheetForKey);
      if (part) {
        siblings = part.scenes.map((s) => s.sceneId);
        break;
      }
    }
    const map = new Map<string, number>();
    for (const m of displayScenes) {
      const primary = m.bgScene ?? m.actScene;
      const sceneId = primary?.sceneId || m.sceneId || '';
      if (!sheetForKey || !sceneId) continue;
      const sceneKey = buildSceneKey(sheetForKey, sceneId, { siblingSceneIds: siblings });
      const openCount = getOpenCount(sceneKey);
      if (openCount > 0) map.set(m.mergedKey, openCount);
    }
    return map;
    // revisions 도 deps 에 — store mutation 후 getOpenCount 결과가 바뀌므로 재계산 필요.
  }, [revisions, getOpenCount, displayScenes, bgSheetName, actSheetName, episodes]);

  const layoutMeta = useMemo(() => {
    if (!layoutGroups) return new Map<MergedScene, { isFirst: boolean; isLast: boolean; groupSize: number; layoutKey: string }>();
    const meta = new Map<MergedScene, { isFirst: boolean; isLast: boolean; groupSize: number; layoutKey: string }>();
    for (const [layoutKey, groupScenes] of layoutGroups) {
      groupScenes.forEach((m, i) => {
        meta.set(m, {
          isFirst: i === 0,
          isLast: i === groupScenes.length - 1,
          groupSize: groupScenes.length,
          layoutKey,
        });
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
  const [tableViewportWidth, setTableViewportWidth] = useState(0);

  useEffect(() => {
    const node = tableRef.current;
    if (!node) return;

    const updateWidth = () => {
      setTableViewportWidth(Math.floor(node.clientWidth));
    };
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    window.addEventListener('resize', updateWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  const fittedSheet = useFittedSheetColumnWidths(
    UNIFIED_SHEET_COLUMNS,
    widthOf,
    tableViewportWidth,
    UNIFIED_SHEET_FILL_COLUMNS,
  );
  const sheetWidth = fittedSheet.totalWidth;
  const displayWidthOf = useCallback(
    (key: UnifiedSheetColumnKey) => fittedSheet.widths[key],
    [fittedSheet],
  );

  // ── v1.16.0: 우클릭 컨텍스트 메뉴 상태 ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; merged: MergedScene } | null>(null);

  // ── v1.16.0: 리사이즈 시 transition 일시 비활성화 (렉 방지)
  // 행 200~400개에서 background/border/box-shadow transition 누적 부하 회피
  useEffect(() => {
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      document.documentElement.classList.add('is-resizing');
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        document.documentElement.classList.remove('is-resizing');
      }, 200);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimer) clearTimeout(resizeTimer);
      document.documentElement.classList.remove('is-resizing');
    };
  }, []);

  // 길이 변경 토글 (BG/ACT 양쪽 동기화)
  // v1.16.0 fix #1: 직렬 await → Promise.all 병렬.
  // v1.16.0 fix #2 (Codex 라운드 2): per-mergedKey Set 으로 same-row 동시 호출 직렬화.
  // v1.16.0 fix #3 (Codex 라운드 4): Promise.allSettled + per-UUID 부분 롤백.
  // v1.16.0 fix #4 (Codex 라운드 6): per-UUID 부분 롤백이 BG/ACT sync invariant 깸 →
  //                                  부분 실패 시 BG/ACT 둘 다 prev 로 롤백 (UI sync 보존).
  //                                  성공한 DB 호출은 best-effort reverse 로 정합성 회복 시도.
  const lengthChangeInFlightRef = useRef<Set<string>>(new Set());
  const handleSetLengthChange = useCallback(async (merged: MergedScene, value: 'LD' | 'SD' | null) => {
    const key = merged.mergedKey;
    if (lengthChangeInFlightRef.current.has(key)) return;
    lengthChangeInFlightRef.current.add(key);
    const valueStr = value ?? '';
    const prevBg = merged.bgScene?.lengthChange ?? null;
    const prevAct = merged.actScene?.lengthChange ?? null;
    if (merged.bgScene?.id) useDataStore.getState().updateSceneByUuid(merged.bgScene.id, { lengthChange: value });
    if (merged.actScene?.id) useDataStore.getState().updateSceneByUuid(merged.actScene.id, { lengthChange: value });
    try {
      const targets: Array<{ uuid: string; prev: 'LD' | 'SD' | null }> = [];
      if (merged.bgScene?.id) targets.push({ uuid: merged.bgScene.id, prev: prevBg });
      if (merged.actScene?.id) targets.push({ uuid: merged.actScene.id, prev: prevAct });
      const results = await Promise.allSettled(
        targets.map((t) =>
          window.electronAPI?.supabaseUpdateSceneField?.(t.uuid, 'lengthChange', valueStr) ?? Promise.resolve(),
        ),
      );
      const anyFailed = results.some((r) => r.status === 'rejected');
      if (!anyFailed) return;

      // BG/ACT sync 보존: 둘 다 prev 로 UI 롤백
      for (const t of targets) {
        useDataStore.getState().updateSceneByUuid(t.uuid, { lengthChange: t.prev });
      }
      // 성공한 DB 호출은 best-effort reverse
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          const t = targets[i];
          const prevStr = t.prev ?? '';
          window.electronAPI?.supabaseUpdateSceneField?.(t.uuid, 'lengthChange', prevStr)
            .catch((err) => console.error(`[lengthChange] 시트 reverse 실패 ${t.uuid}`, err));
        } else {
          console.error(`[lengthChange] 시트 ${targets[i].uuid} 저장 실패`, result.reason);
        }
      });
    } finally {
      lengthChangeInFlightRef.current.delete(key);
    }
  }, []);
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
  // v1.16.0: BG메모(0) / ACT메모(1) / BG담당(2) / ACT담당(3) — 메모 컬럼 분리
  const saveField = useCallback((row: number, col: number, value: string) => {
    const m = displayScenes[row];
    if (!m) return;
    const fieldDef = EDITABLE_FIELDS[col];
    if (fieldDef === 'bgMemo') {
      if (m.bgScene && bgSheetName) onFieldUpdate(bgSheetName, m.bgSceneIndex, 'memo', value);
    } else if (fieldDef === 'actMemo') {
      if (m.actScene && actSheetName) onFieldUpdate(actSheetName, m.actSceneIndex, 'memo', value);
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
    if (fieldDef === 'bgMemo') return m.bgScene?.memo || '';
    if (fieldDef === 'actMemo') return m.actScene?.memo || '';
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
      className="unified-scene-sheet"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      <div
        ref={tableRef}
        tabIndex={0}
        className="overflow-y-auto overflow-x-hidden rounded-lg border border-bg-border focus:outline-none"
        onKeyDown={handleTableKeyDown}
        onMouseUp={() => setIsDragging(false)}
        style={{ userSelect: isDragging ? 'none' : undefined }}
      >
        <table
          className="text-sm border-collapse"
          style={{ tableLayout: 'fixed', width: sheetWidth }}
        >
          <colgroup>
            {UNIFIED_SHEET_COLUMNS.map((column) => (
              <col key={column.key} style={{ width: displayWidthOf(column.key) }} />
            ))}
          </colgroup>
          {/* ── 헤더 ── */}
          <thead className="sticky top-0 z-10">
            {/* 부서 구분 서브헤더 (상단) — v1.16.0: 메모 컬럼 분리에 맞춰 colSpan 조정 (2→3)
                v1.16.0 fix (Codex 라운드 8): layout 모드 분기 제거 — 본문/두 번째 헤더는 18칸인데
                여기만 19칸이 되어 sticky 2단 헤더 정렬이 깨졌음. 한솔 결정 1-B 에 따라 컬럼 수는
                일반 모드와 동일하므로 별도 분기 불필요. */}
            <tr className="bg-bg-card border-b border-bg-border/50">
              <th colSpan={6} />
              <th colSpan={5} className="py-1 text-center">
                <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary/60">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: bgCfg.color }} />
                  {bgCfg.shortLabel}
                </span>
              </th>
              <th colSpan={5} className="py-1 text-center">
                <span className="inline-flex items-center gap-1 text-[10px] text-text-secondary/60">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: actCfg.color }} />
                  {actCfg.shortLabel}
                </span>
              </th>
              <th />
            </tr>
            <tr className="bg-bg-card border-b border-bg-border">
              {/* 한솔 결정 (1-B): 레이아웃 별 보기 시 별도 컬럼 대신 행 위에 그룹 헤더 행을 삽입.
                  sceneGroupMode === 'layout' 컬럼 분기 제거 — 컬럼 수가 일반 모드와 동일하게 유지된다.
                  v1.16.0: 메모 컬럼을 BG/ACT 두 개로 분리 (한솔 결정 B2). */}
              <ResizableHeaderCell columnKey="scene" width={displayWidthOf('scene')} onResizeStart={startResize} shortLabel="씬">씬번호</ResizableHeaderCell>
              <ResizableHeaderCell columnKey="alerts" width={displayWidthOf('alerts')} onResizeStart={startResize} align="center" className="px-1" />
              <ResizableHeaderCell
                columnKey="bgMemo"
                width={displayWidthOf('bgMemo')}
                rightBoundaryColumnKey="actMemo"
                rightBoundaryWidth={displayWidthOf('actMemo')}
                onResizeStart={startResize}
                onBoundaryResizeStart={startBoundaryResize}
                style={{ color: bgCfg.color }}
                shortLabel="BG"
              >
                BG 메모
              </ResizableHeaderCell>
              <ResizableHeaderCell
                columnKey="actMemo"
                width={displayWidthOf('actMemo')}
                leftBoundaryColumnKey="bgMemo"
                leftBoundaryWidth={displayWidthOf('bgMemo')}
                onResizeStart={startResize}
                onBoundaryResizeStart={startBoundaryResize}
                style={{ color: actCfg.color }}
                shortLabel="ACT"
              >
                ACT 메모
              </ResizableHeaderCell>
              <ResizableHeaderCell columnKey="storyboard" width={displayWidthOf('storyboard')} onResizeStart={startResize} align="center" shortLabel="SB">스토리보드</ResizableHeaderCell>
              <ResizableHeaderCell columnKey="guide" width={displayWidthOf('guide')} onResizeStart={startResize} align="center" shortLabel="Guide">가이드</ResizableHeaderCell>
              {/* BG 담당 + 스테이지 */}
              <ResizableHeaderCell columnKey="bgAssignee" width={displayWidthOf('bgAssignee')} onResizeStart={startResize} style={{ color: bgCfg.color }} shortLabel="BG담">
                BG담당
              </ResizableHeaderCell>
              {STAGES.map((s) => {
                const key = `bg${s[0].toUpperCase()}${s.slice(1)}` as UnifiedSheetColumnKey;
                return (
                  <ResizableHeaderCell
                    key={`bg-${s}`}
                    columnKey={key}
                    width={displayWidthOf(key)}
                    onResizeStart={startResize}
                    align="center"
                    className="px-1 text-[11px]"
                    style={{ color: bgCfg.stageColors[s] }}
                    shortLabel={BG_STAGE_SHORT_LABELS[s]}
                  >
                    {bgCfg.stageLabels[s]}
                  </ResizableHeaderCell>
                );
              })}
              {/* ACT 담당 + 스테이지 */}
              <ResizableHeaderCell columnKey="actAssignee" width={displayWidthOf('actAssignee')} onResizeStart={startResize} style={{ color: actCfg.color }} shortLabel="ACT담">
                ACT담당
              </ResizableHeaderCell>
              {/* v1.25.2~: 액팅 새 토글 핸들러가 전달되면 ACT 단계 4셀을 ScenePhaseToggle 1셀로 통합 */}
              {onActPhaseStateClick && onActFeedbackRequest && onActRoundBump ? (
                <th
                  colSpan={4}
                  className="px-1 py-2 text-center text-[11px] font-medium"
                  style={{ color: actCfg.color }}
                >
                  액팅 단계
                </th>
              ) : (
                STAGES.map((s) => {
                  const key = s === 'lo'
                    ? 'actWait'
                    : s === 'done'
                      ? 'actWork'
                      : s === 'review'
                        ? 'actFeedback'
                        : 'actDone';
                  return (
                    <ResizableHeaderCell
                      key={`act-${s}`}
                      columnKey={key}
                      width={displayWidthOf(key)}
                      onResizeStart={startResize}
                      align="center"
                      className="px-1 text-[11px]"
                      style={{ color: actCfg.stageColors[s] }}
                      shortLabel={ACT_STAGE_SHORT_LABELS[s]}
                    >
                      {actCfg.stageLabels[s]}
                    </ResizableHeaderCell>
                  );
                })
              )}
              <ResizableHeaderCell columnKey="actions" width={displayWidthOf('actions')} onResizeStart={startResize} align="center" className="px-1" />
            </tr>
          </thead>

          {/* ── 본문 ── */}
          <tbody>
            {displayScenes.map((m, rowIndex) => {
              const { sceneId, mergedKey, bgScene, actScene, bgSceneIndex, actSceneIndex } = m;
              const primary = bgScene ?? actScene;
              if (!primary) return null;

              const meta = layoutMeta.get(m);
              const isRowSelected = selectedSceneIds.has(`bg:${mergedKey}`) || selectedSceneIds.has(`act:${mergedKey}`);
              const isFirstInGroup = meta?.isFirst ?? false;
              const isLastInGroup = meta?.isLast ?? false;
              const groupSize = meta?.groupSize ?? 1;
              const layoutKey = meta?.layoutKey ?? '';
              const isLayoutMode = sceneGroupMode === 'layout';
              // 한솔 결정 (8번): 토스트 클릭 후 진입 시 해당 행 빛남
              const isHighlighted = !!highlightSceneId && (
                bgScene?.sceneId === highlightSceneId || actScene?.sceneId === highlightSceneId
              );

              const commentBadgeCounts = getMergedCommentBadgeCounts(
                m,
                bgSheetName,
                actSheetName,
                commentCounts,
                commentIdsByKey,
              );
              const bgCommentKey = bgScene && bgSheetName ? `${bgSheetName}:${bgScene.no}` : null;
              const actCommentKey = actScene && actSheetName ? `${actSheetName}:${actScene.no}` : null;
              const hasUnreadComments = Boolean(
                (bgCommentKey && commentUnreadByKey?.[bgCommentKey]) ||
                (actCommentKey && commentUnreadByKey?.[actCommentKey]),
              );

              // v1.16.0: 길이 변경 라벨 (BG/ACT 양쪽 동기화 정책 — BG 우선)
              const lengthChange = bgScene?.lengthChange ?? actScene?.lengthChange ?? null;

              // v1.18.0: 미해결 리비전 카운트 (행 좌측 막대 + 씬번호 셀 배지)
              const openRevCount = revisionCountByMergedKey.get(mergedKey) ?? 0;
              const isMergedComplete = !!bgScene && !!actScene && isFullyDone(bgScene) && isFullyDone(actScene);

              return (
                <Fragment key={mergedKey}>
                  {/* 한솔 결정 (1-B 시안 2 + 굵은 보더): 그룹 시작 위에 액센트 카드 박스 헤더 행 */}
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
                  <tr
                    className={cn(
                      'relative border-b border-bg-border/30 transition-colors group cursor-pointer',
                      rowIndex % 2 === 0 ? 'bg-bg-card/20' : 'bg-bg-primary/10',
                      'hover:bg-accent/5',
                      isRowSelected && 'bg-accent/10 hover:bg-accent/15',
                      searchQuery && 'bg-accent/5 border-l-2 border-l-accent/60',
                      isHighlighted && 'scene-row-highlighted',
                      isLayoutMode && !isLastInGroup && 'scene-row-group-mid',
                      isLayoutMode && isLastInGroup && 'scene-row-group-last',
                      lengthChange === 'LD' && 'sheet-row-length-up',
                      lengthChange === 'SD' && 'sheet-row-length-down',
                      completionTintEnabled && isMergedComplete && 'scene-completion-tint-row',
                      // v1.18.0: 미해결 리비전 행 — 액센트 좌측 강조 (셀 배지와 함께 시각적 anchor)
                      openRevCount > 0 && 'sheet-row-revision-open',
                    )}
                    onClick={(e) => {
                      if ((e.ctrlKey || e.metaKey) && onCtrlClick) {
                        onCtrlClick(mergedKey);
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
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu({ x: e.clientX, y: e.clientY, merged: m });
                    }}
                  >

                  {/* 씬번호 */}
                  <td className="px-2 py-1.5 font-mono text-xs relative" style={{ overflow: 'visible' }}>
                    <div className="flex min-w-0 items-center gap-1.5">
                      {lengthChange && (
                        <span
                          className={`length-symbol-sheet ${lengthChange === 'LD' ? 'up' : 'down'}`}
                          title={lengthChange === 'LD' ? 'LD · Long Duration (길이 늘어남)' : 'SD · Short Duration (길이 줄어듦)'}
                        >
                          <LengthIcon kind={lengthChange} size="sm" />
                        </span>
                      )}
                      <span className="scene-num-glow-wrap min-w-0">
                        <span className="scene-num-glow-text">
                          <HighlightText text={sceneId || primary.sceneId || '-'} query={searchQuery} />
                        </span>
                      </span>
                      {primary.layoutId && (
                        <span className="text-[11px] italic font-medium text-accent flex-shrink-0">
                          L#{primary.layoutId}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-1 py-1.5">
                    <SheetAlertBadges
                      revisionCount={openRevCount}
                      commentCount={commentBadgeCounts.total}
                      hasUnreadComments={hasUnreadComments}
                    />
                  </td>

                  {/* BG 메모 (인라인 편집, 한솔 결정 B2) */}
                  {bgScene ? (
                    <SheetEditableCell
                      value={bgScene.memo || ''}
                      field="bgMemo"
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
                  ) : (
                    <td className="px-2 py-1.5 text-xs text-text-secondary/20">—</td>
                  )}

                  {/* ACT 메모 (인라인 편집) */}
                  {actScene ? (
                    <SheetEditableCell
                      value={actScene.memo || ''}
                      field="actMemo"
                      onSave={(v) => saveField(rowIndex, 1, v)}
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

                  {/* 스토리보드 — BG 전용 (정책 통일) */}
                  <SheetThumbnailCell url={bgScene?.storyboardUrl} label="스토리보드" />

                  {/* 가이드 — BG 전용 */}
                  <SheetThumbnailCell url={bgScene?.guideUrl} label="가이드" />

                  {/* BG 담당자 (인라인 편집) — v1.16.0 col index 1→2 (메모 분리로 시프트) */}
                  {bgScene ? (
                    <SheetEditableCell
                      value={bgScene.assignee || ''}
                      field="bgAssignee"
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

                  {/* BG 스테이지 — ACT 단계와 같은 segmented track 구조 */}
                  <td colSpan={4} className="px-1 py-1.5">
                    {bgScene && bgSheetName ? (
                      <StageSegmentToggle
                        scene={bgScene}
                        department="bg"
                        compact
                        iconDisplay="never"
                        onToggle={(stage) => onToggle(bgSheetName, bgScene.sceneId, stage)}
                      />
                    ) : (
                      <span className="text-text-secondary/20 text-xs">—</span>
                    )}
                  </td>

                  {/* ACT 담당자 (인라인 편집) — v1.16.0 col index 2→3 (메모 분리로 시프트) */}
                  {actScene ? (
                    <SheetEditableCell
                      value={actScene.assignee || ''}
                      field="actAssignee"
                      onSave={(v) => saveField(rowIndex, 3, v)}
                      type="assignee"
                      searchQuery={searchQuery}
                      isSelected={selectedCells.has(cellKey(rowIndex, 3))}
                      isEditing={editingCell?.row === rowIndex && editingCell?.col === 3}
                      initialChar={editingCell?.row === rowIndex && editingCell?.col === 3 ? initialEditChar : undefined}
                      onMouseDown={(e) => handleCellMouseDown(rowIndex, 3, e)}
                      onMouseEnter={() => handleCellMouseEnter(rowIndex, 3)}
                      onStartEditing={() => handleStartEditing(rowIndex, 3)}
                      onStopEditing={handleStopEditing}
                    />
                  ) : (
                    <td className="px-2 py-1.5 text-xs text-text-secondary/20">—</td>
                  )}

                  {/* v1.25.2~: ACT 단계 — 새 토글 통합 (colspan=4) 또는 기존 4 boolean 체크박스 */}
                  {onActPhaseStateClick && onActFeedbackRequest && onActRoundBump ? (
                    <td colSpan={4} className="px-1 py-1.5">
                      {actScene && actSheetName ? (
                        <div onClick={(e) => e.stopPropagation()}>
                          <ScenePhaseToggle
                            scene={actScene}
                            compact
                            onStateClick={(next) => onActPhaseStateClick(actSheetName, actScene.sceneId, next)}
                            onRequestFeedback={() => onActFeedbackRequest(actSheetName, actScene.sceneId)}
                            onRoundBump={(kind, delta) => onActRoundBump(actSheetName, actScene.sceneId, kind, delta)}
                          />
                        </div>
                      ) : (
                        <span className="text-text-secondary/20 text-xs">—</span>
                      )}
                    </td>
                  ) : (
                    <td colSpan={4} className="px-1 py-1.5">
                      {actScene && actSheetName ? (
                        <StageSegmentToggle
                          scene={actScene}
                          department="acting"
                          compact
                          iconDisplay="never"
                          onToggle={(stage) => onToggle(actSheetName, actScene.sceneId, stage)}
                        />
                      ) : (
                        <span className="text-text-secondary/20 text-xs">—</span>
                      )}
                    </td>
                  )}

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
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* v1.16.0: 우클릭 컨텍스트 메뉴 — Portal 로 외부 렌더 (테이블 overflow/transform 영향 회피) */}
      {ctxMenu && createPortal(
        <SceneContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          current={ctxMenu.merged.bgScene?.lengthChange ?? ctxMenu.merged.actScene?.lengthChange ?? null}
          onSelect={(value) => handleSetLengthChange(ctxMenu.merged, value)}
          onClose={() => setCtxMenu(null)}
        />,
        document.body,
      )}
    </motion.div>
  );
}
