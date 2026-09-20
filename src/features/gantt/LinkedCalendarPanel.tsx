import { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { EventSidePanel } from '@/components/calendar/EventSidePanel';
import { CalendarSettingsModal } from '@/components/calendar/CalendarSettingsModal';
import { deleteEvent, getEvents, loadBflowEvents, updateEvent } from '@/services/calendarService';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import type { CalendarEvent } from '@/types/calendar';
import type { CalendarRecurrenceScope } from '@/shared/calendarRecurrenceContract';
import { snapshotCalendarEventIdentity } from '@/utils/calendarEventIdentity';
import { CalendarSharingSummary } from './CalendarSharingSummary';
import { useGanttStore } from './useGanttStore';
import type { GanttProject } from './types';

export function LinkedCalendarPanel({ project, taskId, actorId, onClose, onUnlink }: {
  project: GanttProject; taskId: string | null; actorId: string; onClose(): void; onUnlink(): Promise<void>;
}) {
  const calendarId = project.calendarLink!.calendarId;
  const calendar = useCalendarStore((state) => state.calendars.find((item) => item.id === calendarId));
  const users = useAuthStore((state) => state.users);
  const [event, setEvent] = useState<CalendarEvent | null>(null), [error, setError] = useState('');
  const [settings, setSettings] = useState(false), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  const validSession = useRef(true), mounted = useRef(true), operation = useRef(false);
  const displayedEvent = useMemo(() => event ? { ...event, canEdit: Boolean(calendar?.canEdit && event.canEdit !== false), isReadOnly: !calendar?.canEdit || event.isReadOnly } : null, [event, calendar?.canEdit]);
  const sourceTask = project.tasks.find((item) => item.id === taskId);
  const sourceId = sourceTask?.sourceCalendarEventId;
  const sourceRange = sourceTask?.startDate && sourceTask?.endDate ? {from:sourceTask.startDate,to:sourceTask.endDate} : undefined;
  const assertSession = (requireMounted = true) => {
    if ((requireMounted && !mounted.current) || !validSession.current || useAuthStore.getState().currentUser?.id !== actorId || useGanttStore.getState().actorId !== actorId) throw new Error('로그인 정보가 바뀌었어요. 일정을 다시 열어 주세요.');
  };
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (state.currentUser?.id !== previous.currentUser?.id) { validSession.current = false; setEvent(null); onClose(); }
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, [actorId]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    if (!sourceId) return;
    void (async () => {
      try {
        let fresh = await loadBflowEvents({ broadcast: false });
        if (cancelled) return; assertSession();
        if (!fresh) { fresh = await loadBflowEvents({ broadcast: false }); if (cancelled) return; assertSession(); }
        if (!fresh) throw new Error('최신 일정을 불러오지 못했어요. 다시 불러와 주세요.');
        const events = await getEvents(sourceRange); if (cancelled) return; assertSession();
        const latest = events.find((item) => item.source === 'bflow' && item.calendarId === calendarId && item.id === sourceId);
        if (!latest) { setEvent(null); throw new Error('일정이 삭제되었거나 이 캘린더에서 이동되었어요.'); }
        setEvent((previous) => JSON.stringify(previous) === JSON.stringify(latest) ? previous : latest);
      } catch (cause) { if (!cancelled && mounted.current) setError((cause as Error).message); }
    })();
    return () => { cancelled = true; };
  }, [sourceId, calendarId, project, retry]);
  const mutate = async (kind: 'update' | 'delete', updates?: Partial<CalendarEvent>, scope?: CalendarRecurrenceScope) => {
    assertSession();
    const source = useCalendarStore.getState().calendars.find((item) => item.id === calendarId);
    if (!event || !source?.canEdit || event.canEdit === false || event.isReadOnly) throw new Error('원본 캘린더의 편집 권한이 없습니다.');
    if (operation.current) throw new Error('변경 내용을 저장하고 있어요.');
    operation.current = true;
    const identity = snapshotCalendarEventIdentity(event);
    try {
      if (kind === 'delete') { if(scope)await deleteEvent(event.id,identity,scope);else await deleteEvent(event.id, identity); }
      else { if(scope)await updateEvent(event.id,updates!,identity,scope);else await updateEvent(event.id, updates!, identity); }
      assertSession(false); if (!mounted.current) return;
      const rows = await getEvents({from:updates?.startDate??event.startDate,to:updates?.endDate??event.endDate}); assertSession(false); if (!mounted.current) return;
      const latest = rows.find((item) => item.source === 'bflow' && item.id === identity.id && item.calendarId === calendarId);
      setEvent(latest ?? null);
      await useGanttStore.getState().refresh(); assertSession(false);
      if (mounted.current && !latest) onClose();
    } finally { operation.current = false; }
  };
  const unlink = async () => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { assertSession(); await onUnlink(); } catch (cause) { if (mounted.current) setError((cause as Error).message); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  };
  const navigate = (date?: string) => useAppStore.getState().navigateToScheduleDate(date ? { date } : undefined);
  if (sourceId && displayedEvent && calendar) return <div className={`gantt-linked-event ${error ? 'has-error' : ''}`}>{error && <div className="gantt-linked-event-error" role="alert">{error}<button onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button></div>}<EventSidePanel event={displayedEvent} onClose={onClose} onUpdate={(_id, updates, scope) => mutate('update', updates, scope)} onDelete={(_id, scope) => mutate('delete',undefined,scope)} onNavigate={(target) => navigate(target.startDate)} /></div>;
  return <aside className="gantt-linked-summary" aria-label="연결된 캘린더">
    <header><h2>{project.name}</h2><button aria-label="연결 캘린더 닫기" onClick={onClose}><X size={16} /></button></header>
    <span className="gantt-linked-badge"><Link2 size={13} /> 캘린더 자동 연결</span>
    {sourceId ? <p>{error ? '' : '원본 일정을 불러오는 중…'}</p> : <><p>일정 {project.tasks.length}개 · 일정과 공유 설정이 원본 캘린더를 따라 자동으로 갱신됩니다.</p><p>일정을 누르면 원본 일정의 상세 내용을 열어요. 작업 그룹이나 진행률은 이 프로젝트에서 따로 변경하지 않습니다.</p></>}
    {calendar && <CalendarSharingSummary calendar={calendar} users={users} />}
    {error && <p className="gantt-error" role="alert">{error}<button onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button></p>}
    <button onClick={() => navigate()}>원본 캘린더 열기</button>
    {calendar?.canManage && <button disabled={busy} onClick={() => setSettings(true)}>원본 캘린더 설정</button>}
    {!sourceId && project.calendarLink?.canUnlink && <button disabled={busy} onClick={() => void unlink()}>간트 연결 해제</button>}
    <small>연결을 해제해도 원본 캘린더와 일정은 유지돼요.</small>
    {settings && calendar?.canManage && <CalendarSettingsModal calendar={calendar} eventCount={project.tasks.length} onClose={() => { setSettings(false); void useGanttStore.getState().refresh(); }} />}
  </aside>;
}
