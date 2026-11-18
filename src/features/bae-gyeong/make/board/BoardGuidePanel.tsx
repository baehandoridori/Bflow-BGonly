/**
 * '투시 가이드' 묶음 (HTML v0.4.11 그림판 오른쪽 칸 '투시 가이드 · 선은 그림에 안 들어가요' 를 옮김).
 * 투시 종류 칩 · 가이드 보이기 · 지평선 및 투시 참고하게 하기 · 소실점 간격 / 복도 길이 · 화면 기울기 · 선 풀이 · 옮기는 법.
 * HTML 처럼 고른 도구와 상관없이 늘 보인다. 손잡이(지평선 · 소실점 · 모서리)는 그림판 위에서 '가이드' 도구로 끈다.
 */
import { useId } from 'react';
import { Eye, EyeOff, Move } from 'lucide-react';
import { PERSPECTIVES, type PerspectiveId } from '@/shared/bae/order/constants';
import type { Board, BoardUi } from './Board';
import type { BoardPerspLink } from './boardWindow';
import { guideCtl, tiltLabel } from './guideMath';
import { GUIDE_AUTO_HINT, TILT_HINT, TOOL_TEXT } from './boardText';

/** HTML 그림판 '투시 가이드' 칸의 작은 글씨 */
const GUIDE_SUB = '선은 그림에 안 들어가요';
/** 재료 창 스위치 아래 글씨 (꺼져 있을 때) */
const USE_SUB_OFF = '켜면 가이드 위치를 숫자로 PD에게 보내요';

export interface BoardGuidePanelProps {
  board: Board;
  u: BoardUi;
  /** 창이 투시 종류를 붙잡을 때 (재료 창). 없으면 엔진에 바로 정한다 */
  persp: BoardPerspLink | null;
}

