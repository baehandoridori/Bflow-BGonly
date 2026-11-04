import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

/**
 * 모든 tests/*.test.ts 가 npm 스크립트 어딘가에 들어 있는가(씬 댓글 B안 §8, 2026-11-04).
 * 스크립트에 없는 테스트는 빌드에서 돌지 않아, 깨져도 아무도 모른다(점검 때 49개가 그랬다).
 * 일부러 빼 둔 테스트는 아래 목록에 이유와 함께만 둔다.
 */
const EXCLUDED: Record<string, string> = {
  // 장면 별칭(a001·ac001) 구분 순서를 기대하는 3건이 지금 동작과 다르다 — 댓글 개편과 무관한 씬 병합 규칙이라
  // 기대값이 낡았는지 동작이 회귀했는지 따로 확인한 뒤 등록한다(PR 보고의 질문).
  'mergedSceneHelpers.test.ts': '씬 별칭 구분 순서 기대값 확인 필요',
};

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
const scripts = Object.values(pkg.scripts).join('\n');

function isRegistered(file: string): boolean {
  if (scripts.includes(`tests/${file}`)) return true;
  // 묶음 패턴(예: tests/background*.test.ts)
  for (const match of scripts.matchAll(/tests\/([A-Za-z0-9_-]+)\*\.test\.ts/g)) {
    if (file.startsWith(match[1]) && file.endsWith('.test.ts')) return true;
  }
  return false;
}

test('tests/ 바로 아래 테스트는 모두 npm 스크립트에 등록돼 있다(일부러 뺀 것만 예외)', () => {
  const files = readdirSync('tests').filter((name) => name.endsWith('.test.ts'));
  const missing = files.filter((name) => !EXCLUDED[name] && !isRegistered(name));
  assert.deepEqual(missing, [], `스크립트에 없는 테스트: ${missing.join(', ')}`);
});

test('tests/motion 은 묶음 패턴으로 돈다', () => {
  assert.match(scripts, /tests\/motion\/\*\.test\.ts/);
});

test('예외 목록은 실제로 있는 파일이고 스크립트에는 없다(고치면 목록에서 빼고 등록)', () => {
  for (const [name, reason] of Object.entries(EXCLUDED)) {
    assert.ok(existsSync(`tests/${name}`), `${name} 이 없다 — 예외 목록에서 뺀다`);
    assert.ok(reason.length > 0);
    assert.equal(isRegistered(name), false, `${name} 이 이미 등록됐다 — 예외 목록에서 뺀다`);
  }
});
