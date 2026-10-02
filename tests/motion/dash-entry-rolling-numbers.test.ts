import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EASE } from '../../src/utils/motion.ts';
import {
  COUNT_UP_MIN_DELTA,
  MAX_ROLL_SPAN,
  ROLL_MS,
  ROLL_QUIET_MS,
  STRIP_CELLS,
  STRIP_TEXT,
  chooseRollMode,
  formatRolling,
  makeBezierEasing,
  nextStripTarget,
  planStripRoll,
  progressBucket,
  ringReveal,
  ringSegmentArcs,
  rollDirection,
  splitRollingDigits,
  type RollDirection,
} from '../../src/utils/progressMotion.ts';

/* 움직임 폴리싱 10번 — 진행률 숫자가 막대와 함께 또르륵 굴러가며 바뀌기 (갈래 dash-entry) */

const read = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const mod10 = (n: number) => ((n % 10) + 10) % 10;

test('숫자 글자열: 소수 자릿수 고정(폭 고정), 숫자가 아니면 0', () => {
  assert.equal(formatRolling(45.234, 1), '45.2');
  assert.equal(formatRolling(45, 1), '45.0');
  assert.equal(formatRolling(99.96, 1), '100.0');
  assert.equal(formatRolling(37.5, 0), '38');
  assert.equal(formatRolling(Number.NaN, 1), '0.0');
  assert.equal(formatRolling(Number.POSITIVE_INFINITY), '0');
});

test('자리 키는 일의 자리·소수 자리 기준 — 9.9 → 10.0 에서 같은 자리가 제자리에서 굴러간다', () => {
  const before = splitRollingDigits('9.9');
  const after = splitRollingDigits('10.0');
  assert.deepEqual(before.map((t) => t.key), ['i0', 'dot', 'f1']);
  assert.deepEqual(after.map((t) => t.key), ['i1', 'i0', 'dot', 'f1']);
  const digitOf = (tokens: ReturnType<typeof splitRollingDigits>, key: string) => {
    const token = tokens.find((t) => t.key === key);
    return token && token.kind === 'digit' ? token.digit : undefined;
  };
  assert.equal(digitOf(before, 'i0'), 9);
  assert.equal(digitOf(after, 'i0'), 0);
  assert.equal(digitOf(after, 'i1'), 1);
  // 소수점은 굴리지 않는 고정 글자
  assert.deepEqual(after.find((t) => t.key === 'dot'), { kind: 'char', key: 'dot', char: '.' });
  // 25 → 37.5 처럼 소수 자리가 생겨도 정수 자리 키는 그대로
  assert.deepEqual(splitRollingDigits('37.5').map((t) => t.key), ['i1', 'i0', 'dot', 'f1']);
});

test('방향: 오를 땐 위로만(9→0 은 한 칸 앞으로), 내릴 땐 아래로만(0→9 는 한 칸 뒤로) — 되감기 없음', () => {
  assert.equal(rollDirection(45.2, 45.6), 1);
  assert.equal(rollDirection(45.6, 45.2), -1);
  assert.equal(nextStripTarget(9, 0, 1), 10);
  assert.equal(nextStripTarget(10, 9, -1), 9);
  assert.equal(nextStripTarget(0, 9, -1), -1);
  assert.equal(nextStripTarget(7, 2, 1), 12);
  assert.equal(nextStripTarget(2, 7, -1), -3);
  assert.equal(nextStripTarget(4, 4, 1), 4);
  assert.equal(nextStripTarget(4, 4, -1), 4);
});

