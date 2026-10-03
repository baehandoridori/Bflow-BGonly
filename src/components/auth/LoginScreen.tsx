import { useState, useCallback, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, ChevronRight, AlertTriangle } from 'lucide-react';
import { login } from '@/services/userService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { getPreset } from '@/themes';
import { cn } from '@/utils/cn';
import { useCapsLockWarning } from '@/hooks/useCapsLockWarning';
import { StarNestBackground } from '@/components/effects/StarNestBackground';
import { BflowStarNestBackground } from '@/components/effects/BflowStarNestBackground';
import { useBackgroundLoopGate } from '@/hooks/useBackgroundLoopGate';
import { createFrameLoop, type FrameInfo } from '@/utils/frameLoop';
import { GradientBackdrop } from '@/components/common/GradientBackdrop';
import { prefersReducedMotion } from '@/utils/motion';
import {
  ENTRY_CURTAIN_DELAY_MS,
  ENTRY_CURTAIN_MS,
  ENTRY_VIEW_WAIT_MAX_MS,
  canLiftEntryCurtain,
  entryCurtain,
} from '@/utils/firstEntryMotion';

// ─── 플렉서스 배경 (Canvas 2D, Z축 깊이감, 마우스 인터랙션) ─────

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  baseSpeed: number;
  size: number;
  colorIdx: number;
}

// RGB ↔ HSL 변환 유틸
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function getPlexusColors(): [number, number, number][] {
  const themeId = useAppStore.getState().themeId;
  const custom = useAppStore.getState().customThemeColors;
  const colors = custom ?? getPreset(themeId)?.colors;
  if (!colors) return [[108, 92, 231], [162, 155, 254]];
  const parse = (s: string): [number, number, number] => {
    const [r, g, b] = s.split(' ').map(Number);
    return [r, g, b];
  };
  const accent = parse(colors.accent);
  const accentSub = parse(colors.accentSub);

  // HSL 기반 보색/유사색 생성
  const [ah, as, al] = rgbToHsl(...accent);
  const complementary = hslToRgb(ah + 180, as * 0.6, Math.min(al + 10, 85));  // 보색 (채도 낮춤)
  const analogous1 = hslToRgb(ah + 30, as * 0.8, al);                         // 유사색 +30°
  const analogous2 = hslToRgb(ah - 30, as * 0.8, al);                         // 유사색 -30°
  const lighter: [number, number, number] = [
    Math.min(255, accent[0] + 50),
    Math.min(255, accent[1] + 50),
    Math.min(255, accent[2] + 50),
  ];
  const mix: [number, number, number] = [
    Math.round((accent[0] + accentSub[0]) / 2),
    Math.round((accent[1] + accentSub[1]) / 2),
    Math.round((accent[2] + accentSub[2]) / 2),
  ];

  // 테마 색상 위주 (비중 높음) + 보색/유사색 약간 섞기
  return [accent, accent, accentSub, lighter, mix, analogous1, analogous2, complementary];
}

const DEFAULT_LOGIN_PARTICLE_COUNT = 666;
// 아래 상수들은 설정에서 커스터마이징 가능 (store에서 읽음)
const DEFAULT_CONNECTION_DIST = 160;
const DEFAULT_MOUSE_RADIUS = 250;
const DEFAULT_MOUSE_FORCE = 0.06;
// "창을 통해 보는" 가상 캔버스 크기 (실제 창보다 넓음)
const VIRTUAL_W = 2800;
const VIRTUAL_H = 1800;

function createParticle(_w: number, _h: number, plexusColors?: [number, number, number][]): Particle {
  const z = 0.1 + Math.random() * 0.9;
  const cols = plexusColors ?? getPlexusColors();
  const colorIdx = Math.floor(Math.random() * cols.length);
  const baseSpeed = 0.12 + Math.random() * 0.35;
  return {
    x: Math.random() * VIRTUAL_W, y: Math.random() * VIRTUAL_H, z,
    vx: (Math.random() - 0.5) * baseSpeed * z,
    vy: (Math.random() - 0.5) * baseSpeed * z,
    baseSpeed, size: 1.2 + z * 3, colorIdx,
  };
}

function PlexusBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const sizeRef = useRef({ w: 0, h: 0 });
  const noiseRef = useRef<HTMLCanvasElement | null>(null);

  const plexusSettings = useAppStore((s) => s.plexusSettings);
  const loginEnabled = plexusSettings.loginEnabled;
  const particleCount = plexusSettings.loginParticleCount || DEFAULT_LOGIN_PARTICLE_COUNT;
  // 동작 줄이기·움직임 '가볍게' 이상이면 한 장만 그리고 멈춘다. 멈춘 동안 색·모양 설정이 바뀌면 한 장을 다시 그린다.
  const themeId = useAppStore((s) => s.themeId);
  const colorMode = useAppStore((s) => s.colorMode);
  const customThemeColors = useAppStore((s) => s.customThemeColors);
  const { loopRef, loopOptions } = useBackgroundLoopGate(
    `${themeId}|${colorMode}|${customThemeColors ? JSON.stringify(customThemeColors) : ''}|${plexusSettings.glowIntensity}|${plexusSettings.connectionDist}`,
  );

  // 커스터마이징 가능한 설정을 ref로 관리 (애니메이션 루프 재시작 없이 즉시 반영)
  const plexusCfgRef = useRef({
    speed: plexusSettings.speed ?? 1.0,
    mouseRadius: plexusSettings.mouseRadius ?? DEFAULT_MOUSE_RADIUS,
    mouseForce: plexusSettings.mouseForce ?? DEFAULT_MOUSE_FORCE,
    glowIntensity: plexusSettings.glowIntensity ?? 1.0,
    connectionDist: plexusSettings.connectionDist ?? DEFAULT_CONNECTION_DIST,
  });
  plexusCfgRef.current = {
    speed: plexusSettings.speed ?? 1.0,
    mouseRadius: plexusSettings.mouseRadius ?? DEFAULT_MOUSE_RADIUS,
    mouseForce: plexusSettings.mouseForce ?? DEFAULT_MOUSE_FORCE,
    glowIntensity: plexusSettings.glowIntensity ?? 1.0,
    connectionDist: plexusSettings.connectionDist ?? DEFAULT_CONNECTION_DIST,
  };

  useEffect(() => {
    if (!loginEnabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // alpha: true — canvas 뒤의 <GradientBackdrop />이 비치도록 투명 배경 사용.
    // (이전 alpha: false + fillRect는 solid fill이라 전역 그라데이션을 가렸음)
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };

      if (!noiseRef.current || noiseRef.current.width !== w) {
        const nc = document.createElement('canvas');
        nc.width = w; nc.height = h;
        const nctx = nc.getContext('2d');
        if (nctx) {
          const imageData = nctx.createImageData(w, h);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            const v = Math.random() * 25;
            data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 18;
          }
          nctx.putImageData(imageData, 0, 0);
        }
        noiseRef.current = nc;
      }

      const plexusColors = getPlexusColors();
      if (particlesRef.current.length === 0 || particlesRef.current.length !== particleCount) {
        particlesRef.current = Array.from({ length: particleCount }, () => createParticle(VIRTUAL_W, VIRTUAL_H, plexusColors));
      }
      // 리사이즈: 파티클 위치 변경 없음 — 창을 통해 보는 느낌
      // 크기를 바꾸면 캔버스가 지워진다 — 멈춘 상태면 한 장을 다시 그린다.
      loopRef.current?.invalidate();
    };

    resize();
    window.addEventListener('resize', resize);

    const onMouse = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMouse, { passive: true });

    const TARGET_FRAME_MS = 1000 / 60;

    // info.dtMs: 실제 경과 × 움직임 배율(초당 30장 상한, 창을 떠나면 서서히 멈춤 — 루프 문지기)
    const animate = (_now: number, info: FrameInfo) => {
      const dtFactor = Math.min(info.dtMs / TARGET_FRAME_MS, 3); // cap at 3x

      // 매 프레임 최신 팔레트 조회 → 테마 변경 시 즉시 색 반영
      const palette = getPlexusColors();

      const { w, h } = sizeRef.current;
      const particles = particlesRef.current;

      // 뷰포트 오프셋: 가상 캔버스 중앙에 창을 배치
      const ox = (VIRTUAL_W - w) / 2;
      const oy = (VIRTUAL_H - h) / 2;
      // 마우스를 가상 캔버스 좌표로 변환
      const mx = mouseRef.current.x + ox;
      const my = mouseRef.current.y + oy;

      // 투명하게 clear — 전역 <GradientBackdrop />이 캔버스 뒤로 비치도록.
      // (이전에는 solid fillRect로 테마 배경색을 칠해 그라데이션을 가렸음)
      ctx.clearRect(0, 0, w, h);

      // 다크모드에서만 노이즈 오버레이 적용 (중앙 그라데이션/마우스 글로우는 GradientBackdrop으로 분리됨)
      const isLight = useAppStore.getState().colorMode === 'light';
      if (!isLight) {
        if (noiseRef.current) ctx.drawImage(noiseRef.current, 0, 0);
      }

      // 커스텀 설정 읽기
      const cfg = plexusCfgRef.current;
      const cfgMouseR = cfg.mouseRadius;
      const cfgMouseF = cfg.mouseForce;
      const cfgSpeed = cfg.speed;
      const cfgConnDist = cfg.connectionDist;

      // 물리 업데이트 (가상 캔버스 좌표, delta-time 정규화)
      for (const p of particles) {
        const dmx = p.x - mx;
        const dmy = p.y - my;
        const distMouse = Math.sqrt(dmx * dmx + dmy * dmy);
        if (distMouse < cfgMouseR && distMouse > 1) {
          const force = (1 - distMouse / cfgMouseR) * cfgMouseF * p.z;
          p.vx += (dmx / distMouse) * force * dtFactor;
          p.vy += (dmy / distMouse) * force * dtFactor;
        }
        const damp = Math.pow(0.98, dtFactor);
        p.vx *= damp; p.vy *= damp;
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const minSpeed = p.baseSpeed * p.z * 0.15 * cfgSpeed;
        if (speed < minSpeed) {
          const angle = Math.atan2(p.vy, p.vx) || Math.random() * Math.PI * 2;
          p.vx = Math.cos(angle) * minSpeed;
          p.vy = Math.sin(angle) * minSpeed;
        }
        p.x += p.vx * cfgSpeed * dtFactor; p.y += p.vy * cfgSpeed * dtFactor;
        // 가상 캔버스 경계에서 래핑
        const margin = 50;
        if (p.x < -margin) p.x = VIRTUAL_W + margin;
        if (p.x > VIRTUAL_W + margin) p.x = -margin;
        if (p.y < -margin) p.y = VIRTUAL_H + margin;
        if (p.y > VIRTUAL_H + margin) p.y = -margin;
      }

      // 뷰포트 안에 보이는 파티클만 필터 (성능)
      const viewMargin = cfgConnDist + 60;
      const visible = particles.filter(
        (p) => p.x >= ox - viewMargin && p.x <= ox + w + viewMargin &&
               p.y >= oy - viewMargin && p.y <= oy + h + viewMargin,
      );
      const sorted = [...visible].sort((a, b) => a.z - b.z);

      // 연결선 렌더링 (화면 좌표 = 가상좌표 - 오프셋)
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i]; const b = sorted[j];
          const dx = a.x - b.x; const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const avgZ = (a.z + b.z) * 0.5;
          const scaledDist = cfgConnDist * avgZ;
          if (dist < scaledDist) {
            const lineAlpha = (1 - dist / scaledDist) * avgZ * 0.5;
            const midX = (a.x + b.x) * 0.5;
            const midY = (a.y + b.y) * 0.5;
            const dMid = Math.sqrt((midX - mx) ** 2 + (midY - my) ** 2);
            const glowBoost = dMid < cfgMouseR ? (1 - dMid / cfgMouseR) * 0.4 : 0;
            const aCol = palette[a.colorIdx % palette.length];
            const bCol = palette[b.colorIdx % palette.length];
            const r = Math.round((aCol[0] + bCol[0]) * 0.5);
            const g = Math.round((aCol[1] + bCol[1]) * 0.5);
            const bl = Math.round((aCol[2] + bCol[2]) * 0.5);
            ctx.beginPath();
            ctx.moveTo(a.x - ox, a.y - oy); ctx.lineTo(b.x - ox, b.y - oy);
            ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${Math.min(lineAlpha + glowBoost, 0.75)})`;
            ctx.lineWidth = avgZ * 1.5;
            ctx.stroke();
          }
        }
      }

      // 파티클 렌더링 (화면 좌표)
      const cfgGlow = cfg.glowIntensity;
      for (const p of sorted) {
        const alpha = 0.35 + p.z * 0.6;
        const [r, g, b] = palette[p.colorIdx % palette.length];
        const sx = p.x - ox; // 화면 x
        const sy = p.y - oy; // 화면 y
        const dmx2 = p.x - mx; const dmy2 = p.y - my;
        const distM = Math.sqrt(dmx2 * dmx2 + dmy2 * dmy2);
        const nearMouse = distM < cfgMouseR;
        const glowSize = nearMouse ? p.size + (1 - distM / cfgMouseR) * 4 * p.z : p.size;

        if (p.z < 0.4) {
          const blurSize = glowSize * (3 - p.z * 5) * cfgGlow;
          const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, blurSize);
          grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.5 * cfgGlow})`);
          grad.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${alpha * 0.15 * cfgGlow})`);
          grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(sx - blurSize, sy - blurSize, blurSize * 2, blurSize * 2);
        } else {
          if (nearMouse && cfgGlow > 0.2) {
            const haloSize = glowSize * 3 * cfgGlow;
            const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, haloSize);
            halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.3 * cfgGlow})`);
            halo.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, ${alpha * 0.08 * cfgGlow})`);
            halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
            ctx.fillStyle = halo;
            ctx.fillRect(sx - haloSize, sy - haloSize, haloSize * 2, haloSize * 2);
          }
          ctx.beginPath();
          ctx.arc(sx, sy, glowSize, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.fill();
          if (p.z > 0.7) {
            ctx.beginPath();
            ctx.arc(sx, sy, glowSize * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.4})`;
            ctx.fill();
          }
        }
      }
    };

    // 다음 프레임 예약은 루프가 맡는다(멈춤 상태면 이 한 장으로 끝).
    const loop = createFrameLoop(animate, loopOptions());
    loopRef.current = loop;
    return () => {
      loop.dispose();
      loopRef.current = null;
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouse);
    };
  }, [loginEnabled, particleCount]);

  if (!loginEnabled) return null;
  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />;
}

