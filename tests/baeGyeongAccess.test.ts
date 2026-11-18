import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canAccessBaeGyeong, resolveAllowedView } from '../src/features/playground/featureFlag.ts';

// BAE경 (계획 14의 7장, 14b 11-3 1단계): 옮기는 동안 메뉴와 화면은 시험 계정(배한솔)에게만. 실제 권리는 서버가 정한다.
const hansol = { id: 'fcc4b438-2696-4e88-a03f-d6f34e73e08f', name: '배한솔' };
const previewHansol = { id: '1', name: '배한솔' };
const others = [
  { id: 'a2a5b1c0-0000-4000-8000-000000000001', name: '다른 팀원' },
  { id: 'fcc4b438-2696-4e88-a03f-d6f34e73e08f', name: '이름만 다른 사람' },
  { id: 'a2a5b1c0-0000-4000-8000-000000000002', name: '배한솔' },
  { id: 1, name: '배한솔' },
  null,
  undefined,
];

test('the BAE경 menu and screen are the trial account\'s alone while the move is under way', () => {
  assert.equal(canAccessBaeGyeong(hansol, false), true);
  assert.equal(canAccessBaeGyeong(previewHansol, true), true, 'the preview\'s 배한솔 too');
  assert.equal(resolveAllowedView('bae-gyeong', hansol, false), 'bae-gyeong');
  for (const user of others) {
    assert.equal(canAccessBaeGyeong(user as never, false), false, JSON.stringify(user));
    // a saved view, a stale one or an address never lands on the screen
    assert.equal(resolveAllowedView('bae-gyeong', user as never, false), 'dashboard', JSON.stringify(user));
  }
  // the preview id '1' is not the trial account outside the preview
  assert.equal(canAccessBaeGyeong(previewHansol, false), false);
});

test('the menu, the routed view and the header all know the new screen, through the gate', () => {
  const sidebar = readFileSync(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const loaders = readFileSync(new URL('../src/views/viewLoaders.ts', import.meta.url), 'utf8');
  const title = readFileSync(new URL('../src/components/layout/headerTitle.ts', import.meta.url), 'utf8');
  assert.match(sidebar, /item\.id !== 'bae-gyeong' \|\| canAccessBaeGyeong\(currentUser\)/);
  // the menu sits right below '배경', with the 景 icon and the label 'BAE경'
  assert.match(sidebar, /\{ id: 'background-library', label: '배경'[^\n]*\n\s*\{ id: 'bae-gyeong', label: 'BAE경', icon: <BaeGyeongIcon size=\{20\} \/> \}/);
  assert.match(app, /switch \(safeCurrentView\)[\s\S]*?case 'bae-gyeong':\s*\n\s*return <BaeGyeongView \/>;/);
  assert.match(loaders, /'bae-gyeong': loadBaeGyeongView/);
  assert.match(title, /'bae-gyeong': 'BAE경'/);
});

test('the team never gets a model or quality picker: the screen has no select for them (14e 7장 1단계)', () => {
  const view = readFileSync(new URL('../src/features/bae-gyeong/BaeGyeongView.tsx', import.meta.url), 'utf8');
  const bench = readFileSync(new URL('../src/features/bae-gyeong/home/Workbench.tsx', import.meta.url), 'utf8');
  for (const src of [view, bench]) assert.doesNotMatch(src, /<select|imageModel|imageQuality/);
  // and the tab row is the four tabs of 14e (no '만들기')
  const labels = [...view.matchAll(/\{ id: '[a-z]+', label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['작업대', '기록', '비용', '설정']);
});
