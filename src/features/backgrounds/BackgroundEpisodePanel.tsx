import { useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Film, Image as ImageIcon, Plus, Search, Trash2, X } from "lucide-react";
import type {
  BackgroundSnapshot,
  BackgroundUsage,
  BackgroundVariant,
  BackgroundView,
} from "./types";
import {
  EmptyState,
  BackgroundModal,
  Field,
  Thumbnail,
  placeLabel,
  shotLabel,
  timeLabel,
  type RunCommand,
} from "./BackgroundUI";
import {
  clearUsageDraft,
  editUsageDraft,
  setUsageDraftError,
  usageDraftFor,
  type BackgroundUsageDrafts,
} from "./usageDrafts";
import './backgrounds-episode.css';

interface EpisodeProps {
  snapshot: BackgroundSnapshot;
  episodes: number[];
  pending: boolean;
  execute: RunCommand;
}
const newUsage = (episodeNumber: number, placeId: string): BackgroundUsage => ({
  id: crypto.randomUUID(),
  revision: 1,
  episodeNumber,
  placeId,
  variantIds: [],
  memo: "",
});

export function VariantChecks({
  snapshot,
  placeId,
  value,
  onChange,
  disabled = false,
}: {
  snapshot: BackgroundSnapshot;
  placeId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const views = snapshot.views.filter((view) => view.placeId === placeId);
  return (
    <div className="bg-variant-checks">
      {views.length ? (
        views.map((view) => (
          <section key={view.id} className="bg-variant-row">
            <Thumbnail view={view} />
            <div>
              <strong>{view.name}</strong>
              <div className="bg-inline-checks">
                {view.variants.map((variant) => (
                  <label key={variant.id}>
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={value.includes(variant.id)}
                      onChange={(event) =>
                        onChange(
                          event.target.checked
                            ? [...value, variant.id]
                            : value.filter((id) => id !== variant.id),
                        )
                      }
                    />
                    {variant.name}
                  </label>
                ))}
              </div>
            </div>
          </section>
        ))
      ) : (
        <p className="bg-note">
          이 장소에 등록된 배경이 없습니다. 배경 목록에서 먼저 등록해 주세요.
        </p>
      )}
    </div>
  );
}

function placeVariants(snapshot: BackgroundSnapshot, placeId: string) {
  return snapshot.views.filter(view => view.placeId === placeId)
    .flatMap(view => view.variants.map(variant => ({ view, variant })));
}
function usageHero(snapshot: BackgroundSnapshot, usage: BackgroundUsage) {
  const entries = placeVariants(snapshot, usage.placeId);
  return usage.variantIds.map(id => entries.find(entry => entry.variant.id === id)).find(Boolean)
    ?? entries.find(entry => entry.variant.revisions.some(revision => revision.id === entry.variant.activeRevisionId && revision.imageUrl))
    ?? entries[0];
}

function UsageDetail({ usage, snapshot, pending, execute, drafts, onEdit, onError, onSaved, onOpenView }: {
  usage: BackgroundUsage; snapshot: BackgroundSnapshot; pending: boolean; execute: RunCommand;
  drafts: BackgroundUsageDrafts;
  onEdit: (usage: BackgroundUsage, patch: Partial<Pick<BackgroundUsage, 'memo' | 'variantIds'>>) => void;
  onError: (usage: BackgroundUsage, error: string) => void;
  onSaved: (id: string) => void;
  onOpenView: (id: string, variantId?: string) => void;
}) {
  const [deleting, setDeleting] = useState(false), [groupId, setGroupId] = useState('');
  const draft = usageDraftFor(drafts, usage);
  const dirty = drafts[usage.id]?.dirty ?? false;
  const error = drafts[usage.id]?.error ?? '';
  const groups = snapshot.groups.filter(group => group.placeId === usage.placeId);
  const entries = placeVariants(snapshot, usage.placeId);
  const hero = usageHero(snapshot, draft);
  const name = snapshot.places.find(place => place.id === usage.placeId)?.name ?? '등록되지 않은 장소';
  const edit = (patch: Partial<Pick<BackgroundUsage, 'memo' | 'variantIds'>>) => onEdit(usage, patch);
  const run = async (remove = false) => {
    onError(usage, '');
    try {
      if (remove) await execute({ type: 'delete', kind: 'usage', id: usage.id, expectedRevision: draft.revision });
      else await execute({ type: 'save', kind: 'usage', entity: draft, expectedRevision: draft.revision });
      onSaved(usage.id);
    } catch (cause) { onError(usage, (cause as Error).message); }
  };
  return <article className="bg-episode-detail" aria-label={`${name} 에피소드 상세`}>
    <header className="bg-episode-detail-header">
      <div><h3>{name}</h3><p>{placeLabel(snapshot.places, usage.placeId)} · 이 편 사용 {draft.variantIds.length}개</p></div>
      <button type="button" className="bg-icon" title="에피소드에서 장소 빼기" aria-label="에피소드에서 장소 빼기" disabled={pending} onClick={() => setDeleting(!deleting)}><Trash2 size={16} /></button>
    </header>
    <div className="bg-episode-detail-body">
      {deleting && <div className="bg-confirm">
        <p>이 에피소드에서 장소와 사용 목록, 메모를 뺄까요? 배경 원본은 유지됩니다.</p>
        <button type="button" disabled={pending} onClick={() => setDeleting(false)}>취소</button>
        <button type="button" className="bg-danger" disabled={pending} onClick={() => void run(true)}>장소 빼기</button>
      </div>}
      <div className="bg-episode-hero">
        {hero ? <Thumbnail view={hero.view} variant={hero.variant} className="bg-episode-hero-image" /> : <div className="bg-episode-hero-image bg-episode-no-image"><ImageIcon size={28} /><span>등록된 배경 없음</span></div>}
        <div className="bg-episode-hero-info">
          <span className="bg-note">이 편 대표 배경</span>
          <h4>{hero ? hero.view.name : '사용할 배경을 선택하세요'}</h4>
          <p>{hero ? `${hero.variant.name} · ${shotLabel[hero.view.shot]}` : '배경 목록에서 이 장소의 이미지를 등록할 수 있습니다.'}</p>
          {hero && <button type="button" onClick={() => onOpenView(hero.view.id, hero.variant.id)}>배경 원본 보기 <ArrowRight size={14} /></button>}
          <p className="bg-note">{draft.variantIds.length ? '먼저 선택한 이미지를 대표로 보여줍니다.' : '아직 이 편에서 사용할 배경을 선택하지 않았습니다.'}</p>
          {!!hero?.view.tags.length && <div className="bg-episode-tags">{hero.view.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
        </div>
      </div>
      <section className="bg-episode-section" aria-label="이 편 사용 배경">
        <div className="bg-episode-section-heading"><h4>이 편 사용 배경</h4><small>{draft.variantIds.length}개 선택 · {entries.length}개 중</small></div>
        {groups.length > 0 && <div className="bg-group-apply">
          <select aria-label={`${name} 시점 묶음`} value={groupId} disabled={pending} onChange={event => setGroupId(event.target.value)}>
            <option value="">시점 묶음 선택</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.variantIds.length}개</option>)}
          </select>
          <button type="button" disabled={!groupId || pending} onClick={() => {
            const group = groups.find(item => item.id === groupId);
            if (group) edit({ variantIds: [...new Set([...draft.variantIds, ...group.variantIds])] });
          }}>묶음 추가</button>
        </div>}
        {entries.length ? <div className="bg-episode-variant-grid">
          <button type="button" className="bg-episode-clear" aria-pressed={draft.variantIds.length === 0} disabled={pending || !draft.variantIds.length} onClick={() => edit({ variantIds: [] })}><X size={20} />모두 해제</button>
          {entries.map(({ view, variant }) => {
            const chosen = draft.variantIds.includes(variant.id);
            return <button type="button" key={variant.id} className="bg-episode-variant-card" aria-label={`${view.name} · ${variant.name}`} aria-pressed={chosen} disabled={pending}
              onClick={() => edit({ variantIds: chosen ? draft.variantIds.filter(id => id !== variant.id) : [...draft.variantIds, variant.id] })}>
              <Thumbnail view={view} variant={variant} />
              <span className="bg-episode-variant-caption"><strong>{view.name}</strong><small>{variant.name === timeLabel[variant.time] ? variant.name : `${variant.name} · ${timeLabel[variant.time]}`}</small></span>
              {chosen && <span className="bg-episode-used"><Check size={11} />이 편 사용</span>}
            </button>;
          })}
        </div> : <p className="bg-note">이 장소에 등록된 배경이 없습니다. 배경 목록에서 먼저 등록해 주세요.</p>}
      </section>
      <Field label="이 편 주의점 · 감독 노트"><textarea rows={3} maxLength={10000} value={draft.memo} disabled={pending} placeholder="필요한 구도, 연출 요청, 낮·밤 설정 등을 기록하세요." onChange={event => edit({ memo: event.target.value })} /></Field>
    </div>
    <footer className="bg-episode-detail-footer">
      {error && <p className="bg-error" role="alert">{error}</p>}
      <small role="status">{dirty ? '저장 전 변경사항이 있습니다' : '저장된 사용 목록'} · {draft.variantIds.length}개 선택</small>
      <button type="button" className="bg-primary" disabled={!dirty || pending} onClick={() => void run()}><Check size={15} />{pending ? '저장 중…' : '사용 목록 저장'}</button>
    </footer>
  </article>;
}

