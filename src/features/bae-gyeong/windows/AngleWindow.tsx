// 다른 각도로 창 (계획 14d 3-3, 시안 WinAngle · HTML v0.4.11 의 agDlg). 지금 그림을 같은 장소의 다른 카메라에서 다시 그린다.
// 이 PC 가 그림의 깊이를 재서 입체 판을 만들고(0원), 도면에서 고른 카메라 B 로 본 입체 판과 원래 그림을 GPT 가 받아 다시 그린다 (약 80~100원).
// 움직임(도면 끌기 · B 그림 · 붓 · 메모 · 같은 공간 그림 · 보낼 것 만들기)은 angle/controller.ts 가 HTML 그대로 한다. 이 파일은 틀과 글자.
// '이 각도로 그리기' → onDraw(call): 부르는 쪽이 창을 닫고 만드는 화면(그리는 중)을 연 뒤 메인에 'bae:angle-draw' 로 보낸다 (14d 6장).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Brush, Eraser, Eye, FolderOpen, Highlighter, ImagePlus, Info, Loader2, Pipette, Plus, Rotate3d, Trash2, Type, Undo2, X } from 'lucide-react';
import { BaeWindow } from './BaeWindow';
import { AngleController, angleFileTarget, type AngleHost, type AngleResultChoice, type AngleTarget, type AngleTool } from '../angle/controller';
import type { AngleDepthFn } from '../angle/depth';
import type { BaeAngleDrawCall } from '@/shared/bae/angle/calls';
import type { AnglePreset } from '@/shared/bae/angle/order';
import type { TierId } from '@/shared/bae/order/constants';
import './bae-angle.css';

export type { AngleTarget, AngleResultChoice } from '../angle/controller';
export { angleFileTarget } from '../angle/controller';

export interface AngleWindowProps {
  /** 처음 열 그림 (결과 또는 파일 — 파일은 angleFileTarget(file) 로 만든다) */
  target: AngleTarget;
  /** '+ 같은 공간 그림 더하기'에서 고를 결과 (최근 것부터, 48장까지 보인다) */
  results?: AngleResultChoice[];
  /** 결과 그림 열기: '원래 그림 기준으로' · 결과에서 같은 공간 그림 더하기 · 다시 열 때 같은 공간 그림 되살리기. 이 PC 에 없으면 null */
  resolveResult?: (jobId: string) => Promise<AngleTarget | null>;
  /** 불러온 그림의 크기 단계 (만드는 창이 이 PC 에 기억한 값, 기본 'm') */
  tier?: TierId;
  /** 금액 줄: 환율 · 설정의 PD 모델 가격 [입력, 출력] (백만 토큰당 달러) */
  krwPerUsd?: number;
  pdPrice?: [number, number] | null;
  /** 깊이 재기 (기본: 이 PC 의 모델 일꾼). 테스트 모드는 흉내를 넣는다 */
  depth?: AngleDepthFn;
  depthReady?: () => Promise<boolean>;
  /** 다른 그림을 그리는 중 (HTML state.busy): 그리기 버튼을 막는다 */
  busy?: boolean;
  /** 보내기 전에 실패한 글 (창에 남긴다) */
  error?: string;
  toast?: (msg: string) => void;
  onDraw: (call: BaeAngleDrawCall) => void;
  onClose: () => void;
}

const TURNS: AnglePreset[] = ['left45', 'left20', 'orig', 'right20', 'right45'];
const HEIGHTS: AnglePreset[] = ['high', 'low'];
const PRESET_NAME: Record<AnglePreset, string> = { left45: '왼쪽 45°', left20: '왼쪽 20°', orig: '원래대로', right20: '오른쪽 20°', right45: '오른쪽 45°', high: '하이 앵글', low: '로우 앵글', vp: '투시만 바꾸기' };
const PRESET_TITLE: Partial<Record<AnglePreset, string>> = {
  high: '같은 자리에서 천장 가까이 올라가 가운데를 내려다봐요', low: '같은 자리에서 무릎 높이로 내려가 살짝 올려다봐요',
  vp: '뒷벽은 그대로 두고 소실점과 지평선만 옮겨요. B 그림의 빨간 점을 끌어요 (한 번 더 누르면 원래대로)',
};
/** 안내 줄을 토막으로 (시안: 가운뎃점 대신 세로줄). 괄호 안의 가운뎃점은 나누지 않는다 ('회색 20% · 늘어난 곳 0%'). */
function splitFacts(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]; if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && s.startsWith(' · ', i)) { out.push(cur); cur = ''; i += 2; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const FOOT_DEFAULT = '그림 1장에 약 80~100원이에요. 깊이와 입체 판은 이 PC에서 0원, 메모를 쓰면 약 20원 더 들어요.';

/** 손을 뗄 때만 값을 정하는 손잡이 (HTML 의 'change': 화각 · 같은 공간 그림 크기 · 눈높이는 입체 판을 다시 만들어서). */
function CommitRange(p: { id: string; min: number; max: number; step: number; value: number; disabled?: boolean; label: string; onLive(v: number): void; onCommit(v: number): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const cb = useRef(p); cb.current = p;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const on = () => cb.current.onCommit(Number(el.value));
    el.addEventListener('change', on); return () => el.removeEventListener('change', on);
  }, []);
  return <input ref={ref} id={p.id} className="bae-ag-range" type="range" min={p.min} max={p.max} step={p.step} value={p.value} disabled={p.disabled} aria-label={p.label} onChange={(e) => p.onLive(Number(e.target.value))} />;
}

