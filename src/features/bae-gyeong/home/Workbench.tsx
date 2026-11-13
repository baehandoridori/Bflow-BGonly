/**
 * 작업대 (BAE경의 메인 화면, 계획 14b 10-2): 시작 줄 → 작업판(1 재료 · 2 주문서 · 3 결과) → 내 기록.
 * bench 가 없으면 1단계의 빈 작업대. 진행 중이면 결과 칸에 작게 접은 진행 줄(시안 OrderingSmall).
 * 보여 주기만 한다: 글자 · 숫자는 상태 쪽이 만들어 넘기고, 누른 것은 actions 로 알린다.
 */
import { AlertTriangle, ClipboardCheck, ClipboardPaste, CopyPlus, Download, Eraser, Layers, Loader2, Maximize2, Pencil, Plus, Rotate3d, Scaling, Upload } from 'lucide-react';
import { useState } from 'react';
import type { BaeBenchActions, BaeBenchView, BaeBusyView, BaeStartKind, BaeWorkbenchProps } from './benchTypes';
import { InlineFacts, MaterialsBlock, OrderBlock, ResultFrame } from './BenchParts';
import { RecordList } from '../records/RecordList';
import './bench.css';

export type { BaeStartKind } from './benchTypes';

const BOX = 25 / 16; // 결과 칸 비율

export function Workbench({ onStart, bench, busy, benchLoading, benchError, onBenchRetry, actions = {}, log }: BaeWorkbenchProps) {
  // 기록을 넘기지 않으면(1단계 화면) 보기 방식 · 찾기는 여기서만 든다
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [q, setQ] = useState('');
  return (
    <>
      <section className="bae-start" aria-label="시작하기">
        <div className="bae-start-group">
          <button type="button" className="bae-btn bae-btn-primary" onClick={() => onStart('new')}><Plus size={16} aria-hidden="true" />새 배경 만들기</button>
          <button type="button" className="bae-btn bae-btn-tint bae-tool bae-tool-same" onClick={() => onStart('same')}><CopyPlus size={16} aria-hidden="true" />같은 장소 다른 컷</button>
        </div>
        <div className="bae-start-group bae-push" role="group" aria-labelledby="bae-tools-label">
          <span className="bae-group-label" id="bae-tools-label">그림 불러와 도구만</span>
          <button type="button" className="bae-btn bae-btn-tool bae-tool bae-tool-layers" onClick={() => onStart('layers')}><Layers size={16} aria-hidden="true" />레이어로 나누기</button>
          <button type="button" className="bae-btn bae-btn-tool bae-tool bae-tool-angle" onClick={() => onStart('angle')}><Rotate3d size={16} aria-hidden="true" />다른 각도로</button>
          <button type="button" className="bae-btn bae-btn-tool bae-tool bae-tool-upscale" onClick={() => onStart('upscale')}><Scaling size={16} aria-hidden="true" />4K로 키우기</button>
          <button type="button" className="bae-btn bae-btn-tool bae-tool bae-tool-denoise" onClick={() => onStart('denoise')}><Eraser size={16} aria-hidden="true" />노이즈 제거</button>
        </div>
      </section>

      <section className="bae-bench" aria-labelledby="bae-bench-h">
        <h2 className="bae-vh" id="bae-bench-h">작업판</h2>
        {benchError ? (
          <div className="bae-msg bae-bench-err" role="alert">
            <AlertTriangle size={20} aria-hidden="true" />
            <p className="bae-msg-title">하던 작업을 불러오지 못했어요</p>
            <p className="bae-msg-text">{benchError}</p>
            {onBenchRetry ? <button type="button" className="bae-btn bae-btn-s" onClick={onBenchRetry}>다시 시도</button> : null}
          </div>
        ) : benchLoading ? <LoadingPanes /> : bench ? <FullPanes bench={bench} busy={busy ?? null} a={actions} /> : <EmptyPanes onStart={onStart} />}
      </section>

      {log ? <RecordList {...log} /> : (
        <RecordList rows={[]} total={0} view={view} onView={setView} query={q} onQuery={setQ} onPick={() => {}} />
      )}
    </>
  );
}

