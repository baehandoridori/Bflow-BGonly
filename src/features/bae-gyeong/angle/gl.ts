/**
 * BAE경 '다른 각도로'의 그림판: 작은 WebGL2 그림판 하나로 도면 · B 그림 · GPT 밑그림 · 새로 그릴 곳 재기를 모두 그린다
 * (HTML v0.4.11 script_4.js 3196~3438줄 ANGGL 을 그대로, three.js 없이). 셰이더 글 · 그리는 순서 · 고르는 규칙을 바꾸면
 * 밑그림이 HTML 과 달라진다 (C:\BAE_stage0\angle_port 의 픽셀 비교, tests/baeGyeongAngleRender.test.ts 의 해시).
 *
 * v0.4.6 같은 공간 그림: 그림 0 은 카메라 A 의 그림(setScene), 1.. 은 더한 그림(setExtras). 그림이 둘 이상이면 두 번에 그린다:
 * 그림마다 따로 (색 · 카메라에서의 거리 · 늘어난 정도) 그린 뒤, 한 번에 픽셀마다 어느 그림을 보일지 고른다:
 *   1. 확실히(20% 넘게) 가까운 것이 이긴다
 *   2. 같은 면이면 새 카메라와 더 비슷한 방향에서 본 그림이 이긴다 (그 그림만 거기서 줄처럼 늘어나 있으면 다른 그림)
 *   3. 한 그림이 그 자리를 '뚫고' 봤고(그 그림 카메라에서는 빈 공기) 새 카메라와 더 비슷한 쪽이면 그 말을 따른다
 * 어느 그림도 못 본 곳은 회색. v0.4.8: 그림들의 버퍼가 텍스처 묶음(색 · 거리와 늘어남 · 그림 자신의 거리)의 층이라 그림 수와 상관없이 한 번에.
 * v0.4.10 밑면: B 의 눈보다 높은, 위를 보는 면(탁자 윗면)을 밑에서 보면 그 물건 색을 0.45배로 어둡게 칠한다.
 */
import { ANG, type AngleSet, type AngleView, type AnglePose } from './engine';
import { dims, makeCanvas, scaled } from '../make/inputs';

type Img = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
interface Src {
  key?: string; S?: AngleSet; img?: Img; vao?: WebGLVertexArrayObject | null; bufs?: WebGLBuffer[]; tex?: WebGLTexture | null; n?: number;
  texW?: number; texH?: number; M?: Float32Array; pose?: AnglePose; near?: Float32Array | null;
}
type Locs = Record<string, WebGLUniformLocation | null>;
interface Targets { n: number; fb: WebGLFramebuffer; col: WebGLTexture; inf: WebGLTexture; dep: WebGLRenderbuffer }
export interface AngleDrawOpts {
  /** 바탕 [r, g, b] (0..1) */
  bg?: number[]; cull?: boolean; zCut?: number; mip?: boolean;
  /** 모든 그림을 보통 깊이 시험으로 (도면) */
  all?: boolean;
  /** 늘어난 곳을 초록으로 (재기) */
  measure?: boolean; thr?: number;
  /** 밑면 (B 그림) */
  under?: boolean;
  /** 그림 여럿을 합쳐서 (B 그림 · 밑그림) */
  merge?: boolean;
  /** 이 크기의 버퍼를 다 쓰고 비운다 (한 번 쓰는 GPT 밑그림 크기) */
  once?: boolean;
}
export interface AngleExtraIn { key: string; S: AngleSet; img: Img; pose: AnglePose }
export interface AngleUnseen { grey: number; smear: number; under: number; all: number }

