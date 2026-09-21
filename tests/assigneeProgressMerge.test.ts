// tests/assigneeProgressMerge.test.ts
// 같은 씬을 둘이 맡았을 때, 저장이 상대 기록을 지우지 않는지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeAssigneeProgressForWrite } from '../src/utils/assigneeProgressMerge.ts';

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
  // changedNames 인자 없이 호출하는 곳이 남아 있으면 안 된다.
  const calls = src.match(/writeAssigneeProgressMetadata\([^)]*\)/g) ?? [];
  const writeCalls = calls.filter((c) => c.includes(','));
  assert.ok(writeCalls.length >= 6, `호출부를 찾지 못했다 (${writeCalls.length})`);
  for (const call of writeCalls) {
    assert.equal(call.split(',').length >= 3, true, `changedNames 가 빠진 호출: ${call}`);
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

test('씬 단위 단계 토글도 담당자별 기록을 같이 맞춘다', () => {
  const actions = read('src/services/assigneeProgressActions.ts');
  assert.match(actions, /export function buildSceneStagePatchProgress/);
  assert.match(actions, /names\.includes\(actorName\)/, '본인이 담당자면 본인 항목만 바꿔야 한다');
  assert.match(actions, /updateAllAssigneeProgressEntries/, '담당자가 아니면 전원을 맞춘다');

  for (const path of [
    'src/components/widgets/my-tasks/hooks/useMyTasksData.ts',
    'src/views/compositing-dashboard/modal/CompositingSceneModal.tsx',
  ]) {
    const src = read(path);
    assert.match(src, /buildSceneStagePatchProgress\(/, `${path}: 씬 단위 토글이 담당자별 기록을 건너뛴다`);
    assert.match(src, /saveAssigneeProgress\(/, `${path}: 담당자별 기록 저장이 빠졌다`);
  }
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
