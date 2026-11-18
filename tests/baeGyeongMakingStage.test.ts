import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DRAW_PHRASES, DRAW_STAGES, FINALE_DISSOLVE_MS, FINALE_TAIL_MS, ORDER_PHRASES, PHRASE_MS, TUNE_START,
  approach, canvasScale, defaultPhrases, drawReveal, finaleCurve, frameGapMs, letterTilt, nextTalk,
  partialArrivedText, partialPhrase, talkText, tuneLevel, wanderAt, wordsOutMs,
} from '../src/features/bae-gyeong/make/makingStageLogic.ts';

// BAE경 만드는 화면(크게 보기)의 숨쉬는 점 · 기다리는 글자 · 완성 효과 — 계산은 순수 함수로, 화면은 연결만 확인한다.
const read = (f: string) => readFileSync(f, 'utf-8').replace(/\r\n/g, '\n');

test('그리는 중 진행: 실제 단계(중간 그림 0·1·2장)를 따라가고, 단계 안에서는 천천히 자라되 다음 단계에 닿지 않는다', () => {
  for (let n = 0; n < DRAW_STAGES.length; n++) {
    let before = -1;
    for (const sec of [0, 5, 15, 30, 60, 120, 600, 1e6]) {
      const v = drawReveal(n, sec);
      assert.ok(v > before, `단계 ${n} · ${sec}초: 시간이 가면 자란다`);
      assert.ok(v < DRAW_STAGES[n][1] + 1e-9, `단계 ${n}: 천장을 넘지 않는다`);
      if (n + 1 < DRAW_STAGES.length) assert.ok(v < drawReveal(n + 1, 0), `단계 ${n}: 다음 바닥보다 늘 낮다 — 중간 그림이 오면 앞으로 뛴다`);
      before = v;
    }
  }
  assert.equal(drawReveal(0, 0), DRAW_STAGES[0][0]);
  // 다 보이는 것은 완성 효과만 — 그리는 중에는 끝까지 가지 않는다
  assert.ok(drawReveal(99, 1e9) <= DRAW_STAGES[DRAW_STAGES.length - 1][1] + 1e-9);
  assert.ok(DRAW_STAGES[DRAW_STAGES.length - 1][1] < 0.62, '셰이더에서 0.62 쯤이면 거의 다 보인다 — 그 앞에서 멈춘다');
  assert.equal(drawReveal(5, 0), drawReveal(2, 0), '세 장 넘게 와도 마지막 단계');
  assert.equal(drawReveal(-1, -5), drawReveal(0, 0), '이상한 값은 처음으로');
  assert.equal(drawReveal(Number.NaN, Number.NaN), drawReveal(0, 0));
});

test('다가가기: 목표로 부드럽게 가고, 충분히 가까우면 목표에 붙는다', () => {
  let v = 0;
  for (let i = 0; i < 10; i++) v = approach(v, 1, 0.1, 0.6);
  assert.ok(v > 0.75 && v < 1);
  assert.equal(approach(0.99995, 1, 0.1, 0.6), 1);
  assert.equal(approach(0.3, 1, 0, 0.6), 0.3, '시간이 안 흐르면 그대로');
  assert.equal(approach(0.3, 1, 0.1, 0), 1, '시간 상수 0 이면 바로');
});

test('기다리는 문구: 4.3초마다 다음, 중간 그림 문구는 한 번 끼어든 뒤 다음 문구로', () => {
  assert.equal(PHRASE_MS, 4300);
  assert.deepEqual([...DRAW_PHRASES], ['러프 따라 구도 잡는 중', '그림체 기준 맞추는 중', '단색 면으로 칠하는 중', '손맛 넣는 중']);
  assert.equal(defaultPhrases('draw'), DRAW_PHRASES);
  assert.equal(defaultPhrases('order'), ORDER_PHRASES);
  assert.deepEqual([...defaultPhrases('done')], ['완성!']);
  const list = ['가', '나', '다'];
  let t = { i: 0, extra: null as string | null };
  assert.equal(talkText(t, list), '가');
  t = nextTalk(t, list.length); assert.equal(talkText(t, list), '나');
  t = { i: t.i, extra: partialPhrase(1) }; assert.equal(talkText(t, list), '중간 그림이 왔어요');
  t = nextTalk(t, list.length); assert.equal(talkText(t, list), '다');
  t = nextTalk(t, list.length); assert.equal(talkText(t, list), '가', '돌아서 처음으로');
  assert.deepEqual(nextTalk({ i: 4, extra: null }, 1), { i: 0, extra: null }, '하나뿐이면 그대로');
  assert.equal(talkText({ i: 0, extra: null }, []), '');
  assert.equal(partialPhrase(2), '조금만 더요');
  assert.equal(partialArrivedText(1), '중간 그림 1장 도착');
  assert.equal(partialArrivedText(2), '중간 그림 2장 도착');
});

test('오려 붙인 글자: HTML 과 같은 기울기 · 빠지는 시간', () => {
  for (let i = 0; i < 30; i++) {
    assert.equal(letterTilt(i), (((i * 37) % 11) - 5) * 2);
    assert.ok(Math.abs(letterTilt(i)) <= 10);
  }
  assert.equal(wordsOutMs('조금만 더요'), 240 + 6 * 14);
});

