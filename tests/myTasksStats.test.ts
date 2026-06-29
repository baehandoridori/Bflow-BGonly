import test from 'node:test';
import assert from 'node:assert/strict';

import { computeMyTasksStats } from '../src/components/widgets/my-tasks/statsUtils.ts';
import type { FlatScene, PersonalTodo } from '../src/components/widgets/my-tasks/types.ts';

/** 단계/completedAt 만 지정해 FlatScene mock 을 만든다(나머지 필드는 산식에 무관). */
function flat(
  sceneId: string,
  stages: { lo?: boolean; done?: boolean; review?: boolean; png?: boolean },
  completedAt?: string,
  assignee = '',
): FlatScene {
  return {
    scene: {
      sceneId,
      lo: !!stages.lo,
      done: !!stages.done,
      review: !!stages.review,
      png: !!stages.png,
      completedAt,
      assignee,
    },
    sheetName: 'EP01_a',
    sceneIndex: 0,
    episodeNumber: 1,
    partId: 'a',
    department: 'bg',
    key: `EP01_a:${sceneId}`,
  } as unknown as FlatScene;
}

function todo(completed: boolean): PersonalTodo {
  return { id: `t_${Math.random()}`, title: 't', memo: '', completed, createdAt: '' };
}

const NOW = new Date('2026-06-30T10:00:00+09:00');

test('빈 상태(씬 0·개인 0)는 0으로 안전하게 떨어진다', () => {
  const s = computeMyTasksStats([], [], NOW);
  assert.equal(s.sceneTotal, 0);
  assert.equal(s.stageProgressPct, 0);
  assert.equal(s.pct, 0);
  assert.equal(s.doneSceneCount, 0);
  assert.equal(s.todayCompletedScenes, 0);
});

test('씬 0개 + 개인 할일만 있어도 개인 진행률이 반영된다', () => {
  const s = computeMyTasksStats([], [todo(true), todo(false)], NOW);
  assert.equal(s.sceneTotal, 0);
  assert.equal(s.personalTotal, 2);
  assert.equal(s.fullyDone, 1);
  assert.equal(s.total, 2);
  assert.equal(s.pct, 50); // 개인 2개 중 1개 완료 = 50%
  assert.equal(s.stageProgressPct, 0); // 씬 0개라 도넛 채움은 0
});

test('단계 누적 카운트와 stageProgressPct 산식', () => {
  // 씬 2개: A=lo+done(2/4), B=lo(1/4) → 체크 3/8 = 37.5%
  const scenes = [
    flat('a001', { lo: true, done: true }),
    flat('a002', { lo: true }),
  ];
  const s = computeMyTasksStats(scenes, [], NOW);
  assert.deepEqual(s.stageCounts, { lo: 2, done: 1, review: 0, png: 0 });
  assert.equal(s.sceneTotal, 2);
  assert.equal(s.doneSceneCount, 0);
  assert.equal(s.pendingSceneCount, 2);
  assert.equal(s.stageProgressPct, 37.5);
});

test('완전 완료 씬 카운트', () => {
  const scenes = [
    flat('a001', { lo: true, done: true, review: true, png: true }),
    flat('a002', { lo: true }),
  ];
  const s = computeMyTasksStats(scenes, [], NOW);
  assert.equal(s.doneSceneCount, 1);
  assert.equal(s.pendingSceneCount, 1);
});

test('오늘 마친 씬: completedAt 오늘만 카운트, falsy/Invalid/타일 제외', () => {
  const full = { lo: true, done: true, review: true, png: true };
  const scenes = [
    flat('a001', full, '2026-06-30T01:00:00+09:00'), // 오늘
    flat('a002', full, '2026-06-29T23:00:00+09:00'), // 어제
    flat('a003', full, ''),                          // 미기록(레거시) → 제외
    flat('a004', full, 'not-a-date'),                // Invalid → 제외
    flat('a005', { lo: true }),                      // 미완료 → 애초에 제외
  ];
  const s = computeMyTasksStats(scenes, [], NOW);
  assert.equal(s.doneSceneCount, 4);
  assert.equal(s.todayCompletedScenes, 1);
});
