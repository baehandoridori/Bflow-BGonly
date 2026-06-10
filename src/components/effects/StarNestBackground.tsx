import { type CSSProperties, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { DEFAULT_STAR_NEST_SETTINGS, normalizeStarNestSettings, type StarNestSettings } from '@/utils/starNestSettings';
import { cn } from '@/utils/cn';

// Star Nest shader adapted for WebGL from ShipSwift SWStarNest and the original Star Nest shader by Pablo Roman Andrioli.
// Source references:
// - https://github.com/signerlabs/ShipSwift/blob/main/ShipSwift/SWPackage/SWAnimation/SWMetal/SWStarNest.swift
// - https://github.com/signerlabs/ShipSwift/blob/main/ShipSwift/SWPackage/SWAnimation/SWMetal/SWStarNest.metal
// Keep this attribution when moving or reusing the shader.

const VERTEX_SOURCE = `
  attribute vec2 p;
  void main(){ gl_Position = vec4(p,0.0,1.0); }
`;

const UNIFORM_KEYS = [
  'uRes',
  'uTime',
  'uSpeed',
  'uZoom',
  'uBrightness',
  'uSaturation',
  'uDarkmatter',
  'uDistfading',
  'uAngleX',
  'uAngleY',
  'uVolsteps',
  'uIterations',
  'uColorShift',
  'uSparkle',
  'uSparkleSpeed',
  'uLightHue',
  'uLightChroma',
  'uLightClarity',
  'uLightBlur',
  'uOffset',
] as const;

type StarNestUniforms = Record<(typeof UNIFORM_KEYS)[number], WebGLUniformLocation | null>;
type StarNestProgramBundle = {
  program: WebGLProgram;
  locs: StarNestUniforms;
};

const FRAGMENT_SOURCE = `
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uZoom;
  uniform float uBrightness;
  uniform float uSaturation;
  uniform float uDarkmatter;
  uniform float uDistfading;
  uniform float uAngleX;
  uniform float uAngleY;
  uniform float uVolsteps;
  uniform float uIterations;
  uniform float uColorShift;
  uniform float uSparkle;
  uniform float uSparkleSpeed;
  uniform vec3 uOffset;

  vec3 modGlsl(vec3 x, vec3 y){ return x - y * floor(x / y); }
  mat2 rot(float a){ return mat2(cos(a), sin(a), -sin(a), cos(a)); }
  float luminance(vec3 c){ return length(c); }

  void main(){
    const float formuparam = 0.53;
    const float stepsize = 0.1;
    const float tile = 0.850;
    vec2 uv = gl_FragCoord.xy / uRes.xy - 0.5;
    uv.y *= uRes.y / uRes.x;
    vec3 dir = vec3(uv * uZoom, 1.0);
    float t = uTime * uSpeed + 0.25;
    mat2 rot1 = rot(uAngleX);
    mat2 rot2 = rot(uAngleY);
    dir.xz = rot1 * dir.xz;
    dir.xy = rot2 * dir.xy;
    vec3 from = vec3(1.0, 0.5, 0.5);
    from += vec3(uOffset.xy, -2.0 + uOffset.z);
    from.xz = rot1 * from.xz;
    from.xy = rot2 * from.xy;
    float s = 0.1;
    float fade = 1.0;
    vec3 v = vec3(0.0);
    for(int r=0; r<24; r++){
      if(float(r) >= uVolsteps) break;
      vec3 p = from + s * dir * 0.5;
      p = abs(vec3(tile) - modGlsl(p, vec3(tile * 2.0)));
      float pa = 0.0;
      float a = 0.0;
      for(int i=0; i<24; i++){
        if(float(i) >= uIterations) break;
        p = abs(p) / dot(p,p) - formuparam;
        a += abs(length(p) - pa);
        pa = length(p);
      }
      float dm = max(0.0, uDarkmatter - a * a * 0.001);
      a *= a * a;
      if(r > 6) fade *= 1.0 - dm;
      v += fade;
      v += vec3(s, s*s, s*s*s*s) * a * uBrightness * fade;
      fade *= uDistfading;
      s += stepsize;
    }
    v = mix(vec3(luminance(v)), v, uSaturation);
    v *= 0.01;
    vec3 bflowTint = vec3(0.72, 0.62, 1.04);
    vec3 purpleBias = vec3(1.12, 0.88, 1.26);
    vec3 mintBias = vec3(0.74, 1.22, 1.04);
    vec3 tint = bflowTint * mix(purpleBias, mintBias, uColorShift * 0.5 + 0.5);
    v *= tint;
    v = pow(max(v, 0.0), vec3(0.82));
    float sparkleSeed = sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime * 1.7 * uSparkleSpeed);
    float sparkleMask = pow(clamp(luminance(v) * 34.0, 0.0, 1.0), 3.0);
    v += sparkleMask * (0.64 + 0.36 * sparkleSeed) * uSparkle * vec3(0.18, 0.22, 0.32);
    gl_FragColor = vec4(v, 1.0);
  }
`;

const FRAGMENT_LIGHT_SOURCE = `
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uZoom;
  uniform float uBrightness;
  uniform float uSaturation;
  uniform float uDarkmatter;
  uniform float uDistfading;
  uniform float uAngleX;
  uniform float uAngleY;
  uniform float uVolsteps;
  uniform float uIterations;
  uniform float uColorShift;
  uniform float uSparkle;
  uniform float uSparkleSpeed;
  uniform float uLightHue;
  uniform float uLightChroma;
  uniform float uLightClarity;
  uniform float uLightBlur;
  uniform vec3 uOffset;

  vec3 modGlsl(vec3 x, vec3 y){ return x - y * floor(x / y); }
  mat2 rot(float a){ return mat2(cos(a), sin(a), -sin(a), cos(a)); }
  float luminance(vec3 c){ return length(c); }

  vec3 hslToRgb(vec3 hsl){
    vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
  }

  void main(){
    const float formuparam = 0.53;
    const float stepsize = 0.1;
    const float tile = 0.850;
    vec2 uv = gl_FragCoord.xy / uRes.xy - 0.5;
    uv.y *= uRes.y / uRes.x;
    vec3 dir = vec3(uv * uZoom, 1.0);
    float t = uTime * uSpeed + 0.25;
    mat2 rot1 = rot(uAngleX);
    mat2 rot2 = rot(uAngleY);
    dir.xz = rot1 * dir.xz;
    dir.xy = rot2 * dir.xy;
    vec3 from = vec3(1.0, 0.5, 0.5);
    from += vec3(uOffset.xy, -2.0 + uOffset.z);
    from.xz = rot1 * from.xz;
    from.xy = rot2 * from.xy;
    float s = 0.1;
    float fade = 1.0;
    vec3 v = vec3(0.0);
    for(int r=0; r<24; r++){
      if(float(r) >= uVolsteps) break;
      vec3 p = from + s * dir * 0.5;
      p = abs(vec3(tile) - modGlsl(p, vec3(tile * 2.0)));
      float pa = 0.0;
      float a = 0.0;
      for(int i=0; i<24; i++){
        if(float(i) >= uIterations) break;
        p = abs(p) / dot(p,p) - formuparam;
        a += abs(length(p) - pa);
        pa = length(p);
      }
      float dm = max(0.0, uDarkmatter - a * a * 0.001);
      a *= a * a;
      if(r > 6) fade *= 1.0 - dm;
      v += fade;
      v += vec3(s, s*s, s*s*s*s) * a * uBrightness * fade;
      fade *= uDistfading;
      s += stepsize;
    }
    v = mix(vec3(luminance(v)), v, uSaturation);
    v *= 0.01;
    vec3 bflowTint = vec3(0.72, 0.62, 1.04);
    vec3 purpleBias = vec3(1.12, 0.88, 1.26);
    vec3 mintBias = vec3(0.74, 1.22, 1.04);
    vec3 tint = bflowTint * mix(purpleBias, mintBias, uColorShift * 0.5 + 0.5);
    v *= tint;
    v = pow(max(v, 0.0), vec3(0.82));
    float sparkleSeed = sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uTime * 1.7 * uSparkleSpeed);
    float sparkleMask = pow(clamp(luminance(v) * 34.0, 0.0, 1.0), 3.0);
    v += sparkleMask * (0.64 + 0.36 * sparkleSeed) * uSparkle * vec3(0.18, 0.22, 0.32);

    float rawSignal = luminance(v);
    float detail = clamp(pow(rawSignal * mix(30.0, 58.0, uLightClarity), mix(0.72, 0.42, uLightClarity)), 0.0, 1.0);
    float signal = mix(detail, smoothstep(0.05, 0.82, detail) * 0.82, uLightBlur);
    vec3 paper = vec3(0.925, 0.955, 0.995);
    float hue = fract(uLightHue);
    float saturation = clamp(uLightChroma, 0.0, 1.0);
    vec3 hueDust = hslToRgb(vec3(hue, saturation, 0.58));
    vec3 hueSpark = hslToRgb(vec3(fract(hue + 0.08), min(1.0, saturation * 0.86 + 0.14), 0.72));
    hueDust = mix(hueDust, hueSpark, signal * 0.18);
    float colorAmount = mix(0.04, 0.2, saturation) + signal * mix(0.18, 0.66, saturation);
    colorAmount = clamp(colorAmount, 0.0, 0.78);
    vec3 color = mix(paper, hueDust, colorAmount);
    color += v * mix(0.55, 2.2, uLightClarity) * mix(0.55, 1.24, saturation);
    color = mix(color, paper, uLightBlur * 0.22);
    color = min(color, vec3(1.0));
    gl_FragColor = vec4(color, 1.0);
  }
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[StarNest] shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, fragmentSource = FRAGMENT_SOURCE): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, 'p');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[StarNest] program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function createProgramBundle(gl: WebGLRenderingContext, fragmentSource: string): StarNestProgramBundle | null {
  const program = createProgram(gl, fragmentSource);
  if (!program) return null;
  return {
    program,
    locs: Object.fromEntries(
      UNIFORM_KEYS.map((key) => [key, gl.getUniformLocation(program, key)]),
    ) as StarNestUniforms,
  };
}

function resolveFlow(settings: StarNestSettings, mouseFlow: { x: number; y: number; edge: number }) {
  if (settings.directionMode === 'mouse') return mouseFlow;
  if (settings.directionMode === 'manual') {
    const edge = Math.min(1, Math.hypot(settings.directionX, settings.directionY));
    return { x: settings.directionX, y: settings.directionY, edge };
  }
  const edge = Math.min(1, Math.hypot(DEFAULT_STAR_NEST_SETTINGS.directionX, DEFAULT_STAR_NEST_SETTINGS.directionY));
  return {
    x: DEFAULT_STAR_NEST_SETTINGS.directionX,
    y: DEFAULT_STAR_NEST_SETTINGS.directionY,
    edge,
  };
}

export function StarNestBackground({
  enabled = true,
  className,
  fixed = true,
  settings: settingsOverride,
  style,
}: {
  enabled?: boolean;
  className?: string;
  fixed?: boolean;
  settings?: Partial<StarNestSettings> | null;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const storeSettings = useAppStore((s) => normalizeStarNestSettings(s.plexusSettings.starNest));
  const colorMode = useAppStore((s) => s.colorMode);
  const settings = normalizeStarNestSettings(settingsOverride ?? storeSettings);
  const settingsRef = useRef(settings);
  const colorModeRef = useRef(colorMode);
  settingsRef.current = settings;
  colorModeRef.current = colorMode;

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: true, preserveDrawingBuffer: false });
    if (!gl) return;

    const darkBundle = createProgramBundle(gl, FRAGMENT_SOURCE);
    const lightBundle = createProgramBundle(gl, FRAGMENT_LIGHT_SOURCE);
    if (!darkBundle || !lightBundle) return;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const mouseFlow = { x: 0, y: 0, edge: 0 };
    const smoothFlow = {
      x: DEFAULT_STAR_NEST_SETTINGS.directionX,
      y: DEFAULT_STAR_NEST_SETTINGS.directionY,
      edge: Math.min(1, Math.hypot(DEFAULT_STAR_NEST_SETTINGS.directionX, DEFAULT_STAR_NEST_SETTINGS.directionY)),
    };
    const offset = { x: 0, y: 0, z: 0 };
    let lastNow = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = -(((e.clientY - rect.top) / rect.height - 0.5) * 2);
      const dist = Math.min(1, Math.hypot(nx, ny));
      const deadzone = 0.16;
      const edge = Math.max(0, (dist - deadzone) / (1 - deadzone));
      const eased = edge * edge * (3 - 2 * edge);
      mouseFlow.x = dist > 0.001 ? (nx / dist) * eased : 0;
      mouseFlow.y = dist > 0.001 ? (ny / dist) * eased : 0;
      mouseFlow.edge = eased;
    };
    const onMouseLeave = () => {
      mouseFlow.x = 0;
      mouseFlow.y = 0;
      mouseFlow.edge = 0;
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseleave', onMouseLeave);

    const render = (now: number) => {
      const current = settingsRef.current;
      const dt = lastNow ? Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000)) : 0.016;
      lastNow = now;

      const target = resolveFlow(current, mouseFlow);
      const follow = 1 - Math.exp(-dt * 4.2);
      smoothFlow.x += (target.x - smoothFlow.x) * follow;
      smoothFlow.y += (target.y - smoothFlow.y) * follow;
      smoothFlow.edge += (target.edge - smoothFlow.edge) * follow;

      const speed = current.directionMode === 'mouse'
        ? current.maxSpeed * Math.max(0, smoothFlow.edge)
        : current.maxSpeed;
      const magnitude = Math.hypot(smoothFlow.x, smoothFlow.y);
      const nx = magnitude > 0.001 ? smoothFlow.x / magnitude : 0;
      const ny = magnitude > 0.001 ? smoothFlow.y / magnitude : 0;
      offset.x += nx * speed * dt * 4.8;
      offset.y += ny * speed * dt * 3.1;
      offset.z += speed * dt * (1 + smoothFlow.edge * 0.7) * 4.2;

      const bundle = colorModeRef.current === 'light' ? lightBundle : darkBundle;
      const { locs } = bundle;
      gl.useProgram(bundle.program);
      gl.uniform2f(locs.uRes, canvas.width, canvas.height);
      gl.uniform1f(locs.uTime, now * 0.001);
      gl.uniform1f(locs.uSpeed, speed);
      gl.uniform1f(locs.uZoom, current.zoom);
      gl.uniform1f(locs.uBrightness, current.brightness);
      gl.uniform1f(locs.uSaturation, current.saturation);
      gl.uniform1f(locs.uDarkmatter, current.darkmatter);
      gl.uniform1f(locs.uDistfading, current.distfade);
      gl.uniform1f(locs.uAngleX, current.angleX);
      gl.uniform1f(locs.uAngleY, current.angleY);
      gl.uniform1f(locs.uVolsteps, current.quality);
      gl.uniform1f(locs.uIterations, current.iterations);
      gl.uniform1f(locs.uColorShift, current.colorShift);
      gl.uniform1f(locs.uSparkle, current.sparkle);
      gl.uniform1f(locs.uSparkleSpeed, current.sparkleSpeed);
      gl.uniform1f(locs.uLightHue, 0.58);
      gl.uniform1f(locs.uLightChroma, 0.62);
      gl.uniform1f(locs.uLightClarity, 0.82);
      gl.uniform1f(locs.uLightBlur, 0.18);
      gl.uniform3f(locs.uOffset, offset.x, offset.y, offset.z);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
      if (buffer) gl.deleteBuffer(buffer);
      gl.deleteProgram(darkBundle.program);
      gl.deleteProgram(lightBundle.program);
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
