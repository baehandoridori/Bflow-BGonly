/**
 * 에피소드 기본 표시 이름.
 *
 * 에피소드 제목은 `episodes.title` 컬럼이 아니라 metadata(type='episode-title')에 저장된다.
 * 그래서 새로 만든 에피소드는 `episodes.title` 이 비어 있고, 커스텀 제목을 붙이기 전까지는
 * 폴백 이름으로 표시돼야 한다. 폴백이 빈 문자열이면 트리에 이름 없는 줄이 생긴다.
 */
export function defaultEpisodeTitle(episodeNumber: number): string {
  return `EP.${String(episodeNumber).padStart(2, '0')}`;
}
