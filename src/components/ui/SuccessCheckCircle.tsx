/**
 * SuccessCheckCircle — 동그란 완료 체크 (움직임 폴리싱 17번에서 '나의 할 일'에서 옮겨 와 되살림).
 *
 * 켜지면 원이 초록으로 차고, 안의 체크가 '톡' 튀어나온다(scale 0→1, 300ms 살짝 넘치는 곡선).
 * 끌 때는 체크가 작아지며 빠르게(120ms) 사라진다.
 * - 팀 할 일: onToggle 을 주면 role=checkbox 버튼 — 기본 네모 체크 상자를 대신한다(aria-checked·disabled 그대로).
 * - 내 리테이크 '담당 완료': onToggle 없이 보여 주기만 하는 표시. popIn 이면 켜진 채 나타날 때도 '톡'.
 *
 * 움직임은 CSS(transform·opacity) — 합성 스레드에서 돈다(예전 framer 개별 scale 값 X). 원 색은 바탕을 바꾸지 않고
 * 겹친 초록 층의 opacity 로 바꾼다. 동작 줄이기: 전역 규칙이 길이를 0 으로 만들어 바로 켜진다.
 * 스타일: src/styles/motion-scene-check.css 의 .success-check*.
 */
import { Check } from 'lucide-react';
import { cn } from '@/utils/cn';

interface SuccessCheckCircleProps {
  checked: boolean;
  /** 누를 수 있는 체크. 없으면 보여 주기만 하는 표시(span, 화면 읽기에서 숨김). */
  onToggle?: () => void;
  /** 화면 읽기용 이름(누를 수 있을 때). */
  label?: string;
  title?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** 켜진 채로 처음 나타날 때도 '톡' 튀어나온다(성공 표시). */
  popIn?: boolean;
  className?: string;
}

export function SuccessCheckCircle({
  checked,
  onToggle,
  label,
  title,
  disabled = false,
  size = 'md',
  popIn = false,
  className,
}: SuccessCheckCircleProps) {
  const classes = cn('success-check', size === 'sm' ? 'success-check--sm' : 'success-check--md', popIn && 'success-check--pop-in', className);
  const body = (
    <>
      <span aria-hidden="true" className="success-check-fill" />
      <span aria-hidden="true" className="success-check-mark">
        <Check size={size === 'sm' ? 9 : 11} strokeWidth={3} />
      </span>
    </>
  );

  if (!onToggle) {
    return (
      <span aria-hidden="true" data-on={checked} className={classes}>
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      data-on={checked}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={classes}
    >
      {body}
    </button>
  );
}
