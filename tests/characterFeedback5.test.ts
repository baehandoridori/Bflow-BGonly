/**
 * 2026-09-05 캐릭터 현황판 피드백 55·57 배선 고정 테스트.
 * 소스-문자열 검사 — 리팩터 시 앵커가 깨지면 함께 갱신할 것.
 *   55: 같은 이름 캐릭터 추가 차단 + 기존 카드 열기 + 비슷한 이름 제안 (작업 1)
 *   57-1: 작업 폴더 '만들기' 확인 창 + 새 창 팝업 확인 창 호스트 (작업 2에서 append)
 *   57-2·57-3: 경로 '지우기' + '경로 지정'/'경로 수정' (작업 3에서 append)
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const addModal = readFileSync('src/components/characters/AddCharacterModal.tsx', 'utf8');
const boardView = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
const detailModal = readFileSync('src/components/characters/CharacterDetailModal.tsx', 'utf8');
const costumeDetail = readFileSync('src/components/characters/CostumeDetail.tsx', 'utf8');
const folderService = readFileSync('src/services/characterFolderService.ts', 'utf8');
const widgetPopup = readFileSync('src/views/WidgetPopup.tsx', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

test('피드백 55: 추가 모달 — 같은 이름이면 추가 차단 + 기존 카드 열기 + 보관본 복원 + 비슷한 이름 제안', () => {
  assert.match(addModal, /import \{ findDuplicateCharacters, suggestSimilarCharacters \} from '@\/utils\/characterName'/);
  assert.match(addModal, /onOpenExisting\?: \(character: Character\) => void/);
  assert.match(addModal, /const duplicate = useMemo\(\(\) => findDuplicateCharacters\(characters, name\), \[characters, name\]\)/);
  assert.match(addModal, /const similar = useMemo\(\(\) => suggestSimilarCharacters\(characters, name\), \[characters, name\]\)/);
  // 차단: submit 조기 반환 + 추가 버튼 비활성.
  assert.match(addModal, /if \(saving \|\| blockingDuplicate\) return;/);
  assert.match(addModal, /disabled=\{saving \|\| !!blockingDuplicate\}/);
  // 기존 카드 열기 / 복원해서 열기 / 비슷한 이름 버튼.
  assert.match(addModal, /onClick=\{\(\) => openExisting\(blockingDuplicate\)\}/);
  assert.match(addModal, /기존 카드 열기/);
  assert.match(addModal, /void restoreAndOpen\(archivedDuplicate\);/);
  assert.match(addModal, /복원해서 열기/);
  assert.match(addModal, /비슷한 이름:/);
  assert.match(addModal, /\{similar\.map\(\(c\) => \(/);
  // 복원 실패(여전히 archived)면 창을 닫지 않는다.
  assert.match(addModal, /if \(!latest \|\| latest\.status === 'archived'\) return;/);
  // 옛 경고-후-허용 문구는 사라져야 한다.
  assert.doesNotMatch(addModal, /그래도 추가할 수 있어요/);
  // 기존 흐름 보존: 빈 이름 허용 + 생성 후 onCreated.
  assert.match(addModal, /onCreated\?\.\(created\); onClose\(\);/);
  assert.doesNotMatch(addModal, /disabled=\{!name\.trim\(\) \|\| saving\}/);
});

test('피드백 55: 두 진입점(그리드·상세 모달)이 onOpenExisting 을 배선하고, 보관 목록 중 활성 카드로 이동하면 목록 모드가 돌아온다', () => {
  assert.match(boardView, /onOpenExisting=\{\(c\) => \{ setTab\('board'\); setPendingOpenId\(c\.id\); \}\}/);
  assert.match(detailModal, /onOpenExisting=\{\(c\) => setSelectedId\(c\.id\)\}/);
  // (c-2) 대상이 활성이면 showArchived 를 false 로 되돌려 보관 모드 상세가 엉뚱한 카드를 열지 않게 한다.
  assert.match(boardView, /if \(pendingCharacter\) setShowArchived\(pendingCharacter\.status === 'archived'\);/);
  assert.doesNotMatch(boardView, /if \(pendingCharacter\?\.status === 'archived'\) setShowArchived\(true\);/);
});

test('이 테스트 파일은 test:character 게이트에 등록돼 있다', () => {
  assert.match(packageJson.scripts['test:character'], /\.\/tests\/characterFeedback5\.test\.ts/);
});
