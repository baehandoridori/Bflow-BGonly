/**
 * 2026-07-26 캐릭터 현황판 피드백 배치(항목 36·38·39·40) 배선 고정 테스트.
 * 소스-문자열 검사 — 리팩터 시 앵커가 깨지면 함께 갱신할 것.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

test('피드백 39: 담당자 피커 — 팀원 제안 목록 + 키보드 선택', () => {
  const picker = readFileSync('src/components/characters/AssigneeNamePicker.tsx', 'utf8');
  assert.match(picker, /const suggestions = users/);
  assert.match(picker, /aria-label="팀원 목록"/);
  assert.match(picker, /onClick=\{\(\) => addName\(u\.name\)\}/);
  assert.match(picker, /if \(event\.key === 'ArrowDown'\)/);
  assert.match(picker, /addName\(suggestions\[highlightIdx\]\.name\)/);
  // 자유 입력(외부 인력)과 기존 앵커는 유지된다.
  assert.match(picker, /placeholder="이름 입력"/);
  assert.match(picker, /setModalOpen/);
});
