/**
 * 景 선 아이콘 (사이드바용). 시안 '景 아이콘과 낙관' 장의 SVG 그대로 — 24×24, 선 굵기 1.75, 둥근 끝.
 * lucide 아이콘과 같은 크기 · 색 규칙(currentColor)이라 사이드바의 다른 메뉴와 나란히 선다.
 */
export function BaeGyeongIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="7" y="2.5" width="10" height="6" rx="1" />
      <path d="M7 5.5h10" />
      <path d="M12 8.5v3" />
      <path d="M3 11.5h18" />
      <rect x="8" y="14.25" width="8" height="3.5" rx="0.9" />
      <path d="M12 17.75v3.75" />
      <path d="M8 19.25 5.75 21.5" />
      <path d="M16 19.25 18.25 21.5" />
    </svg>
  );
}
