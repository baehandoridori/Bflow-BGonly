// tests/assigneeProgressMerge.test.ts
// 같은 씬을 둘이 맡았을 때, 저장이 상대 기록을 지우지 않는지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeAssigneeProgressForWrite } from '../src/utils/assigneeProgressMerge.ts';
import { deriveActingPhaseFromStages } from '../src/utils/sceneStageProgression.ts';

const wait = { lo: false, done: false, review: false, png: false, sceneState: null, workRound: 0, feedbackRound: 0 };
const work = { lo: true, done: true, review: false, png: false, sceneState: 'work' as const, workRound: 1, feedbackRound: 0 };
const feedback = { lo: true, done: true, review: true, png: false, sceneState: 'feedback' as const, workRound: 1, feedbackRound: 1 };

test('상대가 먼저 저장한 값은 내 스냅샷이 옛것이어도 살아남는다', () => {
  // 강선영이 먼저 feedback 으로 올렸는데, 박정인 화면은 아직 그걸 못 받은 상태.
  const server = { 강선영: feedback, 박정인: wait };
  const localStale = { 강선영: wait, 박정인: work };

  const merged = mergeAssigneeProgressForWrite(server, localStale, ['박정인']);

  assert.deepEqual(merged.강선영, feedback, '내가 건드리지 않은 담당자는 서버 값이 이겨야 한다');
  assert.deepEqual(merged.박정인, work, '내가 바꾼 담당자는 내 값이 이겨야 한다');
});

test('서버 행이 아직 없으면 로컬 값을 그대로 저장한다', () => {
  const local = { 강선영: wait, 박정인: work };
  assert.deepEqual(mergeAssigneeProgressForWrite(null, local, ['박정인']), local);
  assert.deepEqual(mergeAssigneeProgressForWrite(undefined, local, ['박정인']), local);
  assert.deepEqual(mergeAssigneeProgressForWrite({}, local, ['박정인']), local);
});

test('담당자 목록에서 빠진 사람의 서버 기록도 지우지 않는다', () => {
  // 담당자 칸을 편집하는 중 로컬 맵에서 류성철이 사라져도 서버 기록은 보존돼야 한다.
  const server = { 강선영: feedback, 류성철: work };
  const local = { 강선영: work };

  const merged = mergeAssigneeProgressForWrite(server, local, ['강선영']);

  assert.deepEqual(merged.류성철, work, '목록에 없는 담당자 기록이 사라지면 복구할 방법이 없다');
  assert.deepEqual(merged.강선영, work);
});

test('여러 담당자를 한 번에 바꾸면(씬 단위 토글) 그 전원이 내 값으로 저장된다', () => {
  const server = { 강선영: feedback, 박정인: feedback };
  const local = { 강선영: work, 박정인: work };

  const merged = mergeAssigneeProgressForWrite(server, local, ['강선영', '박정인']);

  assert.deepEqual(merged, local);
});

test('changedNames 에 있어도 로컬에 항목이 없으면 서버 값을 지우지 않는다', () => {
  const server = { 강선영: feedback };
  const merged = mergeAssigneeProgressForWrite(server, {}, ['강선영', '없는사람']);
  assert.deepEqual(merged, server);
});

test('입력 맵을 변형하지 않는다', () => {
  const server = { 강선영: feedback };
  const local = { 강선영: work, 박정인: work };
  const serverCopy = JSON.parse(JSON.stringify(server));
  const localCopy = JSON.parse(JSON.stringify(local));
  mergeAssigneeProgressForWrite(server, local, ['박정인']);
  assert.deepEqual(server, serverCopy);
  assert.deepEqual(local, localCopy);
});

/* ─── 액팅 단계 역산 ───────────────────────────────────── */

const stages = (lo: boolean, done: boolean, review: boolean, png: boolean) => ({ lo, done, review, png });

test('액팅: 체크 4개에서 단계 상태를 역산한다', () => {
  const none = { sceneState: null, workRound: 0, feedbackRound: 0 };
  assert.deepEqual(deriveActingPhaseFromStages(none, stages(false, false, false, false)), { state: 'wait', workRound: 0, feedbackRound: 0 });
  assert.deepEqual(deriveActingPhaseFromStages(none, stages(true, true, false, false)), { state: 'work', workRound: 1, feedbackRound: 0 });
  assert.deepEqual(deriveActingPhaseFromStages(none, stages(true, true, true, false)), { state: 'feedback', workRound: 0, feedbackRound: 1 });
  assert.deepEqual(deriveActingPhaseFromStages(none, stages(true, true, true, true)), { state: 'done', workRound: 0, feedbackRound: 0 });
  // 가장 앞선 체크가 단계를 결정한다 — PNG 만 켜져 있어도 완료.
  assert.equal(deriveActingPhaseFromStages(none, stages(false, false, false, true)).state, 'done');
});

