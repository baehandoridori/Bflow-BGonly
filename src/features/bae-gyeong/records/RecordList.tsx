// 기록 목록 (시안 '내 기록'): 액자 · 목록 보기, 찾기, 이름 붙이기. 줄마다 작은 그림 · 제목 · 종류 · 언제 · 걸린 시간 · 비용 · 상태.
// 찾기 거르기와 줄 글자는 상태 쪽(filterBaeRecordRows)이, 이름 붙이는 동안의 글만 여기서 든다 (Enter·완료 = 남기기, Esc = 그만).
// 8단계: 같은 목록이 '팀 기록'도 그린다 — 만든 사람 칸, 여러 건 고르기(확인함), 거르기 줄, 다음 쪽. 내 기록에는 새 도장 표시.
import { useId, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, LayoutGrid, List, Loader2, Search, Tag } from 'lucide-react';
import type { BaeRecordListProps, BaeRecordRowView } from '../home/benchTypes';
import { Seal } from './Seal';
import '../home/bench.css';
import './review.css';

const tagOf = (r: BaeRecordRowView) => (r.state === 'done' ? r.kindLabel : r.stateLabel || r.kindLabel);
const tagCls = (r: BaeRecordRowView) => (r.state === 'live' ? ' is-live' : r.state === 'failed' ? ' is-error' : '');
const Fresh = () => <span className="bae-fresh" title="새로 온 도장이에요">새 도장</span>;

