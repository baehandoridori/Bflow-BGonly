import { useEffect, useState } from 'react';
import { motion, AnimatePresence, type Transition } from 'framer-motion';
import { useMotionPref } from '@/hooks/useMotionPref';
import { elevatedSolidStyle, glassShimmer, glassTopHighlight } from '@/utils/glassStyles';

/* 움직임 폴리싱 바탕 C — 겉모습은 그대로, 방식만 가볍게.
   - 떠오르는 말풍선은 transform '문자열'로 움직인다(합성 스레드). 예전 x·y·scale 개별 값은 메인 스레드가
     매 프레임 계산했다. 가운데 정렬은 움직이지 않는 바깥 틀이 맡는다.
   - 사라질 때 흐려지기(filter blur)와 카드 뒤 흐림(backdrop-filter)을 뺐다 — 움직이는 동안 매 프레임 다시
     계산된다. 카드 바탕은 84% → 97% 로 올려 같은 느낌을 낸다.
   - 글자는 예전에도 줄 안 요소라 y 값이 적용되지 않고 투명도만 바뀌었다 — 같은 모습으로 투명도만 남긴다.
   - 동작 줄이기: 움직임 없이 나타났다 사라지기만 한다(빛 흐름·점 퍼짐도 뺀다). */
const TOAST_SPRING: Transition = { type: 'spring', stiffness: 260, damping: 24, mass: 0.8 };
const TOAST_FADE: Transition = { duration: 0.12 };
const textIn = (delay: number): Transition => ({ delay, duration: 0.4, ease: 'easeOut' });

interface WelcomeToastProps {
  userName?: string;
  message?: string;
  onDismiss: () => void;
}

export function WelcomeToast({ userName, message, onDismiss }: WelcomeToastProps) {
  const [visible, setVisible] = useState(true);
  const { reduce } = useMotionPref();

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
        <div className="fixed inset-x-0 bottom-8 z-[10001] flex justify-center pointer-events-none">
        <motion.div
          className="relative"
          initial={reduce ? { opacity: 0 } : { opacity: 0, transform: 'translateY(60px) scale(0.92)' }}
          animate={reduce
            ? { opacity: 1 }
            : { opacity: 1, transform: 'translateY(0px) scale(1)', transitionEnd: { transform: 'none' } }}
          // 'none' 에서 출발하면 framer 가 scale(0) 에서 출발시킨다 — 제자리 값을 명시한다.
          exit={reduce
            ? { opacity: 0 }
            : { opacity: 0, transform: ['translateY(0px) scale(1)', 'translateY(20px) scale(0.95)'] }}
          transition={reduce ? TOAST_FADE : TOAST_SPRING}
        >
          {/* Glow 배경 — 액센트 색상 번짐 */}
          <div
            className="absolute -inset-4 rounded-3xl opacity-40 blur-2xl pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at center, rgb(var(--color-accent) / 0.26) 0%, transparent 72%)',
            }}
          />

          {/* 글래스 카드 */}
          <div
            className="relative px-7 py-4 rounded-2xl overflow-hidden pointer-events-auto cursor-pointer"
            style={elevatedSolidStyle}
            onClick={() => { setVisible(false); setTimeout(onDismiss, 600); }}
          >
            {/* 상단 빛 반사 효과 */}
            <div
              className="absolute top-0 left-0 right-0 h-px opacity-30"
              style={{
                background: glassTopHighlight,
              }}
            />

            {/* 시머 효과 — 좌→우 빛 흐름 */}
            {!reduce && (
              <motion.div
                className="absolute inset-0 rounded-2xl pointer-events-none"
                initial={{ transform: 'translateX(-100%)' }}
                animate={{ transform: 'translateX(200%)' }}
                transition={{ duration: 2, ease: 'easeInOut', delay: 0.4 }}
                style={{
                  background: glassShimmer,
                }}
              />
            )}

            {/* 텍스트 */}
            <div className="relative flex items-center gap-3">
              {/* 액센트 도트 */}
              <div className="relative flex-shrink-0">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: 'rgb(var(--color-accent))' }}
                />
                {!reduce && (
                  <motion.div
                    className="absolute inset-0 rounded-full"
                    style={{ background: 'rgb(var(--color-accent))' }}
                    initial={{ transform: 'scale(1)', opacity: 0.6 }}
                    animate={{ transform: ['scale(1)', 'scale(2.2)', 'scale(1)'], opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 2, repeat: 1, ease: 'easeOut' }}
                  />
                )}
              </div>

              <p className="text-sm tracking-wide whitespace-nowrap">
                {message ? (
                  <motion.span
                    className="text-text-primary"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={textIn(0.15)}
                  >
                    {message}
                  </motion.span>
                ) : (
                  <>
                    <motion.span
                      className="font-semibold"
                      style={{
                        color: 'rgb(var(--color-accent))',
                        textShadow: '0 0 12px rgb(var(--color-accent) / 0.18)',
                      }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={textIn(0.15)}
                    >
                      {userName}
                    </motion.span>
                    <motion.span
                      className="text-text-primary"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={textIn(0.25)}
                    >
                      님! 어서오세요
                    </motion.span>
                  </>
                )}
              </p>
            </div>
          </div>
        </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
