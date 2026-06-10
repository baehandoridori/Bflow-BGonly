import { type CSSProperties, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import {
  DEFAULT_BFLOW_STAR_NEST_SETTINGS,
  normalizeBflowStarNestSettings,
  type BflowStarNestSettings,
} from '@/utils/starNestSettings';
import { cn } from '@/utils/cn';

interface BflowStar {
  x: number;
  y: number;
  z: number;
  r: number;
  drift: number;
  sparkle: number;
  phase: number;
  tint: number;
}

interface BflowRenderedStar {
  x: number;
  y: number;
  alpha: number;
  radius: number;
  longRadius: number;
  shortRadius: number;
  flowAngle: number;
  tint: number;
  z: number;
  sparklePulse: number;
  cursorDistance: number;
  cursorLinkDepth?: number;
  linkStrength: number;
}

interface BflowCursorTrailParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  r: number;
  alpha: number;
  tint: number;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function hslaColor(hue: number, saturation: number, lightness: number, alpha: number): string {
  return `hsla(${Math.round(wrapHue(hue))}, ${Math.round(clampNumber(saturation, 0, 100))}%, ${Math.round(clampNumber(lightness, 0, 100))}%, ${clampNumber(alpha, 0, 1)})`;
}

export function BflowStarNestBackground({
  enabled = true,
  className,
  fixed = true,
  settings: settingsOverride,
  scheme,
  style,
}: {
  enabled?: boolean;
  className?: string;
  fixed?: boolean;
  settings?: Partial<BflowStarNestSettings> | null;
  scheme?: 'dark' | 'light';
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const colorMode = useAppStore((s) => s.colorMode);
  const resolvedScheme = scheme ?? colorMode;
  const settings = normalizeBflowStarNestSettings(settingsOverride ?? DEFAULT_BFLOW_STAR_NEST_SETTINGS);
  const settingsRef = useRef(settings);
  const schemeRef = useRef(resolvedScheme);
  settingsRef.current = settings;
  schemeRef.current = resolvedScheme;

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const stars: BflowStar[] = [];
    const renderedStars: BflowRenderedStar[] = [];
    const trailParticles: BflowCursorTrailParticle[] = [];
    let pointer = { x: 0.5, y: 0.5 };
    const cursor = { x: -9999, y: -9999, active: false };
    const flow = { x: 0, y: 0, edge: 0, speed: 0 };
    const smoothFlow = { x: 0.12, y: 0.06, edge: Math.hypot(0.12, 0.06), speed: 0 };
    const driftTarget = { x: 0, y: 0, edge: 0 };
    const smoothDrift = { x: 0, y: 0, edge: 0 };
    const offset = { x: 0, y: 0 };
    let lastPointerEvent: { x: number; y: number; time: number } | null = null;
    let lastNow = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.8);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars.length = 0;
      const count = Math.max(420, Math.floor((rect.width * rect.height) / 620));
      for (let i = 0; i < count; i += 1) {
        stars.push({
          x: Math.random() * rect.width,
          y: Math.random() * rect.height,
          z: Math.random(),
          r: 0.78 + Math.random() * 1.95,
          drift: 0.14 + Math.random() * 0.58,
          sparkle: Math.random(),
          phase: Math.random() * Math.PI * 2,
          tint: i % 3,
        });
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      pointer = {
        x: event.clientX / Math.max(1, window.innerWidth),
        y: event.clientY / Math.max(1, window.innerHeight),
      };

      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      cursor.x = cursorX;
      cursor.y = cursorY;
      cursor.active = cursorX >= 0 && cursorX <= rect.width && cursorY >= 0 && cursorY <= rect.height;
      const localX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      const localY = -(((event.clientY - rect.top) / rect.height - 0.5) * 2);
      const localDistance = Math.min(1, Math.hypot(localX, localY));
      const deadzone = 0.16;
      const edge = Math.max(0, (localDistance - deadzone) / (1 - deadzone));
      const easedEdge = edge * edge * (3 - 2 * edge);
      driftTarget.x = localDistance > 0.001 ? (localX / localDistance) * easedEdge : 0;
      driftTarget.y = localDistance > 0.001 ? (localY / localDistance) * easedEdge : 0;
      driftTarget.edge = easedEdge;

      const now = event.timeStamp || performance.now();
      if (lastPointerEvent) {
        const dt = Math.max(12, now - lastPointerEvent.time);
        const dx = event.clientX - lastPointerEvent.x;
        const dy = event.clientY - lastPointerEvent.y;
        const distance = Math.hypot(dx, dy);
        const speed = Math.min(1, distance / dt / 1.2);
        if (distance > 0.2) {
          const eased = speed * speed * (3 - 2 * speed);
          flow.x = dx / distance;
          flow.y = -dy / distance;
          flow.edge = eased;
          flow.speed = eased;

          const current = settingsRef.current;
          if (cursor.active && current.cursorTrailParticlesEnabled && current.cursorTrailIntensity > 0) {
            const density = Math.max(0, Math.min(1, current.cursorTrailIntensity));
            const spawnCount = Math.min(5, Math.max(1, Math.round((distance / 34) * (0.45 + density * 1.85))));
            for (let i = 0; i < spawnCount; i += 1) {
              const spread = 4 + density * 10;
              trailParticles.push({
                x: cursor.x + (Math.random() - 0.5) * spread,
                y: cursor.y + (Math.random() - 0.5) * spread,
                vx: (-dx / dt) * (12 + Math.random() * 18) + (Math.random() - 0.5) * 16,
                vy: (-dy / dt) * (12 + Math.random() * 18) + (Math.random() - 0.5) * 16,
                age: 0,
                life: current.cursorTrailLifetime * (0.72 + Math.random() * 0.44),
                r: 0.8 + Math.random() * (1.1 + density * 1.6),
                alpha: 0.18 + density * 0.42,
                tint: Math.floor(Math.random() * 3),
              });
            }
            if (trailParticles.length > 120) {
              trailParticles.splice(0, trailParticles.length - 120);
            }
          }
        }
      }
      lastPointerEvent = { x: event.clientX, y: event.clientY, time: now };
    };

    const draw = (now: number) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const current = settingsRef.current;
      const intensity = Math.pow(Math.max(0, Math.min(1, current.intensity)), 0.72);
      const particleSpeed = current.particleSpeed;
      const colorHue = current.colorHue;
      const colorSaturation = current.colorSaturation;
      const colorBrightness = current.colorBrightness;
      const hazeStrength = current.hazeStrength;
      const isDark = schemeRef.current === 'dark';
      const hueA = wrapHue(colorHue);
      const hueB = wrapHue(colorHue + 34);
      const hueC = wrapHue(colorHue + 76);
      const toneSaturation = 72 * colorSaturation;
      const light = (base: number) => clampNumber(base * colorBrightness, 3, 96);
      const dt = lastNow ? Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000)) : 0.016;
      lastNow = now;
      const follow = 1 - Math.exp(-dt * 4.2);
      smoothFlow.x += (flow.x - smoothFlow.x) * follow;
      smoothFlow.y += (flow.y - smoothFlow.y) * follow;
      smoothFlow.edge += (flow.edge - smoothFlow.edge) * follow;
      smoothFlow.speed += (flow.speed - smoothFlow.speed) * follow;
      flow.speed *= Math.exp(-dt * 2.8);
      flow.edge *= Math.exp(-dt * 2.2);

      const driftFollow = 1 - Math.exp(-dt * 2.2);
      smoothDrift.x += (driftTarget.x - smoothDrift.x) * driftFollow;
      smoothDrift.y += (driftTarget.y - smoothDrift.y) * driftFollow;
      smoothDrift.edge += (driftTarget.edge - smoothDrift.edge) * driftFollow;
      const driftMagnitude = Math.hypot(smoothDrift.x, smoothDrift.y);
      const driftNx = driftMagnitude > 0.001 ? smoothDrift.x / driftMagnitude : 0;
      const driftNy = driftMagnitude > 0.001 ? smoothDrift.y / driftMagnitude : 0;
      const trailMagnitude = Math.hypot(smoothFlow.x, smoothFlow.y);
      const trailNx = trailMagnitude > 0.001 ? smoothFlow.x / trailMagnitude : driftNx;
      const trailNy = trailMagnitude > 0.001 ? smoothFlow.y / trailMagnitude : driftNy;
      const movement = Math.max(smoothFlow.edge, smoothFlow.speed);
      const driftForce = Math.max(0, smoothDrift.edge);
      const driftSpeed = (isDark ? 30 : 34) * intensity * particleSpeed * (driftForce * 1.08 + movement * 0.35);
      offset.x += driftNx * driftSpeed * dt;
      offset.y += driftNy * driftSpeed * dt;

      const bg = ctx.createLinearGradient(0, 0, rect.width, rect.height);
      if (isDark) {
        bg.addColorStop(0, hslaColor(hueA - 12, 34 * colorSaturation, light(7), 1));
        bg.addColorStop(1, hslaColor(hueA + 18, 42 * colorSaturation, light(13), 1));
      } else {
        bg.addColorStop(0, hslaColor(hueA - 8, 54 * colorSaturation, light(91), 1));
        bg.addColorStop(0.58, hslaColor(hueB, 36 * colorSaturation, light(98), 1));
        bg.addColorStop(1, hslaColor(hueA + 12, 46 * colorSaturation, light(88), 1));
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.globalCompositeOperation = isDark ? 'lighter' : 'source-over';

      if (intensity > 0) {
        const hazeBaseAlpha = (isDark ? 0.18 : 0.12) * hazeStrength;
        const haze1 = ctx.createRadialGradient(rect.width * 0.18, rect.height * 0.04, 0, rect.width * 0.18, rect.height * 0.04, rect.width * 0.76);
        haze1.addColorStop(0, hslaColor(hueA, toneSaturation, light(isDark ? 58 : 66), hazeBaseAlpha * intensity));
        haze1.addColorStop(1, hslaColor(hueA, toneSaturation, light(isDark ? 58 : 66), 0));
        ctx.fillStyle = haze1;
        ctx.fillRect(0, 0, rect.width, rect.height);

        const haze2 = ctx.createRadialGradient(rect.width * 0.82, rect.height * 0.18, 0, rect.width * 0.82, rect.height * 0.18, rect.width * 0.6);
        haze2.addColorStop(0, hslaColor(hueB, toneSaturation * 0.92, light(isDark ? 62 : 58), hazeBaseAlpha * 0.82 * intensity));
        haze2.addColorStop(1, hslaColor(hueB, toneSaturation * 0.92, light(isDark ? 62 : 58), 0));
        ctx.fillStyle = haze2;
        ctx.fillRect(0, 0, rect.width, rect.height);
      }

      const px = (pointer.x - 0.5) * 22;
      const py = (pointer.y - 0.5) * 16;
      const activeX = movement > 0.06 ? trailNx : driftNx;
      const activeY = movement > 0.06 ? trailNy : driftNy;
      const visualFlowX = -activeX;
      const visualFlowY = -activeY;
      const flowAngle = Math.atan2(-visualFlowY, visualFlowX);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      renderedStars.length = 0;
      for (const star of stars) {
        if (intensity <= 0) break;
        const depth = 0.35 + star.z * 0.95;
        const rawX = star.x - offset.x * depth - px * star.z + Math.sin(now * 0.0009 + star.phase) * star.drift;
        const rawY = star.y + offset.y * depth - py * star.z + Math.cos(now * 0.0007 + star.phase) * star.drift;
        const x = ((rawX % rect.width) + rect.width) % rect.width;
        const y = ((rawY % rect.height) + rect.height) % rect.height;
        const twinkle = 0.74 + Math.sin(now * 0.0024 + star.phase) * 0.18;
        const sparklePulse = star.sparkle > 0.82 ? Math.max(0, Math.sin(now * 0.0048 + star.phase * 1.7)) : 0;
        const alphaBase = isDark ? 0.78 : 0.84;
        const cursorReactionRadius = current.cursorReactionRadius;
        const cursorDistance = cursor.active ? Math.hypot(x - cursor.x, y - cursor.y) : Infinity;
        const reactionStrength = current.cursorReactionEnabled && cursorDistance < cursorReactionRadius
          ? (1 - cursorDistance / cursorReactionRadius) * intensity
          : 0;
        const alpha = Math.max(0, Math.min(
            1,
            alphaBase * intensity * (0.24 + star.z * 0.72) * twinkle
              + sparklePulse * 0.18
              + reactionStrength * current.cursorGlowStrength * 0.56,
          ));
        const radius = star.r * (isDark ? 1.08 : 1.18) * (1 + reactionStrength * current.cursorScaleStrength * 1.35);
        const longRadius = radius;
        const shortRadius = radius;
        const cursorLinkRadius = current.cursorLinkRadius;
        const linkStrength = current.cursorLinksEnabled && cursorDistance < cursorLinkRadius
          ? (1 - cursorDistance / cursorLinkRadius) * current.cursorLinkOpacity * intensity
          : 0;
        renderedStars.push({
          x,
          y,
          alpha,
          radius,
          longRadius,
          shortRadius,
          flowAngle,
          tint: star.tint,
          z: star.z,
          sparklePulse,
          cursorDistance,
          linkStrength,
        });
      }

      if (trailParticles.length > 0) {
        const trailColors = [
          { hue: hueA, saturation: toneSaturation, lightness: light(isDark ? 70 : 52) },
          { hue: hueB, saturation: toneSaturation * 0.95, lightness: light(isDark ? 66 : 48) },
          { hue: hueC, saturation: toneSaturation * 0.88, lightness: light(isDark ? 72 : 54) },
        ];
        for (let i = trailParticles.length - 1; i >= 0; i -= 1) {
          const particle = trailParticles[i];
          particle.age += dt;
          if (particle.age >= particle.life) {
            trailParticles.splice(i, 1);
            continue;
          }
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          const t = Math.max(0, 1 - particle.age / particle.life);
          const alpha = particle.alpha * t * intensity;
          const radius = particle.r * (0.75 + t * 0.7);
          const trailColor = trailColors[particle.tint];
          ctx.fillStyle = hslaColor(trailColor.hue, trailColor.saturation, trailColor.lightness, alpha);
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (cursor.active && current.cursorLinksEnabled && current.cursorLinkOpacity > 0) {
        const cursorLinkReachRadius = current.cursorLinkRadius;
        const cursorLinkSegmentMax = Math.min(220, Math.max(120, current.cursorLinkRadius * 0.72));
        const cursorLinkCandidates = renderedStars
          .filter((star) => star.linkStrength > 0.006 && star.cursorDistance <= cursorLinkReachRadius)
          .sort((a, b) => a.cursorDistance - b.cursorDistance)
          .slice(0, Math.min(72, Math.max(28, Math.round(current.cursorLinkRadius / 5))));
        const cursorAreaAlpha = Math.min(0.18, current.cursorLinkOpacity * intensity * 0.16);
        if (cursorAreaAlpha > 0) {
          const cursorArea = ctx.createRadialGradient(cursor.x, cursor.y, 0, cursor.x, cursor.y, cursorLinkReachRadius);
          cursorArea.addColorStop(0, hslaColor(hueA, toneSaturation, light(isDark ? 70 : 56), cursorAreaAlpha * 0.56));
          cursorArea.addColorStop(0.72, hslaColor(hueA, toneSaturation, light(isDark ? 70 : 56), cursorAreaAlpha * 0.16));
          cursorArea.addColorStop(1, hslaColor(hueA, toneSaturation, light(isDark ? 70 : 56), 0));
          ctx.fillStyle = cursorArea;
          ctx.fillRect(
            cursor.x - cursorLinkReachRadius,
            cursor.y - cursorLinkReachRadius,
            cursorLinkReachRadius * 2,
            cursorLinkReachRadius * 2,
          );
        }

        for (const star of cursorLinkCandidates) {
          star.cursorLinkDepth = undefined;
        }

        const cursorSeedRadius = Math.min(cursorLinkSegmentMax, Math.max(72, current.cursorLinkRadius * 0.36));
        const cursorLinkSeedsInRadius = cursorLinkCandidates
          .filter((star) => star.cursorDistance <= cursorSeedRadius)
          .slice(0, 10);
        const cursorLinkSeeds = cursorLinkCandidates.length > 0 && cursorLinkSeedsInRadius.length === 0
          ? cursorLinkCandidates.slice(0, 4)
          : cursorLinkSeedsInRadius;

        const drawnCursorLinks = new Set<string>();
        const maxCursorLinkPairs = 84;
        let cursorLinkPairs = 0;
        for (let i = 0; i < cursorLinkSeeds.length; i += 1) {
          const seed = cursorLinkSeeds[i];
          seed.cursorLinkDepth = 0;
          const seedAlpha = (1 - Math.min(1, seed.cursorDistance / cursorSeedRadius))
            * seed.linkStrength
            * 0.72;
          if (seedAlpha > 0.006) {
            ctx.strokeStyle = hslaColor(hueA, toneSaturation * 0.92, light(isDark ? 74 : 54), seedAlpha);
            ctx.lineWidth = 0.48 + seed.z * 0.24;
            ctx.beginPath();
            ctx.moveTo(cursor.x, cursor.y);
            ctx.lineTo(seed.x, seed.y);
            ctx.stroke();
            cursorLinkPairs += 1;
          }
        }

        let cursorLinkFrontier = cursorLinkSeeds;
        cursorLinks: for (let depth = 0; depth < 3; depth += 1) {
          const nextFrontier: BflowRenderedStar[] = [];
          for (let i = 0; i < cursorLinkFrontier.length; i += 1) {
            const source = cursorLinkFrontier[i];
            for (let j = 0; j < cursorLinkCandidates.length; j += 1) {
              const target = cursorLinkCandidates[j];
              if (source === target) continue;
              const pairKey = source.cursorDistance < target.cursorDistance
                ? `${source.x.toFixed(1)}:${source.y.toFixed(1)}-${target.x.toFixed(1)}:${target.y.toFixed(1)}`
                : `${target.x.toFixed(1)}:${target.y.toFixed(1)}-${source.x.toFixed(1)}:${source.y.toFixed(1)}`;
              if (drawnCursorLinks.has(pairKey)) continue;
              const dx = source.x - target.x;
              const dy = source.y - target.y;
              const dist = Math.hypot(dx, dy);
              if (dist > cursorLinkSegmentMax) continue;
              const reachFalloff = 1 - Math.max(source.cursorDistance, target.cursorDistance) / cursorLinkReachRadius;
              const segmentFalloff = 1 - dist / cursorLinkSegmentMax;
              const depthFalloff = 1 - depth * 0.18;
              const alpha = segmentFalloff
                * Math.max(0.18, reachFalloff)
                * current.cursorLinkOpacity
                * intensity
                * depthFalloff
                * 0.78;
              if (alpha <= 0.006) continue;
              drawnCursorLinks.add(pairKey);
              if (target.cursorLinkDepth === undefined) {
                target.cursorLinkDepth = depth + 1;
                nextFrontier.push(target);
              }
              ctx.strokeStyle = hslaColor(hueA, toneSaturation * 0.88, light(isDark ? 72 : 52), alpha);
              ctx.lineWidth = 0.42 + Math.min(source.z, target.z) * 0.24;
              ctx.beginPath();
              ctx.moveTo(source.x, source.y);
              ctx.lineTo(target.x, target.y);
              ctx.stroke();
              cursorLinkPairs += 1;
              if (cursorLinkPairs >= maxCursorLinkPairs) break cursorLinks;
            }
          }
          if (nextFrontier.length === 0) break;
          cursorLinkFrontier = nextFrontier
            .sort((a, b) => b.linkStrength - a.linkStrength)
            .slice(0, 28);
        }
      }

      for (const star of renderedStars) {
        const colors = [
          hslaColor(hueA, toneSaturation, light(isDark ? 74 : 50), star.alpha * (isDark ? 0.82 : 0.56)),
          hslaColor(hueB, toneSaturation * 0.95, light(isDark ? 70 : 48), star.alpha * (isDark ? 0.74 : 0.48)),
          hslaColor(hueC, toneSaturation * 0.88, light(isDark ? 76 : 52), star.alpha * (isDark ? 0.62 : 0.42)),
        ];
        const haloColors = [
          hslaColor(hueA, toneSaturation, light(isDark ? 64 : 56), star.alpha * (isDark ? 0.1 : 0.16)),
          hslaColor(hueB, toneSaturation * 0.95, light(isDark ? 62 : 54), star.alpha * (isDark ? 0.08 : 0.14)),
          hslaColor(hueC, toneSaturation * 0.88, light(isDark ? 66 : 58), star.alpha * (isDark ? 0.08 : 0.13)),
        ];

        ctx.save();
        ctx.translate(star.x, star.y);
        ctx.rotate(star.flowAngle + Math.sin(star.z * Math.PI + now * 0.00036) * 0.1 * movement);
        if (!isDark && star.alpha > 0.12) {
          ctx.fillStyle = haloColors[star.tint];
          ctx.beginPath();
          ctx.ellipse(0, 0, star.longRadius * 2.55, star.shortRadius * 2.1, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = colors[star.tint];
        ctx.beginPath();
        ctx.ellipse(0, 0, star.longRadius, star.shortRadius, 0, 0, Math.PI * 2);
        ctx.fill();
        if (star.alpha > 0.32 || star.sparklePulse > 0.4) {
          ctx.fillStyle = hslaColor(hueA, 24 * colorSaturation, light(isDark ? 96 : 100), star.alpha * (isDark ? 0.22 : 0.34) + star.sparklePulse * (isDark ? 0.26 : 0.36));
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.max(0.55, star.longRadius * 0.32), Math.max(0.45, star.shortRadius * 0.36), 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.globalCompositeOperation = 'source-over';
      rafRef.current = requestAnimationFrame(draw);
    };

    const stopMouseFlow = () => {
      driftTarget.x = 0;
      driftTarget.y = 0;
      driftTarget.edge = 0;
      flow.x = 0;
      flow.y = 0;
      flow.edge = 0;
      flow.speed = 0;
      cursor.x = -9999;
      cursor.y = -9999;
      cursor.active = false;
      lastPointerEvent = null;
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('mouseleave', stopMouseFlow);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mouseleave', stopMouseFlow);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className={cn(fixed ? 'fixed inset-0 pointer-events-none' : 'absolute inset-0 pointer-events-none', className)}
      style={{ width: '100%', height: '100%', ...style }}
      aria-hidden="true"
    />
  );
}
