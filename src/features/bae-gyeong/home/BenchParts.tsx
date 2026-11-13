// 작업대와 한 건 보기가 같이 쓰는 작은 부품: 숫자 줄, 재료 묶음, PD 글, 결과 틀, 검수.
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ClipboardCheck, Palette } from 'lucide-react';
import type { BaeFactView, BaeMaterialsView, BaeOrderTextView, BaeReviewRate, BaeReviewView } from './benchTypes';
import './bench.css';

/** 이름 아래 값 (시안 .bae-dl) */
export function FactsDl({ facts, className }: { facts: BaeFactView[]; className?: string }) {
  if (!facts.length) return null;
  return (
    <dl className={`bae-dl${className ? ` ${className}` : ''}`}>
      {facts.map((f, i) => <div key={i} className="bae-fact"><dt>{f.k}</dt><dd className="bae-num">{f.v}</dd></div>)}
    </dl>
  );
}

/** 한 줄로 늘어놓은 숫자 (시안 .bae-inline-dl) */
export function InlineFacts({ facts, className }: { facts: BaeFactView[]; className?: string }) {
  if (!facts.length) return null;
  return (
    <dl className={`bae-inline-dl${className ? ` ${className}` : ''}`}>
      {facts.map((f, i) => <div key={i} className="bae-inline-fact"><dt>{f.k}</dt><dd className="bae-num">{f.v}</dd></div>)}
    </dl>
  );
}

