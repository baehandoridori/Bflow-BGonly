// 그림체 기준 창, 간단판 (계획 14d · 시안 WinStyle): 왼쪽 = 스타일 띠와 설명 · 예시를 고르는 방식, 오른쪽 = 팀 예시 격자.
// '직접 고르기'일 때만 그림을 눌러 2장까지 고른다 (고르는 규칙은 toggleStylePick, 상태 쪽이 쓴다). 발 = 안내와 돌아가기.
import { Check, Palette } from 'lucide-react';
import { BaeWindow } from './BaeWindow';
import type { BaeStyleEntryView } from '../make/ui';
import { PLACE_KO, TOD_KO } from '../../../shared/bae/order/constants';
import './bae-stage2-windows.css';

export type BaeStyleMode = 'auto' | 'manual';

export interface StyleWindowProps {
  stripSrc: string;               // 팀의 기본 스타일 띠
  mode: BaeStyleMode;             // 'auto' = PD가 골라요, 'manual' = 직접 고르기
  onMode(mode: BaeStyleMode): void;
  entries: BaeStyleEntryView[];   // 예시 12장 (+팀원 예시). picked = 직접 고른 것, off = 꺼 둔 것
  onPick(id: string): void;       // 직접 고르기에서 그림을 누름
  backTo: string | null;          // 연 창 이름 ('새 배경 만들기') — 있으면 발 버튼이 '○○로 돌아가기'
  onBack(): void;                 // backTo 가 있을 때 발 버튼
  onClose(): void;                // 닫기 X · Esc · 창 바깥 (backTo 가 없으면 발 버튼도)
  autoOpened?: boolean;
}

/** 직접 고르기: 이미 고른 것은 빼고, 아니면 더하되 max 장을 넘으면 가장 먼저 고른 것이 빠진다 (시안 · HTML 과 같은 규칙). */
export function toggleStylePick(picks: string[], id: string, max = 2): string[] {
  return picks.includes(id) ? picks.filter((x) => x !== id) : picks.concat(id).slice(-max);
}

const placeKo = (v: string) => PLACE_KO[v] ?? v;
const todKo = (v: string) => (v === 'any' ? '시간대 없음' : TOD_KO[v] ?? v);

export function StyleWindow(p: StyleWindowProps) {
  const manual = p.mode === 'manual';
  const picked = p.entries.filter((e) => e.picked && !e.off).length;
  const onCount = p.entries.filter((e) => !e.off).length;
  const back = p.backTo ? `${p.backTo}${p.backTo === '같은 장소 다른 컷' ? '으로' : '로'} 돌아가기` : '';

  return (
    <BaeWindow
      tool="style"
      icon={<Palette size={18} aria-hidden="true" />}
      title="그림체 기준"
      sub="팀이 함께 쓰는 그림체 기준과 스타일 예시"
      autoOpened={p.autoOpened}
      footNote="띠와 팀 예시 12장은 관리자만 바꾸거나 지워요."
      footActions={p.backTo
        ? <button type="button" className="bae-btn bae-btn-primary" onClick={p.onBack}>{back}</button>
        : <button type="button" className="bae-btn" onClick={p.onClose}>닫기</button>}
      onClose={p.onClose}
    >
      <div className="bw-cols">
        <div className="bw-side bw-side-first">
          <section className="bw-group" aria-labelledby="bae-st-strip-h">
            <div className="bw-group-head"><h3 className="bae-side-title" id="bae-st-strip-h">그림체 기준 그림</h3></div>
            <div className="bw-strip"><img src={p.stripSrc} alt="팀의 기본 스타일 띠" /></div>
            <p className="bae-hint">선 굵기, 면 칠하기, 색감을 여기서 읽어요. 모든 주문에 마지막 그림으로 함께 가요.</p>
          </section>
          <section className="bw-group" aria-labelledby="bae-st-mode-h">
            <div className="bw-group-head"><h3 className="bae-side-title" id="bae-st-mode-h">스타일 예시를 고르는 방식</h3></div>
            <div className="bae-seg bae-seg-fill" role="group" aria-labelledby="bae-st-mode-h">
              <button type="button" className="bae-btn bae-btn-s" aria-pressed={!manual} onClick={() => p.onMode('auto')}>PD가 골라요</button>
              <button type="button" className="bae-btn bae-btn-s" aria-pressed={manual} onClick={() => p.onMode('manual')}>직접 고르기 (2장까지)</button>
            </div>
            <p className="bae-hint" aria-live="polite">{manual ? `아래에서 쓸 예시를 2장까지 눌러서 골라요. 지금 ${picked}장 골랐어요.` : 'PD가 장소와 시간대가 비슷한 예시를 2장까지 골라요. 꺼 둔 예시는 고르지 않아요.'}</p>
          </section>
        </div>
        <div className="bw-main">
          <div className="bw-group-head">
            <h3 className="bae-side-title" id="bae-st-lib-h">스타일 예시</h3>
            <span className="bae-mcount bae-num">켠 예시 {onCount}/{p.entries.length}</span>
          </div>
          <ul className="bw-libs" aria-labelledby="bae-st-lib-h">
            {p.entries.map((e) => {
              const on = manual && e.picked && !e.off;
              return (
                <li key={e.id} className={`bw-lib${on ? ' is-on' : ''}${e.off ? ' is-off' : ''}`}>
                  <button
                    type="button"
                    className="bw-lib-pic"
                    aria-pressed={manual ? on : undefined}
                    aria-label={manual ? `${e.name} 고르기` : e.name}
                    disabled={!manual || e.off}
                    onClick={() => p.onPick(e.id)}
                  >
                    <img src={e.src} alt="" />
                    <span className="bae-tag bae-tag-l bae-num">{e.id}</span>
                    {on ? <span className="bw-lib-check"><Check size={14} aria-hidden="true" /></span> : null}
                  </button>
                  <div className="bw-lib-cap">
                    <p className="bw-lib-name">{e.name}</p>
                    <p className="bw-lib-meta">{placeKo(e.place)} · {todKo(e.tod)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </BaeWindow>
  );
}
