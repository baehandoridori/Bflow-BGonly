// 부품 자르기 창 (HTML v0.4.11 Parts, script_4.js 1095~1188줄): 재료 창에서 열고, 닫으면(완료 · X · Esc) 재료 창으로 돌아간다.
// 창 위에 창을 올리지 않는다 (14d 1장) — 재료 창의 내용을 이 창으로 바꿨다가 되돌린다.
//   왼쪽: 기준 배경 위에 네모를 끌어서 부품을 자른다. 누르면 그 네모를 고르고 Delete 로 지운다. 부품은 모두 합쳐 16개까지.
//   오른쪽: 자른 부품(작은 그림 · 이름 · 빼기), 색 견본(엔진이 고른 색 · 스포이드로 더하기 · ×로 빼기 · 자동 색 다시).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pipette, RotateCcw, Scissors, X } from 'lucide-react';
import { toast } from 'sonner';
import type { BaePlaceBase, BaePlacePart, BaePlaceSwatches } from '@/shared/bae/place';
import { baePlaceBaseSwatches } from '@/shared/bae/place';
import { partPreviewUrl } from '../make/place';
import { BaeWindow } from './BaeWindow';
import { BAE_PART_MAX, baeAverageHex, baeBoxBigEnough, baeHitPart, baeNormBox, baePartCount, baeSwatchPick, baeSwatchRemove } from '../state/baeBases';
import './bae-stage3.css';

export interface PartsWindowProps {
  bases: BaePlaceBase[];
  at: number;
  onTab(i: number): void;
  onParts(id: number, parts: BaePlacePart[]): void;
  onSwatches(id: number, sw: BaePlaceSwatches): void;
  onSwatchReset(id: number): void;
  /** 부품이 바뀐 지 잠시 뒤: 색 견본 다시 고르기 (바뀐 것만) */
  onPartsSettled(id: number): void;
  onDone(): void;
}

type Drag = { kind: 'press' | 'new'; u0: number; v0: number; u1: number; v1: number; hit: number; cx: number; cy: number; id: number };
const FONT = 'Pretendard, "Malgun Gothic", sans-serif';

