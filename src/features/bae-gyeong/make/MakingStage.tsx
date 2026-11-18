// 만드는 화면, 크게 보기 (시안 Ordering · Making): 머리 줄 '작게 보기' · 제목 · 작업 종류 · '그만두기', 큰 그림 판 2.05:1, 걸음 줄 셋.
// 그림 두 겹(흐리게 깔아 무대를 채운 것 · 가운데의 선명한 것) 위에 숨쉬는 점 캔버스(dotField.ts — WebGL2 셰이더 한 장, 그림을 읽지 않음)를
// '곱하기'로 겹친다. 주문서 쓰는 중 = 메모가 있는 러프 위로 밝은 띠가 지나가고, 그리는 중 = 실제 단계(중간 그림 0 · 1 · 2장)만큼
// 점이 자라 그림이 드러나고(가짜 퍼센트 없음), 완성(done) = 점이 가운데부터 풀리며 빛이 한 번 퍼진 뒤 onFinaleEnd.
// 그림 위에는 지금 하는 일을 오려 붙인 글자로 4.3초마다 바꿔 보여 준다 (HTML 기다림 화면의 글자).
// 쉬게 하기: 화면 밖 · 창이 가려지면 멈추고, 접으면(작게 보기) 이 부품이 빠지며 정리한다. 움직임 최소 · 동작 줄이기 = 멈춘 한 장면
// (마우스 돋보기만), WebGL2 가 없거나 그리기 판을 잃으면 점 없이 접힌 화면과 같은 흐린 그림.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Loader2, Minimize2 } from 'lucide-react';
import { useMotionPref } from '@/hooks/useMotionPref';
import type { MakingStageProps } from './ui';
import { createDotField, type DotField } from './dotField';
import {
  DONE_PHRASE, FINALE_DISSOLVE_MS, FINALE_TAIL_MS, FINALE_WAIT_MS, PHRASE_MS,
  defaultPhrases, letterTilt, nextTalk, partialArrivedText, partialPhrase, talkText, wordsOutMs, type Talk,
} from './makingStageLogic';
import '../home/bench.css';
import './making-stage.css';

interface Layer { key: number; src: string; ready: boolean }
type Dots = 'pending' | 'on' | 'off';
type Finale = 'none' | 'run' | 'shown';

const ALT = { order: '주문서를 쓰는 동안 보이는 러프', draw: '그리는 중인 그림', done: '완성된 그림' } as const;

