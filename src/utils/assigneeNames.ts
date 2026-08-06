/** 담당자 이름 문자열(쉼표 join) 파싱 — 순수 함수, node:test 직접 import 대상('@/' alias·외부 import 금지). */
export function parseAssigneeNames(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}
