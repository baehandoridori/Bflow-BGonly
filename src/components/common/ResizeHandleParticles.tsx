import { memo, useMemo } from 'react';

/**
 * v1.27.0: 드래그 핸들 파티클 — drag 중일 때 핸들 위치에서 작은 입자들이 사르르.
 *
 * CSS only — 미리 정의한 8개 dot 의 각도/거리/딜레이를 CSS variable 로 박고
 * .bflow-handle-particle 이 staggered loop 으로 fade-out outward.
 *
 * edge='w' (좌측) / 's' (하단) 모두 지원. 각 변의 중간에서 파티클이 양 옆으로 퍼짐.
 * active=false 면 0개 렌더 → DOM/애니메이션 비용 X.
 */
interface ResizeHandleParticlesProps {
  edge: 'n' | 's' | 'e' | 'w';
  active?: boolean;
  /** 파티클 개수 — 핸들 길이에 따라 조정 (기본 8) */
  count?: number;
}

interface ParticleConfig {
  /** anchor 의 어느 변에 spawn 할지 (0~1, 변의 시작부터의 비율) */
  pos: number;
  /** 어디로 튈지 — dx/dy 단위는 px */
  dx: number;
  dy: number;
  /** staggered loop 시작 지연 (s) */
  delay: number;
}

function buildParticles(count: number, edge: 'n' | 's' | 'e' | 'w'): ParticleConfig[] {
  const out: ParticleConfig[] = [];
  // 변의 안쪽 영역에 균등 분포, dx/dy 는 edge 의 수직 방향으로 튀어나가게.
  const perimeterRatio = (i: number) => 0.1 + ((i + 0.5) / count) * 0.8;
  for (let i = 0; i < count; i++) {
    const ratio = perimeterRatio(i);
    // 변 방향에 살짝 흔들어줘서 단조롭지 않게.
    const wobble = (i % 2 === 0 ? 1 : -1) * 4;
    if (edge === 'w') {
      out.push({ pos: ratio, dx: -8 - (i % 3) * 3, dy: wobble, delay: i * 0.16 });
    } else if (edge === 'e') {
      out.push({ pos: ratio, dx: 8 + (i % 3) * 3, dy: wobble, delay: i * 0.16 });
    } else if (edge === 'n') {
      out.push({ pos: ratio, dx: wobble, dy: -8 - (i % 3) * 3, delay: i * 0.16 });
    } else {
      out.push({ pos: ratio, dx: wobble, dy: 8 + (i % 3) * 3, delay: i * 0.16 });
    }
  }
  return out;
}

export const ResizeHandleParticles = memo(function ResizeHandleParticles({
  edge,
  active,
  count = 8,
}: ResizeHandleParticlesProps) {
  const particles = useMemo(() => buildParticles(count, edge), [count, edge]);

  if (!active) return null;

  const isHorizontalEdge = edge === 'n' || edge === 's';

  return (
    <>
      {particles.map((p, idx) => {
        // anchor — 변의 중심선에서 시작.
        const anchorStyle: React.CSSProperties = isHorizontalEdge
          ? {
              left: `${p.pos * 100}%`,
              ...(edge === 'n' ? { top: 0 } : { bottom: 0 }),
              transform: 'translate(-50%, -50%)',
            }
          : {
              top: `${p.pos * 100}%`,
              ...(edge === 'w' ? { left: 0 } : { right: 0 }),
              transform: 'translate(-50%, -50%)',
            };

        return (
          <span
            key={idx}
            aria-hidden="true"
            className="bflow-handle-particle"
            style={{
              ...anchorStyle,
              // CSS variable 로 keyframe 에 dx/dy/delay 주입.
              ['--bflow-dx' as never]: `${p.dx}px`,
              ['--bflow-dy' as never]: `${p.dy}px`,
              animationDelay: `${p.delay}s`,
            }}
          />
        );
      })}
    </>
  );
});
