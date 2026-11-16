// 4K로 키우기 창 (계획 14d 3-4, 시안 WinUpscale, HTML v0.3.5 4K 판): 왼쪽 = 키울 그림과 크기 이름표, 오른쪽 = 방식 A · B, 지금 크기와 키운 크기,
// 비용 0원, 이 PC 그래픽카드, 두 크기를 같은 비율로 견준 그림. 발 = 안내 한 줄(진행 중이면 진행 줄) + 4K로 키우기.
// 보여 주기만 한다: 상태는 useBaeUpscale (창을 닫아도 키우기는 이어진다), 글자는 shared/bae/upscaleView.
import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, Loader2, RotateCcw, Scaling } from 'lucide-react';
import {
  BAE_UPSCALE_LICENSE, BAE_UPSCALE_MODES, BAE_UPSCALE_PREVIEW_NOTE, baeModelFirstUseText, baeUpscaleEngineLabel, baeUpscalePreviewHint, baeUpscaleSeconds,
} from '@/shared/bae/upscaleView';
import type { BaeUpscaleKey } from '@/shared/bae/upscaleTiles';
import { BaeWindow } from './BaeWindow';
import { baeUpRunning, type BaeUpWin } from '../state/useBaeUpscale';
import './bae-stage3.css';
import './bae-upscale.css';

export interface UpscaleWindowProps {
  up: BaeUpWin;
  onMode(mode: BaeUpscaleKey): void;
  onRun(): void;
  onAgain(): void;
  onSave(): void;
  onReplace(file: File): void;
  onClose(): void;
}

/** 시작한 뒤 흐른 초 (도는 동안만 1초마다) */
function useElapsed(startedAt: number | null, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on || startedAt == null) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on, startedAt]);
  return startedAt == null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));
}

