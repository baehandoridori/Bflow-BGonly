// 재료 창 (계획 14d 3-1 · 14e 5-5, 시안 WinNew): 왼쪽은 그림판(board)을 그대로, 오른쪽은 설명 · 장소 · 시간대 · 투시 ·
// 기준 배경 · 레퍼런스 · 그림체 기준 · 이어 가기 · 알림. 발의 '주문서 만들기'. 보여 주기만 하고 바뀐 것은 콜백으로 알린다.
import { useRef } from 'react';
import { AlertTriangle, ChevronDown, CopyPlus, Info, Loader2, Palette, Plus, X } from 'lucide-react';
import { BaeWindow } from './BaeWindow';
import type { BaePlace, MaterialWindowProps } from '../make/ui';
import './bae-stage2-windows.css';

const PLACES: { id: BaePlace; label: string }[] = [{ id: 'auto', label: '자동' }, { id: 'interior', label: '실내' }, { id: 'exterior', label: '실외' }];
const DIR_HELP = '이번 화만의 특별한 지시는 { }로 감싸 주세요. 개발자 지문이 되어 매뉴얼과 고정 문장보다 먼저 따라요. 예) {이번 화는 회상 장면이라 전체를 세피아 톤으로}';
const short = (t: string) => (t.length > 70 ? `${t.slice(0, 70)}…` : t);

