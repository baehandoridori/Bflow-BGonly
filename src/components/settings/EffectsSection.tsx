import { useCallback, useRef, useEffect, useState } from 'react';
import { Sparkles, RotateCcw, ChevronDown } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { useAppStore } from '@/stores/useAppStore';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { cn } from '@/utils/cn';

const DEFAULTS = {
  loginEnabled: true,
  loginParticleCount: 666,
  dashboardEnabled: true,
  dashboardParticleCount: 120,
  speed: 1.0,
  mouseRadius: 250,
  mouseForce: 0.06,
  glowIntensity: 1.0,
  connectionDist: 160,
};

/* ── 미니 플렉서스 프리뷰 (마우스 반응 + 부드러운 파티클 증감) ── */

const PREVIEW_W = 320;
const PREVIEW_H = 180;
const PREVIEW_BASE_CONN = 55;
const PREVIEW_BASE_MOUSE_R = 60;
const PREVIEW_BASE_MOUSE_F = 0.03;

interface MiniParticle {
  x: number; y: number;
  vx: number; vy: number;
  size: number;
  color: [number, number, number];
}

function getAccentRgb(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
  return [108, 92, 231];
}

function getAccentSubRgb(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-accent-sub').trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
  return [162, 155, 254];
}

function createOneMiniParticle(speedMult: number): MiniParticle {
  const accent = getAccentRgb();
  const sub = getAccentSubRgb();
  const colors: [number, number, number][] = [accent, accent, sub];
  const baseSpeed = (0.15 + Math.random() * 0.3) * speedMult;
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.random() * PREVIEW_W,
    y: Math.random() * PREVIEW_H,
    vx: Math.cos(angle) * baseSpeed,
    vy: Math.sin(angle) * baseSpeed,
    size: 1 + Math.random() * 1.5,
    color: colors[Math.floor(Math.random() * colors.length)],
  };
}

interface PreviewProps {
  particleCount: number;
  enabled: boolean;
  speed: number;
  mouseRadius: number;
  mouseForce: number;
  glowIntensity: number;
  connectionDist: number;
  dense?: boolean;
}

