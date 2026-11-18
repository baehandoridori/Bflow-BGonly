// 재료 창 (계획 14d 3-1 · 14e 5-5, 시안 WinNew): 왼쪽은 그림판(board)을 그대로, 오른쪽은 설명 · 장소 · 시간대 · 투시 가이드 ·
// 기준 배경 · 레퍼런스 · 그림체 기준 · 이어 가기 · 알림. 발의 '주문서 만들기'. 보여 주기만 하고 바뀐 것은 콜백으로 알린다.
// 창은 앱 창의 96% × 94% 까지 넓고(bae-material.css), '투시 가이드' 묶음은 그림판이 BoardWindowContext 로 받은 자리
// (오른쪽 칸, 그림판 바로 옆)에 그린다. 투시 종류와 '참고하게 하기'는 여기 콜백(onPersp · onGuideUse)으로 가게에 간다.
import { useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, CopyPlus, Info, Loader2, Palette, Plus, Scissors, X } from 'lucide-react';
import { BaeWindow } from './BaeWindow';
import type { BaePlace, MaterialWindowProps } from '../make/ui';
import { BoardWindowContext, type BoardWindowLink } from '../make/board/boardWindow';
import './bae-stage2-windows.css';
import './bae-stage3.css';
import './bae-material.css';

const PLACES: { id: BaePlace; label: string }[] = [{ id: 'auto', label: '자동' }, { id: 'interior', label: '실내' }, { id: 'exterior', label: '실외' }];
const DIR_HELP = '이번 화만의 특별한 지시는 { }로 감싸 주세요. 개발자 지문이 되어 매뉴얼과 고정 문장보다 먼저 따라요. 예) {이번 화는 회상 장면이라 전체를 세피아 톤으로}';
const short = (t: string) => (t.length > 70 ? `${t.slice(0, 70)}…` : t);

export function MaterialWindow(p: MaterialWindowProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const baseFileRef = useRef<HTMLInputElement>(null);
  const [baseOver, setBaseOver] = useState(false);
  const same = p.kind === 'same';
  const baseFull = p.bases.length >= p.baseMax;
  const imageFiles = (list: FileList | null | undefined) => Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
  const refFull = p.refs.length >= p.refMax;
  const msgIcon = p.message?.tone === 'info' ? <Info size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />;
  // 그림판의 '투시 가이드' 묶음이 들어올 자리 (오른쪽 칸). 자리가 생기면 다시 그려서 그림판에 알린다.
  const [guideSlot, setGuideSlot] = useState<HTMLDivElement | null>(null);
  const boardLink: BoardWindowLink = {
    guideSlot,
    persp: { value: p.persp, options: p.persps, hint: p.perspHint, onPick: p.onPersp, onUse: p.onGuideUse, useText: p.guideUseText },
  };

  return (
    <BaeWindow
      className="bae-pop-material"
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
        <div className="bw-main bae-mt-main"><BoardWindowContext.Provider value={boardLink}>{p.board}</BoardWindowContext.Provider></div>
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
            <div className="bae-mt-row2">
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
            </div>
          </div>

          {/* 투시 가이드: 투시 종류 · 가이드 보이기 · 참고하게 하기 · 소실점 간격/복도 길이 · 화면 기울기 (그림판이 그려 넣는다) */}
          <div ref={setGuideSlot} className="bae-mt-guideslot" />

          <section
            className={`bae-mgroup bae-mt-bases${baseOver ? ' is-over' : ''}`}
            aria-labelledby="bae-mt-base-h"
            onDragOver={(e) => { if (baseFull || !Array.from(e.dataTransfer.types).includes('Files')) return; e.preventDefault(); e.stopPropagation(); setBaseOver(true); }}
            onDragLeave={() => setBaseOver(false)}
            onDrop={(e) => { if (baseFull) return; e.preventDefault(); e.stopPropagation(); setBaseOver(false); const fs = imageFiles(e.dataTransfer.files); if (fs.length) p.onAddBases(fs); }}
          >
            <div className="bae-mhead">
              <p className="bae-mhead-name" id="bae-mt-base-h">기준 배경</p>
              <span className="bae-mcount bae-num">{p.bases.length}/{p.baseMax}</span>
              {p.bases.length ? <button type="button" className="bae-btn bae-btn-ghost bae-btn-s bae-push" onClick={p.onOpenParts}><Scissors size={14} aria-hidden="true" />{p.partsButton}</button> : null}
              <button type="button" className={`bae-btn bae-btn-ghost bae-btn-s${p.bases.length ? '' : ' bae-push'}`} disabled={baseFull} onClick={() => baseFileRef.current?.click()}><Plus size={14} aria-hidden="true" />넣기</button>
              <input
                ref={baseFileRef}
                className="bae-vh"
                type="file"
                accept="image/*"
                multiple
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => { const files = imageFiles(e.target.files); e.target.value = ''; if (files.length) p.onAddBases(files); }}
              />
            </div>
            {p.bases.length ? (
              <>
                <ul className="bae-mats">
                  {p.bases.map((b, i) => (
                    <li key={b.id} className="bae-mrow">
                      <span className="bw-thumb bae-mt-basethumb"><img src={b.src} alt={`기준 배경 ${i + 1}`} />{b.parts ? <span className="bae-mt-pc bae-num">부품 {b.parts}</span> : null}</span>
                      <input className="bae-minput" type="text" value={b.note} onChange={(e) => p.onBaseNote(b.id, e.target.value)} placeholder="어느 쪽? 예) 소파 쪽" aria-label={`기준 배경 ${i + 1}: 어느 쪽을 본 그림인지`} />
                      <button type="button" className="bae-ib" aria-label={`기준 배경 ${i + 1} 빼기`} title="빼기" onClick={() => p.onRemoveBase(b.id)}><X size={16} aria-hidden="true" /></button>
                    </li>
                  ))}
                </ul>
                {p.baseHint ? <p className="bae-hint">{p.baseHint}</p> : null}
                <button type="button" className="bw-switch bae-mt-guide" role="switch" aria-checked={p.lockOn} onClick={() => p.onLockOn(!p.lockOn)}>
                  <span className="bw-switch-track" />
                  <span className="bae-mt-guide-text">
                    <span>그린 뒤 색 맞춤</span>
                    <span className="bae-mt-guide-sub">넓은 벽·바닥·소파 색을 기준 배경 색에 맞춰요. 결과에서 껐다 켤 수 있어요</span>
                  </span>
                </button>
              </>
            ) : <p className="bae-hint">같은 장소의 다른 컷을 그릴 때, 먼저 그린 완성 배경을 넣으면 가구 디자인과 벽·바닥 색을 그대로 따라가요.</p>}
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
