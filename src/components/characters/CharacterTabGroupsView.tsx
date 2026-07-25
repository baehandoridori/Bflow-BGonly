import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import type { Character, CharacterBoardTab, CharacterBoardTabGroup, CharacterCostume } from '@/types';
import { CharacterCard, EMPTY_COSTUMES } from '@/components/characters/CharacterCard';
import { CharacterListRow } from '@/components/characters/CharacterListRow';
import {
  addGroup, groupedCharacterIdSet, moveCharacterToGroup, removeGroup, renameGroup, reorderWithinGroup,
} from '@/utils/characterTabGroups';
import type { CharacterBoardViewMode } from '@/utils/characterViewPersist';
import { cn } from '@/utils/cn';

/**
 * 커스텀 탭 본문 (피드백 41) — 그룹 섹션 + 미분류 + 카드 드래그 배치.
 * 그룹 편집은 전부 onUpdateGroups(다음 groups 배열) 한 콜백으로 수렴 — store 의 탭 단위 LWW 낙관 갱신과 맞물린다.
 */
export function CharacterTabGroupsView({
  tab,
  characters,
  byCharacter,
  viewMode,
  searching,
  onOpen,
  onContextMenu,
  onUpdateGroups,
}: {
  tab: CharacterBoardTab;
  /** 검색 필터가 이미 적용된 표시 대상(활성 캐릭터) 목록 — 스토어 정렬 순서 유지. */
  characters: Character[];
  byCharacter: Map<string, CharacterCostume[]>;
  viewMode: CharacterBoardViewMode;
  /** 검색어·태그 필터가 걸린 상태 — 빈 섹션 문구를 "필터 때문"으로 구분해 보여준다. */
  searching: boolean;
  onOpen: (characterId: string, costumeId?: string) => void;
  onContextMenu: (characterId: string, event: ReactMouseEvent<HTMLButtonElement>, costumeId?: string) => void;
  onUpdateGroups: (groups: CharacterBoardTabGroup[]) => void;
}) {
  // 드롭이 카드 → 섹션으로 버블되며 두 번 처리되지 않도록 ref 로 동기 소거 (F29 의 draggingCardIdRef 와 같은 이유).
  const draggingIdRef = useRef<string | null>(null);
  const [draggingId, setDraggingIdState] = useState<string | null>(null);
  const setDragging = (id: string | null) => {
    draggingIdRef.current = id;
    setDraggingIdState(id);
  };

  const [addingGroup, setAddingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const byId = new Map(characters.map((c) => [c.id, c]));
  const grouped = groupedCharacterIdSet(tab.groups);
  // 미분류 = 표시 대상 중 어느 그룹에도 없는 캐릭터. (그룹에 남은 삭제된 캐릭터 id 는 byId 조회에서 자연 제외.)
  const ungrouped = characters.filter((c) => !grouped.has(c.id));

  const dragEnabled = viewMode !== 'list';

  const dropOnGroup = (groupId: string | null) => {
    const dragId = draggingIdRef.current;
    if (!dragId) return;
    setDragging(null);
    onUpdateGroups(moveCharacterToGroup(tab.groups, dragId, groupId));
  };
  const dropOnCard = (groupId: string | null, targetId: string) => {
    const dragId = draggingIdRef.current;
    if (!dragId) return;
    setDragging(null);
    if (dragId === targetId) return;
    if (groupId === null) {
      onUpdateGroups(moveCharacterToGroup(tab.groups, dragId, null));
      return;
    }
    let next = moveCharacterToGroup(tab.groups, dragId, groupId);
    next = reorderWithinGroup(next, groupId, dragId, targetId);
    onUpdateGroups(next);
  };

  const commitAddGroup = () => {
    const name = groupDraft.trim();
    if (name) onUpdateGroups(addGroup(tab.groups, name));
    setGroupDraft('');
    setAddingGroup(false);
  };
  const commitRename = () => {
    const name = editDraft.trim();
    if (editingGroupId && name) onUpdateGroups(renameGroup(tab.groups, editingGroupId, name));
    setEditingGroupId(null);
    setEditDraft('');
  };

  const gridClass = viewMode === 'list'
    ? 'flex flex-col gap-1.5'
    : viewMode === 'compact'
      ? 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3'
      : 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4';

  const renderEntry = (groupId: string | null) => (c: Character) =>
    viewMode === 'list' ? (
      <CharacterListRow
        key={c.id}
        character={c}
        costumes={byCharacter.get(c.id) ?? EMPTY_COSTUMES}
        onOpen={onOpen}
        onContextMenu={onContextMenu}
      />
    ) : (
      <CharacterCard
        key={c.id}
        character={c}
        costumes={byCharacter.get(c.id) ?? EMPTY_COSTUMES}
        onOpen={onOpen}
        onContextMenu={onContextMenu}
        compact={viewMode === 'compact'}
        onDragStartCard={dragEnabled ? setDragging : undefined}
        onDropCard={dragEnabled ? (targetId) => dropOnCard(groupId, targetId) : undefined}
        onDragEndCard={dragEnabled ? () => setDragging(null) : undefined}
        dragging={draggingId === c.id}
      />
    );

  const section = (group: CharacterBoardTabGroup | null) => {
    const members = group
      ? group.characterIds.map((id) => byId.get(id)).filter((c): c is Character => Boolean(c))
      : ungrouped;
    return (
      <section
        key={group?.id ?? '__ungrouped__'}
        onDragOver={dragEnabled ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
        onDrop={dragEnabled ? (e) => { e.preventDefault(); dropOnGroup(group?.id ?? null); } : undefined}
        className={cn('rounded-xl border border-bg-border/60 p-3 flex flex-col gap-3', draggingId && 'border-accent/40')}
      >
        <header className="flex items-center gap-2">
          {group && editingGroupId === group.id ? (
            <input
              autoFocus
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setEditingGroupId(null); setEditDraft(''); }
              }}
              onBlur={commitRename}
              className="bg-transparent border border-bg-border rounded-md px-2 py-1 text-sm text-text-primary outline-none focus:border-accent/50"
            />
          ) : (
            <span className="text-sm font-semibold text-text-primary">{group ? group.name : '미분류'}</span>
          )}
          <span className="text-xs text-text-secondary">{members.length}</span>
          {group && editingGroupId !== group.id && (
            <>
              <button
                type="button"
                aria-label={`${group.name} 이름 바꾸기`}
                onClick={() => { setEditingGroupId(group.id); setEditDraft(group.name); }}
                className="rounded p-1 text-text-secondary hover:text-text-primary hover:bg-bg-border/30 cursor-pointer"
              >
                <Pencil size={12} />
              </button>
              {confirmDeleteId === group.id ? (
                <span className="flex items-center gap-1 text-xs">
                  <span className="text-text-secondary">그룹을 삭제할까요? (캐릭터는 미분류로)</span>
                  <button
                    type="button"
                    onClick={() => { onUpdateGroups(removeGroup(tab.groups, group.id)); setConfirmDeleteId(null); }}
                    className="rounded px-1.5 py-0.5 hover:bg-bg-border/30 cursor-pointer"
                    style={{ color: 'var(--status-error)' }}
                  >
                    삭제
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-border/30 cursor-pointer">
                    취소
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`${group.name} 삭제`}
                  onClick={() => setConfirmDeleteId(group.id)}
                  className="rounded p-1 text-text-secondary hover:text-text-primary hover:bg-bg-border/30 cursor-pointer"
                >
                  <X size={12} />
                </button>
              )}
            </>
          )}
        </header>
        {members.length === 0 ? (
          <div className="rounded-lg border border-dashed border-bg-border/70 px-3 py-6 text-center text-xs text-text-secondary">
            {searching ? '검색·필터 조건에 맞는 캐릭터가 여기 없어요' : group ? '카드를 끌어다 놓아 배치해요' : '모든 캐릭터가 그룹에 배치됐어요'}
          </div>
        ) : (
          <div className={gridClass}>{members.map(renderEntry(group?.id ?? null))}</div>
        )}
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {tab.groups.map((g) => section(g))}
      {section(null)}
      {addingGroup ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={groupDraft}
            onChange={(e) => setGroupDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAddGroup();
              if (e.key === 'Escape') { setAddingGroup(false); setGroupDraft(''); }
            }}
            placeholder="그룹 이름"
            className="bg-transparent border border-bg-border rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50"
          />
          <button type="button" aria-label="그룹 추가 확정" onClick={commitAddGroup} className="rounded-lg bg-accent px-3 py-2 text-sm text-white hover:opacity-90 cursor-pointer">
            <Check size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddingGroup(true)}
          className="self-start flex items-center gap-1.5 rounded-lg border border-dashed border-bg-border px-3 py-2 text-sm text-text-secondary hover:border-accent/50 hover:text-text-primary cursor-pointer"
        >
          <Plus size={14} /> 그룹 추가
        </button>
      )}
    </div>
  );
}
