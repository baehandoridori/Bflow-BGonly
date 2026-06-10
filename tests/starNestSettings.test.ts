import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_DASHBOARD_STAR_NEST_BLUR_PX,
  DEFAULT_DASHBOARD_STAR_NEST_OPACITY,
  DEFAULT_BFLOW_STAR_NEST_SETTINGS,
  DEFAULT_STAR_NEST_SETTINGS,
  applyStarNestTonePreset,
  getThemeSyncedStarNestSettings,
  normalizeBackgroundArt,
  normalizeBflowStarNestSettings,
  normalizeDashboardStarNestBlurPx,
  normalizeDashboardStarNestOpacity,
  normalizeStarNestSettings,
} from '../src/utils/starNestSettings.ts';

test('StarNest defaults use the approved slow maximum speed', () => {
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.maxSpeed, 0.0014);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.directionMode, 'mouse');
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.brightness, 0.006);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.saturation, 0.98);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.colorShift, 0.59);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.sparkle, 0.18);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.sparkleSpeed, 0.1);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.zoom, 0.95);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.darkmatter, 0.26);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.distfade, 0.75);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.iterations, 13);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.quality, 17);
});

test('StarNest settings merge legacy partial preferences with defaults', () => {
  const settings = normalizeStarNestSettings({
    brightness: 0.001,
    sparkle: 0.2,
  });

  assert.equal(settings.maxSpeed, 0.0014);
  assert.equal(settings.brightness, 0.001);
  assert.equal(settings.sparkle, 0.2);
  assert.equal(settings.sparkleSpeed, DEFAULT_STAR_NEST_SETTINGS.sparkleSpeed);
  assert.equal(settings.iterations, DEFAULT_STAR_NEST_SETTINGS.iterations);
});

test('StarNest settings clamp unsafe ranges for the live shader', () => {
  const settings = normalizeStarNestSettings({
    maxSpeed: 5,
    directionMode: 'invalid' as never,
    directionX: 2,
    directionY: -2,
    brightness: -1,
    saturation: 9,
    sparkleSpeed: 20,
    quality: 100,
    iterations: 1,
  });

  assert.equal(settings.maxSpeed, 0.002);
  assert.equal(settings.directionMode, 'mouse');
  assert.equal(settings.directionX, 1);
  assert.equal(settings.directionY, -1);
  assert.equal(settings.brightness, 0.0002);
  assert.equal(settings.saturation, 1);
  assert.equal(settings.sparkleSpeed, 3);
  assert.equal(settings.quality, 20);
  assert.equal(settings.iterations, 10);
});

test('StarNest tone presets keep motion safety while changing visual tone', () => {
  const quiet = applyStarNestTonePreset('quiet', { maxSpeed: 0.02 });

  assert.equal(quiet.maxSpeed, 0.002);
  assert.notEqual(quiet.sparkle, DEFAULT_STAR_NEST_SETTINGS.sparkle);
  assert.notEqual(quiet.sparkleSpeed, DEFAULT_STAR_NEST_SETTINGS.sparkleSpeed);
});

test('StarNest theme sync derives a valid palette from current theme colors', () => {
  const synced = getThemeSyncedStarNestSettings([0, 184, 148], [116, 185, 255], {
    sparkleSpeed: 2.4,
  });

  assert.ok(synced.colorShift >= -1 && synced.colorShift <= 1);
  assert.equal(synced.sparkleSpeed, 0.9);
  assert.equal(synced.brightness, 0.00145);
});