test('완성 효과: 약 1.4초, 곡선은 0 에서 1 로', () => {
  assert.equal(FINALE_DISSOLVE_MS + FINALE_TAIL_MS, 1400);
  assert.equal(finaleCurve(0), 0);
  assert.equal(finaleCurve(1), 1);
  assert.equal(finaleCurve(2), 1);
  assert.equal(finaleCurve(-1), 0);
  assert.ok(finaleCurve(0.25) < 0.25 && finaleCurve(0.75) > 0.75);
});

test('성능: 화면 배율 1.5배까지(가볍게 1배) · 판 약 200만 화소까지 · 마우스가 밖이면 초당 30장 · 느린 PC 는 낮춘다', () => {
  assert.equal(canvasScale(2, 800, 400, 0, false), 1.5);
  assert.equal(canvasScale(2, 800, 400, 0, true), 1);
  assert.equal(canvasScale(1, 800, 400, 0, false), 1);
  assert.ok(canvasScale(2, 2560, 1250, 0, false) * 2560 * canvasScale(2, 2560, 1250, 0, false) * 1250 <= 2.0736e6 + 1);
  assert.ok(Math.abs(canvasScale(1, 800, 400, 2, false) - 0.49) < 1e-9);
  assert.equal(canvasScale(Number.NaN, 800, 400, 0, false), 1);
  assert.equal(frameGapMs(true, false, 0), 12);
  assert.equal(frameGapMs(false, false, 0), 30);
  assert.equal(frameGapMs(true, true, 0), 30, '가볍게: 마우스가 있어도 30장');
  assert.equal(frameGapMs(false, false, 4), 64);
  let t = tuneLevel(TUNE_START, 30, 1000);
  assert.equal(t.level, 1, '2초에 50번이 안 되면 한 단계 낮춘다');
  t = tuneLevel(t, 120, 2000);
  assert.equal(t.level, 1, '바로 되돌리지 않는다');
  t = tuneLevel(t, 120, 4000);
  assert.equal(t.level, 0);
  assert.equal(t.wait, 4, '되돌릴 때마다 다음 기다림을 늘린다');
  let low = TUNE_START;
  for (let i = 0; i < 10; i++) low = tuneLevel(low, 0, i * 2000);
  assert.equal(low.level, 5, '다섯 단계까지');
});

test('돋보기가 혼자 도는 자리는 판 안', () => {
  for (let s = 0; s < 200; s += 0.7) {
    const [x, y] = wanderAt(s);
    assert.ok(x >= 0.2 && x <= 0.8 && y >= 0.26 && y <= 0.74);
  }
});

test('화면 연결: 그림 두 겹 위 점 캔버스를 곱하기로, 화면 밖 · 창 가림이면 멈춤, 빠질 때 정리, 움직임 설정을 따른다', () => {
  const tsx = read('src/features/bae-gyeong/make/MakingStage.tsx');
  const css = read('src/features/bae-gyeong/make/making-stage.css');
  const dots = read('src/features/bae-gyeong/make/dotField.ts');
  const ui = read('src/features/bae-gyeong/make/ui.ts');
  assert.match(ui, /phase: 'order' \| 'draw' \| 'done';/);
  assert.match(ui, /phrases\?: string\[\];/);
  assert.match(ui, /partialCount\?: number;/);
  assert.match(ui, /onFinaleEnd\?: \(\) => void;/);
  assert.match(tsx, /className="bae-make-back"/);
  assert.match(tsx, /className=\{`bae-make-pic/);
  assert.match(tsx, /<canvas ref=\{canvasRef\} className=\{`bae-make-dots/);
  assert.match(css, /\.bae-make-dots \{[^}]*mix-blend-mode: multiply;/);
  assert.match(css, /\.bae-make-stage \{[^}]*background: rgb\(var\(--bae-stage\)\);/, '라이트 모드에서도 어두운 무대');
  assert.match(tsx, /new IntersectionObserver/);
  assert.match(tsx, /visibilitychange/);
  assert.match(tsx, /field\?\.dispose\(\)/);
  assert.match(tsx, /useMotionPref\(\)/);
  assert.match(tsx, /setMotion\(reduce, lite\)/);
  assert.match(tsx, /if \(now\.current\.reduce\) \{ setFinale\('shown'\); end\(\);/, '움직임 줄이기: 완성 효과 없이 바로 알림');
  // WebGL2 만, 그림을 읽지 않는다 (텍스처 없음)
  assert.match(dots, /getContext\('webgl2'/);
  assert.doesNotMatch(dots, /texImage2D|sampler2D/);
  assert.match(dots, /webglcontextlost/);
  // 반복 요소에 뒤 흐림 금지, 움직임 줄이기 블록
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /backdrop-filter/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.bae-make-words span[\s\S]*animation: none;/);
  assert.match(css, /:root\[data-motion-lite\] \.bae-make-band::before/);
});
