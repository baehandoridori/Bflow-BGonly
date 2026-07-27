/**
 * 캐릭터 현황판.
 *
 * - 캐릭터 카드 그리드(이름 검색 + 태그 AND 필터) + 에피소드 에셋 탭.
 * - 카드 클릭 → 전체화면급 오버레이 모달: 좌측 캐릭터 목록 / 우측 상세(마스터-디테일).
 *   상세 = 큰 대표 이미지(클릭=크게보기, 별도 버튼으로 교체) + 복장명·메모 + 복장 썸네일 갤러리
 *          + 버전·담당자 + 디자인/리깅 단계 레일 + 구조/에셋 태그(태그별 고유색).
 *
 * 모든 변경은 낙관적 업데이트 + 실시간 동기화 (useCharacterBoardStore).
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Archive, ChevronDown, Plus, Image as ImageIcon, Search, Ruler, LayoutGrid, Grid3x3, List, ExternalLink, X } from 'lucide-react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { moveCostumeInOrder, dropEdgeFor } from '@/stores/characterBoardStoreHelpers';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/utils/cn';
import { EpisodeAssetBoard } from './EpisodeAssetBoard';
import { CharacterImageContextMenu } from '@/components/characters/CharacterImageContextMenu';
import { TagPill } from '@/components/characters/TagChips';
import { CharacterCard, EMPTY_COSTUMES } from '@/components/characters/CharacterCard';
import { CharacterDetailModal } from '@/components/characters/CharacterDetailModal';
import { AddCharacterModal } from '@/components/characters/AddCharacterModal';
import { loadPersistedCharacterViewMode, savePersistedCharacterViewMode, loadPersistedTagsFolded, savePersistedTagsFolded, type CharacterBoardViewMode } from '@/utils/characterViewPersist';
import { CharacterListRow } from '@/components/characters/CharacterListRow';
import { IsPopupContext } from '@/components/widgets/Widget';
import { CharacterTabGroupsView } from '@/components/characters/CharacterTabGroupsView';
import type { CharacterBoardTab } from '@/types';

type BoardTab = 'board' | 'episode-assets';

/** 보기 방식 토글 옵션 (피드백 40). */
const VIEW_MODE_OPTIONS: { mode: CharacterBoardViewMode; label: string; Icon: typeof LayoutGrid }[] = [
  { mode: 'card', label: '카드 보기', Icon: LayoutGrid },
  { mode: 'compact', label: '이미지 없는 카드 보기', Icon: Grid3x3 },
  { mode: 'list', label: '리스트 보기', Icon: List },
];

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer', active ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/40')}
    >
      {children}
    </button>
  );
}

