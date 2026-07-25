/**
 * 2026-07-26 캐릭터 현황판 피드백 배치(항목 36·38·39·40) 배선 고정 테스트.
 * 소스-문자열 검사 — 리팩터 시 앵커가 깨지면 함께 갱신할 것.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const boardView = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');

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

test('피드백 38: 현황판 상단 메뉴 고정 — 제목·탭 고정 영역 + sticky 헤더', () => {
  assert.match(boardView, /className="h-full flex flex-col"/);
  assert.match(boardView, /flex-1 min-h-0 overflow-y-auto px-6 pb-6/);
  assert.match(boardView, /sticky top-0 z-20 -mx-6 bg-bg-primary\/85 px-6 pt-4 pb-3 backdrop-blur-md flex flex-col gap-2\.5/);
  assert.doesNotMatch(boardView, /"h-full overflow-y-auto p-6"/);
});
