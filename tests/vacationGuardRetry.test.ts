/**
 * 휴가 등록·취소 직후 '낙관 가드' 재시도 테스트
 *
 * 문제: 휴가 탭·프로필의 '나의 휴가'는 등록·취소 직후 30초 동안 서버에서 읽은 값을 버린다(방금 바꾼
 * 화면이 옛 값으로 되돌아가 보이지 않게). 그런데 버리고 끝이라, 그 30초 안에 슬랙 등에서 온 휴가 변경
 * 신호로 다시 읽은 결과도 사라졌고 5분 캐시가 끝날 때까지 화면이 늦었다.
 *
 * 해결: 가드 때문에 버렸으면 가드가 끝난 직후 한 번 다시 읽도록 예약(예약은 늘 하나, 언마운트 때 정리하고
 * 언마운트 뒤에 끝난 로드는 새 예약을 잡지 않는다).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createVacationGuardRetry,
  isVacationMutationGuardActive,
  vacationGuardRetryDelayMs,
  VACATION_GUARD_RETRY_MARGIN_MS,
  VACATION_MUTATION_GUARD_MS,
  type VacationGuardTimers,
} from '../src/utils/vacationGuardRetry.ts';

/** 손으로 돌리는 가짜 타이머 — 시각은 실제 Date.now() 규모에서 시작한다 */
function fakeTimers() {
  let now = 1_790_000_000_000;
  let seq = 0;
  const pending = new Map<number, { at: number; run: () => void }>();
  const timers: VacationGuardTimers = {
    setTimeout: (run, ms) => {
      const id = ++seq;
      pending.set(id, { at: now + ms, run });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (handle) => { pending.delete(handle as unknown as number); },
  };
  return {
    timers,
    get now() { return now; },
    pendingCount: () => pending.size,
    advance(ms: number) {
      now += ms;
      for (const [id, entry] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (entry.at <= now) {
          pending.delete(id);
          entry.run();
        }
      }
    },
  };
}

test('가드 판정은 기존 규칙 그대로 — 등록·취소 뒤 30초까지 가드, 그 뒤·기록 없음(0)은 적용', () => {
  const t0 = 1_000_000;
  assert.equal(VACATION_MUTATION_GUARD_MS, 30_000);
  assert.equal(isVacationMutationGuardActive(t0, t0), true);
  assert.equal(isVacationMutationGuardActive(t0, t0 + 30_000), true, '기존 `> 30_000` 경계 유지');
  assert.equal(isVacationMutationGuardActive(t0, t0 + 30_001), false);
  assert.equal(isVacationMutationGuardActive(0, t0), false, '등록·취소한 적 없으면 가드 없음');
});

test('다시 읽기 예약 시각은 가드가 끝난 직후', () => {
  const t0 = 1_000_000;
  assert.equal(vacationGuardRetryDelayMs(t0, t0 + 10_000), 20_000 + VACATION_GUARD_RETRY_MARGIN_MS);
  assert.equal(vacationGuardRetryDelayMs(t0, t0 + 30_001), null);
  // 예약 시각에는 가드가 확실히 끝나 있다
  const delay = vacationGuardRetryDelayMs(t0, t0 + 12_345)!;
  assert.equal(isVacationMutationGuardActive(t0, t0 + 12_345 + delay), false);
});

test('가드 중에 버린 결과는 가드가 끝난 직후 한 번 다시 읽는다', () => {
  const clock = fakeTimers();
  const guard = createVacationGuardRetry(clock.timers);
  clock.advance(5_000);
  const mutationAt = clock.now; // 이 창에서 휴가 등록
  let reloads = 0;

  clock.advance(3_000); // 등록 3초 뒤 슬랙 신호로 다시 읽었다
  assert.equal(guard.deferIfGuarded(mutationAt, clock.now, () => { reloads++; }), true, '가드 중이면 버린다');
  assert.equal(clock.pendingCount(), 1);

  clock.advance(26_000);
  assert.equal(reloads, 0, '가드가 끝나기 전에는 다시 읽지 않는다');
  clock.advance(1_500);
  assert.equal(reloads, 1, '가드가 끝난 직후 한 번');
  assert.equal(clock.pendingCount(), 0);
});

test('가드 중 여러 번 버려도 예약은 하나, 새 등록이 가드를 늘리면 늦춰 다시 잡는다', () => {
  const clock = fakeTimers();
  const guard = createVacationGuardRetry(clock.timers);
  let reloads = 0;
  const retry = () => { reloads++; };

  clock.advance(1_000);
  let mutationAt = clock.now;
  clock.advance(1_000); guard.deferIfGuarded(mutationAt, clock.now, retry);
  clock.advance(1_000); guard.deferIfGuarded(mutationAt, clock.now, retry);
  assert.equal(clock.pendingCount(), 1, '예약은 늘 하나');

  clock.advance(10_000); mutationAt = clock.now; // 또 등록 → 가드 연장
  clock.advance(1_000); guard.deferIfGuarded(mutationAt, clock.now, retry);
  clock.advance(25_000);
  assert.equal(reloads, 0, '연장된 가드가 끝나기 전');
  clock.advance(5_000);
  assert.equal(reloads, 1, '연장된 가드 끝에 한 번만');
});

test('가드가 끝난 뒤 결과를 적용하면 남은 예약을 지운다 (불필요한 재조회 없음)', () => {
  const clock = fakeTimers();
  const guard = createVacationGuardRetry(clock.timers);
  let reloads = 0;
  clock.advance(1_000);
  assert.equal(guard.deferIfGuarded(clock.now, clock.now + 1, () => { reloads++; }), true);
  // 등록 성공 → 가드 해제(mutationAt = 0) 후 바로 다시 읽어 적용
  assert.equal(guard.deferIfGuarded(0, clock.now + 2, () => { reloads++; }), false, '가드 없으면 적용');
  assert.equal(clock.pendingCount(), 0);
  clock.advance(60_000);
  assert.equal(reloads, 0);
});

test('언마운트(cancel)하면 예약이 정리된다', () => {
  const clock = fakeTimers();
  const guard = createVacationGuardRetry(clock.timers);
  let reloads = 0;
  clock.advance(1_000);
  guard.deferIfGuarded(clock.now, clock.now, () => { reloads++; });
  guard.cancel();
  assert.equal(clock.pendingCount(), 0);
  clock.advance(60_000);
  assert.equal(reloads, 0);
});

// ── 언마운트 뒤 늦게 끝난 로드 ────────────────────────────────────────
// cancel() 은 이미 잡힌 예약만 지운다. 언마운트한 뒤에 끝난 로드(취소 8초 뒤 재조회, 도는 중이던 변경 신호 재조회)가
// 가드 안이면 새 예약을 잡았고, 그 예약은 아무도 지우지 않아 떨어진 화면에서 한 번 더 서버를 읽었다.

test('dispose 뒤에 들어온 로드는 결과만 버리고 새 예약을 잡지 않는다 (언마운트 → 예약 순서)', () => {
  const clock = fakeTimers();
  const guard = createVacationGuardRetry(clock.timers);
  let reloads = 0;
  clock.advance(1_000);
  const mutationAt = clock.now;
  guard.dispose(); // 언마운트 — 이때는 예약이 없다
  clock.advance(8_500); // 취소 8초 뒤 재조회가 가드 안에서 끝났다
  assert.equal(guard.deferIfGuarded(mutationAt, clock.now, () => { reloads++; }), true, '가드 중 결과는 여전히 버린다');
  assert.equal(clock.pendingCount(), 0, '떨어진 화면에 새 타이머가 남으면 안 된다');
  clock.advance(60_000);
  assert.equal(reloads, 0);
  // 가드가 끝난 뒤 결과는 그대로 적용 판정(공용 휴가 캐시 갱신은 예전처럼)
  assert.equal(guard.deferIfGuarded(mutationAt, clock.now, () => { reloads++; }), false);
  assert.equal(clock.pendingCount(), 0);
});

test('dispose 는 이미 잡힌 예약도 지운다 (예약 → 언마운트 순서)', () => {
  const clock = fakeTimers();
  const guard = createVacationGuardRetry(clock.timers);
  let reloads = 0;
  clock.advance(1_000);
  assert.equal(guard.deferIfGuarded(clock.now, clock.now, () => { reloads++; }), true);
  assert.equal(clock.pendingCount(), 1);
  guard.dispose();
  assert.equal(clock.pendingCount(), 0);
  clock.advance(60_000);
  assert.equal(reloads, 0);
});

test('StrictMode 이중 실행(마운트 → 정리 → 다시 마운트) 뒤에는 다시 예약한다', () => {
  const clock = fakeTimers();
  const guard = createVacationGuardRetry(clock.timers);
  let reloads = 0;
  guard.activate();
  guard.dispose();
  guard.activate();
  clock.advance(1_000);
  const mutationAt = clock.now;
  clock.advance(2_000);
  assert.equal(guard.deferIfGuarded(mutationAt, clock.now, () => { reloads++; }), true);
  assert.equal(clock.pendingCount(), 1, '다시 붙은 화면은 가드 뒤 재조회를 잃으면 안 된다');
  clock.advance(30_000);
  assert.equal(reloads, 1);
});

// ── 두 화면 배선 ──────────────────────────────────────────────────────
for (const [file, loader] of [
  ['src/views/VacationView.tsx', 'loadMyData'],
  ['src/components/settings/ProfileSection.tsx', 'loadVacationData'],
] as const) {
  test(`${file}: 가드로 버리는 두 곳(캐시·서버 결과) 모두 재시도를 예약하고, 언마운트 때 정리한다`, () => {
    const src = readFileSync(file, 'utf8');
    assert.match(src, /import \{ createVacationGuardRetry \} from '@\/utils\/vacationGuardRetry';/);
    assert.match(src, /const \[guardRetry\] = useState\(createVacationGuardRetry\);/);
    assert.match(
      src,
      /useEffect\(\(\) => \{\s*guardRetry\.activate\(\);\s*return \(\) => guardRetry\.dispose\(\);\s*\}, \[guardRetry\]\);/,
      '언마운트 때 예약을 지우고 이후 로드도 예약을 못 잡게(dispose), StrictMode 재마운트 때 다시 붙인다(activate)',
    );
    assert.doesNotMatch(src, /guardRetry\.cancel\(\)/, 'cancel() 만으로는 언마운트 뒤에 끝난 로드가 새 타이머를 잡는다');
    assert.doesNotMatch(src, /Date\.now\(\) - mutationTimeRef\.current > 30_000/, '버리고 끝나는 옛 가드 검사가 남아 있다');

    const ref = `${loader}Ref`;
    const defer = new RegExp(
      `if \\(!guardRetry\\.deferIfGuarded\\(mutationTimeRef\\.current, Date\\.now\\(\\), \\(\\) => \\{ void ${ref}\\.current\\(true\\); \\}\\)\\) \\{`,
      'g',
    );
    assert.equal(src.match(defer)?.length, 2, '캐시 적용·서버 결과 적용 두 곳');
    assert.match(src, new RegExp(`useEffect\\(\\(\\) => \\{ ${ref}\\.current = ${loader}; \\}, \\[${loader}\\]\\);`),
      '예약된 재시도는 최신 로더(현재 사용자)를 부른다');
  });
}
