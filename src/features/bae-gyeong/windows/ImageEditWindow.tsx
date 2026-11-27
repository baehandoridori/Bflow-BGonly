// 그림 고치기 창 (2026-11-27 한솔 '재료 창의 이미지를 누르면 이미지 수정 창이 뜰 수 있게'): 재료 창의 레퍼런스 · 기준 배경 그림을 누르면 연다.
// 부품 자르기 창처럼 재료 창 자리를 잠깐 바꿨다가 돌아간다 (창 위에 창을 올리지 않는다, 14d 1장).
//   왼쪽: 그림. 자르기(남길 곳을 네모로 끌기) · 칠하기(가릴 곳을 붓으로) · 스포이드(칠할 색을 그림에서 찍기).
//   위 줄: 왼쪽 · 오른쪽으로 돌리기, 좌우 뒤집기, 되돌리기(Ctrl+Z), 처음 그림으로.
//   '고친 그림 쓰기'를 누르면 재료 창의 그 그림이 바뀐다 (끌어 둔 자르기 네모도 함께). 취소 · X · Esc 는 바꾸지 않고 돌아간다.
// 고친 것은 일 목록으로만 들고 있다가 그때그때 처음 그림부터 다시 굽는다 (src/shared/bae/imageEdit.ts · make/imageEdit.ts).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Brush, Crop, FlipHorizontal2, Info, Loader2, PenLine, Pipette, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { BaeWindow } from './BaeWindow';
import { baeImgBrushSize, baeImgCropOp, baeImgCropRect, baeImgOpsLine, baeImgPush, baeImgShapeChanged, baeImgUndo, type BaeImgOp } from '@/shared/bae/imageEdit';
import { baeImgBase, baeImgBlob, baeImgPaint, baeImgRender } from '../make/imageEdit';
import { baeAverageHex } from '../state/baeBases';
import './bae-stage3.css';
import './bae-image-edit.css';

export interface ImageEditWindowProps {
  kind: 'ref' | 'base';
  /** '레퍼런스 2' · '기준 배경 1 (소파 쪽)' */
  label: string;
  src: string;
  /** 기준 배경의 부품 수 (자르기 · 돌리기 · 뒤집기를 하면 지워진다) */
  parts: number;
  /** 고친 그림 쓰기. 바꿨으면 참 (창은 여는 쪽이 닫는다). */
  onApply(blob: Blob, shapeChanged: boolean): Promise<boolean>;
  onClose(): void;
}

type Tool = 'crop' | 'paint' | 'pick';
type Box = { u0: number; v0: number; u1: number; v1: number };
type Drag = ({ tool: 'crop' } & Box) | { tool: 'paint'; pts: number[]; lx: number; ly: number };
const COLORS = ['#FFFFFF', '#F3EFE6', '#D8D2C6', '#9A968E', '#4A4844', '#000000'];
const BRUSH_MIN = 4, BRUSH_MAX = 160;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const typing = () => /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement | null)?.tagName ?? '');

/** 지금 그림의 (u, v) 둘레 5×5 평균 색 */
function pickHex(c: HTMLCanvasElement, u: number, v: number): string {
  const t = document.createElement('canvas'); t.width = 5; t.height = 5; const x = t.getContext('2d', { willReadFrequently: true })!;
  const sx = Math.max(0, Math.min(Math.max(0, c.width - 5), Math.round(u * c.width) - 2)), sy = Math.max(0, Math.min(Math.max(0, c.height - 5), Math.round(v * c.height) - 2));
  x.drawImage(c, sx, sy, 5, 5, 0, 0, 5, 5);
  return baeAverageHex(x.getImageData(0, 0, 5, 5).data);
}

