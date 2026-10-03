import { useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, X } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { useMotionPref } from '@/hooks/useMotionPref';
import { cn } from '@/utils/cn';
import { EASE } from '@/utils/motion';
import {
  PART_COMPLETE_EXIT_MS,
  PART_COMPLETE_FLOW_MS,
  PART_COMPLETE_SETTLE_MS,
  PART_COMPLETE_SETTLE_STEP_MS,
  bokehBackground,
  buildBokehOrbs,
  driftKeyframes,
  settlePlaybackRate,
  type DriftFrame,
} from './celebrateMotion';

/*
 * 파트 완료 '고생하셨습니다!' 화면 (움직임 폴리싱 17번에서 ScenesView 밖으로 옮김).
 *
 * 한솔이 고른 연출이라 모양은 그대로 두고 '도는 시간과 무게'만 줄였다.
 * - 장식(오로라·리본·빛줄기·빛망울)은 처음 4.5초만 지금처럼 흐르고 1초에 걸쳐 잦아들어 멈춘다(그 뒤 다시 그리기 0).
 * - 움직임은 모두 WAAPI transform/opacity — 합성 스레드에서 돈다. 움직이는 층의 filter blur 는 미리 흐린 그라데이션으로.
 * - 카드의 유리 흐림(backdrop-filter)을 빼고 바탕을 더 불투명하게 해 겉모습을 맞췄다. 광택은 한 번만 지나간다.
 * - X 를 누르면 0.3초 동안 스르륵 사라진다(부르는 쪽 AnimatePresence 의 exit).
 * - compact: 이미 한 번 닫은(본) 완료 화면을 다시 열 때 — 장식 없이 카드만 작게.
 * - 동작 줄이기: 장식은 멈춘 채로 그리고, 카드는 opacity 로만 나타난다.
 */

export interface PartCompletedMeta {
  completedBy: string;
  short: string;
  full: string;
}

/*
 * 보케 RGB 팔레트 — rgba() 사용으로 밴딩 방지
 * UI/UX Pro Max: Dark OLED + Financial Dashboard 팔레트 기반
 * 성취감 → 초록(#22C55E) + 골드(#CA8A04) + 프로젝트 액센트(#6C5CE7)
 */
const BOKEH_PALETTE = [
  [0, 184, 148],   // emerald
  [34, 197, 94],    // green-500 (CTA)
  [108, 92, 231],   // accent (프로젝트)
  [162, 155, 254],  // lavender
  [202, 138, 4],    // gold (achievement)
  [116, 185, 255],  // sky
  [253, 203, 110],  // amber
] as const;

interface DecorMotion {
  keyframes: Keyframe[];
  durationMs: number;
  delayMs: number;
}

/**
 * 장식 움직임을 걸고, 4.5초 뒤 1초 동안 재생 속도를 1→0 으로 낮춰 멈춘다.
 * 멈춘 뒤에는 그 자리에 그대로 서 있다(다시 그리기 없음). reduce 면 아무것도 걸지 않는다(정지한 장식).
 */
function useSettlingDecor(elementsRef: React.MutableRefObject<(HTMLElement | null)[]>, motions: readonly DecorMotion[], enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const animations: Animation[] = [];
    elementsRef.current.forEach((el, index) => {
      const spec = motions[index];
      if (!el || !spec || typeof el.animate !== 'function') return;
      animations.push(el.animate(spec.keyframes, {
        duration: spec.durationMs,
        delay: spec.delayMs,
        iterations: Infinity,
        fill: 'backwards',
      }));
    });
    if (animations.length === 0) return;
    let timer = 0;
    let settleStart = 0;
    const settle = () => {
      const progress = (performance.now() - settleStart) / PART_COMPLETE_SETTLE_MS;
      if (progress >= 1) {
        animations.forEach((animation) => animation.pause());
        return;
      }
      const rate = settlePlaybackRate(progress);
      animations.forEach((animation) => animation.updatePlaybackRate(rate));
      timer = window.setTimeout(settle, PART_COMPLETE_SETTLE_STEP_MS);
    };
    timer = window.setTimeout(() => {
      settleStart = performance.now();
      settle();
    }, PART_COMPLETE_FLOW_MS);
    return () => {
      window.clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
    };
  }, [elementsRef, motions, enabled]);
}

interface RibbonSpec {
  top: string;
  left: string;
  width: string;
  height: number;
  background: string;
  motion: DecorMotion;
}

