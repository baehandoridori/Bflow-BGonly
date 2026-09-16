import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { getEvents, loadBflowEvents } from '@/services/calendarService';
import type { CalendarEvent } from '@/types/calendar';
import { GanttModal } from './GanttDialogs';
import { GanttSelect } from './GanttSelect';
import { useGanttStore } from './useGanttStore';
import { canEditProject, canViewProject, scheduleProject } from './domain';
import { getCalendarImportSourceKey, importCalendarEvents, isCalendarEventImported } from './calendarImport';
import type { GanttProject, GanttSnapshot } from './types';
import './calendarImport.css';

type Props = {
  actorId: string;
  initialProjectId?: string;
  onClose: () => void;
  onImported: (project: GanttProject, importedCount: number, skippedCount: number) => void;
};

function contentOf(event: CalendarEvent): string {
  return JSON.stringify([event.title, event.memo, event.startDate, event.endDate, event.allDay, event.startTime, event.endTime, event.color]);
}

function audienceFingerprint(snapshot: GanttSnapshot, project: GanttProject): string {
  const space = snapshot.spaces.find((item) => item.id === project.spaceId);
  return JSON.stringify([project.spaceId, project.ownerId, project.memberIds, space?.ownerId, space?.shared, space?.members]);
}

export function CalendarImportDialog({ actorId, initialProjectId, onClose, onImported }: Props) {
  const calendars = useCalendarStore((state) => state.calendars);
  const users = useAuthStore((state) => state.users);
  const snapshot = useGanttStore((state) => state.snapshot);
  const storePending = useGanttStore((state) => state.pending);
  const editableProjects = useMemo(() => snapshot.projects.filter((project) => !project.completed && canEditProject(snapshot, actorId, project)), [snapshot, actorId]);
  const [calendarId, setCalendarId] = useState('');
  const [projectId, setProjectId] = useState(initialProjectId ?? editableProjects[0]?.id ?? '');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const active = useRef(true);
  const sessionValid = useRef(true);
  const requestVersion = useRef(0);
  const savingRef = useRef(false);

  const assertSession = () => {
    if (!active.current || !sessionValid.current || useAuthStore.getState().currentUser?.id !== actorId || useGanttStore.getState().actorId !== actorId) {
      throw new Error('로그인 정보가 바뀌었어요. 창을 닫고 다시 가져와 주세요.');
    }
  };
  const readFreshEvents = async (request: number): Promise<CalendarEvent[]> => {
    const assertCurrentRequest = () => {
      assertSession();
      if (request !== requestVersion.current) throw new Error('이미 새 조회가 시작되었어요.');
    };
    assertCurrentRequest();
    const metadata = await useCalendarStore.getState().loadAll({ waitForLatest: true });
    assertCurrentRequest();
    if (!metadata.calendarsFresh) throw new Error('캘린더 목록을 불러오지 못했어요. 다시 불러와 주세요.');
    let fresh = await loadBflowEvents({ broadcast: false });
    assertCurrentRequest();
    if (!fresh) {
      fresh = await loadBflowEvents({ broadcast: false });
      assertCurrentRequest();
    }
    if (!fresh) throw new Error('최신 일정을 불러오지 못했어요. 다시 불러와 주세요.');
    const rows = await getEvents();
    assertCurrentRequest();
    const accessible = new Set(useCalendarStore.getState().calendars.map((calendar) => calendar.id));
    return rows.filter((event) => event.source === 'bflow' && event.calendarId && accessible.has(event.calendarId) && getCalendarImportSourceKey(event));
  };
  const reload = async () => {
    const request = ++requestVersion.current;
    setLoading(true); setError(''); setEvents([]); setSelectedKeys([]);
    try {
      const rows = await readFreshEvents(request);
      if (!active.current || request !== requestVersion.current) return;
      setEvents(rows);
      const allowed = useCalendarStore.getState().calendars;
      setCalendarId((previous) => allowed.some((calendar) => calendar.id === previous) ? previous : allowed[0]?.id ?? '');
    } catch (cause) {
      if (active.current && request === requestVersion.current) setError((cause as Error).message);
    } finally {
      if (active.current && request === requestVersion.current) setLoading(false);
    }
  };
  useEffect(() => {
    active.current = true;
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (state.currentUser?.id === previous.currentUser?.id) return;
      sessionValid.current = false;
      requestVersion.current++;
      setEvents([]); setSelectedKeys([]); setSessionInvalid(true); setLoading(false);
      setError('로그인 정보가 바뀌었어요. 창을 닫고 다시 가져와 주세요.');
    });
    void reload();
    return () => { active.current = false; requestVersion.current++; unsubscribe(); };
  }, [actorId]);

  const project = editableProjects.find((candidate) => candidate.id === projectId);
  const calendar = calendars.find((candidate) => candidate.id === calendarId);
  const invalidRange = Boolean(startDate && endDate && startDate > endDate);
  const candidates = useMemo(() => events.filter((event) => event.calendarId === calendarId && (!startDate || event.endDate >= startDate) && (!endDate || event.startDate <= endDate)).sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title)), [events, calendarId, startDate, endDate]);
  const available = candidates.filter((event) => project && !isCalendarEventImported(project, event));
  const selected = available.filter((event) => selectedKeys.includes(getCalendarImportSourceKey(event)!));
  const duplicatedCount = candidates.length - available.length;
  const audience = project ? users.filter((user) => canViewProject(snapshot, user.id, project)).map((user) => user.name) : [];
  const scope = calendar?.isAdminOverview ? '관리자만 확인할 수 있는 미공유 캘린더' : calendar?.visibility === 'team' ? '팀 전체 공개' : calendar?.visibility === 'members' ? '선택한 멤버에게 공유' : '나만 보기';
  const locked = loading || saving || sessionInvalid;

  const submit = async () => {
    if (locked || storePending || !project || !calendar || !selected.length || invalidRange || savingRef.current) return;
    const reviewedAudience = audienceFingerprint(snapshot, project);
    savingRef.current = true; setSaving(true); setError('');
    try {
      const freshEvents = await readFreshEvents(requestVersion.current);
      assertSession();
      const currentCalendar = useCalendarStore.getState().calendars.find((item) => item.id === calendarId);
      if (!currentCalendar) throw new Error('이 캘린더를 볼 수 없게 되었어요. 목록을 다시 불러와 주세요.');
      const latestRows = new Map(freshEvents.filter((event) => event.calendarId === calendarId).map((event) => [getCalendarImportSourceKey(event), event]));
      if (selected.some((event) => !latestRows.has(getCalendarImportSourceKey(event)) || contentOf(latestRows.get(getCalendarImportSourceKey(event))!) !== contentOf(event))) {
        setEvents(freshEvents);
        throw new Error('선택한 일정이 바뀌었어요. 최신 내용을 확인한 뒤 다시 가져와 주세요.');
      }
      const destinationFresh = await useGanttStore.getState().refresh();
      assertSession();
      const state = useGanttStore.getState();
      if (!destinationFresh || state.error) throw new Error('프로젝트의 최신 공유 정보를 확인하지 못했어요. 다시 시도해 주세요.');
      const destination = state.snapshot.projects.find((item) => item.id === projectId);
      if (!destination || destination.completed || state.pending || !canEditProject(state.snapshot, actorId, destination)) throw new Error('가져올 프로젝트의 편집 권한과 상태를 다시 확인해 주세요.');
      if (audienceFingerprint(state.snapshot, destination) !== reviewedAudience) throw new Error('프로젝트의 공유 대상이 바뀌었어요. 가져온 작업을 볼 사람을 확인한 뒤 다시 가져와 주세요.');
      const result = importCalendarEvents(destination, selected.map((event) => latestRows.get(getCalendarImportSourceKey(event))!));
      if (result.importedCount > 0) await state.execute({ type: 'saveProject', project: scheduleProject(result.project), expectedRevision: destination.revision });
      assertSession();
      onImported(result.project, result.importedCount, result.skippedCount);
    } catch (cause) {
      if (active.current) setError((cause as Error).message);
    } finally {
      savingRef.current = false;
      if (active.current) setSaving(false);
    }
  };

  return <GanttModal title="캘린더 가져오기" onClose={() => { if (!savingRef.current) onClose(); }}>
    <form className="calendar-import" onSubmit={(event) => { event.preventDefault(); return submit(); }}>
      <p className="calendar-import-intro">캘린더 일정을 간트 작업으로 복사합니다. 원본은 유지되며, 이후 변경은 서로 자동 반영되지 않아요.</p>
      <div className="gantt-pair">
        <label className="gantt-field">원본 캘린더<GanttSelect label="가져올 캘린더" value={calendarId} disabled={locked} onChange={(value) => { setCalendarId(value); setSelectedKeys([]); }} options={[{ value: '', label: '캘린더 선택' }, ...calendars.map((item) => ({ value: item.id, label: item.name + (item.isAdminOverview ? ` · ${users.find((user) => user.id === item.ownerId)?.name ?? '알 수 없는 소유자'}` : '') + (!item.canEdit ? ' · 보기 전용' : '') }))]} /></label>
        <label className="gantt-field">가져올 프로젝트<GanttSelect label="가져올 프로젝트" value={projectId} disabled={locked} onChange={(value) => { setProjectId(value); setSelectedKeys([]); }} options={[{ value: '', label: '프로젝트 선택' }, ...editableProjects.map((item) => ({ value: item.id, label: item.name }))]} /></label>
      </div>
      <div className="gantt-pair">
        <label className="gantt-field">시작일 <small>비우면 전체 기간</small><input aria-label="가져오기 시작일" type="date" value={startDate} disabled={locked} onChange={(event) => { setStartDate(event.target.value); setSelectedKeys([]); }} /></label>
        <label className="gantt-field">종료일 <small>비우면 전체 기간</small><input aria-label="가져오기 종료일" type="date" value={endDate} min={startDate || undefined} disabled={locked} onChange={(event) => { setEndDate(event.target.value); setSelectedKeys([]); }} /></label>
      </div>
      {invalidRange && <p role="alert" className="gantt-error">종료일은 시작일과 같거나 뒤여야 해요.</p>}
      <div className="calendar-import-audience"><p>원본: {calendar ? scope : '캘린더를 선택해 주세요'}</p><p>가져온 작업을 볼 사람: {project ? audience.join(', ') || '프로젝트 구성원' : '프로젝트를 선택해 주세요'}</p></div>
      {!editableProjects.length && <p className="gantt-error">먼저 편집할 수 있는 프로젝트를 만들어 주세요.</p>}
      <div className="calendar-import-list-heading"><strong>{selected.length}개 선택 <span>· {candidates.length}개 일정{duplicatedCount > 0 && project ? ` · 이미 가져온 ${duplicatedCount}개 제외` : ''}</span></strong><div><button type="button" disabled={locked || !available.length || invalidRange} onClick={() => setSelectedKeys(available.map((event) => getCalendarImportSourceKey(event)!))}>전체 선택</button><button type="button" disabled={locked || !selectedKeys.length} onClick={() => setSelectedKeys([])}>선택 해제</button></div></div>
      <div className="calendar-import-list" aria-busy={loading}>
        {loading ? <p role="status">최신 캘린더 일정을 불러오는 중…</p> : !candidates.length ? <p>{calendar ? '선택한 기간에 가져올 일정이 없어요.' : '캘린더를 선택해 주세요.'}</p> : candidates.map((event) => {
          const key = getCalendarImportSourceKey(event)!;
          const duplicate = Boolean(project && isCalendarEventImported(project, event));
          return <label key={key} className={`calendar-import-event ${duplicate ? 'imported' : ''}`} data-import-event={key}>
            <input type="checkbox" aria-label={`${event.title} 가져오기`} disabled={locked || duplicate || !project || invalidRange} checked={!duplicate && selectedKeys.includes(key)} onChange={(change) => setSelectedKeys((previous) => change.target.checked ? [...previous, key] : previous.filter((id) => id !== key))} />
            <span className="calendar-import-dot" style={{ backgroundColor: event.color }} /><span className="calendar-import-event-info"><strong>{event.title}</strong><small>{event.startDate}{event.endDate !== event.startDate ? ` → ${event.endDate}` : ''}{event.allDay === false ? ` · ${event.startTime ?? ''}–${event.endTime ?? ''}` : ' · 종일'}</small></span>{duplicate && <small>이미 가져옴</small>}
          </label>;
        })}
      </div>
      {error && <p className="gantt-error" role="alert">{error}</p>}
      <div className="gantt-dialog-actions"><button type="button" disabled={locked} onClick={() => void reload()}>다시 불러오기</button><span className="calendar-import-spacer" /><button type="button" disabled={saving} onClick={onClose}>취소</button><button className="primary" disabled={locked || storePending || !selected.length || !project || !calendar || invalidRange}>{saving ? '가져오는 중…' : `${selected.length}개 가져오기`}</button></div>
    </form>
  </GanttModal>;
}