test('띠 계획: 쉬던 자리에서 출발하면 언제나 지정 방향으로 9칸 이내, 띠 범위 안, 도착 칸은 그 숫자', () => {
  assert.equal(STRIP_CELLS, 40);
  assert.equal(STRIP_TEXT.split('\n').length, STRIP_CELLS);
  assert.deepEqual(STRIP_TEXT.split('\n').slice(0, 12), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1']);
  for (let rest = -15; rest <= 45; rest += 1) {
    for (let digit = 0; digit <= 9; digit += 1) {
      for (const dir of [1, -1] as RollDirection[]) {
        const { from, to } = planStripRoll(rest, rest, digit, dir);
        assert.ok(from >= 0 && from < STRIP_CELLS, `from 범위 ${rest}→${digit}`);
        assert.ok(to >= 0 && to < STRIP_CELLS, `to 범위 ${rest}→${digit}`);
        assert.equal(mod10(to), digit, '도착 칸의 글자');
        assert.equal(mod10(from), mod10(rest), '출발 칸의 글자는 지금 보이는 숫자');
        const moved = to - from;
        assert.ok(dir > 0 ? moved >= 0 : moved <= 0, `${dir > 0 ? '위' : '아래'}로만 (${rest}→${digit}: ${moved})`);
        assert.ok(Math.abs(moved) <= 9);
      }
    }
  }
});

test('띠 계획: 굴러가는 중 연타가 겹쳐도(보이는 자리가 늦어도) 띠 범위를 벗어나지 않고 그 자리에서 이어 감는다', () => {
  // 0.4%씩 다섯 번 연타: 소수 자리 2 → 6 → 0 → 4 → 8 → 2, 화면은 아직 첫 칸 근처
  let target = 2;
  const visual = 2.3;
  for (const digit of [6, 0, 4, 8, 2]) {
    const plan = planStripRoll(visual, target, digit, 1);
    assert.ok(plan.from >= 0 && plan.to < STRIP_CELLS, JSON.stringify(plan));
    assert.ok(plan.to >= plan.from, '위로만');
    assert.ok(plan.to - plan.from <= MAX_ROLL_SPAN);
    assert.equal(mod10(plan.to), digit);
    assert.ok(Math.abs(mod10(plan.from) - mod10(visual)) < 1e-9, '출발은 지금 보이는 자리');
    target = plan.to; // 다음 계획의 직전 목표 = 이번 도착 칸(같은 띠 좌표)
  }
  // 아주 많이 겹쳐도 같은 숫자의 가까운 벌로 줄여 띠 안에 머문다
  for (let i = 0; i < 12; i += 1) {
    const plan = planStripRoll(visual, target, mod10(target + 9), 1);
    assert.ok(plan.from >= 0 && plan.to < STRIP_CELLS && plan.to >= plan.from, JSON.stringify(plan));
    target = plan.to;
  }
  // 내리는 방향 연타도 같은 규칙
  let down = 30;
  for (const digit of [7, 3, 9, 5]) {
    const plan = planStripRoll(29.6, down, digit, -1);
    assert.ok(plan.to >= 0 && plan.from < STRIP_CELLS, JSON.stringify(plan));
    assert.ok(plan.to <= plan.from, '아래로만');
    assert.equal(mod10(plan.to), digit);
    down = plan.to;
  }
});

test('굴림/카운트업 선택: 5%p 이상이면 막대와 함께 세어 올라가고, 세는 중이면 이어 센다, 막대 없는 숫자는 늘 굴림', () => {
  assert.equal(COUNT_UP_MIN_DELTA, 5);
  assert.equal(chooseRollMode(45.2, 45.6, { countUp: true, counting: false }), 'roll');
  assert.equal(chooseRollMode(24.8, 25.3, { countUp: true, counting: false }), 'roll');
  assert.equal(chooseRollMode(42, 78, { countUp: true, counting: false }), 'count');
  assert.equal(chooseRollMode(78, 42, { countUp: true, counting: false }), 'count');
  assert.equal(chooseRollMode(60.1, 60.5, { countUp: true, counting: true }), 'count');
  assert.equal(chooseRollMode(0, 100, { countUp: false, counting: false }), 'roll');
});

test('카운트업 곡선은 막대 CSS 곡선(EASE.out = cubic-bezier(.16,1,.3,1))과 같은 값', () => {
  const ease = makeBezierEasing(EASE.out as readonly number[]);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  // 독립 계산: 매개변수 s 를 촘촘히 훑어 (x(s), y(s)) 에서 x=t 인 y 를 찾는다
  const [x1, y1, x2, y2] = EASE.out as number[];
  const bez = (p0: number, p1: number, s: number) => 3 * (1 - s) * (1 - s) * s * p0 + 3 * (1 - s) * s * s * p1 + s * s * s;
  for (const t of [0.05, 0.1, 0.25, 0.5, 0.75, 0.9]) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 80; i += 1) {
      const mid = (lo + hi) / 2;
      if (bez(x1, x2, mid) < t) lo = mid; else hi = mid;
    }
    const expected = bez(y1, y2, (lo + hi) / 2);
    assert.ok(Math.abs(ease(t) - expected) < 1e-4, `t=${t}: ${ease(t)} vs ${expected}`);
  }
  let prev = 0;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const v = ease(t);
    assert.ok(v >= prev - 1e-9, '단조 증가');
    prev = v;
  }
});