function LoginBackgroundArt() {
  const plexusSettings = useAppStore((s) => s.plexusSettings);
  const backgroundArt = plexusSettings.loginBackgroundArt ?? plexusSettings.backgroundArt;
  if (backgroundArt === 'starnest') {
    return (
      <StarNestBackground
        enabled={plexusSettings.loginEnabled}
        fixed={false}
        settings={plexusSettings.loginStarNest ?? plexusSettings.starNest}
      />
    );
  }
  if (backgroundArt === 'bflow-starnest') {
    return (
      <BflowStarNestBackground
        enabled={plexusSettings.loginEnabled}
        fixed={false}
        settings={plexusSettings.loginBflowStarNest ?? plexusSettings.bflowStarNest}
      />
    );
  }
  return <PlexusBackground />;
}

// ─── 드라마틱 텍스트 모핑 애니메이션 ───────────────────────────
// 시퀀스: "Be the flow." → "BAE the flow." → "B the flow." → "Bflow."
// "B"는 항상 고정, 서픽스("e"→"AE"→"")만 크로스페이드 모핑
// " the "는 연기처럼 사라지며 공간 수축
// layout 애니메이션 없이 명시적 트랜스폼으로 부드러운 모션 구현

type MorphStage = 0 | 1 | 2 | 3 | 4;

const STAGE_SUFFIX: string[] = ['e', 'AE', '', '', ''];

