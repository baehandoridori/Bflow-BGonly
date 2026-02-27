import { useCallback, useRef, useEffect } from 'react';
import { Sparkles, RotateCcw } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { useAppStore } from '@/stores/useAppStore';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import { cn } from '@/utils/cn';

const DEFAULTS = {
  loginEnabled: true,
  loginParticleCount: 666,
  dashboardEnabled: true,
  dashboardParticleCount: 120,
};

/* ── 미니 플렉서스 프리뷰 ── */

const PREVIEW_W = 320;
const PREVIEW_H = 180;
const CONN_DIST = 55;

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

function createMiniParticles(count: number): MiniParticle[] {
  const accent = getAccentRgb();
  const sub = getAccentSubRgb();
  const colors: [number, number, number][] = [accent, accent, sub];
  return Array.from({ length: count }, () => {
    const speed = 0.15 + Math.random() * 0.3;
    const angle = Math.random() * Math.PI * 2;
    return {
      x: Math.random() * PREVIEW_W,
      y: Math.random() * PREVIEW_H,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 1 + Math.random() * 1.5,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });
}

function MiniPlexusPreview({ particleCount, enabled }: { particleCount: number; enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const particlesRef = useRef<MiniParticle[]>([]);

  const displayCount = Math.max(6, Math.min(Math.round(particleCount / 15), 45));

  useEffect(() => {
    if (!enabled) { cancelAnimationFrame(rafRef.current); return; }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;
    particlesRef.current = createMiniParticles(displayCount);

    const animate = () => {
      const ps = particlesRef.current;
      ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);

      // update
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = PREVIEW_W;
        if (p.x > PREVIEW_W) p.x = 0;
        if (p.y < 0) p.y = PREVIEW_H;
        if (p.y > PREVIEW_H) p.y = 0;
      }

      // connections
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = ps[i].x - ps[j].x;
          const dy = ps[i].y - ps[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONN_DIST) {
            const alpha = (1 - dist / CONN_DIST) * 0.4;
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

      // particles
      for (const p of ps) {
        const [r, g, b] = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, displayCount]);

  return (
    <div className="relative rounded-lg overflow-hidden border border-bg-border/30 my-2.5"
      style={{ width: '100%', aspectRatio: `${PREVIEW_W}/${PREVIEW_H}`, background: 'rgb(var(--color-bg-primary) / 0.6)' }}
    >
      {enabled ? (
        <canvas ref={canvasRef} className="w-full h-full" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-border/20">
          <span className="text-xs text-text-secondary/40 font-medium">OFF</span>
        </div>
      )}
    </div>
  );
}

/* ── 토글 ── */

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

async function persistPlexus(plexus: typeof DEFAULTS) {
  const existing = await loadPreferences() ?? {};
  await savePreferences({ ...existing, plexus });
}

export function EffectsSection() {
  const plexusSettings = useAppStore((s) => s.plexusSettings);
  const setPlexusSettings = useAppStore((s) => s.setPlexusSettings);

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
          <Toggle
            checked={plexusSettings.loginEnabled}
            onChange={(v) => update({ loginEnabled: v })}
          />
        </div>

        <MiniPlexusPreview
          particleCount={plexusSettings.loginParticleCount}
          enabled={plexusSettings.loginEnabled}
        />

        {plexusSettings.loginEnabled && (
          <div className="flex items-center gap-3 ml-1 mt-1">
            <span className="text-xs text-text-secondary/60 w-16 shrink-0">파티클 수</span>
            <input
              type="range"
              min={100}
              max={1500}
              step={50}
              value={plexusSettings.loginParticleCount}
              onChange={(e) => update({ loginParticleCount: Number(e.target.value) })}
              className="flex-1 h-1.5 bg-bg-border rounded-full appearance-none cursor-pointer accent-accent"
            />
            <span className={cn(
              'text-xs font-mono w-12 text-right',
              plexusSettings.loginParticleCount !== DEFAULTS.loginParticleCount
                ? 'text-accent' : 'text-text-secondary/60',
            )}>
              {plexusSettings.loginParticleCount}
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-bg-border/30 pt-5">
        {/* 대시보드 플렉서스 */}
        <div className="flex items-center justify-between gap-4 mb-1">
          <div>
            <p className="text-sm font-medium text-text-primary">대시보드 배경 애니메이션</p>
            <p className="text-[11px] text-text-secondary/60 mt-0.5">대시보드의 은은한 파티클 효과</p>
          </div>
          <Toggle
            checked={plexusSettings.dashboardEnabled}
            onChange={(v) => update({ dashboardEnabled: v })}
          />
        </div>

        <MiniPlexusPreview
          particleCount={plexusSettings.dashboardParticleCount}
          enabled={plexusSettings.dashboardEnabled}
        />

        {plexusSettings.dashboardEnabled && (
          <div className="flex items-center gap-3 ml-1 mt-1">
            <span className="text-xs text-text-secondary/60 w-16 shrink-0">파티클 수</span>
            <input
              type="range"
              min={30}
              max={300}
              step={10}
              value={plexusSettings.dashboardParticleCount}
              onChange={(e) => update({ dashboardParticleCount: Number(e.target.value) })}
              className="flex-1 h-1.5 bg-bg-border rounded-full appearance-none cursor-pointer accent-accent"
            />
            <span className={cn(
              'text-xs font-mono w-12 text-right',
              plexusSettings.dashboardParticleCount !== DEFAULTS.dashboardParticleCount
                ? 'text-accent' : 'text-text-secondary/60',
            )}>
              {plexusSettings.dashboardParticleCount}
            </span>
          </div>
        )}
      </div>

      <p className="text-[10px] text-text-secondary/40 mt-4">
        * 파티클 수가 많으면 성능에 영향을 줄 수 있습니다
      </p>
    </SettingsSection>
  );
}
