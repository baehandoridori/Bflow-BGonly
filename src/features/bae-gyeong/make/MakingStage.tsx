// 만드는 화면, 크게 보기 (시안 Ordering · Making): 머리 줄 '작게 보기' · 제목 · 작업 종류 · '그만두기', 큰 그림 판 2.05:1, 걸음 줄 셋.
// 2단계는 점 효과(시안의 캔버스 셰이더) 없이 그림을 흐리게 보여 준다: 주문서 쓰는 중 = 옅은 러프, 그리는 중 = 중간 그림을 흐리게.
import type { CSSProperties } from 'react';
import { Check, Loader2, Minimize2 } from 'lucide-react';
import type { MakingStageProps } from './ui';
import '../home/bench.css';
import './making-stage.css';

export function MakingStage(p: MakingStageProps) {
  const aspect = p.aspect > 0 ? p.aspect : 1.5;
  const fit: CSSProperties = { width: `min(100cqw, calc(100cqh * ${aspect.toFixed(4)}))`, aspectRatio: String(aspect) };
  const picCls = p.phase === 'draw' && p.partial ? ' is-partial' : ' is-faint';
  return (
    <section className="bae-view bae-making" aria-labelledby="bae-make-h">
      <div className="bae-view-head">
        <button type="button" className="bae-btn bae-btn-s" onClick={p.onFold}><Minimize2 size={14} aria-hidden="true" />작게 보기</button>
        <h2 className="bae-view-title" id="bae-make-h">{p.title}</h2>
        <p className="bae-job"><span>{p.kindLabel}</span></p>
        <button type="button" className="bae-btn bae-btn-s" onClick={p.onStop}>그만두기</button>
      </div>
      <div className="bae-make-stage">
        {p.src ? <img className="bae-make-back" src={p.src} alt="" /> : null}
        {p.src ? (
          <div className="bae-make-fit" style={fit}>
            <img className={`bae-make-pic${picCls}`} src={p.src} alt={p.phase === 'order' ? '주문서를 쓰는 동안 보이는 러프' : '그리는 중인 그림'} />
          </div>
        ) : null}
        <p className="bae-make-now" role="status"><Loader2 size={14} className="bae-spin" aria-hidden="true" /><span className="bae-num">{p.label}</span></p>
      </div>
      <ol className="bae-make-steps">
        {p.steps.map((s, i) => (
          <li key={i} className={`bae-make-step is-${s.state}`} aria-current={s.state === 'now' ? 'step' : undefined}>
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