test('명언 구간: 같은 구간 안의 작은 변화는 같은 구간(명언 유지), 경계를 넘을 때만 바뀐다', () => {
  assert.equal(progressBucket(45.2), progressBucket(45.6));
  assert.equal(progressBucket(25), '25-50');
  assert.equal(progressBucket(24.9), '10-25');
  assert.equal(progressBucket(0), '0');
  assert.equal(progressBucket(0.1), '1-10');
  assert.equal(progressBucket(99.9), '75-99');
  assert.equal(progressBucket(100), '100');
});

test('진행률 원: 구간색 띠 4개는 값과 무관하게 늘 꽉 찬 모양으로 이어 붙어 있다(경계에서 새 띠가 툭 생기지 않음)', () => {
  const circumference = 2 * Math.PI * 60;
  const segs = [
    { min: 0, max: 25, color: '#a' },
    { min: 25, max: 50, color: '#b' },
    { min: 50, max: 75, color: '#c' },
    { min: 75, max: 100, color: '#d' },
  ];
  const arcs = ringSegmentArcs(segs, circumference);
  assert.deepEqual(arcs.map((a) => a.key), [0, 25, 50, 75]);
  let start = 0;
  for (const arc of arcs) {
    const [length] = arc.dasharray.split(' ').map(Number);
    assert.ok(Math.abs(arc.dashoffset + start) < 1e-9, '앞 띠 끝에서 이어진다');
    start += length;
  }
  assert.ok(Math.abs(start - circumference) < 1e-9, '네 띠를 합치면 한 바퀴');

  const zero = ringReveal(0, circumference);
  assert.deepEqual(zero, { length: 0, capDeg: 0, capVisible: false });
  const crossing = ringReveal(25.3, circumference);
  assert.ok(Math.abs(crossing.length - 0.253 * circumference) < 1e-9);
  assert.ok(Math.abs(crossing.capDeg - 91.08) < 1e-9, '끝점 각도는 길이와 같은 비율');
  assert.equal(ringReveal(130, circumference).capDeg, 360);
  assert.equal(ringReveal(-5, circumference).length, 0);
});

