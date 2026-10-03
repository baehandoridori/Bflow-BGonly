/**
 * 실시간으로 들어온 씬 변경 중 '팀원이 실제로 바꾼 것'만 골라 카드 빛·이름표 신호로 바꾼다
 * (움직임 폴리싱 9번 teammate-live).
 *
 * - 보낸 사람이 없거나 나면 아무것도 하지 않는다 — 내가 바꾼 것은 빛나지 않는다
 *   (다른 PC 에서 같은 계정으로 바꾼 것도 나).
 * - 스토어에 이미 같은 값이면(내 낙관적 반영·같은 변경의 두 번째 경로) 아무것도 하지 않는다.
 *   그래서 반드시 스토어에 반영하기 '전에' 부른다.
 * - 기존 실시간 신호(scene-update / scene-phase-update / scenes UPDATE)만 쓴다. 새 테이블·권한 없음.
 *
 * node --test 가 그대로 import 하도록 스토어를 직접 읽지 않는다 — 호출하는 쪽이 문맥(ctx)을 넘긴다.
 */

import type { SceneFlashChange } from '../stores/sceneFlashStore.ts';
import type { Department, ScenePhaseState, Stage } from '../types/index.ts';

const STAGES: readonly Stage[] = ['lo', 'done', 'review', 'png'];

export interface RemoteSceneFlashScene {
  lo?: boolean;
  done?: boolean;
  review?: boolean;
  png?: boolean;
  sceneState?: ScenePhaseState | null;
  workRound?: number;
  feedbackRound?: number;
}

export interface RemoteSceneFlashContext {
  /** 지금 로그인한 사용자 id. 없으면 표시하지 않는다. */
  myId: string | null;
  /** 씬과 그 파트의 부서. 화면에 없는 씬이면 null. */
  findScene: (uuid: string) => { scene: RemoteSceneFlashScene; department: Department } | null;
  /** 보낸 사람 이름(이름표). 모르면 null — 링만 빛난다. */
  nameOf: (userId: string) => string | null;
}

export interface RemoteSceneFlashSignal {
  uuid: string;
  byName: string | null;
  changes: SceneFlashChange[];
}

/** 액팅 단계 이름 — 알림 문구와 같은 말. */
export function phaseFlashLabel(state: ScenePhaseState, workRound: number, feedbackRound: number): string {
  if (state === 'wait') return '대기';
  if (state === 'work') return `작업중 ${workRound}차`;
  if (state === 'feedback') return `피드백 대기 ${feedbackRound}차`;
  return '완료';
}

function resolveSender(ctx: RemoteSceneFlashContext, senderId: unknown): string | null | undefined {
  if (typeof senderId !== 'string' || !senderId) return undefined;
  if (!ctx.myId || senderId === ctx.myId) return undefined;
  return ctx.nameOf(senderId);
}

/**
 * 단계 체크 변경(한 개 또는 여러 개). patch 의 boolean 값만 본다.
 * 스토어 값과 다른 단계만 신호가 된다. 바뀐 게 없거나 내가 보낸 거면 null.
 */
export function remoteStageFlash(
  ctx: RemoteSceneFlashContext,
  uuid: string,
  senderId: unknown,
  patch: Readonly<Record<string, unknown>>,
): RemoteSceneFlashSignal | null {
  const byName = resolveSender(ctx, senderId);
  if (byName === undefined) return null;
  const found = ctx.findScene(uuid);
  if (!found) return null;
  const changes: SceneFlashChange[] = [];
  for (const stage of STAGES) {
    const value = patch[stage];
    if (typeof value !== 'boolean') continue;
    if (!!found.scene[stage] === value) continue;
    changes.push({ kind: 'stage', stage, value, department: found.department });
  }
  return changes.length > 0 ? { uuid, byName, changes } : null;
}

/** 액팅 단계(대기·작업중 N차·피드백 대기 N차·완료) 변경. 같으면 null. */
export function remotePhaseFlash(
  ctx: RemoteSceneFlashContext,
  uuid: string,
  senderId: unknown,
  next: { sceneState: ScenePhaseState; workRound: number; feedbackRound: number },
): RemoteSceneFlashSignal | null {
  const byName = resolveSender(ctx, senderId);
  if (byName === undefined) return null;
  const found = ctx.findScene(uuid);
  if (!found) return null;
  const { scene } = found;
  const same = (scene.sceneState ?? null) === next.sceneState
    && (scene.workRound ?? 0) === next.workRound
    && (scene.feedbackRound ?? 0) === next.feedbackRound;
  if (same) return null;
  return {
    uuid,
    byName,
    changes: [{ kind: 'phase', label: phaseFlashLabel(next.sceneState, next.workRound, next.feedbackRound) }],
  };
}
