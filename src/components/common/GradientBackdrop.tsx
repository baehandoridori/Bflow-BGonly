/**
 * 대시보드/로그인 배경 그라데이션 조명을 canvas 외부 DOM 레이어로 분리.
 * 파티클(플렉서스)과 독립적으로 토글할 수 있어, 파티클 OFF 상태에서도
 * 배경 조명을 유지할 수 있음.
 *
 * CSS 변수(--color-accent, --color-accent-sub)를 사용하므로
 * 테마 변경 시 자동으로 갱신됨.
 */
export function GradientBackdrop({ enabled = true }: { enabled?: boolean }) {
  if (!enabled) return null;
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: -1,
        background: `
          radial-gradient(at 20% 10%, rgb(var(--color-accent) / 0.10) 0%, transparent 50%),
          radial-gradient(at 80% 90%, rgb(var(--color-accent-sub) / 0.08) 0%, transparent 50%),
          radial-gradient(at 50% 50%, rgb(var(--color-accent) / 0.04) 0%, transparent 60%)
        `,
      }}
    />
  );
}