function AddEpisodePlace({ snapshot, episodeNumber, pending, execute, onAdded, onClose }: {
  snapshot: BackgroundSnapshot; episodeNumber: number; pending: boolean; execute: RunCommand;
  onAdded: (id: string) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState(''), [error, setError] = useState(''), [adding, setAdding] = useState(false);
  const candidates = snapshot.places.filter(place => !snapshot.usages.some(usage => usage.episodeNumber === episodeNumber && usage.placeId === place.id));
  const matches = candidates.filter(place => placeLabel(snapshot.places, place.id).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const add = async (placeId: string) => {
    if (pending || adding) return;
    const usage = newUsage(episodeNumber, placeId);
    setAdding(true); setError('');
    try { await execute({ type: 'save', kind: 'usage', entity: usage, expectedRevision: null }); onAdded(usage.id); }
    catch (cause) { setError((cause as Error).message); }
    finally { setAdding(false); }
  };
  return <BackgroundModal title={`EP ${String(episodeNumber).padStart(2, '0')} · 사용 장소 추가`} onClose={() => { if (!pending && !adding) onClose(); }}>
    <label className="bg-search bg-episode-add-search"><Search size={17} /><input data-autofocus aria-label="추가할 장소 검색" placeholder="장소 이름 검색" value={search} onChange={event => setSearch(event.target.value)} /></label>
    {error && <p className="bg-error" role="alert">{error}</p>}
    <div className="bg-episode-add-list">
      {matches.map(place => {
        const views = snapshot.views.filter(view => view.placeId === place.id);
        return <button type="button" className="bg-episode-add-row" key={place.id} disabled={pending || adding} aria-label={`${placeLabel(snapshot.places, place.id)} 추가`} onClick={() => void add(place.id)}>
          {views[0] ? <Thumbnail view={views[0]} /> : <ImageIcon size={22} />}
          <span className="bg-episode-place-copy"><strong>{place.name}</strong><small>{placeLabel(snapshot.places, place.id)} · {views.length}개 시점</small></span><Plus size={16} />
        </button>;
      })}
      {!matches.length && <p className="bg-note">{candidates.length ? '검색 결과가 없습니다.' : '추가할 장소가 없습니다. 배경 목록에서 장소를 등록해 주세요.'}</p>}
    </div>
  </BackgroundModal>;
}

export function BackgroundEpisodePanel({ snapshot, episodes, pending, execute, episodeLabels = {}, onOpenView }: EpisodeProps & {
  episodeLabels?: Record<number, string>; onOpenView: (id: string, variantId?: string) => void;
}) {
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(episodes[0] ?? null);
  const [selectedUsageIds, setSelectedUsageIds] = useState<Record<number, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [drafts, setDrafts] = useState<BackgroundUsageDrafts>({});
  const episodeNumber = selectedEpisode !== null && episodes.includes(selectedEpisode) ? selectedEpisode : (episodes[0] ?? null);
  const currentUsages = snapshot.usages.filter(usage => usage.episodeNumber === episodeNumber);
  const confirmedUsages = useRef<BackgroundUsage[]>([]);
  if (!pending) confirmedUsages.current = currentUsages;
  // Keep the selected editor and its draft alive until an optimistic delete settles.
  const confirmedForEpisode = confirmedUsages.current.filter(usage => usage.episodeNumber === episodeNumber);
  const usages = pending ? [
    ...confirmedForEpisode.map(usage => currentUsages.find(current => current.id === usage.id) ?? usage),
    ...currentUsages.filter(usage => !confirmedForEpisode.some(confirmed => confirmed.id === usage.id)),
  ] : currentUsages;
  const selectedUsage = usages.find(usage => usage.id === selectedUsageIds[episodeNumber ?? -1]) ?? usages[0];
  if (episodeNumber === null) return <EmptyState title="등록된 에피소드가 없습니다" description="프로젝트에 에피소드를 등록하면 장소와 배경을 연결할 수 있습니다." />;
  return <div className="bg-panel bg-episode-panel">
    <div className="bg-episode-toolbar">
      <label className="bg-episode-select"><Film size={17} /><span>에피소드</span>
        <select aria-label="에피소드 선택" value={episodeNumber} disabled={pending} onChange={event => setSelectedEpisode(Number(event.target.value))}>
          {episodes.map(number => <option key={number} value={number}>{episodeLabels[number] || `EP ${String(number).padStart(2, '0')}`}</option>)}
        </select>
      </label>
      <button type="button" className="bg-primary" disabled={pending} onClick={() => setAddOpen(true)}><Plus size={16} />사용 장소 추가</button>
    </div>
    {usages.length ? <div className="bg-episode-board">
      <aside className="bg-episode-sidebar" aria-label="에피소드 사용 장소">
        <header>사용 장소 {usages.length}개 <span>· {usages.reduce((sum, usage) => sum + usageDraftFor(drafts, usage).variantIds.length, 0)}개 배경 선택</span></header>
        <nav aria-label="사용 장소 목록">{usages.map(usage => {
          const draft = usageDraftFor(drafts, usage), hero = usageHero(snapshot, draft);
          const name = snapshot.places.find(place => place.id === usage.placeId)?.name ?? '등록되지 않은 장소';
          return <button type="button" className="bg-episode-place-row" key={usage.id} title={placeLabel(snapshot.places, usage.placeId)} aria-pressed={selectedUsage?.id === usage.id} disabled={pending}
            onClick={() => setSelectedUsageIds(previous => ({ ...previous, [episodeNumber]: usage.id }))}>
            {hero ? <Thumbnail view={hero.view} variant={hero.variant} /> : <ImageIcon size={24} />}
            <span className="bg-episode-place-copy"><strong>{name}</strong><small>{draft.variantIds.length ? `이 편 사용 ${draft.variantIds.length}개` : '사용 배경 미정'}</small>{drafts[usage.id]?.dirty && <small className="is-dirty">저장 전 변경사항</small>}</span>
          </button>;
        })}</nav>
      </aside>
      <main className="bg-episode-main">{selectedUsage && <UsageDetail key={selectedUsage.id} usage={selectedUsage} snapshot={snapshot} pending={pending} execute={execute} drafts={drafts} onOpenView={onOpenView}
        onEdit={(usage, patch) => setDrafts(previous => editUsageDraft(previous, usage, patch))}
        onError={(usage, error) => setDrafts(previous => setUsageDraftError(previous, usage, error))}
        onSaved={id => setDrafts(previous => clearUsageDraft(previous, id))} />}</main>
    </div> : <EmptyState title="이 에피소드에 등록된 장소가 없습니다" description="사용 장소를 추가한 뒤 이 편에서 쓸 배경과 감독 노트를 정리하세요."><button type="button" className="bg-primary" disabled={pending} onClick={() => setAddOpen(true)}><Plus size={16} />첫 장소 추가</button></EmptyState>}
    {addOpen && <AddEpisodePlace key={episodeNumber} snapshot={snapshot} episodeNumber={episodeNumber} pending={pending} execute={execute} onClose={() => setAddOpen(false)} onAdded={id => { setSelectedUsageIds(previous => ({ ...previous, [episodeNumber]: id })); setAddOpen(false); }} />}
  </div>;
}
export function ReverseUsagePanel({
  view,
  variant,
  snapshot,
  episodes,
  pending,
  execute,
  readOnly = false,
}: EpisodeProps & { view: BackgroundView; variant: BackgroundVariant; readOnly?: boolean }) {
  const [error, setError] = useState("");
  const usedEpisodes = useMemo(
    () =>
      snapshot.usages
        .filter((usage) => usage.variantIds.includes(variant.id))
        .map((usage) => usage.episodeNumber),
    [snapshot.usages, variant.id],
  );
  const toggle = async (episodeNumber: number, checked: boolean) => {
    if (readOnly) return;
    const usage = snapshot.usages.find(
      (item) =>
        item.episodeNumber === episodeNumber && item.placeId === view.placeId,
    );
    const next = usage || newUsage(episodeNumber, view.placeId);
    setError("");
    try {
      await execute({
        type: "save",
        kind: "usage",
        entity: {
          ...next,
          variantIds: checked
            ? [...new Set([...next.variantIds, variant.id])]
            : next.variantIds.filter((id) => id !== variant.id),
        },
        expectedRevision: usage?.revision ?? null,
      });
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return (
    <section className="bg-reverse-usage">
      <h3>
        이 변형을 사용하는 에피소드 <span>{usedEpisodes.length}</span>
      </h3>
      <p className="bg-note">
        {readOnly ? '저장된 사용 기록입니다. 사용 배경은 원본 창을 닫고 에피소드별 배경 화면에서 편집해 주세요.' : '체크하면 해당 에피소드에 바로 반영됩니다. 기존 장소 메모와 다른 배경 선택은 유지됩니다.'}
      </p>
      <div className="bg-inline-checks">
        {episodes.length ? (
          episodes.map((number) => (
            <label key={number}>
              <input
                type="checkbox"
                disabled={pending || readOnly}
                checked={usedEpisodes.includes(number)}
                onChange={(event) => void toggle(number, event.target.checked)}
              />
              EP {String(number).padStart(2, "0")}
            </label>
          ))
        ) : (
          <small>등록된 에피소드가 없습니다.</small>
        )}
      </div>
      {error && (
        <p className="bg-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
