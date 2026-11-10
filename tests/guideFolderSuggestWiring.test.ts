// tests/guideFolderSuggestWiring.test.ts — 가이드 작업 폴더 제안의 배선 앵커. 소스를 글자로 읽는다(설계 4.7·4.8·4.9·5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 작업 트리의 기존 소스는 CRLF일 수 있다 — 읽은 뒤 LF로 맞춘다.
const read = (path: string): string => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const squash = (text: string): string => text.replace(/\s+/g, '');
const count = (text: string, needle: string): number => text.split(needle).length - 1;
function inOrder(source: string, parts: string[]): void {
  let at = 0;
  for (const part of parts) {
    const found = source.indexOf(part, at);
    assert.notEqual(found, -1, `순서대로 없다: ${part}`);
    at = found + part.length;
  }
}

test('창: 네이티브 dialog, 바깥 누름으로 닫지 않음, 키·붙여넣기 뒤로 새지 않음', () => {
  const sheet = read('src/components/scenes/GuideFolderSuggestSheet.tsx');
  assert.ok(sheet.includes('.showModal()'));
  assert.ok(sheet.includes("window.addEventListener('keydown',") && sheet.includes("window.addEventListener('paste',"));
  assert.ok(squash(sheet).includes('onCancel={(event)=>{event.preventDefault();'));
  assert.ok(!sheet.includes('onMouseDown'), '바깥 누름 닫기 없음(설계 4.8)');
  assert.ok(sheet.includes('onKeyDown={stop}') && sheet.includes('onPaste={stop}'));
});

test('창: 저장은 upsertLink 직접, 가드 길 안 씀', () => {
  const sheet = read('src/components/scenes/GuideFolderSuggestSheet.tsx');
  assert.ok(sheet.includes('upsertLink(') && !sheet.includes('saveWorkLinkPathGuarded'));
});

test('창: 한꺼번에 연결은 dialog.close() 뒤에', () => {
  inOrder(read('src/components/scenes/GuideFolderSuggestSheet.tsx'), ['dialogRef.current?.close()', 'offerBulkWorkLink(']);
});

test('창: 저장 중·저장 뒤에는 실시간 다시 판정 안 함', () => {
  const sheet = read('src/components/scenes/GuideFolderSuggestSheet.tsx');
  assert.ok(sheet.includes('reconcileCurrentFolder('));
  inOrder(sheet, ['if (savingRef.current || savedFolderRef.current !== null || closingRef.current) return;', 'reconcileCurrentFolder(']);
});

test('창: 긍정 버튼 강조색, accent-sub 안 씀', () => {
  const sheet = read('src/components/scenes/GuideFolderSuggestSheet.tsx');
  assert.ok(sheet.includes('bg-accent text-on-accent') && !sheet.includes('accent-sub'));
});

test('창: 흐림은 겹 하나에만, 줄이기에서는 시트 움직임 없음', () => {
  const sheet = read('src/components/scenes/GuideFolderSuggestSheet.tsx');
  assert.equal(count(sheet, 'backdrop-blur'), 1);
  const css = read('src/styles/guide-folder-sheet.css');
  inOrder(css, ['@media (prefers-reduced-motion: reduce)', '.bf-gfs-sheet-in', 'animation: none']);
  assert.ok(!css.includes('backdrop-filter'), '흐림 크기를 움직이지 않는다');
  assert.ok(read('src/main.tsx').includes("import './styles/guide-folder-sheet.css';"));
  assert.ok(!read('src/styles/motion-popups-panels.css').includes('bf-gfs-'), '공용 박자 파일은 퇴장 움직임 없음 규칙 그대로');
});

test('App 이 창 호스트를 띄운다', () => {
  inOrder(read('src/App.tsx'), ['<BulkWorkLinkDialogHost />', '<GuideFolderSuggestSheetHost />']);
});

test('작업 링크 칸이 저장 뒤 빛남 신호를 듣는다', () => {
  const panel = read('src/components/scenes/SceneWorkLinksPanel.tsx');
  assert.ok(panel.includes('WORK_LINK_FLASH_EVENT') && panel.includes('isWorkLinkFlashFor('));
});

test('서비스: 요청 번호로 옛 결과 버림, 다른 창 떠 있으면 안 띄움, 배경 씬만, 설정 확인', () => {
  const svc = read('src/services/guideFolderSuggestion.ts');
  assert.ok(svc.includes('++requestSeq') && svc.includes('!== requestSeq'));
  assert.ok(svc.includes('dialog[open]') && svc.includes('GuideFolderSuggestSheet.isOpen()'));
  assert.ok(svc.includes('isGuideFolderSuggestEnabled()'));
  assert.ok(svc.includes("department !== 'bg'"));
  assert.ok(svc.includes('loadForSceneUuids(') && svc.includes('GUIDE_FOLDER_LINK_WAIT_MS'));
});

test('통합 창: 가이드만, 붙여넣기는 지금 씬 uuid 를 ref 로, 업로드보다 먼저', () => {
  const unified = read('src/components/scenes/UnifiedSceneDetailModal.tsx');
  assert.equal(count(unified, 'suggestGuideFolder('), 3);
  assert.ok(squash(unified).includes("onDropBlob={(b)=>{voiduploadImage(b,'guide');suggestGuideFolder({sceneUuid:bgScene?.id,method:'drop',file:b});}}"));
  assert.ok(unified.includes("sceneUuid: bgSceneIdRef.current, method: 'paste', file: blob"));
  inOrder(unified, ["sceneUuid: bgSceneIdRef.current, method: 'paste', file: blob", 'await uploadImageRef.current(blob, imageType)']);
  assert.ok(unified.includes("if (imageType === 'guide') suggestGuideFolder({ sceneUuid: bgScene?.id, method: 'pick', file });"));
});