test('StarNest dashboard background cannot cover the app header menu', () => {
  const header = readFileSync('src/components/layout/Header.tsx', 'utf-8');

  assert.match(header, /<header className="[^"]*\brelative\b[^"]*\bz-\d+\b/);
});

test('dashboard StarNest backdrop controls clamp to safe presentation ranges', () => {
  assert.equal(DEFAULT_DASHBOARD_STAR_NEST_OPACITY, 1);
  assert.equal(DEFAULT_DASHBOARD_STAR_NEST_BLUR_PX, 0);
  assert.equal(normalizeDashboardStarNestOpacity(-4), 0.2);
  assert.equal(normalizeDashboardStarNestOpacity(4), 1);
  assert.equal(normalizeDashboardStarNestOpacity('bad'), 1);
  assert.equal(normalizeDashboardStarNestBlurPx(-4), 0);
  assert.equal(normalizeDashboardStarNestBlurPx(44), 20);
  assert.equal(normalizeDashboardStarNestBlurPx('bad'), 0);
});

test('dashboard StarNest backdrop controls are wired through settings and render only on the background layer', () => {
  const settings = readFileSync('src/components/settings/EffectsSection.tsx', 'utf-8');
  const dashboard = readFileSync('src/views/Dashboard.tsx', 'utf-8');
  const appStore = readFileSync('src/stores/useAppStore.ts', 'utf-8');
  const prefs = readFileSync('src/services/settingsService.ts', 'utf-8');

  assert.match(appStore, /dashboardStarNestOpacity: number;/);
  assert.match(appStore, /dashboardStarNestBlurPx: number;/);
  assert.match(prefs, /dashboardStarNestOpacity\?: number;/);
  assert.match(prefs, /dashboardStarNestBlurPx\?: number;/);
  assert.match(settings, /label="불투명도" value=\{dashboardStarNestOpacity\}/);
  assert.match(settings, /label="블러" value=\{dashboardStarNestBlurPx\}/);
  assert.match(dashboard, /settings=\{plexusSettings\.dashboardStarNest \?\? plexusSettings\.starNest\}/);
  assert.match(dashboard, /filter: blurPx > 0 \? `blur\(\$\{blurPx\}px\)` : undefined/);
});

test('Bflow StarNest settings normalize and preserve the approved mockup defaults', () => {
  assert.equal(normalizeBackgroundArt('bflow-starnest'), 'bflow-starnest');
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.intensity, 1);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.particleSpeed, 1.95);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.motionTrail, true);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.cursorReactionEnabled, true);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.cursorReactionRadius, 170);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.cursorGlowStrength, 0.52);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.cursorScaleStrength, 0.52);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.cursorLinksEnabled, true);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.cursorLinkRadius, 150);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.cursorLinkOpacity, 0.34);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.cursorTrailParticlesEnabled, true);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.cursorTrailIntensity, 1);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.cursorTrailLifetime, 1.04);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.colorHue, 219);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.colorSaturation, 1.27);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.colorBrightness, 0.97);
  assert.equal(DEFAULT_BFLOW_STAR_NEST_SETTINGS.hazeStrength, 1.32);

  const unsafe = normalizeBflowStarNestSettings({
    intensity: 4,
    particleSpeed: 9,
    motionTrail: false,
    cursorReactionEnabled: false,
    cursorReactionRadius: 999,
    cursorGlowStrength: -1,
    cursorScaleStrength: 5,
    cursorLinksEnabled: false,
    cursorLinkRadius: 10,
    cursorLinkOpacity: 4,
    cursorTrailParticlesEnabled: false,
    cursorTrailIntensity: -4,
    cursorTrailLifetime: 4,
    colorHue: 900,
    colorSaturation: 9,
    colorBrightness: -4,
    hazeStrength: 8,
  });

  assert.equal(unsafe.intensity, 1);
  assert.equal(unsafe.particleSpeed, 2.5);
  assert.equal(unsafe.motionTrail, false);
  assert.equal(unsafe.cursorReactionEnabled, false);
  assert.equal(unsafe.cursorReactionRadius, 360);
  assert.equal(unsafe.cursorGlowStrength, 0);
  assert.equal(unsafe.cursorScaleStrength, 1.8);
  assert.equal(unsafe.cursorLinksEnabled, false);
  assert.equal(unsafe.cursorLinkRadius, 60);
  assert.equal(unsafe.cursorLinkOpacity, 1);
  assert.equal(unsafe.cursorTrailParticlesEnabled, false);
  assert.equal(unsafe.cursorTrailIntensity, 0);
  assert.equal(unsafe.cursorTrailLifetime, 1.4);
  assert.equal(unsafe.colorHue, 360);
  assert.equal(unsafe.colorSaturation, 1.6);
  assert.equal(unsafe.colorBrightness, 0.45);
  assert.equal(unsafe.hazeStrength, 1.6);
  assert.deepEqual(normalizeBflowStarNestSettings(null), DEFAULT_BFLOW_STAR_NEST_SETTINGS);
});