/** 사용자 정의 탭 스트립 (피드백 41) — '전체' + 사용자 탭 + 추가. 이름 변경=더블클릭, 삭제=활성 탭 X → 2단계 확인. */
function BoardTabStrip({ tabs, activeTabId, onSelect, onAdd, onRename, onDelete }: {
  tabs: CharacterBoardTab[];
  activeTabId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const commitAdd = () => {
    const name = draft.trim();
    if (name) onAdd(name);
    setDraft('');
    setAdding(false);
  };
  const commitRename = () => {
    const name = editDraft.trim();
    if (editingId && name) onRename(editingId, name);
    setEditingId(null);
    setEditDraft('');
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn('px-2.5 py-1 rounded-full text-xs border transition-colors cursor-pointer',
          activeTabId === null ? 'border-accent bg-accent/15 text-accent' : 'border-bg-border text-text-secondary hover:text-text-primary')}
      >
        전체
      </button>
      {tabs.map((t) => (
        editingId === t.id ? (
          <input
            key={t.id}
            autoFocus
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); }
            }}
            onBlur={commitRename}
            className="w-28 bg-transparent border border-accent/50 rounded-full px-2.5 py-1 text-xs text-text-primary outline-none"
          />
        ) : (
          <span key={t.id} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              onDoubleClick={() => { setEditingId(t.id); setEditDraft(t.name); }}
              title="더블클릭하면 이름을 바꿔요"
              className={cn('px-2.5 py-1 rounded-full text-xs border transition-colors cursor-pointer',
                activeTabId === t.id ? 'border-accent bg-accent/15 text-accent' : 'border-bg-border text-text-secondary hover:text-text-primary')}
            >
              {t.name}
            </button>
            {activeTabId === t.id && (
              confirmDeleteId === t.id ? (
                <span className="ml-1 flex items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => { onDelete(t.id); setConfirmDeleteId(null); }}
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
                  aria-label={`${t.name} 탭 삭제`}
                  onClick={() => setConfirmDeleteId(t.id)}
                  className="ml-0.5 rounded p-1 text-text-secondary hover:text-text-primary hover:bg-bg-border/30 cursor-pointer"
                >
                  <X size={11} />
                </button>
              )
            )}
          </span>
        )
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitAdd();
            if (e.key === 'Escape') { setAdding(false); setDraft(''); }
          }}
          onBlur={commitAdd}
          placeholder="탭 이름"
          className="w-28 bg-transparent border border-bg-border rounded-full px-2.5 py-1 text-xs text-text-primary outline-none focus:border-accent/50"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-full border border-dashed border-bg-border px-2.5 py-1 text-xs text-text-secondary hover:border-accent/50 hover:text-text-primary cursor-pointer"
        >
          <Plus size={11} /> 탭
        </button>
      )}
    </div>
  );
}

