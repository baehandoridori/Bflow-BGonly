/**
 * 담당 컴포지터 지정 (v1.95.0) — 헤더 칩 편집 UI + 다중 표시 배선 고정 테스트.
 * 소스-문자열 검사 — 리팩터로 앵커가 깨지면 함께 갱신할 것.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const header = readFileSync('src/views/compositing-dashboard/DashHeader.tsx', 'utf8');
const popover = readFileSync('src/components/compositing/CompositorAssignPopover.tsx', 'utf8');
const compositingLabels = readFileSync('src/utils/compositingLabels.ts', 'utf8');

test('헤더: 담당 컴포지터를 전원 표시한다 (첫 1명만 보여주던 동작 제거)', () => {
  // 예전엔 users.find(...) 로 한 명만 잡아 여러 명 지정해도 헤더에 하나만 드러났다.
  assert.doesNotMatch(header, /users\.find\(\(u\) => u\.isCompositor\)/);
  assert.match(header, /const compositors = useMemo/);
  assert.match(header, /users\.filter\(\(u\) => u\.isCompositor === true\)/);
  // 아바타 겹침 + 인원수 — '보는 사람' 칩과 같은 패턴.
  assert.match(header, /compositors\.slice\(0, 3\)/);
  assert.match(header, /marginLeft: i === 0 \? 0 : -7/);
  assert.match(header, /담당 컴포지터\{compositors\.length > 1 && ` \$\{compositors\.length\}명`\}/);
  // 본인이 지정돼 있으면 맨 앞 + (나) 강조 유지.
  assert.match(header, /viewerIsAssigned/);
  assert.match(header, /\(나\)/);
});

test('헤더: 지정 UI 는 어드민만, 일반 사용자는 읽기 전용', () => {
  assert.match(header, /const canAssignCompositor = currentUser\?\.role === 'admin'/);
  // 어드민일 때만 button + 팝오버, 아니면 기존 div 칩.
  assert.match(header, /aria-haspopup="dialog"/);
  assert.match(header, /assignOpen && canAssignCompositor && \(?\s*\r?\n?\s*<CompositorAssignPopover/);
  // 잠금 아이콘 의미는 유지 — 어드민은 연필, 그 외는 권한 유무에 따라 Unlock/Lock.
  assert.match(header, /viewerIsCompositor\s*\r?\n?\s*\?\s*<Unlock/);
});

test('팝오버: 다중 선택 + 설정 탭과 같은 저장·검증 경로', () => {
  assert.match(popover, /import \{ setIsCompositor, verifyUserBoolPropAfterSave \} from '@\/services\/userService'/);
  // 변경된 사용자만 PATCH.
  assert.match(popover, /changedUsers\.map\(\(u\) => setIsCompositor\(u\.id, selected\.has\(u\.id\)\)\)/);
  assert.match(popover, /verifyUserBoolPropAfterSave\(expectedIds, 'isCompositor'\)/);
  assert.match(popover, /setUsers\(fresh\)/);
  // verify 가 어긋나면 성공이라고 말하지 않고 재시도 가능 상태로 남는다.
  assert.match(popover, /if \(mismatched\)/);
  assert.match(popover, /return; \/\/ dirty 유지/);
  // 편집 중 외부 목록 갱신이 입력을 덮어쓰지 않는다.
  assert.match(popover, /if \(dirty\) return;/);
  // 저장 중에는 바깥 클릭·Esc 로 닫히지 않는다.
  assert.match(popover, /if \(saving\) return;/);
  assert.match(popover, /if \(e\.key !== 'Escape' \|\| saving\) return;/);
  // 여는 칩은 '바깥' 이 아니다 — mousedown(닫기) 이 click(토글) 보다 먼저 와서
  //   제외하지 않으면 칩을 다시 눌러도 닫혔다가 즉시 다시 열린다(프리뷰 실측으로 확인한 버그).
  assert.match(popover, /target\?\.closest\('\[data-compositor-chip\]'\)/);
  assert.match(header, /data-compositor-chip=""/);
});

test('팝오버: 저장 중 선택 잠금 + Esc 를 대시보드로 흘리지 않음 (코덱스 2차 P2)', () => {
  // 저장 중 토글하면 그 편집은 저장도 롤백도 안 된 채 창이 닫힌다 — 행 자체를 잠근다.
  assert.match(popover, /if \(saving\) return;\r?\n\s*setSelected/);
  assert.match(popover, /disabled=\{saving\}/);
  assert.match(popover, /disabled:cursor-not-allowed/);
  // Esc 는 여기서 소비 — document 버블이 window 보다 먼저라 막지 않으면
  //   대시보드가 씬 일괄 선택·핀까지 함께 해제한다.
  assert.match(popover, /e\.stopPropagation\(\);/);
  const dashboard = readFileSync('src/views/CompositingDashboardView.tsx', 'utf8');
  assert.match(dashboard, /window\.addEventListener\('keydown', onKey\)/);
  // 코덱스 3차 P2: 닫기 버튼도 같은 규칙 — 저장 중 닫히면 실패 때 선택 의도가 사라진다.
  assert.match(popover, /disabled=\{saving\}\r?\n\s*aria-label="닫기"/);
});

test('저장 중에는 여는 칩도 잠긴다 (코덱스 4차 P2)', () => {
  // 자식의 X·바깥클릭·Esc 를 다 막아도 부모 칩으로 닫으면 팝오버가 unmount 되어
  //   실패 시 선택 의도를 되살릴 수 없다 — saving 을 부모로 올려 칩까지 잠근다.
  assert.match(popover, /onSavingChange\?: \(saving: boolean\) => void/);
  assert.match(popover, /onSavingChange\?\.\(true\)/);
  assert.match(popover, /onSavingChange\?\.\(false\)/);
  // 어떤 경로로 사라져도 부모 잠금은 풀린다.
  assert.match(popover, /useEffect\(\(\) => \(\) => onSavingChange\?\.\(false\)/);
  assert.match(header, /const \[assignSaving, setAssignSaving\] = useState\(false\)/);
  assert.match(header, /if \(assignSaving\) return; setAssignOpen/);
  assert.match(header, /disabled=\{assignSaving\}/);
  assert.match(header, /onSavingChange=\{setAssignSaving\}/);
});

test('부분 저장을 숨기지 않는다 — allSettled + 항상 재조회 (코덱스 4차 P1)', () => {
  // 사용자별 개별 요청이라 일부만 커밋될 수 있다. 하나 실패했다고 곧장 catch 로 빠지면
  //   이미 저장된 쓰기가 남은 채 화면은 '실패' 만 말해 실제 DB 와 어긋난다.
  assert.doesNotMatch(popover, /await Promise\.all\(/);
  assert.match(popover, /await Promise\.allSettled\(/);
  assert.match(popover, /r\.status === 'rejected'/);
  // 성패와 무관하게 실제 상태를 다시 읽어 화면을 맞춘다.
  assert.match(popover, /const \{ fresh, mismatched, diff \} = await verifyUserBoolPropAfterSave/);
  assert.match(popover, /setUsers\(fresh\); \/\/ 부분 저장이든 아니든/);
  // 부분 실패는 성공으로 말하지 않고, 남은 것만 이어서 저장하도록 안내 + dirty 유지.
  assert.match(popover, /나머지는 반영됐고, 다시 저장하면 남은 것만 이어서 처리돼요/);
});

test('편집 권한은 기존 컴포지터 판정을 그대로 쓴다 (지정되면 컴포지팅 탭 수정 가능)', () => {
  // 지정 UI 를 옮겨도 권한 규칙 자체는 건드리지 않는다 — admin·배한솔 자동 권한 포함.
  assert.match(compositingLabels, /export function isCompositorForCompositing/);
  assert.match(compositingLabels, /if \(user\.isCompositor === true\) return true;/);
  assert.match(compositingLabels, /if \(user\.role === 'admin'\) return true;/);
  const dashboard = readFileSync('src/views/CompositingDashboardView.tsx', 'utf8');
  assert.match(dashboard, /isCompositorForCompositing\(currentUser\)/);
  const bulk = readFileSync('src/views/compositing-dashboard/BulkActionBar.tsx', 'utf8');
  assert.match(bulk, /disabled=\{!isCompositor\}/);
});