export function createAngleGL() {
  let cv: HTMLCanvasElement | null = null, gl: WebGL2RenderingContext | null = null, P: WebGLProgram | null = null, U: Locs = {}, PI: WebGLProgram | null = null, UI: Locs = {};
  let empty: WebGLVertexArrayObject | null = null, floatOk = false, depA: WebGLTexture | null = null, depKey = '';
  const src: Src[] = [];           // { key, S, img, vao, bufs, tex, n, texW, texH, M, pose, near }; src[0] = camera A's picture
  const progs = new Map<number, { prog: WebGLProgram; u: Locs & { k?: Locs[] } }>();  // the joining pass, one program per number of pictures
  const fbos = new Map<string, Targets>();   // per view size: the colour and info layers (one per picture) and one depth buffer
  const TOL = 0.2;
  const VS = '#version 300 es\nin vec3 aPos; in vec2 aUv; uniform mat4 uMvp; uniform mat4 uModel; uniform vec3 uEye; uniform vec3 uFw; out vec2 vUv; out float vZ; out float vD; out vec3 vW;\n' +
    'void main(){ vUv = aUv; vZ = -aPos.z; vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; vD = dot(w.xyz - uEye, uFw); gl_Position = uMvp * w; }';
  // v0.4.10 uUnder (B views): a face seen from behind stays hidden (as with culling: a wall behind B), except the underside of a
  // face that looks up and is above the eye now (a table top seen from below): its visible side looks down (nv, toward the camera)
  // and it is not smeared (uUnder = the stretch limit, as in the measure)
  const UNDER = 'vec3 nv = normalize(cross(dFdx(vW), dFdy(vW)));\n';
  // uMeasure: paint what is smeared (one texel of the picture stretched over many pixels in some direction) pure green, to count it
  const SMEAR = 'vec2 dx = dFdx(vUv) * uTexPx, dy = dFdy(vUv) * uTexPx; float a = dot(dx, dx), b = dot(dx, dy), c = dot(dy, dy), h = 0.5 * (a + c);\n' +
    ' float s2 = sqrt(max(1e-12, h - sqrt(max(0.0, h * h - (a * c - b * b)))));\n';
  const FS = '#version 300 es\nprecision highp float; in vec2 vUv; in float vZ; in vec3 vW; uniform sampler2D uTex; uniform float uZCut; uniform float uMeasure; uniform vec2 uTexPx; uniform float uUnder; out vec4 o;\n' +
    'void main(){ if (vZ > uZCut) discard; ' + SMEAR + UNDER + ' vec3 tc = texture(uTex, vUv).rgb;\n' +
    ' if (uUnder > 0.0 && !gl_FrontFacing) { if (!(nv.y < -0.5) || s2 < uUnder) discard; o = uMeasure > 0.0 ? vec4(0.0, 0.0, 1.0, 1.0) : vec4(tc * 0.45, 1.0); return; }\n' +
    ' if (uMeasure > 0.0 && s2 < uMeasure) { o = vec4(0.0, 1.0, 0.0, 1.0); return; }\n' +
    ' o = vec4(tc, 1.0); }';
  // one picture alone, for joining: colour + (distance from the camera, stretch, covered)
  // (an underside's stretch is stored 1e6 higher: it counts as clear when joining, and the measure paints it blue)
  const FSI = '#version 300 es\nprecision highp float; in vec2 vUv; in float vZ; in float vD; in vec3 vW; uniform sampler2D uTex; uniform float uZCut; uniform vec2 uTexPx; uniform float uUnder;\n' +
    'layout(location = 0) out vec4 oC; layout(location = 1) out vec4 oI;\n' +
    'void main(){ if (vZ > uZCut) discard; ' + SMEAR + UNDER + ' vec3 tc = texture(uTex, vUv).rgb;\n' +
    ' if (uUnder > 0.0 && !gl_FrontFacing) { if (!(nv.y < -0.5) || s2 < uUnder) discard; oC = vec4(tc * 0.45, 1.0); oI = vec4(vD, s2 + 1e6, 1.0, 1.0); return; }\n' +
    ' oC = vec4(tc, 1.0); oI = vec4(vD, s2, 1.0, 1.0); }';
  const VSQ = '#version 300 es\nvoid main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }';
  function mergeFS(n: number): string {    // written out per picture (the rules' loops unrolled); picture i is layer i of the three arrays
    const K = [...Array(n).keys()], L = ['#version 300 es', 'precision highp float; precision highp int; precision highp sampler2DArray;',
      'uniform sampler2DArray uCA; uniform sampler2DArray uIA; uniform sampler2DArray uDA;'];
    for (const i of K) L.push(`uniform vec4 uPo${i}; uniform vec3 uT${i}; uniform vec4 uK${i}; uniform vec4 uG${i};`);
    L.push('uniform vec3 uEye; uniform vec3 uFw; uniform vec3 uR; uniform vec3 uU; uniform vec2 uTan; uniform vec2 uShift; uniform vec2 uSize; uniform float uTol; uniform float uSmear; uniform float uStep; uniform vec3 uBg; uniform int uMode; out vec4 o;');
    // 1.0 when picture i, from its own camera, saw something clearly farther than the point P (it looked straight through P)
    for (const i of K) L.push(`float through${i}(vec3 P){ vec3 q = P - uT${i}; float c = uPo${i}.x, s = uPo${i}.y, k = uPo${i}.z; vec3 l = vec3((q.x * c + q.z * s) / k, q.y / k, (-q.x * s + q.z * c) / k);
  if (l.z > -0.05) return 0.0; float z = -l.z, u = uK${i}.x + uK${i}.z * l.x / z, v = uK${i}.y - uK${i}.z * l.y / z;
  if (u < 0.0 || v < 0.0 || u > uG${i}.x - 1.0 || v > uG${i}.y - 1.0) return 0.0;
  ivec2 g = ivec2(clamp(int(floor(u / uStep + 0.5)), 0, int(uG${i}.z) - 1), clamp(int(floor(v / uStep + 0.5)), 0, int(uG${i}.w) - 1));
  return texelFetch(uDA, ivec3(g, ${i}), 0).r > z * (1.0 + uTol) ? 1.0 : 0.0; }`);
    L.push('void main(){ ivec2 px = ivec2(gl_FragCoord.xy); vec2 nd = gl_FragCoord.xy / uSize * 2.0 - 1.0; vec3 ray = normalize(uFw + uR * (nd.x - uShift.x) * uTan.x + uU * (nd.y - uShift.y) * uTan.y); float rf = dot(ray, uFw);');
    // (a picture covers a pixel when it drew there: its distance along the view is then above 0, the cleared value)
    for (const i of K) L.push(` vec4 I${i} = texelFetch(uIA, ivec3(px, ${i}), 0); bool h${i} = I${i}.x > 0.0; vec3 P${i} = uEye + ray * (I${i}.x / rf); float a${i} = h${i} ? dot(normalize(P${i} - uT${i}), ray) : -3.0; bool v${i} = false;`);
    for (const i of K) for (const j of K) if (i !== j) L.push(` if (h${i} && dot(normalize(P${i} - uT${j}), ray) > a${i} && through${j}(P${i}) > 0.5) v${i} = true;`);
    L.push(' bool okAny = false;'); for (const i of K) L.push(` if (h${i} && !v${i}) okAny = true;`);
    for (const i of K) L.push(` bool u${i} = h${i} && (!okAny || !v${i});`);
    L.push(' float zm = 1e30;'); for (const i of K) L.push(` if (u${i}) zm = min(zm, I${i}.x);`);
    for (const i of K) L.push(` bool g${i} = u${i} && I${i}.x * (1.0 - uTol) <= zm;`);
    L.push(' bool cl = false;'); for (const i of K) L.push(` if (g${i} && I${i}.y >= uSmear) cl = true;`);
    L.push(' int b = -1; float ba = -9.0;'); for (const i of K) L.push(` if (g${i} && (!cl || I${i}.y >= uSmear) && a${i} > ba) { ba = a${i}; b = ${i}; }`);
    L.push(' vec3 col = uBg; float st = 1e9;'); for (const i of K) L.push(` if (b == ${i}) { col = texelFetch(uCA, ivec3(px, ${i}), 0).rgb; st = I${i}.y; }`);
    L.push(' if (uMode == 1) o = b < 0 ? vec4(1.0, 0.0, 1.0, 1.0) : st > 1e5 ? vec4(0.0, 0.0, 1.0, 1.0) : st < uSmear ? vec4(0.0, 1.0, 0.0, 1.0) : vec4(col, 1.0);');
    L.push(' else if (uMode == 2) o = vec4(float(b + 1) / 255.0, st < uSmear ? 1.0 / 255.0 : 0.0, 0.0, 1.0);');
    L.push(' else o = vec4(col, 1.0); }');
    return L.join('\n');
  }
  const G = () => gl as WebGL2RenderingContext;
  function init() {
    cv = makeCanvas(16, 16);
    gl = cv.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, alpha: false, premultipliedAlpha: false });
    if (!gl) throw new Error('nowebgl');
    floatOk = !!gl.getExtension('EXT_color_buffer_float');
    P = link(VS, FS); U = locs(P, ['uMvp', 'uModel', 'uTex', 'uZCut', 'uMeasure', 'uTexPx', 'uEye', 'uFw', 'uUnder']);
    PI = link(VS, FSI); UI = locs(PI, ['uMvp', 'uModel', 'uTex', 'uZCut', 'uTexPx', 'uEye', 'uFw', 'uUnder']);
    empty = gl.createVertexArray();
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gl = null; src.length = 0; progs.clear(); fbos.clear(); depA = null; depKey = ''; });
    src.length = 0; progs.clear(); fbos.clear(); depA = null; depKey = '';
  }
  function link(vs: string, fs: string): WebGLProgram {
    const g = G();
    const sh = (t: number, s: string) => { const o = g.createShader(t) as WebGLShader; g.shaderSource(o, s); g.compileShader(o); if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o) || 'shader'); return o; };
    const p = g.createProgram() as WebGLProgram; g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs));
    g.bindAttribLocation(p, 0, 'aPos'); g.bindAttribLocation(p, 1, 'aUv'); g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) || 'link');
    return p;
  }
  const locs = (p: WebGLProgram, names: string[]): Locs => { const o: Locs = {}; for (const n of names) o[n] = G().getUniformLocation(p, n); return o; };
  function ready(): boolean { try { if (!gl || gl.isContextLost()) init(); return true; } catch (e) { gl = null; return false; } }
  function upload(o: Src, S: AngleSet, img: Img) {   // (re)fill one picture's buffers; the texture only when the picture changed
    const g = G();
    if (!o.vao || o.S !== S) {
      for (const b of o.bufs || []) g.deleteBuffer(b); if (o.vao) g.deleteVertexArray(o.vao);
      o.bufs = []; o.vao = g.createVertexArray(); g.bindVertexArray(o.vao);
      const buf = (target: number, data: ArrayBufferView) => { const b = g.createBuffer() as WebGLBuffer; g.bindBuffer(target, b); g.bufferData(target, data as ArrayBufferView<ArrayBuffer>, g.STATIC_DRAW); o.bufs!.push(b); };
      buf(g.ARRAY_BUFFER, S.pos); g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 3, g.FLOAT, false, 0, 0);
      buf(g.ARRAY_BUFFER, S.uv); g.enableVertexAttribArray(1); g.vertexAttribPointer(1, 2, g.FLOAT, false, 0, 0);
      buf(g.ELEMENT_ARRAY_BUFFER, S.idx); o.n = S.idx.length; g.bindVertexArray(null);
      o.near = null;
      o.S = S;
    }
    if (o.img !== img || !o.tex) {
      if (o.tex) g.deleteTexture(o.tex);
      o.tex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, o.tex); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
      const mx = g.getParameter(g.MAX_TEXTURE_SIZE) as number, [iw, ih] = dims(img);
      const up = Math.max(iw, ih) > mx ? scaled(img, mx) : img; [o.texW, o.texH] = dims(up);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, up as TexImageSource); g.generateMipmap(g.TEXTURE_2D);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
      o.img = img;
    }
  }
  function release(o: Src) { const g = G(); for (const b of o.bufs || []) g.deleteBuffer(b); if (o.vao) g.deleteVertexArray(o.vao); if (o.tex) g.deleteTexture(o.tex); }
  function setScene(k: string, S: AngleSet, img: Img) {
    if (!ready()) throw new Error('nowebgl');
    if (src[0] && src[0].key === k) return;
    const o: Src = src[0] || {}; upload(o, S, img); o.key = k; o.pose = ANG.POSE0; o.M = ANG.poseMat(ANG.POSE0); src[0] = o;
    while (src.length > 1) release(src.pop() as Src);   // a new picture A: the added pictures are set again by the dialog
  }
  // the added pictures: [{ key, S, img, pose }] in order; buffers are kept while the same set comes back (a new place is a matrix)
  function setExtras(list: AngleExtraIn[]) {
    if (!ready() || !src[0]) return;
    for (let i = 0; i < list.length; i++) {
      const it = list[i], o: Src = src[i + 1] && src[i + 1].key === it.key ? src[i + 1] : {};
      if (src[i + 1] && src[i + 1] !== o) release(src[i + 1]);
      upload(o, it.S, it.img); o.key = it.key; o.pose = it.pose; o.M = ANG.poseMat(it.pose); src[i + 1] = o;
    }
    while (src.length > list.length + 1) release(src.pop() as Src);
  }
  const count = () => src.length;
  function size(w: number, h: number) { const c = cv as HTMLCanvasElement; if (c.width !== w) c.width = w; if (c.height !== h) c.height = h; }
  function drawOne(o: Src, V: AngleView, prog: WebGLProgram, u: Locs, opt: AngleDrawOpts) {
    const g = G();
    g.useProgram(prog); g.bindVertexArray(o.vao as WebGLVertexArrayObject); g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, o.tex as WebGLTexture);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, opt.mip ? g.LINEAR_MIPMAP_LINEAR : g.LINEAR);
    g.uniform1i(u.uTex, 0); g.uniformMatrix4fv(u.uMvp, false, V.mvp); g.uniformMatrix4fv(u.uModel, false, o.M as Float32Array); g.uniform1f(u.uZCut, opt.zCut || 1e9);
    g.uniform3fv(u.uEye, V.eye); g.uniform3fv(u.uFw, V.fw || [0, 0, -1]); g.uniform2f(u.uTexPx, o.texW as number, o.texH as number);
    if (u.uMeasure) g.uniform1f(u.uMeasure, opt.measure ? (o.texW as number) / V.w / (opt.thr || 12) : 0);
    if (u.uUnder) g.uniform1f(u.uUnder, opt.under ? (o.texW as number) / V.w / 12 : 0);   // v0.4.10: the shader hides back faces itself, but not undersides (above this stretch: a smeared skirt along a depth jump is no underside)
    g.drawElements(g.TRIANGLES, o.n as number, g.UNSIGNED_INT, 0); g.bindVertexArray(null);
  }
  // one view (ANG.view) into the GL canvas: o.bg [r, g, b], o.cull (hide back faces, for the map), o.zCut, o.mip, o.all (every
  // picture with the plain depth test: the map), o.measure (smeared = green)
  function render(V: AngleView, o: AngleDrawOpts = {}): HTMLCanvasElement {
    const g = G();
    size(V.w, V.h); g.bindFramebuffer(g.FRAMEBUFFER, null);
    const bg = o.bg || [128 / 255, 128 / 255, 128 / 255];
    g.viewport(0, 0, V.w, V.h); g.clearColor(bg[0], bg[1], bg[2], 1); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
    g.enable(g.DEPTH_TEST); g.depthFunc(g.LEQUAL);
    if (o.cull && !o.under) { g.enable(g.CULL_FACE); g.cullFace(g.BACK); g.frontFace(g.CCW); } else g.disable(g.CULL_FACE);
    for (const s of o.all ? src : src.slice(0, 1)) {
      const zc = o.zCut && s !== src[0] ? (s.S as AngleSet).ZMAX * 0.97 : o.zCut;   // each picture cuts its own far bits
      drawOne(s, V, P as WebGLProgram, U, Object.assign({}, o, { zCut: zc }));
    }
    return cv as HTMLCanvasElement;
  }
  function freeT(T: Targets) { const g = G(); g.deleteFramebuffer(T.fb); g.deleteTexture(T.col); g.deleteTexture(T.inf); g.deleteRenderbuffer(T.dep); }
  function layer(T: Targets, i: number) { const g = G(); g.framebufferTextureLayer(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, T.col, 0, i); g.framebufferTextureLayer(g.FRAMEBUFFER, g.COLOR_ATTACHMENT1, T.inf, 0, i); }
  // per view size: two texture arrays with a layer per picture (its colour; its distance along the view + how stretched it is)
  // and one depth buffer the pictures take turns with
  function targetsFor(w: number, h: number, n: number): Targets {
    const g = G();
    const k = w + 'x' + h; let T = fbos.get(k) || null;
    if (T && T.n < n) { freeT(T); fbos.delete(k); T = null; }
    if (!T) {
      if (fbos.size >= 4) { const [kk, t] = fbos.entries().next().value as [string, Targets]; freeT(t); fbos.delete(kk); }
      const nt: Targets = { n, fb: g.createFramebuffer() as WebGLFramebuffer, col: g.createTexture() as WebGLTexture, inf: g.createTexture() as WebGLTexture, dep: g.createRenderbuffer() as WebGLRenderbuffer };
      const arr = (t: WebGLTexture, f: number) => { g.bindTexture(g.TEXTURE_2D_ARRAY, t); g.texStorage3D(g.TEXTURE_2D_ARRAY, 1, f, w, h, n); g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MAG_FILTER, g.NEAREST); };
      arr(nt.col, g.RGBA8); arr(nt.inf, g.RG32F); g.bindTexture(g.TEXTURE_2D_ARRAY, null);
      g.bindRenderbuffer(g.RENDERBUFFER, nt.dep); g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT24, w, h);
      g.bindFramebuffer(g.FRAMEBUFFER, nt.fb); layer(nt, 0); g.framebufferRenderbuffer(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.RENDERBUFFER, nt.dep); g.drawBuffers([g.COLOR_ATTACHMENT0, g.COLOR_ATTACHMENT1]);
      const ok = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE; g.bindFramebuffer(g.FRAMEBUFFER, null);
      if (!ok) { freeT(nt); throw new Error('nomerge'); }
      fbos.set(k, nt); T = nt;
    }
    return T;
  }
  // every picture's own view distances (nearest of 3x3 mesh points), for 'it looked straight through here': a layer each, as big
  // as the largest grid (a smaller grid sits in its corner; the look-up never leaves a picture's own grid)
  function depArr(): WebGLTexture {
    const g = G();
    const k = src.map((o) => o.key).join('|'); if (depA && depKey === k) return depA;
    if (depA) g.deleteTexture(depA);
    const C = Math.max(...src.map((o) => (o.S as AngleSet).C)), R = Math.max(...src.map((o) => (o.S as AngleSet).R));
    depA = g.createTexture() as WebGLTexture; g.bindTexture(g.TEXTURE_2D_ARRAY, depA); g.texStorage3D(g.TEXTURE_2D_ARRAY, 1, g.R32F, C, R, src.length);
    g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MAG_FILTER, g.NEAREST);
    src.forEach((o, i) => { const S = o.S as AngleSet; if (!o.near) o.near = ANG.nearGrid(S); g.texSubImage3D(g.TEXTURE_2D_ARRAY, 0, 0, 0, i, S.C, S.R, 1, g.RED, g.FLOAT, o.near); });
    g.bindTexture(g.TEXTURE_2D_ARRAY, null); depKey = k; return depA;
  }
  function progFor(n: number) {
    let p = progs.get(n); if (p) return p;
    const prog = link(VSQ, mergeFS(n)), u: Locs & { k?: Locs[] } = locs(prog, ['uCA', 'uIA', 'uDA', 'uEye', 'uFw', 'uR', 'uU', 'uTan', 'uShift', 'uSize', 'uTol', 'uSmear', 'uStep', 'uBg', 'uMode']);
    u.k = []; for (let i = 0; i < n; i++) u.k.push(locs(prog, ['uPo' + i, 'uT' + i, 'uK' + i, 'uG' + i]));
    p = { prog, u }; progs.set(n, p); return p;
  }
  // every picture from the view V, joined (the rules at the top). mode 0 = the picture, 1 = measure (grey magenta, smeared
  // green), 2 = which picture (red = 1 + its number, 0 = none; green 1 = smeared). o.cull hides back faces (v0.4.8: a wall seen
  // from behind is taken out), o.once frees this size's buffers afterwards (the rough for GPT: a size used once)
  function renderMerged(V: AngleView, o: AngleDrawOpts = {}, mode = 0): HTMLCanvasElement {
    if (src.length < 2) return mode === 1 ? render(V, Object.assign({}, o, { bg: [1, 0, 1], measure: true })) : render(V, o);
    if (!floatOk) throw new Error('nomerge');
    const g = G();
    const n = src.length, T = targetsFor(V.w, V.h, n), D = depArr();
    g.enable(g.DEPTH_TEST); g.depthFunc(g.LEQUAL);
    if (o.cull && !o.under) { g.enable(g.CULL_FACE); g.cullFace(g.BACK); g.frontFace(g.CCW); } else g.disable(g.CULL_FACE);
    g.bindFramebuffer(g.FRAMEBUFFER, T.fb); g.viewport(0, 0, V.w, V.h); g.clearColor(0, 0, 0, 0);
    for (let i = 0; i < n; i++) { layer(T, i); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT); drawOne(src[i], V, PI as WebGLProgram, UI, { mip: o.mip, under: o.under }); }
    g.disable(g.CULL_FACE);
    size(V.w, V.h); g.bindFramebuffer(g.FRAMEBUFFER, null); g.viewport(0, 0, V.w, V.h); g.disable(g.DEPTH_TEST);
    const { prog, u } = progFor(n); g.useProgram(prog); g.bindVertexArray(empty);
    const bg = o.bg || [128 / 255, 128 / 255, 128 / 255], tx = V.tx, ty = V.ty;
    g.uniform3fv(u.uEye, V.eye); g.uniform3fv(u.uFw, V.fw); g.uniform3fv(u.uR, V.r); g.uniform3fv(u.uU, V.u); g.uniform2f(u.uTan, tx, ty); g.uniform2f(u.uShift, V.sx || 0, V.sy || 0); g.uniform2f(u.uSize, V.w, V.h);
    g.uniform1f(u.uTol, TOL); g.uniform1f(u.uSmear, (src[0].texW as number) / V.w / (o.thr || 12)); g.uniform1f(u.uStep, ANG.STEP); g.uniform3fv(u.uBg, bg); g.uniform1i(u.uMode, mode);
    const bind = (unit: number, t: WebGLTexture, loc: WebGLUniformLocation | null) => { g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D_ARRAY, t); g.uniform1i(loc, unit); };
    bind(0, T.col, u.uCA); bind(1, T.inf, u.uIA); bind(2, D, u.uDA);
    for (let i = 0; i < n; i++) {
      const s = src[i], S = s.S as AngleSet, p = s.pose as AnglePose, k = (u.k as Locs[])[i], t = p.yaw * Math.PI / 180;
      g.uniform4f(k['uPo' + i], Math.cos(t), Math.sin(t), p.s || 1, 0); g.uniform3fv(k['uT' + i], p.pos);
      g.uniform4f(k['uK' + i], S.cx, S.cy, S.f, 0); g.uniform4f(k['uG' + i], S.W, S.H, S.C, S.R);
    }
    g.drawArrays(g.TRIANGLES, 0, 3); g.bindVertexArray(null);
    for (const unit of [2, 1, 0]) { g.activeTexture(g.TEXTURE0 + unit); g.bindTexture(g.TEXTURE_2D_ARRAY, null); }   // (free to be drawn into again)
    if (o.once) { freeT(T); fbos.delete(V.w + 'x' + V.h); }
    return cv as HTMLCanvasElement;
  }
  function copy(V: AngleView, o: AngleDrawOpts, into?: HTMLCanvasElement | null): HTMLCanvasElement {
    const c = o && o.merge ? renderMerged(V, o, 0) : render(V, o), t = into || makeCanvas(V.w, V.h);
    if (t.width !== V.w) t.width = V.w; if (t.height !== V.h) t.height = V.h; (t.getContext('2d') as CanvasRenderingContext2D).drawImage(c, 0, 0); return t;
  }
  // how much of a view GPT has to make up: what no picture showed (magenta, which no background uses) and what is smeared into
  // streaks (one texel stretched over 12+ pixels, green); both counted on a small render. Measured on the experiment's places:
  // the seven preset cameras are 7-54 % (the apartment's right 45° with 48 % grey still came out well), turning 60-80° round the
  // living room or the apartment reaches 68-93 %. With more pictures the joined view is measured.
  // v0.4.10 under: undersides (blue) are counted too - GPT draws them from a dark shape only
  function unseen(V: AngleView, thr?: number, cull?: boolean, under?: boolean): AngleUnseen {
    const g = G();
    if (src.length > 1) renderMerged(V, { mip: true, thr, cull, under }, 1); else render(V, { bg: [1, 0, 1], mip: true, measure: true, thr, cull, under });
    const px = new Uint8Array(V.w * V.h * 4); g.readPixels(0, 0, V.w, V.h, g.RGBA, g.UNSIGNED_BYTE, px);
    let gr = 0, st = 0, un = 0;
    for (let i = 0; i < px.length; i += 4) { if (px[i] > 235 && px[i + 1] < 20 && px[i + 2] > 235) gr++; else if (px[i] < 20 && px[i + 1] > 235 && px[i + 2] < 20) st++; else if (px[i] < 20 && px[i + 1] < 20 && px[i + 2] > 235) un++; }
    const n = V.w * V.h; return { grey: gr / n, smear: st / n, under: un / n, all: (gr + st + un) / n };
  }
  // which picture shows where (shares, for the dialog's line and the tests): [none, picture 0, picture 1, ...] and smeared
  function shares(V: AngleView, cull?: boolean, under?: boolean): { by: number[]; smear: number } {
    const g = G();
    renderMerged(V, { mip: true, cull, under }, 2); const px = new Uint8Array(V.w * V.h * 4); g.readPixels(0, 0, V.w, V.h, g.RGBA, g.UNSIGNED_BYTE, px);
    const c = new Array(src.length + 1).fill(0); let sm = 0; for (let i = 0; i < px.length; i += 4) { c[Math.min(src.length, px[i])]++; if (px[i + 1]) sm++; }
    const n = V.w * V.h; return { by: c.map((v: number) => v / n), smear: sm / n };
  }
  /** 창을 닫을 때: 그림판의 버퍼를 모두 돌려준다 (다음에 열면 처음부터). */
  function dispose() {
    if (gl && !gl.isContextLost()) { try { for (const o of src) release(o); for (const T of fbos.values()) freeT(T); if (depA) gl.deleteTexture(depA); for (const p of progs.values()) gl.deleteProgram(p.prog); } catch { /* 이미 잃음 */ } }
    src.length = 0; progs.clear(); fbos.clear(); depA = null; depKey = '';
    try { (gl?.getExtension('WEBGL_lose_context'))?.loseContext(); } catch { /* ignore */ }
    gl = null; cv = null;
  }
  return { ready, setScene, setExtras, count, render, renderMerged, copy, unseen, shares, dispose, get canMerge() { return !!gl && floatOk; }, get key() { return src[0] ? src[0].key ?? null : null; } };
}
export type AngleGL = ReturnType<typeof createAngleGL>;