function HeroText({ onAnimationDone }: { onAnimationDone: () => void }) {
  const [stage, setStage] = useState<MorphStage>(0);
  const doneRef = useRef(false);
  const themeId = useAppStore((s) => s.themeId);
  const customColors = useAppStore((s) => s.customThemeColors);
  const { accentCss, accentSubCss } = useMemo(() => {
    const colors = customColors ?? getPreset(themeId)?.colors;
    const a = colors?.accent ?? '108 92 231';
    const s = colors?.accentSub ?? '162 155 254';
    const toRgb = (t: string) => t.split(' ').join(',');
    return { accentCss: toRgb(a), accentSubCss: toRgb(s) };
  }, [themeId, customColors]);

  // ── 서픽스/the 너비 측정 ──
  const measureRef = useRef<HTMLSpanElement>(null);
  const theInnerRef = useRef<HTMLSpanElement>(null);
  const [suffixW, setSuffixW] = useState<Record<string, number>>({ e: 0, AE: 0, '': 0 });
  const [theW, setTheW] = useState(0);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const w: Record<string, number> = {};
    for (const s of ['e', 'AE']) {
      el.textContent = s;
      w[s] = el.getBoundingClientRect().width;
    }
    w[''] = 0;
    setSuffixW(w);
    if (theInnerRef.current) {
      setTheW(theInnerRef.current.getBoundingClientRect().width);
    }
  }, []);

  // ── 스테이지 타이머 — 여유로운 간격 ──
  useEffect(() => {
    const timers = [
      setTimeout(() => setStage(1), 2000),   // Be → BAE
      setTimeout(() => setStage(2), 3400),   // BAE → B
      setTimeout(() => setStage(3), 4600),   // " the " 사라짐 → "Bflow."
      setTimeout(() => {
        setStage(4);                         // 서브타이틀 등장
        if (!doneRef.current) { doneRef.current = true; onAnimationDone(); }
      }, 6200),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onAnimationDone]);

  const suffix = STAGE_SUFFIX[stage];
  const showThe = stage < 3;
  const showSub = stage >= 4;

  return (
    <div className="flex flex-col items-center z-10 relative">
      {/* 숨겨진 측정용 스팬 */}
      <span
        ref={measureRef}
        className="absolute invisible pointer-events-none text-5xl md:text-7xl font-bold tracking-tight"
        aria-hidden="true"
      />

      {/* h1 래퍼 — 서브타이틀 등장 시 위로 부드럽게 이동 (layout 대신 명시적 y) */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: showSub ? -24 : 0 }}
        transition={{
          opacity: { duration: 1.2, ease: [0.16, 1, 0.3, 1] },
          y: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
        }}
      >
        <h1 className="flex items-baseline text-5xl md:text-7xl font-bold tracking-tight">
          {/* "B" — 항상 고정, 그래디언트 + 빛나는 글로우.
              숨쉬는 빛은 겹친 빛 층의 opacity 만 바꾼다(합성 스레드) — 대시보드를 뒤에서 미리 그리는 동안에도 멈칫하지 않게.
              (예전: filter 를 매 프레임 메인 스레드에서 바꿔 다시 칠함) */}
          <span className="relative inline-block">
            <span
              className="inline-block bg-gradient-to-br from-accent via-accent-sub to-[#74B9FF] bg-clip-text text-transparent"
              style={{ filter: `drop-shadow(0 0 10px rgba(${accentCss},0.6)) drop-shadow(0 0 25px rgba(${accentCss},0.3)) drop-shadow(0 0 50px rgba(${accentSubCss},0.15))` }}
            >
              B
            </span>
            <span
              aria-hidden="true"
              className="bf-entry-glow pointer-events-none absolute inset-0 text-transparent"
              style={{ textShadow: `0 0 16px rgba(${accentCss},0.55), 0 0 40px rgba(${accentCss},0.3), 0 0 70px rgba(${accentSubCss},0.15)` }}
            >
              B
            </span>
          </span>

          {/* 서픽스 컨테이너 — inline-grid로 baseline 정렬 유지 + 크로스페이드 */}
          <motion.span
            initial={false}
            animate={{ width: suffixW[suffix] ?? 0 }}
            transition={{ type: 'spring', stiffness: 170, damping: 22 }}
            className="inline-grid overflow-hidden align-baseline"
          >
            <AnimatePresence>
              {suffix && (
                <motion.span
                  key={suffix}
                  initial={{ opacity: 0, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, filter: 'blur(10px)' }}
                  transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
                  className="bg-gradient-to-br from-accent via-accent-sub to-[#74B9FF] bg-clip-text text-transparent whitespace-nowrap"
                  style={{ gridArea: '1 / 1' }}
                >
                  {suffix}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.span>

          {/* " the " — 연기처럼 사라지며 공간 수축 */}
          <motion.span
            initial={false}
            animate={{
              width: showThe ? theW : 0,
              opacity: showThe ? 1 : 0,
              filter: showThe ? 'blur(0px)' : 'blur(16px)',
            }}
            transition={{
              width: { type: 'spring', stiffness: 130, damping: 20, delay: showThe ? 0 : 0.25 },
              opacity: { duration: 0.9, ease: [0.4, 0, 0.2, 1] },
              filter: { duration: 0.9, ease: [0.4, 0, 0.2, 1] },
            }}
            className="inline-block overflow-hidden whitespace-nowrap text-text-primary"
          >
            <span ref={theInnerRef}>{'\u00A0the\u00A0'}</span>
          </motion.span>

          {/* "flow." — 항상 고정, 공백 없음 */}
          <span className="inline-block text-text-primary">flow.</span>
        </h1>
      </motion.div>

      {/* ── 서브타이틀 + 디바이더 — 가운데에서 자연스럽게 등장 ── */}
      <AnimatePresence>
        {showSub && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
            className="flex flex-col items-center gap-4 mt-6"
          >
            <p className="text-base md:text-lg text-text-secondary/70 font-light tracking-wide">
              Your workflow, but better. That&apos;s the <span className="text-accent font-medium">B</span>.
            </p>
            <div className="h-px w-24 bg-gradient-to-r from-transparent via-accent to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 클릭 투 컨티뉴 ────────────────────────────────────────────

function ClickPrompt({ exiting = false }: { exiting?: boolean }) {
  const themeId = useAppStore((s) => s.themeId);
  const customColors = useAppStore((s) => s.customThemeColors);
  const { aCss, sCss } = useMemo(() => {
    const colors = customColors ?? getPreset(themeId)?.colors;
    const a = colors?.accent ?? '108 92 231';
    const s = colors?.accentSub ?? '162 155 254';
    return { aCss: a.split(' ').join(','), sCss: s.split(' ').join(',') };
  }, [themeId, customColors]);

  // 숨쉬는 빛·화살표 흔들림은 CSS(opacity·transform, 합성 스레드)로 — 대시보드를 뒤에서 미리 그리는 동안
  // 메인 스레드가 바빠도 멈칫하지 않는다(예전: textShadow 를 매 프레임 메인 스레드에서 바꿔 다시 칠함).
  // 클릭하면(exiting) 'Bflow.' 글자와 같은 박자로 지연 없이 떠오르며 흐려진다.
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.2, delay: 0 } }}
      transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className={cn('absolute bottom-20 left-0 right-0 flex justify-center z-10', exiting && 'bf-entry-text-exit')}
    >
      <div className="bf-entry-breathe relative flex items-center gap-2 text-sm text-accent tracking-[0.2em] uppercase font-light">
        <span className="relative">
          <span style={{ textShadow: `0 0 8px rgba(${aCss},0.4), 0 0 24px rgba(${aCss},0.15)` }}>click anywhere to continue</span>
          <span
            aria-hidden="true"
            className="bf-entry-glow pointer-events-none absolute inset-0 text-transparent"
            style={{ textShadow: `0 0 16px rgba(${aCss},0.7), 0 0 48px rgba(${aCss},0.3), 0 0 80px rgba(${sCss},0.15)` }}
          >
            click anywhere to continue
          </span>
        </span>
        <span className="bf-entry-nudge">
          <ChevronRight size={14} />
        </span>
      </div>
    </motion.div>
  );
}

