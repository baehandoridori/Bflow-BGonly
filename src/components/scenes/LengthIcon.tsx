/**
 * 씬 길이 변경 SVG 아이콘 (LD = <-> 늘어남, SD = >-< 줄어듦).
 *
 * 텍스트 "<->"를 그대로 쓰면 좁은 컨테이너에서 줄바꿈으로 모양이 분해될 위험이 있어,
 * 라인+화살촉 SVG 단일 단위로 그려 atomic 하게 처리한다.
 *
 * 사용처: 카드 헤더 우상단 칩, 시트 씬번호 셀 옆 칩, 우클릭 메뉴 항목 아이콘.
 *
 * `<SvgIconDefs>` (App root) 의 <symbol id="ic-ld"|"ic-sd"> 를 <use> 로 참조한다.
 */

interface LengthIconProps {
  kind: 'LD' | 'SD';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function LengthIcon({ kind, size = 'md', className }: LengthIconProps) {
  const sizeClass = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '';
  return (
    <svg
      className={['length-icon', sizeClass, className].filter(Boolean).join(' ')}
      aria-hidden="true"
      role="img"
    >
      <use href={kind === 'LD' ? '#ic-ld' : '#ic-sd'} />
    </svg>
  );
}
