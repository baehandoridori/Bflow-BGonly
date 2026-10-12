// node --test 가 직접 import 하는 순수 유틸 — 런타임 import 를 두지 말 것.

/**
 * 경로를 화면에 보일 두 줄로 나눈다 — 이름(마지막 마디)과 위치(그 앞 전부).
 * 경로 한 줄을 통째로 보이면 길 때 정작 폴더·파일 이름이 잘려 안 보인다.
 * 위치가 칸보다 길 때 어디를 줄일지는 보이는 쪽(PathLinkCard)이 정한다 — 이름에 가까운 쪽을 남기고 앞을 줄인다.
 */
export function splitPathForDisplay(path: string | null | undefined): { name: string; location: string } {
  const trimmed = (path ?? '').trim().replace(/[\\/]+$/, '');
  if (!trimmed) return { name: '', location: '' };
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return {
    name: trimmed.slice(cut + 1),
    // 이름 앞의 구분자는 떼어 낸다 — 구분자뿐이면(네트워크 경로의 앞머리 등) 위치가 없는 것이다.
    location: trimmed.slice(0, Math.max(cut, 0)).replace(/[\\/]+$/, ''),
  };
}
