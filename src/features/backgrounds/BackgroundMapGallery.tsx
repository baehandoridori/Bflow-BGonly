import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Image as ImageIcon, Search, X } from 'lucide-react';
import type { BackgroundMap, BackgroundNode, BackgroundSnapshot } from './types';
import { filterBackgroundViews, type BackgroundFilter } from './domain';
import { selectMapBackgroundViews } from './mapGallery';
import { Thumbnail, shotLabel, timeLabel } from './BackgroundUI';
import { MAP_IMAGE_DEFAULTS, MAP_IMAGE_HINT, MAP_IMAGE_STEPS, mapImageOutcomeNow, mapImageSummary, mapImageTargetWords, resolveMapImageTarget } from './mapImageDrop';
import { MAP_IMAGE_IDLE } from './useMapImageAdd';
import type { MapImageAddView } from './useMapImageAdd';

export function BackgroundMapGallery({ snapshot, maps, current, selected, onClearSelection, onOpenView, onOpenCatalog, adding = MAP_IMAGE_IDLE, saving = false, onAddFiles, onDismissNotice }: {
  snapshot: BackgroundSnapshot; maps: BackgroundMap[]; current: BackgroundMap; selected?: BackgroundNode;
  onClearSelection: () => void; onOpenView: (id: string, variantId?: string) => void; onOpenCatalog: () => void;
  adding?: MapImageAddView; saving?: boolean; onAddFiles?: (files: File[]) => void; onDismissNotice?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [shot, setShot] = useState<BackgroundFilter['shot']>('all');
  const [time, setTime] = useState<BackgroundFilter['time']>('all');
  /** A batch and its line belong to one map. When that map is gone meanwhile (deleted here or elsewhere) they are shown on the map on show: how it went must still be told somewhere. */
  const mine = (mapId: string | null | undefined) => !!mapId && (mapId === current.id || !maps.some(map => map.id === mapId));
  const jobs = mine(adding.mapId) ? adding.jobs : MAP_IMAGE_IDLE.jobs, notice = mine(adding.notice?.mapId) ? adding.notice : null;
  // A picture that is saved while its batch still runs is in the library already. Until the batch ends it is drawn once, as its ghost: not as a card too, and not in the count.
  const scopedViews = useMemo(() => selectMapBackgroundViews(snapshot, maps, current, selected).filter(view => !jobs.some(job => job.id === view.id)), [snapshot, maps, current, selected, jobs]);
  const views = useMemo(() => filterBackgroundViews({ ...snapshot, views: scopedViews }, { search, shot, time }), [snapshot, scopedViews, search, shot, time]);
  const ordered = useMemo(() => adding.recent.length ? [...adding.recent.flatMap(id => views.filter(view => view.id === id)), ...views.filter(view => !adding.recent.includes(view.id))] : views, [views, adding.recent]);
  const words = mapImageTargetWords(resolveMapImageTarget(snapshot, maps, current, selected), { editing: false, running: adding.running, wrongType: false });
  // While a save runs the store shows a library that is not confirmed yet: the line is read against the library as it was before that save.
  const confirmed = useRef(snapshot);
  if (!saving) confirmed.current = snapshot;
  // The line of a batch says how that batch stands now: its link still to be saved, saved since or taken back, its pictures deleted.
  const noticeText = notice?.live ? mapImageSummary(mapImageOutcomeNow(notice.live.outcome, notice.live.link, confirmed.current.maps.find(map => map.id === notice.mapId), notice.mapId === current.id ? current : undefined, confirmed.current)) : notice?.text;
  const noticeRef = useRef<HTMLDivElement>(null), resultsRef = useRef<HTMLDivElement>(null);
  const hasFilters = !!search.trim() || shot !== 'all' || time !== 'all';
  const space = selected?.type === 'symbol' ? current.nodes.find(node => node.type === 'space' && node.id === selected.spaceId) : undefined;
  const scopeName = selected?.type === 'symbol' ? space?.name || current.name : selected?.name || current.name;
  const scopeDescription = selected?.type === 'camera' ? '이 카메라에 연결된 시점' : selected?.type === 'space' || space ? '이 공간과 관련된 배경' : '하위 도면의 연결 배경 포함';
  const resetFilters = () => { setSearch(''); setShot('all'); setTime('all'); };
  // A card just added that the search, the shot or the time of day would hide brings the filters back to all. One that is not hidden leaves them as they are.
  useEffect(() => { if (hasFilters && adding.marked.some(id => scopedViews.some(view => view.id === id) && !views.some(view => view.id === id))) resetFilters(); }, [adding.marked]);
  // Brought into view as a batch starts and as the line speaks up. Never as a batch ends (the plan may be under a drag then), and never on a mere redraw: `seen` starts at the value of this mount.
  const seen = useRef(adding.seq);
  useEffect(() => {
    if (adding.seq === seen.current) return;
    seen.current = adding.seq;
    if (adding.running && resultsRef.current) resultsRef.current.scrollTop = 0;      // the ghosts stand at the front of the list
    noticeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [adding.seq]);
  const input = useRef<HTMLInputElement>(null);
  /** ＋ 이미지 추가. The files come from the page's own file dialog. Only the mock of the preview has `backgroundPickImages`: what it answers is taken as it is, an empty list too, and the dialog opens only when it answers nothing at all. */
  const pickImages = () => {
    const mock = window.electronAPI.backgroundPickImages;
    if (!mock) { input.current?.click(); return; }
    void mock().then(files => { if (files) onAddFiles?.(files); else input.current?.click(); });
  };

  return <section className="bmap-gallery" aria-label="도면 배경 이미지">
    <header className="bmap-gallery-header">
      <div className="bmap-gallery-context">
        <div className="bmap-gallery-title"><ImageIcon size={17} /><h3>배경 이미지</h3><span aria-live="polite">{views.length}개 시점{hasFilters && ` / ${scopedViews.length}`}</span></div>
        <p title={`${scopeName} · ${scopeDescription}`}><strong>{scopeName}</strong><span> · {scopeDescription}</span></p>
      </div>
    <div className="bmap-gallery-filters" role="search" aria-label="도면 배경 검색">
      <div className="bg-search"><Search size={15} /><input aria-label="도면 배경 검색" placeholder="배경 이름, 태그 검색" value={search} onChange={event => setSearch(event.target.value)} />{search && <button type="button" aria-label="도면 배경 검색 지우기" onClick={() => setSearch('')}><X size={14} /></button>}</div>
      <select aria-label="도면 배경 구도" value={shot} onChange={event => setShot(event.target.value as BackgroundFilter['shot'])}><option value="all">모든 구도</option>{Object.entries(shotLabel).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select>
      <select aria-label="도면 배경 시간대" value={time} onChange={event => setTime(event.target.value as BackgroundFilter['time'])}><option value="all">낮·밤 전체</option>{Object.entries(timeLabel).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select>
      {hasFilters && <button type="button" onClick={resetFilters}>필터 초기화</button>}
    </div>
      <div className="bmap-gallery-actions">
        {snapshot.canManage && onAddFiles && <>
          <input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="추가할 그림 파일" tabIndex={-1} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) onAddFiles?.(files); }} />
          <button type="button" className="bmap-gallery-add" aria-disabled={words.blocked} title={words.blocked ? `${words.title}. ${words.detail}` : words.title} onClick={() => { if (!words.blocked) pickImages(); }}>＋ 이미지 추가</button>
        </>}
        {selected && <button type="button" onClick={onClearSelection}><X size={13} />도면 전체</button>}
        <button type="button" onClick={onOpenCatalog}>배경 목록 →</button>
      </div>
    </header>
    {notice && <div className="bmap-gallery-notice" ref={noticeRef}>
      <div><p role="status">{noticeText}</p>{notice.failed.length > 0 && <ul role="alert" aria-label={`넣지 못한 그림 ${notice.failed.length}장`}>{notice.failed.map((item, index) => <li key={index}><strong>{item.name}</strong> — {item.reason}</li>)}</ul>}</div>
      {!adding.running && <button type="button" aria-label="안내 닫기" title="안내 닫기" onClick={onDismissNotice}>×</button>}
    </div>}
    <div className="bmap-gallery-results" key={`${current.id}:${selected?.id || ''}:${search}:${shot}:${time}`} ref={resultsRef}>
      {views.length || jobs.length ? <div className="bmap-gallery-grid">
        {jobs.map((job, index) => <div key={job.id} className="bmap-gallery-card bmap-gallery-ghost" data-step={job.step} aria-hidden="true">
          <span className="bmap-gallery-step"><i style={{ '--bmap-step': MAP_IMAGE_STEPS[job.step].part } as CSSProperties} /></span>
          <div className="bg-thumbnail">{job.imageUrl ? <img src={job.imageUrl} alt="" /> : <span><ImageIcon size={25} /></span>}</div>
          <span className="bmap-gallery-mark">{MAP_IMAGE_STEPS[job.step].label} · {index + 1}/{jobs.length}</span>
          <div className="bmap-gallery-card-body"><strong>{job.name}</strong><span><span>{shotLabel[MAP_IMAGE_DEFAULTS.shot]}</span><span>{MAP_IMAGE_DEFAULTS.variantName}</span></span></div>
        </div>)}
        {ordered.map(view => {
          const variant = (time === 'all' ? view.variants[0] : view.variants.find(item => item.time === time))!;
          const added = adding.marked.includes(view.id);
          return <button type="button" key={view.id} className={added ? 'bmap-gallery-card is-added' : 'bmap-gallery-card'} aria-label={`${view.name} · ${variant.name} 상세 보기${added ? ', 방금 추가됨' : ''}`} onClick={() => onOpenView(view.id, variant.id)}>
            {added && <span className="bmap-gallery-mark">추가됨</span>}
            <Thumbnail view={view} variant={variant} />
            <div className="bmap-gallery-card-body"><strong title={view.name}>{view.name}</strong><span><span>{shotLabel[view.shot]}</span><span>{time === 'all' ? view.variants.map(item => item.name).join(' / ') : variant.name}</span></span></div>
          </button>;
        })}
      </div> : <div className="bmap-gallery-empty">
        <ImageIcon size={23} /><div><strong>{scopedViews.length ? '조건에 맞는 배경이 없어요' : '아직 연결된 배경이 없어요'}</strong><p>{scopedViews.length ? '검색어나 구도, 시간대를 바꿔 보세요.' : !snapshot.canManage ? '관리자가 도면이나 공간에 연결한 배경이 여기에 표시됩니다.' : selected?.type === 'camera' ? '도면을 편집하면서 이 카메라에 배경 시점을 연결해 주세요.' : '도면 설정에서, 또는 도면을 편집하면서 공간에 배경 장소를 연결하면 여기에 모입니다.'}</p>{snapshot.canManage && onAddFiles && !scopedViews.length && <p>{MAP_IMAGE_HINT}</p>}</div>
        {hasFilters && <button type="button" onClick={resetFilters}>필터 초기화</button>}
      </div>}
    </div>
  </section>;
}
