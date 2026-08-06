/**
 * 피드백 33 — 기준 키 자동 설정 + 드래그 조정: 순수 계산 실행 검증 + 배선 고정.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveHeightPx } from '../src/utils/characterHeight.ts';
import {
  DEFAULT_HEIGHT_GUIDES,
  MIN_GUIDE_GAP_RATIO,
  clampGuides,
  guidesToHeightPx,
  autoHeightFromNatural,
} from '../src/utils/characterHeightGuides.ts';

test('기본 기준선은 이미지 전체(0~1) — 전체 높이 = 원본 px 그대로', () => {
  assert.equal(guidesToHeightPx(DEFAULT_HEIGHT_GUIDES, 500), 500);
  assert.equal(guidesToHeightPx(DEFAULT_HEIGHT_GUIDES, 650), 650);
});

test('기준선을 안쪽으로 좁히면 비율만큼 px 가 줄어든다 (모자 쓴 캐릭터 시나리오)', () => {
  // 모자가 이미지 위 10% 를 차지 → 머리선을 0.1 로 내리면 500px 의 90% = 450px.
  assert.equal(guidesToHeightPx({ topRatio: 0.1, bottomRatio: 1 }, 500), 450);
  // 바닥선도 5% 올리면 85% = 425px.
  assert.equal(guidesToHeightPx({ topRatio: 0.1, bottomRatio: 0.95 }, 500), 425);
});

test('환산 결과는 DB CHECK 범위(1~4999)로 클램프', () => {
  assert.equal(guidesToHeightPx({ topRatio: 0, bottomRatio: 1 }, 12000), 4999);
  assert.equal(guidesToHeightPx({ topRatio: 0.499, bottomRatio: 0.5 }, 100), 1); // 0.1px → 최소 1
});

test('clampGuides: 움직인 선이 반대 선을 넘지 못하고 최소 간격 앞에서 멈춘다', () => {
  const t = clampGuides({ topRatio: 0.99, bottomRatio: 0.5 }, 'top');
  assert.ok(t.bottomRatio - t.topRatio >= MIN_GUIDE_GAP_RATIO - 1e-9);
  assert.equal(t.bottomRatio, 0.5);
  const b = clampGuides({ topRatio: 0.5, bottomRatio: 0.1 }, 'bottom');
  assert.ok(b.bottomRatio - b.topRatio >= MIN_GUIDE_GAP_RATIO - 1e-9);
  assert.equal(b.topRatio, 0.5);
});

test('clampGuides: 화면 밖 드래그는 0~1 로 클램프', () => {
  assert.deepEqual(clampGuides({ topRatio: -0.3, bottomRatio: 1.4 }, 'top'), { topRatio: 0, bottomRatio: 1 });
});

test('autoHeightFromNatural: 원본 세로 px 반올림 + 클램프, 실패값은 null', () => {
  assert.equal(autoHeightFromNatural(650), 650);
  assert.equal(autoHeightFromNatural(719.6), 720);
  assert.equal(autoHeightFromNatural(12000), 4999);
  assert.equal(autoHeightFromNatural(0), null);
  assert.equal(autoHeightFromNatural(null), null);
  assert.equal(autoHeightFromNatural(Number.NaN), null);
});

// ─── 배선 고정 (소스 앵커) ───

test('33-a 배선: 업로드 원본 측정 + 기준 키 자동 설정', () => {
  const slot = readFileSync('src/components/characters/FeaturedImageSlot.tsx', 'utf8');
  assert.match(slot, /measureImageSize\(file\)/);
  assert.match(slot, /autoHeightFromNatural\(naturalSize\.height\)/);
  assert.match(slot, /referenceHeightPx == null/);
  assert.match(slot, /setCharacterReferenceHeight\(character\.id, auto\)/);
  const utils = readFileSync('src/utils/imageUtils.ts', 'utf8');
  assert.match(utils, /export async function measureImageSize/);
});

test('33 배선: natural_width/height 저장 체인 (타입→매퍼→insert→마이그레이션)', () => {
  const types = readFileSync('src/types/index.ts', 'utf8');
  assert.match(types, /naturalWidth: number \| null;/);
  assert.match(types, /natural_height\?: number \| null;/);
  const svc = readFileSync('src/services/supabaseService.ts', 'utf8');
  assert.match(svc, /naturalWidth: row\.natural_width \?\? null/);
  const esb = readFileSync('electron/supabase.ts', 'utf8');
  assert.match(esb, /insert\.natural_width = input\.naturalWidth/);
  assert.match(esb, /insert\.natural_height = input\.naturalHeight/);
  const mig = readFileSync('DEVLOG/migrations/2026-07-15-costume-image-natural-size.sql', 'utf8');
  assert.match(mig, /ADD COLUMN IF NOT EXISTS natural_height INTEGER/);
  assert.doesNotMatch(mig, /DROP\s+(TABLE|COLUMN)/i);
});

test('33-b 배선: 기준 키 드래그 에디터', () => {
  const editor = readFileSync('src/components/characters/CharacterHeightEditor.tsx', 'utf8');
  assert.match(editor, /data-character-height-editor/);
  assert.match(editor, /guidesToHeightPx/);
  assert.match(editor, /setCharacterReferenceHeight\(character\.id, previewPx\)/);
  const detail = readFileSync('src/components/characters/CostumeDetail.tsx', 'utf8');
  assert.match(detail, /이미지로 조정/);
  assert.match(detail, /CharacterHeightEditor/);
  const slot = readFileSync('src/components/characters/FeaturedImageSlot.tsx', 'utf8');
  assert.match(slot, /\[data-character-height-editor\]/);
});

test('피드백 47: effectiveHeightPx — 복장 오버라이드 우선, 없으면 대표 키', () => {
  assert.equal(effectiveHeightPx({ referenceHeightPx: 600 }, { heightPx: 700 }), 700);
  assert.equal(effectiveHeightPx({ referenceHeightPx: 600 }, { heightPx: null }), 600);
  assert.equal(effectiveHeightPx({ referenceHeightPx: 600 }, null), 600);
  assert.equal(effectiveHeightPx({ referenceHeightPx: null }, { heightPx: null }), null);
});

test('피드백 47 배선: 복장 키 컬럼 체인 + 에디터 저장 분기 + 키 비교 유효값', () => {
  const types = readFileSync('src/types/index.ts', 'utf8');
  assert.match(types, /heightPx: number \| null;/);
  assert.match(types, /height_px\?: number \| null;/);
  const svc = readFileSync('src/services/supabaseService.ts', 'utf8');
  assert.match(svc, /heightPx: row\.height_px \?\? null/);
  assert.match(svc, /snake\.height_px = updates\.heightPx/);
  const store = readFileSync('src/stores/useCharacterBoardStore.ts', 'utf8');
  assert.match(store, /'heightPx'/);
  const detail = readFileSync('src/components/characters/CostumeDetail.tsx', 'utf8');
  assert.match(detail, /이 복장 키\(px\)/);
  assert.match(detail, /updateCostumeField\(costume\.id, \{ heightPx: next \}\)/);
  const editor = readFileSync('src/components/characters/CharacterHeightEditor.tsx', 'utf8');
  assert.match(editor, /updateCostumeField\(costume\.id, \{ heightPx: previewPx \}\)/);
  assert.match(editor, /setCharacterReferenceHeight\(character\.id, previewPx\)/);
  const board = readFileSync('src/views/CharacterBoardView.tsx', 'utf8');
  assert.match(board, /effectiveHeightPx/);
  const mig = readFileSync('DEVLOG/migrations/2026-08-06-costume-height-override.sql', 'utf8');
  assert.match(mig, /ADD COLUMN IF NOT EXISTS height_px INTEGER/);
  assert.match(mig, /chk_costume_height/);
  assert.doesNotMatch(mig, /DROP\s+(TABLE|COLUMN)/i);
});
