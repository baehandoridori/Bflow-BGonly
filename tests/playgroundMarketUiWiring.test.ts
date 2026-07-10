import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('market home preserves the approved information order', () => {
  const source = readFileSync('src/views/playground/market/MarketHome.tsx', 'utf8');
  const labels = ['오늘의 JBBJ 시장', '찜한 주식', '오늘 가격에 영향을 준 소식', '모든 주식', '초보 미션'];
  const positions = labels.map((label) => source.indexOf(label));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('lobby includes random recommendation, market, three games and JBBJ house', () => {
  const source = readFileSync('src/views/playground/PlaygroundLobby.tsx', 'utf8');
  for (const label of ['오늘의 추천', 'JBBJ 증권', '테트리스', '스도쿠', '스네이크', 'JBBJ 하우스']) {
    assert.match(source, new RegExp(label));
  }
});

test('market shell has a stable loading and retry boundary', () => {
  const source = readFileSync('src/views/playground/market/MarketDataBoundary.tsx', 'utf8');
  assert.match(source, /시장 정보를 불러오는 중/);
  assert.match(source, /시장 정보를 불러오지 못했어요/);
  assert.match(source, /다시 불러오기/);
  assert.match(source, /aria-live="polite"/);
});

test('market search follows the keyboard combobox contract', () => {
  const source = readFileSync('src/views/playground/market/MarketNav.tsx', 'utf8');
  for (const contract of ['role="combobox"', 'aria-activedescendant', 'role="listbox"', 'role="option"', 'ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'aria-live="polite"']) {
    assert.match(source, new RegExp(contract));
  }
});

test('reason selection navigates immediately while persistence settles in the background', () => {
  const source = readFileSync('src/views/playground/market/MarketHome.tsx', 'utf8');
  const start = source.indexOf('const openStockAfterReadingReason');
  const end = source.indexOf('\n  };', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);

  assert.doesNotMatch(handler, /\basync\b|\bawait\b/);
  assert.match(handler, /\.catch\(\(\) => undefined\)/);
  assert.ok(handler.indexOf('execute({') < handler.indexOf('onOpenStock(stockId)'));
});

test('destination returns are immediate while lobby cards retain origin wipes', () => {
  const playground = readFileSync('src/views/PlaygroundView.tsx', 'utf8');
  const lobby = readFileSync('src/views/playground/PlaygroundLobby.tsx', 'utf8');
  const house = readFileSync('src/views/playground/JbbjHouse.tsx', 'utf8');
  const comingSoon = readFileSync('src/views/playground/ComingSoonGame.tsx', 'utf8');
  const marketNav = readFileSync('src/views/playground/market/MarketNav.tsx', 'utf8');

  assert.match(playground, /<JbbjHouse onBack=\{\(\) => move\(\{ kind: 'go-lobby' \}\)\} \/>/);
  assert.match(playground, /onBack=\{\(\) => move\(\{ kind: 'go-lobby' \}\)\}/);
  assert.match(playground, /onExit=\{\(\) => move\(\{ kind: 'go-lobby' \}\)\}/);
  assert.match(house, /onClick=\{onBack\}/);
  assert.match(comingSoon, /onClick=\{onBack\}/);
  assert.match(marketNav, /onClick=\{onExit\}/);
  for (const source of [house, comingSoon, marketNav]) {
    assert.doesNotMatch(source, /originFromActivation/);
  }
  assert.match(lobby, /originFromActivation/);
  assert.match(lobby, /onMove\(actionFor\(item\), activationOrigin\(event\)\)/);
});

test('completed mission disclosure summary has a 44px padded target', () => {
  const source = readFileSync('src/views/playground/market/MarketHome.tsx', 'utf8');
  const className = source.match(/<summary className="([^"]+)"/)?.[1] ?? '';

  assert.match(className, /\bmin-h-11\b/);
  assert.match(className, /\bpx-\d+\b/);
  assert.match(className, /\bpy-\d+\b/);
});