// ─── 푸터 ─────────────────────────────────────────────────────

function Footer() {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.8, duration: 0.6 }}
      className="absolute bottom-6 left-0 right-0 text-center z-10"
    >
      <p className="text-[11px] text-text-secondary/50 tracking-[0.2em] uppercase">
        Born in JBBJ &middot; Built for every studio
      </p>
    </motion.footer>
  );
}

// ─── 로그인 폼 (글래스모피즘) ─────────────────────────────────

function LoginForm({ onLogin, restoreError }: { onLogin: (name: string, pw: string, rememberMe: boolean) => Promise<string | null>; restoreError?: string }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const colorMode = useAppStore((s) => s.colorMode);
  const isLight = colorMode === 'light';
  const capsLock = useCapsLockWarning();

  useEffect(() => {
    const timer = setTimeout(() => nameRef.current?.focus(), 400);
    return () => clearTimeout(timer);
  }, []);

  // 저장된 rememberMe 설정 로드
  useEffect(() => {
    import('@/services/settingsService').then(({ loadPreferences }) => {
      loadPreferences().then((prefs) => {
        if (prefs?.rememberMe !== undefined) setRememberMe(prefs.rememberMe!);
      });
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('이름을 입력해주세요.'); return; }
    if (!password) { setError('비밀번호를 입력해주세요.'); return; }
    setLoading(true);
    setError('');
    const err = await onLogin(name.trim(), password, rememberMe);
    // 성공하면 카드가 떠오르며 사라지는 동안 '로그인 중...' 을 그대로 둔다(버튼 글자가 깜빡 바뀌지 않게).
    if (!err) return;
    setLoading(false);
    setError(err);
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="relative w-80 rounded-2xl p-8 flex flex-col gap-5 z-10"
      style={{
        background: isLight ? 'rgba(255, 255, 255, 0.75)' : 'rgba(26, 29, 39, 0.6)',
        backdropFilter: 'blur(24px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
        border: `1px solid rgb(var(--color-accent) / 0.15)`,
        boxShadow: isLight
          ? '0 32px 64px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0,0,0,0.04) inset, 0 0 80px rgb(var(--color-accent) / 0.06)'
          : '0 32px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 80px rgba(108, 92, 231, 0.06)',
      }}
    >
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ background: isLight ? 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, transparent 50%)' : 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 50%)' }}
      />

      <div className="text-center relative">
        <h2 className="text-xl font-semibold tracking-tight">
          <span className="bg-gradient-to-r from-accent to-accent-sub bg-clip-text text-transparent">B</span>
          <span className="text-text-primary"> flow</span>
        </h2>
        <p className="text-sm text-text-secondary/60 mt-1.5 tracking-wide">sign in to continue</p>
      </div>

      <div className="flex flex-col gap-1.5 relative">
        <label className="text-xs text-text-secondary/70 uppercase tracking-wider">Name</label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="사용자 이름"
          className={cn(
            'rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/50 transition-all duration-200',
            isLight
              ? 'bg-black/[0.04] border border-black/[0.1] focus:bg-black/[0.06]'
              : 'bg-white/[0.04] border border-white/[0.08] focus:bg-white/[0.06]',
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5 relative">
        <label className="text-xs text-text-secondary/70 uppercase tracking-wider">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={capsLock.onKeyDown}
          onKeyUp={capsLock.onKeyUp}
          placeholder="비밀번호 입력"
          className={cn(
            'rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/50 transition-all duration-200',
            isLight
              ? 'bg-black/[0.04] border border-black/[0.1] focus:bg-black/[0.06]'
              : 'bg-white/[0.04] border border-white/[0.08] focus:bg-white/[0.06]',
          )}
        />
        {capsLock.isCapsLockOn && (
          <div className="mt-1 text-[11px] text-amber-400 flex items-center gap-1">
            <AlertTriangle size={12} />
            Caps Lock이 켜져 있습니다
          </div>
        )}
        <p className="text-[11px] text-text-secondary/60 leading-relaxed">
          최초 비밀번호는 1234<br />
          모르겠으면 배씨에게 문의
        </p>
      </div>

      {/* 로그인 유지 체크박스 */}
      <label className="flex items-center gap-2.5 cursor-pointer relative">
        <input
          type="checkbox"
          checked={rememberMe}
          onChange={(e) => {
            const v = e.target.checked;
            setRememberMe(v);
            import('@/services/settingsService').then(({ loadPreferences, savePreferences }) => {
              loadPreferences().then((prefs) => savePreferences({ ...(prefs ?? {}), rememberMe: v }));
            });
          }}
          className="sr-only peer"
        />
        <div className={cn(
          'w-4 h-4 rounded border flex items-center justify-center transition-all',
          rememberMe
            ? 'bg-accent border-accent'
            : isLight ? 'border-black/20 bg-black/5' : 'border-white/20 bg-white/5',
        )}>
          {rememberMe && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-white">
              <path d="M2 5L4.5 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
        <span className={cn('text-xs', isLight ? 'text-black/50' : 'text-text-secondary/60')}>로그인 유지</span>
      </label>

      <AnimatePresence>
        {(error || (!loading && restoreError)) && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="text-xs text-status-none text-center"
          >
            {error || restoreError}
          </motion.p>
        )}
      </AnimatePresence>

      <button
        type="submit"
        disabled={loading}
        className="relative flex items-center justify-center gap-2 text-on-accent text-sm font-medium rounded-xl px-4 py-3 cursor-pointer overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-accent/25 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, rgb(var(--color-accent)) 0%, rgb(var(--color-accent-sub)) 100%)' }}
      >
        <LogIn size={15} />
        {loading ? '로그인 중...' : '로그인'}
      </button>
    </motion.form>
  );
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────

interface LoginScreenProps {
  mode?: 'login' | 'splash';
  /** 덮개가 다 걷혔다(첫 진입 연출 끝). 앱은 이때 덮개를 내린다. */
  onComplete?: () => void;
  restoreError?: string;
  /**
   * 덮개 아래에 메인 화면을 미리 그려 달라(움직임 폴리싱 13번).
   * 'Bflow.' 글자가 다 나온 뒤 클릭을 기다리는 동안(ready), 클릭한 순간, 로그인에 성공한 순간에 부른다.
   */
  onPrimeMain?: () => void;
}

/**
 * landing: 'Be the flow.' → 'Bflow.' 글자 연출 / ready: 클릭 대기 / transition: (로그인 모드) 글자 → 로그인 카드
 * login: 로그인 카드 / exit: 첫 진입 — 글자(또는 카드)가 떠오르며 흐려지고 덮개가 걷힌다.
 */
type Phase = 'landing' | 'ready' | 'transition' | 'login' | 'exit';

function isLocalBrowserPreview(): boolean {
  return document.documentElement.dataset.devElectronApi === 'installed';
}

function isCodexBrowserPreview(): boolean {
  return isLocalBrowserPreview() && new URLSearchParams(window.location.search).has('codex');
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * 로그인/첫 화면 덮개 (z-[9998], 불투명).
 *
 * 움직임 폴리싱 13번 — 아침 첫 진입:
 * - 'Bflow.' 글자가 다 나와 클릭을 기다리는 동안 앱이 이 덮개 아래에 대시보드를 미리 그린다(onPrimeMain).
 * - 클릭(로그인 모드는 로그인 성공)하는 즉시 글자·안내 문구가 위로 떠오르며 흐려지고(300ms),
 *   150ms 뒤 — 그리고 대시보드가 그려진 뒤 — 덮개가 350ms 동안 걷힌다. 걷히기 시작하는 순간
 *   html[data-entry-curtain='lifting'] 이 되어 멈춰 있던 위젯 등장·차오름이 흐른다(CSS).
 * - 다 걷히면 onComplete — 앱이 덮개를 내리고 인사 말풍선을 띄운다.
 * 이 컴포넌트 본문에서는 useLayoutEffect·외부 훅을 쓰지 않는다(tests/loginUpdateEntry.test.ts 가 함수로 직접 부른다).
 */
export function LoginScreen({ mode = 'login', onComplete, restoreError, onPrimeMain }: LoginScreenProps) {
  const { currentUser, setCurrentUser } = useAuthStore();
  const updateInfo = useAppStore((s) => s.updateInfo);
  const setUpdateCenterOpen = useAppStore((s) => s.setUpdateCenterOpen);
  const gradientEnabled = useAppStore((s) => s.plexusSettings?.globalGradientEnabled !== false);
  const hasRemoteUpdate = Boolean(
    updateInfo
    && updateInfo.latestVersion !== updateInfo.currentVersion
    && updateInfo.status !== 'suppressed'
    && updateInfo.status !== 'up-to-date',
  );
  const hasUpdateIssue = updateInfo?.status === 'failed' || updateInfo?.status === 'suppressed';
  const [phase, setPhase] = useState<Phase>(() => (
    mode === 'login' && isLocalBrowserPreview() ? 'login' : 'landing'
  ));
  const [exitFrom, setExitFrom] = useState<'hero' | 'form'>('hero');
  const [lifting, setLifting] = useState(false);
  const exitStartRef = useRef(0);
  const completedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 걷던 덮개를 되돌린 횟수 — 로그인 카드를 새로 붙여 '로그인 중...' 에 멈춘 카드를 다시 쓰지 않는다. */
  const formRoundRef = useRef(0);

  // 첫 진입: 글자(또는 로그인 카드)를 떠오르게 하고 덮개를 걷을 준비를 한다.
  const beginExit = useCallback((from: 'hero' | 'form') => {
    exitStartRef.current = nowMs();
    setExitFrom(from);
    setPhase('exit');
  }, []);

  useEffect(() => {
    if (mode !== 'login' || !isCodexBrowserPreview()) return;
    let cancelled = false;
    void login('배한솔', '1234', true).then((result) => {
      if (cancelled || !result.ok || !result.user) return;
      setCurrentUser(result.user);
    });
    return () => { cancelled = true; };
  }, [mode, setCurrentUser]);

  // 로그인 모드에서 사용자가 들어왔다(로그인 성공) — 카드(또는 글자)가 떠오르며 사라지고 덮개를 걷는다.
  // 앱은 이 덮개를 그대로 둔 채 아래에 메인 화면을 그린다(onPrimeMain).
  useEffect(() => {
    if (mode !== 'login' || !currentUser || phase === 'exit') return;
    beginExit(phase === 'login' ? 'form' : 'hero');
  }, [mode, currentUser, phase, beginExit]);

  // 덮개가 걷히는 도중(또는 다 걷힌 직후) 사용자가 사라졌다(관리자가 그 계정을 지움 등).
  // 비로그인 화면이 이 덮개를 같은 자리에서 이어 쓰므로, 걷던 덮개를 되돌리고 로그인 카드를 다시 보인다
  // — 안 그러면 투명해진 덮개만 남아 로그인할 길이 없다.
  useEffect(() => {
    if (mode !== 'login' || currentUser || phase !== 'exit') return;
    formRoundRef.current += 1;
    completedRef.current = false;
    rootRef.current?.classList.remove('bf-entry-curtain-lift');
    entryCurtain.set('down');
    setLifting(false);
    setPhase('login');
  }, [mode, currentUser, phase]);

  // 덮개가 떠 있는 동안 html[data-entry-curtain] — 아래에 미리 그린 대시보드의 등장 연출을 멈춰 둔다.
  useEffect(() => {
    entryCurtain.set('down');
    return () => entryCurtain.set(null);
  }, []);

  // 클릭을 기다리는 동안(ready)과 클릭·로그인한 순간(exit) 메인 화면을 덮개 아래에 미리 그린다.
  useEffect(() => {
    if (phase === 'exit' || (mode === 'splash' && phase === 'ready')) onPrimeMain?.();
  }, [mode, phase, onPrimeMain]);

  // 덮개 걷기: 클릭 뒤 150ms 가 지나고, 첫 화면이 대시보드면 그것이 그려진 뒤에.
  useEffect(() => {
    if (phase !== 'exit' || lifting) return;
    const reduce = prefersReducedMotion();
    const minDelayMs = reduce ? 0 : ENTRY_CURTAIN_DELAY_MS;
    const startedAt = exitStartRef.current;
    let settled = false;
    const timers: number[] = [];
    let unsubscribe = () => {};
    const check = () => {
      if (settled) return;
      const elapsedMs = nowMs() - startedAt;
      // 타이머는 performance.now 기준보다 조금 일찍 불릴 수 있다 — 모자란 만큼 다시 잡는다(안 그러면 최대 대기까지 멈춤).
      if (elapsedMs < minDelayMs) {
        timers.push(window.setTimeout(check, minDelayMs - elapsedMs + 1));
        return;
      }
      const waitForView = useAppStore.getState().currentView === 'dashboard';
      if (!canLiftEntryCurtain({ elapsedMs, minDelayMs, viewReady: entryCurtain.viewReady, waitForView })) return;
      settled = true;
      unsubscribe();
      // 덮개 걷힘(클래스)과 위젯 등장(html 속성)을 같은 순간 DOM 에 적어 같은 프레임에 출발시킨다.
      // React 의 다시 그리기를 기다리면 바쁜 PC 에서 그 사이 가려진 위젯이 먼저 흐르기 시작한다(cpu 4배 실측 130ms).
      // className 에도 같은 클래스가 들어가므로(lifting) React 가 다시 그려도 그대로 남는다.
      rootRef.current?.classList.add('bf-entry-curtain-lift');
      entryCurtain.set('lifting');
      setLifting(true);
    };
    unsubscribe = entryCurtain.subscribe(check);
    timers.push(window.setTimeout(check, Math.max(0, ENTRY_VIEW_WAIT_MAX_MS - (nowMs() - startedAt))));
    check();
    return () => {
      settled = true;
      unsubscribe();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [phase, lifting]);

  const complete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete?.();
  }, [onComplete]);

  // animationend 가 오지 않는 경우(창이 가려져 있었음 등)를 위한 안전장치.
  useEffect(() => {
    if (!lifting) return;
    const timer = window.setTimeout(complete, ENTRY_CURTAIN_MS + 300);
    return () => window.clearTimeout(timer);
  }, [lifting, complete]);

  // 텍스트 애니메이션 완료 콜백 — 글자 연출 도중 클릭해 이미 넘어갔으면 그대로 둔다.
  const handleAnimationDone = useCallback(() => {
    setPhase((current) => (current === 'landing' ? 'ready' : current));
  }, []);

  // 클릭으로 넘어가기
  // - 첫 화면(splash): 글자 연출 도중이든 다 나온 뒤든 바로 첫 진입(덮개 걷기)
  // - 로그인 모드: landing 이면 즉시 스킵, ready 면 트랜지션 → 로그인 카드
  const handleClick = useCallback(() => {
    if (phase === 'exit') return;
    if (mode === 'splash') {
      if (phase === 'landing' || phase === 'ready') beginExit('hero');
      return;
    }
    if (phase === 'landing') {
      // 애니메이션 스킵 → 즉시 트랜지션
      setPhase('transition');
      setTimeout(() => setPhase((current) => (current === 'transition' ? 'login' : current)), 300);
      return;
    }
    if (phase !== 'ready') return;
    setPhase('transition');
    setTimeout(() => setPhase((current) => (current === 'transition' ? 'login' : current)), 500);
  }, [phase, mode, beginExit]);

  const handleLogin = useCallback(async (name: string, password: string, rememberMe: boolean): Promise<string | null> => {
    const result = await login(name, password, rememberMe);
    if (result.ok && result.user) {
      // 덮개는 그대로 남아(카드만 떠오르며 사라짐) 앱이 아래에 메인 화면을 그린 뒤 걷힌다 — 위 사용자 효과.
      setCurrentUser(result.user);
      return null;
    }
    return result.error ?? '로그인에 실패했습니다.';
  }, [setCurrentUser]);

  const exiting = phase === 'exit';
  const heroVisible = phase === 'landing' || phase === 'ready' || phase === 'transition' || (exiting && exitFrom === 'hero');
  const formVisible = phase === 'login' || (exiting && exitFrom === 'form');

  return (
    <div
      ref={rootRef}
      className={cn(
        'fixed inset-0 flex flex-col items-center justify-center overflow-hidden select-none z-[9998] bg-bg-primary',
        exiting ? 'cursor-default' : 'cursor-pointer',
        lifting && 'bf-entry-curtain-lift',
      )}
      // 불투명 덮개: 첫 화면을 보는 동안 아래에 메인 화면을 미리 그려 두므로 비치지 않게 바탕을 칠한다.
      // 그라데이션은 전역 GradientBackdrop 과 같은 것을 덮개 안에 한 번 더 깐다(z -1 — 덮개 바탕 위, 내용 아래).
      // 플렉서스 canvas(PlexusBackground)가 ON일 때는 canvas 가 그 위를 덮음.
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && e.animationName === 'bf-entry-curtain-out') complete();
      }}
      tabIndex={-1}
    >
      <GradientBackdrop intensity="normal" enabled={gradientEnabled} />
      <LoginBackgroundArt />

      <AnimatePresence mode="wait">
        {heroVisible && (
          <motion.div
            key="hero"
            exit={{ opacity: 0, y: -30, scale: 0.98, filter: 'blur(6px)' }}
            transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
            className={cn('flex flex-col items-center', exiting && 'bf-entry-text-exit')}
          >
            <HeroText onAnimationDone={handleAnimationDone} />
          </motion.div>
        )}

        {formVisible && (
          <motion.div
            key={`login-${formRoundRef.current}`}
            className={cn('flex flex-col items-center cursor-default', exiting && 'bf-entry-text-exit')}
            onClick={(e) => e.stopPropagation()}
          >
            <LoginForm onLogin={handleLogin} restoreError={restoreError} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 클릭 프롬프트 — ready 상태에서 표시, 첫 진입(exit)에서는 글자와 함께 떠오르며 흐려진다 */}
      <AnimatePresence>
        {(phase === 'ready' || (exiting && exitFrom === 'hero')) && <ClickPrompt exiting={exiting} />}
      </AnimatePresence>

      {mode === 'login' && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setUpdateCenterOpen(true);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(
            'absolute bottom-6 left-6 z-20 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-[11px] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
            hasUpdateIssue
              ? 'text-[#FDCB6E] bg-[#FDCB6E]/10 border-[#FDCB6E]/25 hover:bg-[#FDCB6E]/15'
              : hasRemoteUpdate
                ? 'text-accent-sub bg-accent/10 border-accent/25 hover:bg-accent/18 hover:border-accent/40'
                : 'text-text-secondary/70 border-bg-border/40 hover:text-text-primary hover:bg-bg-border/35',
          )}
          aria-label={`현재 버전 v${__APP_VERSION__} · 업데이트 내역 열기`}
        >
          <span className="font-mono tabular-nums">v{__APP_VERSION__}</span>
          <span>업데이트 내역</span>
          {hasRemoteUpdate && (
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#FDCB6E]" />
          )}
        </button>
      )}

      <Footer />
    </div>
  );
}
