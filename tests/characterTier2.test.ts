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
const boardView = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
const card = readFileSync('src/components/characters/CharacterCard.tsx', 'utf8');
const charTaskRow = readFileSync('src/components/widgets/my-tasks/components/CharacterTaskRow.tsx', 'utf8');
const myCharTasks = readFileSync('src/components/widgets/my-tasks/hooks/useMyCharacterTasks.ts', 'utf8');

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
