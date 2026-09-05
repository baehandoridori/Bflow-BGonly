/**
 * 2026-07-08 캐릭터 현황판 피드백 배치(Tier 1: B3~B10) 배선 고정 테스트.
 * 소스-문자열 검사 — 리팩터 시 앵커가 깨지면 함께 갱신할 것.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const store = readFileSync('src/stores/useCharacterBoardStore.ts', 'utf8');
const storeHelpers = readFileSync('src/stores/characterBoardStoreHelpers.ts', 'utf8');
const appStore = readFileSync('src/stores/useAppStore.ts', 'utf8');
const addModal = readFileSync('src/components/characters/AddCharacterModal.tsx', 'utf8');
const featuredSlot = readFileSync('src/components/characters/FeaturedImageSlot.tsx', 'utf8');
const boardView = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
const sidebar = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
const card = readFileSync('src/components/characters/CharacterCard.tsx', 'utf8');
const detailModal = readFileSync('src/components/characters/CharacterDetailModal.tsx', 'utf8');
const costumeDetail = readFileSync('src/components/characters/CostumeDetail.tsx', 'utf8');
const episodeAssetBoard = readFileSync('src/views/EpisodeAssetBoard.tsx', 'utf8');

test('B4: 이름 없이 추가 — 임시 이름 부여 + 파일명 자동 지정 + 추가 후 상세 오픈', () => {
  // 임시 이름
  assert.match(store, /nextTempCharacterName\(get\(\)\.characters\.map\(\(c\) => c\.name\)\)/);
  assert.match(store, /import \{ nextTempCharacterName \} from '@\/utils\/characterName'/);
  // 모달: 빈 이름 허용 + onCreated
  assert.match(addModal, /onCreated\?: \(character: Character\) => void/);
  assert.match(addModal, /disabled=\{saving \|\| !!blockingDuplicate\}/); // 피드백 55: 같은 이름이면 추가 차단
  assert.doesNotMatch(addModal, /disabled=\{!name\.trim\(\) \|\| saving\}/);
  assert.match(addModal, /onCreated\?\.\(created\); onClose\(\);/);
  // 파일명 자동 지정(파일선택·드래그만, 붙여넣기 제외)
  assert.match(featuredSlot, /import \{ deriveCharacterNameFromFileName, isTempCharacterName \} from '@\/utils\/characterName'/);
  assert.match(featuredSlot, /if \(opts\?\.autoName\)/);
  assert.match(featuredSlot, /isTempCharacterName\(latestName\)/);
  assert.match(featuredSlot, /deriveCharacterNameFromFileName\(file\.name\)/);
  assert.match(featuredSlot, /uploadFileIfImage\(file, \{ autoName: false \}\)/); // 붙여넣기
  assert.match(featuredSlot, /uploadFileIfImage\(event\.dataTransfer\.files\?\.\[0\], \{ autoName: true \}\)/); // 드롭
  assert.match(featuredSlot, /handleUpload\(f, \{ autoName: true, role: pendingRoleRef\.current \}\)/); // 파일선택
  // 추가 후 카드 오픈
  assert.match(boardView, /onCreated=\{\(c\) => \{ setTab\('board'\); setPendingOpenId\(c\.id\); \}\}/);
});

test('B6→피드백 35: 사이드바 캐릭터 + 버튼 제거 — 배선 잔재 없음', () => {
  // 사용자 요청(피드백 35)으로 사이드바 '+' 는 삭제됐다. 죽은 배선이 되살아나지 않게 고정.
  assert.doesNotMatch(sidebar, /isCharacterAddItem/);
  assert.doesNotMatch(sidebar, /aria-label="캐릭터 추가"/);
  assert.doesNotMatch(sidebar, /PendingCharacterAddRequest/);
  assert.doesNotMatch(appStore, /endingCharacterAddRequest/);
  assert.doesNotMatch(boardView, /endingCharacterAddRequest/);
  // 캐릭터 추가 진입점은 현황판 헤더 버튼과 상세 모달(F27)로 유지된다.
  assert.match(boardView, /<Plus size=\{16\} \/> 캐릭터 추가/);
  assert.match(detailModal, /<Plus size=\{15\} \/> 캐릭터 추가/);
});

test('B8→피드백 53: 카드 좌/우 버튼으로 복장 전환 + 전환 복장을 클릭/우클릭/상세로 전달', () => {
  // 피드백 53: 휠 하이재킹 제거 — wheel 리스너가 되살아나면 스크롤 충돌 회귀.
  assert.doesNotMatch(card, /addEventListener\('wheel'/);
  assert.match(card, /aria-label="이전 복장"/);
  assert.match(card, /aria-label="다음 복장"/);
  assert.match(card, /e\.stopPropagation\(\); stepCostume\(-1\);/);
  assert.match(card, /e\.stopPropagation\(\); stepCostume\(1\);/);
  assert.match(card, /onOpen\(character\.id, shown\?\.id\)/);
  assert.match(card, /onContextMenu\(character\.id, event, shown\?\.id\)/);
  assert.match(card, /imaged\.length > 1/);
  // 카드 이미지 div 원형 className 보존(회귀 방지).
  assert.match(card, /aspect-\[3\/4\] bg-bg-border\/30 flex items-center justify-center overflow-hidden/);
  assert.match(boardView, /setDetailRequest\(\(prev\) => \(\{ id: characterId, nonce: \(prev\?\.nonce \?\? 0\) \+ 1, costumeId \}\)\)/);
  assert.match(boardView, /initialCostumeId=\{detailRequest\.costumeId\}/);
  assert.match(detailModal, /initialCostumeId\?: string/);
  assert.match(detailModal, /initialCostumeId && costumes\.some\(\(c\) => c\.id === initialCostumeId\)/);
});

test('B9: 열기 버튼 hover 시 전체 경로', () => {
  assert.match(costumeDetail, /onClick=\{onOpen\}\s*\n\s*title=\{path\}/);
  // 이름 텍스트 title 은 경로가 아니라 이름 풀버전(F26) — '열기' 버튼이 경로를 담당.
  assert.match(costumeDetail, /title=\{path \? displayCharacterPathName\(path\) : undefined\}>\{displayCharacterPathName\(path\)\}/);
});

test('B10: 복장 드래그 재배치 — 순수 헬퍼 + store + DnD + pending 보호', () => {
  assert.match(storeHelpers, /export function reorderedCostumeSortOrders/);
  assert.match(store, /reorderCostumes: \(characterId: string, orderedIds: string\[\]\) => Promise<void>/);
  assert.match(store, /reorderCostumes: async \(characterId, orderedIds\) =>/);
  assert.match(store, /trackPendingFields\(pendingCostumeFields, ch\.id, \{ sortOrder: ch\.sortOrder \}\)/);
  assert.match(store, /svcUpdateCostume\(ch\.id, \{ sortOrder: ch\.sortOrder \}\)/);
  assert.match(store, /복장 순서 변경 저장에 실패했어요/);
  assert.match(detailModal, /draggable\s*\n\s*onDragStart=/);
  assert.match(detailModal, /onDropCostume\(costume\.id\)/);
  assert.match(detailModal, /void reorderCostumes\(character\.id, moveCostumeInOrder\(currentIds, dragId, targetId\)\)/);
  assert.match(storeHelpers, /export function moveCostumeInOrder/);
});

test('B3: 에피소드 에셋 이 편 복장 썸네일이 세로 이미지를 크롭하지 않는다', () => {
  assert.match(episodeAssetBoard, /import \{ CharacterImageFrame \} from '@\/components\/characters\/CharacterImageFrame'/);
  // 이 편 복장(3:4) 썸네일은 CharacterImageFrame(contain+fit) — object-cover 크롭 제거.
  assert.match(episodeAssetBoard, /<CharacterImageFrame url=\{c\.featuredImageUrl\} alt=\{c\.name\} background=\{c\.imageBackground\} fit=\{c\.imageFit\}/);
  assert.doesNotMatch(episodeAssetBoard, /src=\{c\.featuredImageUrl\} alt=\{c\.name\} className="w-full h-full object-cover"/);
});
