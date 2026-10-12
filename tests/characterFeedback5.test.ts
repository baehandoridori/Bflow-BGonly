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
const confirmDialog = readFileSync('src/components/common/ConfirmDialog.tsx', 'utf8');
const pathLinkCard = readFileSync('src/components/common/PathLinkCard.tsx', 'utf8');

/** 두 경로 칸이 각자 맞는 해제 핸들러를 받는지 — 칸 경계(<PathLinkCard)를 넘지 않는 범위에서만 찾는다. */
function withinRow(pathProp: string, clearProp: string): RegExp {
  return new RegExp(`path=\\{${pathProp}\\}(?:(?!<PathLinkCard)[\\s\\S])*?onUnlink=\\{${clearProp}\\}`);
}

test('피드백 55: 추가 모달 — 같은 이름이면 추가 차단 + 기존 카드 열기 + 보관본 복원 + 비슷한 이름 제안', () => {
  assert.match(addModal, /import \{ findDuplicateCharacters, suggestSimilarCharacters \} from '@\/utils\/characterName'/);
  assert.match(addModal, /onOpenExisting\?: \(character: Character\) => void/);
  assert.match(addModal, /const duplicate = useMemo\(\(\) => findDuplicateCharacters\(characters, name\), \[characters, name\]\)/);
  assert.match(addModal, /const similar = useMemo\(\(\) => suggestSimilarCharacters\(characters, name\), \[characters, name\]\)/);
  // 차단 대상이 뒤바뀌면(활성↔보관) 55 의 핵심이 정반대로 동작한다 — 정의 자체를 고정한다.
  assert.match(addModal, /const blockingDuplicate = duplicate\.active;/);
  assert.match(addModal, /const archivedDuplicate = duplicate\.archived;/);
  // 차단: submit 조기 반환 + 추가 버튼 비활성.
  assert.match(addModal, /if \(saving \|\| blockingDuplicate\) return;/);
  assert.match(addModal, /disabled=\{saving \|\| !!blockingDuplicate\}/);
  // 기존 카드 열기 / 복원해서 열기 / 비슷한 이름 버튼.
  assert.match(addModal, /onClick=\{\(\) => openExisting\(blockingDuplicate\)\}/);
  assert.match(addModal, /기존 카드 열기/);
  assert.match(addModal, /void restoreAndOpen\(archivedDuplicate\);/);
  assert.match(addModal, /복원해서 열기/);
  assert.match(addModal, /비슷한 이름:/);
  // 제안 칩은 눌렀을 때 실제로 그 카드를 열어야 한다(무동작 칩 방지).
  assert.match(addModal, /\{similar\.map\(\(c\) => \([\s\S]{0,300}?onClick=\{\(\) => openExisting\(c\)\}/);
  // 기존 카드로 이동하면 추가 창은 닫힌다.
  assert.match(addModal, /const openExisting = \(character: Character\) => \{\s*onOpenExisting\?\.\(character\);\s*onClose\(\);\s*\};/);
  // 복원 실패(여전히 archived)면 창을 닫지 않는다.
  assert.match(addModal, /if \(!latest \|\| latest\.status === 'archived'\) return;/);
  // 복원을 기다리는 사이 사용자가 창을 닫았으면 화면을 옮기지 않는다.
  assert.match(addModal, /if \(!openRef\.current\) return;/);
  // 차단 사유는 화면을 못 보는 사용자에게도 읽혀야 한다.
  assert.match(addModal, /<div role="alert"/);
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

/* 게이트 등록 확인은 이 파일에 두면 안 된다 — 스크립트에서 빠지면 실행 자체가 안 돼 조용히 통과한다.
   이미 등록돼 있는 tests/characterName.test.ts 가 대신 감시한다. */

test('피드백 57-1: 폴더 만들기 전 확인 창 — 환경 확인 뒤·실제 생성 전', () => {
  assert.match(folderService, /import \{ ConfirmDialog \} from '@\/components\/common\/ConfirmDialog'/);
  assert.match(folderService, /import \{ buildCharacterFolderConfirmMessage \} from '@\/utils\/characterName'/);
  assert.match(folderService, /const confirmed = await ConfirmDialog\.show\(\{\s*message: buildCharacterFolderConfirmMessage\(root, character\.name\),\s*confirmLabel: '폴더 만들기',\s*\}\);/);
  assert.match(folderService, /if \(!confirmed\) return false;/);
  const envCheck = folderService.indexOf("if (!window.electronAPI?.pathCreateFolder) {");
  const confirmAt = folderService.indexOf('const confirmed = await ConfirmDialog.show(');
  const createAt = folderService.indexOf('window.electronAPI.pathCreateFolder(root, character.name)');
  assert.ok(envCheck > -1 && confirmAt > envCheck && createAt > confirmAt, '확인 창은 환경 확인 뒤, 실제 폴더 생성 전에 떠야 한다');
});

test('피드백 57-1: 새 창 팝업에도 확인 창 호스트 — 브라우저 기본 confirm 폴백 방지', () => {
  assert.match(widgetPopup, /import \{ ConfirmDialogHost \} from '@\/components\/common\/ConfirmDialog'/);
  assert.match(widgetPopup, /<ConfirmDialogHost \/>/);
  // 호스트는 팝업 루트에 1개만.
  assert.equal((widgetPopup.match(/<ConfirmDialogHost \/>/g) ?? []).length, 1);
});

test('확인 창 호스트: 이미 떠 있으면 덮어쓰지 않고, 호스트가 사라지면 대기 중인 요청을 닫는다', () => {
  // 덮어쓰면 앞 요청이 영영 응답을 못 받고, 사용자가 읽던 문구가 바뀐 채 확인을 누르게 된다.
  assert.match(confirmDialog, /if \(pendingRef\.current\) \{[\s\S]{0,200}?resolve\(false\);\s*return;\s*\}/);
  assert.match(confirmDialog, /pendingRef\.current = next;/);
  // 언마운트 시 대기 중인 확인 창은 취소로 닫는다.
  assert.match(confirmDialog, /externalShow = null;\s*(?:\/\/[^\n]*\n\s*)*pendingRef\.current\?\.resolve\(false\);/);
});

test('피드백 57-2·57-3: 경로 칸 — 해제 버튼 + 상태별 버튼 이름', () => {
  // v1.134.2: 경로 칸은 씬 상세와 함께 쓰는 공용 카드(PathLinkCard) — 해제는 연결돼 있고 핸들러가 있을 때만.
  assert.match(pathLinkCard, /onUnlink\?: \(\) => void;/);
  assert.match(pathLinkCard, /\{onUnlink && \(/);
  assert.match(pathLinkCard, /onClick=\{onUnlink\}/);
  assert.match(pathLinkCard, /title="연결 해제 — 실제 폴더·파일은 그대로예요"/);
  // 57-3: 이름만 보고 무엇을 하는 버튼인지 — 비어 있으면 '연결', 연결돼 있으면 '수정'(아이콘 + 설명). (\s 는 CRLF 도 먹는다.)
  assert.match(pathLinkCard, /<Link2 size=\{13\} aria-hidden \/>\}\s+연결\s+<\/button>/);
  assert.match(pathLinkCard, /aria-label=\{`\$\{label\} 수정`\}\s+title=\{lockedReason \?\? '수정 — 다른 경로로 바꿔요'\}/);
  assert.doesNotMatch(pathLinkCard, />\s*선택\s*<\/button>/);
  // 기존 앵커 보존: 만들기 버튼 설명, 열기 버튼 title=경로.
  assert.match(costumeDetail, /createTitle="기준 경로에 캐릭터 이름으로 폴더를 만들어 연결"/);
  assert.match(pathLinkCard, /onClick=\{onCreate\} disabled=\{busy\} title=\{createTitle\}/);
  assert.match(pathLinkCard, /onClick=\{onOpen\}\s+disabled=\{opening\}\s+aria-label=\{`\$\{label\} 열기`\}\s+title=\{path \?\? undefined\}/);
  // CostumeDetail props → 두 행에 배선. 행을 넘겨 교차 배선되면(폴더 지우기가 파일 연결을 지움) 실패해야 한다.
  assert.match(costumeDetail, /onClearFolder: \(\) => void;/);
  assert.match(costumeDetail, /onClearFile: \(\) => void;/);
  assert.match(costumeDetail, withinRow('character\\.workFolderPath', 'onClearFolder'));
  assert.match(costumeDetail, withinRow('costume\\.workFilePath', 'onClearFile'));
  assert.doesNotMatch(costumeDetail, withinRow('character\\.workFolderPath', 'onClearFile'));
  assert.doesNotMatch(costumeDetail, withinRow('costume\\.workFilePath', 'onClearFolder'));
  // 구조분해에서 별칭으로 바꿔치기하는 경로도 막는다.
  assert.match(costumeDetail, /^\s*onClearFolder,\s*$/m);
  assert.match(costumeDetail, /^\s*onClearFile,\s*$/m);
  // 버튼이 있어도 경로 이름이 읽혀야 한다 — 이름은 제 줄을 따로 쓰고(넘치면 말줄임), 버튼 줄은 그 아래에 둔다.
  assert.match(pathLinkCard, /<div className="truncate text-\[13px\] font-medium text-text-primary" title=\{name\}>\{name\}<\/div>/);
  assert.match(pathLinkCard, /<div className="mt-2\.5 flex items-center gap-1\.5">\s+<button\s+type="button"\s+onClick=\{onOpen\}/);
});

test('피드백 57-2: 상세 모달 — 확인 창 뒤 경로만 null 로 저장', () => {
  assert.match(detailModal, /const handleClearFolder = useCallback\(async \(\) => \{/);
  assert.match(detailModal, /updateCharacterFolder\(character\.id, null\)/);
  assert.match(detailModal, /const handleClearFile = useCallback\(async \(targetCostume: CharacterCostume\) => \{/);
  assert.match(detailModal, /updateCostumeField\(targetCostume\.id, \{ workFilePath: null \}\)/);
  assert.equal((detailModal.match(/confirmLabel: '연결 해제'/g) ?? []).length, 2);
  assert.match(detailModal, /onClearFolder=\{handleClearFolder\}/);
  assert.match(detailModal, /onClearFile=\{\(\) => handleClearFile\(activeCostume\)\}/);
  // 성공했을 때만, 그리고 두 경로 모두 알린다.
  assert.equal((detailModal.match(/toast\.success\('작업 (?:폴더|파일) 연결을 해제했어요'\)/g) ?? []).length, 2);
});

test('피드백 57-2: 방금 지운 작업 폴더를 작업 파일 지정이 되살리지 않는다', () => {
  // 지우기 성공 시 "이 캐릭터에서 지웠다"를 기억하고, 자동 유추는 그 캐릭터에서만 건너뛴다.
  assert.match(detailModal, /const clearedFolderCharacterIdRef = useRef<string \| null>\(null\);/);
  assert.match(detailModal, /clearedFolderCharacterIdRef\.current = character\.id;/);
  assert.match(detailModal, /if \(!latestFolderPath\?\.trim\(\) && clearedFolderCharacterIdRef\.current !== character\.id\) \{/);
  // 다시 폴더를 지정·생성하면 기억을 지운다(그 뒤로는 자동 유추가 정상 동작).
  assert.equal((detailModal.match(/clearedFolderCharacterIdRef\.current = null;/g) ?? []).length, 2);
});
