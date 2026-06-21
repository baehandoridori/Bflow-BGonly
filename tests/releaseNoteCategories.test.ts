import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// UpdateCenterModal 의 RELEASE_NOTE_CATEGORY_META 키와 동기화. 여기에 없는 category 는
//   업데이트 안내창에서 'change'(기능 수정) 로 잘못 폴백돼 '버그 수정' 등이 엉뚱한 배지로 보인다.
const VALID = new Set(['feature', 'change', 'bugfix', 'ux', 'stability', 'docs']);

test('update-notes.json 의 모든 category 는 유효 집합에 든다(미등록 → change 오폴백 방지)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const notes = JSON.parse(readFileSync(join(here, '../DEVLOG/update-notes.json'), 'utf8'));
  const bad: string[] = [];
  for (const rel of notes) {
    for (const item of rel.items ?? []) {
      if (!VALID.has(item.category)) bad.push(`${rel.version}: "${item.category}"`);
    }
  }
  assert.deepEqual(bad, [], `유효하지 않은 category 발견: ${bad.join(', ')}`);
});
