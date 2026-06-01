import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_DASHBOARD_STAR_NEST_BLUR_PX,
  DEFAULT_DASHBOARD_STAR_NEST_OPACITY,
  DEFAULT_STAR_NEST_SETTINGS,
  applyStarNestTonePreset,
  getThemeSyncedStarNestSettings,
  normalizeDashboardStarNestBlurPx,
  normalizeDashboardStarNestOpacity,
  normalizeStarNestSettings,
} from '../src/utils/starNestSettings.ts';

test('StarNest defaults use the approved slow maximum speed', () => {
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.maxSpeed, 0.002);
  assert.equal(DEFAULT_STAR_NEST_SETTINGS.directionMode, 'mouse');
});

test('StarNest settings merge legacy partial preferences with defaults', () => {
  const settings = normalizeStarNestSettings({
    brightness: 0.001,
    sparkle: 0.2,
  });

  assert.equal(settings.maxSpeed, 0.002);
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
  assert.ok(quiet.sparkle < DEFAULT_STAR_NEST_SETTINGS.sparkle);
  assert.ok(quiet.sparkleSpeed < DEFAULT_STAR_NEST_SETTINGS.sparkleSpeed);
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
