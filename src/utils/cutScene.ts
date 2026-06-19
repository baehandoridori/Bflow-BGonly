/**
 * 같은 에피소드·파트 안에서 컷(=Scene.no) 번호로 씬을 찾는다(스펙 §10.2 4a — 씬·컷 점프).
 * 번호만으론 EP/파트 특정 불가하므로 호출 측이 episodeNumber+partId 컨텍스트를 준다.
 * 순수 함수 — node:test 검증. (Scene.no 가 문자열일 수 있어 Number() 비교)
 */
interface SceneLike { no: number | string; sceneId: string }
interface PartLike { partId: string; scenes: readonly SceneLike[] }
interface EpisodeLike { episodeNumber: number; parts: readonly PartLike[] }

export function resolveCutScene(
  episodes: readonly EpisodeLike[],
  episodeNumber: number,
  partId: string,
  cutNumber: number,
): SceneLike | null {
  const ep = episodes.find((e) => e.episodeNumber === episodeNumber);
  if (!ep) return null;
  // 같은 partId 가 BG/ACT 별도 Part 로 나뉠 수 있어(NewRevisionModal 도 union) 매칭 파트를 모두 순회한다.
  for (const part of ep.parts) {
    if (part.partId !== partId) continue;
    const scene = part.scenes.find((s) => Number(s.no) === cutNumber);
    if (scene) return scene;
  }
  return null;
}
