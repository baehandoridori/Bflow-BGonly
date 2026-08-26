import type { CalendarNotificationCatchupInput } from './calendarNotificationCatchup';

export type CalendarVisibility = 'private' | 'members' | 'team';

export interface CalendarMemberInput {
  user_id: string;
  can_edit: boolean;
}

export interface CalendarCreateInput {
  name: string;
  color: string;
  visibility: CalendarVisibility;
  members?: CalendarMemberInput[];
}

export type CalendarUpdateInput = Partial<{
  name: string;
  color: string;
  visibility: CalendarVisibility;
  members: CalendarMemberInput[];
}>;

export interface CalendarEventCreateInput {
  calendar_id: string;
  title: string;
  memo: string | null;
  tag_id: string | null;
  all_day: boolean;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  linked_episode: number | null;
  linked_part: string | null;
  linked_sheet_name: string | null;
  linked_scene_id: string | null;
  linked_department: string | null;
  linked_todo_id: string | null;
}

export type CalendarEventUpdateInput = Partial<CalendarEventCreateInput>;

export interface LegacyPrivateReplacementCreateInput {
  title: string;
  memo?: string;
  color?: string;
  type?: string;
  start_date: string;
  end_date: string;
  linked_episode?: number | null;
  linked_part?: string | null;
  linked_sheet_name?: string | null;
  linked_scene_id?: string | null;
  linked_department?: string | null;
  linked_todo_id?: string | null;
  created_by?: string;
}

export interface GoogleReplacementCreateInput {
  summary: string;
  description?: string;
  startDate: string;
  endDate: string;
  colorId?: string;
  extendedProperties?: Record<string, string>;
  visibility?: 'default' | 'public' | 'private';
}

export type CalendarPrivacyReplacementCreateInput =
  | {
      storage: 'bflow';
      source: CalendarPrivacyMigrationSourceDeleteInput;
      event: CalendarEventCreateInput;
    }
  | {
      storage: 'legacy-private';
      source: CalendarPrivacyMigrationSourceDeleteInput;
      event: LegacyPrivateReplacementCreateInput;
    }
  | {
      storage: 'google';
      source: CalendarPrivacyMigrationSourceDeleteInput;
      calendar_id: string;
      event: GoogleReplacementCreateInput;
    };

export type CalendarPrivacyReplacementDisposition = 'keep' | 'delete';
export type CalendarPrivacyMigrationSourceDeleteResult = 'deleted' | 'missing' | 'ambiguous';
export type CalendarPrivacyMigrationSourceDeleteInput =
  | { storage: 'bflow'; event_id: string }
  | { storage: 'legacy-private'; event_id: string }
  | { storage: 'google'; calendar_id: string; event_id: string };

/**
 * Renderer에는 receipt/secret을 공개하지 않는다. preload가 가진 한정된 closure만
 * replacement를 확정하거나, create 때 고정한 원본을 삭제할 수 있다.
 */
export interface CalendarPrivacyReplacementContinuation {
  settle(disposition: CalendarPrivacyReplacementDisposition): Promise<void>;
  deleteSource(): Promise<CalendarPrivacyMigrationSourceDeleteResult>;
}

export type CalendarPrivacyReplacementCreateResult =
  | ({
      storage: 'bflow' | 'legacy-private' | 'google';
      actual_id: string;
      calendar_id?: string;
    } & CalendarPrivacyReplacementContinuation)
  | { transition_resolved: 'deleted' };

export type CalendarCommittedReplacementDeleteMarker =
  | {
      eventId: string;
      action: 'delete';
      storage: 'bflow';
      calendarId: string;
      committedPrivacyReplacementDelete: true;
    }
  | {
      eventId: string;
      action: 'delete';
      storage: 'legacy-private';
      ownerId: string;
      committedPrivacyReplacementDelete: true;
    }
  | {
      eventId: string;
      action: 'delete';
      calendarId: string;
      committedGoogleDelete: true;
    };

export interface CalendarApiInputContract {
  calendarCreate: (input: CalendarCreateInput) => unknown;
  calendarUpdate: (id: string, updates: CalendarUpdateInput) => unknown;
  calendarSetMembers: (calendarId: string, members: CalendarMemberInput[]) => unknown;
  calendarEventsList: (params?: { from?: string; to?: string }) => unknown;
  calendarEventCreate: (input: CalendarEventCreateInput) => unknown;
  calendarEventUpdate: (id: string, updates: CalendarEventUpdateInput) => unknown;
  calendarPrivacyReplacementCreate: (input: CalendarPrivacyReplacementCreateInput) => unknown;
  calendarTagsSave: (
    tags: Array<{ id?: string; name: string; color: string; sort_order: number }>,
  ) => unknown;
  calendarNotificationsCatchup: (input?: CalendarNotificationCatchupInput) => unknown;
  calendarNotificationsMarkRead: (ids: string[]) => unknown;
}
