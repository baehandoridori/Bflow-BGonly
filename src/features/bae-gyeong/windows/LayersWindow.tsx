// 레이어로 나누기 창 (계획 14d 3-2, 시안 WinLayers): HTML v0.4.4 레이어 계획 창과 같은 세 단계.
//   1 물건 찾기 (자동, PD 약 10원 + 이 PC 가 윤곽) → 2 계획 고치기 (사람, 0원) → 3 나누기 (빈 방 다시 그리기 약 80원, PSD 저장)
// 왼쪽: 그림 위에 물건마다 층 색의 반투명 윤곽과 이름표, 층 색 설명, '빠진 물건 네모로 추가'.
// 오른쪽 위: PSD 에 들어갈 레이어 (폴더 OL · ML · UL, ML 맨 아래 '배경 (빈 방)', 그림자 줄, '나누지 않음' 묶음).
// 오른쪽 아래: 고른 물건 고치기 (이름 · 층 · 그림자 따로 · 나누지 않음 · 하나씩 따로 · 합치기 · 윤곽 후보) + '작은 것 합치기'.
// 흐름과 상태는 layers/useLayersSession.ts, 규칙은 layers/planModel.ts. 이 파일은 그리기만 한다.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BoxSelect, Check, Eye, Folder, FolderOpen, Layers, Loader2, Pencil, RotateCcw, Square, AlertTriangle } from 'lucide-react';
import { BaeWindow } from './BaeWindow';
import type { BaeLayersGateway } from '@/shared/bae/layers';
import { baeLayersGateway, unavailableLayersGateway } from '../layers/layersApi';
import { baeModelGateway, type BaeModelGateway } from '../modelApi';
import type { LayersClient } from '../layers/layersClient';
import { useLayersSession, type LayersPicture } from '../layers/useLayersSession';
import {
  allIds, binOfId, candsOf, editorState, estimate, groupOf, headOf, labelsOf, legendCounts, mergeRows, pickOf, sumOf, treeRows, boxOfDrag,
  setName, setBin, setMode as setBundleMode, toggleKeep, toggleShadow, setPick, unmerge, remerge, unmergeAll, toggleMergeGroup, removeBoxed,
  BIN_INFO, type LayerBin,
} from '../layers/planModel';
import { drawOutlines, hitTest, makeSprite, placeLabels, unpackMask, type UnpackedMask } from '../layers/draw';
import '../home/bench.css';
import '../make/making-stage.css';
import './bae-layers.css';

export type { LayersPicture };

export interface LayersWindowProps {
  /** 나눌 그림. 시작 줄(파일 고르기)이면 parentJobId null, 결과에서 열면 그 작업 id */
  picture: LayersPicture;
  onClose(): void;
  /** 원/달러 (안내 금액, 설정의 prices.krwPerUsd) */
  krwPerUsd?: number;
  /** 시험 · 미리보기용 주입 (없으면 window.baeLayersAPI · window.baeModelAPI · 앱의 레이어 일꾼) */
  gateway?: BaeLayersGateway;
  modelGateway?: BaeModelGateway;
  client?: LayersClient;
}

const BIN_CLS: Record<LayerBin, string> = { OL: 'lay-ol', ML: 'lay-ml', UL: 'lay-ul' };
const BIN_SHORT: Record<LayerBin, string> = { OL: '캐릭터 앞', ML: '캐릭터 뒤', UL: '원경' };