test('막대·원 박자 = 숫자 박자: CSS --motion-roll 이 ROLL_MS 와 같고, 동작 줄이기 전역 규칙을 이기는 !important 가 없다', () => {
  const css = read('src/styles/motion-view-entry.css');
  const roll = css.match(/--motion-roll:\s*(\d+)ms/);
  assert.ok(roll, '--motion-roll 정의');
  assert.equal(Number(roll[1]), ROLL_MS);
  assert.equal(ROLL_MS, 500);
  assert.ok(ROLL_QUIET_MS > 0 && ROLL_QUIET_MS < 1000);
  const section = css.slice(css.indexOf('/* ─── 10. 진행률 숫자 굴림'));
  assert.ok(section.length > 0);
  const rules = section.split('/* ─── 13.')[0].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /!important/);
  assert.match(css, /\.bf-progress-bar\s*\{\s*transition:\s*width var\(--motion-roll\) var\(--ease-out\);/);
  assert.match(css, /\.bf-progress-arc\s*\{[^}]*stroke-dasharray var\(--motion-roll\) var\(--ease-out\)/);
  assert.match(css, /\.bf-progress-cap\s*\{[^}]*transform var\(--motion-roll\) var\(--ease-out\)/);
  assert.match(css, /\.bf-roll\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  // 굴림 칸은 overflow: clip 으로 자른다 — hidden(기준선이 바뀜)·clip-path(띠가 스크롤 높이에 잡혀 스크롤바가 생김) 금지
  const col = css.match(/\.bf-roll-col\s*\{[^}]*\}/)![0];
  assert.match(col, /overflow:\s*clip;/);
  assert.doesNotMatch(col, /clip-path|overflow:\s*hidden/);
});

