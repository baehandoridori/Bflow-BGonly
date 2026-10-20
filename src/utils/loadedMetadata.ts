// ─── 전체 메타데이터 한 번으로 씬 완료 기록 · 에피소드 제목/메모 고르기 ──────────────
// 전부 다시 받기 한 번에 metadata 를 세 번 읽던 것을 한 번으로 줄였다 (2026-10-20 서버 신호 줄이기):
//   ① 씬 완료 기록을 씬 100개씩 끊어 약 30번 ② 담당자별 진행용 전체 읽기 ③ 제목·메모용 전체 읽기.
// 이제 전체 메타 목록을 한 번 읽고 아래에서 골라 쓴다. node --test 가 import 하므로 런타임 의존이 없다.

import type { Episode } from '../types';

export const SCENE_COMPLETION_META_TYPE = 'scene-completion';

type MetadataRow = { type: string; key: string; value?: string | null };
type SceneCompletion = { completedBy: string; completedAt: string };

export function parseSceneCompletionMeta(value: string | null | undefined): SceneCompletion | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { completedBy?: unknown; completedAt?: unknown };
    if (typeof parsed.completedBy !== 'string' || typeof parsed.completedAt !== 'string') return null;
    if (!parsed.completedBy || !parsed.completedAt) return null;
    return { completedBy: parsed.completedBy, completedAt: parsed.completedAt };
  } catch {
    return null;
  }
}

/** 씬 완료 기록(누가·언제 모든 단계를 끝냈나)을 씬에 붙인다. 기록이 없거나 깨진 씬은 그대로 둔다. */
export function applySceneCompletionMetadata(
  episodes: Episode[],
  metadata: ReadonlyArray<MetadataRow>,
): Episode[] {
  const completionBySceneUuid = new Map<string, SceneCompletion>();
  for (const row of metadata) {
    if (row.type !== SCENE_COMPLETION_META_TYPE) continue;
    const completion = parseSceneCompletionMeta(row.value);
    if (completion) completionBySceneUuid.set(row.key, completion);
  }
  if (completionBySceneUuid.size === 0) return episodes;
  return episodes.map((ep) => ({
    ...ep,
    parts: ep.parts.map((part) => ({
      ...part,
      scenes: part.scenes.map((scene) => {
        const completion = scene.id ? completionBySceneUuid.get(scene.id) : undefined;
        return completion ? { ...completion, ...scene } : scene;
      }),
    })),
  }));
}

/** 에피소드 번호 → 사용자가 붙인 제목·메모. 빈 값은 넣지 않는다. */
export function episodeLabelsFromMetadata(metadata: ReadonlyArray<MetadataRow>): {
  titles: Record<number, string>;
  memos: Record<number, string>;
} {
  const titles: Record<number, string> = {};
  const memos: Record<number, string> = {};
  for (const row of metadata) {
    if (row.type === 'episode-title' && row.value) titles[Number(row.key)] = row.value;
    if (row.type === 'episode-memo' && row.value) memos[Number(row.key)] = row.value;
  }
  return { titles, memos };
}
