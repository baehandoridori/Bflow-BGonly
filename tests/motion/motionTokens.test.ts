import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EASE,
  EASE_CSS,
  MOTION_CSS,
  MOTION_MS,
  MOTION_S,
  SWAP_MS,
  animateEl,
  bezierCss,
  fadePreset,
  identityTransform,
  motionPreset,
  transformPreset,
  transitionCss,
} from '../../src/utils/motion.ts';

/* 움직임 폴리싱 바탕 A — 공통 박자가 JS·CSS 변수·Tailwind 세 곳에서 같은 값인지, 프리셋이 합성 스레드 규칙을 지키는지. */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const parseBezier = (css: string) => {
  const match = css.match(/cubic-bezier\(([^)]*)\)/);
  assert.ok(match, `곡선이 아니다: ${css}`);
  return match[1].split(',').map((part) => Number(part.trim()));
};

test('박자 상수: 빠름 120 · 보통 180 · 느림 260, 초 단위·CSS 문자열판도 같은 값', () => {
  assert.deepEqual({ ...MOTION_MS }, { fast: 120, base: 180, slow: 260 });
  assert.deepEqual({ ...MOTION_S }, { fast: 0.12, base: 0.18, slow: 0.26 });
  assert.deepEqual({ ...MOTION_CSS }, { fast: '120ms', base: '180ms', slow: '260ms' });
  assert.equal(SWAP_MS, 140);
});

test('곡선 상수: out·in·std·spring·snap, CSS 문자열판은 같은 숫자', () => {
  assert.deepEqual(EASE.out, [0.16, 1, 0.3, 1]);
  assert.deepEqual(EASE.in, [0.4, 0, 1, 1]);
  assert.deepEqual(EASE.std, [0.4, 0, 0.2, 1]);
  assert.deepEqual(EASE.spring, [0.34, 1.56, 0.64, 1]);
  assert.deepEqual(EASE.snap, [0.2, 0, 0, 1]);
  for (const key of Object.keys(EASE) as (keyof typeof EASE)[]) {
    assert.deepEqual(parseBezier(EASE_CSS[key]), EASE[key], key);
  }
  assert.equal(bezierCss([0.16, 1, 0.3, 1]), 'cubic-bezier(0.16, 1, 0.3, 1)');
  assert.equal(
    transitionCss(['opacity', 'transform'], 'base', 'out'),
    'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
  );
});

test('CSS 변수(--motion-*·--ease-*)가 :root 에 있고 JS 상수와 같은 값', () => {
  const css = read('src/index.css');
  const root = (css.match(/\n:root \{[\s\S]*?\n\}/g) ?? []).find((block) => block.includes('--motion-fast')) ?? '';
  assert.ok(root.includes('--motion-cascade-duration'), '기존 모션 토큰이 있는 :root 블록에 함께 둔다');
  const varValue = (name: string) => root.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
  for (const speed of ['fast', 'base', 'slow'] as const) {
    assert.equal(varValue(`--motion-${speed}`), MOTION_CSS[speed], `--motion-${speed}`);
  }
  for (const ease of ['out', 'in', 'std', 'spring', 'snap'] as const) {
    const value = varValue(`--ease-${ease}`);
    assert.ok(value, `--ease-${ease} 가 없다`);
    assert.deepEqual(parseBezier(value), EASE[ease], `--ease-${ease}`);
  }
  // 같은 이름을 다른 곳(라이트 모드·테마 블록)에서 덮어쓰지 않는다.
  const outsideRoot = css.replace(root, '');
  assert.doesNotMatch(outsideRoot, /--(motion-(fast|base|slow)|ease-(out|in|std|spring|snap))\s*:/);
});

