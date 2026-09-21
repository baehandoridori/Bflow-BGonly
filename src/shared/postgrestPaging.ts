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
