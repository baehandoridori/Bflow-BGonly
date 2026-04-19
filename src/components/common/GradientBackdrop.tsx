/**
 * 파티클 canvas 뒤, 앱 콘텐츠 뒤에 깔리는 그라데이션 배경.
 * z-index: -1 — 부모가 stacking context를 만들어야 올바르게 보임.
 *
 * 대시보드/로그인 배경 그라데이션 조명을 canvas 외부 DOM 레이어로 분리.
 * 파티클(플렉서스)과 독립적으로 토글할 수 있어, 파티클 OFF 상태에서도
 * 배경 조명을 유지할 수 있음.
 *
 * CSS 변수(--color-accent, --color-accent-sub)를 사용하므로
 * 테마 변경 시 자동으로 갱신됨.
 *
 * intensity:
 *  - subtle: 로그인 화면 (원본 canvas 그라데이션 0.06/0.03/0.015보다 약간 밝음)
 *  - normal: 대시보드 (위젯 글래스모피즘을 위한 충분한 밝기, 원본 0.18/0.15/0.08)
 */
export type BackdropIntensity = 'subtle' | 'normal';

export function GradientBackdrop({
  enabled = true,
  intensity = 'normal',
}: {
  enabled?: boolean;
  intensity?: BackdropIntensity;
}) {
  if (!enabled) return null;

  const alphas =
    intensity === 'subtle'
      ? { a: 0.08, b: 0.06, c: 0.03 }
      : { a: 0.18, b: 0.15, c: 0.08 };

  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: -1,
        background: `
          radial-gradient(at 20% 10%, rgb(var(--color-accent) / ${alphas.a}) 0%, transparent 50%),
          radial-gradient(at 80% 90%, rgb(var(--color-accent-sub) / ${alphas.b}) 0%, transparent 50%),
          radial-gradient(at 50% 50%, rgb(var(--color-accent) / ${alphas.c}) 0%, transparent 60%)
        `,
      }}
    />
  );
}
