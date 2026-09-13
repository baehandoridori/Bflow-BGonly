/**
 * 피드백 59: 사이드바 '캐릭터' 항목의 새 창 열기 버튼 배선 앵커.
 * 게이트 등록 확인은 다른 파일이 맡아야 죽은 가드가 되지 않는다 — 이 파일은 58 테스트 4개의 test:entity 등록을 감시하고,
 *   이 파일 자신의 test:ui 등록은 tests/threadTodoWiring.test.ts 끝의 가드가 감시한다(서로 교차).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const boardView = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
const mock = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

const navStart = sidebar.indexOf('{navItems.map((item) => {');
const navEnd = sidebar.indexOf('{/* 하단: 토글 + 버전');
const block = sidebar.slice(navStart, navEnd);

test('nav 블록: 캐릭터 항목에만, 펼침 상태에서만, widgetOpenPopup 이 있을 때만 버튼을 렌더', () => {
  assert.ok(navStart > -1 && navEnd > navStart);
  assert.match(block, /const showBoardPopout = item\.id === 'character-board' && isVisuallyExpanded\s*&& typeof window\.electronAPI\?\.widgetOpenPopup === 'function';/);
  assert.match(block, /widgetOpenPopup\?\.\('character-board', '캐릭터 현황판'\)/);
  assert.match(block, /aria-label="캐릭터 현황판을 새 창으로 열기"/);
  assert.match(block, /title="캐릭터 현황판을 새 창으로 열어요"/);
  assert.match(sidebar, /import \{[^}]*ExternalLink[^}]*\} from 'lucide-react'/);
});

test('nav 블록: 버튼 중첩 없음 — 래퍼는 실제 박스(relative), nav 버튼은 w-full, 팝아웃은 형제 absolute', () => {
  assert.doesNotMatch(block, /<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
  assert.doesNotMatch(block, /className="contents"/);
  assert.match(block, /<div key=\{item\.id\} className="group\/nav relative shrink-0 mx-2">\s*\{navButton\}/);
  assert.match(block, /'flex items-center cursor-pointer w-full h-10 rounded-lg',/);
  assert.doesNotMatch(block, /'flex items-center cursor-pointer shrink-0 h-10 mx-2 rounded-lg',/);
  // 팝아웃 버튼 위에 마우스가 있어도 nav 행 하이라이트(글자·배경)가 꺼지지 않게 래퍼 hover 에도 반응
  assert.match(block, /hover:bg-bg-border\/50 group-hover\/nav:text-text-primary group-hover\/nav:bg-bg-border\/50'/);
  // 접힌 사이드바가 펼쳐지는 350ms 동안 버튼이 아이콘 위를 지나가는 것을 가린다
  assert.match(block, /transition-opacity duration-200 delay-300 group-hover\/nav:opacity-100/);
  assert.match(block, /absolute right-1\.5 top-1\/2 -translate-y-1\/2[^"]*group-hover\/nav:opacity-100/);
  // 행에 마우스가 없을 땐 투명 — 라벨 오른쪽을 가리지 않는다
  assert.match(block, /aria-label="캐릭터 현황판을 새 창으로 열기"\s*className="[^"]*\bopacity-0 transition-opacity/);
});

test('팝아웃 클릭은 현재 화면을 바꾸지 않는다 (setView 미호출) + 기존 nav 클릭 분기 유지', () => {
  const popoutStart = block.indexOf('{showBoardPopout && (');
  assert.ok(popoutStart > -1, '팝아웃 버튼은 showBoardPopout 이 참일 때만 렌더해야 한다');
  const popout = block.slice(popoutStart);
  assert.doesNotMatch(popout, /setView\(/);
  assert.match(block, /\} else \{\s*setView\(item\.id\);\s*\}/);
});

test('기존 앵커 보존: 사이드바 상수·현황판 헤더의 새 창 버튼', () => {
  assert.match(sidebar, /const SIDEBAR_LABEL_MAX_WIDTH = 120/);
  assert.doesNotMatch(sidebar, /maxWidth: isVisuallyExpanded \? 104 : 0/);
  assert.match(boardView, /widgetOpenPopup\?\.\('character-board', '캐릭터 현황판'\)/);
  assert.match(boardView, /새 창으로/);
});

test('미리보기 mock 에 widgetOpenPopup 스텁이 있어 사이드바 버튼을 눈으로 확인할 수 있다', () => {
  assert.match(mock, /widgetOpenPopup: async \(widgetId, title\) => \{/);
});

test('게이트 등록: 58 테스트 4개가 test:entity 에 나열돼 있다', () => {
  const entity = pkg.scripts['test:entity'];
  for (const f of ['threadTodo.test.ts', 'threadTodoPersistence.test.ts', 'threadTodoWiring.test.ts', 'threadTodoMockWiring.test.ts', 'commentListAnchor.test.ts']) {
    assert.ok(entity.includes(`./tests/${f}`), `${f} 가 test:entity 에 등록돼야 한다`);
  }
  // 교차 가드의 최후 방어: 두 스위트가 빌드 게이트에서 함께 빠지면 서로의 감시도 사라진다.
  for (const script of ['build', 'build:vite']) {
    assert.ok(pkg.scripts[script].includes('npm run test:entity') && pkg.scripts[script].includes('npm run test:ui'), `${script} 가 test:entity·test:ui 를 실행해야 한다`);
  }
});
