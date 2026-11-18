// 만드는 화면의 숨쉬는 점 — 시안 docs/mockups/bae-gyeong/canvas/Making.dc.html · Ordering.dc.html 의 WebGL2 셰이더를 옮겼다.
// 점은 셰이더 한 장이고 그림을 읽지 않는다. 화면은 이 캔버스를 그림 두 겹 위에 '곱하기'로 겹친다:
// 점이 흰색으로 커진 자리로 아래 그림이 보이고, 점 사이(어두운 바탕)는 그림을 가린다.
// 시안과 다른 점: 그리는 중 진행을 26초마다 다시 자라는 대신 실제 단계(중간 그림 0 · 1 · 2장, drawReveal)로 정하고,
// 완성(finish)에서는 가운데부터 바깥으로 점이 풀려 그림이 다 보인다.
// 멈춤(still: 움직임 최소 · 동작 줄이기)은 시간이 흐르지 않는 한 장면 — 마우스 돋보기만 따라온다.
import {
  approach, canvasScale, drawReveal, finaleCurve, frameGapMs, tuneLevel, TUNE_START, wanderAt,
  type MakingPhase, type Tune,
} from './makingStageLogic';

export interface DotFieldOptions {
  aspect: number;            // 그림 비율 (가로 / 세로) — 점 판 안에서 그림이 놓인 자리
  phase: MakingPhase;
  partials: number;          // 지금까지 온 중간 그림 수
  still: boolean;            // 움직임 최소 · 동작 줄이기: 멈춘 한 장면 (돋보기만)
  lite: boolean;             // 움직임 가볍게: 초당 30장 · 화면 배율 1배 · 맥박과 잡티 없음
  onLost?: () => void;       // 그리기 판을 잃음 → 화면은 흐린 그림으로 바꿔 보여 준다
  onRestored?: () => void;   // 다시 얻음
}

export interface DotField {
  setAspect(aspect: number): void;
  setPhase(phase: MakingPhase): void;
  setPartials(n: number): void;
  setMotion(still: boolean, lite: boolean): void;
  pause(): void;
  resume(): void;
  /** 완성: ms 동안 점이 가운데에서 바깥으로 풀린다. 다 풀리면(또는 멈춰 있거나 판을 잃었으면 바로) 끝난다. */
  finish(ms: number): Promise<void>;
  dispose(): void;
}

const DOT: [number, number, number] = [0xa2 / 255, 0x9b / 255, 0xfe / 255];  // 완료 색 #A29BFE
const GROUND: [number, number, number] = [10 / 255, 11 / 255, 17 / 255];     // 무대 색 --bae-stage
const ROWS = 44;
const LENS = 0.17;
const RIPPLE = 0.8;
const TRAIL = 12;

