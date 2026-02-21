import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn } from 'lucide-react';
import { login } from '@/services/userService';
import { useAuthStore } from '@/stores/useAuthStore';

// ─── 마우스 인터랙티브 파티클 배경 ────────────────────────────

interface Orb {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  speed: number;
  angle: number;
  opacity: number;
}

const ORB_COLORS = [
  'rgba(108, 92, 231, 0.35)',   // accent purple
  'rgba(162, 155, 254, 0.25)',  // lavender
  'rgba(0, 184, 148, 0.2)',     // mint
  'rgba(116, 185, 255, 0.2)',   // sky
  'rgba(108, 92, 231, 0.15)',   // faint purple
];

function createOrbs(count: number): Orb[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 80 + Math.random() * 300,
    color: ORB_COLORS[i % ORB_COLORS.length],
    speed: 0.15 + Math.random() * 0.25,
    angle: Math.random() * Math.PI * 2,
    opacity: 0.3 + Math.random() * 0.4,
  }));
}

function ParticleBackground({ mouseX, mouseY }: { mouseX: number; mouseY: number }) {
  const orbs = useMemo(() => createOrbs(7), []);
  const time = useRef(0);
  const [positions, setPositions] = useState(orbs.map((o) => ({ x: o.x, y: o.y })));
  const raf = useRef<number>(0);

  useEffect(() => {
    let running = true;
    const animate = () => {
      if (!running) return;
      time.current += 0.008;
      setPositions(
        orbs.map((orb) => {
          // 기본 궤도 운동
          const baseX = orb.x + Math.sin(time.current * orb.speed + orb.angle) * 8;
          const baseY = orb.y + Math.cos(time.current * orb.speed * 0.7 + orb.angle) * 6;
          // 마우스 반발 (가까울수록 강하게)
          const dx = baseX - mouseX * 100;
          const dy = baseY - mouseY * 100;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const force = Math.max(0, 1 - dist / 40) * 12;
          const fx = dist > 0.1 ? (dx / dist) * force : 0;
          const fy = dist > 0.1 ? (dy / dist) * force : 0;
          return { x: baseX + fx, y: baseY + fy };
        })
      );
      raf.current = requestAnimationFrame(animate);
    };
    raf.current = requestAnimationFrame(animate);
    return () => { running = false; cancelAnimationFrame(raf.current); };
  }, [orbs, mouseX, mouseY]);

  return (
    <div className="absolute inset-0 overflow-hidden">
      {orbs.map((orb, i) => (
        <div
          key={orb.id}
          className="absolute rounded-full"
          style={{
            width: orb.size,
            height: orb.size,
            left: `${positions[i].x}%`,
            top: `${positions[i].y}%`,
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, ${orb.color} 0%, transparent 70%)`,
            filter: `blur(${40 + orb.size * 0.15}px)`,
            opacity: orb.opacity,
            transition: 'left 0.6s ease-out, top 0.6s ease-out',
          }}
        />
      ))}
      {/* 노이즈 그레인 오버레이 */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}

// ─── 히어로 텍스트 애니메이션 ─────────────────────────────────

const HERO_LETTERS = 'B the flow.'.split('');

function HeroText() {
  return (
    <motion.div className="flex flex-col items-center gap-5 z-10 relative">
      {/* 메인 타이틀: B the flow. */}
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

      {/* 서브타이틀 */}
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2, duration: 0.8, ease: 'easeOut' }}
        className="text-base md:text-lg text-text-secondary/70 font-light tracking-wide"
      >
        Your workflow, but better. That&apos;s the <span className="text-accent font-medium">B</span>.
      </motion.p>

      {/* 액센트 라인 */}
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

function Footer({ visible }: { visible: boolean }) {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      animate={{ opacity: visible ? 1 : 0 }}
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
      {/* 글래스 하이라이트 */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 50%)',
        }}
      />

      {/* 타이틀 */}
      <div className="text-center relative">
        <h2 className="text-lg font-semibold tracking-tight">
          <span className="bg-gradient-to-r from-accent to-[#A29BFE] bg-clip-text text-transparent">B</span>
          <span className="text-text-primary"> flow</span>
        </h2>
        <p className="text-xs text-text-secondary/50 mt-1 tracking-wide">sign in to continue</p>
      </div>

      {/* 이름 */}
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

      {/* 비밀번호 */}
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

      {/* 에러 */}
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

      {/* 로그인 버튼 */}
      <button
        type="submit"
        disabled={loading}
        className="relative flex items-center justify-center gap-2 text-white text-sm font-medium rounded-xl px-4 py-2.5 cursor-pointer overflow-hidden transition-all duration-200 hover:shadow-lg hover:shadow-accent/20 disabled:opacity-50"
        style={{
          background: 'linear-gradient(135deg, #6C5CE7 0%, #A29BFE 100%)',
        }}
      >
        <LogIn size={15} />
        {loading ? '로그인 중...' : '로그인'}
      </button>
    </motion.form>
  );
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────

type Phase = 'landing' | 'transition' | 'login';

export function LoginScreen() {
  const { setCurrentUser } = useAuthStore();
  const [phase, setPhase] = useState<Phase>('landing');
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });

  // 마우스 트래킹
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setMouse({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
  }, []);

  // 3초 후 로그인으로 전환
  useEffect(() => {
    const t1 = setTimeout(() => setPhase('transition'), 2800);
    const t2 = setTimeout(() => setPhase('login'), 3400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // 클릭/키 입력 시 즉시 전환
  const skipToLogin = useCallback(() => {
    if (phase === 'landing') {
      setPhase('transition');
      setTimeout(() => setPhase('login'), 500);
    }
  }, [phase]);

  const handleLogin = useCallback(async (name: string, password: string): Promise<string | null> => {
    const result = await login(name, password);
    if (result.ok && result.user) {
      setCurrentUser(result.user);
      return null;
    }
    return result.error ?? '로그인에 실패했습니다.';
  }, [setCurrentUser]);

  return (
    <div
      className="relative flex flex-col items-center justify-center h-screen w-screen bg-bg-primary overflow-hidden select-none"
      onMouseMove={handleMouseMove}
      onClick={skipToLogin}
      onKeyDown={skipToLogin}
    >
      {/* 파티클 배경 (항상 표시) */}
      <ParticleBackground mouseX={mouse.x} mouseY={mouse.y} />

      {/* 마우스 글로우 포인터 */}
      <div
        className="fixed pointer-events-none z-0"
        style={{
          left: `${mouse.x * 100}%`,
          top: `${mouse.y * 100}%`,
          width: 400,
          height: 400,
          transform: 'translate(-50%, -50%)',
          background: 'radial-gradient(circle, rgba(108,92,231,0.08) 0%, transparent 70%)',
          transition: 'left 0.3s ease-out, top 0.3s ease-out',
        }}
      />

      {/* 콘텐츠 영역 */}
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

      {/* 푸터 */}
      <Footer visible={phase !== 'transition'} />
    </div>
  );
}