function CharacterGrid({ onAdd, pendingOpenId, onConsumeOpen }: { onAdd: () => void; pendingOpenId?: string | null; onConsumeOpen?: () => void }) {
  const characters = useCharacterBoardStore((s) => s.characters);
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const loaded = useCharacterBoardStore((s) => s.loaded);
  const loadError = useCharacterBoardStore((s) => s.loadError);
  const reload = useCharacterBoardStore((s) => s.load);
  const tabs = useCharacterBoardStore((s) => s.tabs);
  const addTab = useCharacterBoardStore((s) => s.addTab);
  const renameTab = useCharacterBoardStore((s) => s.renameTab);
  const deleteTab = useCharacterBoardStore((s) => s.deleteTab);
  const updateTabGroups = useCharacterBoardStore((s) => s.updateTabGroups);

  const [detailRequest, setDetailRequest] = useState<{ id: string; nonce: number; costumeId?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [cardMenu, setCardMenu] = useState<{ characterId: string; x: number; y: number; costumeId?: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [heightCompareMode, setHeightCompareMode] = useState(false); // '키 비교 보기'(T2-3)
  // 보기 방식 (피드백 40) — 마지막 선택을 localStorage 에 영속화(씬 뷰 scenesViewPersist 패턴).
  const [viewMode, setViewMode] = useState<CharacterBoardViewMode>(() => loadPersistedCharacterViewMode() ?? 'card');
  const changeViewMode = (mode: CharacterBoardViewMode) => {
    setViewMode(mode);
    savePersistedCharacterViewMode(mode);
  };
  // 태그 필터 행 접기 — 마지막 상태를 localStorage 에 영속화.
  const [tagsFolded, setTagsFolded] = useState<boolean>(() => loadPersistedTagsFolded() ?? false);
  const changeTagsFolded = (folded: boolean) => {
    setTagsFolded(folded);
    savePersistedTagsFolded(folded);
  };
  // 사용자 정의 탭 (피드백 41). null = '전체'. 다른 사용자가 탭을 지우면 자동으로 '전체'로 복귀.
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) ?? null : null;
  useEffect(() => {
    if (activeTabId && !activeTab) setActiveTabId(null);
  }, [activeTabId, activeTab]);

  const detailCharacter = useMemo(() => characters.find((c) => c.id === detailRequest?.id) ?? null, [characters, detailRequest?.id]);
  useEffect(() => { if (detailRequest && !detailCharacter) setDetailRequest(null); }, [detailRequest, detailCharacter]);

  // 에피소드 에셋 탭의 '캐릭터 현황판에서 보기' → 해당 캐릭터 상세 자동 오픈.
  useEffect(() => {
    if (pendingOpenId) {
      const pendingCharacter = characters.find((c) => c.id === pendingOpenId);
      if (pendingCharacter?.status === 'archived') setShowArchived(true);
      setDetailRequest((prev) => ({ id: pendingOpenId, nonce: (prev?.nonce ?? 0) + 1 }));
      onConsumeOpen?.();
    }
  }, [characters, pendingOpenId, onConsumeOpen]);

  const activeCharacters = useMemo(() => characters.filter((c) => c.status !== 'archived'), [characters]);
  const archivedCharacters = useMemo(() => characters.filter((c) => c.status === 'archived'), [characters]);
  const visibleCharacters = showArchived ? archivedCharacters : activeCharacters;

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const arr of byCharacter.values()) for (const c of arr) { for (const t of c.structureTags) set.add(t); for (const t of c.assetTags) set.add(t); }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [byCharacter]);

  function characterTags(characterId: string): Set<string> {
    const set = new Set<string>();
    for (const c of byCharacter.get(characterId) ?? []) { for (const t of c.structureTags) set.add(t); for (const t of c.assetTags) set.add(t); }
    return set;
  }

  // 피드백 41-4: 탭·그룹 이름을 검색 색인으로 — 이름이 일치하는 탭/그룹에 배치된 캐릭터도 검색에 걸린다.
  const indexedIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const ids = new Set<string>();
    for (const t of tabs) {
      const tabHit = t.name.toLowerCase().includes(q);
      for (const g of t.groups) {
        if (tabHit || g.name.toLowerCase().includes(q)) for (const id of g.characterIds) ids.add(id);
      }
    }
    return ids;
  }, [tabs, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleCharacters.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !indexedIds?.has(c.id)) return false;
      if (activeTags.length > 0) { const tags = characterTags(c.id); if (!activeTags.every((t) => tags.has(t))) return false; }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCharacters, query, activeTags, byCharacter, indexedIds]);
  // 키 비교 보기: 가시 캐릭터 중 기준 키 최댓값을 300px 에 매핑, 나머지는 비례(clamp 90~300). 미설정은 기본 170.
  const maxReferenceHeight = useMemo(() => {
    let m = 0;
    for (const c of filtered) if (c.referenceHeightPx && c.referenceHeightPx > m) m = c.referenceHeightPx;
    return m;
  }, [filtered]);

  // 키 비교 모드에서는 실제 키 라인업이 되도록 기준 키 오름차순 정렬(미설정은 뒤로). 일반 모드는 기존 순서.
  const displayCharacters = useMemo(() => {
    if (!heightCompareMode) return filtered;
    return filtered.slice().sort((a, b) => {
      const ha = a.referenceHeightPx;
      const hb = b.referenceHeightPx;
      if (ha == null && hb == null) return 0;
      if (ha == null) return 1;
      if (hb == null) return -1;
      return ha - hb;
    });
  }, [filtered, heightCompareMode]);

  // 삽입선 방향 계산용 순서(id 배열). 드래그 가능 화면에선 필터가 없어 displayCharacters 가 실제 재배치 순서와 상대 순서가 같다.
  const cardOrderIds = useMemo(() => displayCharacters.map((c) => c.id), [displayCharacters]);

  const cardMenuCharacter = cardMenu ? characters.find((c) => c.id === cardMenu.characterId) ?? null : null;
  const cardMenuCostumes = cardMenuCharacter ? byCharacter.get(cardMenuCharacter.id) ?? [] : [];
  // 카드에서 휠로 넘겨 보던 복장이 있으면 그 복장을 우클릭 메뉴 대상(이미지 복사 등)으로 우선한다 (B8).
  const cardMenuWheeled = cardMenu?.costumeId ? cardMenuCostumes.find((c) => c.id === cardMenu.costumeId) ?? null : null;
  const cardMenuFeatured = (cardMenuWheeled?.featuredImageUrl ? cardMenuWheeled : cardMenuCostumes.find((c) => c.featuredImageUrl)) ?? null;
  const cardMenuFileCostume = cardMenuFeatured?.workFilePath
    ? cardMenuFeatured
    : cardMenuCostumes.find((c) => c.workFilePath) ?? null;

  function toggleTag(tag: string) {
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  // CharacterCard(memo) 용 안정 콜백 — 그리드 map 안 캐릭터별 인라인 클로저는 memo 를 무력화한다 (CQ-6).
  const openCharacterDetail = useCallback((characterId: string, costumeId?: string) => {
    setDetailRequest((prev) => ({ id: characterId, nonce: (prev?.nonce ?? 0) + 1, costumeId }));
  }, []);
  const openCardContextMenu = useCallback((characterId: string, event: ReactMouseEvent<HTMLButtonElement>, costumeId?: string) => {
    event.preventDefault();
    setCardMenu({ characterId, x: event.clientX, y: event.clientY, costumeId });
  }, []);

  // ─── 카드 드래그 재배치(F29) ───
  const reorderCharacters = useCharacterBoardStore((s) => s.reorderCharacters);
  // 검색/태그 필터·키 비교·보관 목록에서는 비활성 (파생 정렬/부분 목록 위 재배치는 비직관적).
  const cardDragEnabled = viewMode !== 'list' && !showArchived && !heightCompareMode && !query.trim() && activeTags.length === 0;
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const draggingCardIdRef = useRef<string | null>(null); // drop 시 stale closure 회피 — 복장 드래그와 동일 ref 병행 패턴.
  const handleCardDragStart = useCallback((id: string) => {
    draggingCardIdRef.current = id;
    setDraggingCardId(id);
  }, []);
  const handleCardDragOver = useCallback((id: string) => {
    setDropTargetId((prev) => (prev === id ? prev : id));
  }, []);
  const handleCardDragEnd = useCallback(() => {
    draggingCardIdRef.current = null;
    setDraggingCardId(null);
    setDropTargetId(null);
  }, []);
  const handleCardDrop = useCallback((targetId: string) => {
    const dragId = draggingCardIdRef.current;
    draggingCardIdRef.current = null;
    setDraggingCardId(null);
    setDropTargetId(null);
    if (!dragId || dragId === targetId) return;
    // 전체 characters 배열 기준으로 이동 계산 — active/archived 가 같은 sort_order 공간을 쓰므로 전 구간 재부여로 중복 방지.
    const allIds = useCharacterBoardStore.getState().characters.map((c) => c.id);
    void reorderCharacters(moveCostumeInOrder(allIds, dragId, targetId));
  }, [reorderCharacters]);

  if (!loaded) {
    if (loadError) {
      return (
        <div className="mt-4 flex flex-col items-center justify-center gap-3 h-40 text-center">
          <span className="text-sm text-text-secondary">캐릭터 현황판을 불러오지 못했어요.</span>
          <button
            type="button"
            onClick={() => { void reload(); }}
            className="px-3 py-1.5 rounded-lg border border-bg-border text-xs text-text-primary hover:border-accent/50 hover:bg-bg-border/30 transition-colors cursor-pointer"
          >
            다시 시도
          </button>
        </div>
      );
    }
    return (
      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="overflow-hidden rounded-xl border border-bg-border bg-bg-card">
            <div className="aspect-[3/4] bg-bg-border/30 animate-pulse motion-reduce:animate-none" />
            <div className="space-y-2 p-3">
              <div className="h-4 w-3/4 rounded bg-bg-border/40 animate-pulse motion-reduce:animate-none" />
              <div className="h-3 w-1/2 rounded bg-bg-border/30 animate-pulse motion-reduce:animate-none" />
              <div className="flex gap-1.5">
                <div className="h-5 w-16 rounded-md bg-bg-border/30 animate-pulse motion-reduce:animate-none" />
                <div className="h-5 w-14 rounded-md bg-bg-border/30 animate-pulse motion-reduce:animate-none" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 검색·버튼·필터 칩 — 스크롤해도 상단에 붙는다 (피드백 38). 배경은 토큰 기반이라 라이트/다크 자동 대응. */}
      <div className="sticky top-0 z-20 -mx-6 bg-bg-primary/85 px-6 pt-4 pb-3 backdrop-blur-md flex flex-col gap-2.5">
        {/* 사용자 정의 탭 (피드백 41) */}
        <BoardTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={(id) => { setActiveTabId(id); if (id !== null) { setHeightCompareMode(false); setShowArchived(false); } }}
          onAdd={(name) => void addTab(name).then((t) => { if (t) setActiveTabId(t.id); })}
          onRename={(id, name) => void renameTab(id, name)}
          onDelete={(id) => void deleteTab(id)}
        />
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative w-full max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름으로 검색" className="w-full bg-bg-card border border-bg-border rounded-lg pl-8 pr-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50" />
          </div>
          <div className="flex items-center gap-1.5">
            {/* 보기 방식 토글 (피드백 40) — 카드 / 이미지 없는 카드 / 리스트. 키 비교 중에는 카드형 고정이라 비활성.
                pointer-events-none 을 쓰면 hover 가 막혀 안내 title 이 영영 안 뜬다 — disabled 로 클릭만 막는다. */}
            <div
              role="group"
              aria-label="보기 방식"
              title={heightCompareMode ? '키 비교 보기 중에는 카드 보기로 고정돼요' : undefined}
              className={cn('flex items-center rounded-lg border border-bg-border p-0.5 shrink-0', heightCompareMode && 'opacity-45')}
            >
              {VIEW_MODE_OPTIONS.map(({ mode, label, Icon }) => (
                <button
                  key={mode}
                  type="button"
                  aria-label={label}
                  title={heightCompareMode ? undefined : label}
                  disabled={heightCompareMode}
                  onClick={() => changeViewMode(mode)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer disabled:cursor-default',
                    viewMode === mode && !heightCompareMode ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setHeightCompareMode((v) => !v); setActiveTabId(null); }}
              title="캐릭터를 기준 키(px)에 맞춰 크기 비교로 나열해요"
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors shrink-0 cursor-pointer',
                heightCompareMode
                  ? 'border-accent/50 bg-accent/15 text-accent'
                  : 'border-bg-border text-text-secondary hover:border-text-secondary/40 hover:text-text-primary',
              )}
            >
              <Ruler size={15} /> 키 비교 보기
            </button>
            {archivedCharacters.length > 0 && (
              <button
                type="button"
                onClick={() => { setShowArchived((value) => !value); setActiveTabId(null); }}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors shrink-0 cursor-pointer',
                  showArchived
                    ? 'border-accent/50 bg-accent/15 text-accent'
                    : 'border-bg-border text-text-secondary hover:border-text-secondary/40 hover:text-text-primary',
                )}
              >
                <Archive size={15} /> 보관 {archivedCharacters.length}
              </button>
            )}
            <button type="button" onClick={onAdd} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90 shrink-0 cursor-pointer">
              <Plus size={16} /> 캐릭터 추가
            </button>
          </div>
        </div>
        {allTags.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => changeTagsFolded(!tagsFolded)}
              aria-expanded={!tagsFolded}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
            >
              <ChevronDown size={13} className={cn('transition-transform duration-200 motion-reduce:transition-none', tagsFolded && '-rotate-90')} />
              태그 필터 <span className="font-semibold text-text-primary">{allTags.length}</span>
              {activeTags.length > 0 && <span className="text-accent">· {activeTags.length}개 선택</span>}
            </button>
            <div
              className={cn(
                'flex flex-wrap items-center gap-1.5 overflow-hidden transition-[max-height,opacity,margin-top] duration-200 ease-out motion-reduce:transition-none',
                tagsFolded ? 'mt-0 max-h-0 opacity-0' : 'mt-2 max-h-64 opacity-100',
              )}
            >
              {allTags.map((t) => <TagPill key={t} tag={t} on={activeTags.includes(t)} onClick={() => toggleTag(t)} />)}
              {activeTags.length > 0 && (
                <button type="button" onClick={() => setActiveTags([])} className="text-xs text-text-secondary hover:text-text-primary px-1.5 cursor-pointer">필터 해제</button>
              )}
            </div>
          </div>
        )}
      </div>

      {activeTab && !heightCompareMode && !showArchived ? (
        <CharacterTabGroupsView
          tab={activeTab}
          characters={filtered}
          byCharacter={byCharacter}
          viewMode={viewMode}
          searching={Boolean(query.trim()) || activeTags.length > 0}
          onOpen={openCharacterDetail}
          onContextMenu={openCardContextMenu}
          onUpdateGroups={(groups) => void updateTabGroups(activeTab.id, groups)}
        />
      ) : visibleCharacters.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-text-secondary">
          <ImageIcon size={28} className="opacity-35" />
          <div className="text-sm">
            {showArchived ? '보관된 캐릭터가 없어요.' : '아직 캐릭터가 없습니다.'}
          </div>
          {!showArchived && (
            <button type="button" onClick={onAdd} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm text-white hover:opacity-90">
              <Plus size={15} /> 캐릭터 추가
            </button>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-text-secondary">
          <Search size={24} className="opacity-45" />
          <div className="text-sm">조건에 맞는 캐릭터가 없어요.</div>
          <button
            type="button"
            onClick={() => { setQuery(''); setActiveTags([]); }}
            className="rounded-lg border border-bg-border px-3 py-2 text-sm text-text-primary hover:border-accent/50 hover:bg-bg-border/30"
          >
            검색·필터 초기화
          </button>
        </div>
      ) : (
        <div className={heightCompareMode
          ? 'flex flex-wrap items-end gap-4'
          : viewMode === 'list'
            ? 'flex flex-col gap-1.5'
            : viewMode === 'compact'
              ? 'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3'
              : 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4'}>
          {displayCharacters.map((c) => (
            !heightCompareMode && viewMode === 'list' ? (
              <CharacterListRow
                key={c.id}
                character={c}
                costumes={byCharacter.get(c.id) ?? EMPTY_COSTUMES}
                onOpen={openCharacterDetail}
                onContextMenu={openCardContextMenu}
              />
            ) : (
              <CharacterCard
                key={c.id}
                character={c}
                costumes={byCharacter.get(c.id) ?? EMPTY_COSTUMES}
                onOpen={openCharacterDetail}
                onContextMenu={openCardContextMenu}
                compact={!heightCompareMode && viewMode === 'compact'}
                imageHeightPx={heightCompareMode
                  ? (c.referenceHeightPx && maxReferenceHeight
                      ? Math.max(90, Math.min(300, Math.round((300 * c.referenceHeightPx) / maxReferenceHeight)))
                      : 170)
                  : undefined}
                referenceUnset={heightCompareMode && !c.referenceHeightPx}
                onDragStartCard={cardDragEnabled ? handleCardDragStart : undefined}
                onDragOverCard={cardDragEnabled ? handleCardDragOver : undefined}
                onDropCard={cardDragEnabled ? handleCardDrop : undefined}
                onDragEndCard={cardDragEnabled ? handleCardDragEnd : undefined}
                dragging={draggingCardId === c.id}
                dropTarget={dropTargetId === c.id && draggingCardId !== c.id}
                dropEdge={cardDragEnabled && dropTargetId === c.id ? dropEdgeFor(cardOrderIds, draggingCardId, c.id) : null}
              />
            )
          ))}
        </div>
      )}

      {cardMenu && cardMenuCharacter && (
        <CharacterImageContextMenu
          variant="card"
          x={cardMenu.x}
          y={cardMenu.y}
          character={cardMenuCharacter}
          imageCostume={cardMenuFeatured}
          fileCostume={cardMenuFileCostume}
          onClose={() => setCardMenu(null)}
        />
      )}

      {detailCharacter && detailRequest && (
        <CharacterDetailModal
          key={`${detailCharacter.id}:${detailRequest.nonce}`}
          initialCharacterId={detailCharacter.id}
          initialCostumeId={detailRequest.costumeId}
          archivedMode={showArchived}
          filteredIds={query.trim() || activeTags.length > 0 ? filtered.map((c) => c.id) : undefined}
          onClose={() => setDetailRequest(null)}
        />
      )}
    </div>
  );
}

