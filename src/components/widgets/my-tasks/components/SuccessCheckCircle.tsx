/**
 * SuccessCheckCircle — 개인 할일 좌측 원형 체크 (PR 5 모션).
 *
 * 완료(completed=true)일 때 체크가 spring 으로 그려진다(완료 섹션을 펼치면 보임).
 * reduce(동작 줄이기)면 체크 즉시 표시.
 *
 * ★ring-burst 는 두지 않는다: 개인 할일을 완료하면 항목이 진행 리스트에서 '완료 섹션'(기본 접힘)으로
 *   즉시 이동하는데, 이는 React 상 다른 부모 컨테이너로의 unmount→remount 라 인스턴스 내 false→true
 *   전이를 관측할 수 없어 burst 가 보일 틈이 없다. 전체 완료 축하는 위젯 레벨 Confetti(진행 0 전이)가 담당한다.
 *
 * 기존 원형 체크 버튼의 동작/접근성(aria-pressed·title·stopPropagation·키보드)을 그대로 보존한다.
 */
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/utils/cn';

interface SuccessCheckCircleProps {
  completed: boolean;
  onToggle: () => void;
  title?: string;
  reduce: boolean;
}

export function SuccessCheckCircle({ completed, onToggle, title, reduce }: SuccessCheckCircleProps) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      aria-pressed={completed}
      title={title}
      className={cn(
        'relative w-5 h-5 rounded-full border-2 flex items-center justify-center cursor-pointer transition-all shrink-0',
        completed ? 'bg-green-500 border-green-500 text-white' : 'border-bg-border/50 hover:border-accent',
      )}
    >
      {completed && (
        reduce ? (
          <Check size={11} strokeWidth={3} />
        ) : (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 520, damping: 18 }}
            className="flex"
          >
            <Check size={11} strokeWidth={3} />
          </motion.span>
        )
      )}
    </button>
  );
}
