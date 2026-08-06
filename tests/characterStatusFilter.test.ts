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

test('characterHasAssignee: 쉼표 다중 이름 + 트랙 담당자만 인정', () => {
  assert.equal(characterHasAssignee([costume({ riggingAssignee: '류성철' })], '류성철'), true);
  assert.equal(characterHasAssignee([costume({ designAssignee: '류성철, 류이레' })], '류이레'), true);
  assert.equal(characterHasAssignee([costume()], '류성철'), false);
  // 코덱스 1차 P2: 트랙 담당자를 비운 복장은 레거시 assignee 가 남아 있어도 배정으로 보지 않는다
  //   (구버전 스키마 row 는 rowToCostume 이 이미 트랙 필드로 승계한다).
  assert.equal(characterHasAssignee([costume({ assignee: '류성철' } as Record<string, unknown>)], '류성철'), false);
});

test('matchesCharacterStatusFilter: 작업자 관문 → 상태 판정', () => {
  const list = [costume({ riggingStage: 'rigging', riggingAssignee: '윤성원' })];
  assert.equal(matchesCharacterStatusFilter(list, 'all', null), true);
  assert.equal(matchesCharacterStatusFilter(list, 'in-progress', '윤성원'), true);
  assert.equal(matchesCharacterStatusFilter(list, 'done', '윤성원'), false);
  assert.equal(matchesCharacterStatusFilter(list, 'all', '박정인'), false); // 미배정이면 전체에서도 제외
});

test('collectCharacterAssignees: 트랙 담당자 유니온 + 한국어 정렬 + 중복 제거', () => {
  const names = collectCharacterAssignees([
    costume({ designAssignee: '류성철, 강선영' }),
    costume({ riggingAssignee: '윤성원' }),
    costume({ designAssignee: '강선영' }),
  ]);
  assert.deepEqual(names, ['강선영', '류성철', '윤성원']);
  // 코덱스 1차 P2: 레거시 assignee 만 남은 복장은 옵션에 넣지 않는다 — 고르면 0건이 되는 이름 방지.
  assert.deepEqual(collectCharacterAssignees([costume({ assignee: '박정인' } as Record<string, unknown>)]), []);
});

test('피드백 48 배선: 보드 필터 상태·UI·적용 경로·드래그 게이트', () => {
  const board = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
  assert.match(board, /const \[assigneeFilter, setAssigneeFilter\] = useState<string \| null>\(null\)/);
  assert.match(board, /const \[statusFilter, setStatusFilter\] = useState<CharacterStatusFilterValue>\('all'\)/);
  assert.match(board, /matchesCharacterStatusFilter\(byCharacter\.get\(c\.id\) \?\? \[\], statusFilter, assigneeFilter\)/);
  assert.match(board, /triggerLabel=\{assigneeFilter \?\? '작업자: 전체'\}/);
  assert.match(board, /&& !assigneeFilter && statusFilter === 'all'/);
  assert.match(board, /setAssigneeFilter\(null\); setStatusFilter\('all'\);/);
  // 코덱스 1차 P2: 커스텀 탭 그룹 뷰도 같은 드래그 게이트를 쓴다(필터 중 그룹 배치·순서 변경 금지).
  assert.match(board, /dragEnabled=\{cardDragEnabled\}/);
  const tabGroups = readFileSync('src/components/characters/CharacterTabGroupsView.tsx', 'utf8');
  assert.match(tabGroups, /const dragEnabled = viewMode !== 'list' && allowDrag/);
});
