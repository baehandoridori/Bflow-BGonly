/**
 * 2026-07-26 캐릭터 현황판 피드백 배치(항목 36·38·39·40) 배선 고정 테스트.
 * 소스-문자열 검사 — 리팩터 시 앵커가 깨지면 함께 갱신할 것.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPersistedCharacterViewMode, savePersistedCharacterViewMode } from '../src/utils/characterViewPersist.ts';

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

test('피드백 40: 보기 방식 3종 — 영속화 + 렌더 분기', () => {
  const persist = readFileSync('src/utils/characterViewPersist.ts', 'utf8');
  assert.match(persist, /bflow_character_board_view_mode/);
  // node --test 직접 import 대상 — alias import 금지. (파일 주석의 '@/' 리터럴에 걸리지 않게 import 구문만 잡는다.)
  assert.doesNotMatch(persist, /from '@\//);
  assert.match(boardView, /loadPersistedCharacterViewMode\(\) \?\? 'card'/);
  assert.match(boardView, /savePersistedCharacterViewMode\(mode\)/);
  assert.match(boardView, /aria-label="보기 방식"/);
  assert.match(boardView, /grid-cols-\[repeat\(auto-fill,minmax\(150px,1fr\)\)\]/);
  const row = readFileSync('src/components/characters/CharacterListRow.tsx', 'utf8');
  assert.match(row, /onOpen\(character\.id, shown\?\.id\)/);
  assert.match(row, /onContextMenu\(character\.id, event, shown\?\.id\)/);
  const card = readFileSync('src/components/characters/CharacterCard.tsx', 'utf8');
  assert.match(card, /compact\?: boolean/);
  assert.match(card, /\{!compact && \(/);
});

test('characterViewPersist: node 환경 방어 + 스텁 왕복', () => {
  // node 환경에는 localStorage 가 없다 — load 는 null, save 는 무예외가 계약이다.
  assert.equal(loadPersistedCharacterViewMode(), null);
  assert.doesNotThrow(() => savePersistedCharacterViewMode('list'));
  // localStorage 스텁 주입 후 왕복 + 알 수 없는 값 방어.
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  savePersistedCharacterViewMode('compact');
  assert.equal(loadPersistedCharacterViewMode(), 'compact');
  store.set('bflow_character_board_view_mode', '이상한값');
  assert.equal(loadPersistedCharacterViewMode(), null);
  delete (globalThis as Record<string, unknown>).localStorage;
});
