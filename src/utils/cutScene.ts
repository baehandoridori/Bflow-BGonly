/**
 * 같은 에피소드·파트 안에서 컷(=Scene.no) 번호로 씬을 찾는다(스펙 §10.2 4a — 씬·컷 점프).
 * 번호만으론 EP/파트 특정 불가하므로 호출 측이 episodeNumber+partId 컨텍스트를 준다.
 * 순수 함수 — node:test 검증. (Scene.no 가 문자열일 수 있어 Number() 비교)
 */
interface SceneLike { no: number | string; sceneId: string }
interface PartLike { partId: string; department?: string; scenes: readonly SceneLike[] }
interface EpisodeLike { episodeNumber: number; parts: readonly PartLike[] }

/**
 * department 지정 시(댓글 — 부서 정보 보존) 그 부서 Part 에서만 찾고,
 * 미지정 시(리테이크 — sceneKey 에 부서 없음) 같은 partId 의 모든 부서 Part 를 순회한다(첫 매칭).
 */
export function resolveCutScene(
  episodes: readonly EpisodeLike[],
  episodeNumber: number,
  partId: string,
  cutNumber: number,
  department?: 'bg' | 'acting',
): SceneLike | null {
  const ep = episodes.find((e) => e.episodeNumber === episodeNumber);
  if (!ep) return null;
  const wantPart = partId.toLowerCase();
  for (const part of ep.parts) {
    if (part.partId.toLowerCase() !== wantPart) continue; // partId 대소문자 무관(소문자 acting 파트 지원)
    if (department && part.department !== department) continue; // 부서 지정 시 그 부서만
    const scene = part.scenes.find((s) => Number(s.no) === cutNumber);
    if (scene) return scene;
  }
  return null;
}
