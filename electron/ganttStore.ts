/** Main-only Gantt persistence. Calendar entries project the same task data; no duplicate event writes. */
import { randomUUID } from 'node:crypto';
import { supabase } from './supabase';
import { updateTask, validateProject } from '../src/features/gantt/domain';
import type { GanttRequest, GanttSnapshot, GanttProject, GanttTask } from '../src/features/gantt/types';
import type { CalendarEventRow, CalendarEventWriteFields } from './calendarStore';

type RpcError = { code?: string; message?: string };
export interface GanttRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>;
}
export type GanttCalendarRow = CalendarEventRow & {
  linked_gantt_project_id: string; linked_gantt_task_id: string; gantt_can_edit: boolean;
};
type EventQuery = { from?: string; to?: string; eventId?: string };
const eventPrefix = 'gantt:';
export const isGanttCalendarEventId = (id: string): boolean => typeof id === 'string' && id.startsWith(eventPrefix);

function missingMigration(error: RpcError): boolean {
  return ['42P01', 'PGRST205', '42883', 'PGRST202'].includes(error.code ?? '');
}
function fail(error: RpcError): never {
  if (missingMigration(error)) throw new Error('간트 저장소 준비가 필요합니다. 간트 데이터베이스 업데이트를 적용해 주세요.');
  throw new Error(error.message || '간트 저장 중 오류가 발생했습니다.');
}
function snapshot(data: unknown): GanttSnapshot {
  if (!data || typeof data !== 'object' || !Array.isArray((data as GanttSnapshot).spaces) || !Array.isArray((data as GanttSnapshot).projects)) {
    throw new Error('간트 저장소가 올바른 결과를 반환하지 않았습니다.');
  }
  return data as GanttSnapshot;
}
export function validateGanttRequest(value: unknown): asserts value is GanttRequest {
  const request = value as GanttRequest | null;
  if (!request || typeof request.requestId !== 'string' || !request.requestId.trim() || request.requestId.length > 128 || !request.command) {
    throw new Error('올바른 간트 요청이 필요합니다.');
  }
  const command = request.command;
  if (!['saveSpace', 'saveProject', 'deleteSpace', 'deleteProject'].includes(command.type)) throw new Error('알 수 없는 간트 요청입니다.');
  if (command.expectedRevision !== null && (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0)) throw new Error('간트 요청의 버전이 올바르지 않습니다.');
  if (command.type === 'saveProject') validateProject(command.project);
  else if (command.type === 'saveSpace') {
    if (!command.space || typeof command.space.name !== 'string' || !command.space.name.trim() || !Array.isArray(command.space.members)) throw new Error('올바른 간트 폴더 요청이 필요합니다.');
  } else if (typeof (command.type === 'deleteProject' ? command.projectId : command.spaceId) !== 'string' || command.expectedRevision === null) {
    throw new Error('삭제할 간트 요청이 올바르지 않습니다.');
  }
}
function projectedRow(project: GanttProject, task: GanttTask): GanttCalendarRow {
  return {
    id: `${eventPrefix}${project.id}:${task.id}`, calendar_id: task.calendarId!,
    title: task.title, memo: task.memo, tag_id: null, all_day: task.allDay,
    start_date: task.startDate, end_date: task.endDate, start_time: task.allDay ? null : task.startTime,
    end_time: task.allDay ? null : task.endTime, linked_episode: null, linked_part: null,
    linked_sheet_name: null, linked_scene_id: null, linked_department: null, linked_todo_id: null,
    created_by: project.ownerId, created_at: '', updated_at: '',
    linked_gantt_project_id: project.id, linked_gantt_task_id: task.id, gantt_can_edit: true,
  };
}

