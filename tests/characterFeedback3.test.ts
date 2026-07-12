/**
 * 2026-07-13 캐릭터 현황판 피드백 25~29(F25~F29) 배선 고정 테스트.
 * 소스-문자열 검사 — 리팩터 시 앵커가 깨지면 함께 갱신할 것.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const indexCss = readFileSync('src/index.css', 'utf8');
const costumeDetail = readFileSync('src/components/characters/CostumeDetail.tsx', 'utf8');
const globalTooltip = readFileSync('src/components/ui/GlobalTooltip.tsx', 'utf8');
const detailModal = readFileSync('src/components/characters/CharacterDetailModal.tsx', 'utf8');
const mainTs = readFileSync('electron/main.ts', 'utf8');
const preloadTs = readFileSync('electron/preload.ts', 'utf8');
const types = readFileSync('src/types/index.ts', 'utf8');
const mock = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
const store = readFileSync('src/stores/useCharacterBoardStore.ts', 'utf8');
const card = readFileSync('src/components/characters/CharacterCard.tsx', 'utf8');
const boardView = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
const featuredSlot = readFileSync('src/components/characters/FeaturedImageSlot.tsx', 'utf8');

test('F25: draggable 요소 HTML5 드래그 복원 CSS + 전역 리셋 보존', () => {
  // [draggable="true"] 에 user-drag: element 복원.
  assert.match(indexCss, /\[draggable="true"\]\s*\{\s*-webkit-user-drag:\s*element;/);
  // 전역 리셋의 -webkit-user-drag: none 은 여전히 존재(오삭제 방지 — 이미지 기본 드래그 고스트 억제).
  assert.match(indexCss, /-webkit-user-drag:\s*none;/);
});

test('F26: 이름 title=이름 풀버전 + 툴팁 줄바꿈 + key 최적화 유지', () => {
  // 이름 텍스트 title 은 경로가 아니라 이름 풀버전.
  assert.match(costumeDetail, /title=\{path \? displayCharacterPathName\(path\) : undefined\}/);
  // 툴팁 컨테이너: 줄바꿈 허용(whitespace-nowrap 제거, overflow-wrap:anywhere 도입).
  assert.doesNotMatch(globalTooltip, /whitespace-nowrap/);
  assert.match(globalTooltip, /\[overflow-wrap:anywhere\]/);
  assert.match(globalTooltip, /max-w-\[min\(480px,80vw\)\]/);
  // 가로 뷰포트 클램핑.
  assert.match(globalTooltip, /left: tooltip\.x \+ shiftX/);
  assert.match(globalTooltip, /ref=\{boxRef\}/);
  // 마우스 이동 중 re-mount 없이 style 만 갱신하는 key 최적화 유지(회귀 방지).
  assert.match(globalTooltip, /key=\{tooltip\.text\}/);
});

test('F27: 상세 모달 좌측 목록에 캐릭터 추가 + Escape 중첩 가드', () => {
  assert.match(detailModal, /import \{ AddCharacterModal \} from '@\/components\/characters\/AddCharacterModal'/);
  assert.match(detailModal, /const \[addOpen, setAddOpen\] = useState\(false\)/);
  // Escape 중첩 가드 — 추가 모달이 열려 있으면 상세는 안 닫힘.
  assert.match(detailModal, /if \(addOpen\) return;/);
  // aside 목록 하단 추가 버튼(보관 모드 숨김).
  assert.match(detailModal, /<Plus size=\{15\} \/> 캐릭터 추가/);
  assert.match(detailModal, /onClick=\{\(\) => setAddOpen\(true\)\}/);
  // AddCharacterModal 은 dialog div 바깥(오버레이 자식)에 렌더.
  assert.match(detailModal, /onCreated=\{\(c\) => setSelectedId\(c\.id\)\}/);
});

test('F28: 클립보드 파일 붙여넣기 IPC 4계층 배선', () => {
  // 채널 문자열이 main 핸들러 + preload invoke 에 존재.
  assert.match(mainTs, /ipcMain\.handle\('clipboard:read-image-file'/);
  assert.match(mainTs, /parseFileNameWBuffer\(clipboard\.readBuffer\('FileNameW'\)\)/);
  assert.match(preloadTs, /clipboard:read-image-file/);
  // 타입 시그니처 + 프리뷰 mock(누락 시 preview 런타임 오류).
  assert.match(types, /clipboardReadImageFile: \(\) => Promise<\{ fileName: string; dataUrl: string \} \| null>/);
  assert.match(mock, /clipboardReadImageFile: async \(\) => null/);
  // 렌더러 통합: fallback IPC 호출 + dataUrlToFile.
  assert.match(featuredSlot, /import \{ dataUrlToFile \} from '@\/utils\/dataUrlToFile'/);
  assert.match(featuredSlot, /window\.electronAPI\.clipboardReadImageFile\(\)/);
  assert.match(featuredSlot, /uploadFileIfImage\(pastedFile, \{ autoName: true \}\)/);
});

test('F29: 캐릭터 카드 드래그 재배치 — store 액션 + 카드 배선 + 뷰 게이트', () => {
  assert.match(store, /reorderCharacters: \(orderedIds: string\[\]\) => Promise<void>/);
  assert.match(store, /reorderCharacters: async \(orderedIds\) =>/);
  // 캐릭터 pending 버킷 + snake_case sort_order 로 저장.
  assert.match(store, /trackPendingFields\(pendingCharacterFields, ch\.id, \{ sortOrder: ch\.sortOrder \}\)/);
  assert.match(store, /svcUpdateCharacter\(ch\.id, \{ sort_order: ch\.sortOrder \}\)/);
  // 카드: draggable + id 인자 안정 콜백.
  assert.match(card, /draggable=\{!!onDragStartCard\}/);
  assert.match(card, /onDragStartCard\?: \(characterId: string\) => void/);
  // 뷰: 검색/태그/키비교/보관에서 비활성 게이트.
  assert.match(boardView, /const cardDragEnabled = !showArchived && !heightCompareMode && !query\.trim\(\) && activeTags\.length === 0/);
  assert.match(boardView, /void reorderCharacters\(moveCostumeInOrder\(allIds, dragId, targetId\)\)/);
});
