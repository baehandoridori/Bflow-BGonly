// 만드는 창 (계획 14e 4장): 왼쪽 = 고른 비율의 틀 안 러프 · 화면 비율 · 크기 · 보낼 이미지 순서 (늘 보임),
// 오른쪽 = PD 요약 · 메모 · 스타일 예시 · { } 지문 · 고치기 · 고친 기록 · 영어 주문서 (길면 오른쪽만 스크롤) + 상태 한 줄,
// 발 = 그림 모델 · 크기 · 값 안내와 '그림 만들기'. 열릴 때 포커스는 요약 머리글 (돈이 나가는 버튼에 두지 않는다).
import { useRef, type CSSProperties } from 'react';
import { AlertTriangle, ArrowLeft, Copy, Eye, EyeOff, ImagePlus, Info, Loader2 } from 'lucide-react';
import { BaeWindow } from './BaeWindow';
import type { MakeWindowProps } from '../make/ui';
import './bae-stage2-windows.css';

/** ui.ts 의 MakeWindowProps 에 더한 것: 'PD 오류'의 다시 시도 (없으면 주문서 다시 만들기를 부른다). */
export type MakeWindowAllProps = MakeWindowProps & { onRetry?: () => void };

const ratioOf = (id: string) => { const [w, h] = id.split(':').map(Number); return w > 0 && h > 0 ? [w, h] : [16, 9]; };

