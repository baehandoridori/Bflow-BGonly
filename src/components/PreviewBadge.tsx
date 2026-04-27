import { isPreviewMode } from '@/utils/previewMode';

/**
 * 우상단 PREVIEW 배지.
 * 미리보기 모드 OFF 시 null 반환 → production 빌드에서는 항상 렌더 결과 없음.
 *
 * 렌더 위치는 App.tsx 의 LoginScreen / 메인 라우팅 분기 바깥 — 자동 로그인 직전
 * 찰나에 LoginScreen 이 잠시 보일 때에도 미리보기임이 즉시 인지된다.
 */
export function PreviewBadge() {
  if (!isPreviewMode()) return null;
  return (
    <div
      className="fixed top-2 right-2 z-[9999] px-2 py-0.5 rounded-md bg-yellow-500/95 text-black text-[11px] font-bold tracking-[0.1em] pointer-events-none shadow-md"
      aria-hidden="true"
    >
      PREVIEW
    </div>
  );
}
