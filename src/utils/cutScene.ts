/**
 * sceneId 로 같은 에피소드·파트 안의 씬을 찾는다(4c #씬 태그 점프).
 * 번호만으론 EP/파트 특정 불가하므로 호출 측이 episodeNumber+partId 컨텍스트를 준다.
 * 순수 함수 — node:test 검증.
 */
interface SceneLike { no: number | string; sceneId: string; id?: string }
interface PartLike { partId: string; department?: string; scenes: readonly SceneLike[] }
interface EpisodeLike { episodeNumber: number; parts: readonly PartLike[] }

/**
 * sceneId 로 같은 EP·파트의 씬을 찾는다(4c #씬 태그 점프). 화 간 sceneId 중복은 episodeNumber+partId 로 한정.
 * partId 대소문자 무관. 모든 (부서)파트 순회 — sceneId 는 보통 부서 무관 동일.
 */
export function resolveSceneById(
  episodes: readonly EpisodeLike[],
  episodeNumber: number,
  partId: string,
  sceneId: string,
): SceneLike | null {
  const ep = episodes.find((e) => e.episodeNumber === episodeNumber);
  if (!ep) return null;
  const wantPart = partId.toLowerCase();
  for (const part of ep.parts) {
    if (part.partId.toLowerCase() !== wantPart) continue;
    const scene = part.scenes.find((s) => s.sceneId === sceneId);
    if (scene) return scene;
  }
  return null;
}
