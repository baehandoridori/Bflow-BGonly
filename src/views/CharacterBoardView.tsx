/**
 * 캐릭터 현황판.
 *
 * - 캐릭터 카드 그리드(이름 검색 + 태그 AND 필터) + 에피소드 에셋 탭.
 * - 카드 클릭 → 전체화면급 오버레이 모달: 좌측 캐릭터 목록 / 우측 상세(마스터-디테일).
 *   상세 = 큰 대표 이미지(클릭=크게보기, 별도 버튼으로 교체) + 복장명·메모 + 복장 썸네일 갤러리
 *          + 버전·담당자 + 디자인/리깅 단계 레일 + 구조/에셋 태그(태그별 고유색).
 *
 * 모든 변경은 낙관적 업데이트 + 실시간 동기화 (useCharacterBoardStore).
 * 접근 권한은 사이드바에서 게이팅 (useCharacterBoardAccess).
 */

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Archive, Plus, Image as ImageIcon, Search } from 'lucide-react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/utils/cn';
import { EpisodeAssetBoard } from './EpisodeAssetBoard';
import { CharacterImageContextMenu } from '@/components/characters/CharacterImageContextMenu';
import { TagPill } from '@/components/characters/TagChips';
import { CharacterCard, EMPTY_COSTUMES } from '@/components/characters/CharacterCard';
import { CharacterDetailModal } from '@/components/characters/CharacterDetailModal';
import { AddCharacterModal } from '@/components/characters/AddCharacterModal';

type BoardTab = 'board' | 'episode-assets';

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

function CharacterGrid({ onAdd, pendingOpenId, onConsumeOpen }: { onAdd: () => void; pendingOpenId?: string | null; onConsumeOpen?: () => void }) {
  const characters = useCharacterBoardStore((s) => s.characters);
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const loaded = useCharacterBoardStore((s) => s.loaded);
  const loadError = useCharacterBoardStore((s) => s.loadError);
  const reload = useCharacterBoardStore((s) => s.load);

  const [detailRequest, setDetailRequest] = useState<{ id: string; nonce: number; costumeId?: string } | null>(null);
  const [query, setQuery] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [cardMenu, setCardMenu] = useState<{ characterId: string; x: number; y: number; costumeId?: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleCharacters.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (activeTags.length > 0) { const tags = characterTags(c.id); if (!activeTags.every((t) => tags.has(t))) return false; }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleCharacters, query, activeTags, byCharacter]);
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

  if (!loaded) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 h-40 text-center">
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
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
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative w-full max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름으로 검색" className="w-full bg-bg-card border border-bg-border rounded-lg pl-8 pr-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50" />
          </div>
          <div className="flex items-center gap-1.5">
            {archivedCharacters.length > 0 && (
              <button
                type="button"
                onClick={() => setShowArchived((value) => !value)}
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
          <div className="flex flex-wrap items-center gap-1.5">
            {allTags.map((t) => <TagPill key={t} tag={t} on={activeTags.includes(t)} onClick={() => toggleTag(t)} />)}
            {activeTags.length > 0 && (
              <button type="button" onClick={() => setActiveTags([])} className="text-xs text-text-secondary hover:text-text-primary px-1.5 cursor-pointer">필터 해제</button>
            )}
          </div>
        )}
      </div>

      {visibleCharacters.length === 0 ? (
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {filtered.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              costumes={byCharacter.get(c.id) ?? EMPTY_COSTUMES}
              onOpen={openCharacterDetail}
              onContextMenu={openCardContextMenu}
            />
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
  const pendingCharacterAddRequest = useAppStore((s) => s.pendingCharacterAddRequest);
  const setPendingCharacterAddRequest = useAppStore((s) => s.setPendingCharacterAddRequest);

  const [tab, setTab] = useState<BoardTab>('board');
  const [addOpen, setAddOpen] = useState(false);
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

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

  // 사이드바 '+' 등에서 캐릭터 추가 창 열기 요청 — 데이터 로드와 무관(모달은 데이터 불필요).
  useEffect(() => {
    if (!pendingCharacterAddRequest) return;
    setTab('board');
    setAddOpen(true);
    setPendingCharacterAddRequest(false);
  }, [pendingCharacterAddRequest, setPendingCharacterAddRequest]);

  // 미소비 딥링크 요청 청소는 useAppStore.setView(다른 뷰로 이동 시)와 goBackNavigation이 담당 —
  //   언마운트 cleanup 방식은 StrictMode 이중 마운트에서 정상 요청까지 지워 사용하지 않는다.

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">캐릭터 현황판</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {tab === 'board' ? '캐릭터별 복장 디자인·리깅 진행 상황' : '에피소드별 등장 캐릭터·이 편 주의점·복장'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 border-b border-bg-border pb-2">
          <TabButton active={tab === 'board'} onClick={() => setTab('board')}>캐릭터 현황판</TabButton>
          <TabButton active={tab === 'episode-assets'} onClick={() => setTab('episode-assets')}>에피소드 에셋</TabButton>
        </div>
      </div>

      {tab === 'board' ? (
        <CharacterGrid onAdd={() => setAddOpen(true)} pendingOpenId={pendingOpenId} onConsumeOpen={() => setPendingOpenId(null)} />
      ) : (
        <EpisodeAssetBoard onOpenCharacter={(id) => { setTab('board'); setPendingOpenId(id); }} />
      )}

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
