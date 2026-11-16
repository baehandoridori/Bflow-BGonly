// 한 건 보기의 확인 도장 칸 (계획 14 6-2): 지금 도장(景 낙관) · 누가 · 언제 · 한 줄 메모, 지난 차례.
// 검수자에게는 확인함 · 좋아요 · 다시 세 버튼과 한 줄 메모, 도장 빼기 (메뉴 안에 숨기지 않는다). 다시는 메모가 있어야 찍힌다.
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Loader2 } from 'lucide-react';
import type { BaeStampPanelView } from '../home/benchTypes';
import { Seal } from './Seal';
import './review.css';

const STAMPS = [
  { id: 'seen', label: '확인함', hint: '봤어요 · 만든 사람에게는 기록에만 보여요' },
  { id: 'good', label: '좋아요', hint: '이 방향이 좋아요 · 만든 사람의 景 아이콘에 숫자가 떠요' },
  { id: 'again', label: '다시', hint: '다시 해 보면 좋겠어요 · 한 줄 메모와 함께' },
] as const;

export function StampPanel({ v }: { v: BaeStampPanelView }) {
  const uid = useId();
  const [note, setNote] = useState(v.current?.note ?? '');
  const [warn, setWarn] = useState('');
  // 다른 기록을 열었거나 도장이 바뀌면 메모 칸을 그 도장의 메모로
  useEffect(() => { setNote(v.current?.note ?? ''); setWarn(''); }, [v.current?.id, v.current?.tone, v.current?.note]);
  const edit = v.edit;
  const press = (s: 'seen' | 'good' | 'again' | null) => {
    if (!edit || edit.saving || edit.blocked) return;
    if (s === 'again' && !note.trim()) { setWarn('다시 도장에는 한 줄 메모를 남겨 주세요.'); return; }
    setWarn(''); edit.onStamp(s, s === null ? '' : note);
  };
  const keys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault(); };
  const past = v.history.filter((h) => h.id !== v.current?.id || !v.current);
  return (
    <section className="bae-tool-group bae-stampbox" aria-labelledby={`${uid}-h`}>
      <p className="bae-tool-name" id={`${uid}-h`}>확인 도장</p>
      {v.current ? (
        <div className={`bae-stamp-now is-${v.current.tone}`}>
          <span className={`bae-stamp is-${v.current.tone}`}><Seal large /><span className="bae-stamp-big">{v.current.label}</span></span>
          <p className="bae-stamp-who">{v.current.by}{v.current.when ? ` · ${v.current.when}` : ''}{v.fresh ? <span className="bae-fresh">새 도장</span> : null}</p>
          {v.current.note ? <p className="bae-stamp-note">{v.current.note}</p> : null}
        </div>
      ) : <p className="bae-empty-text">{edit ? '아직 도장이 없어요.' : '검수자가 아직 도장을 찍지 않았어요.'}</p>}

      {edit ? (
        <div className="bae-stamp-edit">
          {edit.blocked ? <p className="bae-hint">{edit.blocked}</p> : null}
          <div className="bae-stamp-btns" role="group" aria-label="도장 고르기">
            {STAMPS.map((s) => (
              <button key={s.id} type="button" className={`bae-btn bae-btn-s bae-stamp-btn is-${s.id}`} aria-pressed={v.current?.tone === s.id} title={s.hint}
                disabled={edit.saving || !!edit.blocked} onClick={() => press(s.id)}>
                <Seal />{s.label}
              </button>
            ))}
          </div>
          <label className="bae-stamp-memo">
            <span className="bae-label">한 줄 메모 {note.length > 0 ? <span className="bae-num">({note.length}/400)</span> : null}</span>
            <input className="bae-input" type="text" maxLength={400} value={note} disabled={edit.saving || !!edit.blocked} onKeyDown={keys}
              onChange={(e) => { setNote(e.target.value.replace(/[\r\n]+/g, ' ')); if (warn) setWarn(''); }} placeholder="다시는 꼭 적어 주세요 (예: 칠판을 더 크게)" aria-invalid={!!warn} aria-describedby={warn ? `${uid}-w` : undefined} />
          </label>
          {warn ? <p className="bae-warn-text bae-stamp-warn" id={`${uid}-w`} role="alert">{warn}</p> : null}
          <div className="bae-row-line">
            {edit.saving ? <span className="bae-hint"><Loader2 size={12} className="bae-spin" aria-hidden="true" /> 찍는 중</span> : null}
            {v.current ? <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" disabled={edit.saving} onClick={() => press(null)}>도장 빼기</button> : null}
          </div>
          <p className="bae-hint">도장은 작업을 막지 않아요. 다시 찍으면 바뀌고, 누가 언제 찍었는지는 아래 차례에 남아요.</p>
        </div>
      ) : null}

      {past.length ? (
        <details className="bae-stamp-hist" open={past.length <= 3}>
          <summary>지난 차례 {past.length}건</summary>
          <ol>
            {past.map((h) => (
              <li key={h.id}>
                {h.tone ? <span className={`bae-stamp is-${h.tone}`}><Seal />{h.label}</span> : <span className="bae-stamp is-off">{h.label}</span>}
                <span className="bae-stamp-who">{h.by} · {h.when}</span>
                {h.note ? <span className="bae-stamp-note">{h.note}</span> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
