import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LogIn } from 'lucide-react';
import { login } from '@/services/userService';
import { useAuthStore } from '@/stores/useAuthStore';

// ─── 플렉서스 배경 (Canvas 2D, Z축 깊이감, 마우스 인터랙션) ─────

interface Particle {
  x: number;
  y: number;
  z: number; // 0(먼) ~ 1(가까움)
  vx: number;
  vy: number;
  baseSpeed: number;
  size: number;
  color: [number, number, number]; // RGB
}

const PLEXUS_COLORS: [number, number, number][] = [
  [108, 92, 231],   // #6C5CE7 보라
  [162, 155, 254],   // #A29BFE 연보라
  [116, 185, 255],   // #74B9FF 파랑
  [0, 184, 148],     // #00B894 청록
  [85, 239, 196],    // #55EFC4 민트
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
    x: Math.random() * w,
    y: Math.random() * h,
    z,
    vx: (Math.random() - 0.5) * baseSpeed * z,
    vy: (Math.random() - 0.5) * baseSpeed * z,
    baseSpeed,
    size: 1.5 + z * 2.5,
    color,
  };
}

function PlexusBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });

  // 노이즈 캔버스 (밴딩 제거용 디더링 텍스처 — 한 번만 생성)
  const noiseRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // 리사이즈 처리
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

      // 노이즈 텍스처 생성 (밴딩 제거)
      if (!noiseRef.current || noiseRef.current.width !== w) {
        const nc = document.createElement('canvas');
        nc.width = w;
        nc.height = h;
        const nctx = nc.getContext('2d');
        if (nctx) {
          const imageData = nctx.createImageData(w, h);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            const v = Math.random() * 25;
            data[i] = v;
            data[i + 1] = v;
            data[i + 2] = v;
            data[i + 3] = 18; // 매우 낮은 opacity
          }
          nctx.putImageData(imageData, 0, 0);
        }
        noiseRef.current = nc;
      }

      // 파티클 초기화 또는 리사이즈
      if (particlesRef.current.length === 0) {
        particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => createParticle(w, h));
      }
    };

    resize();
    window.addEventListener('resize', resize);

    // 마우스 추적
    const onMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMouse, { passive: true });

    // 애니메이션 루프
    let running = true;
    const animate = () => {
      if (!running) return;
      const { w, h } = sizeRef.current;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const particles = particlesRef.current;

      // 배경 — 다단계 radial gradient (밴딩 최소화)
      ctx.fillStyle = '#12141C';
      ctx.fillRect(0, 0, w, h);

      // 미묘한 중앙 글로우
      const cg = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, w * 0.7);
      cg.addColorStop(0, 'rgba(108, 92, 231, 0.06)');
      cg.addColorStop(0.3, 'rgba(108, 92, 231, 0.03)');
      cg.addColorStop(0.6, 'rgba(116, 185, 255, 0.015)');
      cg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, w, h);

      // 마우스 주변 글로우
      if (mx > 0 && my > 0) {
        const mg = ctx.createRadialGradient(mx, my, 0, mx, my, 250);
        mg.addColorStop(0, 'rgba(108, 92, 231, 0.08)');
        mg.addColorStop(0.4, 'rgba(108, 92, 231, 0.03)');
        mg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = mg;
        ctx.fillRect(0, 0, w, h);
      }

      // 노이즈 디더링 오버레이 (밴딩 제거)
      if (noiseRef.current) {
        ctx.drawImage(noiseRef.current, 0, 0);
      }

      // 파티클 업데이트
      for (const p of particles) {
        // 마우스 인터랙션 — 가까운 파티클(z 높을수록) 더 강하게 반응
        const dmx = p.x - mx;
        const dmy = p.y - my;
        const distMouse = Math.sqrt(dmx * dmx + dmy * dmy);
        if (distMouse < MOUSE_RADIUS && distMouse > 1) {
          const force = (1 - distMouse / MOUSE_RADIUS) * MOUSE_FORCE * p.z;
          p.vx += (dmx / distMouse) * force;
          p.vy += (dmy / distMouse) * force;
        }

        // 속도 감쇠 + 이동
        p.vx *= 0.98;
        p.vy *= 0.98;

        // 최소 속도 유지 (유기적 흐름)
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const minSpeed = p.baseSpeed * p.z * 0.15;
        if (speed < minSpeed) {
          const angle = Math.atan2(p.vy, p.vx) || Math.random() * Math.PI * 2;
          p.vx = Math.cos(angle) * minSpeed;
          p.vy = Math.sin(angle) * minSpeed;
        }

        p.x += p.vx;
        p.y += p.vy;

        // 경계 랩핑 (부드러운 진입)
        const margin = 50;
        if (p.x < -margin) p.x = w + margin;
        if (p.x > w + margin) p.x = -margin;
        if (p.y < -margin) p.y = h + margin;
        if (p.y > h + margin) p.y = -margin;
      }

      // Z-depth 기준 정렬 (먼 것부터 그리기)
      const sorted = [...particles].sort((a, b) => a.z - b.z);

      // 연결선 그리기 (먼 파티클의 연결선은 더 투명하고 얇게)
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i];
          const b = sorted[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Z 깊이에 따른 연결 거리 스케일링
          const avgZ = (a.z + b.z) * 0.5;
          const scaledDist = CONNECTION_DIST * avgZ;

          if (dist < scaledDist) {
            const lineAlpha = (1 - dist / scaledDist) * avgZ * 0.35;
            const lineWidth = avgZ * 1.2;

            // 마우스 근처 연결선은 밝게 글로우
            const midX = (a.x + b.x) * 0.5;
            const midY = (a.y + b.y) * 0.5;
            const dMid = Math.sqrt((midX - mx) ** 2 + (midY - my) ** 2);
            const glowBoost = dMid < MOUSE_RADIUS ? (1 - dMid / MOUSE_RADIUS) * 0.4 : 0;

            const r = Math.round((a.color[0] + b.color[0]) * 0.5);
            const g = Math.round((a.color[1] + b.color[1]) * 0.5);
            const bl = Math.round((a.color[2] + b.color[2]) * 0.5);

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${Math.min(lineAlpha + glowBoost, 0.6)})`;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
          }
        }
      }

      // 파티클(노드) 그리기 — Z 깊이에 따른 크기, 블러, 투명도
      for (const p of sorted) {
        const alpha = 0.3 + p.z * 0.6;
        const [r, g, b] = p.color;

        // 마우스 근처 파티클 글로우
        const dmx2 = p.x - mx;
        const dmy2 = p.y - my;
        const distM = Math.sqrt(dmx2 * dmx2 + dmy2 * dmy2);
        const nearMouse = distM < MOUSE_RADIUS;
        const glowSize = nearMouse ? p.size + (1 - distM / MOUSE_RADIUS) * 4 * p.z : p.size;

        // 먼 파티클 — 블러 효과 (큰 그래디언트 원으로 시뮬레이션)
        if (p.z < 0.4) {
          const blurSize = glowSize * (3 - p.z * 5);
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, blurSize);
          grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`);
          grad.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${alpha * 0.15})`);
          grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(p.x - blurSize, p.y - blurSize, blurSize * 2, blurSize * 2);
        } else {
          // 가까운 파티클 — 선명한 점 + 글로우 후광
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

          // 밝은 코어
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

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{ width: '100%', height: '100%' }}
    />
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
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden select-none z-[9998]"
      style={{ background: '#12141C' }}
      onClick={skip}
      onKeyDown={skip}
      tabIndex={-1}
    >
      <PlexusBackground />

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
