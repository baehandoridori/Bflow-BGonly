/**
 * 에피소드 에셋 보드 — 캐릭터 현황판 안의 두 번째 탭.
 *
 * "이 에피소드에 누가 나오고, 이 편 주의점은 뭐고, 어떤 복장을 쓰며,
 *  그 캐릭터 리깅은 어디까지 됐나"를 마스터-디테일로 본다.
 *
 *   - 에피소드 선택 (useDataStore.episodes / getEpisodeDisplayName)
 *   - 좌측: 그 에피소드 등장 캐릭터 목록(썸네일 + 이름 + 이 편 복장 + 리깅 미니)
 *   - 우측: 선택 캐릭터 상세 — 대표 이미지, 이 편 복장 갤러리("이 편 사용"),
 *           주의점 메모, 태그(고유색), 리깅 상태(읽기전용 cross-ref) + "캐릭터 현황판에서 보기"
 *
 * 모든 편집은 낙관적 업데이트 (useCharacterBoardStore).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Search, User, ImageOff, ArrowRight, Check, Film } from 'lucide-react';
import { toast } from 'sonner';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { useDataStore } from '@/stores/useDataStore';
import {
  COSTUME_RIGGING_STAGES,
  type Character,
  type CharacterCostume,
  type CostumeRiggingStage,
} from '@/types';
import { tagColor } from '@/utils/tagColor';
import { cn } from '@/utils/cn';
import { chooseWorkFile, openWorkPath } from '@/services/sceneWorkLinkService';
import { updateEpisodeReelPath } from '@/services/supabaseService';

const RIGGING_STAGE_META: Record<CostumeRiggingStage, { label: string; color: string }> = {
  waiting: { label: '대기', color: '#8B8DA3' },
  vectorized: { label: '벡터화', color: '#74B9FF' },
  rigging: { label: '리깅', color: '#6C5CE7' },
  feedback: { label: '피드백', color: '#FDCB6E' },
  done: { label: '완성', color: '#00B894' },
};

function characterThumb(costumes: CharacterCostume[]): string | null {
  return costumes.find((c) => c.featuredImageUrl)?.featuredImageUrl ?? null;
}
function unionTags(costumes: CharacterCostume[]): string[] {
  const set = new Set<string>();
  for (const c of costumes) { for (const t of c.structureTags) set.add(t); for (const t of c.assetTags) set.add(t); }
  return [...set];
}
/** 복장들 중 가장 진행된 리깅 단계 (대표 cross-ref). 복장 없으면 null. */
function topRiggingStage(costumes: CharacterCostume[]): CostumeRiggingStage | null {
  if (costumes.length === 0) return null;
  let best = -1;
  for (const c of costumes) { const idx = COSTUME_RIGGING_STAGES.indexOf(c.riggingStage); if (idx > best) best = idx; }
  return best >= 0 ? COSTUME_RIGGING_STAGES[best] : null;
}

/** 이 편이 특정 복장을 쓰면 그 복장의 리깅 단계, 복장 미정이면 전체 중 최고(대략 표시). */
function episodeRiggingStage(costumes: CharacterCostume[], costumeId: string | null): CostumeRiggingStage | null {
  if (costumeId) {
    const picked = costumes.find((c) => c.id === costumeId);
    if (picked) return picked.riggingStage;
  }
  return topRiggingStage(costumes);
}

function StaticTag({ tag }: { tag: string }) {
  const c = tagColor(tag);
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[11px] flex items-center gap-1.5"
      style={{ background: `${c}22`, color: c, border: `1px solid ${c}55` }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c }} />
      {tag}
    </span>
  );
}

function RiggingBadge({ stage }: { stage: CostumeRiggingStage | null }) {
  if (!stage) {
    return <span className="px-2 py-0.5 rounded-full text-[11px] text-text-secondary/60 border border-bg-border">복장 없음</span>;
  }
  const m = RIGGING_STAGE_META[stage];
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1.5" style={{ background: `${m.color}22`, color: m.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />
      리깅 {m.label}
    </span>
  );
}

function MemoInput({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; if (draft !== value) onCommit(draft); }}
      placeholder="이 편 주의점 (예: 이 화에서는 안경 씀, 담배 드는 씬 주의)"
      rows={3}
      className="w-full bg-bg-border/20 border border-bg-border rounded-lg px-2.5 py-2 text-sm text-text-primary outline-none focus:border-accent/50 resize-none leading-relaxed"
    />
  );
}

