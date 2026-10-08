import { useMemo, useState } from 'react';
import { Image as ImageIcon, Search, X } from 'lucide-react';
import type { BackgroundMap, BackgroundNode, BackgroundSnapshot } from './types';
import { filterBackgroundViews, type BackgroundFilter } from './domain';
import { selectMapBackgroundViews } from './mapGallery';
import { Thumbnail, shotLabel, timeLabel } from './BackgroundUI';

export function BackgroundMapGallery({ snapshot, maps, current, selected, onClearSelection, onOpenView, onOpenCatalog }: {
  snapshot: BackgroundSnapshot; maps: BackgroundMap[]; current: BackgroundMap; selected?: BackgroundNode;
  onClearSelection: () => void; onOpenView: (id: string, variantId?: string) => void; onOpenCatalog: () => void;
}) {
  const [search, setSearch] = useState('');
  const [shot, setShot] = useState<BackgroundFilter['shot']>('all');
  const [time, setTime] = useState<BackgroundFilter['time']>('all');
  const scopedViews = useMemo(() => selectMapBackgroundViews(snapshot, maps, current, selected), [snapshot, maps, current, selected]);
  const views = useMemo(() => filterBackgroundViews({ ...snapshot, views: scopedViews }, { search, shot, time }), [snapshot, scopedViews, search, shot, time]);
  const hasFilters = !!search.trim() || shot !== 'all' || time !== 'all';
  const space = selected?.type === 'symbol' ? current.nodes.find(node => node.type === 'space' && node.id === selected.spaceId) : undefined;
  const scopeName = selected?.type === 'symbol' ? space?.name || current.name : selected?.name || current.name;
  const scopeDescription = selected?.type === 'camera' ? '이 카메라에 연결된 시점' : selected?.type === 'space' || space ? '이 공간과 관련된 배경' : '하위 도면의 연결 배경 포함';
  const resetFilters = () => { setSearch(''); setShot('all'); setTime('all'); };

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
        {selected && <button type="button" onClick={onClearSelection}><X size={13} />도면 전체</button>}
        <button type="button" onClick={onOpenCatalog}>배경 목록 →</button>
      </div>
    </header>
    <div className="bmap-gallery-results" key={`${current.id}:${selected?.id || ''}:${search}:${shot}:${time}`}>
      {views.length ? <div className="bmap-gallery-grid">
        {views.map(view => {
          const variant = (time === 'all' ? view.variants[0] : view.variants.find(item => item.time === time))!;
          return <button type="button" key={view.id} className="bmap-gallery-card" aria-label={`${view.name} · ${variant.name} 상세 보기`} onClick={() => onOpenView(view.id, variant.id)}>
            <Thumbnail view={view} variant={variant} />
            <div className="bmap-gallery-card-body"><strong title={view.name}>{view.name}</strong><span><span>{shotLabel[view.shot]}</span><span>{time === 'all' ? view.variants.map(item => item.name).join(' / ') : variant.name}</span></span></div>
          </button>;
        })}
      </div> : <div className="bmap-gallery-empty">
        <ImageIcon size={23} /><div><strong>{scopedViews.length ? '조건에 맞는 배경이 없어요' : '아직 연결된 배경이 없어요'}</strong><p>{scopedViews.length ? '검색어나 구도, 시간대를 바꿔 보세요.' : !snapshot.canManage ? '관리자가 도면이나 공간에 연결한 배경이 여기에 표시됩니다.' : selected?.type === 'camera' ? '공간 편집에서 이 카메라에 배경 시점을 연결해 주세요.' : '도면 설정이나 공간 편집에서 배경 장소를 연결하면 여기에 모입니다.'}</p></div>
        {hasFilters && <button type="button" onClick={resetFilters}>필터 초기화</button>}
      </div>}
    </div>
  </section>;
}
