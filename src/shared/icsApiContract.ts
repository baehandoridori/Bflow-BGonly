/** 외부 캘린더(ICS) 구독 — 렌더러와 메인이 공유하는 계약. */

export interface IcsSubscription {
  id: string;
  name: string;
  /** 정규화된 https URL (webcal://은 저장 전에 https://로 바뀐다) */
  url: string;
  color: string;
  enabled: boolean;
  /** 마지막으로 성공한 조회 시각 (ISO) */
  lastFetchedAt: string | null;
  /** 마지막 실패 사유. 성공하면 null로 지운다. */
  lastError: string | null;
  /**
   * 마지막 조회가 구독당 상한을 넘겨 잘렸는지. 메모리 캐시에서 합성하는 값이라
   * 저장 파일에는 남기지 않는다(sanitizeSubscription이 무시한다).
   */
  lastFetchTruncated?: boolean;
}

export interface IcsSubscriptionAddInput {
  name: string;
  url: string;
  color: string;
}

export type IcsSubscriptionUpdateInput = Partial<Pick<IcsSubscription, 'name' | 'color' | 'enabled'>>;

export interface IcsEventDto {
  uid: string;
  title: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD (inclusive) */
  endDate: string;
  allDay: boolean;
  /** HH:MM — 종일 일정은 null */
  startTime: string | null;
  /** HH:MM — 종일 일정은 null */
  endTime: string | null;
}

export interface IcsSubscriptionEvents {
  subId: string;
  events: IcsEventDto[];
  /** 구독당 상한을 넘겨 잘라 냈는지 */
  truncated: boolean;
}

/** 구독 식별자를 캘린더 가시성 키·source namespace로 쓸 때의 접두사. */
export const ICS_CALENDAR_ID_PREFIX = 'ics:';

export function icsCalendarId(subscriptionId: string): string {
  return `${ICS_CALENDAR_ID_PREFIX}${subscriptionId}`;
}

export const ICS_IPC_CHANNELS = {
  list: 'ics:list',
  add: 'ics:add',
  update: 'ics:update',
  remove: 'ics:remove',
  refresh: 'ics:refresh',
  events: 'ics:events',
  /** 메인 → 렌더러 push (주기 갱신 완료 등) */
  changed: 'ics:changed',
} as const;