function EmptyPanes({ onStart }: { onStart: (kind: BaeStartKind) => void }) {
  return (
    <ol className="bae-panes">
      <li className="bae-pane">
        <div className="bae-pane-head"><h3 className="bae-pane-title">1 재료</h3></div>
        <div className="bae-pane-body">
          <p className="bae-empty-text">러프, 레퍼런스, 기준 배경을 여기에 넣어요.</p>
          <div className="bae-empty-acts">
            <button type="button" className="bae-btn bae-btn-block" onClick={() => onStart('new')}><Pencil size={16} aria-hidden="true" />러프 그리기</button>
            <button type="button" className="bae-btn bae-btn-block" onClick={() => onStart('new')}><ClipboardPaste size={16} aria-hidden="true" />그림 붙여넣기</button>
            <button type="button" className="bae-btn bae-btn-block" onClick={() => onStart('new')}><Upload size={16} aria-hidden="true" />파일 고르기</button>
          </div>
        </div>
      </li>
      <li className="bae-pane">
        <div className="bae-pane-head"><h3 className="bae-pane-title">2 주문서</h3></div>
        <div className="bae-pane-body"><p className="bae-empty-text">재료를 넣으면 PD가 한국어 요약과 주문서를 여기에 써요.</p></div>
      </li>
      <li className="bae-pane">
        <div className="bae-pane-head"><h3 className="bae-pane-title">3 결과</h3></div>
        <div className="bae-pane-body"><div className="bae-well"><p className="bae-empty-text">주문서대로 그린 그림이 여기에 와요.</p></div></div>
      </li>
    </ol>
  );
}

function LoadingPanes() {
  return (
    <ol className="bae-panes" aria-busy="true">
      <li className="bae-pane">
        <div className="bae-pane-head"><h3 className="bae-pane-title">1 재료</h3></div>
        <div className="bae-pane-body" aria-hidden="true"><span className="bae-sk bae-sk-img" /><span className="bae-sk-lines"><span className="bae-sk bae-sk-w90" /><span className="bae-sk bae-sk-w70" /><span className="bae-sk bae-sk-w50" /></span></div>
      </li>
      <li className="bae-pane">
        <div className="bae-pane-head"><h3 className="bae-pane-title">2 주문서</h3></div>
        <div className="bae-pane-body" aria-hidden="true"><span className="bae-sk-lines"><span className="bae-sk bae-sk-w30" /><span className="bae-sk bae-sk-w90" /><span className="bae-sk bae-sk-w90" /><span className="bae-sk bae-sk-w70" /><span className="bae-sk bae-sk-w90" /><span className="bae-sk bae-sk-w50" /></span></div>
      </li>
      <li className="bae-pane">
        <div className="bae-pane-head"><h3 className="bae-pane-title">3 결과</h3></div>
        <div className="bae-pane-body" aria-hidden="true"><span className="bae-sk bae-sk-stage bae-sk-res" /><span className="bae-sk-lines"><span className="bae-sk bae-sk-w50" /></span></div>
      </li>
    </ol>
  );
}