test('액팅: 같은 단계에 머물면 차수를 유지하고, 단계가 바뀌면 1차부터', () => {
  assert.deepEqual(
    deriveActingPhaseFromStages({ sceneState: 'work', workRound: 3, feedbackRound: 0 }, stages(true, true, false, false)),
    { state: 'work', workRound: 3, feedbackRound: 0 },
  );
  // 단계가 바뀌면 이전 차수가 아무리 높아도 1차부터 — 이전 차수를 그대로 끌고 오면 안 된다.
  assert.deepEqual(
    deriveActingPhaseFromStages({ sceneState: 'feedback', workRound: 4, feedbackRound: 2 }, stages(true, true, false, false)),
    { state: 'work', workRound: 1, feedbackRound: 0 },
  );
  assert.deepEqual(
    deriveActingPhaseFromStages({ sceneState: 'work', workRound: 3, feedbackRound: 5 }, stages(true, true, true, false)),
    { state: 'feedback', workRound: 0, feedbackRound: 1 },
  );
  assert.deepEqual(
    deriveActingPhaseFromStages({ sceneState: 'feedback', workRound: 0, feedbackRound: 2 }, stages(true, true, true, false)),
    { state: 'feedback', workRound: 0, feedbackRound: 2 },
  );
  // 차수가 비어 있거나 0 이어도 최소 1차로 올라온다.
  assert.equal(deriveActingPhaseFromStages({ sceneState: 'work', workRound: 0, feedbackRound: 0 }, stages(true, true, false, false)).workRound, 1);
  assert.equal(deriveActingPhaseFromStages({ sceneState: 'work' }, stages(true, true, false, false)).workRound, 1);
  // 대기/완료로 가면 차수는 리셋.
  assert.deepEqual(
    deriveActingPhaseFromStages({ sceneState: 'work', workRound: 5, feedbackRound: 0 }, stages(false, false, false, false)),
    { state: 'wait', workRound: 0, feedbackRound: 0 },
  );
});

/* ─── 쓰기 경로가 실제로 병합 저장을 쓰는지 ─────────────────── */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('담당자별 진행 저장은 서버 정본을 다시 읽어 병합한다', () => {
  const src = read('src/services/assigneeProgressActions.ts');
  assert.match(src, /readMetadata\(SCENE_ASSIGNEE_PROGRESS_META_TYPE, sceneUuid\)/, '저장 전 서버 행을 읽어야 한다');
  assert.match(src, /mergeAssigneeProgressForWrite\(serverProgress, localProgress, changedNames\)/);
  assert.match(src, /writeMetadata\(SCENE_ASSIGNEE_PROGRESS_META_TYPE, sceneUuid, serializeAssigneeProgress\(merged\)\)/);
  assert.match(src, /return merged;/, '저장된 맵을 돌려줘야 호출자가 화면을 맞출 수 있다');
});

test('ScenesView 의 담당자별 진행 저장은 통째 덮어쓰기로 되돌아가지 않았다', () => {
  const src = read('src/views/ScenesView.tsx');
  assert.match(src, /saveAssigneeProgress\(sceneUuid, progress, changedNames\)/, '큐 안에서 병합 저장을 써야 한다');
  assert.match(src, /saveAssigneeProgress\(sceneUuid, nextProgress, \[assigneeName\]\)/, '담당자 1명 토글은 그 담당자만 바꿔야 한다');
  assert.doesNotMatch(
    src,
    /writeMetadata\(\s*SCENE_ASSIGNEE_PROGRESS_META_TYPE/,
    '담당자별 진행을 병합 없이 직접 저장하면 상대 변경이 사라진다',
  );
  // 호출부가 changedNames 를 실제로 채워 넘기는지 — 빈 배열이면 병합이 아무것도 안 바꾼다.
  const writeCalls = (src.match(/await writeAssigneeProgressMetadata\((?:[^()]|\([^()]*\))*\)/g) ?? [])
    .filter((c) => !c.includes('(sceneUuid: string'));
  assert.ok(writeCalls.length >= 6, `호출부를 찾지 못했다 (${writeCalls.length})`);
  for (const call of writeCalls) {
    assert.match(
      call,
      /,\s*Object\.keys\([A-Za-z.]+\)\)$/,
      `changedNames 가 비었거나 빠진 호출 — 병합이 아무것도 반영하지 않는다: ${call}`,
    );
  }
});

test('담당자가 한 명 이하이면 담당자별 진행을 저장하지 않는다', () => {
  const src = read('src/views/ScenesView.tsx');
  assert.match(
    src,
    /if \(!hasMultiAssigneeProgress\(scene\)\) return;/,
    '담당자 편집 중 한 명으로 보이는 순간 저장하면 상대 기록이 지워진다',
  );
});

