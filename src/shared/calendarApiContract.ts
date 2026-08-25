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
  | { storage: 'bflow'; event: CalendarEventCreateInput }
  | { storage: 'legacy-private'; event: LegacyPrivateReplacementCreateInput }
  | { storage: 'google'; calendar_id: string; event: GoogleReplacementCreateInput };

export type CalendarPrivacyReplacementDisposition = 'keep' | 'delete';
export type CalendarPrivacyMigrationSourceDeleteResult = 'deleted' | 'missing' | 'ambiguous';
export type CalendarPrivacyMigrationSourceDeleteInput =
  | { storage: 'bflow'; event_id: string }
  | { storage: 'legacy-private'; event_id: string }
  | { storage: 'google'; calendar_id: string; event_id: string };

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
  calendarPrivacyMigrationSourceDelete: (input: CalendarPrivacyMigrationSourceDeleteInput) => unknown;
  calendarPrivacyReplacementCreate: (input: CalendarPrivacyReplacementCreateInput) => unknown;
  calendarPrivacyReplacementSettle: (
    receipt: string,
    disposition: CalendarPrivacyReplacementDisposition,
  ) => unknown;
  calendarTagsSave: (
    tags: Array<{ id?: string; name: string; color: string; sort_order: number }>,
  ) => unknown;
}