export function CharacterBoardView() {
  const ensureLoadedAndRealtime = useCharacterBoardStore((s) => s.ensureLoadedAndRealtime);
  const loaded = useCharacterBoardStore((s) => s.loaded);
  const pendingCharacterBoardRequest = useAppStore((s) => s.pendingCharacterBoardRequest);
  const setPendingCharacterBoardRequest = useAppStore((s) => s.setPendingCharacterBoardRequest);

  const [tab, setTab] = useState<BoardTab>('board');
  const [addOpen, setAddOpen] = useState(false);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  // 팝업 창 안에서는 "새 창으로" 버튼을 숨긴다 (피드백 36 — 팝업이 팝업을 또 열지 않게).
  const isPopup = useContext(IsPopupContext);

  useEffect(() => {
    const release = ensureLoadedAndRealtime();
    return () => { release(); };
  }, [ensureLoadedAndRealtime]);

  useEffect(() => {
    if (!pendingCharacterBoardRequest || !loaded) return;
    setTab('board');
    setPendingOpenId(pendingCharacterBoardRequest.characterId);
    setPendingCharacterBoardRequest(null);
  }, [loaded, pendingCharacterBoardRequest, setPendingCharacterBoardRequest]);

  // 미소비 딥링크 요청 청소는 useAppStore.setView(다른 뷰로 이동 시)와 goBackNavigation이 담당 —
  //   언마운트 cleanup 방식은 StrictMode 이중 마운트에서 정상 요청까지 지워 사용하지 않는다.

  return (
    <div className="h-full flex flex-col">
      {/* 제목·탭은 스크롤 밖 고정 영역 — 상단 메뉴가 항상 보인다 (피드백 38). */}
      <div className="px-6 pt-6 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-text-primary">캐릭터 현황판</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              {tab === 'board' ? '캐릭터별 복장 디자인·리깅 진행 상황' : '에피소드별 등장 캐릭터·이 편 주의점·복장'}
            </p>
          </div>
          {!isPopup && typeof window.electronAPI?.widgetOpenPopup === 'function' && (
            <button
              type="button"
              onClick={() => { void window.electronAPI?.widgetOpenPopup?.('character-board', '캐릭터 현황판'); }}
              title="캐릭터 현황판을 별도 창으로 열어요 — 다른 화면을 보면서 같이 쓸 수 있어요"
              className="flex items-center gap-1.5 rounded-lg border border-bg-border px-3 py-2 text-sm text-text-secondary hover:border-text-secondary/40 hover:text-text-primary shrink-0 cursor-pointer"
            >
              <ExternalLink size={15} /> 새 창으로
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 border-b border-bg-border pb-2">
          <TabButton active={tab === 'board'} onClick={() => setTab('board')}>캐릭터 현황판</TabButton>
          <TabButton active={tab === 'episode-assets'} onClick={() => setTab('episode-assets')}>에피소드 에셋</TabButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        {tab === 'board' ? (
          <CharacterGrid onAdd={() => setAddOpen(true)} pendingOpenId={pendingOpenId} onConsumeOpen={() => setPendingOpenId(null)} />
        ) : (
          <div className="pt-4">
            <EpisodeAssetBoard onOpenCharacter={(id) => { setTab('board'); setPendingOpenId(id); }} />
          </div>
        )}
      </div>

      {addOpen && (
        <AddCharacterModal
          onClose={() => setAddOpen(false)}
          onCreated={(c) => { setTab('board'); setPendingOpenId(c.id); }}
        />
      )}
    </div>
  );
}

export default CharacterBoardView;
