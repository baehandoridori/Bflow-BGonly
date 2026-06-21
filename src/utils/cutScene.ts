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
 * sceneUuid 가 주어지면 같은 파트 내 sceneId 중복 row 를 정확히 구분하기 위해 Supabase UUID(s.id) 매칭을 우선한다.
 * uuid 미제공/미발견 시 기존 sceneId 매칭으로 폴백(구형 태그 호환).
 */
export function resolveSceneById(
  episodes: readonly EpisodeLike[],
  episodeNumber: number,
  partId: string,
  sceneId: string,
  sceneUuid?: string,
): (SceneLike & { department?: string }) | null {
  const ep = episodes.find((e) => e.episodeNumber === episodeNumber);
  if (!ep) return null;
  const wantPart = partId.toLowerCase();
  // sceneId 도 대소문자 무관 — BG 소문자 d001 / ACT 대문자 D001 처럼 부서별 케이스가 달라도 매칭되게.
  const wantScene = (sceneId || '').toLowerCase();
  const parts = ep.parts.filter((part) => part.partId.toLowerCase() === wantPart);
  // 찾은 파트의 부서도 함께 돌려준다(uuid 없는 Sheets/test 점프 폴백용, hashNavigation).
  const withDept = (part: PartLike, scene: SceneLike): SceneLike & { department?: string } =>
    part.department ? { ...scene, department: part.department } : scene;
  // 1) uuid 우선: 모든 (부서)파트를 먼저 훑는다 — 같은 partId 의 BG/ACT 가 같은 sceneId 를 가져도
  //    파트별 sceneId 폴백이 먼저 걸려 엉뚱한 부서 row 가 열리는 일을 막는다(코덱스 7차).
  if (sceneUuid) {
    for (const part of parts) {
      const scene = part.scenes.find((s) => s.id === sceneUuid);
      if (scene) return withDept(part, scene);
    }
  }
  // 2) sceneId 폴백(구형 태그·uuid 미발견): 첫 매치. 대소문자 무관.
  for (const part of parts) {
    const scene = part.scenes.find((s) => (s.sceneId || '').toLowerCase() === wantScene);
    if (scene) return withDept(part, scene);
  }
  return null;
}