export function MaterialWindow(p: MaterialWindowProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const same = p.kind === 'same';
  const refFull = p.refs.length >= p.refMax;
  const msgIcon = p.message?.tone === 'info' ? <Info size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />;

  return (
    <BaeWindow
      tool={same ? 'same' : 'new'}
      icon={same ? <CopyPlus size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
      title={same ? '같은 장소 다른 컷' : '새 배경 만들기'}
      sub={same ? '먼저 그린 배경의 가구와 색을 이어서, 같은 곳을 다른 구도로 그려요' : '러프와 설명을 넣으면 PD가 주문서를 써요'}
      footNote="주문서 한 번에 40원쯤 들어요. 그림은 PD가 쓴 요약을 읽어 본 다음에 만들어요."
      footActions={(
        <button type="button" className="bae-btn bae-btn-primary" disabled={p.submitting} aria-busy={p.submitting || undefined} onClick={p.onSubmit}>
          {p.submitting ? <Loader2 size={16} className="bae-spin" aria-hidden="true" /> : null}주문서 만들기
        </button>
      )}
      onClose={p.onClose}
    >
      <div className="bw-cols">
        <div className="bw-main bae-mt-main">{p.board}</div>
        <div className="bw-side">
          <div className="bae-field">
            <label className="bae-label" htmlFor="bae-mt-desc">설명</label>
            <textarea className="bae-textarea bae-mt-desc" id="bae-mt-desc" rows={4} value={p.request} onChange={(e) => p.onRequest(e.target.value)} placeholder="어떤 곳인지, 무엇이 어디에 있는지 한국어로 적어요" />
            {p.dirNotes.length === 0 && !p.dirUnclosed ? <p className="bae-hint">{DIR_HELP}</p> : (
              <div className="bae-mt-dir" aria-live="polite">
                {p.dirNotes.length > 0 ? (
                  <>
                    <p className="bae-mt-dir-head">개발자 지문 {p.dirNotes.length}개</p>
                    <ul className="bae-mt-dir-list">{p.dirNotes.map((t, i) => <li key={i}>{short(t)}</li>)}</ul>
                    <p className="bae-hint">매뉴얼과 고정 문장보다 먼저 따라요</p>
                  </>
                ) : null}
                {p.dirUnclosed ? <p className="bae-mt-dir-warn"><AlertTriangle size={14} aria-hidden="true" />{'{ } 짝이 안 맞아요. 닫는 괄호를 확인해 주세요'}</p> : null}
              </div>
            )}
          </div>

          <div className="bae-mt-pick">
            <div className="bw-row3">
              <div className="bae-field">
                <label className="bae-label" htmlFor="bae-mt-place">장소</label>
                <span className="bw-sel">
                  <select className="bw-select" id="bae-mt-place" value={p.place} onChange={(e) => p.onPlace(e.target.value as BaePlace)}>
                    {PLACES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </div>
              <div className="bae-field">
                <label className="bae-label" htmlFor="bae-mt-time">시간대</label>
                <span className="bw-sel">
                  <select className="bw-select" id="bae-mt-time" value={p.time} onChange={(e) => p.onTime(e.target.value)}>
                    {p.times.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </div>
              <div className="bae-field">
                <label className="bae-label" htmlFor="bae-mt-persp">투시</label>
                <span className="bw-sel">
                  <select className="bw-select" id="bae-mt-persp" value={p.persp} onChange={(e) => p.onPersp(e.target.value as MaterialWindowProps['persp'])}>
                    {p.persps.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  <ChevronDown size={14} aria-hidden="true" />
                </span>
              </div>
            </div>
            {p.perspHint ? <p className="bae-hint">{p.perspHint}</p> : null}
            {p.guideUse !== null ? (
              <button type="button" className="bw-switch bae-mt-guide" role="switch" aria-checked={p.guideUse} onClick={() => p.onGuideUse(!p.guideUse)}>
                <span className="bw-switch-track" />
                <span className="bae-mt-guide-text">
                  <span>지평선 및 투시 참고하게 하기</span>
                  <span className="bae-mt-guide-sub">{p.guideUse && p.guideUseText ? `${p.guideUseText}를 숫자로 보내요` : '켜면 가이드 위치를 숫자로 PD에게 보내요'}</span>
                </span>
              </button>
            ) : null}
          </div>

          <section className="bae-mgroup" aria-labelledby="bae-mt-base-h">
            <div className="bae-mhead">
              <p className="bae-mhead-name" id="bae-mt-base-h">기준 배경</p>
              <span className="bae-mcount">0/3</span>
              <button type="button" className="bae-btn bae-btn-ghost bae-btn-s bae-push" disabled><Plus size={14} aria-hidden="true" />넣기</button>
            </div>
            <p className="bae-hint">같은 장소 다른 컷은 다음 단계에서 열려요.</p>
          </section>

          <section className="bae-mgroup" aria-labelledby="bae-mt-ref-h">
            <div className="bae-mhead">
              <p className="bae-mhead-name" id="bae-mt-ref-h">레퍼런스</p>
              <span className="bae-mcount">{p.refs.length}/{p.refMax}</span>
              <button type="button" className="bae-btn bae-btn-ghost bae-btn-s bae-push" disabled={refFull} onClick={() => fileRef.current?.click()}><Plus size={14} aria-hidden="true" />넣기</button>
              <input
                ref={fileRef}
                className="bae-vh"
                type="file"
                accept="image/*"
                multiple
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length) p.onAddRefs(files);
                }}
              />
            </div>
            {p.refs.length ? (
              <ul className="bae-mats">
                {p.refs.map((r, i) => (
                  <li key={r.id} className="bae-mrow">
                    <span className="bw-thumb"><img src={r.src} alt={`레퍼런스 ${i + 1}`} /></span>
                    <input className="bae-minput" type="text" value={r.note} onChange={(e) => p.onRefNote(r.id, e.target.value)} placeholder="이 그림에서 참고할 점" aria-label={`레퍼런스 ${i + 1} 설명`} />
                    <button type="button" className="bae-ib" aria-label={`레퍼런스 ${i + 1} 빼기`} title="빼기" onClick={() => p.onRemoveRef(r.id)}><X size={16} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="bae-hint">참고할 그림을 넣고, 무엇을 참고할지 적어요.</p>}
          </section>

          <div className="bae-style">
            <span className="bae-style-thumb"><img src={p.stripSrc} alt="" /></span>
            <p className="bae-style-text"><span className="bae-style-name">그림체 기준</span><span className="bae-style-sub">{p.styleRow}</span></p>
            <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" aria-label="그림체 기준 설정 열기" onClick={p.onOpenStyle}><Palette size={14} aria-hidden="true" />설정</button>
          </div>

          {p.carry ? (
            <label className="bae-mt-carry" title={p.carry.text || undefined}>
              <input type="checkbox" checked={p.carry.on} onChange={(e) => p.onCarry(e.target.checked)} />
              <span>이전 수정 요청 {p.carry.count}개 이어서 반영</span>
            </label>
          ) : null}

          {p.message ? (
            <p className={`bae-mt-msg is-${p.message.tone}`} role={p.message.tone === 'error' ? 'alert' : 'status'}>{msgIcon}<span>{p.message.text}</span></p>
          ) : null}
        </div>
      </div>
    </BaeWindow>
  );
}