export function MakeWindow(p: MakeWindowAllProps) {
  const sumRef = useRef<HTMLHeadingElement>(null);
  const revising = p.state === 'revising';
  const locked = !p.canDraw || revising || p.state === 'misfit' || p.state === 'error';
  const [rw, rh] = ratioOf(p.ratio);
  const tierNow = p.tiers.find((t) => t.id === p.tier);
  const px = tierNow ? `${tierNow.size[0]} × ${tierNow.size[1]}` : '';
  const ratioHint = p.ratios.find((r) => r.id === p.ratio)?.hint ?? '';
  const fit: CSSProperties = { width: `min(100cqw, calc(100cqh * ${(rw / rh).toFixed(4)}))`, aspectRatio: `${rw} / ${rh}` };
  const tone = p.state === 'error' ? 'error' : p.state === 'misfit' ? 'warn' : 'info';
  const dirPair = !!p.director && p.director.en.length === p.director.ko.length;

  return (
    <BaeWindow
      tool="make"
      icon={<ImagePlus size={18} aria-hidden="true" />}
      title="그림 만들기"
      sub="주문서를 읽고, 화면을 고르고, 만들어요"
      autoOpened={p.autoOpened}
      initialFocus={sumRef}
      headActions={(
        <>
          {p.onCopyForChat ? <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" onClick={p.onCopyForChat}><Copy size={14} aria-hidden="true" />ChatGPT용 글 복사</button> : null}
          <button type="button" className="bae-btn bae-btn-s" onClick={p.onBack}><ArrowLeft size={14} aria-hidden="true" />재료로 돌아가기</button>
        </>
      )}
      footNote={p.footNote}
      footActions={<button type="button" className="bae-btn bae-btn-primary" disabled={locked} onClick={p.onDraw}>그림 만들기</button>}
      onClose={p.onClose}
    >
      <div className="bw-cols">
        <div className="bw-main bae-mk-left">
          <div className="bae-mk-board">
            <div className="bae-mk-fit" style={fit}>
              <img className="bae-mk-rough" src={p.hasNotes && p.showNotes ? p.roughSrc : p.roughPlainSrc} alt="러프 미리보기" />
              {p.hasNotes ? (
                <button type="button" className="bae-mk-chip bae-mk-notes" aria-pressed={p.showNotes} onClick={() => p.onShowNotes(!p.showNotes)}>
                  {p.showNotes ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}빨간 메모 보이기
                </button>
              ) : null}
              <span className="bae-mk-chip bae-mk-px bae-num" aria-label={`그림 크기 ${px}`}>{px}</span>
            </div>
          </div>

          <div className="bw-bar">
            <span className="bae-label" id="bae-mk-ratio-h">화면 비율</span>
            <div className="bw-chips bae-chips" role="group" aria-labelledby="bae-mk-ratio-h">
              {p.ratios.map((r) => (
                <button key={r.id} type="button" className="bae-btn bae-btn-s bae-num" aria-pressed={r.id === p.ratio} title={r.hint || undefined} onClick={() => p.onRatio(r.id)}>{r.id}</button>
              ))}
            </div>
            {ratioHint ? <span className="bae-hint bw-bar-end">{ratioHint}</span> : null}
          </div>

          <div className="bae-mk-size">
            <span className="bae-label" id="bae-mk-size-h">크기</span>
            <div className="bae-mk-tiers" role="group" aria-labelledby="bae-mk-size-h">
              {p.tiers.map((t) => (
                <button key={t.id} type="button" className="bae-mk-tier" aria-pressed={t.id === p.tier} title={t.note || undefined} onClick={() => p.onTier(t.id)}>
                  <span className="bae-mk-tier-name">{t.label}</span>
                  <span className="bae-mk-tier-px bae-num">{t.size[0]}×{t.size[1]}</span>
                </button>
              ))}
            </div>
            {p.sizeNote ? <p className="bae-hint">{p.sizeNote}</p> : null}
          </div>

          <div className="bae-mk-send">
            <p className="bae-label">보낼 이미지 순서 <span className="bae-mk-send-sub">이 순서대로 그림 모델에 들어가요</span></p>
            <ol className="bae-mk-send-list">
              {p.sendList.map((s, i) => (
                <li key={i} className="bae-mk-send-item" title={s.label}>
                  <span className="bae-mk-send-pic"><img src={s.src} alt="" /><span className="bae-mk-send-n bae-num">{i + 1}</span></span>
                  <span className="bae-mk-send-label">{s.label}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="bae-mk-side">
          <div className="bae-mk-scroll">
            <section className="bae-mk-sum" aria-labelledby="bae-mk-sum-h" aria-busy={revising || undefined}>
              <h3 className="bae-mk-sum-h" id="bae-mk-sum-h" ref={sumRef} tabIndex={-1}>PD가 이렇게 이해했어요</h3>
              {revising ? (
                <div className="bae-mk-revising" role="status">
                  <Loader2 size={16} className="bae-spin" aria-hidden="true" />
                  <span className="bae-mk-revising-text">PD가 고치는 중</span>
                  <span className="bae-hint bae-num">{p.revisingSeconds}초째</span>
                  <button type="button" className="bae-btn bae-btn-s bae-push" onClick={p.onStopRevise}>그만두기</button>
                </div>
              ) : <p className="bae-mk-sum-text">{p.summary}</p>}
            </section>

            {p.notes.length ? (
              <section className="bae-mk-block" aria-labelledby="bae-mk-notes-h">
                <h3 className="bae-label" id="bae-mk-notes-h">PD 메모</h3>
                <ul className="bae-pdnotes">{p.notes.map((n, i) => <li key={i} className="bae-pdnote"><AlertTriangle size={14} aria-hidden="true" /><span>{n}</span></li>)}</ul>
              </section>
            ) : null}

            {p.picks.length || p.reason ? (
              <section className="bae-mk-block" aria-labelledby="bae-mk-style-h">
                <h3 className="bae-label" id="bae-mk-style-h">스타일 예시</h3>
                {p.picks.length ? (
                  <ul className="bae-mk-picks">
                    {p.picks.map((k) => (
                      <li key={k.id} className="bae-mk-pick">
                        <span className="bw-thumb"><img src={k.src} alt="" /></span>
                        <span className="bae-mk-pick-name"><span className="bae-num">{k.id}</span> {k.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {p.reason ? <p className="bae-mk-text">{p.reason}</p> : null}
              </section>
            ) : null}

            {p.director && p.director.ko.length ? (
              <section className="bae-mk-dir" aria-labelledby="bae-mk-dir-h">
                <h3 className="bae-mk-dir-h" id="bae-mk-dir-h">개발자 지문 · 매뉴얼과 고정 문장보다 먼저 따랐어요</h3>
                <ol className="bae-mk-dir-list">
                  {p.director.ko.map((t, i) => (
                    <li key={i}><span>{t}</span>{dirPair ? <span className="bae-mk-dir-en">{p.director!.en[i]}</span> : null}</li>
                  ))}
                </ol>
                {!dirPair && p.director.en.length ? <p className="bae-hint">영어로: {p.director.en.join(' ')}</p> : null}
                <p className="bae-hint">{p.director.replacedKo.length ? `지문에 맞춰 PD가 고쳐 쓴 고정 문장: ${p.director.replacedKo.join(', ')} · ` : ''}주문서 맨 끝에 지문 문장을 붙였어요</p>
              </section>
            ) : null}

            <form className="bae-mk-revise" onSubmit={(e) => { e.preventDefault(); if (!revising && p.reviseText.trim()) p.onRevise(); }}>
              <label className="bae-label" htmlFor="bae-mk-revise-text">한국어로 고쳐 달라고 하기</label>
              <div className="bae-mk-revise-row">
                <input className="bae-minput" id="bae-mk-revise-text" type="text" value={p.reviseText} onChange={(e) => p.onReviseText(e.target.value)} placeholder="예) 소파를 조금 더 크게, 커튼은 빼줘 · {지문}" />
                <button type="submit" className="bae-btn bae-btn-s" disabled={revising || !p.reviseText.trim()}>고치기</button>
              </div>
              <p className="bae-hint">PD 한 번 약 40원</p>
            </form>

            {p.revisions.length ? (
              <section className="bae-mk-block" aria-labelledby="bae-mk-rev-h">
                <h3 className="bae-label" id="bae-mk-rev-h">고친 기록</h3>
                <ol className="bae-mk-revs">{p.revisions.map((t, i) => <li key={i}>{t}</li>)}</ol>
              </section>
            ) : null}

            <details className="bae-mk-prompt">
              <summary>영어 주문서 보기 · 고치기</summary>
              <div className="bae-mk-prompt-body">
                <textarea className="bae-textarea bae-mk-prompt-text" spellCheck={false} aria-label="영어 주문서" value={p.prompt} onChange={(e) => p.onPrompt(e.target.value)} />
                <p className="bae-hint">여기서 고친 내용 그대로 그림을 만들어요. 그림체·시간대 같은 고정 문장은 앱이 넣은 거예요.</p>
                {p.promptCount ? <p className="bae-hint bae-num">{p.promptCount}</p> : null}
              </div>
            </details>
          </div>

          {p.statusText ? (
            <div className={`bae-mk-status is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
              {tone === 'info' ? <Info size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
              <p className="bae-mk-status-text">{p.statusText}</p>
              {p.state === 'stale' ? <button type="button" className="bae-btn bae-btn-s" onClick={p.onRemake}>주문서 다시 만들기</button> : null}
              {p.state === 'error' ? <button type="button" className="bae-btn bae-btn-s" onClick={p.onRetry ?? p.onRemake}>다시 시도</button> : null}
            </div>
          ) : null}
        </div>
      </div>
    </BaeWindow>
  );
}
