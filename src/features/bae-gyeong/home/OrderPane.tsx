/**
 * 작업대 2 주문서 칸의 확인 판 (2026-11-18 한솔 피드백: 주문서가 다 되면 창 없이 작업대에서, HTML '2 주문서 확인'처럼).
 * 보낼 이미지 순서 → 상태 한 줄 → PD가 이렇게 이해했어요 (+ 스타일 예시) → PD 메모(노란 칸) → 개발자 지문 →
 * 한국어로 고쳐 달라고 하기 → 고친 기록 → 영어 주문서 보기(보기만) → 크기 · 품질 · 그림 모델 → 그림 만들기.
 * 보여 주기만 한다: 글자와 동작은 baeViewModel 이 만들어 넘긴다.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Info, Loader2, Sparkles, Wand2 } from 'lucide-react';
import type { BaeOrderPaneView } from './benchTypes';
import '../windows/bae-windows.css';
import './order-pane.css';

/** 주문서가 막 다 됐으면 잠깐 빛나는 표시 (움직임 최소에서는 CSS 가 끈다). */
function useFlash(at: number): boolean {
  const [on, setOn] = useState(() => at > 0 && Date.now() - at < 2400);
  useEffect(() => {
    if (!at || Date.now() - at > 2400) { setOn(false); return; }
    setOn(true);
    const t = window.setTimeout(() => setOn(false), Math.max(0, 2400 - (Date.now() - at)));
    return () => window.clearTimeout(t);
  }, [at]);
  return on;
}

