/**
 * 팀원 짬순(입사일 순) 정렬 기준
 *
 * 입사일 데이터가 아직 시스템에 없어서 이름 기반 하드코딩 순서로 관리.
 * 배열 앞쪽일수록 선임(짬 많음). 목록에 없는 이름은 맨 뒤로.
 */
export const SENIORITY_ORDER: readonly string[] = [
  '안류천',
  '윤성원',
  '허혜원',
  '박정인',
  '지정민',
  '원동우',
  '강선영',
  '이혜민',
  '이명훈',
  '배한솔',
  '이다은',
  '김어진',
  '류이레',
  '류성철',
  '이승은',
];

/** 이름의 짬순 인덱스 (0=가장 선임). 목록에 없으면 SENIORITY_ORDER.length 반환. */
export function getSeniorityIndex(name: string): number {
  const idx = SENIORITY_ORDER.indexOf(name);
  return idx === -1 ? SENIORITY_ORDER.length : idx;
}
