// 정본 일정 목록을 다시 받을 때, 내용이 같은 일정은 이전 객체를 그대로 재사용한다.
// node --test 가 직접 import 하는 모듈: @/ alias·외부 의존 금지.

import type { CalendarEvent } from '../types/calendar';
import { calendarEventIdentityKey } from './calendarEventIdentity.ts';

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** 일정 객체는 JSON 형태의 순수 데이터다. 키·값을 끝까지 비교한다. */
function isSameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  // Date·Map 같은 특수 객체는 키 비교로 같다고 볼 수 없다. 참조가 다르면 다른 값이다.
  if (!Array.isArray(left) && (!isPlainObject(left) || !isPlainObject(right))) return false;
  if (Array.isArray(left)) {
    const rightArray = right as unknown[];
    if (left.length !== rightArray.length) return false;
    return left.every((item, index) => isSameValue(item, rightArray[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined);
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => isSameValue(leftRecord[key], rightRecord[key]));
}

export function isSameCalendarEventContent(left: CalendarEvent, right: CalendarEvent): boolean {
  return isSameValue(left, right);
}

/**
 * 기간을 넘길 때마다 정본 캐시는 내용이 같아도 새 객체를 만든다. 그대로 상태에 넣으면
 * 화면 전체가 한 번 더 그려지고 일정 객체 기준 메모가 전부 깨져, 전환 애니메이션 도중에
 * 무거운 렌더가 끼어든다. 내용이 같은 일정은 이전 객체를 쓰고, 목록 전체가 같으면
 * 이전 배열 자체를 돌려줘 상태 갱신이 아무 일도 하지 않게 한다.
 */
export function reuseUnchangedCalendarEvents(
  previous: readonly CalendarEvent[],
  next: CalendarEvent[],
): CalendarEvent[] {
  // 비어 있던 목록이 또 비어 있으면 그대로 둔다(빈 기간을 넘길 때도 다시 그리지 않게).
  if (previous.length === 0) return next.length === 0 ? (previous as CalendarEvent[]) : next;
  const previousByIdentity = new Map<string, CalendarEvent>();
  for (const event of previous) previousByIdentity.set(calendarEventIdentityKey(event), event);
  let unchanged = previous.length === next.length;
  const merged = next.map((event, index) => {
    const candidate = previousByIdentity.get(calendarEventIdentityKey(event));
    const reused = candidate && isSameCalendarEventContent(candidate, event) ? candidate : event;
    if (reused !== previous[index]) unchanged = false;
    return reused;
  });
  return unchanged ? (previous as CalendarEvent[]) : merged;
}
