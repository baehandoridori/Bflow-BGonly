import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync('src/components/NotificationPanel.tsx', 'utf8');

test('notification relative time guards malformed timestamps', () => {
  assert.match(panel, /const time = new Date\(iso\)\.getTime\(\)/);
  assert.match(panel, /if \(!Number\.isFinite\(time\)\) return '방금 전'/);
});