/** 좌측 목록 행 — 썸네일 + 이름 + 이 편 복장 + 리깅 미니. */
function EpisodeCharRow({
  character,
  costumes,
  costumeId,
  selected,
  onSelect,
}: {
  character: Character;
  costumes: CharacterCostume[];
  costumeId: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const thumb = characterThumb(costumes);
  const selectedCostume = costumeId ? costumes.find((c) => c.id === costumeId) ?? null : null;
  const costumeName = selectedCostume?.name ?? null;
  const rigging = episodeRiggingStage(costumes, costumeId);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-l-2 transition-colors cursor-pointer',
        selected ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-bg-border/30',
      )}
    >
      <div className="w-9 h-9 rounded-md bg-bg-border/40 overflow-hidden flex items-center justify-center shrink-0">
        {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <User size={16} className="text-text-secondary/50" />}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <div className={cn('text-sm truncate', selected ? 'text-text-primary font-medium' : 'text-text-secondary')}>
          {character.name}
          {costumeName && <span className="text-text-secondary/60 font-normal"> · {costumeName}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[10px]">
          {rigging ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: RIGGING_STAGE_META[rigging].color }} />
              <span style={{ color: RIGGING_STAGE_META[rigging].color }}>{RIGGING_STAGE_META[rigging].label}</span>
            </>
          ) : (
            <span className="text-text-secondary/50">복장 없음</span>
          )}
        </div>
      </div>
    </button>
  );
}