/** 재료: 러프 · 레퍼런스 · 그림체 기준 줄 · 설명과 비율 · 장소 · 시간대 · 투시 */
export function MaterialsBlock({ mat, onOpenStyle, full }: { mat: BaeMaterialsView; onOpenStyle?: () => void; full?: boolean }) {
  return (
    <>
      {mat.rough ? (
        <ul className="bae-mats">
          <li className="bae-mrow">
            <span className="bae-mthumb bae-mthumb-l"><img src={mat.rough.src} alt={mat.rough.alt} /></span>
            <div className="bae-mtext"><p className="bae-mname">{mat.rough.name}</p>{mat.rough.sub ? <p className="bae-msub">{mat.rough.sub}</p> : null}</div>
          </li>
        </ul>
      ) : null}
      <section className="bae-mgroup" aria-label="레퍼런스">
        <div className="bae-mhead"><p className="bae-mhead-name">레퍼런스</p><span className="bae-mcount bae-num">{mat.refs.length}/{mat.refMax}</span></div>
        {mat.refs.length ? (
          <ul className="bae-mats">
            {mat.refs.map((r) => (
              <li key={r.id} className="bae-mrow">
                <span className="bae-mthumb"><img src={r.src} alt={r.alt} /></span>
                <p className="bae-mnote">{r.note}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {mat.styleRow ? (
        <div className="bae-style">
          <span className="bae-style-thumb"><img src={mat.stripSrc} alt="" /></span>
          <p className="bae-style-text"><span className="bae-style-name">그림체 기준</span><span className="bae-style-sub">{mat.styleRow}</span></p>
          {onOpenStyle ? <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" aria-label="그림체 기준 설정 열기" onClick={onOpenStyle}><Palette size={14} aria-hidden="true" />설정</button> : null}
        </div>
      ) : null}
      <dl className="bae-dl">
        {mat.desc ? <div className="bae-fact bae-wide"><dt>{mat.descLabel}</dt><dd className={full ? 'bae-pre' : 'bae-clamp'}>{mat.desc}</dd></div> : null}
        {mat.facts.map((f, i) => <div key={i} className="bae-fact"><dt>{f.k}</dt><dd className="bae-num">{f.v}</dd></div>)}
      </dl>
    </>
  );
}

/** PD 글: 요약 · 고쳐 달라고 한 말 · PD 메모 · 스타일 예시 · 덧붙임 */
export function OrderBlock({ order, children }: { order: BaeOrderTextView; children?: ReactNode }) {
  return (
    <dl className="bae-dl">
      <div className="bae-fact bae-wide"><dt>PD 요약</dt><dd>{order.summary}</dd></div>
      {order.ask ? <div className="bae-fact bae-wide"><dt>고쳐 달라고 한 말</dt><dd>{order.ask}</dd></div> : null}
      {order.notes.length ? (
        <div className="bae-fact bae-wide"><dt>PD 메모</dt><dd><ul className="bae-pdnotes">{order.notes.map((n, i) => <li key={i} className="bae-pdnote"><AlertTriangle size={14} aria-hidden="true" /><span>{n}</span></li>)}</ul></dd></div>
      ) : null}
      {order.style ? <div className="bae-fact bae-wide"><dt>스타일 예시</dt><dd>{order.style}</dd></div> : null}
      {order.pdNote ? <div className="bae-fact bae-wide"><dt className="bae-vh">참고</dt><dd className="bae-note">{order.pdNote}</dd></div> : null}
      {children}
    </dl>
  );
}

/** 결과 틀: 고정 비율 칸(작업대 25:16, 한 건 보기 16:9) 안에 그림 비율대로. 칸보다 넓은 그림은 너비에 맞춘다(is-wide). */
export function ResultFrame({ aspect, boxAspect, children }: { aspect: number; boxAspect: number; children: ReactNode }) {
  const ar = aspect > 0 ? aspect : 1.5;
  return (
    <div className={`bae-frame${ar > boxAspect + 0.001 ? ' is-wide' : ''}`} style={{ aspectRatio: String(ar) }}>{children}</div>
  );
}

const RATES: BaeReviewRate[] = ['좋음', '보통', '다시'];

/** 검수 남기기 (선택): 좋음 · 보통 · 다시 + 좋았던 점 · 아쉬운 점. 고르는 동안의 글은 여기서만 들고, '기록하기'에 넘긴다. */
export function ReviewPanel({ value, startOpen, saving, onSave }: { value: BaeReviewView; startOpen?: boolean; saving?: boolean; onSave(v: BaeReviewView): void }) {
  const [open, setOpen] = useState(!!startOpen);
  const [draft, setDraft] = useState<BaeReviewView>(value);
  useEffect(() => { if (!open) setDraft(value); }, [value, open]);
  return (
    <section className="bae-rev" aria-labelledby="bae-rev-h">
      <div className="bae-rev-head"><h3 className="bae-side-title" id="bae-rev-h">검수</h3><span className="bae-opt">선택</span></div>
      {!open ? (
        <>
          <p className="bae-hint">{value.rate ? `남긴 검수: ${value.rate}. 언제든 고칠 수 있어요.` : '원할 때만 남겨요. 남기지 않아도 저장하고 이어서 만들 수 있어요.'}</p>
          <div className="bae-rev-acts"><button type="button" className="bae-btn bae-btn-s" onClick={() => setOpen(true)}><ClipboardCheck size={14} aria-hidden="true" />{value.rate ? '검수 고치기' : '검수 남기기'}</button></div>
        </>
      ) : (
        <>
          <p className="bae-hint">이 그림이 어땠는지 남겨요. 관리자의 확인 도장과는 따로예요.</p>
          <div className="bae-seg bae-seg-fill" role="group" aria-labelledby="bae-rev-h">
            {RATES.map((r) => (
              <button key={r} type="button" className="bae-btn bae-btn-s" aria-pressed={draft.rate === r} onClick={() => setDraft({ ...draft, rate: draft.rate === r ? '' : r })}>{r}</button>
            ))}
          </div>
          <div className="bae-field"><label className="bae-label" htmlFor="bae-rev-good">좋았던 점</label><textarea className="bae-textarea bae-rev-text" id="bae-rev-good" rows={2} value={draft.good} onChange={(e) => setDraft({ ...draft, good: e.target.value })} /></div>
          <div className="bae-field"><label className="bae-label" htmlFor="bae-rev-bad">아쉬운 점</label><textarea className="bae-textarea bae-rev-text" id="bae-rev-bad" rows={2} value={draft.bad} onChange={(e) => setDraft({ ...draft, bad: e.target.value })} /></div>
          <div className="bae-rev-acts">
            <button type="button" className="bae-btn bae-btn-tint bae-btn-s" disabled={saving} onClick={() => { onSave(draft); setOpen(false); }}>기록하기</button>
            <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" onClick={() => { setDraft(value); setOpen(false); }}>접기</button>
          </div>
        </>
      )}
    </section>
  );
}
