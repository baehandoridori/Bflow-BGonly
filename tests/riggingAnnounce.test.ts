/**
 * B11 리깅 완성 슬랙 공지 — buildRiggingBigo 동작 + 배선 고정 테스트.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRiggingBigo, buildJbbjOpenLink } from '../src/services/slackWebhookService.ts';

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
  assert.match(svc, /Path: params\.folderPath \? buildJbbjOpenLink\(params\.folderPath\) : ''/);
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
  // 피드백 34(b): [내용] 줄은 '"캐릭터" - "복장" 리깅완료' 포맷.
  assert.match(modal, /characterName: `"\$\{character\.name\}" - "\$\{costume\.name\}" 리깅완료`/);
  // Escape 는 최상단 모달 패턴 — 부모 상세 모달까지 닫히지 않게 capture + stopImmediatePropagation (코덱스 P2).
  assert.match(modal, /event\.stopImmediatePropagation\(\)/);
  assert.match(modal, /addEventListener\('keydown', onKey, \{ capture: true \}\)/);
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

test('피드백 31(a·d): 기본 제목 미리 채움 + 비고 없이 전송 가능', () => {
  const modal = readFileSync('src/components/characters/RiggingAnnounceModal.tsx', 'utf8');
  assert.match(modal, /useState\(TITLE_TEMPLATES\[0\]\.title\)/);
  // 피드백 34(a): 머리말 '[모호 리깅 현황]' 은 슬랙 워크플로가 붙인다 — 템플릿 제목에 다시 넣으면 두 번 찍힌다.
  assert.match(modal, /title: '리깅 완료 공지'/);
  assert.match(modal, /title: '드라마 톤 특수리깅 완료 공지'/);
  assert.doesNotMatch(modal, /title: '\[모호 리깅 현황\]/);
  assert.match(modal, /머리말이 자동으로 붙어요/);
  // 비고 필수 게이트 제거 — 전송 버튼은 전송/업로드 중에만 잠긴다.
  assert.doesNotMatch(modal, /비고를 한 줄 이상/);
  assert.doesNotMatch(modal, /hasNote/);
  assert.match(modal, /disabled=\{sending \|\| pasting\}/);
});

test('피드백 31(b): 공지 이미지 Ctrl+V — 공지 전용 업로드 + 미전송분 정리', () => {
  const modal = readFileSync('src/components/characters/RiggingAnnounceModal.tsx', 'utf8');
  assert.match(modal, /data-rigging-announce/);
  assert.match(modal, /clipboardReadImageFile/);
  // 복장 이미지 목록(addCostumeImage)에 등록하지 않는 one-off 업로드.
  assert.match(modal, /uploadCharacterImage\(character\.id, costume\.id, base64\)/);
  assert.doesNotMatch(modal, /addCostumeImage/);
  // 취소 시 전부(단, 전송 중이면 웹훅이 참조할 선택 이미지 보존 — 코덱스 3차 P2), 전송 시 쓴 이미지만 남기고 정리.
  assert.match(modal, /cleanupPastedUploads\(sending \? selectedImage\?\.url \?\? null : null\)/);
  assert.match(modal, /cleanupPastedUploads\(selectedImage\?\.url \?\? null\)/);
  // 업로드 진행 중 닫기(in-flight) 경합 — 닫힌 뒤 완료된 업로드는 등록 없이 즉시 정리 (코덱스 P2).
  assert.match(modal, /closedRef\.current = true;/);
  assert.match(modal, /if \(closedRef\.current\) \{\s*\n\s*deleteImage\(res\.url\)/);
  // 탐색기 파일 복사(FileNameW) 폴백 조회 동안에도 전송이 잠긴다 (코덱스 2차 P2).
  assert.match(modal, /setPasting\(true\);[\s\S]{0,200}clipboardReadImageFile/);
  // 배경 화면(FeaturedImageSlot)의 paste 가드가 모달 열림을 감지해 이중 업로드를 막는다.
  const slot = readFileSync('src/components/characters/FeaturedImageSlot.tsx', 'utf8');
  assert.match(slot, /\[data-rigging-announce\]/);
});

test('buildJbbjOpenLink: 스튜디오 오토핫키 링크 포맷과 일치 (피드백 31c)', () => {
  // #공지사항-작업 채널의 실사용 수동 공지 링크와 동일 포맷 — 백슬래시→/, 공백→%20,
  // 한글·대괄호·드라이브 문자는 원문 유지. 한글까지 인코딩하면 팀원 PC 의 jbbj 핸들러가 폴더를 못 찾는다.
  assert.equal(
    buildJbbjOpenLink('G:\\공유 드라이브\\사우스 코리안 파크\\[]사코팍 캐릭터 세팅\\휠체어 할머니'),
    'jbbj://open/G:/공유%20드라이브/사우스%20코리안%20파크/[]사코팍%20캐릭터%20세팅/휠체어%20할머니',
  );
  // 공백 외 특수문자(#, %)도 실사용 포맷과 동일하게 원문 통과 — 핸들러가 %20 만 복원하는 전제.
  assert.equal(buildJbbjOpenLink('G:\\공유 드라이브\\A#B 50%'), 'jbbj://open/G:/공유%20드라이브/A#B%2050%');
  // 이미 슬래시인 경로도 동일 처리.
  assert.equal(buildJbbjOpenLink('G:/이미 슬래시/경로'), 'jbbj://open/G:/이미%20슬래시/경로');
});
