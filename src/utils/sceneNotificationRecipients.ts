/**
 * v1.24.0 — 씬 댓글 자동 알림 대상 식별 헬퍼.
 *
 * 알림 대상 규칙:
 *   - @멘션: 텍스트 멘션된 사람 → 'mention' 타입 (강한 시각 신호)
 *   - 답글의 부모 작성자 → 'mention' 타입 (자동 멘션)
 *   - 씬의 BG/ACT 담당자 (양쪽 모두) → 'comment' 타입 (차분한 자동 알림)
 *   - 스레드 참여자 (해당 씬에 이전 댓글 단 사람) → 'comment' 타입
 *   - 작성자 본인 → 모든 분기에서 제외 (호출자가 user_id !== me.id 체크 후 호출)
 *
 * false-negative safe: 캐시 미스 시 false 반환 (잘못된 알림 발송 X, 일부 경우 알림 누락 가능).
 */

import { useDataStore } from '@/stores/useDataStore';
import { peekCachedComments, findCommentInCache } from '@/services/commentService';
import type { Scene } from '@/types';

/** "한솔, 다은" 또는 "한솔" 형태 assignee 문자열을 이름 배열로 분해. */
export function parseAssigneeList(assignee: string | undefined | null): string[] {
  if (!assignee) return [];
  return assignee
    .split(/[,、，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * BG↔ACT 같은 씬의 counterpart 부서 담당자 이름 수집.
 *
 * v1.24.0 P0 #3 fix: 같은 sceneId (예: 'a001') 가 EP01·EP02 양쪽에 흔하므로
 *   *반드시 같은 episode 안*에서만 매칭. 또한 BG↔ACT 부서쌍에 한정 (sheetName 접미사 _BG/_ACT 매칭) →
 *   _REF/_EFX 같은 제3 파트 매칭 차단.
 *
 * 알고리즘:
 *   1) 자기 씬이 속한 part 와 episode 식별 (ds.episodes 순회 1회).
 *   2) 같은 episode 의 part 중 sheetName 이 BG↔ACT counterpart 인 part 만 후보로 한정.
 *   3) 후보 part 의 scenes 에서 같은 sceneId (lowercase trim) 를 가진 씬의 assignee 수집.
 */
export function collectCounterpartAssigneeNames(scene: Scene): string[] {
  const sceneNumber = (scene.sceneId || '').trim().toLowerCase();
  if (!sceneNumber) return [];

  const ds = useDataStore.getState();
  // 1) 자기 씬의 episode + part 식별
  let myEpisodeIdx = -1;
  let mySheetName: string | null = null;
  outer: for (let i = 0; i < ds.episodes.length; i++) {
    const ep = ds.episodes[i];
    for (const part of ep.parts) {
      if (part.scenes.some((s) => s.id === scene.id)) {
        myEpisodeIdx = i;
        mySheetName = part.sheetName ?? null;
        break outer;
      }
    }
  }
  if (myEpisodeIdx < 0 || !mySheetName) return [];

  // 2) BG↔ACT counterpart sheetName 계산
  const counterpartSheetName = mySheetName.endsWith('_BG')
    ? mySheetName.slice(0, -3) + '_ACT'
    : mySheetName.endsWith('_ACT')
      ? mySheetName.slice(0, -4) + '_BG'
      : null;
  if (!counterpartSheetName) return [];

  // 3) 같은 episode 의 counterpart part 에서만 매칭
  const ep = ds.episodes[myEpisodeIdx];
  const counterpartPart = ep.parts.find((p) => p.sheetName === counterpartSheetName);
  if (!counterpartPart) return [];

  const names: string[] = [];
  for (const s of counterpartPart.scenes) {
    const sNumber = (s.sceneId || '').trim().toLowerCase();
    if (sNumber !== sceneNumber) continue;
    for (const name of parseAssigneeList(s.assignee)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * 부모 댓글이 특정 사용자가 쓴 것인지 확인 (답글 자동 멘션 판단).
 * 캐시 미스 시 false (false-negative safe).
 */
export function isCommentByUser(commentId: string, userId: string): boolean {
  const found = findCommentInCache(commentId);
  if (!found) return false;
  return found.userId === userId;
}

/**
 * 해당 씬에 자기가 이미 댓글을 단 적 있는지 (스레드 참여자 식별).
 * partUuid 와 scene.no 로 sceneKey 후보를 만들어 캐시 동기 조회.
 */
export function hasUserCommentedOnScene(
  partUuid: string | undefined | null,
  scene: Scene,
  userId: string,
): boolean {
  if (!partUuid) return false;
  const ds = useDataStore.getState();
  let sheetName: string | null = null;
  for (const ep of ds.episodes) {
    for (const part of ep.parts) {
      if (part.id === partUuid) {
        sheetName = part.sheetName ?? null;
        break;
      }
    }
    if (sheetName) break;
  }
  if (!sheetName) return false;
  const sceneKey = `${sheetName}:${scene.no}`;
  const cached = peekCachedComments(sceneKey);
  if (!cached) return false;
  return cached.some((c) => c.userId === userId);
}
