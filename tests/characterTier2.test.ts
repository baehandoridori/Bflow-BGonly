/**
 * 캐릭터 현황판 Tier 2 배선 고정 테스트. 소스-문자열 검사 — 리팩터 시 앵커 동반 갱신.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const costumeDetail = readFileSync('src/components/characters/CostumeDetail.tsx', 'utf8');

test('T2-2: 복장별 출연 에피소드 토글 — 기존 setEpisodeCostume 재사용(마이그레이션 없음)', () => {
  assert.match(costumeDetail, /이 복장이 출연하는 에피소드/);
  assert.match(costumeDetail, /const on = link\?\.costumeId === costume\.id/);
  assert.match(costumeDetail, /setEpisodeCostume\(character\.id, epNum, on \? null : costume\.id\)/);
  // 캐릭터가 그 에피소드에 미연결이면 안내 문구.
  assert.match(costumeDetail, /먼저 위 '출연 에피소드'에서/);
});