export function MakingStage(p: MakingStageProps) {
  const { reduce, lite } = useMotionPref();
  const aspect = p.aspect > 0 ? p.aspect : 1.5;
  const partials = Number.isFinite(p.partialCount) ? Math.max(0, Math.floor(p.partialCount as number)) : 0;
  const done = p.phase === 'done';
  const fit: CSSProperties = { width: `min(100cqw, calc(100cqh * ${aspect.toFixed(4)}))`, aspectRatio: String(aspect) };

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<DotField | null>(null);
  const [dots, setDots] = useState<Dots>('pending');
  const now = useRef({ aspect, phase: p.phase, partials, reduce, lite, dots });
  now.current = { aspect, phase: p.phase, partials, reduce, lite, dots };

  // ── 점 판: 한 번 만들고, 빠질 때 정리 ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const v = now.current;
    const field = createDotField(canvas, {
      aspect: v.aspect, phase: v.phase, partials: v.partials, still: v.reduce, lite: v.lite,
      onLost: () => setDots('off'), onRestored: () => setDots('on'),
    });
    fieldRef.current = field;
    setDots(field ? 'on' : 'off');
    return () => { field?.dispose(); fieldRef.current = null; };
  }, []);
  useEffect(() => { fieldRef.current?.setAspect(aspect); }, [aspect]);
  useEffect(() => { fieldRef.current?.setPhase(p.phase); }, [p.phase]);
  useEffect(() => { fieldRef.current?.setPartials(partials); }, [partials]);
  useEffect(() => { fieldRef.current?.setMotion(reduce, lite); }, [reduce, lite]);

  // ── 화면 밖이거나 창이 가려지면 멈춤 ──
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let seen = true;
    const sync = () => {
      const f = fieldRef.current;
      if (!f) return;
      if (seen && !document.hidden) f.resume(); else f.pause();
    };
    const io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((es) => { seen = es[es.length - 1]?.isIntersecting ?? true; sync(); })
      : null;
    io?.observe(stage);
    document.addEventListener('visibilitychange', sync);
    sync();
    return () => { io?.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, []);

  // ── 그림 두 겹: 새 그림(중간 그림 · 완성 그림)이 열리면 옛 그림 위로 서서히 바꾼다 ──
  const seq = useRef(0);
  const [layers, setLayers] = useState<Layer[]>(() => (p.src ? [{ key: 0, src: p.src, ready: false }] : []));
  useEffect(() => {
    const src = p.src;
    if (!src) { setLayers([]); return; }
    const key = ++seq.current;
    setLayers((ls) => {
      const top = ls[ls.length - 1];
      if (top && top.src === src) return ls;
      return [...ls.filter((l) => l.ready).slice(-1), { key, src, ready: false }];
    });
  }, [p.src]);
  const onReady = (key: number) => setLayers((ls) => ls.map((l) => (l.key === key && !l.ready ? { ...l, ready: true } : l)));
  const top = layers[layers.length - 1];
  useEffect(() => {
    if (!top?.ready || layers.length < 2) return undefined;
    const t = setTimeout(() => setLayers((ls) => ls.filter((l) => l.key >= top.key)), 700);
    return () => clearTimeout(t);
  }, [layers, top]);
  const topReady = top ? top.ready : true;

  // ── 완성: 완성 그림이 열리면(늦어도 0.5초 뒤) 점이 풀리고 빛이 퍼진 뒤 onFinaleEnd ──
  const endRef = useRef(p.onFinaleEnd);
  endRef.current = p.onFinaleEnd;
  const [go, setGo] = useState(false);
  const [finale, setFinale] = useState<Finale>('none');
  useEffect(() => {
    if (!done) { setGo(false); setFinale('none'); return undefined; }
    if (topReady) { setGo(true); return undefined; }
    const t = setTimeout(() => setGo(true), FINALE_WAIT_MS);
    return () => clearTimeout(t);
  }, [done, topReady]);
  useEffect(() => {
    if (!go) return undefined;
    let off = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const end = () => { if (!off) endRef.current?.(); };
    if (now.current.reduce) { setFinale('shown'); end(); return () => { off = true; }; }
    setFinale('run');
    const after = () => {
      if (off) return;
      setFinale('shown');
      timers.push(setTimeout(end, FINALE_TAIL_MS));
    };
    const f = fieldRef.current;
    if (f && now.current.dots === 'on') void f.finish(FINALE_DISSOLVE_MS).then(after);
    else timers.push(setTimeout(after, FINALE_DISSOLVE_MS));
    return () => { off = true; timers.forEach(clearTimeout); };
  }, [go]);

  // ── 기다리는 문구: 4.3초마다 다음 문구, 중간 그림이 오면 한 번 끼어든다. 움직임 줄이기에서는 첫 문구 그대로 ──
  const list = p.phrases && p.phrases.length ? p.phrases : defaultPhrases(p.phase);
  const listKey = list.join('\n');
  const [talk, setTalk] = useState<Talk>({ i: 0, extra: null });
  useEffect(() => { setTalk({ i: 0, extra: null }); }, [listKey, p.phase]);
  useEffect(() => {
    if (reduce || done || (list.length < 2 && talk.extra === null)) return undefined;
    const t = setTimeout(() => setTalk((x) => nextTalk(x, list.length)), PHRASE_MS);
    return () => clearTimeout(t);
  }, [talk, reduce, done, list.length]);
  const seenPartials = useRef(partials);
  useEffect(() => {
    if (partials > seenPartials.current && now.current.phase === 'draw' && !now.current.reduce) {
      setTalk((x) => ({ i: x.i, extra: partialPhrase(partials) }));
    }
    seenPartials.current = partials;
  }, [partials]);
  const sayText = done ? DONE_PHRASE : reduce ? (list[0] ?? '') : talkText(talk, list);

  const flat = dots === 'off';
  const picCls = !flat || done ? '' : p.phase === 'draw' && p.partial ? ' is-partial' : ' is-faint';
  const stageCls = `bae-make-stage is-${p.phase}${flat ? ' is-flat' : ' is-dots'}${finale === 'run' ? ' is-finale' : finale === 'shown' ? ' is-finale is-shown' : ''}`;

  return (
    <section className="bae-view bae-making" aria-labelledby="bae-make-h">
      <div className="bae-view-head">
        <button type="button" className="bae-btn bae-btn-s" onClick={p.onFold}><Minimize2 size={14} aria-hidden="true" />작게 보기</button>
        <h2 className="bae-view-title" id="bae-make-h">{p.title}</h2>
        <p className="bae-job"><span>{p.kindLabel}</span></p>
        <button type="button" className="bae-btn bae-btn-s" onClick={p.onStop}>그만두기</button>
      </div>
      <div className={stageCls} ref={stageRef}>
        {layers.map((l) => {
          const isTop = l === top;
          return (
            <div key={l.key} className={`bae-make-layer${l.ready ? ' is-ready' : ''}`}>
              <img className="bae-make-back" src={l.src} alt="" decoding="async" />
              <div className="bae-make-fit" style={fit}>
                <img
                  className={`bae-make-pic${picCls}`}
                  src={l.src}
                  alt={isTop ? ALT[p.phase] : ''}
                  decoding="async"
                  onLoad={() => onReady(l.key)}
                  onError={() => onReady(l.key)}
                />
              </div>
            </div>
          );
        })}
        {flat && p.phase === 'order' ? <div className="bae-make-band" aria-hidden="true" /> : null}
        <canvas ref={canvasRef} className={`bae-make-dots${flat ? ' is-off' : ''}`} aria-hidden="true" />
        {finale !== 'none' ? <div className="bae-make-glow" aria-hidden="true" /> : null}
        <CutPaper text={sayText} calm={reduce} />
        {!flat && !done ? <p className="bae-make-tip" aria-hidden="true">마우스를 올리면 그 자리가 먼저 보여요</p> : null}
        <p className="bae-make-now" role="status">
          {done
            ? <Check size={14} className="bae-make-ok" aria-hidden="true" />
            : <Loader2 size={14} className="bae-spin" aria-hidden="true" />}
          <span className="bae-num">{p.label}</span>
          {p.phase === 'draw' && partials > 0
            ? <span key={partials} className="bae-make-arrive">{partialArrivedText(partials)}</span>
            : null}
        </p>
      </div>
      <ol className="bae-make-steps">
        {p.steps.map((s, i) => (
          <li key={`${i}-${s.state}`} className={`bae-make-step is-${s.state}`} aria-current={s.state === 'now' ? 'step' : undefined}>
            <p className="bae-make-step-name">
              {s.state === 'ok' ? <Check size={14} aria-hidden="true" /> : null}
              {s.state === 'now' ? <Loader2 size={14} className="bae-spin" aria-hidden="true" /> : null}
              <span>{s.name}</span>
            </p>
            <p className="bae-make-step-text">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 오려 붙인 글자 (HTML 기다림 화면 say): 글자마다 살짝 기울어 하나씩 붙고, 바뀔 때는 하나씩 떨어진다. */
function CutPaper({ text, calm }: { text: string; calm: boolean }) {
  const [shown, setShown] = useState(text);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (text === shown) { setOut(false); return undefined; }
    if (calm || !shown) { setShown(text); setOut(false); return undefined; }
    setOut(true);
    const t = setTimeout(() => { setShown(text); setOut(false); }, wordsOutMs(shown));
    return () => clearTimeout(t);
  }, [text, shown, calm]);
  if (!shown) return null;
  return (
    <p key={shown} className={`bae-make-words${out ? ' is-out' : ''}`} aria-hidden="true">
      {[...shown].map((ch, i) => (ch === ' '
        ? <span key={i} className="is-sp" />
        : <span key={i} style={{ '--i': i, '--r': `${letterTilt(i)}deg` } as CSSProperties}>{ch}</span>))}
    </p>
  );
}