function MiniPlexusPreview({ particleCount, enabled, speed, mouseRadius, mouseForce, glowIntensity, connectionDist, dense }: PreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const particlesRef = useRef<MiniParticle[]>([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const settingsRef = useRef({ speed, mouseRadius, mouseForce, glowIntensity, connectionDist });
  settingsRef.current = { speed, mouseRadius, mouseForce, glowIntensity, connectionDist };

  const factor = dense ? 8 : 2;
  const targetRef = useRef(0);
  targetRef.current = Math.max(6, Math.min(Math.round(particleCount / factor), 100));

  useEffect(() => {
    if (!enabled) { cancelAnimationFrame(rafRef.current); return; }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;

    if (particlesRef.current.length === 0) {
      particlesRef.current = Array.from({ length: targetRef.current }, () =>
        createOneMiniParticle(settingsRef.current.speed),
      );
    }

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      mouseRef.current = {
        x: ((e.clientX - rect.left) / rect.width) * PREVIEW_W,
        y: ((e.clientY - rect.top) / rect.height) * PREVIEW_H,
      };
    };
    const onMouseLeave = () => { mouseRef.current = { x: -9999, y: -9999 }; };
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    const animate = () => {
      const ps = particlesRef.current;
      const target = targetRef.current;
      const s = settingsRef.current;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // 부드러운 파티클 증감 (프레임당 최대 3개)
      if (ps.length < target) {
        const n = Math.min(target - ps.length, 3);
        for (let i = 0; i < n; i++) ps.push(createOneMiniParticle(s.speed));
      } else if (ps.length > target) {
        ps.splice(ps.length - Math.min(ps.length - target, 3));
      }

      const connDist = PREVIEW_BASE_CONN * (s.connectionDist / 160);
      const mRadius = PREVIEW_BASE_MOUSE_R * (s.mouseRadius / 250);
      const mForce = PREVIEW_BASE_MOUSE_F * (s.mouseForce / 0.06);

      ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);

      // 물리 업데이트
      for (const p of ps) {
        const dmx = p.x - mx;
        const dmy = p.y - my;
        const distMouse = Math.sqrt(dmx * dmx + dmy * dmy);
        if (distMouse < mRadius && distMouse > 1) {
          const force = (1 - distMouse / mRadius) * mForce;
          p.vx += (dmx / distMouse) * force;
          p.vy += (dmy / distMouse) * force;
        }
        p.vx *= 0.985;
        p.vy *= 0.985;
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const minSpd = 0.05 * s.speed;
        if (spd < minSpd) {
          const angle = Math.atan2(p.vy, p.vx) || Math.random() * Math.PI * 2;
          p.vx = Math.cos(angle) * minSpd;
          p.vy = Math.sin(angle) * minSpd;
        }
        p.x += p.vx * s.speed;
        p.y += p.vy * s.speed;
        if (p.x < -10) p.x = PREVIEW_W + 10;
        if (p.x > PREVIEW_W + 10) p.x = -10;
        if (p.y < -10) p.y = PREVIEW_H + 10;
        if (p.y > PREVIEW_H + 10) p.y = -10;
      }

      // 연결선
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = ps[i].x - ps[j].x;
          const dy = ps[i].y - ps[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < connDist) {
            const alpha = (1 - dist / connDist) * 0.4;
            const [r, g, b] = ps[i].color;
            ctx.beginPath();
            ctx.moveTo(ps[i].x, ps[i].y);
            ctx.lineTo(ps[j].x, ps[j].y);
            ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      // 파티클 + 글로우
      for (const p of ps) {
        const [r, g, b] = p.color;
        const dm = Math.sqrt((p.x - mx) ** 2 + (p.y - my) ** 2);
        const near = dm < mRadius;

        if (s.glowIntensity > 0.2) {
          const glR = p.size * (2.5 + (near ? 2 : 0)) * s.glowIntensity;
          const glA = (near ? 0.3 : 0.15) * s.glowIntensity;
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glR);
          grad.addColorStop(0, `rgba(${r},${g},${b},${glA})`);
          grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.fillStyle = grad;
          ctx.fillRect(p.x - glR, p.y - glR, glR * 2, glR * 2);
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, near ? p.size * 1.3 : p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [enabled]);

  return (
    <div
      className="relative rounded-lg overflow-hidden border border-bg-border/30 my-2.5"
      style={{ width: '100%', aspectRatio: `${PREVIEW_W}/${PREVIEW_H}`, background: 'rgb(var(--color-bg-primary) / 0.6)' }}
    >
      {enabled ? (
        <canvas ref={canvasRef} className="w-full h-full" style={{ cursor: 'crosshair' }} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-border/20">
          <span className="text-xs text-text-secondary/40 font-medium">OFF</span>
        </div>
      )}
    </div>
  );
}

/* ── UI 컴포넌트 ── */

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative w-10 h-[22px] rounded-full transition-colors duration-200 cursor-pointer shrink-0',
        checked ? 'bg-accent' : 'bg-bg-border',
      )}
    >
      <div
        className={cn(
          'absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[22px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

function Slider({ label, value, min, max, step, defaultVal, onChange }: {
  label: string; value: number; min: number; max: number; step: number; defaultVal: number;
  onChange: (v: number) => void;
}) {
  const isModified = Math.abs(value - defaultVal) > step * 0.1;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-secondary/60 w-20 shrink-0">{label}</span>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1.5 bg-bg-border rounded-full appearance-none cursor-pointer accent-accent"
      />
      <span className={cn('text-xs font-mono w-12 text-right', isModified ? 'text-accent' : 'text-text-secondary/60')}>
        {step < 1 ? value.toFixed(2) : value}
      </span>
    </div>
  );
}

async function persistPlexus(plexus: typeof DEFAULTS) {
  const existing = await loadPreferences() ?? {};
  await savePreferences({ ...existing, plexus });
}

/* ── 메인 섹션 ── */

export function EffectsSection() {
  const plexusSettings = useAppStore((s) => s.plexusSettings);
  const setPlexusSettings = useAppStore((s) => s.setPlexusSettings);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const update = useCallback((partial: Partial<typeof DEFAULTS>) => {
    setPlexusSettings(partial);
    persistPlexus({ ...plexusSettings, ...partial });
  }, [plexusSettings, setPlexusSettings]);

  const handleReset = useCallback(() => {
    setPlexusSettings(DEFAULTS);
    persistPlexus(DEFAULTS);
  }, [setPlexusSettings]);

  return (
    <SettingsSection
      icon={<Sparkles size={18} className="text-accent" />}
      title="효과"
      action={
        <button
          onClick={handleReset}
          className="flex items-center gap-1 text-[11px] text-text-secondary/50 hover:text-text-primary transition-colors cursor-pointer"
        >
          <RotateCcw size={12} />
          기본값 복원
        </button>
      }
    >
      {/* 로그인 플렉서스 */}
      <div className="mb-5">
        <div className="flex items-center justify-between gap-4 mb-1">
          <div>
            <p className="text-sm font-medium text-text-primary">로그인 배경 애니메이션</p>
            <p className="text-[11px] text-text-secondary/60 mt-0.5">로그인 화면의 플렉서스 파티클 효과</p>
          </div>
          <Toggle checked={plexusSettings.loginEnabled} onChange={(v) => update({ loginEnabled: v })} />
        </div>

        <MiniPlexusPreview
          particleCount={plexusSettings.loginParticleCount}
          enabled={plexusSettings.loginEnabled}
          speed={plexusSettings.speed}
          mouseRadius={plexusSettings.mouseRadius}
          mouseForce={plexusSettings.mouseForce}
          glowIntensity={plexusSettings.glowIntensity}
          connectionDist={plexusSettings.connectionDist}
          dense
        />

        {plexusSettings.loginEnabled && (
          <Slider
            label="파티클 수" value={plexusSettings.loginParticleCount}
            min={100} max={1500} step={50} defaultVal={DEFAULTS.loginParticleCount}
            onChange={(v) => update({ loginParticleCount: v })}
          />
        )}
      </div>

      <div className="border-t border-bg-border/30 pt-5">
        {/* 대시보드 플렉서스 */}
        <div className="flex items-center justify-between gap-4 mb-1">
          <div>
            <p className="text-sm font-medium text-text-primary">대시보드 배경 애니메이션</p>
            <p className="text-[11px] text-text-secondary/60 mt-0.5">대시보드의 은은한 파티클 효과</p>
          </div>
          <Toggle checked={plexusSettings.dashboardEnabled} onChange={(v) => update({ dashboardEnabled: v })} />
        </div>

        <MiniPlexusPreview
          particleCount={plexusSettings.dashboardParticleCount}
          enabled={plexusSettings.dashboardEnabled}
          speed={plexusSettings.speed}
          mouseRadius={plexusSettings.mouseRadius}
          mouseForce={plexusSettings.mouseForce}
          glowIntensity={plexusSettings.glowIntensity}
          connectionDist={plexusSettings.connectionDist}
        />

        {plexusSettings.dashboardEnabled && (
          <Slider
            label="파티클 수" value={plexusSettings.dashboardParticleCount}
            min={30} max={300} step={10} defaultVal={DEFAULTS.dashboardParticleCount}
            onChange={(v) => update({ dashboardParticleCount: v })}
          />
        )}
      </div>

      {/* 세부 설정 (접이식) */}
      <div className="border-t border-bg-border/30 mt-5 pt-4">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-text-secondary/60 hover:text-text-primary transition-colors cursor-pointer mb-3"
        >
          <ChevronDown
            size={14}
            className={cn('transition-transform duration-200', showAdvanced && 'rotate-180')}
          />
          세부 설정
        </button>

        {showAdvanced && (
          <div className="flex flex-col gap-2.5 pl-1">
            <Slider
              label="움직임 속도" value={plexusSettings.speed}
              min={0.3} max={2.5} step={0.1} defaultVal={DEFAULTS.speed}
              onChange={(v) => update({ speed: v })}
            />
            <Slider
              label="마우스 범위" value={plexusSettings.mouseRadius}
              min={80} max={500} step={10} defaultVal={DEFAULTS.mouseRadius}
              onChange={(v) => update({ mouseRadius: v })}
            />
            <Slider
              label="마우스 힘" value={plexusSettings.mouseForce}
              min={0.01} max={0.20} step={0.01} defaultVal={DEFAULTS.mouseForce}
              onChange={(v) => update({ mouseForce: v })}
            />
            <Slider
              label="글로우 강도" value={plexusSettings.glowIntensity}
              min={0} max={2.5} step={0.1} defaultVal={DEFAULTS.glowIntensity}
              onChange={(v) => update({ glowIntensity: v })}
            />
            <Slider
              label="연결 거리" value={plexusSettings.connectionDist}
              min={60} max={300} step={10} defaultVal={DEFAULTS.connectionDist}
              onChange={(v) => update({ connectionDist: v })}
            />
          </div>
        )}
      </div>

      <p className="text-[10px] text-text-secondary/40 mt-4">
        * 파티클 수가 많으면 성능에 영향을 줄 수 있습니다. 프리뷰 위에서 마우스를 움직여 보세요.
      </p>
    </SettingsSection>
  );
}