export function BoardGuidePanel({ board, u, persp }: BoardGuidePanelProps) {
  const id = useId();
  const ctl = guideCtl(u.guide);
  const type: PerspectiveId = persp ? persp.value : u.guide.type;
  const options = persp ? persp.options : PERSPECTIVES;
  const hint = persp ? persp.hint : (PERSPECTIVES.find((o) => o.id === type)?.hint ?? '');
  const useOn = type !== 'auto' && u.guide.placed;
  const useSub = useOn && persp?.useText ? `${persp.useText}를 숫자로 보내요` : USE_SUB_OFF;

  const pick = (v: PerspectiveId) => {
    if (v !== type) { if (persp) persp.onPick(v); else board.setGuideType(v); }
    // 가이드를 꺼 둔 채 투시를 고르면 아무것도 안 보이니 다시 켠다
    if (v !== 'auto' && !u.showGuide) board.setShowGuide(true);
  };
  const setUse = (on: boolean) => { if (persp) persp.onUse(on); else board.setGuideParam('use', on); };

  return (
    <section className="bb-gpanel" aria-labelledby={id + 'h'}>
      <div className="bb-gp-head">
        <p className="bb-gp-names"><span className="bb-gp-title" id={id + 'h'}>투시 가이드</span><span className="bb-gp-sub">{GUIDE_SUB}</span></p>
        <button type="button" className="bae-btn bae-btn-s bb-toggle bb-gp-show" aria-pressed={u.showGuide} onClick={() => board.setShowGuide(!u.showGuide)}>
          {u.showGuide ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}가이드 보이기
        </button>
      </div>

      <div className="bb-chips" role="group" aria-label="투시 종류">
        {options.map((o) => (
          <button key={o.id} type="button" className="bae-btn bae-btn-s bb-chip" aria-pressed={type === o.id} onClick={() => pick(o.id)}>{o.label}</button>
        ))}
      </div>
      {hint ? <p className="bae-hint">{hint}</p> : null}

      {type !== 'auto' && (
        <button type="button" className="bw-switch bb-use" role="switch" aria-checked={useOn} onClick={() => setUse(!useOn)}>
          <span className="bw-switch-track" />
          <span className="bb-use-text">
            <span>지평선 및 투시 참고하게 하기</span>
            <span className="bb-use-sub">{useSub}</span>
          </span>
        </button>
      )}

      {ctl.showSpread && (
        <div className="bb-gp-ctl">
          <div className="bb-gp-row"><label className="bae-label" htmlFor={id + 'sp'}>소실점 간격</label><b className="bb-gp-val">{ctl.spreadLabel}</b></div>
          <div className="bb-gp-range">
            <span aria-hidden="true">강하게</span>
            <input className="bb-range" id={id + 'sp'} type="range" min={0.8} max={5} step={0.1} value={ctl.spread} aria-valuetext={ctl.spreadLabel} onChange={(e) => board.setGuideParam('spread', Number(e.target.value))} />
            <span aria-hidden="true">약하게</span>
          </div>
        </div>
      )}
      {ctl.showDepth && (
        <div className="bb-gp-ctl">
          <div className="bb-gp-row"><label className="bae-label" htmlFor={id + 'dp'}>복도 길이</label><b className="bb-gp-val">{ctl.depthLabel}</b></div>
          <div className="bb-gp-range">
            <span aria-hidden="true">짧게</span>
            <input className="bb-range" id={id + 'dp'} type="range" min={1} max={10} step={1} value={ctl.depthStep} aria-valuetext={ctl.depthLabel} onChange={(e) => board.setGuideParam('depth', Number(e.target.value))} />
            <span aria-hidden="true">길게</span>
          </div>
        </div>
      )}

      <div className="bb-gp-ctl">
        <div className="bb-gp-row">
          <label className="bae-label" htmlFor={id + 'tilt'}>화면 기울기 <span className="bb-gp-note">· 러프를 기울여 그렸을 때</span></label>
        </div>
        <div className="bb-gp-range">
          <span aria-hidden="true">-15°</span>
          <input className="bb-range" id={id + 'tilt'} type="range" min={-15} max={15} step={0.5} value={u.tilt} aria-valuetext={tiltLabel(u.tilt)} onChange={(e) => board.setTilt(Number(e.target.value))} />
          <span aria-hidden="true">15°</span>
        </div>
        <div className="bb-gp-row">
          <b className="bb-gp-val bae-num">{tiltLabel(u.tilt)}</b>
          <button type="button" className={'bae-btn bae-btn-ghost bae-btn-s' + (u.tilt ? '' : ' bb-keep')} tabIndex={u.tilt ? 0 : -1} aria-hidden={!u.tilt} onClick={() => board.setTilt(0)}>0°로</button>
        </div>
      </div>
      {u.tilt !== 0 && <p className="bae-hint">{TILT_HINT}</p>}

      {ctl.showLegend && (
        <p className="bae-hint bb-legend">
          <b>지평선은 눈높이예요.</b> 서 있는 사람 눈이나 차 지붕 근처를 지나요. 땅이 끝나는 선과는 달라요.{' '}
          <span className="bb-key-blue">파란 선</span>은 소실점으로 모이는 선이에요.
          {ctl.showCornerKey && <> <span className="bb-key-corner">주황 선</span>은 두 면이 만나는 모서리예요. 선을 끌면 좌우로, 위·아래 점을 끌면 길이가 바뀌어요.</>}
        </p>
      )}
      <div className="bb-gp-how">
        <p className="bae-hint">{type === 'auto' ? GUIDE_AUTO_HINT : TOOL_TEXT.guide.desc}</p>
        {type !== 'auto' && (
          <button type="button" className="bae-btn bae-btn-s bb-toggle" aria-pressed={u.tool === 'guide'} title={TOOL_TEXT.guide.title} onClick={() => board.setTool('guide')}>
            <Move size={14} aria-hidden="true" />가이드 옮기기
          </button>
        )}
      </div>
    </section>
  );
}
