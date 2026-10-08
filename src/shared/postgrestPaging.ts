/**
 * PostgREST 1000행 캡 회피용 공통 페이지네이션 (project_postgrest_1000_row_cap).
 *
 * Supabase(PostgREST)는 한 응답을 기본 1000행으로 잘라서 돌려준다. 잘렸다는 신호는 따로 없고
 * 에러도 아니라서, 1000행을 넘긴 테이블을 단일 select 로 읽으면 뒤쪽 행이 "조용히" 사라진다.
 * 그 결과가 사용자 눈에는 "저장했는데 되돌아온다"로 보인다.
 *
 * 호출자는 한 페이지를 가져오는 방법만 넘기고, 끝까지 받아오는 일은 이 헬퍼가 맡는다.
 * 페이지 경계에서 행이 밀리거나 중복되지 않도록, fetchPage 안의 쿼리는 반드시 고유키로 정렬해야 한다.
 */

export const POSTGREST_PAGE_SIZE = 1000;

/**
 * `fetchPage(from, to)`(양끝 포함 range)를 빈 페이지가 나올 때까지 반복 호출해 전량을 모은다.
 *
 * 다음 오프셋은 "요청한 페이지 크기"가 아니라 "실제로 받은 행 수"만큼 전진한다.
 * 서버가 요청보다 적게 주더라도(PostgREST 의 max-rows 가 pageSize 보다 작은 경우)
 * 거기서 끊지 않고 이어 받기 때문에, 고치려던 바로 그 '조용한 잘림'이 되살아나지 않는다.
 * 대신 마지막에 빈 페이지를 한 번 더 받고 끝낸다.
 */
export async function collectAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize: number = POSTGREST_PAGE_SIZE,
): Promise<T[]> {
  // pageSize 가 1 미만이면 요청 구간이 성립하지 않는다. 조용히 도는 대신 즉시 실패시킨다.
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`collectAllPages: pageSize 는 1 이상의 정수여야 합니다 (받은 값: ${pageSize})`);
  }
  const all: T[] = [];
  for (let from = 0; ;) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.length === 0) return all;
    all.push(...page);
    from += page.length;
  }
}

/**
 * 커서(keyset) 페이지네이션 — `fetchAfter(마지막으로 받은 키, 페이지 크기)` 를 빈 페이지까지 반복 호출한다.
 *
 * offset 방식(`collectAllPages`)은 두 가지 경우에 경계 행을 놓친다:
 *  1. 정렬키가 고유하지 않을 때. 같은 값이 여러 행에 있으면 DB 가 그 안의 순서를 보장하지 않아
 *     페이지가 바뀌는 지점에서 행이 중복되거나 통째로 빠진다. 실제로 scene_work_links 는 379행
 *     전부가 sort_order=0 이고, character_costume_images 는 196행 중 183행이 sort_order=0 이다.
 *  2. 페이지와 페이지 사이에 다른 사람이 행을 지웠을 때. 뒤쪽 행이 앞으로 당겨지면서
 *     다음 offset 이 그 행들을 건너뛴다.
 *
 * 고유키(id) 로 정렬하고 "마지막으로 본 키보다 큰 것"만 요청하면 둘 다 원천적으로 사라진다.
 * 표시 순서가 따로 필요하면 전량을 받은 뒤 호출자가 정렬한다 — 전량 로드라 비용 차이가 없고,
 * 그쪽이 DB 의 비결정적 순서에 기대는 것보다 결과가 안정적이다.
 *
 * `keyOf` 가 돌려주는 키는 정렬 기준과 같아야 하고 페이지마다 반드시 증가해야 한다.
 * 증가하지 않으면 같은 페이지를 무한히 받게 되므로, 조용히 도는 대신 즉시 실패시킨다.
 */
export async function collectAllPagesByKey<T>(
  fetchAfter: (afterKey: string | null, limit: number) => Promise<T[]>,
  keyOf: (row: T) => string,
  pageSize: number = POSTGREST_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error(`collectAllPagesByKey: pageSize 는 1 이상의 정수여야 합니다 (받은 값: ${pageSize})`);
  }
  const all: T[] = [];
  let afterKey: string | null = null;
  for (;;) {
    const page = await fetchAfter(afterKey, pageSize);
    if (page.length === 0) return all;
    all.push(...page);
    const nextKey = keyOf(page[page.length - 1]);
    if (typeof nextKey !== 'string' || nextKey === '' || (afterKey !== null && nextKey <= afterKey)) {
      throw new Error('collectAllPagesByKey: 페이지 커서가 전진하지 않았습니다 (정렬키가 고유한지 확인하세요).');
    }
    afterKey = nextKey;
  }
}

/**
 * `.in(...)` 조회에 넣을 id 묶음 크기.
 *
 * PostgREST 는 GET 쿼리스트링으로 필터를 받는데, UUID 36자 + 구분자를 N개 이어 붙이면
 * 금방 URL 길이 한계(대략 2~4KB)에 부딪혀 400 이 난다. 100개면 약 3.7KB 로 그 아래에 머문다.
 * 한 응답의 1000행 캡보다 이 URL 한계가 먼저 걸리므로, 묶음 크기는 여기에 맞춘다.
 * (electron/supabase.ts 의 metadata 완료기록 조회가 쓰던 값과 같다.)
 */
export const POSTGREST_IN_CHUNK_SIZE = 100;

/** 긴 id 목록을 `.in()` 한 번에 넣어도 안전한 크기로 자른다. 빈 목록이면 빈 배열. */
export function chunkForInQuery<T>(items: readonly T[], size: number = POSTGREST_IN_CHUNK_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunkForInQuery: size 는 1 이상의 정수여야 합니다 (받은 값: ${size})`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
