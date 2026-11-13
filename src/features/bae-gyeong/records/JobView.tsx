// 한 건 보기 (시안 Zoom 바탕): 결과 그림을 크게, 그 아래 재료와 PD 글을 모두, 오른쪽에 숫자 · 만든 때 · 검수 · 내보내기.
// 기록에서 한 건을 누르거나 작업대의 '크게 보기'로 연다. 보여 주기만 하고 바뀐 것은 콜백으로 알린다.
import { AlertTriangle, ArrowLeft, Download, Loader2 } from 'lucide-react';
import type { BaeJobViewProps } from '../home/benchTypes';
import { FactsDl, InlineFacts, MaterialsBlock, OrderBlock, ResultFrame, ReviewPanel } from '../home/BenchParts';
import '../home/bench.css';

export function JobView(p: BaeJobViewProps) {
  const pd = p.pd;
  const dirPair = !!pd?.director && pd.director.en.length === pd.director.ko.length;
  return (
    <section className="bae-view bae-jv" aria-labelledby="bae-jv-h">
      <div className="bae-view-head">
        <button type="button" className="bae-btn bae-btn-s" onClick={p.onBack}><ArrowLeft size={14} aria-hidden="true" />{p.backLabel}</button>
        <h2 className="bae-view-title" id="bae-jv-h">{p.title}</h2>
        <p className="bae-job"><span>{p.kindLabel}</span><time>{p.when}</time></p>
      </div>
      <div className="bae-view-main">
        <div className="bae-view-left">
          {p.failed && !p.result ? (
            <div className="bae-stage bae-well bae-msg bae-jv-fail" role="alert">
              <AlertTriangle size={20} aria-hidden="true" />
              <p className="bae-msg-title">{p.failed.title}</p>
              <p className="bae-msg-text">{p.failed.text}</p>
            </div>
          ) : (
            <div className="bae-stage">
              {p.result ? (
                <ResultFrame aspect={p.result.aspect} boxAspect={16 / 9}>
                  <img className="bae-shot" src={p.result.src} alt={p.result.alt} />
                </ResultFrame>
              ) : (
                <div className="bae-well bae-stage-empty">
                  {p.live ? <p className="bae-writing" role="status"><Loader2 size={16} className="bae-spin" aria-hidden="true" /><span>{p.live.main}</span></p> : null}
                  <p className="bae-empty-text">{p.live ? p.live.sub : '주문서대로 그린 그림이 여기에 와요.'}</p>
                </div>
              )}
            </div>
          )}

          <div className="bae-jv-cols">
            <section className="bae-jv-sec" aria-labelledby="bae-jv-mat-h">
              <h3 className="bae-side-title" id="bae-jv-mat-h">재료</h3>
              <MaterialsBlock mat={p.mat} full />
            </section>
            <section className="bae-jv-sec" aria-labelledby="bae-jv-pd-h">
              <div className="bae-jv-sec-head">
                <h3 className="bae-side-title" id="bae-jv-pd-h">PD 글</h3>
                {pd ? <InlineFacts facts={pd.head} /> : null}
              </div>
              {pd ? (
                <>
                  <OrderBlock order={pd} />
                  {pd.director && pd.director.ko.length ? (
                    <div className="bae-jv-dir">
                      <p className="bae-jv-dir-h">개발자 지문 · 매뉴얼과 고정 문장보다 먼저 따랐어요</p>
                      <ol className="bae-jv-dir-list">
                        {pd.director.ko.map((t, i) => <li key={i}><span>{t}</span>{dirPair ? <span className="bae-jv-dir-en">{pd.director!.en[i]}</span> : null}</li>)}
                      </ol>
                    </div>
                  ) : null}
                  {pd.revisions.length ? (
                    <div className="bae-jv-block">
                      <p className="bae-label">고친 기록</p>
                      <ol className="bae-jv-revs">{pd.revisions.map((t, i) => <li key={i}>{t}</li>)}</ol>
                    </div>
                  ) : null}
                  {pd.prompt ? (
                    <details className="bae-jv-prompt">
                      <summary>영어 주문서 보기</summary>
                      <pre className="bae-jv-prompt-text">{pd.prompt}</pre>
                    </details>
                  ) : null}
                </>
              ) : <p className="bae-empty-text">재료를 넣으면 PD가 한국어 요약과 주문서를 여기에 써요.</p>}
            </section>
          </div>
        </div>

        <div className="bae-view-side">
          <FactsDl facts={p.facts} />
          {p.review ? <ReviewPanel value={p.review.value} startOpen={p.review.startOpen} saving={p.review.saving} onSave={p.review.onSave} /> : null}
          {p.onSave && p.result ? (
            <div className="bae-tool-group bae-end" role="group" aria-labelledby="bae-jv-out">
              <p className="bae-tool-name" id="bae-jv-out">내보내기</p>
              <div className="bae-tool-row">
                <button type="button" className="bae-btn bae-btn-s" onClick={p.onSave}><Download size={14} aria-hidden="true" />PNG 저장</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