export function createGanttStore(client: GanttRpcClient) {
  async function read(actorId: string): Promise<GanttSnapshot> {
    const { data, error } = await client.rpc('gantt_read', { p_actor_id: actorId });
    if (error) fail(error);
    return snapshot(data);
  }
  async function execute(actorId: string, request: GanttRequest): Promise<GanttSnapshot> {
    validateGanttRequest(request);
    const { data, error } = await client.rpc('gantt_execute', { p_actor_id: actorId, p_request_id: request.requestId, p_command: request.command });
    if (error) fail(error);
    return snapshot(data);
  }
  async function listCalendarEvents(actorId: string, query: EventQuery = {}): Promise<GanttCalendarRow[]> {
    if (!actorId) throw new Error('로그인 세션이 필요합니다.');
    const { data, error } = await client.rpc('gantt_calendar_events', {
      p_actor_id: actorId, p_from: query.from ?? null, p_to: query.to ?? null, p_event_id: query.eventId ?? null,
    });
    if (error) { if (missingMigration(error)) return []; fail(error); }
    if (!Array.isArray(data)) throw new Error('간트 일정 조회 결과가 올바르지 않습니다.');
    return data as GanttCalendarRow[];
  }
  async function linkedProject(actorId: string, eventId: string, expectedCalendarId: string) {
    if (!isGanttCalendarEventId(eventId)) throw new Error('간트 일정 식별자가 올바르지 않습니다.');
    const row = (await listCalendarEvents(actorId, { eventId }))[0];
    if (!row || row.calendar_id !== expectedCalendarId) throw new Error('간트 일정의 연결이 변경되었습니다. 새로고침해 주세요.');
    if (!row.gantt_can_edit) throw new Error('간트와 캘린더 양쪽의 편집 권한이 필요합니다.');
    const current = await read(actorId);
    const project = current.projects.find((item) => item.id === row.linked_gantt_project_id);
    if (!project) throw new Error('간트 프로젝트를 찾을 수 없거나 권한이 변경되었습니다.');
    const task = project.tasks.find((item) => item.id === row.linked_gantt_task_id);
    if (!task || task.calendarId !== expectedCalendarId) throw new Error('간트 일정의 연결이 변경되었습니다.');
    return { project, task };
  }
  async function updateCalendarEvent(actorId: string, eventId: string, updates: Partial<CalendarEventWriteFields>, expectedCalendarId: string): Promise<GanttCalendarRow> {
    if (!isGanttCalendarEventId(eventId)) throw new Error('간트 일정 식별자가 올바르지 않습니다.');
    const { project, task } = await linkedProject(actorId, eventId, expectedCalendarId);
    const allowed = ['title', 'memo', 'start_date', 'end_date', 'all_day', 'start_time', 'end_time'];
    const existingRow = projectedRow(project, task);
    if (Object.keys(updates).some((key) => !allowed.includes(key) && updates[key as keyof CalendarEventWriteFields] !== existingRow[key as keyof GanttCalendarRow])) throw new Error('이 항목은 간트 상세에서 수정해 주세요.');
    const temporal = ['start_date', 'end_date', 'all_day', 'start_time', 'end_time'] as const;
    if (task.mode === 'auto' && temporal.some((key) => updates[key] !== undefined && updates[key] !== existingRow[key])) throw new Error('자동 작업은 간트에서 수동으로 전환한 뒤 일정을 수정해 주세요.');
    const patch: Partial<GanttTask> = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.memo !== undefined) patch.memo = updates.memo ?? '';
    if (updates.start_date !== undefined) patch.startDate = updates.start_date;
    if (updates.end_date !== undefined) patch.endDate = updates.end_date;
    if (updates.all_day !== undefined) patch.allDay = updates.all_day;
    if (updates.start_time !== undefined) patch.startTime = updates.start_time ?? '';
    if (updates.end_time !== undefined) patch.endTime = updates.end_time ?? '';
    const changed = updateTask(project, task.id, patch);
    const saved = await execute(actorId, { requestId: randomUUID(), command: { type: 'saveProject', project: changed, expectedRevision: project.revision } });
    const result = saved.projects.find((item) => item.id === project.id);
    const resultTask = result?.tasks.find((item) => item.id === task.id);
    if (!result || !resultTask) throw new Error('수정한 간트 일정의 접근 권한이 변경되었습니다.');
    return projectedRow(result, resultTask);
  }
  async function unlinkCalendarEvent(actorId: string, eventId: string, expectedCalendarId: string): Promise<void> {
    const { project, task } = await linkedProject(actorId, eventId, expectedCalendarId);
    const changed = updateTask(project, task.id, { calendarId: null, calendarEventId: null });
    await execute(actorId, { requestId: randomUUID(), command: { type: 'saveProject', project: changed, expectedRevision: project.revision } });
  }
  return { read, execute, listCalendarEvents, updateCalendarEvent, unlinkCalendarEvent };
}
const persistence = createGanttStore(supabase);
export const readGantt = persistence.read;
export const executeGantt = persistence.execute;
export const listGanttCalendarEvents = persistence.listCalendarEvents;
export const updateGanttCalendarEvent = persistence.updateCalendarEvent;
export const unlinkGanttCalendarEvent = persistence.unlinkCalendarEvent;
