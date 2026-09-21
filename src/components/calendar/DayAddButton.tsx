import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * 날짜 칸의 '일정 추가' 버튼.
 *
 * 평소에는 없는 것처럼 두고, 커서가 가까워질수록 유리가 맺히듯 드러난다
 * (`--reveal` 은 useProximityReveal 이 써 넣는다). 여기서 누른 채 끌면 날짜 범위가 잡힌다.
 *
 * 근접도가 0 이어도 DOM 에는 남겨 둔다 — 키보드 탭으로 도달할 수 있어야 하고,
 * 조건부 렌더로 넣다 뺐다 하면 근접도 계산 대상이 계속 바뀌어 깜빡인다.
 *
 * 누른 상태는 이 버튼이 직접 들고 있다. 드래그가 어디서 끝나든(다른 칸, 창 밖) 풀려야 하므로
 * window 의 mouseup 으로 해제한다.
 */
export function DayAddButton({
  date,
  label,
  onStart,
  onActivate,
  className,
}: {
  date: string;
  /** 스크린리더·툴팁용 날짜 표현. 예: '9월 21일' */
  label: string;
  /** 마우스로 누르기 시작 — 여기서부터 끌면 범위가 잡힌다. */
  onStart: (e: React.MouseEvent, date: string) => void;
  /** 키보드(Enter/Space)로 눌렀을 때 — 끌 수가 없으니 그 날 하루로 바로 연다. */
  onActivate?: (date: string) => void;
  className?: string;
}) {
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (!pressed) return;
    const release = () => setPressed(false);
    window.addEventListener('mouseup', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('mouseup', release);
      window.removeEventListener('blur', release);
    };
  }, [pressed]);

  return (
    <button
      type="button"
      data-proximity-reveal
      aria-label={`${label}에 일정 추가`}
      title={`${label}에 일정 추가 — 누른 채 끌면 여러 날`}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        // stopPropagation 을 부르면 안 된다. React 는 루트 컨테이너에서 이벤트를 받으므로
        // 여기서 멈추면 document 에 걸린 '바깥 클릭으로 닫기'(퀵에디트·태그 팝오버·레일 메뉴)가
        // 통째로 죽는다. 위쪽에 가로챌 mousedown 핸들러도 이제 없다.
        setPressed(true);
        onStart(e, date);
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // 키보드 활성화(Enter/Space)는 mousedown 없이 click 만 온다 — detail 0 이 그 신호다.
        // 끌 수가 없으므로 그 날 하루짜리로 바로 연다.
        if (e.detail === 0) onActivate?.(date);
      }}
      className={cn(
        'calendar-day-add group/add relative grid place-items-center shrink-0',
        'h-[22px] w-[22px] rounded-[7px] cursor-pointer',
        pressed && 'is-active',
        className,
      )}
    >
      <Plus size={12} strokeWidth={2.2} className="transition-transform duration-300 group-hover/add:rotate-90" />
    </button>
  );
}