test('다중 담당 씬의 공통 단계 칩은 어느 화면에서도 저장하지 않는다', () => {
  // 공통 칩은 담당자 전원의 AND(액팅은 최저 단계)라 개인 체크박스가 아니다.
  //  - 누른 사람 것만 바꾸면 공통값이 안 움직여 재조회 때 그대로 되돌아간다.
  //  - 전원을 맞추면 나보다 앞서간 사람의 기록을 끌어내린다(서버까지 덮어씀).
  // 그래서 씬 뷰처럼 편집은 담당자별 줄에서만 하고, 여기서는 읽기 전용으로 둔다.
  for (const path of [
    'src/components/widgets/my-tasks/hooks/useMyTasksData.ts',
    'src/views/compositing-dashboard/modal/CompositingSceneModal.tsx',
  ]) {
    const src = read(path);
    assert.match(
      src,
      /if \(hasMultiAssigneeProgress\((?:scene|sc)\)\) \{/,
      `${path}: 다중 담당 씬에서 공통 칩 저장을 막는 가드가 없다`,
    );
    assert.match(src, /담당자가 둘 이상인 씬은 씬 목록에서 담당자별로 체크해주세요/, `${path}: 어디서 바꿔야 하는지 안내가 없다`);
    assert.doesNotMatch(src, /saveAssigneeProgress\(/, `${path}: 공통 칩에서 담당자별 기록을 저장하면 안 된다`);
    assert.doesNotMatch(src, /buildSceneStagePatchProgress/, `${path}: 공통 칩 → 담당자별 기록 변환 경로가 남아 있다`);
  }
  // 불온전한 헬퍼 자체가 남아 있으면 안 된다.
  const actions = read('src/services/assigneeProgressActions.ts');
  assert.doesNotMatch(actions, /buildSceneStagePatchProgress/);
});

test('나의 할 일 칩은 다중 담당 씬에서 눌리지 않는다', () => {
  const chips = read('src/components/widgets/my-tasks/components/StageChips.tsx');
  assert.match(chips, /const readOnly = hasMultiAssigneeProgress\(scene\);/);
  assert.match(chips, /disabled=\{readOnly\}/, '눌러도 아무 일이 없는 칩은 두지 않는다');
  assert.match(chips, /if \(!readOnly\) onToggleStage\(stage\)/);
  assert.match(chips, /담당자가 둘 이상인 씬이에요/, '왜 못 누르는지 알려줘야 한다');
});

test('씬 뷰는 다중 담당 씬에서 공통 칩 대신 담당자별 줄을 보여준다 (이 규칙의 근거)', () => {
  const modal = read('src/components/scenes/UnifiedSceneDetailModal.tsx');
  assert.match(modal, /const canUseAssigneeProgressStack = hasMultiAssigneeProgress\(scene\) && \(/);
});

test('씬 뷰와 씬 단위 토글이 같은 액팅 단계 역산을 쓴다', () => {
  const scenesView = read('src/views/ScenesView.tsx');
  assert.match(scenesView, /actingPhaseSync = deriveActingPhaseFromStages\(scene, stagePatch\)/);
  // 역산 로직이 두 벌로 갈라지면 화면마다 차수가 달라진다.
  assert.doesNotMatch(scenesView, /stagePatch\.png \? 'done'/, '역산 로직이 ScenesView 에 다시 복제됐다');
});

test('완료 도장은 병합 결과와 어긋나면 찍지 않는다', () => {
  const src = read('src/views/ScenesView.tsx');
  assert.match(src, /const completionStillHolds = !completionMeta \|\| mergedFullyDone === willBeFullyDone;/);
  assert.match(src, /if \(completionMeta && completionStillHolds\) \{/, '조건 없이 완료 메타를 쓰면 미완료 씬에 완료자가 남는다');
  assert.match(src, /completedBy: prevCompletedBy, completedAt: prevCompletedAt/, '도장을 건너뛰면 화면도 되돌려야 한다');
});

test('에피소드 이름 저장 실패는 롤백하고 알린다', () => {
  const src = read('src/views/ScenesView.tsx');
  const start = src.indexOf('const handleSaveEpEdit');
  assert.notEqual(start, -1);
  const body = src.slice(start, src.indexOf('\n  const ', start + 1));
  assert.match(body, /Promise\.allSettled/, '제목과 메모는 한쪽이 실패해도 다른 쪽을 시도해야 한다');
  assert.match(body, /setEpisodeTitles\(prevTitles\)/, '실패하면 화면도 되돌려야 한다');
  assert.match(body, /setEpisodeMemos\(prevMemos\)/);
  assert.match(body, /sonnerToast\.error/, '조용히 삼키면 "수정이 안 먹는다"로만 보인다');
});
