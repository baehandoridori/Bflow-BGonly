import { useEffect } from 'react';
import { CountBadge } from '@/components/ui/CountBadge';
import { useBaeStamps } from '../state/useBaeStamps';

/**
 * 사이드바 景 아이콘 위의 숫자: 내 작업에 온 새 확인 도장(좋아요 · 다시) 수 (계획 14 6-2 8단계 알림).
 * BAE경 메뉴가 보이는 계정에서만 그려진다(사이드바의 노출 거르기 안). 숫자는 내 기록을 열면 사라진다.
 */
export function BaeStampBadge({ userId }: { userId: string | null }) {
  const count = useBaeStamps((s) => (s.userId === userId ? s.count : 0));
  useEffect(() => { useBaeStamps.getState().start(userId); }, [userId]);
  return (
    <CountBadge
      count={count}
      className="absolute -top-1 -right-0.5 min-w-[16px] h-4 flex items-center justify-center text-[10px] font-bold rounded-full px-1"
      style={{ backgroundColor: 'rgb(var(--color-accent))', color: '#fff' }}
      title={`새 확인 도장 ${count}건`}
    />
  );
}
