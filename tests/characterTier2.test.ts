/**
 * 캐릭터 현황판 Tier 2 배선 고정 테스트. 소스-문자열 검사 — 리팩터 시 앵커 동반 갱신.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const costumeDetail = readFileSync('src/components/characters/CostumeDetail.tsx', 'utf8');
const types = readFileSync('src/types/index.ts', 'utf8');
const rendererSupabase = readFileSync('src/services/supabaseService.ts', 'utf8');
const electronSupabase = readFileSync('electron/supabase.ts', 'utf8');
const store = readFileSync('src/stores/useCharacterBoardStore.ts', 'utf8');
const featuredImageSlot = readFileSync('src/components/characters/FeaturedImageSlot.tsx', 'utf8');
const boardView = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
const card = readFileSync('src/components/characters/CharacterCard.tsx', 'utf8');
const charTaskRow = readFileSync('src/components/widgets/my-tasks/components/CharacterTaskRow.tsx', 'utf8');
const myCharTasks = readFileSync('src/components/widgets/my-tasks/hooks/useMyCharacterTasks.ts', 'utf8');
const helpers = readFileSync('src/stores/characterBoardStoreHelpers.ts', 'utf8');
const preload = readFileSync('electron/preload.ts', 'utf8');
const mainProc = readFileSync('electron/main.ts', 'utf8');

test('T2-2: 복장별 출연 에피소드 토글 — 기존 setEpisodeCostume 재사용(마이그레이션 없음)', () => {
  assert.match(costumeDetail, /이 복장이 출연하는 에피소드/);
  assert.match(costumeDetail, /const on = link\?\.costumeId === costume\.id/);
  assert.match(costumeDetail, /setEpisodeCostume\(character\.id, epNum, on \? null : costume\.id\)/);
  // 캐릭터가 그 에피소드에 미연결이면 안내 문구.
  assert.match(costumeDetail, /먼저 위 '출연 에피소드'에서/);
});

test('T2-4: 복장 마감일(due_date) — 필드·매퍼·store·입력·나의할일 배지', () => {
  assert.match(types, /dueDate: string \| null;/);
  assert.match(types, /due_date\?: string \| null;/);
  assert.match(electronSupabase, /due_date: string \| null;/);
  assert.match(rendererSupabase, /dueDate: row\.due_date \?\? null/);
  assert.match(rendererSupabase, /snake\.due_date = updates\.dueDate/);
  assert.match(store, /\| 'dueDate'>>/);
  assert.match(costumeDetail, /updateCostumeField\(costume\.id, \{ dueDate: e\.target\.value \|\| null \}\)/);
  assert.match(myCharTasks, /dueDate: costume\.dueDate/);
  assert.match(charTaskRow, /function DueBadge/);
  assert.match(charTaskRow, /!task\.done && <DueBadge dueDate=\{task\.dueDate\}/);
});

test('T2-3: 캐릭터 기준 키(reference_height_px) — 필드·매퍼·store·입력·키비교뷰', () => {
  assert.match(types, /referenceHeightPx: number \| null;/);
  assert.match(types, /reference_height_px\?: number \| null;/);
  assert.match(electronSupabase, /reference_height_px: number \| null;/);
  assert.match(rendererSupabase, /referenceHeightPx: row\.reference_height_px \?\? null/);
  assert.match(store, /setCharacterReferenceHeight: async \(id, referenceHeightPx\)/);
  assert.match(store, /reference_height_px: referenceHeightPx/);
  assert.match(costumeDetail, /기준 키\(px\)/);
  assert.match(costumeDetail, /setCharacterReferenceHeight\(character\.id/);
  assert.match(boardView, /키 비교 보기/);
  assert.match(boardView, /const maxReferenceHeight = useMemo/);
  // 키 비교 모드에서 기준 키 순으로 정렬(코덱스 P2).
  assert.match(boardView, /const displayCharacters = useMemo/);
  assert.match(boardView, /displayCharacters\.map/);
  assert.match(boardView, /imageHeightPx=\{heightCompareMode/);
  assert.match(card, /imageHeightPx\?: number/);
  assert.match(card, /style=\{imageHeightPx \? \{ height: imageHeightPx \} : undefined\}/);
});

test('T2 migration: due_date + reference_height_px 컬럼 추가(추가 전용)', () => {
  const mig = readFileSync('DEVLOG/migrations/2026-07-08-character-board-duedate-height.sql', 'utf8');
  assert.match(mig, /ADD COLUMN IF NOT EXISTS due_date DATE/);
  assert.match(mig, /ADD COLUMN IF NOT EXISTS reference_height_px INTEGER/);
  assert.match(mig, /chk_characters_reference_height/);
  assert.doesNotMatch(mig, /DROP\s+(TABLE|COLUMN)/i);
});

// ─── 복장 다중 이미지 (character_costume_images) 백엔드 배선 ───

test('costume-images: 타입 (도메인 CharacterCostumeImage + snake Row + 역할)', () => {
  assert.match(types, /export type CostumeImageRole =/);
  assert.match(types, /export interface CharacterCostumeImage \{/);
  assert.match(types, /isPrimary: boolean;/);
  assert.match(types, /export interface CharacterCostumeImageRow \{/);
  assert.match(types, /costume_id: string;/);
  assert.match(types, /is_primary: boolean \| null;/);
});

test('costume-images: electron/supabase 로더+CRUD+setPrimary (clear 먼저) + 스토리지 정리', () => {
  assert.match(electronSupabase, /export async function loadCharacterCostumeImages\(\)/);
  assert.match(electronSupabase, /export async function addCostumeImage\(/);
  assert.match(electronSupabase, /export async function updateCostumeImage\(/);
  assert.match(electronSupabase, /export async function deleteCostumeImage\(/);
  assert.match(electronSupabase, /export async function setPrimaryCostumeImage\(_costumeId: string, imageId: string\)/);
  // setPrimary: clear+set 원자화 RPC 호출(2쿼리 부분실패로 primary 없는 상태 남는 코덱스 P2 방지).
  assert.match(electronSupabase, /supabase\.rpc\('set_primary_costume_image', \{ p_image_id: imageId \}\)/);
  // image_fit 은 NOT NULL — insert 시 기본값 채움.
  assert.match(electronSupabase, /image_fit: input\.imageFit \?\? DEFAULT_COSTUME_IMAGE_FIT/);
  // realtime tables 배열에 신규 테이블 포함.
  assert.match(electronSupabase, /'character_costumes', 'character_costume_images', 'episode_character_mapping'/);
  // 캐릭터/복장 삭제 시 복장이미지 URL 도 사전 수집(고아 방지).
  assert.match(electronSupabase, /from\('character_costume_images'\)\s*\.select\('url'\)/);
});

test('costume-images: IPC (main handle + preload bridge 5개)', () => {
  for (const ch of [
    'supabase:load-costume-images',
    'supabase:add-costume-image',
    'supabase:update-costume-image',
    'supabase:delete-costume-image',
    'supabase:set-primary-costume-image',
  ]) {
    assert.ok(mainProc.includes(`'${ch}'`), `main.ts should handle ${ch}`);
    assert.ok(preload.includes(`'${ch}'`), `preload.ts should invoke ${ch}`);
  }
});

test('costume-images: renderer service 매퍼+API (camel→snake)', () => {
  assert.match(rendererSupabase, /export function rowToCostumeImage\(/);
  assert.match(rendererSupabase, /imageBackground: normalizeCharacterImageBackground\(row\.image_background\)/);
  assert.match(rendererSupabase, /imageFit: normalizeCharacterImageFit\(row\.image_fit\)/);
  assert.match(rendererSupabase, /export async function loadCharacterCostumeImages\(\)/);
  assert.match(rendererSupabase, /export async function setPrimaryCostumeImage\(costumeId: string, imageId: string\)/);
  assert.match(rendererSupabase, /snake\.is_primary = updates\.isPrimary/);
});

test('costume-images: 순수 헬퍼 (buildImagesByCostume + rebuild 구조적 공유)', () => {
  assert.match(helpers, /export function buildImagesByCostume\(/);
  assert.match(helpers, /export function rebuildImagesByCostume\(/);
  assert.match(helpers, /export function compareCostumeImages\(/);
});

test('costume-images: store 상태+액션 + featured 동기화(무마이그레이션 호환)', () => {
  assert.match(store, /costumeImages: CharacterCostumeImage\[\];/);
  assert.match(store, /imagesByCostume: Map<string, CharacterCostumeImage\[\]>;/);
  assert.match(store, /addCostumeImage: async \(costumeId, url, role = 'design'\)/);
  assert.match(store, /setPrimaryImage: async \(imageId\)/);
  assert.match(store, /reorderCostumeImages: async \(costumeId, orderedIds\)/);
  assert.match(store, /deleteCostumeImage: async \(imageId\)/);
  // featured_* 동기화는 DB 트리거가 담당 — 앱이 featured 를 직접 쓰지 않는다(코덱스 P1/P2: 이전 primary 파일 보존·동기화 실패 방지).
  assert.doesNotMatch(store, /featuredImageUrl: created\.url/);
  assert.doesNotMatch(store, /featuredImageUrl: target\.url/);
  assert.doesNotMatch(store, /updateCostumeField\(costumeId, \{ featuredImageUrl: null \}\)/);
  assert.match(store, /DB 트리거/);
  // realtime 분기 존재.
  assert.match(store, /table === 'character_costume_images'/);
});

test('costume-images: FeaturedImageSlot 갤러리 배선 + featured 직접 쓰기 제거(P1)', () => {
  // store 는 primary 변경을 로컬 featured 에 즉시 반영하는 헬퍼를 갖는다(DB 확정은 트리거 담당).
  assert.match(store, /function applyFeaturedLocal/);
  // 슬롯은 다중 이미지 모델(imagesByCostume + addCostumeImage)로 업로드/표시한다.
  assert.match(featuredImageSlot, /imagesByCostume/);
  assert.match(featuredImageSlot, /addCostumeImage\(/);
  // 슬롯이 featured_image_url 을 직접 쓰면 예전 primary 파일이 지워짐(P1) — 이 경로 제거를 고정.
  assert.doesNotMatch(featuredImageSlot, /updateCostumeField\([^)]*featuredImageUrl/);
});

test('costume-images: featured 동기화 트리거 마이그레이션(스토리지 삭제 우회)', () => {
  const mig = readFileSync('DEVLOG/migrations/2026-07-08-costume-images-sync-trigger.sql', 'utf8');
  assert.match(mig, /CREATE OR REPLACE FUNCTION sync_costume_featured_image\(\)/);
  assert.match(mig, /AFTER INSERT OR UPDATE OR DELETE ON character_costume_images/);
  // primary 없으면 featured=NULL, 바뀔 때만 갱신(IS DISTINCT FROM).
  assert.match(mig, /WHERE costume_id = v_costume_id AND is_primary = true/);
  assert.match(mig, /featured_image_url IS DISTINCT FROM v_url/);
});

test('costume-images P2 수정: 원자 RPC + 라이트박스 선택이미지 + mock featured 동기화', () => {
  const rpcMig = readFileSync('DEVLOG/migrations/2026-07-08-costume-image-set-primary-rpc.sql', 'utf8');
  assert.match(rpcMig, /CREATE OR REPLACE FUNCTION set_primary_costume_image\(p_image_id UUID\)/);
  const detailModal = readFileSync('src/components/characters/CharacterDetailModal.tsx', 'utf8');
  assert.match(detailModal, /const \[lightboxImage, setLightboxImage\]/);
  assert.match(detailModal, /override\?\.url \?\? c\.featuredImageUrl!/);
  const slot = readFileSync('src/components/characters/FeaturedImageSlot.tsx', 'utf8');
  assert.match(slot, /onView\(costume\.id, \{ id: selectedImage\.id, url: selectedImage\.url/);
  const mock = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
  assert.match(mock, /function mockSyncCostumeFeatured/);
  assert.match(mock, /mockSyncCostumeFeatured\(costumeId\)/);
});

test('costume-images 4차: 라이트박스 fit 은 대표복장이 아니라 표시 이미지에 저장(imageId 배선)', () => {
  const lightbox = readFileSync('src/components/characters/CharacterImageLightbox.tsx', 'utf8');
  // 엔트리가 표시 이미지 id 를 싣고, fit 커밋이 그 imageId 로 넘어간다.
  assert.match(lightbox, /imageId\?: string;/);
  assert.match(lightbox, /onFitCommit: \(imageId: string, fit: CharacterImageFit\) => void;/);
  assert.match(lightbox, /if \(current\.imageId\) onFitCommit\(current\.imageId, next\)/);
  const detailModal = readFileSync('src/components/characters/CharacterDetailModal.tsx', 'utf8');
  // 대표복장(image_fit) 이 아니라 실제 이미지 행(image_fit)을 갱신.
  assert.match(detailModal, /imageId: override\?\.id \?\? primaryImg\?\.id/);
  assert.match(detailModal, /onFitCommit=\{\(imageId, fit\) => updateCostumeImageField\(imageId, \{ imageFit: fit \}\)\}/);
});

test('costume-images 4차: primary insert 경합 시 23505 를 비대표로 재시도', () => {
  const electronSupabase = readFileSync('electron/supabase.ts', 'utf8');
  // 부분 unique (costume_id) WHERE is_primary 위반(23505) 이면 비대표로 재삽입해 UI 멈춤 방지.
  assert.match(electronSupabase, /23505/);
  assert.match(electronSupabase, /is_primary: false/);
});
