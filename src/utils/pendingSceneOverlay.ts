/* ═══════════════════════════════════════════════════════════════
   저장을 기다리는 씬 값 지키기 (움직임 폴리싱 20번 safety-net — 한솔 결정 2026-10-03)

   단계 체크 저장이 실패해 자동으로 다시 보내는 동안, 받아오기(15초 주기·직접 새로고침·실시간 재로드·재연결 따라잡기)는
   아직 내 변경을 모르는 서버 값을 읽어 와 씬 목록 전체를 바꿔 끼운다. 그대로 두면 켜 둔 체크가 풀리고, 다시 보내기
   직전에는 '내 값이 아니다'로 보여 재전송도 멈춘다.

   그래서 받아오기 결과를 스토어에 넣기 직전에, 저장을 기다리는 칸 묶음마다 reapply 를 불러 내 값을 다시 얹는다.
   reapply 는 받아온 값이 처음 값(내 클릭 전 값)일 때만 패치를 돌려준다 — 처음 값도 내 값도 아니면 그대로 둔다.
   팀원의 실시간 변경(씬 하나씩 바로 반영)은 이 길을 거치지 않는다.

   node --test 가 그대로 import 하도록 @/ 별칭·외부 패키지를 쓰지 않는다.
   ═══════════════════════════════════════════════════════════════ */

import type { Episode, Scene } from '../types';

export interface PendingSceneOverlay {
  sceneUuid: string;
  /** 받아온 씬 값 위에 다시 얹을 내 값. 얹을 것이 없으면 null. */
  reapply(incoming: Scene): Partial<Scene> | null;
}

/** 저장을 기다리는 씬에만 내 값을 다시 얹는다. 바뀐 가지만 새로 만들고, 바뀐 것이 없으면 받은 배열을 그대로 돌려준다. */
export function overlayPendingScenes(episodes: Episode[], overlays: Iterable<PendingSceneOverlay>): Episode[] {
  const byScene = new Map<string, PendingSceneOverlay[]>();
  for (const overlay of overlays) {
    const list = byScene.get(overlay.sceneUuid);
    if (list) list.push(overlay);
    else byScene.set(overlay.sceneUuid, [overlay]);
  }
  if (byScene.size === 0) return episodes;

  let changedAny = false;
  const next = episodes.map((episode) => {
    let episodeChanged = false;
    const parts = episode.parts.map((part) => {
      let partChanged = false;
      const scenes = part.scenes.map((scene) => {
        const list = scene.id ? byScene.get(scene.id) : undefined;
        if (!list) return scene;
        let current = scene;
        for (const overlay of list) {
          const patch = overlay.reapply(current);
          if (patch && Object.keys(patch).length > 0) current = { ...current, ...patch };
        }
        if (current !== scene) partChanged = true;
        return current;
      });
      if (!partChanged) return part;
      episodeChanged = true;
      return { ...part, scenes };
    });
    if (!episodeChanged) return episode;
    changedAny = true;
    return { ...episode, parts };
  });
  return changedAny ? next : episodes;
}