test('부서 하나 창: 가이드만, 다섯 길, 붙여넣기는 ref 로', () => {
  const single = read('src/components/scenes/SceneDetailModal.tsx');
  assert.equal(count(single, 'suggestGuideFolder('), 5);
  assert.equal(count(single, "imageType === 'guide') suggestGuideFolder("), 5);
  assert.ok(single.includes("suggestGuideFolder({ sceneUuid: sceneIdRef.current, method: 'paste', file: blob })"));
});

test('AGENTS: 한꺼번에 연결 시작점 둘, 새 절', () => {
  const agents = read('AGENTS.md');
  assert.ok(agents.includes('### 가이드 그림 작업 폴더 제안 (v1.150.0)'));
  assert.ok(agents.includes('GuideFolderSuggestSheet'));
  assert.ok(!agents.includes('- 제안은 `saveWorkLinkPathGuarded`의 성공 줄 뒤 한 곳에서만'));
});

test('버전 1.150.0 과 안내 첫 항목', () => {
  assert.equal(JSON.parse(read('package.json')).version, '1.150.0');
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, '1.150.0');
  assert.equal(lock.packages[''].version, '1.150.0');
  assert.equal(JSON.parse(read('DEVLOG/update-notes.json'))[0].version, '1.150.0');
});

test('최종 리뷰: 작업 링크 칸 감싸기는 그리드 칸이 줄어들 수 있게 min-w-0', () => {
  const panel = read('src/components/scenes/SceneWorkLinksPanel.tsx');
  assert.ok(panel.includes("<div className={cn('min-w-0 rounded-lg"), '긴 경로 말줄임이 깨지지 않게');
});

test('최종 리뷰: 씬을 넘기거나 창을 닫으면 아직 안 뜬 제안을 버린다', () => {
  const svc = read('src/services/guideFolderSuggestion.ts');
  assert.ok(svc.includes('export function cancelGuideFolderSuggestion(): void'));
  const unified = read('src/components/scenes/UnifiedSceneDetailModal.tsx');
  assert.ok(unified.includes('useEffect(() => () => cancelGuideFolderSuggestion(), [bgScene?.id]);'));
  const single = read('src/components/scenes/SceneDetailModal.tsx');
  assert.ok(single.includes('useEffect(() => () => cancelGuideFolderSuggestion(), [scene.id]);'));
});

test('최종 리뷰: 클립보드 붙여넣기 버튼은 그림을 읽은 뒤에, 클립보드 파일 경로 없이 짐작', () => {
  const single = read('src/components/scenes/SceneDetailModal.tsx');
  inOrder(single, [
    'const dataUrl = await window.electronAPI.clipboardReadImage();',
    "if (dataUrl && imageType === 'guide') suggestGuideFolder({ sceneUuid: sceneIdRef.current, method: 'paste', readClipboardPath: false });",
  ]);
  assert.ok(read('src/services/guideFolderSuggestion.ts').includes('input.readClipboardPath !== false'));
});

test('최종 리뷰: 제안 창 위에 그림을 떨어뜨려도 앱 화면이 그 파일로 바뀌지 않는다', () => {
  const sheet = squash(read('src/components/scenes/GuideFolderSuggestSheet.tsx'));
  assert.ok(sheet.includes('onDragOver={(event)=>{event.preventDefault();}}'));
  assert.ok(sheet.includes('onDrop={(event)=>{event.preventDefault();}}'));
});

test('코덱스 1차 P2: 다시 시도는 실제로 저장한 폴더 기준, 폴더 저장 뒤엔 후보를 바꾸지 못한다', () => {
  const sheet = read('src/components/scenes/GuideFolderSuggestSheet.tsx');
  assert.ok(sheet.includes('const savedFolderRef = useRef<string | null>(null);'));
  assert.ok(!sheet.includes('folderSavedRef'), '참·거짓 표시 대신 저장한 경로를 쥔다');
  assert.ok(sheet.includes('if (!samePath(savedFolderRef.current, candidate.folder) && !samePath(slotsNow().folder?.path, candidate.folder))'));
  assert.ok(sheet.includes('disabled={savedFolder !== null}'), '폴더가 저장된 뒤 후보 고르기는 잠긴다');
});

test('설정: 스위치 문구와 저장 키', () => {
  const section = read('src/components/settings/SceneLinkSection.tsx');
  assert.ok(section.includes('가이드 그림을 넣을 때 작업 폴더 제안'));
  assert.ok(section.includes('role="switch"') && section.includes('aria-checked'));
  assert.ok(section.includes('guideFolderSuggestEnabled'));
  const settings = read('src/services/settingsService.ts');
  assert.ok(settings.includes('guideFolderSuggestEnabled?: boolean'));
  assert.ok(settings.includes('export async function isGuideFolderSuggestEnabled(): Promise<boolean>'));
  assert.ok(read('src/views/SettingsView.tsx').includes('<SceneLinkSection />'));
});
