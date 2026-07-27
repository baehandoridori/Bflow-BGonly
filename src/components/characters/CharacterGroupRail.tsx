import { useState } from 'react';
import { ChevronsLeft, ChevronsRight, GripVertical, Plus } from 'lucide-react';
import { loadPersistedRailCollapsed, savePersistedRailCollapsed } from '@/utils/characterViewPersist';
import { cn } from '@/utils/cn';

export interface RailEntry {
  /** 그룹 id — 미분류는 null. */
  gid: string | null;
  name: string;
  /** 현재 표시 대상(검색 필터 적용) 기준 인원 수. */
  count: number;
}

/**
 * 그룹 레일 (확정 시안 A — 목업 참조).
 * - 그룹 목차: 순서·개수 상시 표시 + 현재 섹션 하이라이트 + 클릭 점프.
 * - 카드를 레일 항목에 드롭하면 그 그룹으로 배치(본문 스크롤 불필요).
 * - ⠿ 드래그로 그룹 순서 변경(미분류 위 드롭 = 맨 뒤로). '+ 그룹' 은 레일 최상단 고정.
 * - « 접기(52px) — width 트랜지션으로 본문 그리드가 부드럽게 리플로우. 접혀도 이니셜·개수·드롭·점프 유지.
 */
export function CharacterGroupRail({
  entries,
  activeKey,
  cardDragActive,
  onSelect,
  onAddGroup,
  onDropCharacter,
  onReorderGroup,
}: {
  entries: RailEntry[];
  /** 현재 스크롤 위치의 섹션 키(gid ?? '__ungrouped__'). */
  activeKey: string;
  /** 카드 드래그 진행 중 — 레일 항목을 드롭 대상으로 활성화. */
  cardDragActive: boolean;
  onSelect: (gid: string | null) => void;
  onAddGroup: (name: string) => void;
  onDropCharacter: (gid: string | null) => void;
  onReorderGroup: (groupId: string, beforeGroupId: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => loadPersistedRailCollapsed() ?? false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const toggle = () => {
    // 부수효과(저장)는 업데이터 밖에서 — StrictMode 이중 호출 시 중복 저장 방지.
    const next = !collapsed;
    setCollapsed(next);
    savePersistedRailCollapsed(next);
  };
  const commitAdd = () => {
    const name = draft.trim();
    if (name) onAddGroup(name);
    setDraft('');
    setAdding(false);
  };

  return (
    <aside
      className={cn(
        'sticky shrink-0 self-start flex flex-col overflow-hidden rounded-xl border border-bg-border bg-bg-card/60',
        'transition-[width] duration-200 ease-out motion-reduce:transition-none',
        collapsed ? 'w-[52px]' : 'w-52',
      )}
      style={{
        top: 'var(--board-sticky-h, 0px)',
        maxHeight: 'calc(100vh - var(--board-sticky-h, 0px) - 24px)',
      }}
    >
      <div className={cn('flex items-center gap-1.5 p-2', collapsed && 'flex-col')}>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? '그룹 레일 펼치기' : '그룹 레일 접기'}
          title={collapsed ? '그룹 레일 펼치기' : '그룹 레일 접기'}
          className="rounded-md p-1.5 text-text-secondary hover:text-text-primary hover:bg-bg-border/30 cursor-pointer"
        >
          {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
        </button>
        {!collapsed && <span className="whitespace-nowrap text-xs font-bold text-text-secondary">그룹 {entries.length - 1}</span>}
        <span className={cn('flex-1', collapsed && 'hidden')} />
        {adding && !collapsed ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAdd();
              if (e.key === 'Escape') { setAdding(false); setDraft(''); }
            }}
            onBlur={commitAdd}
            placeholder="그룹 이름"
            className="w-24 bg-transparent border border-accent/50 rounded-md px-2 py-1 text-xs text-text-primary outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => { if (collapsed) toggle(); setAdding(true); }}
            title="그룹 추가"
            className="flex items-center gap-1 rounded-md bg-accent px-2 py-1.5 text-xs font-semibold text-white hover:opacity-90 cursor-pointer"
          >
            <Plus size={12} />{!collapsed && <span>그룹 추가</span>}
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2 flex flex-col gap-0.5">
        {entries.map((ent) => {
          const key = ent.gid ?? '__ungrouped__';
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(ent.gid)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelect(ent.gid); }}
              onDragOver={(e) => {
                if (cardDragActive || (draggingGroupId && draggingGroupId !== ent.gid)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setOverKey(key);
                }
              }}
              onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
              onDrop={(e) => {
                e.preventDefault();
                setOverKey(null);
                if (draggingGroupId) onReorderGroup(draggingGroupId, ent.gid);
                else if (cardDragActive) onDropCharacter(ent.gid);
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-[13px] cursor-pointer select-none',
                collapsed && 'flex-col gap-0.5 px-1',
                activeKey === key && 'bg-accent/15 border-accent/40',
                overKey === key && (draggingGroupId ? 'border-t-2 border-t-accent' : 'bg-accent/20 border-accent'),
                activeKey !== key && overKey !== key && 'hover:bg-bg-border/25',
              )}
            >
              {ent.gid ? (
                <span
                  draggable
                  onDragStart={(e) => { e.stopPropagation(); setDraggingGroupId(ent.gid); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { setDraggingGroupId(null); setOverKey(null); }}
                  title="끌어서 그룹 순서 변경"
                  className={cn('cursor-grab text-text-secondary/60', collapsed && 'hidden')}
                >
                  <GripVertical size={12} />
                </span>
              ) : (
                <span className={cn('w-3', collapsed && 'hidden')} aria-hidden="true" />
              )}
              {/* 접혔을 때만 보이는 이니셜. cn 은 tailwind-merge 가 아니라 clsx 라
                  'hidden' + 'block' 을 함께 두면 Tailwind CSS 순서상 hidden 이 이긴다 —
                  형제 span 들과 같은 `!조건 && 'hidden'` 패턴으로 뒤집어야 실제로 보인다. */}
              <span className={cn('font-bold text-text-primary', !collapsed && 'hidden')} title={ent.name}>{ent.name.charAt(0)}</span>
              <span className={cn('min-w-0 flex-1 truncate font-semibold text-text-primary', collapsed && 'hidden')}>{ent.name}</span>
              <span className="text-[11px] tabular-nums text-text-secondary">{ent.count}</span>
            </div>
          );
        })}
      </div>
      {!collapsed && (
        <div className="border-t border-bg-border/60 px-2.5 py-2 text-[11px] leading-relaxed text-text-secondary">
          카드를 그룹 이름 위에 끌어다 놓으면 바로 배치돼요.
        </div>
      )}
    </aside>
  );
}