export function RecordList(p: BaeRecordListProps) {
  const uid = useId();
  const headId = `${uid}-h`;
  const [naming, setNaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const total = p.total ?? p.rows.length;
  const pickLabel = p.pickLabel ?? '작업판에 올리기';
  const title = p.title ?? '내 기록';
  const team = !!p.maker;

  const startName = (r: BaeRecordRowView) => { setNaming(r.id); setDraft(r.name); };
  const commit = (r: BaeRecordRowView) => { const v = draft.trim(); if (v !== r.name) p.onRename?.(r.id, v); setNaming(null); };
  const keys = (r: BaeRecordRowView) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(r); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNaming(null); }
  };
  const nameInput = (r: BaeRecordRowView) => (
    <input className="bae-minput bae-name-input" type="text" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys(r)} placeholder="이 그림의 이름" aria-label="그림 이름" />
  );
  const nameAct = (r: BaeRecordRowView) => (naming === r.id ? '완료' : r.name ? '이름 고치기' : '이름 붙이기');
  const nameBtn = (r: BaeRecordRowView, withText: boolean) => (p.onRename ? (
    <button type="button" className={withText ? 'bae-btn bae-btn-ghost bae-btn-s bae-push' : 'bae-ib'} aria-label={nameAct(r)} title={withText ? undefined : nameAct(r)} onClick={() => (naming === r.id ? commit(r) : startName(r))}>
      <Tag size={14} aria-hidden="true" />{withText ? <span className="bae-shot-acttext">{nameAct(r)}</span> : null}
    </button>
  ) : null);
  const pickBox = (r: BaeRecordRowView, cls: string) => (p.select && r.pickable ? (
    <input type="checkbox" className={cls} checked={p.select.picked.has(r.id)} onChange={() => p.select!.onToggle(r.id)} aria-label={`${r.name || r.title} 고르기 (확인함)`} />
  ) : null);
  const stampMark = (r: BaeRecordRowView) => (r.stamp ? <span className={`bae-stamp is-${r.stamp.tone}`}><Seal />{r.stamp.label}</span> : null);

  let body;
  if (p.loading) {
    body = p.view === 'grid' ? (
      <ul className="bae-shots" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <li key={i} className="bae-shotcell"><span className="bae-sk bae-sk-stage" /><span className="bae-sk-lines"><span className="bae-sk bae-sk-w70" /><span className="bae-sk bae-sk-w50" /></span></li>)}
      </ul>
    ) : (
      <div className="bae-rtable" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="bae-rtr bae-rrow"><span className="bae-sk bae-sk-thumb" /><span className="bae-sk-lines"><span className="bae-sk bae-sk-w70" /><span className="bae-sk bae-sk-w30" /></span></div>)}
      </div>
    );
  } else if (p.error) {
    body = (
      <div className="bae-log-msg bae-log-err" role="alert">
        <AlertTriangle size={20} aria-hidden="true" />
        <p className="bae-msg-title">기록을 불러오지 못했어요</p>
        <p className="bae-msg-text">{p.error}</p>
        {p.onRetry ? <button type="button" className="bae-btn bae-btn-s" onClick={p.onRetry}>다시 시도</button> : null}
      </div>
    );
  } else if (!p.rows.length) {
    body = total === 0 && !p.query.trim() ? (
      <div className="bae-log-msg"><p className="bae-msg-title">{p.emptyTitle ?? '아직 만든 그림이 없어요'}</p><p className="bae-msg-text">{p.emptyText ?? '위의 새 배경 만들기로 시작하면 여기에 쌓여요.'}</p></div>
    ) : (
      <div className="bae-log-msg"><p className="bae-msg-text">찾는 기록이 없어요. 다른 말로 찾아 보세요.</p></div>
    );
  } else if (p.view === 'grid') {
    body = (
      <ul className="bae-shots" aria-labelledby={headId}>
        {p.rows.map((r) => {
          const on = r.id === p.selectedId;
          return (
            <li key={r.id} className={`bae-shotcell${on ? ' is-on' : ''}${p.select?.picked.has(r.id) ? ' is-picked' : ''}`}>
              <button type="button" className="bae-shotbtn" aria-pressed={on} aria-label={`${r.name || r.title}${r.maker ? ` (${r.maker})` : ''} ${pickLabel}`} title={r.title} onClick={() => p.onPick(r.id)}>
                {r.thumb ? <img className="bae-shotimg" src={r.thumb} alt="" /> : null}
                {r.thumbAlt ? <img className="bae-shotimg bae-thumb-alt" src={r.thumbAlt} alt="" /> : null}
                <span className={`bae-tag bae-tag-l${tagCls(r)}`}>{tagOf(r)}</span>
                {r.stamp ? <span className={`bae-shotstamp bae-stamp is-${r.stamp.tone}`}><Seal />{r.stamp.label}</span> : null}
              </button>
              {pickBox(r, 'bae-pick bae-pick-shot')}
              <div className="bae-shotcap">
                {naming === r.id ? nameInput(r) : r.name ? <p className="bae-shotname">{r.name}{r.fresh ? <Fresh /> : null}</p> : null}
                <p className={`bae-shotdesc${r.name || naming === r.id ? ' is-sub' : ''}`}>{r.title}{!r.name && r.fresh ? <Fresh /> : null}</p>
                <div className="bae-shotmeta">
                  {team ? <span className="bae-maker">{r.maker}</span> : null}
                  <time className="bae-num">{r.when}</time>
                  {team ? null : <span className={`bae-num bae-shot-took${r.state === 'live' ? ' is-live' : ''}`}>{r.took}</span>}
                  <span className="bae-num">{r.cost}</span>
                  {nameBtn(r, true)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  } else if (team) {
    body = (
      <div className="bae-rtable is-team" role="table" aria-labelledby={headId}>
        <div className="bae-rtr bae-rthead" role="row">
          <span role="columnheader"><span className="bae-vh">고르기</span></span>
          <span role="columnheader">그림</span>
          <span role="columnheader">설명</span>
          <span role="columnheader" className="c-maker">만든 사람</span>
          <span role="columnheader" className="c-kind">종류</span>
          <span role="columnheader" className="c-when">언제</span>
          <span role="columnheader" className="c-num">비용</span>
          <span role="columnheader" className="c-state">도장</span>
        </div>
        {p.rows.map((r) => {
          const on = r.id === p.selectedId;
          const sub = r.state === 'done' ? r.sub : r.stateLabel || r.sub;
          return (
            <div key={r.id} className={`bae-rtr bae-rrow${on ? ' is-on' : ''}`} role="row">
              <span role="cell" className="bae-row-acts bae-pick-cell">{pickBox(r, 'bae-pick')}</span>
              <span role="cell" className="bae-thumb">{r.thumb ? <img src={r.thumb} alt="" /> : null}</span>
              <span role="cell" className="bae-cell-desc">
                <button type="button" className="bae-row-btn" aria-pressed={on} aria-label={`${r.name || r.title} (${r.maker}) ${pickLabel}`} onClick={() => p.onPick(r.id)}>
                  <span className="bae-row-title">{r.name || r.title}</span>
                  <span className={`bae-row-sub${tagCls(r)}`}>{r.name ? r.title : sub}</span>
                </button>
              </span>
              <span role="cell" className="c-maker bae-cell-text">{r.maker}</span>
              <span role="cell" className="c-kind bae-cell-text">{r.kindLabel}</span>
              <span role="cell" className="c-when bae-cell-text"><time>{r.when}</time></span>
              <span role="cell" className="c-num bae-num">{r.cost}</span>
              <span role="cell" className="c-state">
                {r.stamp ? stampMark(r) : r.state !== 'done' ? <span className={`bae-state${tagCls(r)}`}>{r.stateLabel}</span> : <span className="bae-state is-none">도장 없음</span>}
              </span>
            </div>
          );
        })}
      </div>
    );
  } else {
    body = (
      <div className="bae-rtable" role="table" aria-labelledby={headId}>
        <div className="bae-rtr bae-rthead" role="row">
          <span role="columnheader">그림</span>
          <span role="columnheader">설명</span>
          <span role="columnheader" className="c-kind">종류</span>
          <span role="columnheader" className="c-when">언제</span>
          <span role="columnheader" className="c-took c-num">걸린 시간</span>
          <span role="columnheader" className="c-num">비용</span>
          <span role="columnheader" className="c-state">상태</span>
          <span role="columnheader" className="bae-row-acts"><span className="bae-vh">이름</span></span>
        </div>
        {p.rows.map((r) => {
          const on = r.id === p.selectedId;
          const sub = r.state === 'done' ? r.sub : r.stateLabel || r.sub;
          return (
            <div key={r.id} className={`bae-rtr bae-rrow${on ? ' is-on' : ''}`} role="row">
              <span role="cell" className="bae-thumb">
                {r.thumb ? <img src={r.thumb} alt="" /> : null}
                {r.thumbAlt ? <img className="bae-thumb-alt" src={r.thumbAlt} alt="" /> : null}
              </span>
              <span role="cell" className="bae-cell-desc">
                {naming === r.id ? nameInput(r) : (
                  <button type="button" className="bae-row-btn" aria-pressed={on} aria-label={`${r.name || r.title} ${pickLabel}`} onClick={() => p.onPick(r.id)}>
                    <span className="bae-row-title">{r.name || r.title}</span>
                    <span className={`bae-row-sub${tagCls(r)}`}>{sub}</span>
                  </button>
                )}
              </span>
              <span role="cell" className="c-kind bae-cell-text">{r.kindLabel}</span>
              <span role="cell" className="c-when bae-cell-text"><time>{r.when}</time></span>
              <span role="cell" className={`c-took c-num bae-num${r.state === 'live' ? ' is-live' : ''}`}>{r.took}</span>
              <span role="cell" className="c-num bae-num">{r.cost}</span>
              <span role="cell" className="c-state">
                {r.state !== 'done'
                  ? <span className={`bae-state${tagCls(r)}`}>{r.stateLabel}</span>
                  : r.stamp ? <span className="bae-stamp-cell">{stampMark(r)}{r.fresh ? <Fresh /> : null}</span> : null}
              </span>
              <span role="cell" className="bae-row-acts">{nameBtn(r, false)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="bae-log" aria-labelledby={headId}>
      <div className="bae-log-head">
        <h2 className={p.scope ? 'bae-vh' : 'bae-h2'} id={headId}>{title}</h2>
        {p.scope}
        <div className="bae-log-tools">
          <div className="bae-seg" role="group" aria-label={`${title}을 보는 방식`}>
            <button type="button" className="bae-btn bae-btn-s" aria-pressed={p.view === 'grid'} onClick={() => p.onView('grid')}><LayoutGrid size={14} aria-hidden="true" />액자</button>
            <button type="button" className="bae-btn bae-btn-s" aria-pressed={p.view === 'list'} onClick={() => p.onView('list')}><List size={14} aria-hidden="true" />목록</button>
          </div>
          <span className="bae-search"><Search size={16} aria-hidden="true" /><input className="bae-search-input" type="search" autoComplete="off" aria-label={`${title}에서 찾기`} placeholder={p.searchLabel ?? '이름, 설명에서 찾기'} value={p.query} onChange={(e) => p.onQuery(e.target.value)} /></span>
          {p.onAll ? <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" onClick={p.onAll}>전체 기록</button> : null}
        </div>
      </div>
      {p.toolbar}
      {body}
      {p.more && !p.loading && !p.error && p.rows.length ? (
        <div className="bae-more">
          <button type="button" className="bae-btn bae-btn-s" disabled={p.more.loading} onClick={p.more.onMore}>
            {p.more.loading ? <Loader2 size={14} className="bae-spin" aria-hidden="true" /> : null}더 보기
          </button>
        </div>
      ) : null}
    </section>
  );
}
