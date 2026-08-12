// tests/costumePresenceWiring.test.ts — 피드백 54: 캐릭터 파일 열림 표시 배선 앵커
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainTs = readFileSync('electron/main.ts', 'utf8');
const service = readFileSync('electron/presence/editingPresenceService.ts', 'utf8');
const store = readFileSync('src/stores/useEditingPresenceStore.ts', 'utf8');
const card = readFileSync('src/components/characters/CharacterCard.tsx', 'utf8');
const listRow = readFileSync('src/components/characters/CharacterListRow.tsx', 'utf8');
const detailModal = readFileSync('src/components/characters/CharacterDetailModal.tsx', 'utf8');
const widgetPopup = readFileSync('src/views/WidgetPopup.tsx', 'utf8');

test('코어: 복장 캐시 + kind 소스 배열 + 단일 payload 합성 + realtime 무효화(실변경 필터)', () => {
  assert.match(mainTs, /costumeFileCache/);
  assert.match(mainTs, /refreshCostumeFileCache/);
  // character_costumes 실변경만 → 캐시 refresh 후 reset (고빈도 UPDATE 증폭 방지 + stale 캐시 재평가 방지 순서).
  assert.match(mainTs, /payload\.table === 'character_costumes' && costumeFileCacheAffected\(payload\)/);
  assert.match(mainTs, /function costumeFileCacheAffected/);
  // kind별 감지 소스 등록 — 새 파일 종류 확장 지점 (피드백 54 일반화).
  assert.match(mainTs, /kind: 'scene', getEntries: \(\) => sceneWorkFileEntries\(sceneWorkLinkCache\)/);
  assert.match(mainTs, /kind: 'costume', getEntries: \(\) => costumeFileCache/);
  // 로그아웃 빈-track 도 일반 필드로.
  assert.match(mainTs, /editingSceneUuids: \[\], editing: \{\}/);
  // 소스 배열을 한 publish 에서 해석해 한 payload 로 track (덮어쓰기 방지의 구조적 앵커) + 구버전 미러.
  assert.match(service, /export interface PresenceSource/);
  assert.match(service, /editingSceneUuids: editing\['scene'\] \?\? \[\]/);
});

test('렌더러: byKind store + kind 공용 훅 + 복장 래퍼 + 팝업 구독', () => {
  assert.match(store, /byKind/);
  assert.match(store, /export function useEntityEditingPresence/);
  assert.match(store, /export function useEntityCollisionWarn/);
  assert.match(store, /export function useCostumeEditingPresence/);
  assert.match(store, /export function useCostumeCollisionWarn/);
  // 팝업(별도 렌더러 프로세스)은 App.tsx 배선이 적용되지 않는다 — 자체 구독 필수 (42~50 45번과 같은 부류).
  assert.match(widgetPopup, /onSupabasePresence/);
  assert.match(widgetPopup, /getPresenceSnapshot/);
  assert.match(widgetPopup, /applyPresenceSnapshot/);
});

test('3표면: 카드·리스트 행·상세 모달(링+배너)', () => {
  assert.match(card, /useCostumeEditingPresence/);
  assert.match(card, /editingBeamClass\(presenceEditors\.length > 0, presenceWarn\)/);
  assert.match(card, /<EditingNameLabels editors=\{presenceEditors\} className="absolute -top-3 left-3 z-20" \/>/);
  assert.match(listRow, /editingBeamClass\(presenceEditors\.length > 0, presenceWarn\)/);
  assert.match(listRow, /<EditingNameLabels editors=\{presenceEditors\} max=\{2\} className="shrink-0" \/>/);
  assert.match(detailModal, /editingModalBeamClass\(modalPresenceEditors\.length > 0, modalPresenceWarn\)/);
  assert.match(detailModal, /<EditingPresenceBanner editors=\{panelPresenceEditors\} warn=\{panelPresenceWarn\} \/>/);
});
