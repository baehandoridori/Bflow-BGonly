/**
 * 작업 경로 칸의 버튼 통일 (v1.134.2).
 * 씬 상세의 '작업 링크'와 캐릭터 현황판의 '작업 경로'가 같은 카드(PathLinkCard)를 쓴다.
 * 버튼은 쓰는 빈도 순서(열기 → 수정 → 해제)로 놓고, 크기는 글자 수가 아니라 그 순서가 정한다.
 *   - 경로를 두 줄로 나누는 규칙은 동작으로 검사한다.
 *   - 버튼 순서·무게·배선은 소스-문자열 검사 — 리팩터 시 앵커가 깨지면 함께 갱신할 것.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitPathForDisplay } from '../src/utils/pathDisplay.ts';

test('경로 두 줄: 이름은 마지막 마디, 위치는 그 앞', () => {
  assert.deepEqual(
    splitPathForDisplay('G:\\[]사코팍 캐릭터 세팅\\한솔\\한솔 SWver12.moho'),
    { name: '한솔 SWver12.moho', location: 'G:\\[]사코팍 캐릭터 세팅\\한솔' },
  );
  assert.deepEqual(splitPathForDisplay('C:/work/a001.moho'), { name: 'a001.moho', location: 'C:/work' });
});

test('경로 두 줄: 위치는 줄이지 않고 통째로 — 넘칠 때 어디를 줄일지는 보이는 쪽이 정한다', () => {
  assert.deepEqual(
    splitPathForDisplay('G:\\공유 드라이브\\사우스 코리안 파크\\240_경마장\\EP05\\A\\a001'),
    { name: 'a001', location: 'G:\\공유 드라이브\\사우스 코리안 파크\\240_경마장\\EP05\\A' },
  );
});

test('경로 두 줄: 끝의 구분자·네트워크 경로·이름뿐인 값·빈 값', () => {
  assert.deepEqual(splitPathForDisplay('G:\\작업\\윤서준 캐릭터\\'), { name: '윤서준 캐릭터', location: 'G:\\작업' });
  assert.deepEqual(splitPathForDisplay('G:\\작업\\\\윤서준 캐릭터\\\\'), { name: '윤서준 캐릭터', location: 'G:\\작업' });
  assert.deepEqual(splitPathForDisplay('\\\\nas\\share\\ep05\\a001'), { name: 'a001', location: '\\\\nas\\share\\ep05' });
  assert.deepEqual(splitPathForDisplay('\\\\nas'), { name: 'nas', location: '' });
  assert.deepEqual(splitPathForDisplay('/Volumes/team/ep05/a001'), { name: 'a001', location: '/Volumes/team/ep05' });
  assert.deepEqual(splitPathForDisplay('a001.moho'), { name: 'a001.moho', location: '' });
  assert.deepEqual(splitPathForDisplay('G:\\'), { name: 'G:', location: '' });
  assert.deepEqual(splitPathForDisplay('   '), { name: '', location: '' });
  assert.deepEqual(splitPathForDisplay(null), { name: '', location: '' });
  assert.deepEqual(splitPathForDisplay(undefined), { name: '', location: '' });
});

const card = readFileSync('src/components/common/PathLinkCard.tsx', 'utf8');
const scenePanel = readFileSync('src/components/scenes/SceneWorkLinksPanel.tsx', 'utf8');
const costumeDetail = readFileSync('src/components/characters/CostumeDetail.tsx', 'utf8');

test('버튼 순서: 열기 → 수정 → 해제, 한 줄에', () => {
  const row = card.slice(card.indexOf('<div className="mt-2.5 flex items-center gap-1.5">'), card.indexOf(') : ('));
  const open = row.indexOf('onClick={onOpen}');
  const edit = row.indexOf('onClick={onEdit}');
  const unlink = row.indexOf('onClick={onUnlink}');
  assert.ok(open > 0 && edit > open && unlink > edit, `순서가 다르다: 열기 ${open}, 수정 ${edit}, 해제 ${unlink}`);
});

test('버튼 무게: 열기는 남는 폭을 다 쓰는 글자 버튼, 수정·해제는 같은 크기의 아이콘 버튼', () => {
  // 열기 — 폭을 채우고(flex-1) 글자가 있다.
  assert.match(card, /className="inline-flex h-\[30px\] min-w-0 flex-1 items-center justify-center gap-1\.5 rounded-md bg-accent\/15 [^"]*"\s+>\s+\{opening \? [^\n]+\}\s+열기\s+<\/button>/);
  // 수정·해제 — 글자 수가 크기를 정하지 않게 같은 정사각형.
  assert.match(card, /const ICON_BUTTON =\s+'inline-flex h-\[30px\] w-\[30px\] shrink-0 /);
  assert.match(card, /className=\{cn\(ICON_BUTTON, 'border border-bg-border [^']*'\)\}\s+>\s+\{busy \? [^\n]+<Pencil /);
  // 해제 — 테두리 없이 가장 조용하게, 올리면 빨강.
  const unlinkClass = /className=\{cn\(ICON_BUTTON, '([^']*)'\)\}\s+>\s+<Unlink /.exec(card)?.[1] ?? '';
  assert.match(unlinkClass, /hover:bg-red-500\/10 hover:text-red-400/);
  assert.doesNotMatch(unlinkClass, /\bborder\b/);
  // 아이콘뿐인 버튼은 이름을 따로 갖는다(읽어 주는 이름 + 올리면 뜨는 설명). 열기도 어느 칸의 열기인지 읽어 준다.
  assert.match(card, /aria-label=\{`\$\{label\} 열기`\}/);
  assert.match(card, /aria-label=\{`\$\{label\} 수정`\}/);
  assert.match(card, /aria-label=\{`\$\{label\} 연결 해제`\}\s+title="연결 해제 — 실제 폴더·파일은 그대로예요"/);
});

test('잠금: 도는 중에는 수정·해제·연결·만들기를 못 누르고, 연결할 수 없는 칸은 수정도 잠근다', () => {
  assert.match(card, /onClick=\{onEdit\}\s+disabled=\{busy \|\| !!lockedReason\}/);
  assert.match(card, /onClick=\{onUnlink\}\s+disabled=\{busy\}/);
  assert.match(card, /onClick=\{onCreate\} disabled=\{busy\}/);
  const empty = card.slice(card.indexOf(') : ('));
  assert.match(empty, /ref=\{editButtonRef\}\s+type="button"\s+onClick=\{onEdit\}\s+disabled=\{busy\}/);
});

test('스타일: 실제로 만들어지지 않는 색 클래스를 쓰지 않는다', () => {
  // 이 프로젝트의 Tailwind 는 currentColor 에 투명도를 붙이지 못하고(border-current/25), 투명도는 5 단위 눈금만 만든다(/12, /8 은 없다).
  // 쓰여 있어도 조용히 빠져서 테두리가 기본 색(거의 흰색)으로 나오거나 올림 표시가 사라진다 — 리뷰에서 묶음 CSS 로 확인.
  assert.doesNotMatch(card, /-current\/\d/);
  assert.match(card, /borderColor: 'color-mix\(in oklab, currentColor 25%, transparent\)'/);
  for (const [name, source] of [['PathLinkCard', card], ['SceneWorkLinksPanel', scenePanel]] as const) {
    const odd = source.match(/[a-z-]+\/(?!\d*[05]\b)\d+(?=[\s"'`])/g) ?? [];
    assert.deepEqual(odd, [], `${name}: 눈금에 없는 투명도 — ${odd.join(', ')}`);
  }
});

test('정보: 이름 줄과 위치 줄을 나눠 보이고, 위치 줄은 전체 경로를 설명으로 갖는다', () => {
  assert.match(card, /const \{ name, location \} = splitPathForDisplay\(path\);/);
  assert.match(card, /title=\{name\}>\{name\}<\/div>/);
  // 위치 줄은 넘치면 앞쪽이 줄어든다 — 이름에 가까운 폴더가 남게(글 방향을 뒤집고, 글자 자체는 왼쪽→오른쪽으로 둔다).
  assert.match(card, /\{location && \(\s+<div className="truncate text-left text-\[11px\] text-text-secondary\/80 \[direction:rtl\]" title=\{path \?\? undefined\}>\s+<bdi dir="ltr">\{location\}<\/bdi>/);
});

test('비어 있는 칸: 두 화면이 같은 모양 — 연결(＋만들기), 연결할 수 없으면 사유만', () => {
  const empty = card.slice(card.indexOf(') : ('));
  assert.match(empty, /\{lockedReason \?\? '아직 연결 안 됨'\}/);
  assert.match(empty, /\{!lockedReason && \(/);
  assert.match(empty, /ref=\{editButtonRef\}\s+type="button"\s+onClick=\{onEdit\}/);
});

test('배선: 두 화면이 같은 카드를 쓴다 — 예전 제각각의 버튼은 남기지 않는다', () => {
  // 씬 상세 — 수정은 고르기/붙여넣기 메뉴를 열고(같은 ref 가 메뉴 자리 기준), 경고·붙여넣기 칸은 카드 안에 둔다.
  assert.match(scenePanel, /<PathLinkCard\s+kind=\{linkKind === 'folder' \? 'folder' : 'file'\}\s+label=\{kindMeta\.label\}\s+path=\{link\?\.path\}/);
  assert.match(scenePanel, /onEdit=\{\(\) => setMenuOpen\(\(value\) => !value\)\}\s+editButtonRef=\{menuTriggerRef\}\s+busy=\{saving\}/);
  assert.match(scenePanel, /lockedReason=\{canEdit \? undefined : '씬 데이터 없음'\}\s+onUnlink=\{handleUnlink\}/);
  assert.match(scenePanel, /<\/PathLinkCard>\s+\{menuOpen && menuPos && createPortal\(/);
  assert.match(scenePanel, /onOpen=\{handleOpen\}\s+opening=\{opening\}/);
  // 경고 표시와 붙여넣기 칸은 카드 안(버튼 줄 아래)에 둔다.
  assert.match(scenePanel, /onUnlink=\{handleUnlink\}\s+>\s+\{warningKeys\.length > 0 && \((?:(?!<\/PathLinkCard>)[\s\S])*\{pasteOpen && \((?:(?!<\/PathLinkCard>)[\s\S])*<\/PathLinkCard>/);
  for (const gone of ['<ExternalLink ', '<Pencil ', '<Unlink ', "'링크 해제'", 'title="수정"']) {
    assert.equal(scenePanel.includes(gone), false, `씬 상세에 예전 버튼 흔적: ${gone}`);
  }
  // 캐릭터 현황판 — 폴더는 캐릭터에, 파일은 복장에.
  assert.match(costumeDetail, /<PathLinkCard\s+kind="folder"\s+label="작업 폴더"\s+path=\{character\.workFolderPath\}/);
  assert.match(costumeDetail, /<PathLinkCard\s+kind="file"\s+label="작업 파일"\s+path=\{costume\.workFilePath\}/);
  assert.match(costumeDetail, /onEdit=\{onPickFolder\}\s+onUnlink=\{onClearFolder\}\s+onCreate=\{onCreateFolder\}/);
  assert.match(costumeDetail, /onEdit=\{onPickFile\}\s+onUnlink=\{onClearFile\}/);
  // (줄바꿈을 끼워 찾지 않는다 — 작업 트리가 CRLF 라 '\n' 을 붙이면 영영 맞지 않는 죽은 가드가 된다.)
  for (const gone of ['PathActionRow', '경로 수정', '경로 지정', '지우기']) {
    assert.equal(costumeDetail.includes(gone), false, `캐릭터 현황판에 예전 버튼 흔적: ${gone}`);
  }
  // 확인 창도 같은 말을 쓴다.
  assert.match(scenePanel, /confirmLabel: '연결 해제'/);
});
