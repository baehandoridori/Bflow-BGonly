import { useCallback, useRef, useEffect, useState } from 'react';
import { Sparkles, RotateCcw, ChevronDown } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { useAppStore } from '@/stores/useAppStore';
import { loadPreferences, savePreferences, type UserPreferences } from '@/services/settingsService';
import { cn } from '@/utils/cn';
import { StarNestBackground } from '@/components/effects/StarNestBackground';
import {
  DEFAULT_BACKGROUND_ART,
  DEFAULT_DASHBOARD_STAR_NEST_BLUR_PX,
  DEFAULT_DASHBOARD_STAR_NEST_OPACITY,
  DEFAULT_STAR_NEST_SETTINGS,
  STAR_NEST_TONE_PRESETS,
  applyStarNestTonePreset,
  getThemeSyncedStarNestSettings,
  normalizeBackgroundArt,
  normalizeDashboardStarNestBlurPx,
  normalizeDashboardStarNestOpacity,
  normalizeStarNestSettings,
  type BackgroundArt,
  type StarNestSettings,
  type StarNestDirectionMode,
  type StarNestTonePreset,
} from '@/utils/starNestSettings';

const DEFAULTS = {
  backgroundArt: DEFAULT_BACKGROUND_ART,
  loginBackgroundArt: DEFAULT_BACKGROUND_ART,
  dashboardBackgroundArt: DEFAULT_BACKGROUND_ART,
  loginEnabled: true,
  loginGradientEnabled: true,
  loginParticleCount: 666,
  dashboardEnabled: true,
  dashboardGradientEnabled: true,
  dashboardParticleCount: 120,
  globalGradientEnabled: true,
  speed: 1.0,
  mouseRadius: 250,
  mouseForce: 0.06,
  glowIntensity: 1.0,
  connectionDist: 160,
  starNest: DEFAULT_STAR_NEST_SETTINGS,
  loginStarNest: DEFAULT_STAR_NEST_SETTINGS,
  dashboardStarNest: DEFAULT_STAR_NEST_SETTINGS,
  dashboardStarNestOpacity: DEFAULT_DASHBOARD_STAR_NEST_OPACITY,
  dashboardStarNestBlurPx: DEFAULT_DASHBOARD_STAR_NEST_BLUR_PX,
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

    let lastTime = 0;
    const TARGET_FRAME_MS = 1000 / 60;

    const animate = (timestamp: number) => {
      const delta = lastTime ? timestamp - lastTime : TARGET_FRAME_MS;
      lastTime = timestamp;
      const dtFactor = Math.min(delta / TARGET_FRAME_MS, 3);

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

      // 물리 업데이트 (delta-time 정규화)
      const damp = Math.pow(0.985, dtFactor);
      for (const p of ps) {
        const dmx = p.x - mx;
        const dmy = p.y - my;
        const distMouse = Math.sqrt(dmx * dmx + dmy * dmy);
        if (distMouse < mRadius && distMouse > 1) {
          const force = (1 - distMouse / mRadius) * mForce;
          p.vx += (dmx / distMouse) * force * dtFactor;
          p.vy += (dmy / distMouse) * force * dtFactor;
        }
        p.vx *= damp;
        p.vy *= damp;
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const minSpd = 0.05 * s.speed;
        if (spd < minSpd) {
          const angle = Math.atan2(p.vy, p.vx) || Math.random() * Math.PI * 2;
          p.vx = Math.cos(angle) * minSpd;
          p.vy = Math.sin(angle) * minSpd;
        }
        p.x += p.vx * s.speed * dtFactor;
        p.y += p.vy * s.speed * dtFactor;
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

function MiniStarNestPreview({
  enabled,
  settings,
  opacity = 1,
  blurPx = 0,
}: {
  enabled: boolean;
  settings: StarNestSettings;
  opacity?: number;
  blurPx?: number;
}) {
  return (
    <div
      className="relative rounded-lg overflow-hidden border border-bg-border/30 my-2.5"
      style={{ width: '100%', aspectRatio: `${PREVIEW_W}/${PREVIEW_H}`, background: 'rgb(var(--color-bg-primary) / 0.6)' }}
    >
      {enabled ? (
        <StarNestBackground
          enabled
          fixed={false}
          settings={settings}
          style={{
            opacity,
            filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
            transform: blurPx > 0 ? 'scale(1.03)' : undefined,
            willChange: 'opacity, filter',
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-border/20">
          <span className="text-xs text-text-secondary/40 font-medium">OFF</span>
        </div>
      )}
    </div>
  );
}

function DirectionPad({
  x,
  y,
  onChange,
}: {
  x: number;
  y: number;
  onChange: (next: { directionX: number; directionY: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = Math.max(-1, Math.min(1, ((clientX - rect.left) / rect.width) * 2 - 1));
    const ny = Math.max(-1, Math.min(1, -(((clientY - rect.top) / rect.height) * 2 - 1)));
    onChange({
      directionX: Number(nx.toFixed(2)),
      directionY: Number(ny.toFixed(2)),
    });
  }, [onChange]);

  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-text-secondary/60 w-20 shrink-0 pt-2">이동 방향</span>
      <div className="flex-1">
        <div
          ref={ref}
          role="slider"
          aria-label="StarNest 수동 이동 방향"
          aria-valuetext={`X ${x.toFixed(2)}, Y ${y.toFixed(2)}`}
          tabIndex={0}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            updateFromPointer(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 1) return;
            updateFromPointer(e.clientX, e.clientY);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.04;
            if (e.key === 'ArrowLeft') onChange({ directionX: Math.max(-1, x - step), directionY: y });
            else if (e.key === 'ArrowRight') onChange({ directionX: Math.min(1, x + step), directionY: y });
            else if (e.key === 'ArrowUp') onChange({ directionX: x, directionY: Math.min(1, y + step) });
            else if (e.key === 'ArrowDown') onChange({ directionX: x, directionY: Math.max(-1, y - step) });
            else if (e.key === 'Home') onChange({ directionX: 0, directionY: 0 });
            else return;
            e.preventDefault();
          }}
          className="relative h-36 rounded-xl border border-bg-border/50 bg-bg-primary/70 overflow-hidden cursor-crosshair focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          <div
            className="absolute inset-0 opacity-70"
            style={{
              background:
                'radial-gradient(circle at center, rgb(var(--color-accent) / 0.18), transparent 28%), linear-gradient(90deg, transparent 49.5%, rgb(var(--color-bg-border) / 0.7) 49.5% 50.5%, transparent 50.5%), linear-gradient(0deg, transparent 49.5%, rgb(var(--color-bg-border) / 0.7) 49.5% 50.5%, transparent 50.5%)',
            }}
          />
          <div
            className="absolute rounded-full border border-accent/45"
            style={{
              width: 42,
              height: 42,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 16px rgb(var(--color-accent) / 0.15) inset',
            }}
          />
          <div
            className="absolute w-4 h-4 rounded-full bg-accent shadow-lg transition-[left,top] duration-150"
            style={{
              left: `${((x + 1) / 2) * 100}%`,
              top: `${((1 - y) / 2) * 100}%`,
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 0 5px rgb(var(--color-accent) / 0.16), 0 0 22px rgb(var(--color-accent) / 0.55)',
            }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-secondary/55">
          <span>가운데는 정지에 가깝게</span>
          <span className="font-mono">X {x.toFixed(2)} · Y {y.toFixed(2)}</span>
        </div>
      </div>
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

function formatSliderValue(value: number, step: number, precision?: number): string {
  if (typeof precision === 'number') {
    const text = value
      .toFixed(precision)
      .replace(/0+$/, '')
      .replace(/\.$/, '');
    return text.length > 0 ? text : '0';
  }
  return step < 1 ? value.toFixed(2) : String(value);
}

function Slider({ label, value, min, max, step, defaultVal, precision, onChange }: {
  label: string; value: number; min: number; max: number; step: number; defaultVal: number;
  precision?: number;
  onChange: (v: number) => void;
}) {
  const isModified = Math.abs(value - defaultVal) > step * 0.1;
  const valueText = formatSliderValue(value, step, precision);
  const defaultText = formatSliderValue(defaultVal, step, precision);
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
        {valueText}
      </span>
      {isModified && (
        <button
          onClick={() => onChange(defaultVal)}
          className="shrink-0 text-text-secondary/40 hover:text-accent transition-colors cursor-pointer"
          title={`기본값 (${defaultText})`}
        >
          <RotateCcw size={11} />
        </button>
      )}
    </div>
  );
}

function SegmentedButton<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex shrink-0 gap-1 p-1 rounded-lg bg-bg-primary border border-bg-border/40">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer',
            value === option.value
              ? 'bg-accent text-white shadow-sm'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/40',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

async function persistPlexus(plexus: typeof DEFAULTS) {
  const existing = await loadPreferences() ?? {};
  await savePreferences({ ...existing, plexus });
  // 다른 창(플로팅 위젯 포함)에 실시간 전파
  window.electronAPI?.preferencesBroadcastChange?.({ plexus });
}

async function persistSceneUi(patch: NonNullable<UserPreferences['sceneUi']>) {
  const existing = await loadPreferences() ?? {};
  const sceneUi = { ...(existing.sceneUi ?? {}), ...patch };
  await savePreferences({ ...existing, sceneUi });
  window.electronAPI?.preferencesBroadcastChange?.({ sceneUi });
}

/* ── 메인 섹션 ── */

export function EffectsSection() {
  const plexusSettings = useAppStore((s) => s.plexusSettings);
  const setPlexusSettings = useAppStore((s) => s.setPlexusSettings);
  const completionTintEnabled = useAppStore((s) => s.completionTintEnabled);
  const setCompletionTintEnabled = useAppStore((s) => s.setCompletionTintEnabled);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const loginBackgroundArt = plexusSettings.loginBackgroundArt ?? plexusSettings.backgroundArt ?? DEFAULT_BACKGROUND_ART;
  const dashboardBackgroundArt = plexusSettings.dashboardBackgroundArt ?? plexusSettings.backgroundArt ?? DEFAULT_BACKGROUND_ART;
  const usesStarNest = loginBackgroundArt === 'starnest' || dashboardBackgroundArt === 'starnest';
  const usesPlexus = loginBackgroundArt !== 'starnest' || dashboardBackgroundArt !== 'starnest';
  const starNest = normalizeStarNestSettings(plexusSettings.starNest);
  const loginStarNest = normalizeStarNestSettings(plexusSettings.loginStarNest ?? starNest);
  const dashboardStarNest = normalizeStarNestSettings(plexusSettings.dashboardStarNest ?? starNest);
  const dashboardStarNestOpacity = normalizeDashboardStarNestOpacity(plexusSettings.dashboardStarNestOpacity);
  const dashboardStarNestBlurPx = normalizeDashboardStarNestBlurPx(plexusSettings.dashboardStarNestBlurPx);

  const update = useCallback((partial: Partial<typeof DEFAULTS>) => {
    const legacy = normalizeStarNestSettings(partial.starNest ?? plexusSettings.starNest);
    const next = {
      ...plexusSettings,
      ...partial,
      backgroundArt: partial.backgroundArt ?? plexusSettings.backgroundArt,
      loginBackgroundArt: normalizeBackgroundArt(partial.loginBackgroundArt ?? plexusSettings.loginBackgroundArt ?? plexusSettings.backgroundArt),
      dashboardBackgroundArt: normalizeBackgroundArt(partial.dashboardBackgroundArt ?? plexusSettings.dashboardBackgroundArt ?? plexusSettings.backgroundArt),
      starNest: legacy,
      loginStarNest: normalizeStarNestSettings(partial.loginStarNest ?? plexusSettings.loginStarNest ?? legacy),
      dashboardStarNest: normalizeStarNestSettings(partial.dashboardStarNest ?? plexusSettings.dashboardStarNest ?? legacy),
      dashboardStarNestOpacity: normalizeDashboardStarNestOpacity(partial.dashboardStarNestOpacity ?? plexusSettings.dashboardStarNestOpacity),
      dashboardStarNestBlurPx: normalizeDashboardStarNestBlurPx(partial.dashboardStarNestBlurPx ?? plexusSettings.dashboardStarNestBlurPx),
    };
    setPlexusSettings(next);
    persistPlexus(next);
  }, [plexusSettings, setPlexusSettings]);

  const updateStarNest = useCallback((partial: Partial<StarNestSettings>) => {
    const nextSettings = normalizeStarNestSettings({
      ...plexusSettings.starNest,
      ...partial,
    });
    update({
      starNest: nextSettings,
      loginStarNest: nextSettings,
      dashboardStarNest: nextSettings,
    });
  }, [plexusSettings.starNest, update]);

  const applyTonePreset = useCallback((preset: StarNestTonePreset) => {
    const next = applyStarNestTonePreset(preset, starNest);
    updateStarNest(next);
  }, [starNest, updateStarNest]);

  const syncStarNestWithTheme = useCallback(() => {
    updateStarNest(getThemeSyncedStarNestSettings(getAccentRgb(), getAccentSubRgb(), starNest));
  }, [starNest, updateStarNest]);

  const updateSurfaceBackgroundArt = useCallback((surface: 'login' | 'dashboard', backgroundArt: BackgroundArt) => {
    const nextLoginBackgroundArt = surface === 'login' ? backgroundArt : loginBackgroundArt;
    const nextDashboardBackgroundArt = surface === 'dashboard' ? backgroundArt : dashboardBackgroundArt;
    update({
      loginBackgroundArt: nextLoginBackgroundArt,
      dashboardBackgroundArt: nextDashboardBackgroundArt,
      // 옛 버전/옛 코드가 하나의 값만 읽을 때는 실제 메인 화면인 대시보드 기준으로 맞춘다.
      backgroundArt: nextLoginBackgroundArt === nextDashboardBackgroundArt
        ? nextLoginBackgroundArt
        : nextDashboardBackgroundArt,
    });
  }, [dashboardBackgroundArt, loginBackgroundArt, update]);

  const handleReset = useCallback(() => {
    setPlexusSettings(DEFAULTS);
    persistPlexus(DEFAULTS);
  }, [setPlexusSettings]);

  const updateCompletionTint = useCallback((enabled: boolean) => {
    setCompletionTintEnabled(enabled);
    persistSceneUi({ completionTintEnabled: enabled });
  }, [setCompletionTintEnabled]);

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
      {/* 전체 화면 그라데이션 배경 (모든 뷰 공통) */}
      <div className="mb-5 pb-4 border-b border-bg-border/30">
        <div className="flex items-center justify-between gap-4 mb-4 pb-4 border-b border-bg-border/30">
          <div>
            <p className="text-sm font-medium text-text-primary">씬 완료 색상 표시</p>
            <p className="text-[11px] text-text-secondary/60 mt-0.5">
              완료된 씬 카드는 색을 더 강하게 틴트하고, 시트 뷰 행도 완료 색상으로 표시합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {completionTintEnabled !== true && (
              <button
                onClick={() => updateCompletionTint(true)}
                className="text-text-secondary/40 hover:text-accent transition-colors cursor-pointer"
                title="기본값 (ON)"
              >
                <RotateCcw size={11} />
              </button>
            )}
            <Toggle checked={completionTintEnabled} onChange={updateCompletionTint} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-text-primary">전체 화면 그라데이션 배경</p>
            <p className="text-[11px] text-text-secondary/60 mt-0.5">
              메인 앱, 로그인 화면, 플로팅 위젯 뒤에 부드러운 조명 배경을 표시합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(plexusSettings.globalGradientEnabled !== false) !== DEFAULTS.globalGradientEnabled && (
              <button
                onClick={() => update({ globalGradientEnabled: DEFAULTS.globalGradientEnabled })}
                className="text-text-secondary/40 hover:text-accent transition-colors cursor-pointer"
                title={`기본값 (${DEFAULTS.globalGradientEnabled ? 'ON' : 'OFF'})`}
              >
                <RotateCcw size={11} />
              </button>
            )}
            <Toggle
              checked={plexusSettings.globalGradientEnabled !== false}
              onChange={(v) => update({ globalGradientEnabled: v })}
            />
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-bg-border/30">
          <div className="mb-3">
            <p className="text-sm font-medium text-text-primary">화면별 배경 아트</p>
            <p className="text-[11px] text-text-secondary/60 mt-0.5">
              로그인 화면과 대시보드 화면에서 플렉서스와 StarNest를 각각 선택합니다.
            </p>
          </div>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bg-border/35 bg-bg-primary/45 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-text-primary">로그인 화면</p>
                <p className="text-[10px] text-text-secondary/55 mt-0.5">앱에 들어오기 전 첫 화면</p>
              </div>
              <SegmentedButton<BackgroundArt>
                value={loginBackgroundArt}
                options={[
                  { value: 'plexus', label: '플렉서스' },
                  { value: 'starnest', label: 'StarNest' },
                ]}
                onChange={(backgroundArt) => updateSurfaceBackgroundArt('login', backgroundArt)}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bg-border/35 bg-bg-primary/45 px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-text-primary">대시보드 화면</p>
                <p className="text-[10px] text-text-secondary/55 mt-0.5">로그인 뒤 기본 작업 화면</p>
              </div>
              <SegmentedButton<BackgroundArt>
                value={dashboardBackgroundArt}
                options={[
                  { value: 'plexus', label: '플렉서스' },
                  { value: 'starnest', label: 'StarNest' },
                ]}
                onChange={(backgroundArt) => updateSurfaceBackgroundArt('dashboard', backgroundArt)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 로그인 플렉서스 */}
      <div className="mb-5">
        <div className="flex items-center justify-between gap-4 mb-1">
          <div>
            <p className="text-sm font-medium text-text-primary">로그인 배경 애니메이션</p>
            <p className="text-[11px] text-text-secondary/60 mt-0.5">로그인 화면에 표시되는 배경 효과</p>
          </div>
          <div className="flex items-center gap-2">
            {plexusSettings.loginEnabled !== DEFAULTS.loginEnabled && (
              <button
                onClick={() => update({ loginEnabled: DEFAULTS.loginEnabled })}
                className="text-text-secondary/40 hover:text-accent transition-colors cursor-pointer"
                title={`기본값 (${DEFAULTS.loginEnabled ? 'ON' : 'OFF'})`}
              >
                <RotateCcw size={11} />
              </button>
            )}
            <Toggle checked={plexusSettings.loginEnabled} onChange={(v) => update({ loginEnabled: v })} />
          </div>
        </div>

        {loginBackgroundArt === 'starnest' ? (
          <MiniStarNestPreview enabled={plexusSettings.loginEnabled} settings={loginStarNest} />
        ) : (
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
        )}

        {plexusSettings.loginEnabled && loginBackgroundArt !== 'starnest' && (
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
            <p className="text-[11px] text-text-secondary/60 mt-0.5">대시보드 화면에 표시되는 배경 효과</p>
          </div>
          <div className="flex items-center gap-2">
            {plexusSettings.dashboardEnabled !== DEFAULTS.dashboardEnabled && (
              <button
                onClick={() => update({ dashboardEnabled: DEFAULTS.dashboardEnabled })}
                className="text-text-secondary/40 hover:text-accent transition-colors cursor-pointer"
                title={`기본값 (${DEFAULTS.dashboardEnabled ? 'ON' : 'OFF'})`}
              >
                <RotateCcw size={11} />
              </button>
            )}
            <Toggle checked={plexusSettings.dashboardEnabled} onChange={(v) => update({ dashboardEnabled: v })} />
          </div>
        </div>

        {dashboardBackgroundArt === 'starnest' ? (
          <MiniStarNestPreview
            enabled={plexusSettings.dashboardEnabled}
            settings={dashboardStarNest}
            opacity={dashboardStarNestOpacity}
            blurPx={dashboardStarNestBlurPx}
          />
        ) : (
          <MiniPlexusPreview
            particleCount={plexusSettings.dashboardParticleCount}
            enabled={plexusSettings.dashboardEnabled}
            speed={plexusSettings.speed}
            mouseRadius={plexusSettings.mouseRadius}
            mouseForce={plexusSettings.mouseForce}
            glowIntensity={plexusSettings.glowIntensity}
            connectionDist={plexusSettings.connectionDist}
          />
        )}

        {plexusSettings.dashboardEnabled && dashboardBackgroundArt === 'starnest' && (
          <div className="flex flex-col gap-2.5 pl-1">
            <Slider
              label="불투명도" value={dashboardStarNestOpacity}
              min={0.2} max={1} step={0.05} defaultVal={DEFAULTS.dashboardStarNestOpacity}
              precision={2}
              onChange={(v) => update({ dashboardStarNestOpacity: v })}
            />
            <Slider
              label="블러" value={dashboardStarNestBlurPx}
              min={0} max={20} step={1} defaultVal={DEFAULTS.dashboardStarNestBlurPx}
              onChange={(v) => update({ dashboardStarNestBlurPx: v })}
            />
          </div>
        )}

        {plexusSettings.dashboardEnabled && dashboardBackgroundArt !== 'starnest' && (
          <Slider
            label="파티클 수" value={plexusSettings.dashboardParticleCount}
            min={30} max={300} step={10} defaultVal={DEFAULTS.dashboardParticleCount}
            onChange={(v) => update({ dashboardParticleCount: v })}
          />
        )}
      </div>

      {usesStarNest && (
        <div className="border-t border-bg-border/30 mt-5 pt-5">
          <div className="mb-3">
            <div>
              <p className="text-sm font-medium text-text-primary">StarNest 세부 설정</p>
              <p className="text-[11px] text-text-secondary/60 mt-0.5">
                StarNest를 선택한 화면에 공통으로 적용합니다. 마우스는 좌표가 아니라 방향과 강도만 만듭니다.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            {(Object.keys(STAR_NEST_TONE_PRESETS) as StarNestTonePreset[]).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyTonePreset(preset)}
                className="px-2.5 py-1.5 rounded-lg border border-bg-border/45 bg-bg-primary/70 text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
              >
                {STAR_NEST_TONE_PRESETS[preset].label}
              </button>
            ))}
            <button
              type="button"
              onClick={syncStarNestWithTheme}
              className="px-2.5 py-1.5 rounded-lg border border-accent/25 bg-accent/10 text-xs font-semibold text-accent hover:bg-accent/18 transition-colors"
            >
              현재 테마와 동기화
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <p className="text-xs font-semibold text-text-primary">흐름 방식</p>
              <p className="text-[10px] text-text-secondary/55 mt-0.5">
                수동 모드에서는 아래 가상 화면에서 방향을 잡습니다.
              </p>
            </div>
            <SegmentedButton<StarNestDirectionMode>
              value={starNest.directionMode}
              options={[
                { value: 'mouse', label: '마우스' },
                { value: 'fixed', label: '현재' },
                { value: 'manual', label: '수동' },
              ]}
              onChange={(directionMode) => updateStarNest({ directionMode })}
            />
          </div>

          <div className="flex flex-col gap-2.5 pl-1">
            {starNest.directionMode === 'manual' && (
              <DirectionPad
                x={starNest.directionX}
                y={starNest.directionY}
                onChange={updateStarNest}
              />
            )}
            <Slider
              label="최대 속도" value={starNest.maxSpeed}
              min={0} max={0.002} step={0.0001} defaultVal={DEFAULT_STAR_NEST_SETTINGS.maxSpeed}
              precision={4}
              onChange={(v) => updateStarNest({ maxSpeed: v })}
            />
            <Slider
              label="밝기" value={starNest.brightness}
              min={0.0002} max={0.006} step={0.0001} defaultVal={DEFAULT_STAR_NEST_SETTINGS.brightness}
              precision={4}
              onChange={(v) => updateStarNest({ brightness: v })}
            />
            <Slider
              label="채도" value={starNest.saturation}
              min={0} max={1} step={0.01} defaultVal={DEFAULT_STAR_NEST_SETTINGS.saturation}
              onChange={(v) => updateStarNest({ saturation: v })}
            />
            <Slider
              label="색상" value={starNest.colorShift}
              min={-1} max={1} step={0.01} defaultVal={DEFAULT_STAR_NEST_SETTINGS.colorShift}
              onChange={(v) => updateStarNest({ colorShift: v })}
            />
            <Slider
              label="반짝임" value={starNest.sparkle}
              min={0} max={1} step={0.01} defaultVal={DEFAULT_STAR_NEST_SETTINGS.sparkle}
              onChange={(v) => updateStarNest({ sparkle: v })}
            />
            <Slider
              label="반짝임 속도" value={starNest.sparkleSpeed}
              min={0.1} max={3} step={0.1} defaultVal={DEFAULT_STAR_NEST_SETTINGS.sparkleSpeed}
              onChange={(v) => updateStarNest({ sparkleSpeed: v })}
            />
            <Slider
              label="깊이" value={starNest.zoom}
              min={0.55} max={0.95} step={0.01} defaultVal={DEFAULT_STAR_NEST_SETTINGS.zoom}
              onChange={(v) => updateStarNest({ zoom: v })}
            />
            <Slider
              label="빈 공간" value={starNest.darkmatter}
              min={0.2} max={0.62} step={0.01} defaultVal={DEFAULT_STAR_NEST_SETTINGS.darkmatter}
              onChange={(v) => updateStarNest({ darkmatter: v })}
            />
            <Slider
              label="거리감" value={starNest.distfade}
              min={0.58} max={0.82} step={0.01} defaultVal={DEFAULT_STAR_NEST_SETTINGS.distfade}
              onChange={(v) => updateStarNest({ distfade: v })}
            />
            <Slider
              label="디테일" value={starNest.iterations}
              min={10} max={22} step={1} defaultVal={DEFAULT_STAR_NEST_SETTINGS.iterations}
              onChange={(v) => updateStarNest({ iterations: v })}
            />
            <Slider
              label="품질" value={starNest.quality}
              min={8} max={20} step={1} defaultVal={DEFAULT_STAR_NEST_SETTINGS.quality}
              onChange={(v) => updateStarNest({ quality: v })}
            />
          </div>
        </div>
      )}

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
            {!usesPlexus ? (
              <p className="text-[11px] text-text-secondary/60">
                StarNest 조절값은 위 전용 패널에서 바로 수정합니다.
              </p>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}
      </div>

      <p className="text-[10px] text-text-secondary/40 mt-4">
        * 배경 효과가 무겁게 느껴지면 품질/디테일 또는 파티클 수를 낮춰주세요. 프리뷰 위에서 마우스를 움직여 보세요.
      </p>
    </SettingsSection>
  );
}
