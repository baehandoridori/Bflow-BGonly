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

export interface CalendarApiInputContract {
  calendarCreate: (input: CalendarCreateInput) => unknown;
  calendarUpdate: (id: string, updates: CalendarUpdateInput) => unknown;
  calendarSetMembers: (calendarId: string, members: CalendarMemberInput[]) => unknown;
  calendarEventsList: (params?: { from?: string; to?: string }) => unknown;
  calendarEventCreate: (input: CalendarEventCreateInput) => unknown;
  calendarEventUpdate: (id: string, updates: CalendarEventUpdateInput) => unknown;
  calendarTagsSave: (
    tags: Array<{ id?: string; name: string; color: string; sort_order: number }>,
  ) => unknown;
}