/** 우측 상세 — 선택 캐릭터의 이 편 정보. */
function EpisodeCharDetail({
  character,
  episodeNumber,
  onOpenCharacter,
}: {
  character: Character;
  episodeNumber: number;
  onOpenCharacter?: (id: string) => void;
}) {
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const episodeLinks = useCharacterBoardStore((s) => s.episodeLinks);
  const setEpisodeMemo = useCharacterBoardStore((s) => s.setEpisodeMemo);
  const setEpisodeCostume = useCharacterBoardStore((s) => s.setEpisodeCostume);
  const unlinkEpisode = useCharacterBoardStore((s) => s.unlinkEpisode);

  const costumes = byCharacter.get(character.id) ?? [];
  const link = (episodeLinks.get(character.id) ?? []).find((l) => l.episodeNumber === episodeNumber);
  const memo = link?.memo ?? '';
  const costumeId = link?.costumeId ?? null;
  const selectedCostume = costumes.find((c) => c.id === costumeId) ?? null;
  const hero = selectedCostume?.featuredImageUrl ?? characterThumb(costumes);
  const tags = unionTags(costumes);
  const rigging = episodeRiggingStage(costumes, costumeId);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-bg-border/40 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-lg font-semibold text-text-primary truncate">{character.name}</h2>
          <span className="text-sm text-text-secondary shrink-0">· 이 편 복장 {selectedCostume?.name ?? '미정'}</span>
        </div>
        <button
          type="button"
          onClick={() => { if (window.confirm(`'${character.name}' 를 이 에피소드에서 제거할까요?`)) unlinkEpisode(character.id, episodeNumber); }}
          className="text-text-secondary hover:text-[#FF6B6B] text-xs flex items-center gap-1 shrink-0 cursor-pointer"
        >
          <X size={13} /> 제거
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-5">
        {/* 대표 이미지 + 리깅 cross-ref */}
        <div className="flex gap-4">
          <div className="w-[150px] shrink-0 aspect-[3/4] rounded-xl bg-bg-border/30 border border-bg-border overflow-hidden flex items-center justify-center">
            {hero ? (
              <img src={hero} alt={character.name} className="w-full h-full object-contain" />
            ) : (
              <ImageOff size={22} className="text-text-secondary/40" />
            )}
          </div>
          <div className="flex flex-col gap-3 min-w-0 flex-1">
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-text-secondary">리깅 상태 (캐릭터 현황판 기준)</div>
              <div className="flex items-center gap-2 flex-wrap">
                <RiggingBadge stage={rigging} />
                {onOpenCharacter && (
                  <button
                    type="button"
                    onClick={() => onOpenCharacter(character.id)}
                    className="text-xs text-accent hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    캐릭터 현황판에서 보기 <ArrowRight size={12} />
                  </button>
                )}
              </div>
              <div className="text-[11px] text-text-secondary/60 leading-relaxed">
                진행 편집은 캐릭터 현황판에서 해요. 여기선 이 편 정보만 적습니다.
              </div>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-xs text-text-secondary">태그</div>
                <div className="flex flex-wrap gap-1.5">{tags.map((t) => <StaticTag key={t} tag={t} />)}</div>
              </div>
            )}
          </div>
        </div>

        {/* 이 편 복장 선택 (썸네일 갤러리) */}
        <div className="flex flex-col gap-2">
          <div className="text-xs text-text-secondary">이 편 복장</div>
          {costumes.length === 0 ? (
            <div className="text-xs text-text-secondary/60 border border-dashed border-bg-border rounded-lg py-4 text-center">
              아직 복장이 없어요. 캐릭터 현황판에서 디자인을 추가하세요.
            </div>
          ) : (
            <div className="flex items-stretch gap-2.5 overflow-x-auto pb-1">
              {/* 선택 안 함 */}
              <button
                type="button"
                onClick={() => setEpisodeCostume(character.id, episodeNumber, null)}
                aria-pressed={costumeId === null}
                className={cn(
                  'w-[92px] shrink-0 aspect-[3/4] flex flex-col items-center justify-center gap-1 rounded-lg border text-xs transition-colors cursor-pointer',
                  costumeId === null ? 'border-accent text-accent bg-accent/10' : 'border-dashed border-bg-border text-text-secondary hover:text-text-primary',
                )}
              >
                선택 안 함
              </button>
              {costumes.map((c) => {
                const on = c.id === costumeId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setEpisodeCostume(character.id, episodeNumber, c.id)}
                    aria-pressed={on}
                    className={cn(
                      'group relative w-[92px] shrink-0 flex flex-col rounded-lg overflow-hidden border transition-colors cursor-pointer',
                      on ? 'border-accent ring-1 ring-accent/40' : 'border-bg-border hover:border-text-secondary/50',
                    )}
                  >
                    <div className="aspect-[3/4] w-full bg-bg-border/30 flex items-center justify-center overflow-hidden">
                      {c.featuredImageUrl ? <img src={c.featuredImageUrl} alt={c.name} className="w-full h-full object-cover" /> : <User size={16} className="text-text-secondary/40" />}
                    </div>
                    <div className="px-1.5 py-1 bg-bg-card flex items-center justify-between gap-1">
                      <span className={cn('text-[11px] truncate', on ? 'text-text-primary' : 'text-text-secondary')}>{c.name}</span>
                    </div>
                    {on && (
                      <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md text-[10px] bg-accent text-white flex items-center gap-0.5">
                        <Check size={9} /> 이 편 사용
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 이 편 주의점 */}
        <div className="flex flex-col gap-2">
          <div className="text-xs text-text-secondary">이 편 주의점 · 감독 노트</div>
          <MemoInput value={memo} onCommit={(next) => setEpisodeMemo(character.id, episodeNumber, next)} />
        </div>
      </div>
    </div>
  );
}

function AddCharacterToEpisode({
  episodeNumber,
  candidates,
  onClose,
}: {
  episodeNumber: number;
  candidates: Character[];
  onClose: () => void;
}) {
  const linkEpisode = useCharacterBoardStore((s) => s.linkEpisode);
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.name.toLowerCase().includes(q));
  }, [candidates, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div className="bg-bg-card border border-bg-border rounded-2xl w-full max-w-md p-5 flex flex-col gap-4 max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">등장 캐릭터 추가</h2>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary cursor-pointer"><X size={18} /></button>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary/60" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="캐릭터 이름 검색" className="w-full bg-transparent border border-bg-border rounded-md pl-8 pr-3 py-2 text-text-primary outline-none focus:border-accent/50" />
        </div>
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center text-text-secondary text-sm py-8">
              {candidates.length === 0 ? '추가할 수 있는 캐릭터가 없어요.' : '검색 결과가 없어요.'}
            </div>
          ) : (
            filtered.map((c) => {
              const thumb = characterThumb(byCharacter.get(c.id) ?? []);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { linkEpisode(c.id, episodeNumber); onClose(); }}
                  className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-primary hover:bg-accent/10 text-left cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-md bg-bg-border/40 overflow-hidden flex items-center justify-center shrink-0">
                    {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <User size={14} className="text-text-secondary/50" />}
                  </div>
                  <span className="flex-1 min-w-0 truncate">{c.name}</span>
                  <Plus size={14} className="text-accent shrink-0" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function EpisodeAssetBoard({ onOpenCharacter }: { onOpenCharacter?: (id: string) => void }) {
  const characters = useCharacterBoardStore((s) => s.characters);
  const byCharacter = useCharacterBoardStore((s) => s.byCharacter);
  const episodeLinks = useCharacterBoardStore((s) => s.episodeLinks);
  const episodes = useDataStore((s) => s.episodes);
  const setEpisodes = useDataStore((s) => s.setEpisodes);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);

  const sortedEpisodes = useMemo(() => [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber), [episodes]);

  const [selectedEp, setSelectedEp] = useState<number | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    if (selectedEp == null && sortedEpisodes.length > 0) setSelectedEp(sortedEpisodes[0].episodeNumber);
  }, [selectedEp, sortedEpisodes]);

  const activeCharacters = useMemo(() => characters.filter((c) => c.status !== 'archived'), [characters]);

  const linkedCharacters = useMemo(() => {
    if (selectedEp == null) return [];
    return activeCharacters.filter((c) => c.episodeIds.includes(selectedEp));
  }, [activeCharacters, selectedEp]);

  const candidates = useMemo(() => {
    if (selectedEp == null) return [];
    return activeCharacters.filter((c) => !c.episodeIds.includes(selectedEp));
  }, [activeCharacters, selectedEp]);

  // 선택 캐릭터 보정.
  useEffect(() => {
    if (linkedCharacters.length === 0) { setSelectedCharId(null); return; }
    if (!linkedCharacters.some((c) => c.id === selectedCharId)) setSelectedCharId(linkedCharacters[0].id);
  }, [linkedCharacters, selectedCharId]);

  const selectedChar = linkedCharacters.find((c) => c.id === selectedCharId) ?? null;
  const selectedEpisode = sortedEpisodes.find((ep) => ep.episodeNumber === selectedEp) ?? null;

  const handleEpisodeReel = async () => {
    if (!selectedEpisode) return;
    if (selectedEpisode.reelFilePath) {
      const res = await openWorkPath(selectedEpisode.reelFilePath);
      if (!res.ok) toast.error('릴 파일 열기에 실패했어요');
      return;
    }
    const filePath = await chooseWorkFile();
    if (!filePath) return;
    const prev = episodes;
    setEpisodes(prev.map((ep) => ep.episodeNumber === selectedEpisode.episodeNumber ? { ...ep, reelFilePath: filePath } : ep));
    try {
      await updateEpisodeReelPath(selectedEpisode.episodeNumber, filePath);
      toast.success('릴 파일 경로를 등록했어요');
    } catch (err) {
      console.error('[episode-assets] 릴 파일 저장 실패:', err);
      setEpisodes(prev);
      toast.error('릴 파일 경로 저장에 실패했어요');
    }
  };

  function costumeIdFor(characterId: string): string | null {
    const link = (episodeLinks.get(characterId) ?? []).find((l) => l.episodeNumber === selectedEp);
    return link?.costumeId ?? null;
  }

  if (sortedEpisodes.length === 0) {
    return <div className="text-center text-text-secondary py-16">에피소드가 없습니다.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 에피소드 선택 + 추가 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">에피소드</span>
          <select
            value={selectedEp ?? ''}
            onChange={(e) => setSelectedEp(e.target.value ? Number(e.target.value) : null)}
            className="bg-bg-card border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent/50 cursor-pointer"
          >
            {sortedEpisodes.map((ep) => (
              <option key={ep.episodeNumber} value={ep.episodeNumber}>{getEpisodeDisplayName(ep)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleEpisodeReel}
            title={selectedEpisode?.reelFilePath ?? '릴 파일 등록'}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors cursor-pointer',
              selectedEpisode?.reelFilePath
                ? 'border-[#00B89455] bg-[#00B8941a] text-[#00B894]'
                : 'border-bg-border text-text-secondary hover:text-text-primary hover:border-text-secondary/50',
            )}
          >
            <Film size={15} /> 릴 파일
          </button>
        </div>
        {selectedEp != null && (
          <button type="button" onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90 cursor-pointer">
            <Plus size={16} /> 등장 캐릭터 추가
          </button>
        )}
      </div>

      {selectedEp != null && linkedCharacters.length === 0 ? (
        <div className="text-center text-text-secondary py-16 border border-dashed border-bg-border rounded-xl">
          이 에피소드에 등록된 캐릭터가 없어요. "등장 캐릭터 추가"로 시작해보세요.
        </div>
      ) : selectedEp != null && (
        <div className="flex bg-bg-card border border-bg-border rounded-xl overflow-hidden" style={{ minHeight: 440, height: '64vh' }}>
          {/* 좌측 목록 */}
          <aside className="w-[230px] shrink-0 border-r border-bg-border/60 flex flex-col min-h-0">
            <div className="px-3 py-2.5 border-b border-bg-border/40 text-xs text-text-secondary shrink-0">
              등장 캐릭터 {linkedCharacters.length}명
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto py-1">
              {linkedCharacters.map((c) => (
                <EpisodeCharRow
                  key={c.id}
                  character={c}
                  costumes={byCharacter.get(c.id) ?? []}
                  costumeId={costumeIdFor(c.id)}
                  selected={c.id === selectedCharId}
                  onSelect={() => setSelectedCharId(c.id)}
                />
              ))}
            </div>
          </aside>

          {/* 우측 상세 */}
          <main className="flex-1 min-w-0">
            {selectedChar && <EpisodeCharDetail character={selectedChar} episodeNumber={selectedEp} onOpenCharacter={onOpenCharacter} />}
          </main>
        </div>
      )}

      {addOpen && selectedEp != null && (
        <AddCharacterToEpisode episodeNumber={selectedEp} candidates={candidates} onClose={() => setAddOpen(false)} />
      )}
    </div>
  );
}

export default EpisodeAssetBoard;
