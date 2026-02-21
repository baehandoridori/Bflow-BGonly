import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn } from 'lucide-react';
import { login } from '@/services/userService';
import { useAuthStore } from '@/stores/useAuthStore';

// ─── 성능 최적화된 배경 (DOM 직접 조작, React 상태 없음) ──────

interface OrbData {
  baseX: number;
  baseY: number;
  size: number;
  color: string;
  speed: number;
  angle: number;
  opacity: number;
}

const ORB_PALETTE = [
  [108, 92, 231, 0.30],
  [162, 155, 254, 0.22],
  [0, 184, 148, 0.18],
  [116, 185, 255, 0.18],
  [108, 92, 231, 0.12],
  [85, 239, 196, 0.14],
  [253, 203, 110, 0.10],
];

function initOrbs(): OrbData[] {
  return ORB_PALETTE.map(([r, g, b, a], i) => ({
    baseX: 10 + Math.random() * 80,
    baseY: 10 + Math.random() * 80,
    size: 120 + Math.random() * 280,
    color: `rgba(${r},${g},${b},${a})`,
    speed: 0.12 + Math.random() * 0.2,
    angle: (i / ORB_PALETTE.length) * Math.PI * 2,
    opacity: 0.5 + Math.random() * 0.5,
  }));
}

// 플렉서블 아트 — 유기적 SVG 커브 (마우스 반응형)
function FlexArt({ containerRef }: { containerRef: React.RefObject<SVGSVGElement> }) {
  return (
    <svg
      ref={containerRef as React.LegacyRef<SVGSVGElement>}
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      style={{ opacity: 0.6 }}
    >
      <defs>
        <linearGradient id="flex-g1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6C5CE7" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#A29BFE" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#74B9FF" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="flex-g2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00B894" stopOpacity="0.10" />
          <stop offset="50%" stopColor="#6C5CE7" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#55EFC4" stopOpacity="0.10" />
        </linearGradient>
        <linearGradient id="flex-g3" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#FDCB6E" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#E17055" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      {/* 커브 패스 — JS에서 동적 업데이트 */}
      <path id="flex-path-0" fill="none" stroke="url(#flex-g1)" strokeWidth="1.5" />
      <path id="flex-path-1" fill="none" stroke="url(#flex-g2)" strokeWidth="1.2" />
      <path id="flex-path-2" fill="none" stroke="url(#flex-g3)" strokeWidth="1" />
      {/* 채워진 유기체 */}
      <path id="flex-blob-0" fill="url(#flex-g1)" />
      <path id="flex-blob-1" fill="url(#flex-g2)" />
    </svg>
  );
}

function InteractiveBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const orbRefs = useRef<HTMLDivElement[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const orbs = useRef(initOrbs());
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const timeRef = useRef(0);
  const rafRef = useRef(0);

  // 마우스 이벤트는 window 레벨에서 직접 처리
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
      // 글로우 포인터 즉시 업데이트
      if (glowRef.current) {
        glowRef.current.style.left = `${mouseRef.current.x * 100}%`;
        glowRef.current.style.top = `${mouseRef.current.y * 100}%`;
      }
    };
    window.addEventListener('mousemove', handler, { passive: true });
    return () => window.removeEventListener('mousemove', handler);
  }, []);

  // rAF 루프 — React 상태 업데이트 없이 DOM 직접 조작
  useEffect(() => {
    let running = true;

    const animate = () => {
      if (!running) return;
      timeRef.current += 0.006;
      const t = timeRef.current;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // 오브 위치 업데이트
      orbs.current.forEach((orb, i) => {
        const el = orbRefs.current[i];
        if (!el) return;

        const bx = orb.baseX + Math.sin(t * orb.speed + orb.angle) * 10;
        const by = orb.baseY + Math.cos(t * orb.speed * 0.7 + orb.angle + 1) * 8;
        // 마우스 반발
        const dx = bx - mx * 100;
        const dy = by - my * 100;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = Math.max(0, 1 - dist / 45) * 15;
        const fx = dist > 0.1 ? (dx / dist) * force : 0;
        const fy = dist > 0.1 ? (dy / dist) * force : 0;

        el.style.transform = `translate(${bx + fx}vw, ${by + fy}vh) translate(-50%, -50%)`;
      });

      // 플렉서블 아트 커브 업데이트
      const svg = svgRef.current;
      if (svg) {
        const mxS = mx * 1000;
        const myS = my * 1000;

        // 커브 0 — 큰 S자
        const p0 = svg.getElementById('flex-path-0');
        if (p0) {
          const cx1 = 200 + Math.sin(t * 0.3) * 150 + (mxS - 500) * 0.08;
          const cy1 = 300 + Math.cos(t * 0.25) * 100 + (myS - 500) * 0.06;
          const cx2 = 800 + Math.sin(t * 0.35 + 1) * 120 + (mxS - 500) * 0.05;
          const cy2 = 700 + Math.cos(t * 0.3 + 2) * 80 + (myS - 500) * 0.07;
          p0.setAttribute('d', `M -50 ${400 + Math.sin(t * 0.2) * 80} C ${cx1} ${cy1}, ${cx2} ${cy2}, 1050 ${600 + Math.cos(t * 0.25) * 60}`);
        }

        // 커브 1 — 우아한 호
        const p1 = svg.getElementById('flex-path-1');
        if (p1) {
          const cx1 = 400 + Math.cos(t * 0.4) * 200 + (mxS - 500) * 0.06;
          const cy1 = 100 + Math.sin(t * 0.35) * 150 + (myS - 500) * 0.05;
          const cx2 = 600 + Math.cos(t * 0.3 + 3) * 180 + (mxS - 500) * 0.04;
          const cy2 = 900 + Math.sin(t * 0.28 + 1) * 100 + (myS - 500) * 0.06;
          p1.setAttribute('d', `M ${-20 + Math.sin(t * 0.15) * 40} 800 C ${cx1} ${cy1}, ${cx2} ${cy2}, ${1020 + Math.cos(t * 0.2) * 30} 200`);
        }

        // 커브 2 — 가벼운 파동
        const p2 = svg.getElementById('flex-path-2');
        if (p2) {
          let d = `M -50 ${500 + Math.sin(t * 0.18) * 40}`;
          for (let seg = 1; seg <= 5; seg++) {
            const sx = seg * 210;
            const sy = 500 + Math.sin(t * 0.2 + seg * 1.2) * 60 + (myS - 500) * 0.03;
            d += ` S ${sx - 80} ${sy + (seg % 2 ? 60 : -60)}, ${sx} ${sy}`;
          }
          p2.setAttribute('d', d);
        }

        // 블롭 0 — 유기적 형태
        const b0 = svg.getElementById('flex-blob-0');
        if (b0) {
          const cx = 300 + Math.sin(t * 0.2) * 80 + (mxS - 500) * 0.06;
          const cy = 300 + Math.cos(t * 0.25) * 60 + (myS - 500) * 0.05;
          const r = 120 + Math.sin(t * 0.3) * 30;
          const d0 = Math.sin(t * 0.5) * 25;
          const d1 = Math.cos(t * 0.4 + 1) * 20;
          const d2 = Math.sin(t * 0.45 + 2) * 22;
          const d3 = Math.cos(t * 0.5 + 3) * 18;
          b0.setAttribute('d', `M ${cx} ${cy - r + d0} Q ${cx + r + d1} ${cy - d2}, ${cx + d3} ${cy + r - d0} Q ${cx - r - d1} ${cy + d2}, ${cx - d3} ${cy - r + d0} Z`);
        }

        // 블롭 1 — 하단 우측
        const b1 = svg.getElementById('flex-blob-1');
        if (b1) {
          const cx = 720 + Math.cos(t * 0.22) * 60 + (mxS - 500) * 0.04;
          const cy = 680 + Math.sin(t * 0.18) * 50 + (myS - 500) * 0.05;
          const r = 90 + Math.cos(t * 0.35) * 25;
          const d0 = Math.cos(t * 0.6) * 20;
          const d1 = Math.sin(t * 0.5 + 2) * 15;
          b1.setAttribute('d', `M ${cx} ${cy - r + d0} Q ${cx + r + d1} ${cy}, ${cx} ${cy + r - d0} Q ${cx - r - d1} ${cy}, ${cx} ${cy - r + d0} Z`);
        }
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      {/* 오브 — 위치는 CSS transform으로 직접 조작 */}
      {orbs.current.map((orb, i) => (
        <div
          key={i}
          ref={(el) => { if (el) orbRefs.current[i] = el; }}
          className="absolute left-0 top-0 rounded-full will-change-transform"
          style={{
            width: orb.size,
            height: orb.size,
            background: `radial-gradient(circle at 40% 40%, ${orb.color} 0%, ${orb.color.replace(/[\d.]+\)$/, '0)')} 70%)`,
            filter: `blur(${50 + orb.size * 0.12}px)`,
            opacity: orb.opacity,
            transform: `translate(${orb.baseX}vw, ${orb.baseY}vh) translate(-50%, -50%)`,
          }}
        />
      ))}

      {/* 플렉서블 아트 커브 */}
      <FlexArt containerRef={svgRef} />

      {/* 마우스 글로우 */}
      <div
        ref={glowRef}
        className="absolute pointer-events-none will-change-transform"
        style={{
          left: '50%',
          top: '50%',
          width: 500,
          height: 500,
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(108,92,231,0.07) 0%, rgba(108,92,231,0.02) 40%, transparent 70%)',
        }}
      />

      {/* 디더링 노이즈 — 밴딩 제거 */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.04]">
        <filter id="dither-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#dither-noise)" />
      </svg>
    </div>
  );
}

// ─── 히어로 텍스트 애니메이션 ─────────────────────────────────

const HERO_LETTERS = 'B the flow.'.split('');

function HeroText() {
  return (
    <motion.div className="flex flex-col items-center gap-5 z-10 relative">
      <h1 className="flex overflow-hidden">
        {HERO_LETTERS.map((char, i) => (
          <motion.span
            key={i}
            initial={{ y: 80, opacity: 0, rotateX: -90 }}
            animate={{ y: 0, opacity: 1, rotateX: 0 }}
            transition={{
              delay: 0.3 + i * 0.06,
              duration: 0.7,
              ease: [0.16, 1, 0.3, 1],
            }}
            className={`inline-block text-5xl md:text-7xl font-bold tracking-tight ${
              i === 0
                ? 'bg-gradient-to-br from-accent via-[#A29BFE] to-[#74B9FF] bg-clip-text text-transparent'
                : 'text-text-primary'
            }`}
            style={{ display: 'inline-block', whiteSpace: 'pre' }}
          >
            {char === ' ' ? '\u00A0' : char}
          </motion.span>
        ))}
      </h1>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2, duration: 0.8, ease: 'easeOut' }}
        className="text-base md:text-lg text-text-secondary/70 font-light tracking-wide"
      >
        Your workflow, but better. That&apos;s the <span className="text-accent font-medium">B</span>.
      </motion.p>

      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 1.6, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="h-px w-24 bg-gradient-to-r from-transparent via-accent to-transparent"
      />
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
      <p className="text-[11px] text-text-secondary/30 tracking-[0.2em] uppercase">
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
          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent/50 focus:bg-white/[0.06] transition-all duration-200"
        />
      </div>

      <div className="flex flex-col gap-1.5 relative">
        <label className="text-[11px] text-text-secondary/60 uppercase tracking-wider">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호 입력"
          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-accent/50 focus:bg-white/[0.06] transition-all duration-200"
        />
        <p className="text-[10px] text-text-secondary/30">최초 비밀번호는 1234</p>
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

/**
 * @param mode 'login' = 로그인 필요, 'splash' = 이미 로그인됨 → 스플래시만
 * @param onComplete 스플래시 완료 콜백 (mode='splash' 전용)
 */
interface LoginScreenProps {
  mode?: 'login' | 'splash';
  onComplete?: () => void;
}

type Phase = 'landing' | 'transition' | 'login' | 'done';

export function LoginScreen({ mode = 'login', onComplete }: LoginScreenProps) {
  const { setCurrentUser } = useAuthStore();
  const [phase, setPhase] = useState<Phase>('landing');

  // 타이머: 히어로 → 전환
  useEffect(() => {
    const duration = mode === 'splash' ? 2400 : 2800;
    const t1 = setTimeout(() => setPhase('transition'), duration);
    const t2 = setTimeout(() => {
      if (mode === 'splash') {
        setPhase('done');
        onComplete?.();
      } else {
        setPhase('login');
      }
    }, duration + 600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [mode, onComplete]);

  // 클릭/키 입력 시 즉시 스킵
  const skip = useCallback(() => {
    if (phase !== 'landing') return;
    setPhase('transition');
    setTimeout(() => {
      if (mode === 'splash') {
        setPhase('done');
        onComplete?.();
      } else {
        setPhase('login');
      }
    }, 400);
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
      className="fixed inset-0 flex flex-col items-center justify-center bg-bg-primary overflow-hidden select-none z-[9998]"
      onClick={skip}
      onKeyDown={skip}
      tabIndex={-1}
    >
      <InteractiveBackground />

      <AnimatePresence mode="wait">
        {(phase === 'landing' || phase === 'transition') && (
          <motion.div
            key="hero"
            exit={{ opacity: 0, y: -40, scale: 0.97, filter: 'blur(8px)' }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            className="flex flex-col items-center"
          >
            <HeroText />
          </motion.div>
        )}

        {phase === 'login' && (
          <motion.div
            key="login"
            className="flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <LoginForm onLogin={handleLogin} />
          </motion.div>
        )}
      </AnimatePresence>

      <Footer />
    </div>
  );
}
