// 확인 도장의 景 낙관 (시안 '景 아이콘과 낙관': 채운 네모에 景 선을 파낸 모양, 아이콘과 같은 선). 색은 둘레 글자색(currentColor).
export function Seal({ large = false }: { large?: boolean }) {
  return (
    <svg className={large ? 'bae-seal bae-seal-l' : 'bae-seal'} viewBox="0 0 48 48" aria-hidden="true">
      <rect className="bae-seal-fill" x="3" y="3" width="42" height="42" rx="8" />
      <g className="bae-seal-cut" transform="translate(7.2 6.6) scale(1.4)">
        <rect x="7" y="2.5" width="10" height="6" rx="1" /><path d="M7 5.5h10" /><path d="M12 8.5v3" /><path d="M3 11.5h18" />
        <rect x="8" y="14.25" width="8" height="3.5" rx="0.9" /><path d="M12 17.75v3.75" /><path d="M8 19.25 5.75 21.5" /><path d="M16 19.25 18.25 21.5" />
      </g>
    </svg>
  );
}
