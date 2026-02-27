import { useState, useCallback, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, ChevronRight } from 'lucide-react';
import { login } from '@/services/userService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { getPreset } from '@/themes';
import { cn } from '@/utils/cn';

// ─── 플렉서스 배경 (Canvas 2D, Z축 깊이감, 마우스 인터랙션) ─────

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  baseSpeed: number;
  size: number;
  color: [number, number, number];
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
  if (!colors) return [[108, 92, 231], [162, 155, 254], [116, 185, 255], [0, 184, 148], [85, 239, 196]];
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
  const color = cols[Math.floor(Math.random() * cols.length)];
  const baseSpeed = 0.12 + Math.random() * 0.35;
  return {
    x: Math.random() * VIRTUAL_W, y: Math.random() * VIRTUAL_H, z,
    vx: (Math.random() - 0.5) * baseSpeed * z,
    vy: (Math.random() - 0.5) * baseSpeed * z,
    baseSpeed, size: 1.2 + z * 3, color,
  };
}

function PlexusBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const noiseRef = useRef<HTMLCanvasElement | null>(null);

  const plexusSettings = useAppStore((s) => s.plexusSettings);
  const loginEnabled = plexusSettings.loginEnabled;
  const particleCount = plexusSettings.loginParticleCount || DEFAULT_LOGIN_PARTICLE_COUNT;

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
    const ctx = canvas.getContext('2d', { alpha: false });
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
    };

    resize();
    window.addEventListener('resize', resize);

    const onMouse = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMouse, { passive: true });

    let running = true;
    const animate = () => {
      if (!running) return;
      const { w, h } = sizeRef.current;
      const particles = particlesRef.current;

      // 뷰포트 오프셋: 가상 캔버스 중앙에 창을 배치
      const ox = (VIRTUAL_W - w) / 2;
      const oy = (VIRTUAL_H - h) / 2;
      // 마우스를 가상 캔버스 좌표로 변환
      const mx = mouseRef.current.x + ox;
      const my = mouseRef.current.y + oy;

      const isLight = useAppStore.getState().colorMode === 'light';
      ctx.fillStyle = isLight ? '#ECEDF2' : '#12141C';
      ctx.fillRect(0, 0, w, h);

      const tc = getPlexusColors()[0];
      const ts = getPlexusColors()[2] ?? getPlexusColors()[1];

      // 다크모드에서만 중앙 그라데이션 + 마우스 글로우 + 노이즈 오버레이 적용
      if (!isLight) {
        const cg = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, w * 0.7);
        cg.addColorStop(0, `rgba(${tc[0]}, ${tc[1]}, ${tc[2]}, 0.06)`);
        cg.addColorStop(0.3, `rgba(${tc[0]}, ${tc[1]}, ${tc[2]}, 0.03)`);
        cg.addColorStop(0.6, `rgba(${ts[0]}, ${ts[1]}, ${ts[2]}, 0.015)`);
        cg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = cg;
        ctx.fillRect(0, 0, w, h);

        if (mouseRef.current.x > 0 && mouseRef.current.y > 0) {
          const mg = ctx.createRadialGradient(mouseRef.current.x, mouseRef.current.y, 0, mouseRef.current.x, mouseRef.current.y, 250);
          mg.addColorStop(0, `rgba(${tc[0]}, ${tc[1]}, ${tc[2]}, 0.08)`);
          mg.addColorStop(0.4, `rgba(${tc[0]}, ${tc[1]}, ${tc[2]}, 0.03)`);
          mg.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = mg;
          ctx.fillRect(0, 0, w, h);
        }

        if (noiseRef.current) ctx.drawImage(noiseRef.current, 0, 0);
      }

      // 커스텀 설정 읽기
      const cfg = plexusCfgRef.current;
      const cfgMouseR = cfg.mouseRadius;
      const cfgMouseF = cfg.mouseForce;
      const cfgSpeed = cfg.speed;
      const cfgConnDist = cfg.connectionDist;

      // 물리 업데이트 (가상 캔버스 좌표)
      for (const p of particles) {
        const dmx = p.x - mx;
        const dmy = p.y - my;
        const distMouse = Math.sqrt(dmx * dmx + dmy * dmy);
        if (distMouse < cfgMouseR && distMouse > 1) {
          const force = (1 - distMouse / cfgMouseR) * cfgMouseF * p.z;
          p.vx += (dmx / distMouse) * force;
          p.vy += (dmy / distMouse) * force;
        }
        p.vx *= 0.98; p.vy *= 0.98;
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const minSpeed = p.baseSpeed * p.z * 0.15 * cfgSpeed;
        if (speed < minSpeed) {
          const angle = Math.atan2(p.vy, p.vx) || Math.random() * Math.PI * 2;
          p.vx = Math.cos(angle) * minSpeed;
          p.vy = Math.sin(angle) * minSpeed;
        }
        p.x += p.vx * cfgSpeed; p.y += p.vy * cfgSpeed;
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
            const r = Math.round((a.color[0] + b.color[0]) * 0.5);
            const g = Math.round((a.color[1] + b.color[1]) * 0.5);
            const bl = Math.round((a.color[2] + b.color[2]) * 0.5);
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
        const [r, g, b] = p.color;
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
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouse);
    };
  }, [loginEnabled, particleCount]);

  if (!loginEnabled) return null;
  return <canvas ref={canvasRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />;
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
          {/* "B" — 항상 고정, 그래디언트 + 빛나는 글로우 */}
          <motion.span
            animate={{
              filter: [
                `drop-shadow(0 0 10px rgba(${accentCss},0.6)) drop-shadow(0 0 25px rgba(${accentCss},0.3)) drop-shadow(0 0 50px rgba(${accentSubCss},0.15))`,
                `drop-shadow(0 0 16px rgba(${accentCss},0.8)) drop-shadow(0 0 40px rgba(${accentCss},0.45)) drop-shadow(0 0 70px rgba(${accentSubCss},0.2))`,
                `drop-shadow(0 0 10px rgba(${accentCss},0.6)) drop-shadow(0 0 25px rgba(${accentCss},0.3)) drop-shadow(0 0 50px rgba(${accentSubCss},0.15))`,
              ],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="inline-block bg-gradient-to-br from-accent via-accent-sub to-[#74B9FF] bg-clip-text text-transparent"
          >
            B
          </motion.span>

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

function ClickPrompt() {
  const themeId = useAppStore((s) => s.themeId);
  const customColors = useAppStore((s) => s.customThemeColors);
  const { aCss, sCss } = useMemo(() => {
    const colors = customColors ?? getPreset(themeId)?.colors;
    const a = colors?.accent ?? '108 92 231';
    const s = colors?.accentSub ?? '162 155 254';
    return { aCss: a.split(' ').join(','), sCss: s.split(' ').join(',') };
  }, [themeId, customColors]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: 0.4, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="absolute bottom-20 left-0 right-0 flex justify-center z-10"
    >
      <motion.div
        animate={{
          opacity: [0.7, 1, 0.7],
          textShadow: [
            `0 0 8px rgba(${aCss},0.4), 0 0 24px rgba(${aCss},0.15)`,
            `0 0 16px rgba(${aCss},0.7), 0 0 48px rgba(${aCss},0.3), 0 0 80px rgba(${sCss},0.15)`,
            `0 0 8px rgba(${aCss},0.4), 0 0 24px rgba(${aCss},0.15)`,
          ],
        }}
        transition={{ duration: 3.0, repeat: Infinity, ease: 'easeInOut' }}
        className="flex items-center gap-2 text-sm text-accent tracking-[0.2em] uppercase font-light"
      >
        click anywhere to continue
        <motion.span
          animate={{ x: [0, 5, 0] }}
          transition={{ duration: 2.0, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronRight size={14} />
        </motion.span>
      </motion.div>
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

function LoginForm({ onLogin }: { onLogin: (name: string, pw: string, rememberMe: boolean) => Promise<string | null> }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);
  const colorMode = useAppStore((s) => s.colorMode);
  const isLight = colorMode === 'light';

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
    setLoading(false);
    if (err) setError(err);
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
          placeholder="비밀번호 입력"
          className={cn(
            'rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/50 transition-all duration-200',
            isLight
              ? 'bg-black/[0.04] border border-black/[0.1] focus:bg-black/[0.06]'
              : 'bg-white/[0.04] border border-white/[0.08] focus:bg-white/[0.06]',
          )}
        />
        <p className="text-[11px] text-text-secondary/60">최초 비밀번호는 1234</p>
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
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="text-xs text-status-none text-center"
          >
            {error}
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
  onComplete?: () => void;
}

type Phase = 'landing' | 'ready' | 'transition' | 'login' | 'done';

export function LoginScreen({ mode = 'login', onComplete }: LoginScreenProps) {
  const { setCurrentUser } = useAuthStore();
  const [phase, setPhase] = useState<Phase>('landing');

  // 텍스트 애니메이션 완료 콜백
  const handleAnimationDone = useCallback(() => {
    setPhase('ready');
  }, []);

  // 클릭으로 넘어가기 (landing 중이면 즉시 스킵, ready 면 트랜지션)
  const handleClick = useCallback(() => {
    if (phase === 'landing') {
      // 애니메이션 스킵 → 즉시 트랜지션
      setPhase('transition');
      setTimeout(() => {
        if (mode === 'splash') {
          setPhase('done');
          onComplete?.();
        } else {
          setPhase('login');
        }
      }, 300);
      return;
    }
    if (phase !== 'ready') return;
    setPhase('transition');
    setTimeout(() => {
      if (mode === 'splash') {
        setPhase('done');
        onComplete?.();
      } else {
        setPhase('login');
      }
    }, 500);
  }, [phase, mode, onComplete]);

  const handleLogin = useCallback(async (name: string, password: string, rememberMe: boolean): Promise<string | null> => {
    const result = await login(name, password, rememberMe);
    if (result.ok && result.user) {
      setCurrentUser(result.user);
      return null;
    }
    return result.error ?? '로그인에 실패했습니다.';
  }, [setCurrentUser]);

  if (phase === 'done') return null;

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden select-none z-[9998] cursor-pointer"
      style={{ background: 'rgb(var(--color-bg-primary))' }}
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
      tabIndex={-1}
    >
      <PlexusBackground />

      <AnimatePresence mode="wait">
        {(phase === 'landing' || phase === 'ready' || phase === 'transition') && (
          <motion.div
            key="hero"
            exit={{ opacity: 0, y: -30, scale: 0.98, filter: 'blur(6px)' }}
            transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col items-center"
          >
            <HeroText onAnimationDone={handleAnimationDone} />
          </motion.div>
        )}

        {phase === 'login' && (
          <motion.div
            key="login"
            className="flex flex-col items-center cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <LoginForm onLogin={handleLogin} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 클릭 프롬프트 — ready 상태에서만 표시 */}
      <AnimatePresence>
        {phase === 'ready' && <ClickPrompt />}
      </AnimatePresence>

      <Footer />
    </div>
  );
}
