// tests/guideFolderSuggestWiring.test.ts — 가이드 작업 폴더 제안의 배선 앵커. 소스를 글자로 읽는다(설계 4.7·4.8·4.9·5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 작업 트리의 기존 소스는 CRLF일 수 있다 — 읽은 뒤 LF로 맞춘다.
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const squash = (text: string): string => text.replace(/\s+/g, '');
const count = (text: string, needle: string): number => text.split(needle).length - 1;
function inOrder(source: string, parts: string[]): void {
  let at = 0;
  for (const part of parts) {
    const found = source.indexOf(part, at);
    assert.notEqual(found, -1, `순서대로 없다: ${part}`);
    at = found + part.length;
  }
}
void squash; void count; void inOrder;

test('설정: 스위치 문구와 저장 키', () => {
  const section = read('src/components/settings/SceneLinkSection.tsx');
  assert.ok(section.includes('가이드 그림을 넣을 때 작업 폴더 제안'));
  assert.ok(section.includes('role="switch"') && section.includes('aria-checked'));
  assert.ok(section.includes('guideFolderSuggestEnabled'));
  const settings = read('src/services/settingsService.ts');
  assert.ok(settings.includes('guideFolderSuggestEnabled?: boolean'));
  assert.ok(settings.includes('export async function isGuideFolderSuggestEnabled(): Promise<boolean>'));
  assert.ok(read('src/views/SettingsView.tsx').includes('<SceneLinkSection />'));
});