test('Tailwind 확장: duration-fast/base/slow, ease-out-expo/in-quick/spring/snap', () => {
  const config = read('tailwind.config.js');
  const durations = config.match(/transitionDuration:\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  for (const speed of ['fast', 'base', 'slow'] as const) {
    assert.match(durations, new RegExp(`${speed}:\\s*'${MOTION_CSS[speed]}'`), `duration-${speed}`);
  }
  const easings = config.match(/transitionTimingFunction:\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  for (const [name, ease] of [['out-expo', 'out'], ['in-quick', 'in'], ['spring', 'spring'], ['snap', 'snap']] as const) {
    const value = easings.match(new RegExp(`'?${name}'?:\\s*'([^']+)'`))?.[1];
    assert.ok(value, `ease-${name} 가 없다`);
    assert.deepEqual(parseBezier(value), EASE[ease], `ease-${name}`);
  }
});

test('useStackFlip 기본값(380ms · out 곡선)은 그대로다', () => {
  const flip = read('src/hooks/useStackFlip.ts');
  assert.match(flip, /const DEFAULT_DURATION = 380;/);
  assert.match(flip, /const DEFAULT_EASING = 'cubic-bezier\(0\.16, 1, 0\.3, 1\)';/);
});

/* ─── framer 프리셋 ─── */

const MOVEMENT_KEYS = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'translateX', 'translateY'];
const keysOf = (target: object) => Object.keys(target).filter((key) => key !== 'transition' && key !== 'transitionEnd');

test('popIn: transform 문자열로 6px·98% 에서 떠오르고, 끝나면 transform 을 비운다', () => {
  const pop = motionPreset('popIn', false);
  assert.deepEqual(pop.initial, { opacity: 0, transform: 'translateY(6px) scale(0.98)' });
  assert.equal((pop.animate as Record<string, unknown>).transform, 'translateY(0px) scale(1)');
  assert.deepEqual(pop.animate.transitionEnd, { transform: 'none' }, 'translateY(0) 이 남으면 fixed 자손의 기준 상자가 바뀐다');
  assert.deepEqual(pop.transition, { duration: 0.18, ease: EASE.out });
  // 'none' 에서 출발하면 framer 가 scale(0) 에서 출발시키므로 나가기는 [제자리, 목표] 두 키프레임.
  assert.deepEqual((pop.exit as Record<string, unknown>).transform, ['translateY(0px) scale(1)', 'translateY(4px) scale(0.98)']);
  assert.deepEqual(pop.exit.transition, { duration: 0.12, ease: EASE.in });
  for (const target of [pop.initial, pop.animate, pop.exit]) {
    for (const key of MOVEMENT_KEYS) assert.ok(!(key in target), `${key} 는 메인 스레드가 매 프레임 계산한다`);
  }
  assert.equal(motionPreset('popIn', false), pop, '렌더마다 새 객체를 만들지 않는다');
});

test('동작 줄이기: opacity 만 쓰는 변형', () => {
  for (const name of ['popIn', 'fadeSwap'] as const) {
    const reduced = motionPreset(name, true);
    for (const target of [reduced.initial, reduced.animate, reduced.exit]) {
      assert.deepEqual(keysOf(target), ['opacity'], `${name}: 움직임 없이 opacity 만`);
    }
  }
  assert.deepEqual(motionPreset('popIn', true).transition, { duration: 0.12, ease: EASE.std });
  const custom = transformPreset({ from: 'translateX(-12px)' }, true);
  assert.deepEqual(keysOf(custom.animate), ['opacity']);
});

test('fadeSwap: 내용 교체는 opacity 140ms', () => {
  const swap = motionPreset('fadeSwap', false);
  assert.deepEqual(swap.initial, { opacity: 0 });
  assert.deepEqual(keysOf(swap.animate), ['opacity']);
  assert.deepEqual(swap.transition, { duration: 0.14, ease: EASE.std });
  assert.deepEqual(fadePreset(SWAP_MS), swap);
});

test('transformPreset: 갈래가 자기 프리셋을 만들 때도 같은 규칙', () => {
  const slide = transformPreset({ from: 'translateY(8px)', duration: MOTION_MS.slow });
  assert.deepEqual(slide.initial, { opacity: 0, transform: 'translateY(8px)' });
  assert.equal((slide.animate as Record<string, unknown>).transform, 'translateY(0px)');
  assert.deepEqual(slide.animate.transitionEnd, { transform: 'none' });
  assert.deepEqual(slide.transition, { duration: 0.26, ease: EASE.out });
  assert.deepEqual((slide.exit as Record<string, unknown>).transform, ['translateY(0px)', 'translateY(8px)']);
});

test('identityTransform: 모양을 지킨 제자리 값', () => {
  assert.equal(identityTransform('translateY(6px) scale(0.98)'), 'translateY(0px) scale(1)');
  assert.equal(identityTransform('translate(-50%, 12px) rotate(-8deg) scaleX(.4)'), 'translate(0%, 0px) rotate(0deg) scaleX(1)');
  assert.equal(identityTransform('translate3d(0, -4px, 0) scale3d(.9, .9, 1)'), 'translate3d(0, 0px, 0) scale3d(1, 1, 1)');
  assert.throws(() => identityTransform('matrix(1, 0, 0, 1, 0, 0)'));
});

/* ─── WAAPI 도우미 ─── */

function fakeElement() {
  const calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  const el = {
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      calls.push({ keyframes, options });
      return { id: calls.length } as unknown as Animation;
    },
  } as unknown as Element;
  return { el, calls };
}

test('animateEl: 기본값은 보통 180ms · out 곡선, 넘긴 값이 이긴다', () => {
  const { el, calls } = fakeElement();
  const frames = [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }];
  assert.ok(animateEl(el, frames, {}, false));
  assert.deepEqual(calls[0], { keyframes: frames, options: { duration: 180, easing: EASE_CSS.out } });
  animateEl(el, frames, { duration: 700, iterations: Infinity, easing: 'linear' }, false);
  assert.deepEqual(calls[1].options, { duration: 700, iterations: Infinity, easing: 'linear' });
});

test('animateEl: 동작 줄이기면 움직임을 빼고 남은 값만 한 번·120ms 안에', () => {
  const { el, calls } = fakeElement();
  animateEl(el, [{ opacity: 0, transform: 'scale(.6)', offset: 0 }, { opacity: 1, scale: '1' }], { duration: 400, iterations: 3 }, true);
  assert.deepEqual(calls[0].keyframes, [{ opacity: 0, offset: 0 }, { opacity: 1 }]);
  assert.equal(calls[0].options.duration, 120);
  assert.equal(calls[0].options.iterations, 1);

  // 회전만 있는 애니메이션은 아예 돌리지 않는다.
  const spin = animateEl(el, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { iterations: Infinity }, true);
  assert.equal(spin, null);
  assert.equal(calls.length, 1);
});

test('animateEl: 요소나 WAAPI 가 없으면 조용히 null', () => {
  assert.equal(animateEl(null, [{ opacity: 0 }, { opacity: 1 }]), null);
  assert.equal(animateEl({} as Element, [{ opacity: 0 }, { opacity: 1 }]), null);
});