interface TraceSpec {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width: string;
  rotate: number;
  background: string;
  shadow: string;
  motion: DecorMotion;
}

/** 리본: 예전엔 가로 그라데이션 띠에 blur(26~30px). 움직이는 층이라 흐림 대신 가장자리를 미리 흐린 타원 두 개로 그린다. */
function ribbonBackground(left: string, right: string): string {
  return `radial-gradient(ellipse 42% 50% at 36% 50%, ${left} 0%, transparent 100%), radial-gradient(ellipse 42% 50% at 64% 50%, ${right} 0%, transparent 100%)`;
}

function ribbonMotion(rotateFrames: number[], xs: number[], ys: number[], opacities: number[], durationMs: number, delayMs: number): DecorMotion {
  const frames: DriftFrame[] = rotateFrames.map((rotate, i) => ({ x: xs[i], y: ys[i], rotate, opacity: opacities[i] }));
  return { keyframes: driftKeyframes(frames), durationMs, delayMs };
}

export function PartCompleteOverlay({ completedMeta, onDismiss, onUndoLastAction, compact = false }: {
  completedMeta?: PartCompletedMeta | null;
  onDismiss: () => void;
  onUndoLastAction?: () => void;
  /** 이미 본 완료 화면 — 장식 없이 카드만 작게. */
  compact?: boolean;
}) {
  const colorMode = useAppStore((s) => s.colorMode);
  const isLight = colorMode === 'light';
  const { reduce } = useMotionPref();
  const showDecor = !compact;

  const aurora = useMemo<DecorMotion[]>(() => [
    { keyframes: driftKeyframes([{ x: 0, y: 0 }, { x: 30, y: -20 }, { x: -20, y: 15 }, { x: 0, y: 0 }]), durationMs: 20000, delayMs: 0 },
    { keyframes: driftKeyframes([{ x: 0, y: 0 }, { x: -25, y: 20 }, { x: 20, y: -15 }, { x: 0, y: 0 }]), durationMs: 16000, delayMs: 0 },
  ], []);

  const ribbons = useMemo<RibbonSpec[]>(() => {
    const ribbonOpacity = (light: number[], dark: number[]) => (isLight ? light : dark);
    return [
      {
        top: '14%',
        left: '-14%',
        width: '58%',
        height: 120,
        background: isLight
          ? ribbonBackground('rgba(144,234,191,0.16)', 'rgba(107,154,255,0.14)')
          : ribbonBackground('rgba(74,222,128,0.12)', 'rgba(108,92,231,0.16)'),
        motion: ribbonMotion([-12, -6, -14, -12], [0, 80, -20, 0], [0, 18, -8, 0], ribbonOpacity([0.36, 0.72, 0.42, 0.36], [0.24, 0.52, 0.3, 0.24]), 9500, 0),
      },
      {
        top: '56%',
        left: '28%',
        width: '48%',
        height: 108,
        background: isLight
          ? ribbonBackground('rgba(125,211,252,0.12)', 'rgba(196,181,253,0.16)')
          : ribbonBackground('rgba(56,189,248,0.10)', 'rgba(167,139,250,0.14)'),
        motion: ribbonMotion([16, 10, 18, 16], [0, -56, 26, 0], [0, -14, 10, 0], ribbonOpacity([0.36, 0.72, 0.42, 0.36], [0.24, 0.52, 0.3, 0.24]), 11000, 400),
      },
      {
        top: '72%',
        left: '-6%',
        width: '42%',
        height: 92,
        background: isLight
          ? ribbonBackground('rgba(253,224,71,0.12)', 'rgba(34,197,94,0.10)')
          : ribbonBackground('rgba(250,204,21,0.10)', 'rgba(34,197,94,0.10)'),
        motion: ribbonMotion([-6, -2, -8, -6], [0, 62, -18, 0], [0, -12, 8, 0], ribbonOpacity([0.36, 0.72, 0.42, 0.36], [0.24, 0.52, 0.3, 0.24]), 10500, 800),
      },
    ];
  }, [isLight]);

  const traces = useMemo<TraceSpec[]>(() => {
    const traceMotion = (rotate: number, durationMs: number, delayMs: number): DecorMotion => ({
      keyframes: driftKeyframes([0, 22, -10, 0].map((x, i) => ({
        x,
        rotate,
        scaleX: [0.94, 1.04, 0.98, 0.94][i],
        opacity: isLight ? [0.22, 0.88, 0.34, 0.22][i] : [0.14, 0.5, 0.22, 0.14][i],
      }))),
      durationMs,
      delayMs,
    });
    return [
      {
        top: '26%',
        left: '6%',
        width: '34%',
        rotate: 7,
        background: isLight
          ? 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.72), rgba(110,231,183,0.58), rgba(255,255,255,0))'
          : 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.18), rgba(110,231,183,0.30), rgba(255,255,255,0))',
        shadow: isLight ? '0 0 22px rgba(110,231,183,0.22)' : '0 0 20px rgba(110,231,183,0.14)',
        motion: traceMotion(7, 5800, 100),
      },
      {
        top: '46%',
        right: '4%',
        width: '26%',
        rotate: -11,
        background: isLight
          ? 'linear-gradient(90deg, rgba(255,255,255,0), rgba(196,181,253,0.54), rgba(255,255,255,0.68), rgba(255,255,255,0))'
          : 'linear-gradient(90deg, rgba(255,255,255,0), rgba(167,139,250,0.22), rgba(255,255,255,0.16), rgba(255,255,255,0))',
        shadow: isLight ? '0 0 18px rgba(196,181,253,0.18)' : '0 0 16px rgba(167,139,250,0.12)',
        motion: traceMotion(-11, 6400, 900),
      },
      {
        bottom: '16%',
        left: '18%',
        width: '30%',
        rotate: 3,
        background: isLight
          ? 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.68), rgba(125,211,252,0.56), rgba(255,255,255,0))'
          : 'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.16), rgba(125,211,252,0.24), rgba(255,255,255,0))',
        shadow: isLight ? '0 0 18px rgba(125,211,252,0.18)' : '0 0 16px rgba(125,211,252,0.10)',
        motion: traceMotion(3, 5200, 1400),
      },
    ];
  }, [isLight]);

  // 빛망울은 처음 한 번만 자리를 정한다(색 모드가 바뀌어도 자리는 그대로, 밝기만 바뀐다).
  const orbGroups = useMemo(() => [
    { alpha: [0.18, 0.1], orbs: buildBokehOrbs({ count: 4, minR: 60, maxR: 120, drift: 44, speed: 11, palette: BOKEH_PALETTE }) },
    { alpha: [0.26, 0.14], orbs: buildBokehOrbs({ count: 6, minR: 18, maxR: 44, drift: 34, speed: 8, palette: BOKEH_PALETTE }) },
    { alpha: [0.4, 0.22], orbs: buildBokehOrbs({ count: 10, minR: 4, maxR: 12, drift: 20, speed: 6, palette: BOKEH_PALETTE }) },
  ], []);
  const orbs = useMemo(
    () => orbGroups.flatMap((group) => group.orbs.map((orb) => ({ orb, alpha: isLight ? group.alpha[0] : group.alpha[1] }))),
    [orbGroups, isLight],
  );

  // 움직이는 장식 — 그리는 순서(오로라 → 리본 → 빛줄기 → 빛망울)와 같은 순서로 움직임을 모은다.
  const decorMotions = useMemo<DecorMotion[]>(() => [
    ...aurora,
    ...ribbons.map((ribbon) => ribbon.motion),
    ...traces.map((trace) => trace.motion),
    ...orbs.map(({ orb }) => ({ keyframes: orb.keyframes, durationMs: orb.durationMs, delayMs: orb.delayMs })),
  ], [aurora, ribbons, traces, orbs]);
  const decorRefs = useRef<(HTMLElement | null)[]>([]);
  const setDecor = (index: number) => (el: HTMLElement | null) => { decorRefs.current[index] = el; };
  useSettlingDecor(decorRefs, decorMotions, showDecor && !reduce);

  // 광택 — 카드가 자리 잡은 뒤 한 번만 지나간다(예전: 4.8초마다 무한 반복).
  const shineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = shineRef.current;
    if (!el || reduce || typeof el.animate !== 'function') return;
    const animation = el.animate(
      [{ transform: 'translateX(0%)' }, { transform: 'translateX(360%)' }],
      { duration: 2400, delay: 500, easing: 'ease-in-out', fill: 'backwards' },
    );
    return () => animation.cancel();
  }, [reduce, compact]);

  const ribbonBase = aurora.length;
  const traceBase = ribbonBase + ribbons.length;
  const orbBase = traceBase + traces.length;
  const cardFrom = compact ? 'translateY(10px) scale(0.97)' : 'translateY(18px) scale(0.96)';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: PART_COMPLETE_EXIT_MS / 1000, ease: EASE.in } }}
      transition={{ duration: compact ? 0.3 : 1, ease: EASE.out }}
      className="fixed inset-0 z-[60] pointer-events-none overflow-hidden rounded-[28px]"
    >
      {showDecor && (
        <>
          <div
            className="absolute inset-0 rounded-[inherit]"
            style={{
              background: isLight
                ? 'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.44) 0%, rgba(255,255,255,0.16) 42%, rgba(255,255,255,0) 78%), linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%)'
                : 'radial-gradient(circle at 50% 45%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 42%, rgba(255,255,255,0) 78%), linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
              boxShadow: isLight
                ? 'inset 0 0 0 1px rgba(255,255,255,0.42), inset 0 24px 60px rgba(255,255,255,0.18)'
                : 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 20px 60px rgba(255,255,255,0.03)',
              WebkitMaskImage: 'radial-gradient(circle at center, black 32%, rgba(0,0,0,0.92) 68%, transparent 100%)',
              maskImage: 'radial-gradient(circle at center, black 32%, rgba(0,0,0,0.92) 68%, transparent 100%)',
            }}
          />

          {/* 오로라 메시 — 부드러운 radial 워시 2개(conic 보다 밴딩 없음). */}
          <div
            ref={setDecor(0)}
            className="absolute"
            style={{
              width: '140%', height: '140%', left: '-20%', top: '-20%',
              background: `radial-gradient(ellipse at 30% 40%,
                rgba(0,184,148,${0.06 * (isLight ? 3 : 1)}) 0%, rgb(var(--color-accent) / ${0.04 * (isLight ? 3 : 1)}) 40%, transparent 70%),
                radial-gradient(ellipse at 70% 60%,
                rgba(202,138,4,${0.05 * (isLight ? 3 : 1)}) 0%, rgb(var(--color-accent-sub) / ${0.03 * (isLight ? 3 : 1)}) 40%, transparent 70%)`,
            }}
          />
          <div
            ref={setDecor(1)}
            className="absolute"
            style={{
              width: '120%', height: '120%', left: '-10%', top: '-10%',
              background: `radial-gradient(ellipse at 60% 30%,
                rgba(34,197,94,${0.05 * (isLight ? 3 : 1)}) 0%, rgba(116,185,255,${0.03 * (isLight ? 3 : 1)}) 40%, transparent 65%),
                radial-gradient(ellipse at 40% 70%,
                rgba(253,203,110,${0.04 * (isLight ? 3 : 1)}) 0%, rgba(0,184,148,${0.03 * (isLight ? 3 : 1)}) 40%, transparent 65%)`,
            }}
          />

          {/* 움직이지 않는 층이라 흐림을 그대로 둔다(한 번만 그려진다). */}
          <div
            className="absolute inset-0 rounded-[inherit]"
            style={{
              background: isLight
                ? 'radial-gradient(circle at 18% 26%, rgba(108,92,231,0.09) 0%, transparent 28%), radial-gradient(circle at 82% 24%, rgba(34,197,94,0.08) 0%, transparent 24%), radial-gradient(circle at 50% 78%, rgba(253,203,110,0.08) 0%, transparent 20%)'
                : 'radial-gradient(circle at 18% 26%, rgba(108,92,231,0.06) 0%, transparent 28%), radial-gradient(circle at 82% 24%, rgba(34,197,94,0.05) 0%, transparent 24%), radial-gradient(circle at 50% 78%, rgba(253,203,110,0.05) 0%, transparent 20%)',
              filter: 'blur(20px)',
            }}
          />

          {ribbons.map((ribbon, index) => (
            <div
              key={`flow-ribbon-${index}`}
              ref={setDecor(ribbonBase + index)}
              className="absolute rounded-full"
              style={{
                top: ribbon.top,
                left: ribbon.left,
                width: ribbon.width,
                height: ribbon.height,
                background: ribbon.background,
                // 움직임 전(동작 줄이기 포함) 모습 = 첫 키프레임.
                transform: String(ribbon.motion.keyframes[0]?.transform ?? 'none'),
                opacity: Number(ribbon.motion.keyframes[0]?.opacity ?? 1),
              }}
            />
          ))}

          {traces.map((trace, index) => (
            <div
              key={`flow-trace-${index}`}
              ref={setDecor(traceBase + index)}
              className="absolute h-px rounded-full"
              style={{
                top: trace.top,
                right: trace.right,
                bottom: trace.bottom,
                left: trace.left,
                width: trace.width,
                background: trace.background,
                boxShadow: trace.shadow,
                transform: String(trace.motion.keyframes[0]?.transform ?? 'none'),
                opacity: Number(trace.motion.keyframes[0]?.opacity ?? 1),
              }}
            />
          ))}

          {orbs.map(({ orb, alpha }, index) => (
            <div
              key={`orb-${index}`}
              ref={setDecor(orbBase + index)}
              className="absolute rounded-full"
              style={{
                width: orb.r,
                height: orb.r,
                left: `${orb.x}%`,
                top: `${orb.y}%`,
                background: bokehBackground(orb.color, alpha, orb.r),
              }}
            />
          ))}

          <div
            className="absolute inset-0 rounded-[inherit]"
            style={{
              background: isLight
                ? 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.18) 46%, rgba(255,255,255,0.04) 100%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.01) 0%, rgba(255,255,255,0.05) 46%, rgba(255,255,255,0.01) 100%)',
              opacity: isLight ? 0.9 : 0.7,
            }}
          />
        </>
      )}

      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, transform: cardFrom }}
          animate={reduce
            ? { opacity: 1 }
            : { opacity: 1, transform: 'translateY(0px) scale(1)', transitionEnd: { transform: 'none' } }}
          transition={{ duration: compact ? 0.3 : 0.55, delay: compact ? 0 : 0.08, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            'pointer-events-auto relative w-full overflow-hidden border text-center',
            compact
              ? 'max-w-[420px] rounded-[24px] px-4 py-4 sm:px-5 sm:py-5'
              : 'max-w-[560px] rounded-[30px] px-5 py-5 sm:px-7 sm:py-6',
          )}
          style={{
            // 유리 흐림(backdrop-filter) 대신 더 불투명한 바탕 — 장식이 움직이는 동안 흐림을 매 프레임 다시 계산하지 않는다.
            background: isLight
              ? 'linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(244,255,251,0.95) 100%)'
              : 'linear-gradient(180deg, rgba(22,28,38,0.96) 0%, rgba(15,20,29,0.94) 100%)',
            borderColor: isLight ? 'rgba(167, 243, 208, 0.92)' : 'rgba(52, 211, 153, 0.26)',
            boxShadow: isLight
              ? '0 28px 96px rgba(16, 185, 129, 0.20), 0 10px 26px rgba(15, 23, 42, 0.08)'
              : '0 30px 98px rgba(16, 185, 129, 0.18), 0 12px 30px rgba(0, 0, 0, 0.28)',
          }}
        >
          <button
            type="button"
            aria-label="완료 안내 숨기기"
            title="완료 안내 숨기기"
            onClick={(event) => {
              event.stopPropagation();
              onDismiss();
            }}
            className={cn(
              'absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border transition-colors',
              isLight
                ? 'border-emerald-200 bg-white/80 text-emerald-800 hover:bg-white'
                : 'border-emerald-300/20 bg-white/8 text-emerald-100 hover:bg-white/12',
            )}
          >
            <X size={15} />
          </button>
          {!compact && !reduce && (
            <div
              ref={shineRef}
              aria-hidden="true"
              className="absolute inset-y-0 -left-1/3 w-1/3"
              style={{
                // 움직이는 층이라 blur 대신 양끝을 넓게 비운 그라데이션으로 부드럽게.
                background: isLight
                  ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.18) 30%, rgba(255,255,255,0.46) 52%, rgba(255,255,255,0.18) 74%, rgba(255,255,255,0) 100%)'
                  : 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.05) 30%, rgba(255,255,255,0.12) 52%, rgba(255,255,255,0.05) 74%, rgba(255,255,255,0) 100%)',
              }}
            />
          )}
          <div
            className="absolute inset-0 rounded-[inherit]"
            style={{
              background: isLight
                ? 'linear-gradient(135deg, rgba(110,231,183,0.18) 0%, rgba(108,92,231,0.08) 42%, rgba(255,255,255,0) 100%)'
                : 'linear-gradient(135deg, rgba(74,222,128,0.14) 0%, rgba(108,92,231,0.12) 42%, rgba(255,255,255,0) 100%)',
            }}
          />
          <div className={cn('relative flex flex-col items-center', compact ? 'gap-3' : 'gap-4')}>
            <div
              className="inline-flex items-center rounded-full px-4 py-1.5 text-[11px] font-semibold tracking-[0.24em]"
              style={{
                color: isLight ? '#047857' : '#86EFAC',
                background: isLight ? 'rgba(16, 185, 129, 0.10)' : 'rgba(16, 185, 129, 0.12)',
                border: `1px solid ${isLight ? 'rgba(16, 185, 129, 0.18)' : 'rgba(134, 239, 172, 0.18)'}`,
              }}
            >
              COMPLETE
            </div>
            <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
              <p
                className={cn('font-semibold tracking-[-0.03em]', compact ? 'text-[24px]' : 'text-[32px] sm:text-[36px]')}
                style={{ color: isLight ? '#064E3B' : '#ECFDF5' }}
              >
                고생하셨습니다!
              </p>
              <p
                className={cn('font-medium', compact ? 'text-sm' : 'text-base sm:text-lg')}
                style={{ color: isLight ? 'rgba(6, 95, 70, 0.88)' : 'rgba(236, 253, 245, 0.90)' }}
              >
                현재 보고계신 파트는 완료되었습니다.
              </p>
              {!compact && (
                <p
                  className="mx-auto max-w-[28rem] text-sm leading-6"
                  style={{ color: isLight ? 'rgba(6, 95, 70, 0.74)' : 'rgba(209, 250, 229, 0.72)' }}
                >
                  고생 많으셨습니다! 다음 작업 이어서 하시기 전에, 잠깐 쉬셔요~ 띵호와
                </p>
              )}
            </div>
            {completedMeta && (
              <div
                className={cn(
                  'flex w-full flex-col gap-2 rounded-2xl border px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between',
                  isLight
                    ? 'border-emerald-200/80 bg-white/70'
                    : 'border-emerald-300/15 bg-white/6',
                )}
                title={`${completedMeta.completedBy}님 · ${completedMeta.full}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[11px] font-medium tracking-[0.18em] text-text-secondary/70">마지막 완료</span>
                  <span className="min-w-0 truncate text-sm font-semibold text-text-primary">{completedMeta.completedBy}님</span>
                </div>
                <div className="flex min-w-0 items-center gap-2 sm:justify-end">
                  <span className="shrink-0 text-[11px] font-medium tracking-[0.18em] text-text-secondary/70">완료 시각</span>
                  <span className="min-w-0 truncate text-sm font-medium text-text-primary/90">{compact ? completedMeta.short : completedMeta.full}</span>
                </div>
              </div>
            )}
            {onUndoLastAction && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onUndoLastAction();
                }}
                className={cn(
                  'pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                  isLight
                    ? 'border border-emerald-200 bg-white/80 text-emerald-800 hover:bg-white'
                    : 'border border-emerald-300/20 bg-white/8 text-emerald-100 hover:bg-white/12',
                )}
              >
                <RotateCcw size={14} />
                마지막 체크 취소
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

/**
 * '완료 안내 다시 보기' 알약 — 완료 화면을 닫으면 아래에서 떠오른다(translateY 12px→0 + opacity, 200ms).
 * 가운데 맞춤(-translate-x-1/2)은 바깥 상자가 맡고, 떠오름·hover 들림은 안쪽 버튼이 맡아 서로 덮어쓰지 않는다.
 * 움직이는 알약이라 흐림(backdrop-filter) 대신 거의 불투명한 바탕.
 */
export function CompletionRestoreButton({ onClick }: { onClick: () => void }) {
  const colorMode = useAppStore((s) => s.colorMode);
  const isLight = colorMode === 'light';
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[61] -translate-x-1/2">
      <button
        type="button"
        aria-label="완료 안내 다시 보기"
        onClick={onClick}
        className={cn(
          'part-complete-restore pointer-events-auto rounded-full border px-4 py-2 text-sm font-semibold shadow-lg transition-[transform,background-color] duration-fast ease-out-expo hover:-translate-y-0.5',
          isLight
            ? 'border-emerald-200 bg-white/95 text-emerald-800 shadow-emerald-900/10 hover:bg-white'
            : 'border-emerald-300/25 bg-bg-card/95 text-emerald-100 shadow-black/30 hover:bg-bg-card',
        )}
      >
        완료 안내 다시 보기
      </button>
    </div>
  );
}