function FullPanes({ bench: b, busy, a }: { bench: BaeBenchView; busy: BaeBusyView | null; a: BaeBenchActions }) {
  const ordering = busy?.phase === 'order';
  const rate = b.review?.rate ?? '';
  const shotCls = busy ? (busy.phase === 'order' ? ' is-wait' : busy.partial ? ' is-partial' : ' is-wait') : '';
  return (
    <ol className="bae-panes">
      <li className="bae-pane">
        <div className="bae-pane-head">
          <h3 className="bae-pane-title">1 재료</h3>
          {b.matAct && a.onEditMat ? <button type="button" className="bae-btn bae-btn-s bae-push" onClick={a.onEditMat}><Pencil size={14} aria-hidden="true" />{b.matAct}</button> : null}
        </div>
        <div className="bae-pane-body"><MaterialsBlock mat={b.mat} onOpenStyle={a.onOpenStyle} /></div>
      </li>

      <li className="bae-pane">
        <div className="bae-pane-head">
          <h3 className="bae-pane-title">2 주문서</h3>
          {b.order && !ordering ? <InlineFacts facts={b.order.head} className="bae-head-dl" /> : null}
        </div>
        <div className="bae-pane-body">
          {ordering && busy ? (
            <>
              <p className="bae-writing" role="status"><Loader2 size={16} className="bae-spin" aria-hidden="true" /><span>{busy.main}</span></p>
              <span className="bae-sk-lines" aria-hidden="true"><span className="bae-sk bae-sk-w30" /><span className="bae-sk bae-sk-w90" /><span className="bae-sk bae-sk-w90" /><span className="bae-sk bae-sk-w70" /></span>
              <p className="bae-empty-text">다 쓰면 한국어 요약이 여기에 나와요. 읽어 보고 그림을 만들어요.</p>
            </>
          ) : b.order ? (
            <>
              <OrderBlock order={b.order} />
              {b.orderReady && !busy && a.onOpenOrder ? (
                <div className="bae-pane-foot"><button type="button" className="bae-btn bae-btn-primary bae-btn-block bae-btn-center" onClick={a.onOpenOrder}>주문서 확인하고 그리기</button></div>
              ) : null}
            </>
          ) : <p className="bae-empty-text">재료를 넣으면 PD가 한국어 요약과 주문서를 여기에 써요.</p>}
        </div>
      </li>

      <li className="bae-pane">
        <div className="bae-pane-head">
          <h3 className="bae-pane-title">3 결과</h3>
          <p className="bae-job">{b.named ? <span className="bae-job-name">{b.title}</span> : null}<span>{b.kindLabel}</span><time>{b.when}</time></p>
        </div>
        <div className="bae-pane-body">
          {busy ? (
            <>
              <div className="bae-stage">
                <ResultFrame aspect={busy.aspect} boxAspect={BOX}>
                  {busy.src ? <img className={`bae-shot${shotCls}`} src={busy.src} alt="" /> : null}
                </ResultFrame>
              </div>
              <div className="bae-drawing" role="status">
                <span className="bae-drawing-main"><Loader2 size={16} className="bae-spin" aria-hidden="true" /><span className="bae-num">{busy.main}</span></span>
                <span className="bae-drawing-sub">{busy.sub}</span>
                {a.onExpand ? <button type="button" className="bae-btn bae-btn-s bae-push" aria-label="만드는 화면 크게 보기" onClick={a.onExpand}><Maximize2 size={14} aria-hidden="true" />크게 보기</button> : null}
                {a.onStop ? <button type="button" className={`bae-btn bae-btn-s${a.onExpand ? '' : ' bae-push'}`} onClick={a.onStop}>그만두기</button> : null}
              </div>
            </>
          ) : b.result ? (
            <div className="bae-stage">
              <ResultFrame aspect={b.result.aspect} boxAspect={BOX}>
                <img className="bae-shot" src={b.result.src} alt={b.result.alt} />
                {a.onZoom ? <button type="button" className="bae-hit" aria-label="결과 그림 크게 보기" onClick={a.onZoom}><span className="bae-hit-chip"><Maximize2 size={14} aria-hidden="true" /></span></button> : null}
              </ResultFrame>
            </div>
          ) : b.failed ? (
            <div className="bae-stage bae-well bae-msg" role="alert">
              <AlertTriangle size={20} aria-hidden="true" />
              <p className="bae-msg-title">{b.failed.title}</p>
              <p className="bae-msg-text">{b.failed.text}</p>
              {a.onRetry ? <button type="button" className="bae-btn bae-btn-s" onClick={a.onRetry}>다시 시도</button> : null}
            </div>
          ) : (
            <div className="bae-stage bae-well bae-stage-empty">
              <p className="bae-empty-text">{b.orderReady ? "아직 그림이 없어요. 주문서를 확인한 뒤 '그림 만들기'를 눌러 주세요." : '주문서대로 그린 그림이 여기에 와요.'}</p>
            </div>
          )}

          {b.result && !busy ? (
            <div className="bae-res-bar">
              <div className="bae-res-view">
                {a.onZoom ? <button type="button" className="bae-btn bae-btn-s" onClick={a.onZoom}><Maximize2 size={14} aria-hidden="true" />크게 보기</button> : null}
              </div>
              {b.review && a.onReview ? (
                <button type="button" className={`bae-btn bae-btn-ghost bae-btn-s${rate ? ' is-on' : ''}`} onClick={a.onReview}><ClipboardCheck size={14} aria-hidden="true" />{rate ? `검수: ${rate}` : '검수 남기기 (선택)'}</button>
              ) : null}
            </div>
          ) : null}

          <div className="bae-res-foot">
            <InlineFacts facts={busy ? busy.facts : b.result ? b.result.facts : []} />
            {b.result && !busy && a.onSave ? (
              <div className="bae-res-acts"><button type="button" className="bae-btn bae-btn-s" onClick={a.onSave}><Download size={14} aria-hidden="true" />PNG 저장</button></div>
            ) : null}
          </div>
        </div>
      </li>
    </ol>
  );
}
