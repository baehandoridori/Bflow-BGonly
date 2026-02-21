import { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn, ChevronRight } from 'lucide-react';
import { login } from '@/services/userService';
import { useAuthStore } from '@/stores/useAuthStore';

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

const PLEXUS_COLORS: [number, number, number][] = [
  [108, 92, 231], [162, 155, 254], [116, 185, 255], [0, 184, 148], [85, 239, 196],
];

const PARTICLE_COUNT = 90;
const CONNECTION_DIST = 180;
const MOUSE_RADIUS = 200;
const MOUSE_FORCE = 0.04;

function createParticle(w: number, h: number): Particle {
  const z = 0.15 + Math.random() * 0.85;
  const color = PLEXUS_COLORS[Math.floor(Math.random() * PLEXUS_COLORS.length)];
  const baseSpeed = 0.15 + Math.random() * 0.3;
  return {
    x: Math.random() * w, y: Math.random() * h, z,
    vx: (Math.random() - 0.5) * baseSpeed * z,
    vy: (Math.random() - 0.5) * baseSpeed * z,
    baseSpeed, size: 1.5 + z * 2.5, color,
  };
}

function PlexusBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const noiseRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
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

      if (particlesRef.current.length === 0) {
        particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => createParticle(w, h));
      }
    };

    resize();
    window.addEventListener('resize', resize);

    const onMouse = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMouse, { passive: true });

    let running = true;
    const animate = () => {
      if (!running) return;
      const { w, h } = sizeRef.current;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const particles = particlesRef.current;

      ctx.fillStyle = '#12141C';
      ctx.fillRect(0, 0, w, h);

      const cg = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, w * 0.7);
      cg.addColorStop(0, 'rgba(108, 92, 231, 0.06)');
      cg.addColorStop(0.3, 'rgba(108, 92, 231, 0.03)');
      cg.addColorStop(0.6, 'rgba(116, 185, 255, 0.015)');
      cg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, w, h);

      if (mx > 0 && my > 0) {
        const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 250);
        mg.addColorStop(0, 'rgba(108, 92, 231, 0.08)');
        mg.addColorStop(0.4, 'rgba(108, 92, 231, 0.03)');
        mg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = mg;
        ctx.fillRect(0, 0, w, h);
      }

      if (noiseRef.current) ctx.drawImage(noiseRef.current, 0, 0);

      for (const p of particles) {
        const dmx = p.x - mx;
        const dmy = p.y - my;
        const distMouse = Math.sqrt(dmx * dmx + dmy * dmy);
        if (distMouse < MOUSE_RADIUS && distMouse > 1) {
          const force = (1 - distMouse / MOUSE_RADIUS) * MOUSE_FORCE * p.z;
          p.vx += (dmx / distMouse) * force;
          p.vy += (dmy / distMouse) * force;
        }
        p.vx *= 0.98; p.vy *= 0.98;
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const minSpeed = p.baseSpeed * p.z * 0.15;
        if (speed < minSpeed) {
          const angle = Math.atan2(p.vy, p.vx) || Math.random() * Math.PI * 2;
          p.vx = Math.cos(angle) * minSpeed;
          p.vy = Math.sin(angle) * minSpeed;
        }
        p.x += p.vx; p.y += p.vy;
        const margin = 50;
        if (p.x < -margin) p.x = w + margin;
        if (p.x > w + margin) p.x = -margin;
        if (p.y < -margin) p.y = h + margin;
        if (p.y > h + margin) p.y = -margin;
      }

      const sorted = [...particles].sort((a, b) => a.z - b.z);

      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i]; const b = sorted[j];
          const dx = a.x - b.x; const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const avgZ = (a.z + b.z) * 0.5;
          const scaledDist = CONNECTION_DIST * avgZ;
          if (dist < scaledDist) {
            const lineAlpha = (1 - dist / scaledDist) * avgZ * 0.35;
            const midX = (a.x + b.x) * 0.5;
            const midY = (a.y + b.y) * 0.5;
            const dMid = Math.sqrt((midX - mx) ** 2 + (midY - my) ** 2);
            const glowBoost = dMid < MOUSE_RADIUS ? (1 - dMid / MOUSE_RADIUS) * 0.4 : 0;
            const r = Math.round((a.color[0] + b.color[0]) * 0.5);
            const g = Math.round((a.color[1] + b.color[1]) * 0.5);
            const bl = Math.round((a.color[2] + b.color[2]) * 0.5);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${Math.min(lineAlpha + glowBoost, 0.6)})`;
            ctx.lineWidth = avgZ * 1.2;
            ctx.stroke();
          }
        }
      }

      for (const p of sorted) {
        const alpha = 0.3 + p.z * 0.6;
        const [r, g, b] = p.color;
        const dmx2 = p.x - mx; const dmy2 = p.y - my;
        const distM = Math.sqrt(dmx2 * dmx2 + dmy2 * dmy2);
        const nearMouse = distM < MOUSE_RADIUS;
        const glowSize = nearMouse ? p.size + (1 - distM / MOUSE_RADIUS) * 4 * p.z : p.size;

        if (p.z < 0.4) {
          const blurSize = glowSize * (3 - p.z * 5);
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, blurSize);
          grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`);
          grad.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${alpha * 0.15})`);
          grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(p.x - blurSize, p.y - blurSize, blurSize * 2, blurSize * 2);
        } else {
          if (nearMouse) {
            const haloSize = glowSize * 3;
            const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloSize);
            halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.3})`);
            halo.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, ${alpha * 0.08})`);
            halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
            ctx.fillStyle = halo;
            ctx.fillRect(p.x - haloSize, p.y - haloSize, haloSize * 2, haloSize * 2);
          }
          ctx.beginPath();
          ctx.arc(p.x, p.y, glowSize, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.fill();
          if (p.z > 0.7) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, glowSize * 0.4, 0, Math.PI * 2);
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
  }, []);

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
          y: { type: 'spring', stiffness: 100, damping: 18 },
        }}
      >
        <h1 className="flex items-baseline text-5xl md:text-7xl font-bold tracking-tight">
          {/* "B" — 항상 고정, 그래디언트 */}
          <span className="inline-block bg-gradient-to-br from-accent via-[#A29BFE] to-[#74B9FF] bg-clip-text text-transparent">
            B
          </span>

          {/* 서픽스 컨테이너 — 스프링 너비 전환 + 크로스페이드 */}
          <motion.span
            initial={false}
            animate={{ width: suffixW[suffix] ?? 0 }}
            transition={{ type: 'spring', stiffness: 170, damping: 22 }}
            className="inline-block overflow-hidden align-baseline relative"
            style={{ height: '1.15em' }}
          >
            <AnimatePresence>
              {suffix && (
                <motion.span
                  key={suffix}
                  initial={{ opacity: 0, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, filter: 'blur(10px)' }}
                  transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
                  className="absolute left-0 bottom-0 inline-block bg-gradient-to-br from-accent via-[#A29BFE] to-[#74B9FF] bg-clip-text text-transparent whitespace-nowrap"
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
            '0 0 8px rgba(108,92,231,0.4), 0 0 24px rgba(108,92,231,0.15)',
            '0 0 16px rgba(108,92,231,0.7), 0 0 48px rgba(108,92,231,0.3), 0 0 80px rgba(162,155,254,0.15)',
            '0 0 8px rgba(108,92,231,0.4), 0 0 24px rgba(108,92,231,0.15)',
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

function LoginForm({ onLogin }: { onLogin: (name: string, pw: string) => Promise<string | null> }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => nameRef.current?.focus(), 400);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('이름을 입력해주세요.'); return; }
    if (!password) { setError('비밀번호를 입력해주세요.'); return; }
    setLoading(true);
    setError('');
    const err = await onLogin(name.trim(), password);
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
        background: 'rgba(26, 29, 39, 0.6)',
        backdropFilter: 'blur(24px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
        border: '1px solid rgba(108, 92, 231, 0.15)',
        boxShadow: '0 32px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 80px rgba(108, 92, 231, 0.06)',
      }}
    >
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 50%)' }}
      />

      <div className="text-center relative">
        <h2 className="text-lg font-semibold tracking-tight">
          <span className="bg-gradient-to-r from-accent to-[#A29BFE] bg-clip-text text-transparent">B</span>
          <span className="text-text-primary"> flow</span>
        </h2>
        <p className="text-xs text-text-secondary/50 mt-1 tracking-wide">sign in to continue</p>
      </div>

      <div className="flex flex-col gap-1.5 relative">
        <label className="text-[11px] text-text-secondary/60 uppercase tracking-wider">Name</label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="사용자 이름"
          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/45 focus:outline-none focus:border-accent/50 focus:bg-white/[0.06] transition-all duration-200"
        />
      </div>

      <div className="flex flex-col gap-1.5 relative">
        <label className="text-[11px] text-text-secondary/60 uppercase tracking-wider">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호 입력"
          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/45 focus:outline-none focus:border-accent/50 focus:bg-white/[0.06] transition-all duration-200"
        />
        <p className="text-[10px] text-text-secondary/50">최초 비밀번호는 1234</p>
      </div>

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
        className="relative flex items-center justify-center gap-2 text-white text-sm font-medium rounded-xl px-4 py-2.5 cursor-pointer overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-accent/20 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #6C5CE7 0%, #A29BFE 100%)' }}
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

  // 클릭으로 넘어가기 (ready 상태에서만)
  const handleClick = useCallback(() => {
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

  const handleLogin = useCallback(async (name: string, password: string): Promise<string | null> => {
    const result = await login(name, password);
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
      style={{ background: '#12141C' }}
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