test('RollingNumber: 숫자 칸만 WAAPI transform 으로 굴리고, 동작 줄이기·처음·탭 전환은 바로 최종값', () => {
  const src = read('src/components/ui/RollingNumber.tsx');
  assert.match(src, /useMotionPref\(\)/);
  assert.match(src, /if \(reduce \|\| at < quietUntilRef\.current\)/, '동작 줄이기·조용한 구간이면 바로');
  assert.match(src, /if \(keyChanged\) quietUntilRef\.current = at \+ ROLL_QUIET_MS/, 'resetKey 가 바뀐 직후는 굴리지 않는다');
  assert.match(src, /strip\.animate\(\s*\[\{ transform: cellTransform\(plan\.from\) \}, \{ transform: toTransform \}\],\s*\{ duration: ROLL_MS, easing: EASE_CSS\.out \}/);
  assert.match(src, /makeBezierEasing\(EASE\.out/, '카운트업은 막대와 같은 곡선');
  assert.doesNotMatch(src, /textContent\s*=/, 'React 가 가진 글자를 직접 덮지 않는다');
  assert.doesNotMatch(src, /backdrop|filter:/);
  // 굴러가는 중 새 값: 애니메이션을 지우기 전에 지금 보이는 자리를 읽는다
  const readAt = src.indexOf('readStripCell(strip, prevTarget)');
  const cancelAt = src.indexOf('animRef.current?.cancel();');
  assert.ok(readAt > 0 && cancelAt > readAt);
  // 화면 낭독기는 띠 대신 최종 숫자를 읽는다
  assert.match(src, /<span className="sr-only">/);
  assert.match(src, /<span aria-hidden="true">/);
});

test('대시보드 전체 진행률: 원 호 4개 항상 + 가림막, 명언은 구간 기준, 숫자는 RollingNumber', () => {
  const src = read('src/components/widgets/OverallProgressWidget.tsx');
  assert.doesNotMatch(src, /filter\(Boolean\)/, '띠를 값에 따라 넣었다 뺐다 하지 않는다');
  assert.match(src, /RING_ARCS\.map\(\(arc\) => \(\s*<circle\s*key=\{arc\.key\}/);
  assert.match(src, /<mask id=\{ringMaskId\}/);
  assert.match(src, /<g mask=\{`url\(#\$\{ringMaskId\}\)`\}>/);
  // 13번(first-entry)이 첫 진입 그리기 클래스(bf-entry-ring·bf-entry-ring-cap)를 덧붙인다 — 같은 박자 클래스는 그대로
  assert.match(src, /className="bf-progress-arc(?: bf-entry-ring)?"/);
  assert.match(src, /className="bf-progress-cap(?: bf-entry-ring-cap)?"/);
  assert.doesNotMatch(src, /strokeLinecap/, '둥근 끝은 끝점 원이 맡는다(경계에서 순간이동 X)');
  assert.match(src, /const bucket = progressBucket\(pct\);\n\s*const pool = useMemo\(\(\) => getMessagePool\(bucket\), \[bucket\]\);/);
  assert.doesNotMatch(src, /getMessagePool\(pct\)/);
  assert.match(src, /setInterval\(pickNext, 8000\)/, '8초 주기는 그대로');
  assert.doesNotMatch(src, /initial=\{\{ opacity: 0, y: 8 \}\}/, '명언은 framer 개별 y 대신 transform 문자열');
  assert.match(src, /\{\.\.\.\(reduce \? QUOTE_MOTION_REDUCED : QUOTE_MOTION\)\}/);
  assert.match(src, /<RollingNumber\s+value=\{pctRaw\}\s+decimals=\{pctDecimals\}\s+suffix="%"\s+resetKey=\{rollKey\}/);
  assert.match(src, /useDashboardRollKey\(\)/);
});

test('숫자와 짝지은 막대·원은 같은 박자 클래스, 진행률 숫자는 모두 RollingNumber', () => {
  const statCard = read('src/components/widgets/charts/StatCard.tsx');
  assert.match(statCard, /className="bf-progress-bar(?: bf-entry-fill-x)? h-full rounded-full"/);
  assert.match(statCard, /value: ReactNode/);
  const donut = read('src/components/widgets/charts/DonutChart.tsx');
  assert.match(donut, /className="bf-progress-arc(?: bf-entry-ring)?"/);
  assert.doesNotMatch(donut, /transition-all duration-700/);

  const dept = read('src/components/widgets/DepartmentComparisonWidget.tsx');
  assert.equal((dept.match(/<RollingNumber value=\{(combinedPct|pct)\} decimals=\{1\} suffix="%" resetKey=\{rollKey\} \/>/g) ?? []).length, 3);
  assert.equal((dept.match(/bf-progress-bar/g) ?? []).length, 2);

  const epOverall = read('src/components/widgets/episode/EpOverallProgressWidget.tsx');
  assert.match(epOverall, /value=\{pctNumber\}/);
  assert.match(epOverall, /centerValue=\{pctNumber\}/);
  assert.match(epOverall, /const rollKey = useDashboardRollKey\(\);/);
  const epDept = read('src/components/widgets/episode/EpDeptComparisonWidget.tsx');
  assert.equal((epDept.match(/<RollingNumber /g) ?? []).length, 3);
  const epFull = read('src/components/widgets/episode/EpFullDeptProgressWidget.tsx');
  assert.equal((epFull.match(/centerValue=\{pctNumber\}/g) ?? []).length, 2);

  const scenes = read('src/views/ScenesView.tsx');
  assert.match(scenes, /className="scene-top-progress-fill bf-progress-bar"/, '상단 막대는 폭만, 숫자와 같은 박자');
  assert.match(scenes, /<RollingNumber value=\{overallPct\} suffix="%" \/>/);
  assert.match(scenes, /<RollingNumber value=\{pct\} decimals=\{Number\.isInteger\(pct\) \? 0 : 1\} suffix="%" countUp=\{false\} \/>/);
  const unified = read('src/components/scenes/UnifiedSceneCard.tsx');
  assert.match(unified, /<RollingNumber value=\{combinedPct\} suffix="%" countUp=\{false\} \/>/);
  const stack = read('src/components/scenes/AssigneeProgressStack.tsx');
  assert.equal((stack.match(/<RollingNumber value=\{Math\.round\(entry\.pct\)\} suffix="%" countUp=\{false\} \/>/g) ?? []).length, 2);

  const rollKey = read('src/hooks/useDashboardRollKey.ts');
  assert.match(rollKey, /dashboardDeptFilter/);
  assert.match(rollKey, /episodeDashboardEp/);
});