export function UpscaleWindow({ up: u, onMode, onRun, onAgain, onSave, onReplace, onClose }: UpscaleWindowProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const running = baeUpRunning(u.phase);
  const sec = useElapsed(u.startedAt, running);
  const [tw, th] = u.plan.target;
  const out = u.phase === 'done' ? u.out : null;
  const shown = out ?? { url: u.sourceUrl, w: u.w, h: u.h };
  const ar = (shown.w || 16) / (shown.h || 9);
  const spec = BAE_UPSCALE_MODES[u.mode];
  const blocked = u.plan.done ? `이미 ${tw}×${th} 이상이라 더 키우지 않아요.` : u.plan.problem;
  const frac = u.phase === 'model' && u.model && u.model.total > 0 ? u.model.done / u.model.total
    : u.phase === 'run' && u.tiles && u.tiles.total > 0 ? u.tiles.done / u.tiles.total : u.phase === 'save' ? 1 : null;

  const footNote = running ? (
    <span className="bae-up-progress">
      <span className="bae-up-line" role="status"><Loader2 size={14} className="bae-spin" aria-hidden="true" /><span>{u.step || '준비 중…'}</span><span className="bae-num bae-up-sec">{sec}초째</span></span>
      <span className="bae-up-bar" aria-hidden="true"><i style={{ transform: `scaleX(${frac ?? 0})` }} /></span>
      <span className="bae-up-sub">{u.phase === 'model' ? '받는 동안 다른 일을 해도 돼요. 창을 닫아도 계속 받고, 다 받으면 이어서 키워요.' : '창을 닫아도 계속 키워요. 끝나면 알려 드리고 기록에 남겨요.'}</span>
    </span>
  ) : u.phase === 'failed' ? (
    <span className="bae-up-err" role="alert">{u.error}</span>
  ) : out ? (
    <span role="status">{u.step} · 기록에 남겼어요</span>
  ) : blocked ? blocked : '이 PC의 그래픽카드로 키워요. 0원이에요.';

  const footActions = out ? (
    <>
      <button type="button" className="bae-btn" onClick={onAgain}><RotateCcw size={16} aria-hidden="true" />방식 다시 고르기</button>
      <button type="button" className="bae-btn bae-btn-primary" onClick={onSave}><Download size={16} aria-hidden="true" />PNG 저장</button>
    </>
  ) : (
    <button type="button" className="bae-btn bae-btn-primary" disabled={running || !!blocked} aria-busy={running || undefined} onClick={onRun}>
      {running ? <Loader2 size={16} className="bae-spin" aria-hidden="true" /> : <Scaling size={16} aria-hidden="true" />}
      {running ? '키우는 중' : u.phase === 'failed' ? '다시 키우기' : '4K로 키우기'}
    </button>
  );

  return (
    <BaeWindow
      tool="upscale"
      icon={<Scaling size={18} aria-hidden="true" />}
      title="4K로 키우기"
      sub={`그림: ${u.label} (${u.w}×${u.h})`}
      headActions={(
        <>
          <button type="button" className="bae-btn bae-btn-s" disabled={running} onClick={() => fileRef.current?.click()}><FolderOpen size={14} aria-hidden="true" />다른 그림 불러오기</button>
          <input ref={fileRef} className="bae-vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onReplace(f); }} />
        </>
      )}
      footNote={footNote}
      footActions={footActions}
      onClose={onClose}
    >
      <div className="bw-cols">
        <div className="bw-main">
          <div className="bw-board bae-up-board">
            <div className="bae-up-fit" style={{ ['--ar' as string]: String(ar) }}>
              <img className="bae-up-img" src={shown.url} alt={out ? `4K로 키운 그림 ${out.w}×${out.h}` : `키울 그림 ${u.w}×${u.h}`} />
              <span className={`bae-tag bae-tag-l bae-num${out ? ' is-live' : ''}`}>{out ? `키운 뒤 ${out.w}×${out.h}` : `지금 ${u.w}×${u.h}`}</span>
            </div>
          </div>
          {u.fromPreview ? <p className="bae-res-note" role="note">{out ? BAE_UPSCALE_PREVIEW_NOTE : baeUpscalePreviewHint(u.w, u.h)}</p> : null}
        </div>
        <div className="bw-side">
          <div className="bae-field">
            <span className="bae-label" id="bae-up-mode">키우는 방식</span>
            <div className="bw-cards" role="group" aria-labelledby="bae-up-mode">
              {(['A', 'B'] as const).map((k) => {
                const m = BAE_UPSCALE_MODES[k];
                return (
                  <div key={k} className={`bw-card${u.mode === k ? ' is-on' : ''}`}>
                    <button type="button" className="bw-card-btn" aria-pressed={u.mode === k} disabled={running} title={m.hint} onClick={() => onMode(k)}>{m.name}</button>
                    <p className="bw-card-text">{m.text}</p>
                    <p className="bw-card-meta">{m.meta} · {m.speed}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <dl className="bae-dl bae-up-dl">
            <div className="bae-fact"><dt>지금 크기</dt><dd className="bae-num">{u.w}×{u.h}</dd></div>
            <div className="bae-fact"><dt>키운 크기</dt><dd className="bae-num">{tw}×{th}</dd></div>
            <div className="bae-fact"><dt>비용</dt><dd className="bae-num">0원</dd></div>
            <div className="bae-fact"><dt>{out ? '계산한 곳 · 시간' : '계산하는 곳'}</dt><dd>{out ? `${baeUpscaleEngineLabel(out.ep, out.fellBack)} · ${baeUpscaleSeconds(out.ms)}` : '이 PC 그래픽카드'}</dd></div>
          </dl>
          <figure className="bw-scale">
            <div className="bw-scale-box" style={{ aspectRatio: `${tw} / ${th}` }}>
              <span className="bw-scale-tag bw-scale-tag-out bae-num">키운 뒤 {tw}×{th}</span>
              <span className="bw-scale-tag bw-scale-tag-in bae-num" style={{ bottom: `calc(${u.plan.inner.h}% + 4px)` }}>지금 {u.w}×{u.h}</span>
              <span className="bw-scale-now" style={{ width: `${u.plan.inner.w}%`, height: `${u.plan.inner.h}%` }}><img src={u.sourceUrl} alt="" /></span>
            </div>
            <figcaption className="bae-hint">
              {u.plan.done ? `이미 ${tw}×${th} 이상이에요.` : `두 크기를 같은 비율로 줄여 견준 그림이에요. ${u.plan.factorText.startsWith('가로') ? `${u.plan.factorText} 커져요.` : `가로와 세로가 ${u.plan.factorText}씩 커져요.`}`}
            </figcaption>
          </figure>
          <p className="bae-hint">{baeModelFirstUseText(u.models[spec.model])}</p>
          <p className="bae-hint bae-up-license">{BAE_UPSCALE_LICENSE}</p>
        </div>
      </div>
    </BaeWindow>
  );
}
