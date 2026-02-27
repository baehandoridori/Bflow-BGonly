import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface WelcomeToastProps {
  userName: string;
  onDismiss: () => void;
}

export function WelcomeToast({ userName, onDismiss }: WelcomeToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      // exit 애니메이션 완료 후 콜백
      setTimeout(onDismiss, 600);
    }, 3000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed bottom-8 left-1/2 z-[10001] pointer-events-none"
          initial={{ x: '-50%', y: 60, opacity: 0, scale: 0.92 }}
          animate={{ x: '-50%', y: 0, opacity: 1, scale: 1 }}
          exit={{ x: '-50%', y: 20, opacity: 0, scale: 0.95, filter: 'blur(8px)' }}
          transition={{
            type: 'spring',
            stiffness: 260,
            damping: 24,
            mass: 0.8,
          }}
        >
          {/* Glow 배경 — 액센트 색상 번짐 */}
          <div
            className="absolute -inset-4 rounded-3xl opacity-40 blur-2xl pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at center, rgb(var(--color-accent) / 0.5) 0%, transparent 70%)',
            }}
          />

          {/* 글래스 카드 */}
          <div
            className="relative px-7 py-4 rounded-2xl overflow-hidden pointer-events-auto cursor-pointer"
            style={{
              background: 'rgba(26, 29, 39, 0.7)',
              backdropFilter: 'blur(20px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(20px) saturate(1.6)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 60px rgb(var(--color-accent) / 0.08)',
            }}
            onClick={() => { setVisible(false); setTimeout(onDismiss, 600); }}
          >
            {/* 상단 빛 반사 효과 */}
            <div
              className="absolute top-0 left-0 right-0 h-px opacity-30"
              style={{
                background: 'linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.5) 50%, transparent 90%)',
              }}
            />

            {/* 시머 효과 — 좌→우 빛 흐름 */}
            <motion.div
              className="absolute inset-0 rounded-2xl pointer-events-none"
              initial={{ x: '-100%' }}
              animate={{ x: '200%' }}
              transition={{ duration: 2, ease: 'easeInOut', delay: 0.4 }}
              style={{
                background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.06) 45%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 55%, transparent 60%)',
              }}
            />

            {/* 텍스트 */}
            <div className="relative flex items-center gap-3">
              {/* 액센트 도트 */}
              <div className="relative flex-shrink-0">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: 'rgb(var(--color-accent))' }}
                />
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{ background: 'rgb(var(--color-accent))' }}
                  animate={{ scale: [1, 2.2, 1], opacity: [0.6, 0, 0.6] }}
                  transition={{ duration: 2, repeat: 1, ease: 'easeOut' }}
                />
              </div>

              <p className="text-sm tracking-wide whitespace-nowrap">
                <motion.span
                  className="font-semibold"
                  style={{
                    color: 'rgb(var(--color-accent))',
                    textShadow: '0 0 16px rgb(var(--color-accent) / 0.4)',
                  }}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, duration: 0.4, ease: 'easeOut' }}
                >
                  {userName}
                </motion.span>
                <motion.span
                  className="text-text-primary/90"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25, duration: 0.4, ease: 'easeOut' }}
                >
                  님! 어서오세요
                </motion.span>
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