export function PartsWindow(p: PartsWindowProps) {
  const b = p.bases[Math.max(0, Math.min(p.bases.length - 1, p.at))];
  const imgRef = useRef<HTMLImageElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [sel, setSel] = useState(-1);
  const [picking, setPicking] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [, force] = useState(0);
  const total = baePartCount(p.bases);
  const parts = b?.parts ?? [];

  const draw = useCallback(() => {
    const cv = cvRef.current; if (!cv || !b) return;
    const x = cv.getContext('2d'); if (!x) return;
    const W = cv.width, H = cv.height, dpr = window.devicePixelRatio || 1; x.clearRect(0, 0, W, H);
    const box = (q: Omit<BaePlacePart, 'name'> & { name?: string }, i: number, live: boolean) => {
      const X = q.x0 * W, Y = q.y0 * H, w = (q.x1 - q.x0) * W, h = (q.y1 - q.y0) * H; const on = i === sel;
      x.fillStyle = on ? 'rgba(30,140,255,.16)' : 'rgba(30,140,255,.06)'; x.fillRect(X, Y, w, h);
      x.lineWidth = (on ? 3 : 2) * dpr; x.strokeStyle = live ? '#EE7E12' : on ? '#1E8CFF' : 'rgba(30,140,255,.85)'; x.setLineDash(live ? [8 * dpr, 6 * dpr] : []); x.strokeRect(X, Y, w, h); x.setLineDash([]);
      if (!live) {
        const t = String(i + 1) + (q.name ? ' ' + q.name : ''); x.font = '700 ' + Math.round(12 * dpr) + 'px ' + FONT; const tw = x.measureText(t).width;
        x.fillStyle = on ? '#1E8CFF' : 'rgba(30,140,255,.92)'; x.fillRect(X, Y, tw + 10 * dpr, 18 * dpr); x.fillStyle = '#fff'; x.fillText(t, X + 5 * dpr, Y + 13 * dpr);
      }
    };
    b.parts.forEach((q, i) => box(q, i, false));
    const d = drag.current; if (d && d.kind === 'new' && d.id === b.id) box(baeNormBox(d), -1, true);
  }, [b, sel]);

  // 캔버스 크기 = 그림이 놓인 크기 × 화면 배율 (HTML sizeCanvas)
  useLayoutEffect(() => {
    const img = imgRef.current, cv = cvRef.current; if (!img || !cv) return;
    const size = () => { const r = img.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr)); draw(); };
    size(); const ro = new ResizeObserver(size); ro.observe(img);
    return () => ro.disconnect();
  }, [draw, b?.src]);
  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { setSel(-1); setPicking(false); }, [b?.id]);

  // 부품 작은 그림 (HTML renderSide: partCanvas(b, p, 160) JPEG 0.8)
  useEffect(() => {
    if (!b) return; let alive = true;
    void Promise.all(b.parts.map(async (q) => [`${b.id}:${q.x0},${q.y0},${q.x1},${q.y1}`, await partPreviewUrl(b, q).catch(() => '')] as const)).then((list) => {
      if (alive) setThumbs((t) => ({ ...t, ...Object.fromEntries(list) }));
    });
    return () => { alive = false; };
  }, [b]);
  // 부품이 바뀐 지 0.45초 뒤 색 견본을 다시 (HTML changedParts)
  const partsKey = b ? JSON.stringify(b.parts.map((q) => [q.x0, q.y0, q.x1, q.y1])) : '';
  useEffect(() => {
    if (!b) return; const id = b.id;
    const t = window.setTimeout(() => p.onPartsSettled(id), 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsKey]);

  const del = useCallback((i: number) => {
    if (!b || i < 0 || i >= b.parts.length) return;
    p.onParts(b.id, b.parts.filter((_, k) => k !== i)); setSel(-1);
  }, [b, p]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0 && !/INPUT|TEXTAREA/.test((document.activeElement as HTMLElement | null)?.tagName ?? '')) { e.preventDefault(); del(sel); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, del]);

  if (!b) return null;
  const at = (e: { clientX: number; clientY: number }) => {
    const r = cvRef.current!.getBoundingClientRect();
    return { u: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), v: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const pickAt = (q: { u: number; v: number }) => {
    const img = imgRef.current!; const iw = img.naturalWidth, ih = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = 5; c.height = 5; const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(img, Math.max(0, Math.min(Math.max(0, iw - 5), Math.round(q.u * iw) - 2)), Math.max(0, Math.min(Math.max(0, ih - 5), Math.round(q.v * ih) - 2)), 5, 5, 0, 0, 5, 5);
    return baeAverageHex(x.getImageData(0, 0, 5, 5).data);
  };
  const chips = b.sw.auto === null ? null : baePlaceBaseSwatches(b);
  const hint = picking ? '그림에서 색을 누르면 색 견본에 더해요' : `네모를 누르고 Delete로 지워요 · 부품은 ${BAE_PART_MAX}개까지`;

  return (
    <BaeWindow
      tool="same"
      icon={<Scissors size={18} aria-hidden="true" />}
      title="부품 자르기"
      sub="기준 배경에서 가구, 창, 문, 액자 같은 물건을 하나씩 네모로 끌어서 잘라요"
      footNote={hint}
      footActions={<button type="button" className="bae-btn bae-btn-primary" onClick={p.onDone}>완료</button>}
      onClose={p.onDone}
    >
      <div className="bw-cols">
        <div className="bw-main">
          {p.bases.length > 1 ? (
            <div className="bae-pt-tabs" role="group" aria-label="기준 배경 고르기">
              {p.bases.map((x, i) => (
                <button key={x.id} type="button" className="bae-btn bae-btn-s bae-pt-tab" aria-pressed={x.id === b.id} onClick={() => p.onTab(i)}>
                  <img src={x.src} alt="" />{x.note || `기준 배경 ${i + 1}`} · {x.parts.length}
                </button>
              ))}
            </div>
          ) : null}
          <div className="bw-board bae-pt-board">
            <div className="bae-pt-fit" style={{ ['--ar' as string]: String((b.w || 16) / (b.h || 9)) }}>
              <img ref={imgRef} className="bae-pt-img" src={b.src} alt="기준 배경" onLoad={() => force((n) => n + 1)} />
              <canvas
                ref={cvRef}
                className={`bae-pt-canvas${picking ? ' is-pick' : ''}`}
                aria-label="네모를 끌어서 부품 자르기"
                onPointerDown={(e) => {
                  if (e.button !== 0) return; const q = at(e);
                  if (picking) { p.onSwatches(b.id, baeSwatchPick(b.sw, pickAt(q))); setPicking(false); return; }
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = { kind: 'press', u0: q.u, v0: q.v, u1: q.u, v1: q.v, hit: baeHitPart(b.parts, q), cx: e.clientX, cy: e.clientY, id: b.id };
                }}
                onPointerMove={(e) => {
                  const d = drag.current; if (!d) return; const q = at(e); d.u1 = q.u; d.v1 = q.v;
                  if (d.kind === 'press' && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) > 6) {
                    if (total >= BAE_PART_MAX) { toast(`부품은 ${BAE_PART_MAX}개까지 자를 수 있어요`); drag.current = null; return; }
                    d.kind = 'new'; setSel(-1);
                  }
                  if (d.kind === 'new') draw();
                }}
                onPointerUp={(e) => {
                  const d = drag.current; if (!d) return; drag.current = null;
                  try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 이미 놓음 */ }
                  if (d.kind === 'press') { setSel(d.hit); return; }
                  const q = baeNormBox(d); const cv = e.currentTarget;
                  if (!baeBoxBigEnough(q, cv.width, cv.height)) { draw(); return; }
                  p.onParts(b.id, [...b.parts, { ...q, name: '' }]); setSel(b.parts.length);
                }}
                onPointerCancel={() => { drag.current = null; draw(); }}
              />
            </div>
          </div>
        </div>
        <div className="bw-side">
          <section className="bae-mgroup" aria-labelledby="bae-pt-parts-h">
            <div className="bae-mhead">
              <p className="bae-mhead-name" id="bae-pt-parts-h">자른 부품</p>
              <span className="bae-mcount bae-num">{parts.length}개{p.bases.length > 1 ? ` (모두 ${total}개)` : ''}</span>
            </div>
            {parts.length ? (
              <ul className="bae-mats">
                {parts.map((q, i) => (
                  <li key={i} className={`bae-mrow bae-pt-row${i === sel ? ' is-on' : ''}`} onClick={(e) => { if (!(e.target as HTMLElement).closest('input,button')) setSel(i); }}>
                    <span className="bae-pt-num bae-num">{i + 1}</span>
                    <span className="bw-thumb bae-pt-thumb">{thumbs[`${b.id}:${q.x0},${q.y0},${q.x1},${q.y1}`] ? <img src={thumbs[`${b.id}:${q.x0},${q.y0},${q.x1},${q.y1}`]} alt="" /> : null}</span>
                    <input className="bae-minput" type="text" value={q.name} placeholder="이름 (선택) 예) 소파" aria-label={`부품 ${i + 1} 이름`}
                      onChange={(e) => p.onParts(b.id, b.parts.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                    <button type="button" className="bae-ib" aria-label={`부품 ${i + 1} 빼기`} title="빼기" onClick={() => del(i)}><X size={16} aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="bae-hint">아직 없어요. 왼쪽 그림에서 가구를 네모로 끌어 주세요.</p>}
          </section>
          <section className="bae-mgroup" aria-labelledby="bae-pt-sw-h">
            <div className="bae-mhead">
              <p className="bae-mhead-name" id="bae-pt-sw-h">색 견본</p>
              <span className="bae-mcount">벽·옆벽·바닥·걸레받이</span>
            </div>
            <div className="bae-pt-sw" aria-live="polite">
              {chips === null ? <span className="bae-hint">색을 고르는 중…</span> : chips.length ? chips.map((h) => (
                <span key={h} className="bae-pt-chip" style={{ background: h }} title={h}>
                  <button type="button" aria-label={`색 ${h} 빼기`} title="빼기" onClick={() => p.onSwatches(b.id, baeSwatchRemove(b.sw, h))}><X size={12} aria-hidden="true" /></button>
                </span>
              )) : <span className="bae-hint">색 견본이 없어요</span>}
            </div>
            <div className="bae-pt-swbar">
              <button type="button" className="bae-btn bae-btn-s" aria-pressed={picking} onClick={() => setPicking(!picking)}><Pipette size={14} aria-hidden="true" />스포이드로 색 더하기</button>
              <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" onClick={() => p.onSwatchReset(b.id)}><RotateCcw size={14} aria-hidden="true" />자동 색 다시</button>
            </div>
            <p className="bae-hint">색은 부품을 뺀 나머지에서 자동으로 골라요. 빠진 색(걸레받이 같은)은 스포이드로 더하고, 필요 없는 색은 ×로 빼요.</p>
          </section>
        </div>
      </div>
    </BaeWindow>
  );
}
