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
  /** 파티클 개수 — 핸들 길이에 따라 조정 (기본 16). 한솔 v1.27.0 5차 보고로 8 → 16 증량. */
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
  // 분포를 95% 까지 넓혀 변 가장자리까지 골고루 spawn.
  const perimeterRatio = (i: number) => 0.025 + ((i + 0.5) / count) * 0.95;
  // staggered delay 를 0.16 → 0.07 로 줄여 더 빠르게 연속 분출 (한솔 v1.27.0 5차: 더 많이).
  const stagger = 0.07;
  for (let i = 0; i < count; i++) {
    const ratio = perimeterRatio(i);
    // 변 방향에 살짝 흔들어줘서 단조롭지 않게. 진폭 4 → 5.
    const wobble = (i % 2 === 0 ? 1 : -1) * (4 + (i % 3));
    // 외향 거리 8~14 → 10~22 로 더 넓게.
    const reach = 10 + (i % 4) * 4;
    if (edge === 'w') {
      out.push({ pos: ratio, dx: -reach, dy: wobble, delay: i * stagger });
    } else if (edge === 'e') {
      out.push({ pos: ratio, dx: reach, dy: wobble, delay: i * stagger });
    } else if (edge === 'n') {
      out.push({ pos: ratio, dx: wobble, dy: -reach, delay: i * stagger });
    } else {
      out.push({ pos: ratio, dx: wobble, dy: reach, delay: i * stagger });
    }
  }
  return out;
}

export const ResizeHandleParticles = memo(function ResizeHandleParticles({
  edge,
  active,
  count = 16,
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