export function OrderPane({ v }: { v: BaeOrderPaneView }) {
  const flash = useFlash(v.flashAt);
  const headRef = useRef<HTMLParagraphElement>(null);
  // 주문서가 막 다 됐으면 요약으로 눈길을 옮긴다 (돈이 나가는 버튼이 아니라 읽을 글로)
  useEffect(() => {
    if (!v.flashAt || Date.now() - v.flashAt > 2400) return;
    const el = headRef.current; if (!el) return;
    el.focus({ preventScroll: true });
    try { el.closest('.bae-pane')?.scrollIntoView({ block: 'nearest', behavior: document.documentElement.hasAttribute('data-motion-minimal') ? 'auto' : 'smooth' }); } catch { /* 옛 엔진 */ }
  }, [v.flashAt]);
  const tone = v.state === 'error' ? 'error' : v.state === 'misfit' ? 'warn' : v.state === 'stale' ? 'warn' : 'info';
  const r = v.revise; const d = v.draw;
  const dirPair = !!v.director && v.director.en.length === v.director.ko.length;

  return (
    <div className={`bae-op${flash ? ' is-flash' : ''}`}>
      {v.sendList.length ? (
        <section className="bae-op-send" aria-labelledby="bae-op-send-h">
          <p className="bae-op-h" id="bae-op-send-h">보낼 이미지 순서<span className="bae-op-h-sub">이 순서대로 그림 모델에 들어가요</span></p>
          <ol className="bae-op-send-list">
            {v.sendList.map((it, i) => (
              <li key={i} className="bae-op-send-item" style={{ ['--i' as string]: i }}>
                <span className="bae-op-send-pic"><img src={it.src} alt="" loading="lazy" decoding="async" /></span>
                <span className="bae-op-send-label" title={it.label}>{it.label}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {v.statusText ? (
        <p className={`bae-op-status is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
          {tone === 'info' ? <Info size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
          <span>{v.statusText}</span>
          {r?.onRemake && (v.state === 'misfit' || v.state === 'stale') ? <button type="button" className="bae-btn bae-btn-s bae-push" onClick={r.onRemake}>주문서 다시 만들기</button> : null}
        </p>
      ) : null}

      <section className="bae-op-card" aria-labelledby="bae-op-sum-h">
        <p className="bae-op-card-h" id="bae-op-sum-h" ref={headRef} tabIndex={-1}><Sparkles size={14} aria-hidden="true" />PD가 이렇게 이해했어요</p>
        <p className="bae-op-card-text">{v.summary || 'PD 요약이 없어요.'}</p>
        {v.style ? <p className="bae-op-card-style">{v.style}</p> : null}
      </section>

      {v.notes.length ? (
        <ul className="bae-op-notes" aria-label="PD 메모">
          {v.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      ) : null}

      {v.director && v.director.ko.length ? (
        <section className="bae-op-dir" aria-labelledby="bae-op-dir-h">
          <p className="bae-op-h" id="bae-op-dir-h">개발자 지문<span className="bae-op-h-sub">매뉴얼과 고정 문장보다 먼저 따라요</span></p>
          <ol className="bae-op-dir-list">
            {v.director.ko.map((t, i) => <li key={i}><span>{t}</span>{dirPair ? <span className="bae-op-dir-en">{v.director!.en[i]}</span> : null}</li>)}
          </ol>
          {v.director.replacedKo.length ? <p className="bae-hint">지문 때문에 뺀 고정 문장: {v.director.replacedKo.join(' · ')}</p> : null}
        </section>
      ) : null}

      {r ? (
        <section className="bae-op-revise" aria-labelledby="bae-op-rev-h">
          <label className="bae-op-h" id="bae-op-rev-h" htmlFor="bae-op-rev-in">한국어로 고쳐 달라고 하기{r.again ? <span className="bae-op-h-sub">고친 주문서로 새 그림을 그려요. 지금 그림은 기록에 남아요</span> : null}</label>
          {r.note ? (
            <p className={`bae-op-status is-${r.note.tone}`} role="status">
              {r.note.tone === 'warn' ? <AlertTriangle size={14} aria-hidden="true" /> : <Info size={14} aria-hidden="true" />}<span>{r.note.text}</span>
            </p>
          ) : null}
          {r.busySec != null ? (
            <p className="bae-op-busy" role="status">
              <Loader2 size={14} className="bae-spin" aria-hidden="true" /><span className="bae-num">PD가 고치는 중, {r.busySec}초째</span>
              <button type="button" className="bae-btn bae-btn-s bae-push" onClick={r.onStop}>그만두기</button>
            </p>
          ) : (
            <form className="bae-op-revise-row" onSubmit={(e) => { e.preventDefault(); if (!r.blocked) r.onRevise(); }}>
              <input id="bae-op-rev-in" className="bae-input" value={r.text} placeholder="예) 소파를 조금 더 크게, 커튼은 빼줘 · {지문}" onChange={(e) => r.onText(e.target.value)} />
              <button type="submit" className="bae-btn bae-btn-s" disabled={!r.text.trim() || !!r.blocked}><Wand2 size={14} aria-hidden="true" />고치기</button>
            </form>
          )}
        </section>
      ) : null}

      {v.revisions.length ? (
        <section className="bae-op-revs" aria-label="고친 기록">
          <p className="bae-op-h">고친 기록</p>
          <ol className="bae-op-rev-list">{v.revisions.map((t, i) => <li key={i}>{t}</li>)}</ol>
        </section>
      ) : null}

      {v.prompt ? (
        <details className="bae-op-prompt">
          <summary><ChevronDown size={14} aria-hidden="true" className="bae-op-chev" />영어 주문서 보기</summary>
          <pre className="bae-op-prompt-text">{v.prompt}</pre>
          {v.promptCount ? <p className="bae-hint bae-num">{v.promptCount}</p> : null}
        </details>
      ) : null}

      {d ? (
        <section className="bae-op-draw" aria-label="그림 만들기">
          <div className="bae-op-opts">
            <label className="bae-op-opt">
              <span className="bae-op-h">크기</span>
              <span className="bw-sel">
                <select className="bw-select bae-num" value={d.tier} onChange={(e) => d.onTier(e.target.value)}>
                  {d.tiers.map((t) => <option key={t.id} value={t.id} title={t.note || undefined}>{t.label} · {t.size[0]}×{t.size[1]}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </span>
            </label>
            <label className="bae-op-opt">
              <span className="bae-op-h">품질</span>
              <span className="bw-sel">
                <select className="bw-select" value={d.quality} onChange={(e) => d.onQuality(e.target.value)}>
                  {d.qualities.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </span>
            </label>
            <label className="bae-op-opt bae-op-opt-full">
              <span className="bae-op-h">그림 모델</span>
              <span className="bw-sel">
                <select className="bw-select" value={d.model} onChange={(e) => d.onModel(e.target.value)}>
                  {d.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </span>
            </label>
          </div>
          {d.hint ? <p className="bae-hint">{d.hint}</p> : null}
          <button type="button" className="bae-btn bae-btn-primary bae-btn-block bae-btn-center bae-op-go" disabled={!d.canDraw} onClick={d.onDraw}>그림 만들기</button>
        </section>
      ) : null}
    </div>
  );
}