test('Bflow StarNest option is wired through settings, persistence, and app surfaces', () => {
  const settings = readFileSync('src/components/settings/EffectsSection.tsx', 'utf-8');
  const dashboard = readFileSync('src/views/Dashboard.tsx', 'utf-8');
  const login = readFileSync('src/components/auth/LoginScreen.tsx', 'utf-8');
  const appStore = readFileSync('src/stores/useAppStore.ts', 'utf-8');
  const prefs = readFileSync('src/services/settingsService.ts', 'utf-8');
  const app = readFileSync('src/App.tsx', 'utf-8');

  assert.match(appStore, /bflowStarNest: BflowStarNestSettings;/);
  assert.match(appStore, /loginBflowStarNest: BflowStarNestSettings;/);
  assert.match(appStore, /dashboardBflowStarNest: BflowStarNestSettings;/);
  assert.match(appStore, /shareBackgroundEffectPresets: boolean;/);
  assert.match(prefs, /bflowStarNest\?: Partial<BflowStarNestSettings>;/);
  assert.match(prefs, /loginBflowStarNest\?: Partial<BflowStarNestSettings>;/);
  assert.match(prefs, /dashboardBflowStarNest\?: Partial<BflowStarNestSettings>;/);
  assert.match(prefs, /shareBackgroundEffectPresets\?: boolean;/);
  assert.match(app, /const shareBackgroundEffectPresets = p\.shareBackgroundEffectPresets \?\? true;/);
  assert.match(app, /const legacyBflowStarNest = normalizeBflowStarNestSettings\(/);
  assert.match(app, /p\.dashboardBflowStarNest \?\? p\.bflowStarNest \?\? p\.loginBflowStarNest/);
  assert.match(app, /bflowStarNest: legacyBflowStarNest/);
  assert.match(app, /loginBflowStarNest: shareBackgroundEffectPresets \? legacyBflowStarNest : loadedLoginBflowStarNest/);
  assert.match(app, /dashboardBflowStarNest: shareBackgroundEffectPresets \? legacyBflowStarNest : loadedDashboardBflowStarNest/);
  assert.match(settings, /value: 'bflow-starnest', label: 'Bflow식'/);
  assert.match(settings, /로그인\/대시보드 프리셋 공유/);
  assert.match(settings, /shareBackgroundEffectPresets/);
  assert.match(settings, /로그인 Bflow식 StarNest 세부 설정/);
  assert.match(settings, /대시보드 Bflow식 StarNest 세부 설정/);
  assert.match(settings, /function StarNestControls/);
  assert.match(settings, /const updateSurfaceStarNest = useCallback/);
  assert.match(settings, /로그인 기본 StarNest 세부 설정/);
  assert.match(settings, /대시보드 기본 StarNest 세부 설정/);
  assert.match(settings, /onChange=\{\(partial\) => updateSurfaceStarNest\('login', partial\)\}/);
  assert.match(settings, /onChange=\{\(partial\) => updateSurfaceStarNest\('dashboard', partial\)\}/);
  assert.doesNotMatch(settings, /StarNest를 선택한 화면에 공통으로 적용합니다/);
  assert.match(settings, /랜덤 프리셋/);
  assert.match(settings, /플렉서스, StarNest, Bflow식 중 하나를 무작위로 선택합니다\./);
  assert.match(settings, /const RANDOM_BACKGROUND_TARGETS: BackgroundArt\[\] = \['plexus', 'starnest', 'bflow-starnest'\];/);
  assert.match(settings, /function pickRandomBackgroundArt\(\): BackgroundArt/);
  assert.match(settings, /const applyRandomBackgroundPreset = useCallback/);
  assert.match(settings, /const randomBackgroundArt = pickRandomBackgroundArt\(\);/);
  assert.match(settings, /backgroundArt: randomBackgroundArt/);
  assert.match(settings, /loginBackgroundArt: randomBackgroundArt/);
  assert.match(settings, /dashboardBackgroundArt: randomBackgroundArt/);
  assert.match(settings, /onClick=\{applyRandomBackgroundPreset\}/);
  assert.match(settings, />\s*랜덤 선택\s*</);
  assert.doesNotMatch(settings, /randomSliderValue/);
  assert.doesNotMatch(settings, /randomizePlexusSettings/);
  assert.doesNotMatch(settings, /randomizeStarNestSettings/);
  assert.doesNotMatch(settings, /randomizeBflowStarNestSettings/);
  assert.doesNotMatch(settings, /RandomBackgroundTarget/);
  assert.doesNotMatch(settings, /setRandomTarget/);
  assert.doesNotMatch(settings, /선택한 배경 효과의 주요 슬라이더 값을 새 조합으로 바꿉니다\./);
  assert.match(settings, /label="Bflow 강도" value=\{settings\.intensity\}/);
  assert.doesNotMatch(settings, /\{ label: '0', value: 0 \}/);
  assert.doesNotMatch(settings, /\{ label: '72', value: 0\.72 \}/);
  assert.doesNotMatch(settings, /\{ label: '100', value: 1 \}/);
  assert.doesNotMatch(settings, /Math\.abs\(settings\.intensity - preset\.value\)/);
  assert.match(settings, /label="입자 속도" value=\{settings\.particleSpeed\}/);
  assert.doesNotMatch(settings, /움직임 잔상/);
  assert.doesNotMatch(settings, /settings\.motionTrail/);
  assert.match(settings, />\s*커서 별 반응\s*</);
  assert.match(settings, /label="반응 범위" value=\{settings\.cursorReactionRadius\}/);
  assert.match(settings, /label="반응 밝기" value=\{settings\.cursorGlowStrength\}/);
  assert.match(settings, /label="반응 크기" value=\{settings\.cursorScaleStrength\}/);
  assert.match(settings, /max=\{1\.8\}/);
  assert.match(settings, />\s*주변 연결선\s*</);
  assert.match(settings, /label="연결 범위" value=\{settings\.cursorLinkRadius\}/);
  assert.match(settings, /label="선 투명도" value=\{settings\.cursorLinkOpacity\}/);
  assert.match(settings, />\s*잔향 입자\s*</);
  assert.match(settings, /label="잔향 양" value=\{settings\.cursorTrailIntensity\}/);
  assert.match(settings, /label="잔향 시간" value=\{settings\.cursorTrailLifetime\}/);
  assert.match(settings, />\s*이미지 톤\s*</);
  assert.match(settings, /label="색상" value=\{settings\.colorHue\}/);
  assert.match(settings, /label="채도" value=\{settings\.colorSaturation\}/);
  assert.match(settings, /label="밝기" value=\{settings\.colorBrightness\}/);
  assert.match(settings, /label="배경 빛" value=\{settings\.hazeStrength\}/);
  assert.match(login, /settings=\{plexusSettings\.loginBflowStarNest \?\? plexusSettings\.bflowStarNest\}/);
  assert.match(dashboard, /settings=\{plexusSettings\.dashboardBflowStarNest \?\? plexusSettings\.bflowStarNest\}/);
  assert.match(login, /backgroundArt === 'bflow-starnest'/);
  assert.match(dashboard, /backgroundArt === 'bflow-starnest'/);
});

test('Bflow StarNest canvas wires cursor reaction, cursor links, and cursor trail particles', () => {
  const bflow = readFileSync('src/components/effects/BflowStarNestBackground.tsx', 'utf-8');

  assert.match(bflow, /interface BflowCursorTrailParticle/);
  assert.match(bflow, /const cursor = \{ x: -9999, y: -9999, active: false \};/);
  assert.match(bflow, /const trailParticles: BflowCursorTrailParticle\[\] = \[\];/);
  assert.match(bflow, /current\.cursorReactionEnabled/);
  assert.match(bflow, /current\.cursorLinksEnabled/);
  assert.match(bflow, /current\.cursorTrailParticlesEnabled/);
  assert.match(bflow, /cursorReactionRadius/);
  assert.match(bflow, /cursorGlowStrength/);
  assert.match(bflow, /cursorScaleStrength/);
  assert.match(bflow, /cursorLinkRadius/);
  assert.match(bflow, /cursorLinkOpacity/);
  assert.match(bflow, /cursorTrailIntensity/);
  assert.match(bflow, /cursorTrailLifetime/);
  assert.match(bflow, /particleSpeed/);
  assert.doesNotMatch(bflow, /current\.motionTrail/);
  assert.doesNotMatch(bflow, /const stretch =/);
  assert.match(bflow, /const longRadius = radius;/);
  assert.match(bflow, /const shortRadius = radius;/);
  assert.match(bflow, /colorHue/);
  assert.match(bflow, /colorSaturation/);
  assert.match(bflow, /colorBrightness/);
  assert.match(bflow, /hazeStrength/);
});

test('original StarNest switches to the light-mode corrected shader when the app theme changes', () => {
  const starNest = readFileSync('src/components/effects/StarNestBackground.tsx', 'utf-8');

  assert.match(starNest, /const FRAGMENT_LIGHT_SOURCE = `/);
  assert.match(starNest, /uniform float uLightHue;/);
  assert.match(starNest, /vec3 hslToRgb/);
  assert.match(starNest, /color = mix\(color, paper, uLightBlur \* 0\.22\);/);
  assert.match(starNest, /const colorMode = useAppStore\(\(s\) => s\.colorMode\);/);
  assert.match(starNest, /const colorModeRef = useRef\(colorMode\);/);
  assert.match(starNest, /const darkBundle = createProgramBundle\(gl, FRAGMENT_SOURCE\);/);
  assert.match(starNest, /const lightBundle = createProgramBundle\(gl, FRAGMENT_LIGHT_SOURCE\);/);
  assert.match(starNest, /colorModeRef\.current === 'light' \? lightBundle : darkBundle/);
  assert.match(starNest, /const UNIFORM_KEYS = \[/);
  assert.match(starNest, /gl\.uniform1f\(locs\.uLightHue, 0\.58\);/);
  assert.match(starNest, /gl\.uniform1f\(locs\.uLightChroma, 0\.62\);/);
  assert.match(starNest, /gl\.uniform1f\(locs\.uLightClarity, 0\.82\);/);
  assert.match(starNest, /gl\.uniform1f\(locs\.uLightBlur, 0\.18\);/);
  assert.match(starNest, /\}, \[enabled\]\);/);
});

test('StarNest canvases do not restart their render loops on light dark switches', () => {
  const starNest = readFileSync('src/components/effects/StarNestBackground.tsx', 'utf-8');
  const bflow = readFileSync('src/components/effects/BflowStarNestBackground.tsx', 'utf-8');

  assert.match(starNest, /colorModeRef\.current = colorMode;/);
  assert.match(starNest, /\}, \[enabled\]\);/);
  assert.doesNotMatch(starNest, /\}, \[enabled, colorMode\]\);/);
  assert.match(bflow, /const schemeRef = useRef\(resolvedScheme\);/);
  assert.match(bflow, /schemeRef\.current = resolvedScheme;/);
  assert.match(bflow, /const isDark = schemeRef\.current === 'dark';/);
  assert.match(bflow, /\}, \[enabled\]\);/);
  assert.doesNotMatch(bflow, /\}, \[enabled, resolvedScheme\]\);/);
});

test('Bflow StarNest link radius expands a cursor-rooted chained network', () => {
  const bflow = readFileSync('src/components/effects/BflowStarNestBackground.tsx', 'utf-8');

  assert.match(bflow, /const cursorLinkCandidates = renderedStars/);
  assert.match(bflow, /const cursorAreaAlpha = Math\.min/);
  assert.match(bflow, /const cursorLinkReachRadius = current\.cursorLinkRadius;/);
  assert.match(bflow, /const cursorLinkSegmentMax = Math\.min\(220, Math\.max\(120, current\.cursorLinkRadius \* 0\.72\)\);/);
  assert.match(bflow, /const cursorLinkSeeds = cursorLinkCandidates/);
  assert.match(bflow, /cursorLinkDepth/);
  assert.match(bflow, /const maxCursorLinkPairs = 84;/);
  assert.match(bflow, /current\.cursorScaleStrength \* 1\.35/);
  assert.doesNotMatch(bflow, /Math\.min\(96, current\.cursorLinkRadius \* 0\.42\)/);
});

test('Bflow StarNest mouse flow uses the original center deadzone behavior', () => {
  const bflow = readFileSync('src/components/effects/BflowStarNestBackground.tsx', 'utf-8');

  assert.match(bflow, /const deadzone = 0\.16;/);
  assert.match(bflow, /const edge = Math\.max\(0, \(localDistance - deadzone\) \/ \(1 - deadzone\)\);/);
  assert.match(bflow, /driftTarget\.x = localDistance > 0\.001 \? \(localX \/ localDistance\) \* easedEdge : 0;/);
  assert.match(bflow, /driftTarget\.edge = easedEdge;/);
  assert.doesNotMatch(bflow, /Math\.max\(0\.18, smoothDrift\.edge\)/);
  assert.match(bflow, /const driftSpeed = \(isDark \? 30 : 34\) \* intensity \* particleSpeed \* \(driftForce \* 1\.08 \+ movement \* 0\.35\);/);
});

test('Bflow StarNest visual flow is not inverted against the approved preview direction', () => {
  const bflow = readFileSync('src/components/effects/BflowStarNestBackground.tsx', 'utf-8');
  const mockup = readFileSync('docs/mockups/2026-06-06-starnest-light-real-vs-bflow.html', 'utf-8');

  assert.match(bflow, /const visualFlowX = -activeX;/);
  assert.match(bflow, /const visualFlowY = -activeY;/);
  assert.match(bflow, /const rawX = star\.x - offset\.x \* depth - px \* star\.z/);
  assert.match(bflow, /const rawY = star\.y \+ offset\.y \* depth - py \* star\.z/);
  assert.match(mockup, /const visualFlowX = -activeX;/);
  assert.match(mockup, /const rawX = star\.x - offset\.x \* depth - px \* star\.z/);
});

test('effects settings include a preview-only draggable layout board for design drafting', () => {
  const settings = readFileSync('src/components/settings/EffectsSection.tsx', 'utf-8');
  const designer = readFileSync('src/components/settings/EffectLayoutDesigner.tsx', 'utf-8');

  assert.match(settings, /import \{ EffectLayoutDesigner \} from '\.\/EffectLayoutDesigner';/);
  assert.match(settings, /function isCodexPreviewLayoutDraft\(\)/);
  assert.match(settings, /!import\.meta\.env\.DEV/);
  assert.match(settings, /params\.has\('codex'\) \|\| params\.has\('verify'\)/);
  assert.match(settings, /레이아웃 보드/);
  assert.match(designer, /const STORAGE_KEY = 'bflow\.effects\.layoutDraft\.v4';/);
  assert.match(designer, /const LAYOUT_VERSION = 4;/);
  assert.match(designer, /const BOARD_W = 560;/);
  assert.match(designer, /const BOARD_H = 980;/);
  assert.match(designer, /payload\.version !== LAYOUT_VERSION/);
  assert.match(designer, /JSON\.stringify\(\{ version: LAYOUT_VERSION, items \}\)/);
  assert.match(designer, /실제 설정 폭에 맞춘 세로 프레임/);
  assert.match(designer, /label: '로그인 화면 배경 설정'/);
  assert.match(designer, /label: '로그인 Bflow식 StarNest 세부 설정'/);
  assert.match(designer, /label: '대시보드 화면 배경 설정'/);
  assert.match(designer, /label: '대시보드 Bflow식 StarNest 세부 설정'/);
  assert.match(designer, /kind: 'detailPanel'/);
  assert.match(designer, /note: '이미지 톤 \/ 반응 크기 \/ 연결선 \/ 잔향 입자'/);
  assert.doesNotMatch(designer, /\['0', '72', '100'\]/);
  assert.doesNotMatch(designer, /label: '화면별 배경 아트'/);
  assert.match(designer, /onPointerDown=\{\(event\) => startDrag\(event, item, 'move'\)\}/);
  assert.match(designer, /onPointerDown=\{\(event\) => startDrag\(event, item, 'resize'\)\}/);
});

test('effects settings keep Plexus, original StarNest, and Bflow StarNest details separated', () => {
  const settings = readFileSync('src/components/settings/EffectsSection.tsx', 'utf-8');

  assert.doesNotMatch(settings, /\{usesStarNest && \(/);
  assert.match(settings, /loginBackgroundArt === 'starnest'/);
  assert.match(settings, /dashboardBackgroundArt === 'starnest'/);
  assert.match(settings, /loginBackgroundArt === 'bflow-starnest'/);
  assert.match(settings, /dashboardBackgroundArt === 'bflow-starnest'/);
  assert.match(settings, /\{usesPlexus && \(/);
  assert.match(settings, /로그인 기본 StarNest 세부 설정/);
  assert.match(settings, /대시보드 기본 StarNest 세부 설정/);
  assert.match(settings, /onChange=\{\(partial\) => updateSurfaceStarNest\('login', partial\)\}/);
  assert.match(settings, /onChange=\{\(partial\) => updateSurfaceStarNest\('dashboard', partial\)\}/);
  assert.doesNotMatch(settings, />\s*StarNest 세부 설정\s*</);
  assert.doesNotMatch(settings, /StarNest를 선택한 화면에 공통으로 적용합니다/);
  assert.match(settings, /Bflow식 StarNest 세부 설정/);
  assert.match(settings, />\s*플렉서스 세부 설정\s*</);
  assert.match(settings, /로그인 화면 배경 설정/);
  assert.match(settings, /대시보드 화면 배경 설정/);
  assert.match(settings, /onChange=\{\(partial\) => updateSurfaceBflowStarNest\('login', partial\)\}/);
  assert.match(settings, /onChange=\{\(partial\) => updateSurfaceBflowStarNest\('dashboard', partial\)\}/);
  assert.doesNotMatch(settings, /StarNest 조절값은 위 전용 패널에서 바로 수정합니다/);
});