export function ImageEditWindow(p: ImageEditWindowProps) {
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [ops, setOps] = useState<BaeImgOp[]>([]);
  const [tool, setTool] = useState<Tool>('crop');
  const [crop, setCrop] = useState<Box | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [brush, setBrush] = useState(28);
  const [busy, setBusy] = useState(false);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const hover = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true; const img = new Image();
    img.onload = () => { if (alive) { try { setBase(baeImgBase(img)); } catch { setFailed(true); } } };
    img.onerror = () => { if (alive) setFailed(true); };
    img.src = p.src;
    return () => { alive = false; };
  }, [p.src]);

  const cur = useMemo(() => (base ? baeImgRender(base, ops) : null), [base, ops]);
  const W = cur?.width ?? 16, H = cur?.height ?? 9;
  const cropOp = crop ? baeImgCropOp(crop, W, H) : null;
  const cropPx = cropOp ? baeImgCropRect(W, H, cropOp) : null;
  const viewLong = () => { const r = cvRef.current?.getBoundingClientRect(); return Math.max(1, r?.width ?? 1, r?.height ?? 1); };

  const draw = useCallback(() => {
    const cv = cvRef.current; if (!cv || !cur) return; const x = cv.getContext('2d'); if (!x) return;
    const CW = cv.width, CH = cv.height, dpr = window.devicePixelRatio || 1;
    x.clearRect(0, 0, CW, CH); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, CW, CH);
    const d = drag.current;
    const box = d?.tool === 'crop' ? d : crop;
    if (box) {
      // 정수 픽셀로 (어두운 네 조각 사이에 가는 줄이 비치지 않게)
      const x0 = Math.round(Math.min(box.u0, box.u1) * CW), x1 = Math.round(Math.max(box.u0, box.u1) * CW), y0 = Math.round(Math.min(box.v0, box.v1) * CH), y1 = Math.round(Math.max(box.v0, box.v1) * CH);
      x.fillStyle = 'rgba(8,10,16,.58)';
      x.fillRect(0, 0, CW, y0); x.fillRect(0, y1, CW, CH - y1); x.fillRect(0, y0, x0, y1 - y0); x.fillRect(x1, y0, CW - x1, y1 - y0);
      x.lineWidth = 2 * dpr; x.strokeStyle = '#FFFFFF'; x.setLineDash([7 * dpr, 5 * dpr]); x.strokeRect(x0, y0, x1 - x0, y1 - y0); x.setLineDash([]);
    }
    if (d?.tool === 'paint') baeImgPaint(x, CW, CH, { t: 'paint', color, size: baeImgBrushSize(brush, viewLong()), pts: d.pts.length === 2 ? [d.pts[0], d.pts[1], d.pts[0], d.pts[1]] : d.pts });
    const hv = hover.current;
    if (hv && !d && tool === 'paint') {
      x.beginPath(); x.arc(hv.x * dpr, hv.y * dpr, Math.max(2, (brush / 2) * dpr), 0, Math.PI * 2);
      x.lineWidth = 1.5 * dpr; x.strokeStyle = 'rgba(255,255,255,.95)'; x.stroke();
      x.beginPath(); x.arc(hv.x * dpr, hv.y * dpr, Math.max(2, (brush / 2) * dpr) + 1.5 * dpr, 0, Math.PI * 2); x.strokeStyle = 'rgba(0,0,0,.6)'; x.stroke();
    }
  }, [cur, crop, color, brush, tool]);

  // 캔버스 크기 = 그림이 놓인 크기 × 화면 배율 (부품 자르기 창과 같다)
  useLayoutEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const size = () => { const r = cv.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr)); draw(); };
    size(); const ro = new ResizeObserver(size); ro.observe(cv);
    return () => ro.disconnect();
  }, [draw, W, H]);
  useEffect(() => { draw(); }, [draw]);

  const push = useCallback((op: BaeImgOp) => { setOps((o) => baeImgPush(o, op)); if (op.t !== 'paint') setCrop(null); }, []);
  const applyCrop = useCallback(() => { if (cropOp) push(cropOp); setCrop(null); }, [cropOp, push]);
  const undo = useCallback(() => { if (crop) { setCrop(null); return; } setOps((o) => baeImgUndo(o)); }, [crop]);
  const reset = () => { setOps([]); setCrop(null); };
  const pickTool = (t: Tool) => { setTool(t); if (t !== 'crop') setCrop(null); };

  const finalOps = cropOp ? baeImgPush(ops, cropOp) : ops;
  const changed = finalOps.length > 0;
  const apply = async () => {
    if (!base || !changed || busy) return;
    setBusy(true);
    try {
      const blob = await baeImgBlob(cropOp ? baeImgRender(base, finalOps) : (cur as HTMLCanvasElement));
      if (!(await p.onApply(blob, baeImgShapeChanged(finalOps)))) setBusy(false);
    } catch (e) { toast(e instanceof Error && e.message ? e.message : '고친 그림을 만들지 못했어요'); setBusy(false); }
  };

  // 키: Esc 는 끌어 둔 네모가 있으면 그것만 지운다 (창은 그대로) · Ctrl+Z 되돌리기 · Enter 자르기. 창 틀보다 먼저 받는다.
  const keys = useRef({ crop, undo, applyCrop, busy });
  keys.current = { crop, undo, applyCrop, busy };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current; if (k.busy || e.isComposing) return;
      if (e.key === 'Escape' && k.crop) { e.preventDefault(); e.stopPropagation(); setCrop(null); return; }
      if (typing()) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); k.undo(); return; }
      if (e.key === 'Enter' && k.crop && !(document.activeElement instanceof HTMLButtonElement)) { e.preventDefault(); e.stopPropagation(); k.applyCrop(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = cvRef.current!.getBoundingClientRect();
    return { u: clamp01((e.clientX - r.left) / r.width), v: clamp01((e.clientY - r.top) / r.height), x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const shapeNow = baeImgShapeChanged(finalOps);
  const partsNote = p.kind === 'base' && p.parts > 0
    ? { warn: shapeNow, text: `자르기 · 돌리기 · 뒤집기를 하면 이 기준 배경의 부품 ${p.parts}개는 지워져요. 고친 뒤 부품을 다시 잘라 주세요. 칠하기만 하면 그대로예요.` }
    : null;
  const toolHint = tool === 'crop'
    ? '남길 곳을 네모로 끌어요. 다시 끌면 새로 골라요. Enter로 자르고, Esc는 네모만 지워요.'
    : tool === 'pick' ? '그림에서 색을 누르면 그 색으로 칠해요.' : '가릴 곳을 붓으로 칠해요. 스포이드로 옆의 벽 · 바닥 색을 찍어 칠하면 자연스러워요.';

  return (
    <BaeWindow
      className="bae-pop-imgedit"
      tool={p.kind === 'base' ? 'same' : 'new'}
      icon={<PenLine size={18} aria-hidden="true" />}
      title="그림 고치기"
      sub={`${p.label} · 자르고, 돌리고, 칠해서 고쳐요. 고친 그림이 재료 창의 그림 자리에 들어가요`}
      footNote={changed ? `고친 것: ${baeImgOpsLine(finalOps)} · ${(cropPx ? [cropPx.sw, cropPx.sh] : [W, H]).join(' × ')}` : '내 PC의 원래 파일은 그대로예요'}
      footActions={(
        <>
          <button type="button" className="bae-btn bae-btn-ghost" disabled={busy} onClick={p.onClose}>취소</button>
          <button type="button" className="bae-btn bae-btn-primary" disabled={!changed || busy || !cur} aria-busy={busy || undefined} onClick={() => { void apply(); }}>
            {busy ? <Loader2 size={16} className="bae-spin" aria-hidden="true" /> : null}고친 그림 쓰기
          </button>
        </>
      )}
      onClose={() => { if (!busy) p.onClose(); }}
    >
      <div className="bw-cols">
        <div className="bw-main">
          <div className="bw-bar bae-ie-bar" role="toolbar" aria-label="그림 고치기 도구">
            <span className="bae-seg">
              <button type="button" className="bae-btn bae-btn-s" aria-pressed={tool === 'crop'} onClick={() => pickTool('crop')}><Crop size={14} aria-hidden="true" />자르기</button>
              <button type="button" className="bae-btn bae-btn-s" aria-pressed={tool !== 'crop'} onClick={() => pickTool('paint')}><Brush size={14} aria-hidden="true" />칠하기</button>
            </span>
            <span className="bae-ie-sep" aria-hidden="true" />
            <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" disabled={!cur || busy} onClick={() => push({ t: 'rot', d: -1 })}><RotateCcw size={14} aria-hidden="true" />왼쪽으로 돌리기</button>
            <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" disabled={!cur || busy} onClick={() => push({ t: 'rot', d: 1 })}><RotateCw size={14} aria-hidden="true" />오른쪽으로 돌리기</button>
            <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" disabled={!cur || busy} onClick={() => push({ t: 'flip' })}><FlipHorizontal2 size={14} aria-hidden="true" />좌우 뒤집기</button>
            <span className="bw-bar-end">
              <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" disabled={(!ops.length && !crop) || busy} title="Ctrl+Z" onClick={undo}><Undo2 size={14} aria-hidden="true" />되돌리기</button>
              <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" disabled={(!ops.length && !crop) || busy} onClick={reset}>처음 그림으로</button>
            </span>
          </div>
          <div className="bw-board bae-ie-board">
            {cur ? (
              <div className="bae-pt-fit bae-ie-fit" style={{ ['--ar' as string]: String(W / H) }}>
                <canvas
                  ref={cvRef}
                  className={`bae-ie-canvas is-${tool}`}
                  aria-label={tool === 'crop' ? '네모를 끌어서 남길 곳 고르기' : tool === 'pick' ? '눌러서 칠할 색 찍기' : '끌어서 칠하기'}
                  onPointerDown={(e) => {
                    if (e.button !== 0 || busy) return; const q = at(e);
                    if (tool === 'pick') { setColor(pickHex(cur, q.u, q.v)); setTool('paint'); return; }
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = tool === 'crop' ? { tool: 'crop', u0: q.u, v0: q.v, u1: q.u, v1: q.v } : { tool: 'paint', pts: [q.u, q.v], lx: q.x, ly: q.y };
                    draw();
                  }}
                  onPointerMove={(e) => {
                    const q = at(e); hover.current = { x: q.x, y: q.y }; const d = drag.current;
                    if (d?.tool === 'crop') { d.u1 = q.u; d.v1 = q.v; }
                    else if (d?.tool === 'paint' && Math.hypot(q.x - d.lx, q.y - d.ly) >= 1.5) { d.pts.push(q.u, q.v); d.lx = q.x; d.ly = q.y; }
                    draw();
                  }}
                  onPointerUp={(e) => {
                    const d = drag.current; if (!d) return; drag.current = null;
                    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 이미 놓음 */ }
                    if (d.tool === 'crop') {
                      // 화면에서도 8px 넘게 끌었을 때만 (누르기만 한 손에 네모가 생기지 않게)
                      const r = e.currentTarget.getBoundingClientRect(); const box = { u0: d.u0, v0: d.v0, u1: d.u1, v1: d.v1 };
                      const big = Math.abs(d.u1 - d.u0) * r.width >= 8 && Math.abs(d.v1 - d.v0) * r.height >= 8;
                      setCrop(big && baeImgCropOp(box, W, H) ? box : null); draw(); return;
                    }
                    push({ t: 'paint', color, size: baeImgBrushSize(brush, viewLong()), pts: d.pts.length === 2 ? [d.pts[0], d.pts[1], d.pts[0], d.pts[1]] : d.pts.slice() });
                  }}
                  onPointerLeave={() => { hover.current = null; draw(); }}
                  onPointerCancel={() => { drag.current = null; draw(); }}
                />
              </div>
            ) : (
              <p className="bae-hint" role={failed ? 'alert' : 'status'}>{failed ? '그림을 열지 못했어요. 창을 닫고 그림을 다시 넣어 주세요.' : <><Loader2 size={14} className="bae-spin" aria-hidden="true" /> 그림을 여는 중</>}</p>
            )}
          </div>
        </div>
        <div className="bw-side">
          <section className="bae-mgroup" aria-labelledby="bae-ie-tool-h">
            <div className="bae-mhead">
              <p className="bae-mhead-name" id="bae-ie-tool-h">{tool === 'crop' ? '자르기' : '칠하기'}</p>
              <span className="bae-mcount bae-num">{(cropPx ? [cropPx.sw, cropPx.sh] : [W, H]).join(' × ')}</span>
            </div>
            <p className="bae-hint">{toolHint}</p>
            {tool === 'crop' ? (
              <div className="bae-ie-row">
                <button type="button" className="bae-btn bae-btn-s" disabled={!cropOp || busy} onClick={applyCrop}><Crop size={14} aria-hidden="true" />이 네모만 남기기</button>
                <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" disabled={!crop || busy} onClick={() => setCrop(null)}>네모 지우기</button>
              </div>
            ) : (
              <>
                <div className="bae-ie-colors" role="group" aria-label="칠할 색">
                  {COLORS.map((c) => <button key={c} type="button" className="bae-ie-swatch" style={{ background: c }} title={c} aria-label={'색 ' + c} aria-pressed={color.toUpperCase() === c} onClick={() => { setColor(c); setTool('paint'); }} />)}
                  <label className="bae-ie-custom" title="직접 고르기">
                    <span className="bae-vh">직접 고르기</span>
                    <input type="color" value={color.toLowerCase()} onChange={(e) => { setColor(e.target.value.toUpperCase()); setTool('paint'); }} />
                  </label>
                  <button type="button" className="bae-btn bae-btn-s" aria-pressed={tool === 'pick'} onClick={() => setTool(tool === 'pick' ? 'paint' : 'pick')}><Pipette size={14} aria-hidden="true" />스포이드</button>
                </div>
                <label className="bae-ie-size">
                  <span className="bae-label">붓 굵기</span>
                  <input className="bae-ie-range" type="range" min={BRUSH_MIN} max={BRUSH_MAX} step={1} value={brush} aria-valuetext={`${brush}픽셀`} onChange={(e) => setBrush(Number(e.target.value))} />
                  <span className="bae-num bae-ie-size-v">{brush}</span>
                </label>
              </>
            )}
          </section>
          {partsNote ? (
            <p className={`bae-mt-msg is-${partsNote.warn ? 'warn' : 'info'}`} role="status">
              {partsNote.warn ? <AlertTriangle size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}<span>{partsNote.text}</span>
            </p>
          ) : null}
          <p className="bae-hint">{p.kind === 'base' ? '고친 기준 배경은 색 견본을 다시 골라요.' : '고친 레퍼런스로 바꾸면 만들어 둔 주문서는 다시 만들어야 해요.'}</p>
        </div>
      </div>
    </BaeWindow>
  );
}
