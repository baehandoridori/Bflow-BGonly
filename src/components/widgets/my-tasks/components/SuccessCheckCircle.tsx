/**
 * SuccessCheckCircle — 개인 할일 좌측 원형 체크 (PR 5 모션).
 *
 * 완료(false→true) 시 체크가 spring 으로 그려지고 ring-burst(확장·페이드 링)가 1회 인다.
 * 되돌리기(true→false)는 체크가 즉시 사라지고 burst 없음.
 * reduce(동작 줄이기)면 체크 즉시 표시·burst 없음.
 *
 * 기존 원형 체크 버튼의 동작/접근성(aria-pressed·title·stopPropagation·키보드)을 그대로 보존한다.
 */
import { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { cn } from '@/utils/cn';

interface SuccessCheckCircleProps {
  completed: boolean;
  onToggle: () => void;
  title?: string;
  reduce: boolean;
}

export function SuccessCheckCircle({ completed, onToggle, title, reduce }: SuccessCheckCircleProps) {
  const prevCompleted = useRef(completed);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    // 완료 방향(false→true)으로 바뀐 순간에만 burst. 되돌리기/reduce는 제외.
    if (!prevCompleted.current && completed && !reduce) {
      setBurst(true);
      const t = setTimeout(() => setBurst(false), 550);
      prevCompleted.current = completed;
      return () => clearTimeout(t);
    }
    prevCompleted.current = completed;
  }, [completed, reduce]);

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
      {/* ring-burst (완료 순간 1회) */}
      <AnimatePresence>
        {burst && (
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-green-500 pointer-events-none"
            initial={{ scale: 1, opacity: 0.55 }}
            animate={{ scale: 2.3, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            aria-hidden
          />
        )}
      </AnimatePresence>

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