const VERT = '#version 300 es\nvoid main(){vec2 p=vec2(gl_VertexID<<1&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}';
const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uMouse;
uniform float uPress;
uniform vec3 uTrail[12];
uniform vec3 uDot;
uniform vec3 uGround;
uniform float uRows;
uniform float uBreath;
uniform float uGrain;
uniform float uLens;
uniform float uRipple;
uniform float uAspect;
uniform float uPhase;
uniform float uProg;
uniform float uFinale;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5; mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = r * p * 2.02; a *= 0.5; }
  return v;
}
void main() {
  float sa = uResolution.x / uResolution.y;
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  vec2 m = (uMouse - 0.5) * vec2(sa, 1.0);

  // where the picture sits: contained and centred
  vec2 hs = sa > uAspect ? vec2(uAspect * 0.5, 0.5) : vec2(sa * 0.5, sa * 0.5 / uAspect);
  vec2 e = abs(p) - hs;
  float within = 1.0 - smoothstep(-0.03, 0.02, max(e.x, e.y));

  // breathing: a slow pulse travelling out from the middle, and a drift
  float n = fbm(p * 1.7 + 3.1);
  float beat = pow(0.5 + 0.5 * sin(6.28318 * (uTime / 1.9 - length(p) * 0.55)), 6.0);
  float sway = 0.5 + 0.5 * sin(uTime * 0.9 + p.x * 2.3 - p.y * 1.7 + n * 4.0);
  float base = 0.19 + uBreath * (0.11 * beat + 0.05 * sway);

  // drawing: the picture comes up in patches as the real progress grows
  float at = 0.14 + 0.52 * n;
  float grown = smoothstep(at, at + 0.22, uProg);

  // order writing: a band reads across the rough
  float bx = (fract(uTime / 7.0) * 2.0 - 1.0) * (hs.x + 0.3);
  float bd = (p.x - bx) / 0.2;
  float readBand = 0.62 * exp(-bd * bd);

  float dev = mix(readBand, grown, uPhase);
  dev = mix(base * 0.9, base + (1.0 - base) * dev, within);

  // pointer: a lens that shows the spot first, and rings behind it
  float R = max(uLens * (1.0 + 0.7 * uPress), 0.01);
  vec2 dm = p - m;
  float lens = exp(-dot(dm, dm) / (R * R));
  float ring = 0.0;
  for (int i = 0; i < 12; i++) {
    vec3 t = uTrail[i];
    if (t.z < 0.0) continue;
    vec2 tp = (t.xy - 0.5) * vec2(sa, 1.0);
    float r = length(p - tp) - t.z * 0.34;
    ring += sin(r * 58.0) * exp(-r * r * 81.0) * exp(-t.z * 1.1);
  }
  dev += (1.0 - dev) * smoothstep(0.0, 1.0, lens) * 0.98;
  dev += uRipple * ring * 0.2;

  // finished: the dots open from the middle outward until the whole picture shows
  float fr = uFinale * (0.5 * length(vec2(sa, 1.0)) + 0.45);
  float fin = 1.0 - smoothstep(fr - 0.4, fr, length(p));
  dev = mix(dev, 1.0, fin);

  // the dot screen, turned 45 degrees, bulging a little under the lens
  vec2 g = p - dm * lens * 0.28;
  float c = 0.70710678;
  vec2 q = mat2(c, -c, c, c) * g * uRows;
  float s = 0.5 + 0.25 * (cos(6.28318 * q.x) + cos(6.28318 * q.y));
  float jit = hash(floor(q + 0.5)) - 0.5;
  dev += jit * 0.1 * (1.0 - smoothstep(0.3, 0.6, dev));
  dev = clamp(dev, 0.0, 1.0);
  float th = 1.0 - dev * 1.08;
  float aa = fwidth(s) * 0.8 + 1e-4;
  float mask = smoothstep(th - aa, th + aa, s);

  vec3 ink = mix(uDot, vec3(1.0), smoothstep(0.3, 0.9, dev));
  vec3 col = mix(uGround, ink, mask);
  float vig = 1.0 - 0.32 * smoothstep(0.5, 1.2, length(p * vec2(0.8, 1.0)));
  col *= mix(vig, 1.0, max(within, fin));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.02 * uGrain * (1.0 - within * dev);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

type Uni = Record<string, WebGLUniformLocation | null>;
interface Kit { prog: WebGLProgram; vao: WebGLVertexArrayObject | null; shaders: WebGLShader[]; uni: Uni }

function compile(gl: WebGL2RenderingContext, kind: number, code: string): WebGLShader | null {
  const s = gl.createShader(kind);
  if (!s) return null;
  gl.shaderSource(s, code);
  gl.compileShader(s);
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
  if (!gl.isContextLost()) console.warn('[BAE경] 점 효과 셰이더를 만들지 못했어요', gl.getShaderInfoLog(s));
  gl.deleteShader(s);
  return null;
}

function build(gl: WebGL2RenderingContext): Kit | null {
  const v = compile(gl, gl.VERTEX_SHADER, VERT);
  const f = v && compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!v || !f) { if (v) gl.deleteShader(v); return null; }
  const prog = gl.createProgram();
  if (!prog) { gl.deleteShader(v); gl.deleteShader(f); return null; }
  gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    if (!gl.isContextLost()) console.warn('[BAE경] 점 효과 셰이더를 잇지 못했어요', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog); gl.deleteShader(v); gl.deleteShader(f);
    return null;
  }
  gl.useProgram(prog);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const uni: Uni = {};
  for (const name of ['uTime', 'uResolution', 'uMouse', 'uPress', 'uTrail', 'uDot', 'uGround', 'uRows', 'uBreath', 'uGrain', 'uLens', 'uRipple', 'uAspect', 'uPhase', 'uProg', 'uFinale']) {
    uni[name] = gl.getUniformLocation(prog, name);
  }
  // 바뀌지 않는 값은 한 번만
  gl.uniform3fv(uni.uDot, DOT);
  gl.uniform3fv(uni.uGround, GROUND);
  gl.uniform1f(uni.uRows, ROWS);
  gl.uniform1f(uni.uLens, LENS);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  return { prog, vao, shaders: [v, f], uni };
}