export function AngleWindow(p: AngleWindowProps) {
  const props = useRef(p); props.current = p;
  const ctl = useMemo(() => {
    const host: AngleHost = {
      depth: p.depth, depthReady: p.depthReady, tier: p.tier, krwPerUsd: p.krwPerUsd, pdPrice: p.pdPrice,
      resolveResult: (id) => (props.current.resolveResult ? props.current.resolveResult(id) : Promise.resolve(null)),
      toast: (m) => props.current.toast?.(m),
    };
    return new AngleController(host);
    // 창 하나에 하나 (그림을 바꿔도 같은 것)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ui = useSyncExternalStore((fn) => ctl.subscribe(fn), ctl.getUi);
  const planWrap = useRef<HTMLDivElement>(null), viewWrap = useRef<HTMLDivElement>(null);
  const plan = useRef<HTMLCanvasElement>(null), planUi = useRef<HTMLCanvasElement>(null), view = useRef<HTMLCanvasElement>(null), paint = useRef<HTMLCanvasElement>(null), note = useRef<HTMLCanvasElement>(null);
  const noteText = useRef<HTMLTextAreaElement>(null), vpDot = useRef<HTMLElement>(null);
  const pickRef = useRef<HTMLInputElement>(null), exFileRef = useRef<HTMLInputElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ctl.attach({ plan: plan.current!, planUi: planUi.current!, view: view.current!, paint: paint.current!, note: note.current!, noteText: noteText.current!, planWrap: planWrap.current!, viewWrap: viewWrap.current!, vpDot: vpDot.current });
    return () => ctl.close();
  }, [ctl]);
  useEffect(() => { void ctl.open(p.target); }, [ctl, p.target.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (p.error !== undefined) ctl.setError(p.error); }, [ctl, p.error]);
  useEffect(() => {   // 더하기 칸은 바깥을 누르면 닫는다 (HTML agAddMenu)
    if (!addOpen) return;
    const on = (e: PointerEvent) => { const t = e.target as Element | null; if (addRef.current && t && !addRef.current.contains(t) && !t.closest('[data-ag-add]')) setAddOpen(false); };
    document.addEventListener('pointerdown', on); return () => document.removeEventListener('pointerdown', on);
  }, [addOpen]);

  const on = ui.ready && !ui.drawing;
  const ar = p.target.w / Math.max(1, p.target.h);
  const go = async () => {
    if (p.busy) { p.toast?.('다른 그림을 그리는 중이에요. 끝난 뒤에 해 주세요.'); return; }
    const call = await ctl.prepare(); if (call) props.current.onDraw(call);
  };
  const facts = ui.info ? splitFacts(ui.info) : [];
  const seg = (list: AnglePreset[], label: string) => (
    <div className="bae-seg" role="group" aria-label={label}>
      {list.map((k) => (
        <button key={k} type="button" className="bae-btn bae-btn-s" aria-pressed={ui.preset === k} disabled={!on} title={PRESET_TITLE[k]} onClick={() => ctl.preset(k)}>{PRESET_NAME[k]}</button>
      ))}
    </div>
  );
  const tool = (t: Exclude<AngleTool, ''>, label: string, title: string, icon: ReactNode, memo = false) => (
    <button type="button" className={`bae-ib${memo ? ' bae-ag-memo' : ''}`} aria-label={label} title={title} aria-pressed={ui.tool === t} disabled={!on} onClick={() => ctl.toggleTool(t)}>{icon}</button>
  );
  const holdOrig = (v: boolean) => () => ctl.setShowOrig(v);

  return (
    <BaeWindow
      tool="angle"
      icon={<Rotate3d size={18} aria-hidden="true" />}
      title="다른 각도로"
      sub={ui.target || `기준: ${p.target.name}`}
      headActions={(
        <>
          {ui.back ? <button type="button" className="bae-btn bae-btn-s" title={ui.back} disabled={ui.drawing} onClick={() => void ctl.goBack()}><ArrowLeft size={14} aria-hidden="true" />원래 그림 기준으로</button> : null}
          <button type="button" className="bae-btn bae-btn-s" title="결과 말고 다른 배경 그림의 각도를 바꿔요" disabled={ui.drawing} onClick={() => pickRef.current?.click()}><FolderOpen size={14} aria-hidden="true" />다른 그림 불러오기</button>
          <input ref={pickRef} className="bae-vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true"
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f || ui.drawing) return; try { await ctl.open(await angleFileTarget(f)); } catch (err) { p.toast?.(err instanceof Error ? err.message : '그림을 열 수 없어요'); } }} />
        </>
      )}
      footNote={<span className="bae-ag-est">{ui.est || FOOT_DEFAULT}</span>}
      footActions={(
        <button type="button" className="bae-btn bae-btn-primary" disabled={!ui.go || !!p.busy} aria-busy={ui.drawing || undefined} onClick={() => void go()}>
          {ui.drawing ? <Loader2 size={16} className="bae-spin" aria-hidden="true" /> : <Rotate3d size={16} aria-hidden="true" />}
          {ui.drawing ? '준비 중' : '이 각도로 그리기'}
        </button>
      )}
      onClose={() => { if (ctl.editingNote) { ctl.noteCommit(true); return; } props.current.onClose(); }}
    >
      <div className="bw-main bae-ag">
        <div className="bw-bar">
          {seg(TURNS, '카메라를 옆으로 옮기는 버튼')}
          {seg(HEIGHTS, '카메라 높이를 바꾸는 버튼')}
          {seg(['vp'], '투시만 바꾸기')}
          <p className="bae-hint bae-push">깊이는 이 PC가 재요. Depth Anything V2 Small, 처음 한 번 약 99MB.</p>
        </div>
        <div className="bw-angle">
          <figure className="bw-fig">
            <figcaption className="bw-fig-cap"><span className="bw-fig-title">도면</span><span className="bae-hint bae-ag-cap" title={ui.planCap}>{ui.planCap}</span></figcaption>
            <div ref={planWrap} className="bw-fig-pic bae-ag-stage bae-ag-plan">
              <canvas ref={plan} aria-hidden="true" />
              <canvas ref={planUi} tabIndex={0} aria-label="도면. 빨간 B를 끌면 카메라 자리, +를 끌면 보는 곳이 바뀌어요 (점선 안, A 뒤쪽까지). 더한 그림의 카메라(주황 C 등)도 같은 방법으로 옮겨요. 바닥을 누르면 B가 그 자리로 가요. 화살표 왼쪽 오른쪽은 돌기, 위 아래는 가까이 멀리" />
            </div>
          </figure>
          <figure className="bw-fig">
            <figcaption className="bw-fig-cap"><span className="bw-fig-title">{ui.viewTitle}</span><span className="bae-hint bae-ag-cap" title={ui.viewCap}>{ui.viewCap}</span></figcaption>
            <div ref={viewWrap} className={`bw-fig-pic bae-ag-stage bae-ag-view${ui.showOrig ? ' is-orig' : ''}`} style={{ ['--ar' as string]: String(ar) }}>
              <canvas ref={view} aria-label="새 카메라 B에서 본 입체 판" />
              <canvas ref={paint} className="bae-ag-paint" aria-label="러프 덧대기와 메모: 붓이나 메모 도구를 켜고 B 그림 위에 그려요" />
              <canvas ref={note} className="bae-ag-note" aria-hidden="true" />
              <textarea ref={noteText} className="bae-ag-notetx" hidden rows={1} spellCheck={false} aria-label="메모 글씨 (Enter로 넣기 · Shift+Enter 줄 바꿈 · Esc 그만두기)" />
              <div className="bae-ag-vp" hidden={!ui.vp.on} style={{ ['--vx' as string]: ui.vp.x + '%', ['--vy' as string]: ui.vp.y + '%' }}>
                <i className="bae-ag-vph" />
                <b ref={vpDot} className="bae-ag-vpd" tabIndex={ui.vp.on ? 0 : -1} role="slider" aria-label="소실점. 끌거나 화살표 키로 옮겨요" aria-valuetext={ui.vp.text} title="소실점: 끌어서 옮겨요 (지평선이 같이 움직여요)" />
              </div>
              {ui.origSrc ? <img className="bae-ag-orig" src={ui.origSrc} alt="원래 그림" draggable={false} /> : null}
              {ui.showOrig ? <span className="bae-tag bae-tag-l">원래 카메라에서 본 모습</span> : null}
              <button type="button" className="bae-btn bae-btn-s bae-ag-origbtn" aria-pressed={ui.showOrig} title="누르고 있는 동안 원래 그림을 보여 줘요" disabled={!ui.ready}
                onPointerDown={holdOrig(true)} onPointerUp={holdOrig(false)} onPointerLeave={holdOrig(false)} onPointerCancel={holdOrig(false)}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); ctl.setShowOrig(true); } }} onKeyUp={holdOrig(false)} onBlur={holdOrig(false)}>
                <Eye size={14} aria-hidden="true" />원래 그림 보기
              </button>
            </div>
          </figure>
          {ui.wait.on ? (
            <div className="bae-ag-wait" role="status">
              <div>
                <b>{ui.wait.title}</b>
                {ui.wait.frac != null ? <div className="bae-ag-bar"><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, ui.wait.frac))})` }} /></div> : null}
                {ui.wait.hint ? <p className="bae-hint">{ui.wait.hint}</p> : null}
                {ui.wait.retry ? <button type="button" className="bae-btn bae-btn-s" onClick={() => ctl.retry()}>다시 해 보기</button> : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="bw-lower">
          <div className="bw-lower-main">
            <div className="bw-sliders">
              <div className="bae-field">
                <label className="bw-slabel" htmlFor="bae-ag-orbit"><span className="bae-label">돌기</span><span className="bae-num bw-sval">{ui.orbitText}</span></label>
                <input id="bae-ag-orbit" className="bae-ag-range" type="range" min={-80} max={80} step={1} value={ui.orbit} disabled={!on} title="B가 보는 곳(+)을 가운데 두고 빙 돌아요. 벽에 닿으면 그만큼 가까이 다가가요" onChange={(e) => ctl.orbit(Number(e.target.value))} />
              </div>
              <div className="bae-field">
                <label className="bw-slabel" htmlFor="bae-ag-dist"><span className="bae-label">거리</span><span className="bae-num bw-sval">{ui.distText}</span></label>
                <input id="bae-ag-dist" className="bae-ag-range" type="range" min={25} max={250} step={1} value={ui.dist} disabled={!on} title="보는 곳(+)까지의 거리 (원래 카메라 A의 거리 = 100%). 100%보다 크면 A보다 뒤로 빠져요 (도면의 점선까지)" onChange={(e) => ctl.dist(Number(e.target.value))} />
              </div>
              <div className="bae-field">
                <label className="bw-slabel" htmlFor="bae-ag-height"><span className="bae-label">높이</span><span className="bae-num bw-sval">{ui.heightText}</span></label>
                <input id="bae-ag-height" className="bae-ag-range" type="range" min={0.15} max={ui.heightMax} step={0.05} value={ui.height} disabled={!on} title="바닥에서 카메라까지의 높이. 보는 곳은 그대로라 높이면 내려다봐요" onChange={(e) => ctl.height(Number(e.target.value))} />
              </div>
              <div className="bae-field">
                <label className="bw-slabel" htmlFor="bae-ag-pitch"><span className="bae-label">고개</span><span className="bae-num bw-sval">{ui.pitchText}</span></label>
                <input id="bae-ag-pitch" className="bae-ag-range" type="range" min={-60} max={40} step={1} value={ui.pitch} disabled={!on} title="고개를 들거나 숙여요" onChange={(e) => ctl.pitch(Number(e.target.value))} />
              </div>
              <div className="bae-field">
                <label className="bw-slabel" htmlFor="bae-ag-fov"><span className="bae-label">원래 그림 화각</span><span className="bae-num bw-sval">{ui.fovText}</span></label>
                <CommitRange id="bae-ag-fov" min={35} max={80} step={1} value={ui.fov} disabled={!on} label="원래 그림 화각: 원근이 센 그림이면 크게, 망원 같은 그림이면 작게" onLive={(v) => ctl.fovInput(v)} onCommit={(v) => ctl.fovChange(v)} />
              </div>
              <div className="bae-field">
                <span className="bae-label" id="bae-ag-place">장소</span>
                <div className="bae-seg" role="group" aria-labelledby="bae-ag-place">
                  {(['interior', 'exterior'] as const).map((k) => <button key={k} type="button" className="bae-btn bae-btn-s" aria-pressed={ui.kind === k} disabled={!on} onClick={() => ctl.setKind(k)}>{k === 'interior' ? '실내' : '실외'}</button>)}
                </div>
              </div>
            </div>
            <div className={`bw-info${ui.infoKind ? ' is-' + ui.infoKind : ''}`} role="status" data-info={ui.info}>
              <Info size={14} aria-hidden="true" />
              <div className="bw-facts-clip"><ul className="bw-facts">{facts.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
            </div>
          </div>
          <div className="bw-extras">
            <div className="bw-extra bae-ag-exhead">
              <span className="bw-extra-name">같은 공간 그림</span>
              <span className="bae-mcount bae-num">{ui.exCount}/8</span>
              <button type="button" className="bae-btn bae-btn-s bae-btn-ghost bae-push" data-ag-add disabled={!ui.canAdd} title="같은 장소를 다른 쪽에서 그린 결과나 파일을 더해요 (깊이는 이 PC에서 0원)" onClick={() => setAddOpen((v) => !v)}><Plus size={14} aria-hidden="true" />더하기</button>
              {addOpen ? (
                <div ref={addRef} className="bae-ag-add" role="dialog" aria-label="같은 공간 그림 고르기">
                  <div className="bae-ag-addh"><b>결과에서 고르기</b><span className="bae-push" />
                    <button type="button" className="bae-btn bae-btn-s" onClick={() => { setAddOpen(false); exFileRef.current?.click(); }}><ImagePlus size={14} aria-hidden="true" />파일에서 고르기</button>
                    <button type="button" className="bae-ib" aria-label="닫기" onClick={() => setAddOpen(false)}><X size={16} aria-hidden="true" /></button>
                  </div>
                  <div className="bae-ag-grid">
                    {(p.results || []).filter((r) => r.id !== p.target.id).slice(0, 48).map((r) => {
                      const d = new Date(r.createdAt);
                      return (
                        <button key={r.id} type="button" onClick={async () => { setAddOpen(false); const t = await props.current.resolveResult?.(r.id).catch(() => null); if (t) await ctl.exAdd(t); else p.toast?.('그림을 찾지 못했어요'); }}>
                          <img src={r.thumb} alt="" />
                          <span>{(d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' · ' + r.w + '×' + r.h}</span>
                        </button>
                      );
                    })}
                    {!(p.results || []).some((r) => r.id !== p.target.id) ? <p className="bae-hint">고를 결과가 없어요. 파일에서 골라 주세요.</p> : null}
                  </div>
                </div>
              ) : null}
              <input ref={exFileRef} className="bae-vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true"
                onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { await ctl.exAdd(await angleFileTarget(f)); } catch (err) { p.toast?.(err instanceof Error ? err.message : '그림을 열 수 없어요'); } }} />
            </div>
            {ui.chips.length ? (
              <div className="bae-ag-chips" role="list" aria-label="더한 그림">
                {ui.aChip ? <span className="bae-ag-chip is-a" role="listitem" title={ui.aChip.title}><img src={ui.aChip.thumb} alt="" /><span className="bae-ag-chipn"><b><i style={{ background: '#5a5a5a' }} />A</b><em>{ui.aChip.sub}</em></span></span> : null}
                {ui.chips.map((c) => (
                  <span key={c.i} role="listitem" className={`bae-ag-chip${c.on ? ' is-on' : ''}${c.err ? ' is-err' : ''}`} style={{ ['--exc' as string]: c.color }}>
                    <button type="button" className="bae-ag-chipb" aria-pressed={c.on} title={`${c.title} — 도면에서 ${c.letter}를 끌면 자리, ${c.letter}의 +를 끌면 방향이 바뀌어요`} onClick={() => ctl.exPick(c.i)}>
                      {c.thumb ? <img src={c.thumb} alt="" /> : <span className="bae-ag-chipimg" />}
                      <span className="bae-ag-chipn"><b><i style={{ background: c.color }} />{c.title}</b><em>{c.sub}</em></span>
                    </button>
                    <button type="button" className="bae-ib bae-ag-chipx" aria-label={`${c.letter} 그림 빼기`} title={`${c.letter} 그림 빼기`} disabled={ui.drawing} onClick={() => ctl.exRemove(c.i)}><X size={14} aria-hidden="true" /></button>
                  </span>
                ))}
              </div>
            ) : null}
            {ui.exSel ? (
              <div className="bae-ag-exsl" style={{ ['--exc' as string]: ui.exSel.color }}>
                <label className="bw-slabel" htmlFor="bae-ag-exsize"><span className="bae-label">{ui.exSel.letter} 크기</span><span className="bae-num bw-sval">{ui.exSel.sizeText}</span></label>
                <CommitRange id="bae-ag-exsize" min={70} max={130} step={1} value={ui.exSel.size} disabled={!ui.exSel.enabled} label={`${ui.exSel.letter} 크기 (마주 보는 벽까지 거리)`} onLive={() => undefined} onCommit={(v) => ctl.exSize(v)} />
                <label className="bw-slabel" htmlFor="bae-ag-exeye"><span className="bae-label">눈높이</span><span className="bae-num bw-sval">{ui.exSel.eyeText}</span></label>
                <CommitRange id="bae-ag-exeye" min={0.15} max={ui.exSel.eyeMax} step={0.05} value={ui.exSel.eye} disabled={!ui.exSel.enabled} label={`${ui.exSel.letter} 그림을 그린 카메라의 눈높이`} onLive={() => undefined} onCommit={(v) => ctl.exEye(v)} />
              </div>
            ) : null}
            <div className="bw-extra" role="group" aria-label="러프 덧대기">
              <span className="bw-extra-name">러프 덧대기</span>
              <div className="bw-tools">
                {tool('brush', '붓', 'B 그림 위에 칠해요 (회색 자리에 대충 칠하면 GPT가 그렇게 채워요)', <Brush size={16} aria-hidden="true" />)}
                {tool('erase', '지우개', '칠한 것을 지워요 (입체 판은 그대로)', <Eraser size={16} aria-hidden="true" />)}
                {tool('pick', '색 찍기', 'B 그림에서 한 곳을 눌러 그 색을 붓 색으로 가져와요', <Pipette size={16} aria-hidden="true" />)}
                <label className="bae-ag-color" title="붓 색 (눌러서 고를 수도 있어요)"><input type="color" value={ui.color} disabled={!on} aria-label="붓 색" onChange={(e) => ctl.setColor(e.target.value)} /></label>
                <input className="bae-ag-range bae-ag-brush" type="range" min={4} max={120} step={1} value={ui.brush} disabled={!on} aria-label="붓 · 지우개 굵기" title="붓 · 지우개 굵기" onChange={(e) => ctl.setBrush(Number(e.target.value))} />
              </div>
            </div>
            <div className="bw-extra" role="group" aria-label="PD메모">
              <span className="bw-extra-name">PD메모</span>
              <div className="bw-tools">
                {tool('text', '글씨', 'B 그림을 누른 자리에 글씨 메모 (Enter로 넣기 · 쓴 메모를 다시 누르면 고치고, 글을 다 지우면 빠져요)', <Type size={16} aria-hidden="true" />, true)}
                {tool('arrow', '화살표', '끌어서 화살표 (이것 · 여기를 가리켜요)', <ArrowUpRight size={16} aria-hidden="true" />, true)}
                {tool('mark', '메모 펜', '빨간 펜으로 동그라미나 표시', <Highlighter size={16} aria-hidden="true" />, true)}
                <span className="bae-ag-sep" aria-hidden="true" />
                <button type="button" className="bae-ib" aria-label="되돌리기" title="되돌리기 (붓과 메모를 섞어서 마지막 것부터)" disabled={!ui.undo} onClick={() => ctl.undo()}><Undo2 size={16} aria-hidden="true" /></button>
                <button type="button" className="bae-ib" aria-label="모두 지우기" title="붓과 메모를 모두 지워요" disabled={!ui.clear} onClick={() => ctl.clearPaint()}><Trash2 size={16} aria-hidden="true" /></button>
              </div>
            </div>
            <p className="bae-hint">같은 방을 그린 다른 그림을 더하면 회색 자리가 줄어요. 덧댄 붓은 밑그림에 들어가고, PD메모는 PD만 읽어요.</p>
          </div>
        </div>
      </div>
    </BaeWindow>
  );
}
