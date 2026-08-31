import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * 알림 패널은 앱 헤더 안에 absolute 로 붙는다. 헤더가 `relative z-N` 으로 자체 쌓임 맥락을
 * 만들기 때문에, 패널이 z-[9999] 여도 실제 순위는 **헤더의 z** 로 결정된다.
 * 그래서 본문의 sticky 헤더가 앱 헤더와 같거나 높은 z 를 쓰면, DOM 상 뒤에 그려지는 본문이
 * 알림 패널을 덮어 버린다(v1.110.0 에서 실제로 발생).
 *
 * 이 테스트는 그 순서를 소스에 고정한다.
 */

const root = process.cwd();
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');

/** `<header className="... z-40 ...">` 에서 40을 뽑는다. */
function appHeaderZ(): number {
  const source = read('src/components/layout/Header.tsx');
  const match = source.match(/<header\s+className="([^"]*)"/);
  assert.ok(match, '앱 헤더 엘리먼트를 찾지 못했습니다');
  const z = match[1].match(/(?:^|\s)z-(\d+)(?:\s|$)/);
  assert.ok(z, `앱 헤더에 z-index 클래스가 없습니다: ${match[1]}`);
  return Number(z[1]);
}

/** 본문 안에서 화면 위에 고정되는 sticky 헤더들의 z 를 모은다. */
function contentStickyZ(relative: string): number[] {
  return [...read(relative).matchAll(/className="([^"]*\bsticky\b[^"]*)"/g)]
    .flatMap((match) => {
      const z = match[1].match(/(?:^|\s)z-(\d+)(?:\s|$)/);
      return z ? [Number(z[1])] : [];
    });
}

const CONTENT_WITH_STICKY_HEADERS = [
  'src/components/calendar/WeekTimeGridView.tsx',
  'src/views/ScenesView.tsx',
];

test('앱 헤더는 본문의 sticky 헤더보다 위에 있다', () => {
  const header = appHeaderZ();

  for (const relative of CONTENT_WITH_STICKY_HEADERS) {
    const stickies = contentStickyZ(relative);
    assert.ok(stickies.length > 0, `${relative} 에서 sticky 헤더를 찾지 못했습니다`);
    for (const z of stickies) {
      assert.ok(
        z < header,
        `${relative} 의 sticky z-${z} 가 앱 헤더 z-${header} 이상입니다 — 알림 패널이 가려집니다`,
      );
    }
  }
});

test('앱 헤더는 모달 백드롭보다는 아래에 있다', () => {
  // 모달이 헤더를 덮어야 정상이다. 헤더를 더 올리면 백드롭이 헤더를 못 가린다.
  // 백드롭은 z-40 이지만 DOM 상 뒤에 그려져 같은 값이면 백드롭이 이긴다.
  const header = appHeaderZ();
  const backdrop = read('src/components/calendar/EventCreateModal.tsx')
    .match(/className="([^"]*fixed inset-0[^"]*)"/);
  assert.ok(backdrop, '일정 만들기 모달의 백드롭을 찾지 못했습니다');
  const z = backdrop[1].match(/(?:^|\s)z-(\d+)(?:\s|$)/);
  assert.ok(z, `백드롭에 z-index 클래스가 없습니다: ${backdrop[1]}`);

  assert.ok(
    header <= Number(z[1]),
    `앱 헤더 z-${header} 가 모달 백드롭 z-${z[1]} 보다 높습니다 — 모달이 헤더를 못 덮습니다`,
  );
});