/** WebGL2 가 없거나 셰이더를 만들지 못하면 null — 화면은 점 없이 흐린 그림을 보여 준다. */
export function createDotField(canvas: HTMLCanvasElement, opts: DotFieldOptions): DotField | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
  } catch { gl = null; }
  if (!gl || gl.isContextLost()) return null;
  let kit = build(gl);
  if (!kit) return null;
  const g = gl;

  let aspect = opts.aspect > 0 ? opts.aspect : 1.5;
  let phase: MakingPhase = opts.phase;
  let partials = opts.partials;
  let still = opts.still;
  let lite = opts.lite;
  let paused = false, disposed = false, lost = false;
  let raf = 0;
  let lastDraw = 0;        // 마지막으로 그린 시각 (0 = 쉬다가 처음)
  let time = 12;           // 점이 숨쉬는 시계 — 멈춤에서는 흐르지 않는다 (시안처럼 12초에서 시작)
  let clock = 0;           // 물결 나이 시계 — 늘 흐른다
  let inside = false, down = false, press = 0;
  let aim: [number, number] = [0.5, 0.5];
  let mouse: [number, number] = [0.5, 0.5];
  const trail: [number, number, number][] = [];
  const trailBuf = new Float32Array(TRAIL * 3);
  let phaseV = phase === 'order' ? 0 : 1;
  let stageAt = performance.now();
  let prog = phase === 'order' ? 0 : drawReveal(partials, 0);
  let finAt = -1, finMs = 1000, fin = 0;
  let finDone: (() => void) | null = null;
  let finTimer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;     // 완성 효과가 끝남 — 더는 계속 그리지 않는다
  let dirty = true;        // 멈춰 있어도 한 장 다시 그릴 것
  let cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  let tune: Tune = TUNE_START;
  let ticks = 0, due = 0;

  const resetCount = (now: number) => { ticks = 0; due = now + 2000; };
  const schedule = () => { if (!raf && !paused && !disposed && !lost) raf = requestAnimationFrame(tick); };
  const halt = () => { if (raf) cancelAnimationFrame(raf); raf = 0; };
  const wake = () => { dirty = true; schedule(); };
  const resolveFinish = () => {
    if (finTimer) { clearTimeout(finTimer); finTimer = null; }
    const done = finDone; finDone = null;
    if (done) done();
  };

  function drop(force: boolean) {
    const l = trail[0];
    if (!force && l && Math.hypot(l[0] - aim[0], l[1] - aim[1]) < 0.04) return;
    trail.unshift([aim[0], aim[1], clock]);
    if (trail.length > TRAIL) trail.length = TRAIL;
  }

  function render(now: number): boolean {
    if (!kit) return false;
    const dt = lastDraw ? Math.min(0.2, Math.max(0, (now - lastDraw) / 1000)) : 1 / 60;
    lastDraw = now;
    clock += dt;
    if (!still) time += dt;
    if (!inside && !still && !settled) { aim = wanderAt(time); drop(false); }
    const k = 1 - Math.pow(0.86, dt * 60);
    const mx = mouse[0], my = mouse[1];
    mouse = [mx + (aim[0] - mx) * k, my + (aim[1] - my) * k];
    const pressBefore = press;
    press += ((down ? 1 : 0) - press) * k;
    const phaseTarget = phase === 'order' ? 0 : 1;
    const phaseBefore = phaseV;
    phaseV = still ? phaseTarget : approach(phaseV, phaseTarget, dt, 0.45);
    const progTarget = phase === 'order' ? 0 : drawReveal(partials, (now - stageAt) / 1000);
    const progBefore = prog;
    prog = still ? progTarget : approach(prog, progTarget, dt, 0.6);
    if (finAt >= 0) fin = still ? 1 : finaleCurve((now - finAt) / finMs);

    const s = canvasScale(window.devicePixelRatio || 1, cssW, cssH, tune.level, lite);
    const w = Math.max(2, Math.round(cssW * s)), h = Math.max(2, Math.round(cssH * s));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const u = kit.uni;
    g.viewport(0, 0, w, h);
    g.uniform1f(u.uTime, time);
    g.uniform2f(u.uResolution, w, h);
    g.uniform2f(u.uMouse, mouse[0], mouse[1]);
    g.uniform1f(u.uPress, press);
    for (let i = 0; i < TRAIL; i++) {
      const t = trail[i];
      trailBuf[i * 3] = t ? t[0] : 0;
      trailBuf[i * 3 + 1] = t ? t[1] : 0;
      trailBuf[i * 3 + 2] = t ? clock - t[2] : -1;
    }
    g.uniform3fv(u.uTrail, trailBuf);
    g.uniform1f(u.uBreath, lite ? 0 : 1);
    g.uniform1f(u.uGrain, lite || still ? 0 : 1);
    g.uniform1f(u.uRipple, still ? 0 : RIPPLE);
    g.uniform1f(u.uAspect, aspect);
    g.uniform1f(u.uPhase, phaseV);
    g.uniform1f(u.uProg, prog);
    g.uniform1f(u.uFinale, fin);
    g.drawArrays(g.TRIANGLES, 0, 3);
    dirty = false;

    if (finAt >= 0 && fin >= 1 && finDone) { settled = true; resolveFinish(); }
    // 아직 움직이는 중인지 (멈춤에서도 돋보기 · 단계 바뀜이 자리 잡을 때까지는 이어 그린다)
    return Math.abs(mouse[0] - mx) + Math.abs(mouse[1] - my) > 0.0005
      || Math.abs(press - pressBefore) > 0.001
      || Math.abs(phaseV - phaseBefore) > 0.0005
      || Math.abs(prog - progBefore) > 0.0005
      || (finAt >= 0 && fin < 1);
  }

  function tick(now: number) {
    raf = 0;
    if (paused || disposed || lost || !kit) return;
    try {
      if (still || settled) {
        // 멈춘 한 장면: 바뀐 게 있을 때만 그린다
        const moving = dirty ? render(now) : false;
        if (moving) { dirty = true; schedule(); } else lastDraw = 0;
        return;
      }
      ticks++;
      if (now > due) { tune = tuneLevel(tune, ticks, now); resetCount(now); }
      if (!lastDraw || now - lastDraw >= frameGapMs(inside, lite, tune.level) - 2) render(now);
      schedule();
    } catch (e) {
      console.warn('[BAE경] 점 효과를 그리지 못했어요', e);
      lost = true; halt(); resolveFinish(); opts.onLost?.();
    }
  }

  // ── 마우스 ──
  const point = (e: PointerEvent) => {
    aim = [e.offsetX / (cssW || 1), 1 - e.offsetY / (cssH || 1)];
    inside = true;
  };
  const onMove = (e: PointerEvent) => { point(e); drop(false); wake(); };
  const onDown = (e: PointerEvent) => { point(e); down = true; drop(true); wake(); };
  const onUp = () => { down = false; wake(); };
  const onLeave = () => { inside = false; down = false; wake(); };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);

  // ── 크기 ──
  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver((es) => {
      const r = es[es.length - 1]?.contentRect;
      if (!r) return;
      cssW = r.width; cssH = r.height; wake();
    })
    : null;
  ro?.observe(canvas);

  // ── 그리기 판을 잃음 / 되찾음 ──
  const onLostEvt = (e: Event) => {
    e.preventDefault();  // 되찾을 수 있게
    lost = true; halt(); kit = null; resolveFinish();
    opts.onLost?.();
  };
  const onRestoredEvt = () => {
    if (disposed) return;
    kit = build(g);
    if (!kit) return;
    lost = false; lastDraw = 0;
    opts.onRestored?.();
    wake();
  };
  canvas.addEventListener('webglcontextlost', onLostEvt);
  canvas.addEventListener('webglcontextrestored', onRestoredEvt);

  resetCount(performance.now());
  schedule();

  return {
    setAspect(a) { if (a > 0 && a !== aspect) { aspect = a; wake(); } },
    setPhase(p) {
      if (p === phase) return;
      if (p === 'draw' || (phase === 'order' && p === 'done')) stageAt = performance.now();
      if (p !== 'done') { finAt = -1; fin = 0; settled = false; resolveFinish(); }  // 완성 뒤 같은 판으로 다시 만들 때
      phase = p; wake();
    },
    setPartials(n) {
      if (n === partials) return;
      partials = n; stageAt = performance.now(); wake();
    },
    setMotion(s, l) {
      if (s === still && l === lite) return;
      still = s; lite = l; lastDraw = 0; resetCount(performance.now()); wake();
    },
    pause() { paused = true; halt(); },
    resume() {
      if (!paused) return;
      paused = false; lastDraw = 0; resetCount(performance.now()); wake();
    },
    finish(ms) {
      if (disposed || lost || !kit) return Promise.resolve();
      resolveFinish();
      finAt = performance.now(); finMs = Math.max(1, ms); fin = still ? 1 : 0; settled = false;
      return new Promise<void>((resolve) => {
        finDone = resolve;
        // 화면 밖 · 멈춘 동안에도 기다리는 쪽이 멈추지 않게
        finTimer = setTimeout(() => { fin = 1; settled = true; dirty = true; schedule(); resolveFinish(); }, finMs + 400);
        wake();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true; halt(); resolveFinish();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('webglcontextlost', onLostEvt);
      canvas.removeEventListener('webglcontextrestored', onRestoredEvt);
      ro?.disconnect();
      if (kit && !g.isContextLost()) {
        g.bindVertexArray(null);
        if (kit.vao) g.deleteVertexArray(kit.vao);
        g.deleteProgram(kit.prog);
        for (const s of kit.shaders) g.deleteShader(s);
      }
      kit = null;
      // 정말 화면에서 빠진 캔버스만 판을 바로 돌려준다 (React 개발 모드의 '떼었다 다시 붙이기'는 같은 캔버스를 다시 쓴다)
      if (!canvas.isConnected) g.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
