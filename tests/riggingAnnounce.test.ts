/**
 * B11 리깅 완성 슬랙 공지 — buildRiggingBigo 동작 + 배선 고정 테스트.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRiggingBigo } from '../src/services/slackWebhookService.ts';

test('buildRiggingBigo: 빈 줄 제거 + trim + 줄바꿈 결합', () => {
  assert.equal(buildRiggingBigo(['a', 'b']), 'a\nb');
  assert.equal(buildRiggingBigo([' 앞뒤공백 ', '', '   ', '둘째 줄']), '앞뒤공백\n둘째 줄');
  assert.equal(buildRiggingBigo([]), '');
  assert.equal(buildRiggingBigo(['   ']), '');
  assert.equal(buildRiggingBigo(['한 줄만']), '한 줄만');
});

test('B11 전송 계층: main URL/핸들러 + preload + 타입 + mock', () => {
  const main = readFileSync('electron/main.ts', 'utf8');
  // 리깅 전용 워크플로 트리거 URL + 전송 핸들러.
  assert.match(main, /const SLACK_RIGGING_WEBHOOK_URL = 'https:\/\/hooks\.slack\.com\/triggers\/T03HKE9MNCV\/11544189535185\/a8b683d4955671c51921ca5dd1ec0230'/);
  assert.match(main, /ipcMain\.handle\('slack:send-rigging-webhook'/);
  assert.match(main, /postSlackWebhook\(SLACK_RIGGING_WEBHOOK_URL/);
  const preload = readFileSync('electron/preload.ts', 'utf8');
  assert.match(preload, /sendRiggingWebhook:.*invoke\('slack:send-rigging-webhook', payload\)/s);
  const types = readFileSync('src/types/index.ts', 'utf8');
  assert.match(types, /sendRiggingWebhook: \(payload: Record<string, string>\) => Promise<\{ ok: boolean \}>/);
  const mock = readFileSync('src/mocks/devElectronAPI.ts', 'utf8');
  assert.match(mock, /sendRiggingWebhook: async \(payload/);
});

test('B11 서비스: 워크플로 변수(title/CH_name/Path/bigo/image) 매핑', () => {
  const svc = readFileSync('src/services/slackWebhookService.ts', 'utf8');
  assert.match(svc, /export async function sendRiggingAnnounce/);
  assert.match(svc, /title: params\.title/);
  assert.match(svc, /CH_name: params\.characterName/);
  assert.match(svc, /Path: params\.folderPath \?\? ''/);
  assert.match(svc, /bigo: buildRiggingBigo\(params\.notes\)/);
  assert.match(svc, /image: params\.imageUrl \?\? ''/);
  assert.match(svc, /window\.electronAPI\.sendRiggingWebhook\(payload\)/);
});

test('B11 UI: CostumeDetail 버튼 + 모달 배선, 모달은 대표 기본선택·경로 자동', () => {
  const detail = readFileSync('src/components/characters/CostumeDetail.tsx', 'utf8');
  assert.match(detail, /import \{ RiggingAnnounceModal \}/);
  assert.match(detail, /리깅 완성 공지/);
  assert.match(detail, /setAnnounceOpen\(true\)/);
  assert.match(detail, /<RiggingAnnounceModal[\s\S]*character=\{character\}[\s\S]*costume=\{costume\}/);
  const modal = readFileSync('src/components/characters/RiggingAnnounceModal.tsx', 'utf8');
  // 기본 선택 = 대표(primary) 이미지.
  assert.match(modal, /images\.find\(\(i\) => i\.isPrimary\) \?\? images\[0\]/);
  // 경로는 캐릭터 작업 폴더 자동.
  assert.match(modal, /character\.workFolderPath/);
  // 비고 여러 줄 추가/삭제.
  assert.match(modal, /const addRow =/);
  assert.match(modal, /비고 추가/);
  // 전송은 서비스 경유(title 포함).
  assert.match(modal, /sendRiggingAnnounce\(/);
  assert.match(modal, /title: title\.trim\(\)/);
});

test('B11 UI: 제목 템플릿 버튼 — 누르면 제목만 채운다', () => {
  const modal = readFileSync('src/components/characters/RiggingAnnounceModal.tsx', 'utf8');
  assert.match(modal, /const TITLE_TEMPLATES/);
  assert.match(modal, /드라마 톤 특수리깅 완료/);
  // 템플릿 클릭은 제목(title)만 설정(비고는 건드리지 않음).
  assert.match(modal, /onClick=\{\(\) => \{ setTitle\(t\.title\); setActiveTpl\(t\.key\); \}\}/);
  // 제목 직접 편집 시 활성 템플릿 해제.
  assert.match(modal, /onChange=\{\(e\) => \{ setTitle\(e\.target\.value\); setActiveTpl\(null\); \}\}/);
});
