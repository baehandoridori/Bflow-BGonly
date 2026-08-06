/** 피드백 48 — 캐릭터 작업자/상태 필터: 순수 유틸 동작 + 보드 배선 앵커. */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  characterWorkStatus,
  characterHasAssignee,
  matchesCharacterStatusFilter,
  collectCharacterAssignees,
} from '../src/utils/characterStatusFilter.ts';

const costume = (over: Record<string, unknown> = {}) => ({
  designStage: 'waiting',
  riggingStage: 'waiting',
  designAssignee: null as string | null,
  riggingAssignee: null as string | null,
  assignee: null as string | null,
  ...over,
});

test('characterWorkStatus: 전체 트랙 집계 — 완료/미착수/진행중', () => {
  assert.equal(characterWorkStatus([]), 'not-started'); // 복장 0개
  assert.equal(characterWorkStatus([costume()]), 'not-started');
  assert.equal(characterWorkStatus([costume({ designStage: 'done', riggingStage: 'done' })]), 'done');
  assert.equal(characterWorkStatus([costume({ designStage: 'done' })]), 'in-progress'); // 디자인만 끝남 → 진행중
  assert.equal(characterWorkStatus([costume({ riggingStage: 'rigging' })]), 'in-progress');
  assert.equal(
    characterWorkStatus([costume({ designStage: 'done', riggingStage: 'done' }), costume()]),
    'in-progress', // 한 벌 완료 + 한 벌 대기
  );
});

test('characterWorkStatus: 작업자 지정 시 그 사람 배정 트랙만 집계', () => {
  const list = [
    costume({ designStage: 'done', designAssignee: '강선영', riggingStage: 'rigging', riggingAssignee: '윤성원' }),
  ];
  assert.equal(characterWorkStatus(list, '강선영'), 'done');
  assert.equal(characterWorkStatus(list, '윤성원'), 'in-progress');
  assert.equal(characterWorkStatus(list, '박정인'), 'not-started');
});

test('characterHasAssignee: 쉼표 다중 이름 + 레거시 assignee 양 트랙 겸용', () => {
  assert.equal(characterHasAssignee([costume({ assignee: '류성철' })], '류성철'), true);
  assert.equal(characterHasAssignee([costume({ designAssignee: '류성철, 류이레' })], '류이레'), true);
  assert.equal(characterHasAssignee([costume()], '류성철'), false);
});

test('matchesCharacterStatusFilter: 작업자 관문 → 상태 판정', () => {
  const list = [costume({ riggingStage: 'rigging', riggingAssignee: '윤성원' })];
  assert.equal(matchesCharacterStatusFilter(list, 'all', null), true);
  assert.equal(matchesCharacterStatusFilter(list, 'in-progress', '윤성원'), true);
  assert.equal(matchesCharacterStatusFilter(list, 'done', '윤성원'), false);
  assert.equal(matchesCharacterStatusFilter(list, 'all', '박정인'), false); // 미배정이면 전체에서도 제외
});

test('collectCharacterAssignees: 3필드 유니온 + 한국어 정렬 + 중복 제거', () => {
  const names = collectCharacterAssignees([
    costume({ designAssignee: '류성철, 강선영' }),
    costume({ riggingAssignee: '윤성원' }),
    costume({ assignee: '강선영' }),
  ]);
  assert.deepEqual(names, ['강선영', '류성철', '윤성원']);
});

test('피드백 48 배선: 보드 필터 상태·UI·적용 경로·드래그 게이트', () => {
  const board = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
  assert.match(board, /const \[assigneeFilter, setAssigneeFilter\] = useState<string \| null>\(null\)/);
  assert.match(board, /const \[statusFilter, setStatusFilter\] = useState<CharacterStatusFilterValue>\('all'\)/);
  assert.match(board, /matchesCharacterStatusFilter\(byCharacter\.get\(c\.id\) \?\? \[\], statusFilter, assigneeFilter\)/);
  assert.match(board, /triggerLabel=\{assigneeFilter \?\? '작업자: 전체'\}/);
  assert.match(board, /&& !assigneeFilter && statusFilter === 'all'/);
  assert.match(board, /setAssigneeFilter\(null\); setStatusFilter\('all'\);/);
});