export function LayersWindow(p: LayersWindowProps) {
  // 통로가 없으면 (테스트 모드 등) 창은 뜨고, 일을 시키면 그 까닭을 보여 준다
  const gateway = useMemo(() => { try { return p.gateway ?? baeLayersGateway(); } catch (e) { return unavailableLayersGateway((e as Error).message); } }, [p.gateway]);
  const modelGateway = useMemo(() => { try { return p.modelGateway ?? baeModelGateway(); } catch (e) { return unavailableModelGateway((e as Error).message); } }, [p.modelGateway]);
  const L = useLayersSession({ picture: p.picture, gateway, modelGateway, client: p.client, rate: p.krwPerUsd });
  const { s, view } = L;
  const rate = p.krwPerUsd ?? 1400;
  const fileRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(true);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [colors, setColors] = useState<Record<LayerBin | 'none', string>>({ OL: '#E17055', ML: '#A29BFE', UL: '#55EFC4', none: '#8B8DA3' });

  const prop = s.proposal; const plan = s.plan;
  const W = prop?.W || s.natW || 16, H = prop?.H || s.natH || 9;
  const ar = (W / H) || 16 / 9;

  // 층 색 (밝은 · 어두운 화면 토큰) — 캔버스에 쓸 값. 화면 밝기를 바꾸면 다시 읽는다.
  useEffect(() => {
    const read = () => {
      const el = boardRef.current; if (!el) return;
      const cs = getComputedStyle(el); const v = (k: string, d: string) => { const t = cs.getPropertyValue(k).trim(); return t ? `rgb(${t})` : d; };
      const next = { OL: v('--bae-ol', '#E17055'), ML: v('--bae-ml', '#A29BFE'), UL: v('--bae-ul', '#55EFC4'), none: v('--bae-lay-none', '#8B8DA3') };
      setColors((c) => (c.OL === next.OL && c.ML === next.ML && c.UL === next.UL && c.none === next.none ? c : next));
    };
    read();
    const mo = new MutationObserver(read); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'class'] });
    return () => mo.disconnect();
  }, [s.src]);
  // 그림 칸 크기 (이름표 자리 · 캔버스)
  useEffect(() => {
    const el = canvasRef.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: Math.round(r.width), h: Math.round(r.height) }); });
    ro.observe(el); return () => ro.disconnect();
  }, [s.src]);

  // 윤곽: 지금 고른 후보의 마스크 · 그림 (HTML lpMask · lpSprite 의 기억)
  const masks = useRef(new Map<string, UnpackedMask | null>());
  const sprites = useRef(new Map<string, HTMLCanvasElement | OffscreenCanvas | null>());
  useEffect(() => { masks.current.clear(); sprites.current.clear(); }, [prop]);
  const maskOf = (id: string): UnpackedMask | null => {
    if (!plan || !prop) return null;
    const k = id + '|' + pickOf(plan, id); if (masks.current.has(k)) return masks.current.get(k)!;
    const cs = candsOf(plan, prop, id); const c = cs[pickOf(plan, id)] || cs.find(Boolean) || null;
    const m = unpackMask(c); masks.current.set(k, m); return m;
  };
  const colorOf = (id: string) => { if (!view || !plan) return colors.none; const b = binOfId(view, plan, id); return b ? colors[b] : colors.none; };
  const spriteOf = (id: string, strong: boolean) => {
    if (!plan) return null; const col = colorOf(id); const k = id + '|' + pickOf(plan, id) + '|' + col + '|' + (strong ? 1 : 0);
    if (sprites.current.has(k)) return sprites.current.get(k)!;
    const m = maskOf(id); const sp = m ? makeSprite(m, col, strong) : null; sprites.current.set(k, sp); return sp;
  };
  const ids = plan && prop ? allIds(plan, prop) : [];
  const hi = useMemo(() => new Set(groupOf(view, s.sel)), [view, s.sel]);
  const dragBox = drag ? [Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1), Math.max(drag.x0, drag.x1), Math.max(drag.y0, drag.y1)] : s.pendBox;

  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    if (!plan || !prop || !view) { const x = cv.getContext('2d'); x?.clearRect(0, 0, cv.width, cv.height); return; }
    drawOutlines({ canvas: cv, W, H, ids, maskOf, spriteOf, highlight: hi, hover, showAll, box: dragBox, boxColor: colors.ML });
  });   // 그릴 것이 많아 매번 (그림 크기 · 계획 · 고른 것 · 손 · 네모가 바뀔 때마다 다시 그리면 같다)

  // 이름표 (레이어마다 하나, 원경 포함): 버튼으로
  const measure = useMemo(() => {
    const c = document.createElement('canvas').getContext('2d'); if (c) c.font = '500 12px Pretendard Variable, Pretendard, system-ui, sans-serif';
    return (t: string) => (c ? c.measureText(t).width : t.length * 7);
  }, []);
  const chips = useMemo(() => (view && plan && size.w ? placeLabels({ labels: labelsOf(view), maskOf, W, H, cw: size.w, ch: size.h, measure, highlight: hi, hover, showAll }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, plan, size.w, size.h, hi, hover, showAll, W, H]);

  const at = (e: { clientX: number; clientY: number }) => { const r = canvasRef.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; };
  const canEdit = !!plan && !!view && !L.busy;

  const ed = view && plan && prop ? editorState(view, plan, prop, s.sel) : null;
  const tree = view && plan && prop ? treeRows(view, plan, prop, s.sel, s.summary && !L.dirty ? s.summary : null) : [];
  const merges = plan && prop ? mergeRows(plan, prop) : [];
  const legend = view ? legendCounts(view) : null;
  const sum = view ? sumOf(view, s.summary, L.dirty) : null;
  const est = plan && prop ? estimate({ plan, p: prop, plated: s.plated, summary: s.summary, splitPlan: s.splitPlan, rate }) : null;
  const showDone = s.phase === 'done' && !!s.summary && !L.dirty;

  /* ---------- 단계 줄 ---------- */
  const runStep = s.steps.find(([id]) => s.st[id]?.state === 'run');
  const runText = runStep ? runStep[1] + (s.st[runStep[0]]?.sub ? ` · ${s.st[runStep[0]]!.sub}` : '') : '';
  const failed = s.steps.some(([id]) => s.st[id]?.state === 'err');
  const step1 = s.phase === 'finding' ? { cls: 'is-now', text: runText || '물건을 찾는 중' }
    : s.found ? { cls: 'is-ok', text: `PD가 물건 ${s.found.props}개를 찾고 이 PC가 윤곽을 땄어요. ${s.found.usd ? wonText(s.found.usd, rate) : '저장해 둔 목록이라 0원'}` }
    : failed && !plan ? { cls: 'is-error', text: '물건을 찾지 못했어요' } : { cls: 'is-wait', text: 'PD가 물건을 찾고, 이 PC가 윤곽을 따요. 약 10원' };
  const step2 = !plan ? { cls: 'is-wait', text: '이름, 층, 그림자를 고쳐요. 0원' } : showDone ? { cls: 'is-ok', text: '이름, 층, 그림자를 정했어요. 0원' } : { cls: s.phase === 'splitting' ? 'is-ok' : 'is-now', text: '이름, 층, 그림자를 고쳐요. 0원' };
  const step3 = s.phase === 'splitting' ? { cls: 'is-now', text: runText || '나누는 중' }
    : showDone && s.done ? { cls: 'is-ok', text: `${s.done.sec}초, ${s.done.again ? '조립만 다시라 0원' : wonText(s.done.gptUsd, rate)}. 레이어 ${s.summary!.layers + 1}장` }
    : failed && plan && s.phase !== 'adding' ? { cls: 'is-error', text: '나누지 못했어요. 다시 누르면 이어서 해요' }
    : { cls: 'is-wait', text: s.plated ? '빈 방은 저장해 둔 것이라 0원, PSD로 저장해요' : '빈 방을 다시 그려서 PSD로 저장해요. 약 80원' };

  /* ---------- 발 ---------- */
  const note = L.busy ? `${s.phase === 'finding' ? '물건을 찾는 중' : s.phase === 'adding' ? 'PD가 네모 안의 물건에 이름을 붙이는 중' : '나누는 중'} · ${L.elapsed}초`
    : showDone ? `나눴어요. 레이어 ${s.summary!.layers + 1}장${s.summary!.shadows ? ` + 그림자 ${s.summary!.shadows}장` : ''}을 PSD로 이 PC에 저장했어요.`
    : est ? `${est.text} · 계획만 고치는 동안은 0원이에요.` : '나누는 데 약 80원, 1분쯤 걸려요. 계획만 고치는 동안은 0원이에요.';
  const footActions = L.busy ? (
    <button type="button" className="bae-btn bae-btn-danger" onClick={L.stop}><Square size={14} aria-hidden="true" />그만두기</button>
  ) : showDone ? (
    <>
      <button type="button" className="bae-btn" onClick={L.reopenPlan}>
        <Pencil size={16} aria-hidden="true" />계획 다시 고치기
      </button>
      <button type="button" className="bae-btn bae-btn-tint" disabled={!s.psdPath} onClick={L.showPsd}><FolderOpen size={16} aria-hidden="true" />PSD가 있는 폴더 열기</button>
    </>
  ) : !plan ? (
    <button type="button" className="bae-btn bae-btn-primary" disabled={!s.pic} onClick={() => void L.find()}><RotateCcw size={16} aria-hidden="true" />물건 다시 찾기</button>
  ) : (
    <button type="button" className="bae-btn bae-btn-primary" disabled={!!s.pendBox} onClick={() => void L.split()}>
      <Layers size={16} aria-hidden="true" />{s.summary && L.dirty ? '바꾼 계획으로 다시 나누기' : '이대로 나누기'}
    </button>
  );

  return (
    <BaeWindow
      tool="layers"
      icon={<Layers size={18} aria-hidden="true" />}
      title="레이어로 나누기"
      sub={`그림: ${s.label || p.picture.label}${s.natW ? ` (${s.natW}×${s.natH})` : ''}`}
      headActions={(
        <>
          <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" disabled={L.busy || !s.pic} title="저장해 둔 물건 목록 · 빈 방 · 계획을 지우고 PD에게 처음부터 다시 물어요 (약 10원)" onClick={() => void L.forget()}>
            <RotateCcw size={14} aria-hidden="true" />처음부터 다시 찾기
          </button>
          <button type="button" className="bae-btn bae-btn-s" disabled={L.busy} onClick={() => fileRef.current?.click()}><FolderOpen size={14} aria-hidden="true" />다른 그림 불러오기</button>
          <input ref={fileRef} className="bae-vh" type="file" accept="image/png,image/jpeg" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void L.replace(f); }} />
        </>
      )}
      footNote={note}
      footActions={footActions}
      onClose={() => { if (L.close()) p.onClose(); }}
    >
      <ol className="bae-make-steps bw-steps bae-lp-steps">
        {[['1 물건 찾기', step1], ['2 계획 고치기', step2], ['3 나누기', step3]].map(([name, st]) => {
          const x = st as { cls: string; text: string };
          return (
            <li key={name as string} className={`bae-make-step ${x.cls}`} aria-current={x.cls === 'is-now' ? 'step' : undefined}>
              <p className="bae-make-step-name">
                {x.cls === 'is-ok' ? <Check size={14} aria-hidden="true" /> : x.cls === 'is-now' ? (L.busy ? <Loader2 size={14} className="bae-spin" aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />) : x.cls === 'is-error' ? <AlertTriangle size={14} aria-hidden="true" /> : null}
                <span>{name as string}</span>
              </p>
              <p className="bae-make-step-text" title={x.text}>{x.text}</p>
            </li>
          );
        })}
      </ol>
      <div className="bw-cols">
        <div className="bw-main">
          <div className="bw-board bae-lp-board" ref={boardRef}>
            <div className="bae-lp-fit" style={{ ['--ar' as string]: String(ar) } as CSSProperties}>
              {s.src ? <img className="bae-lp-img" src={s.src} alt={`레이어로 나눌 그림: ${s.label}`} draggable={false} /> : null}
              <canvas
                ref={canvasRef}
                className={`bae-lp-canvas${s.mode === 'add' ? ' is-add' : ''}`}
                aria-hidden="true"
                onPointerMove={(e) => {
                  if (!canEdit) return; const [x, y] = at(e);
                  if (drag) { setDrag({ ...drag, x1: x, y1: y }); return; }
                  if (s.mode === 'pick') { const h = hitTest(x, y, ids, maskOf); if (h !== hover) setHover(h); }
                }}
                onPointerLeave={() => { if (hover) setHover(null); }}
                onPointerDown={(e) => {
                  if (!canEdit) return; const [x, y] = at(e);
                  if (s.mode === 'add') { if (s.pendBox) return; setDrag({ x0: x, y0: y, x1: x, y1: y }); (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); return; }
                  L.select(hitTest(x, y, ids, maskOf));
                }}
                onPointerUp={() => { if (!drag) return; const b = boxOfDrag(drag); setDrag(null); if (b) void L.addBox(b); }}
              />
              {chips.map((c) => {
                const head = c.L.id; const on = hi.has(head);
                return (
                  <button key={c.L.id} type="button" className={`bae-lp-chip ${BIN_CLS[c.L.bin]}${on ? ' is-sel' : ''}`} style={{ left: c.x, top: c.y - 11 }}
                    aria-pressed={on} disabled={L.busy} onClick={() => L.select(head)} onMouseEnter={() => setHover(head)} onMouseLeave={() => setHover(null)}>
                    <span className="bae-lp-dot" aria-hidden="true" />{c.L.text}
                  </button>
                );
              })}
              {L.busy && s.steps.length ? (
                <div className="bae-lp-prog" role="status" aria-live="polite">
                  <ol>
                    {s.steps.map(([id, label]) => {
                      const st = s.st[id] || { state: '' };
                      return (
                        <li key={id} className={`is-${st.state || 'wait'}`}>
                          <span className="bae-lp-st" aria-hidden="true">{st.state === 'ok' ? <Check size={12} /> : st.state === 'run' ? <Loader2 size={12} className="bae-spin" /> : st.state === 'err' ? <AlertTriangle size={12} /> : null}</span>
                          <span>{label}{st.sub ? <small> {st.sub}</small> : null}</span>
                          <span className="bae-num bae-lp-t">{st.t || ''}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ) : null}
            </div>
          </div>
          <div className="bw-bar">
            <ul className="bae-lp-legend" aria-label="층 색">
              {(['OL', 'ML', 'UL'] as LayerBin[]).map((b) => (
                <li key={b} className={BIN_CLS[b]}><span className="bae-lp-dot" aria-hidden="true" />{b} {BIN_SHORT[b]}{legend ? <span className="bae-num"> {legend[b]}</span> : null}</li>
              ))}
            </ul>
            <div className="bw-bar-end">
              <button type="button" className="bae-btn bae-btn-s" aria-pressed={showAll} disabled={!plan} onClick={() => setShowAll(!showAll)}><Eye size={14} aria-hidden="true" />윤곽 보이기</button>
              <button type="button" className={`bae-btn bae-btn-s${s.mode === 'add' ? ' bae-btn-tint' : ''}`} aria-pressed={s.mode === 'add'} disabled={!canEdit}
                title="PD가 빠뜨린 물건을 그림 위에 네모로 그려요. 이름 붙이기 약 5원, 나눌 때 그 자리 빈 방 약 80원"
                onClick={() => L.setMode(s.mode === 'add' ? 'pick' : 'add')}>
                <BoxSelect size={14} aria-hidden="true" />빠진 물건 네모로 추가
              </button>
            </div>
          </div>
          <p className={`bae-hint bae-lp-info${s.info.kind === 'err' ? ' is-error' : ''}`} role="status">
            {s.mode === 'add' && !s.pendBox ? '그림 위에 빠진 물건을 네모로 감싸 그려요. PD가 이름을 붙여요 (약 5원).' : s.info.text}
          </p>
        </div>

        <div className="bw-side bae-lp-side">
          <section className="bw-group bw-grow bae-lp-treebox" aria-labelledby="bae-lp-tree-h">
            <div className="bw-group-head">
              <h3 className="bae-side-title" id="bae-lp-tree-h">{showDone ? 'PSD로 저장한 레이어' : 'PSD에 들어갈 레이어'}</h3>
              {sum ? <span className="bae-mcount bae-num">{sum.layers}장{sum.shadows ? ` + 그림자 ${sum.maxShadows ? '최대 ' : ''}${sum.shadows}` : ''}</span> : null}
            </div>
            {tree.length ? (
              <ul className="bae-lp-tree">
                {tree.map((r, i) => {
                  if (r.kind === 'bin') return <li key={'b' + r.bin} className={`is-group ${BIN_CLS[r.bin]}`}><span className="bae-lp-dot" aria-hidden="true" /><span>{r.bin} {BIN_INFO[r.bin].ko}</span><span className="bae-lp-meta bae-num">{r.count}장{r.shadows ? ` + 그림자 ${r.shadows}` : ''}</span></li>;
                  if (r.kind === 'folder') return <li key={'f' + r.name + i} className="is-folder"><Folder size={13} aria-hidden="true" /><span>{r.name}</span></li>;
                  if (r.kind === 'row') return (
                    <li key={r.key} className={`is-obj${r.sel ? ' is-sel' : ''}${r.inFolder ? ' in-folder' : ''}`}>
                      <button type="button" className="bae-lp-rowbtn" aria-pressed={r.sel} onClick={() => L.select(r.id)}>
                        <span className="bae-lp-name">{r.name}</span><span className="bae-lp-meta">{r.sub}</span>
                      </button>
                    </li>
                  );
                  if (r.kind === 'shadow') return <li key={r.key} className={`is-sub${r.inFolder ? ' in-folder' : ''}`}><span>{r.name}</span><span className="bae-lp-meta">{r.done ? '곱하기' : '곱하기 (있으면)'}</span></li>;
                  if (r.kind === 'plate') return <li key="plate" className="is-fixed">{r.thumb ? <img className="bae-lp-thumb" src={r.thumb} alt="" /> : null}<span>배경 (빈 방)</span><span className="bae-lp-meta">{r.note}</span></li>;
                  if (r.kind === 'skipHead') return <li key="skip" className="is-group lay-none"><span className="bae-lp-dot" aria-hidden="true" /><span>나누지 않음</span><span className="bae-lp-meta">배경에 남겨요</span></li>;
                  return (
                    <li key={'s' + r.id} className={`is-obj${r.sel ? ' is-sel' : ''}`}>
                      <button type="button" className="bae-lp-rowbtn" aria-pressed={r.sel} onClick={() => L.select(r.id)}><span className="bae-lp-name">{r.name}</span></button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="bae-hint">물건을 찾으면 여기에 PSD 레이어 순서가 보여요. 위가 앞이에요.</p>}
          </section>

          <section className="bw-group bae-lp-edit" aria-labelledby="bae-lp-edit-h">
            <div className="bw-group-head"><h3 className="bae-side-title" id="bae-lp-edit-h">고른 물건 고치기</h3></div>
            {!ed ? (
              <p className="bae-hint">{plan ? "그림이나 위 목록에서 물건을 누르면 여기서 이름, 층, 그림자, 묶기를 바꿔요. PD가 빠뜨린 물건은 '빠진 물건 네모로 추가'를 누르고 그림 위에 네모를 그려요." : ''}</p>
            ) : (
              <>
                <div className="bw-row-name">
                  <div className="bae-field">
                    <label className="bae-label" htmlFor="bae-lp-name">{ed.nameLabel}</label>
                    <input className="bae-minput" id="bae-lp-name" type="text" value={ed.name} disabled={ed.nameLocked || !canEdit}
                      onChange={(e) => { const v = e.target.value; L.edit((pl, vw) => setName(pl, vw, ed.id, v), 600); }} />
                  </div>
                  <div className="bae-field">
                    <span className="bae-label" id="bae-lp-bin">층</span>
                    <div className="bae-seg" role="group" aria-labelledby="bae-lp-bin">
                      {(['OL', 'ML', 'UL'] as LayerBin[]).map((b) => {
                        const ok = ed.far ? b === 'UL' : b !== 'UL';
                        return (
                          <button key={b} type="button" className={`bae-btn bae-btn-s bae-lp-binbtn ${BIN_CLS[b]}`} aria-pressed={!ed.keepOn && ed.bin === b}
                            disabled={!canEdit || ed.binLocked || !ok || ed.far} title={!ok ? (b === 'UL' ? '원경(하늘 · 창밖)만 UL에 들어가요' : '원경은 UL이에요') : BIN_INFO[b].ko}
                            onClick={() => L.edit((pl, vw) => setBin(pl, vw, ed.id, b as 'OL' | 'ML'))}>
                            <span className="bae-lp-dot" aria-hidden="true" />{b}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <p className="bae-hint bae-lp-where">PSD 위치 <b>{ed.where}</b>{ed.group ? ` · ${ed.group}` : ''}</p>
                <div className="bw-inline">
                  {!ed.far ? (
                    <button type="button" className="bw-switch" role="switch" aria-checked={ed.shadowOn} disabled={!canEdit || ed.shadowLocked} onClick={() => L.edit((pl, vw) => toggleShadow(pl, vw, ed.id))}>
                      <span className="bw-switch-track" />그림자 따로
                    </button>
                  ) : null}
                  <button type="button" className="bw-switch" role="switch" aria-checked={ed.keepOn} disabled={!canEdit} onClick={() => L.edit((pl) => toggleKeep(pl, ed.id))}>
                    <span className="bw-switch-track" />나누지 않음
                  </button>
                  {ed.bundle ? (
                    <button type="button" className="bw-switch" role="switch" aria-checked={ed.bundle.mode === 'each'} disabled={!canEdit} title={`같은 물건 ${ed.bundle.n}개를 한 장으로 / 하나씩`}
                      onClick={() => L.edit((pl, vw) => setBundleMode(pl, vw, ed.id, ed.bundle!.mode === 'each' ? 'one' : 'each'))}>
                      <span className="bw-switch-track" />하나씩 따로 ({ed.bundle.n}개)
                    </button>
                  ) : null}
                </div>
                {ed.merge || ed.mergedCount ? (
                  <div className="bae-lp-merge">
                    {ed.merge?.kind === 'in' ? (
                      <>
                        <span>{ed.merge.into} 레이어에 합쳐져 있어요</span>
                        <button type="button" className="bae-btn bae-btn-s" disabled={!canEdit} onClick={() => L.edit((pl) => unmerge(pl, ed.id))}>따로 나누기</button>
                        <button type="button" className="bae-btn bae-btn-ghost bae-btn-s" onClick={() => view && L.select(headOf(view, ed.id))}>{ed.merge.into} 고르기</button>
                      </>
                    ) : ed.merge?.kind === 'pd' ? (
                      <>
                        <span>PD는 {ed.merge.into}에 합치자고 했어요</span>
                        <button type="button" className="bae-btn bae-btn-s" disabled={!canEdit} onClick={() => L.edit((pl) => remerge(pl, ed.id))}>다시 합치기</button>
                      </>
                    ) : null}
                    {ed.mergedCount ? (
                      <>
                        <span>작은 것 {ed.mergedCount}개가 이 레이어에 합쳐져 있어요</span>
                        <button type="button" className="bae-btn bae-btn-s" disabled={!canEdit} onClick={() => L.edit((pl, vw) => unmergeAll(pl, vw, ed.id))}>모두 따로</button>
                      </>
                    ) : null}
                  </div>
                ) : null}
                <div className="bae-field">
                  <span className="bae-label" id="bae-lp-cand">윤곽 바꾸기 (이 PC가 찾은 후보 4개)</span>
                  <div className="bae-seg" role="group" aria-labelledby="bae-lp-cand">
                    <button type="button" className="bae-btn bae-btn-s" aria-pressed={ed.pickAuto} disabled={!canEdit} title="나눌 때 빈 방과 가장 잘 맞는 후보" onClick={() => L.edit((pl) => setPick(pl, ed.id, 'auto'))}>자동</button>
                    {ed.cands.map((has, k) => (
                      <button key={k} type="button" className="bae-btn bae-btn-s" aria-pressed={!ed.pickAuto && ed.pick === k} disabled={!canEdit || !has} onClick={() => L.edit((pl) => setPick(pl, ed.id, k))}>후보 {k + 1}</button>
                    ))}
                  </div>
                </div>
                {ed.added ? (
                  <button type="button" className="bae-btn bae-btn-ghost bae-btn-s bae-lp-remove" disabled={!canEdit} onClick={() => { L.select(null); L.edit((pl) => removeBoxed(pl, ed.id)); }}>이 네모 빼기</button>
                ) : null}
              </>
            )}
          </section>

          {merges.length ? (
            <details className="bw-group bae-lp-merges">
              <summary className="bw-group-head">
                <span className="bae-side-title">작은 것 합치기</span>
                <span className="bae-mcount bae-num">{merges.length}묶음 · {merges.every((m) => m.all) ? '모두 합침' : `${merges.filter((m) => m.all).length}묶음 합침`}</span>
              </summary>
              <p className="bae-hint">따로 나누지 않고 붙어 있는 큰 물건 레이어에 그대로 둬요.</p>
              <ul className="bae-lp-mlist">
                {merges.map((m) => (
                  <li key={m.target}>
                    <span><b>{m.text}</b><small>{m.sub}</small></span>
                    <button type="button" className="bae-btn bae-btn-s" aria-pressed={m.all} disabled={!canEdit} onClick={() => L.edit((pl) => toggleMergeGroup(pl, m.target))}>{m.all ? '합침' : '따로'}</button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </BaeWindow>
  );
}

function unavailableModelGateway(message: string): BaeModelGateway {
  const no = () => Promise.reject(new Error(message)); const off = () => () => {};
  return { status: no, ensure: no, files: no, upscaleA: no, pcCheck: no, pcCheckPut: no, pcCheckList: no, portRequest: no, onProgress: off, onUpscaleProgress: off, onWorker: off };
}
function wonText(usd: number, rate: number) { return '약 ' + (Math.round(usd * rate / 10) * 10).toLocaleString('ko-KR') + '원'; }
