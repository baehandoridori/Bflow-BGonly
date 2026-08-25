import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import type { CalendarEvent, CalendarEventType } from '@/types/calendar';
import { DEPARTMENT_CONFIGS } from '@/types';
import { fmtDate } from '@/utils/calendarDate';
import { floatingGlassStyle } from '@/utils/glassStyles';

export const GOOGLE_CALENDAR_OPTION = 'google';

type Props = {
  initialDate?: string;
  initialEndDate?: string;
  episodes: { episodeNumber: number; title: string; parts: { partId: string; sheetName: string; department: string; scenes: { sceneId: string; no: number }[] }[] }[];
  googleAuthenticated: boolean;
  onClose: () => void;
  onSave: (event: Omit<CalendarEvent, 'id' | 'createdAt'>) => void;
};

function addOneDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function oneHourAfter(date: string, time: string): { date: string; time: string } {
  const [hour, minute] = time.split(':').map(Number);
  const totalMinutes = hour * 60 + minute + 60;
  const normalized = totalMinutes % 1440;
  return {
    date: totalMinutes >= 1440 ? addOneDay(date) : date,
    time: `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`,
  };
}

export function EventCreateModal({ initialDate, initialEndDate, episodes, googleAuthenticated, onClose, onSave }: Props) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const episodeTitles = useDataStore((state) => state.episodeTitles);
  const colorMode = useAppStore((state) => state.colorMode);
  const calendars = useCalendarStore((state) => state.calendars);
  const tags = useCalendarStore((state) => state.tags);
  const editableCalendars = useMemo(() => calendars.filter((calendar) => calendar.canEdit), [calendars]);
  const sortedTags = useMemo(() => [...tags].sort((left, right) => left.sortOrder - right.sortOrder), [tags]);
  const defaultCalendarId = editableCalendars.find((calendar) => calendar.isPersonal)?.id
    ?? editableCalendars[0]?.id
    ?? (googleAuthenticated ? GOOGLE_CALENDAR_OPTION : '');
  const today = fmtDate(new Date());

  const [selectedCalendarId, setSelectedCalendarId] = useState(defaultCalendarId);
  const [title, setTitle] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [startDate, setStartDate] = useState(initialDate ?? today);
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState(initialEndDate ?? initialDate ?? today);
  const [endTime, setEndTime] = useState('');
  const [tagId, setTagId] = useState<string | undefined>();
  const [evType, setEvType] = useState<CalendarEventType>('custom');
  const [memo, setMemo] = useState('');
  const [linkedEp, setLinkedEp] = useState<number | ''>('');
  const [linkedPart, setLinkedPart] = useState('');
  const [linkedScene, setLinkedScene] = useState('');
  const userSelectedCalendarRef = useRef(false);

  const isGoogle = selectedCalendarId === GOOGLE_CALENDAR_OPTION;
  const selectedCalendar = editableCalendars.find((calendar) => calendar.id === selectedCalendarId);
  const selectedEpParts = useMemo(() => linkedEp === ''
    ? []
    : episodes.find((episode) => episode.episodeNumber === linkedEp)?.parts ?? [], [linkedEp, episodes]);
  const selectedPartScenes = useMemo(() => !linkedPart
    ? []
    : selectedEpParts.find((part) => part.sheetName === linkedPart)?.scenes ?? [], [linkedPart, selectedEpParts]);

  useEffect(() => {
    const available = isGoogle
      ? googleAuthenticated
      : editableCalendars.some((calendar) => calendar.id === selectedCalendarId);
    const untouchedGoogleFallback = !userSelectedCalendarRef.current
      && isGoogle
      && defaultCalendarId !== GOOGLE_CALENDAR_OPTION;
    if ((!available || untouchedGoogleFallback) && defaultCalendarId) {
      setSelectedCalendarId(defaultCalendarId);
    }
  }, [defaultCalendarId, editableCalendars, googleAuthenticated, isGoogle, selectedCalendarId]);

  useEffect(() => {
    if (evType === 'custom') return;
    const episode = episodes.find((item) => item.episodeNumber === linkedEp);
    if (!episode) {
      setTitle(evType === 'episode' ? '에피소드 선택...' : evType === 'part' ? '파트 선택...' : '씬 선택...');
      return;
    }
    const episodeLabel = episodeTitles[episode.episodeNumber] || episode.title;
    if (evType === 'episode') {
      setTitle(episodeLabel);
      return;
    }
    const part = selectedEpParts.find((item) => item.sheetName === linkedPart);
    if (!part) {
      setTitle(`${episodeLabel} — 파트 선택...`);
      return;
    }
    const departmentLabel = DEPARTMENT_CONFIGS[part.department as 'bg' | 'acting']?.shortLabel ?? '';
    setTitle(evType === 'part'
      ? `${episodeLabel} ${part.partId}파트 (${departmentLabel})`
      : linkedScene
        ? `${episodeLabel} ${part.partId}파트 #${linkedScene}`
        : `${episodeLabel} ${part.partId}파트 (${departmentLabel}) — 씬 선택...`);
  }, [episodeTitles, episodes, evType, linkedEp, linkedPart, linkedScene, selectedEpParts]);

  const changeCalendar = (calendarId: string) => {
    userSelectedCalendarRef.current = true;
    setSelectedCalendarId(calendarId);
    if (calendarId === GOOGLE_CALENDAR_OPTION) setTagId(undefined);
  };

  const changeStartTime = (time: string) => {
    setStartTime(time);
    if (time && !endTime) {
      const suggested = oneHourAfter(startDate, time);
      setEndDate(suggested.date);
      setEndTime(suggested.time);
    }
  };

  const hasInvalidTimedInterval = !allDay
    && Boolean(startTime && endTime)
    && `${endDate}T${endTime}` <= `${startDate}T${startTime}`;

  const handleSubmit = () => {
    if (!title.trim() || !selectedCalendarId || (!allDay && (!startTime || !endTime))) return;
    if (hasInvalidTimedInterval) return;
    const partData = selectedEpParts.find((part) => part.sheetName === linkedPart);
    onSave({
      title: title.trim(),
      memo: memo.trim(),
      color: selectedCalendar?.color ?? '#6C5CE7',
      type: evType,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      createdBy: currentUser?.name ?? '알 수 없음',
      ...(isGoogle ? {} : { calendarId: selectedCalendarId }),
      tagId: isGoogle ? undefined : tagId,
      allDay,
      startTime: allDay ? undefined : startTime,
      endTime: allDay ? undefined : endTime,
      linkedEpisode: linkedEp !== '' ? linkedEp : undefined,
      linkedPart: partData?.partId,
      linkedSheetName: linkedPart || undefined,
      linkedSceneId: linkedScene || undefined,
      linkedDepartment: partData?.department as 'bg' | 'acting' | undefined,
    });
  };

  const sharingCopy = selectedCalendar?.visibility === 'team'
    ? '팀 캘린더에 공유돼요'
    : selectedCalendar?.visibility === 'members'
      ? '이 캘린더 멤버와 공유돼요'
      : '';
  const canSubmit = Boolean(title.trim() && selectedCalendarId && (allDay || (startTime && endTime)))
    && !hasInvalidTimedInterval;
  const inputClass = 'w-full bg-bg-card border border-accent/40 rounded-lg px-3 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20';

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.01 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="absolute right-0 top-0 bottom-0 z-50 w-[24rem] max-h-full overflow-y-auto"
        style={{ ...floatingGlassStyle, background: 'rgb(var(--color-bg-card) / 0.96)', borderLeft: '1px solid rgb(var(--color-bg-border) / 0.42)', boxShadow: '-14px 0 36px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.22))' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border">
          <h3 className="text-sm font-bold text-text-primary">새 일정</h3>
          <button onClick={onClose} aria-label="닫기" className="p-1 text-text-secondary hover:text-text-primary cursor-pointer"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">캘린더</label>
            <select aria-label="캘린더" required value={selectedCalendarId} onChange={(event) => changeCalendar(event.target.value)} className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent">
              {editableCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
              {googleAuthenticated && <option value={GOOGLE_CALENDAR_OPTION}>내 구글 캘린더</option>}
            </select>
            <p className="mt-1 text-[11px] text-text-secondary/70">편집 권한이 있는 캘린더만 보여요</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">제목</label>
            <input aria-label="제목" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="일정 이름" className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 outline-none focus:border-accent" autoFocus />
          </div>

          <div>
            <label className="flex items-center justify-between gap-3 text-xs font-semibold text-text-secondary/80">
              <span>종일</span>
              <input aria-label="종일 일정" type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} className="h-4 w-4 rounded accent-accent cursor-pointer" />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-text-secondary">시작일</label>
                <div className="relative mt-1">
                  <input aria-label="시작일" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={`${inputClass} pr-8 date-picker-hidden`} style={{ colorScheme: colorMode }} />
                  <CalendarDays size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
                </div>
              </div>
              {!allDay && <TimeField label="시작 시각" value={startTime} onChange={changeStartTime} colorMode={colorMode} inputClass={inputClass} />}
              <div>
                <label className="text-[11px] font-medium text-text-secondary">종료일</label>
                <div className="relative mt-1">
                  <input aria-label="종료일" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={`${inputClass} pr-8 date-picker-hidden`} style={{ colorScheme: colorMode }} />
                  <CalendarDays size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
                </div>
              </div>
              {!allDay && <TimeField label="종료 시각" value={endTime} onChange={setEndTime} colorMode={colorMode} inputClass={inputClass} />}
            </div>
            {hasInvalidTimedInterval && (
              <p role="alert" className="mt-2 text-[11px] font-medium text-red-400">
                종료 시각은 시작 시각보다 뒤여야 해요.
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">태그</label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <button type="button" aria-label="태그 없음" aria-pressed={tagId === undefined} disabled={isGoogle} onClick={() => setTagId(undefined)} className={cn('px-2.5 py-1.5 rounded-full text-[11px] transition-colors', tagId === undefined ? 'bg-accent/20 text-accent' : 'bg-bg-primary text-text-secondary', isGoogle ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer')}>없음</button>
              {sortedTags.map((tag) => {
                const selected = tagId === tag.id;
                return (
                  <button
                    type="button"
                    key={tag.id}
                    aria-label={`${tag.name} 태그`}
                    aria-pressed={selected}
                    disabled={isGoogle}
                    onClick={() => setTagId(tag.id)}
                    className={cn('px-2.5 py-1.5 rounded-full text-[11px] border transition-colors', isGoogle ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer')}
                    style={selected ? { color: tag.color, borderColor: tag.color, background: `color-mix(in srgb, ${tag.color} 18%, transparent)` } : { borderColor: 'rgb(var(--color-bg-border) / 0.7)' }}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
            {isGoogle && <p className="mt-1.5 text-[11px] text-text-secondary/70">Google 일정에는 팀 태그를 붙일 수 없어요</p>}
          </div>

          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">연결</label>
            <div className="flex gap-1.5 mt-1">
              {([['custom', '없음'], ['episode', '에피소드'], ['part', '파트'], ['scene', '씬']] as const).map(([type, label]) => (
                <button
                  type="button"
                  key={type}
                  onClick={() => {
                    setEvType(type);
                    if (type === 'custom') { setLinkedEp(''); setLinkedPart(''); setLinkedScene(''); }
                    else if (type === 'episode') { setLinkedPart(''); setLinkedScene(''); }
                    else if (type === 'part') setLinkedScene('');
                  }}
                  className={cn('px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer', evType === type ? 'bg-accent/20 text-accent' : 'bg-bg-primary text-text-secondary hover:text-text-primary')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {evType !== 'custom' && (
            <div className="flex flex-col gap-2 bg-bg-primary/50 rounded-xl p-3 border border-bg-border/50">
              <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">연결 대상</label>
              <select value={linkedEp} onChange={(event) => { setLinkedEp(event.target.value ? Number(event.target.value) : ''); setLinkedPart(''); setLinkedScene(''); }} className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent">
                <option value="">에피소드 선택</option>
                {episodes.map((episode) => <option key={episode.episodeNumber} value={episode.episodeNumber}>{episodeTitles[episode.episodeNumber] || episode.title}</option>)}
              </select>
              {(evType === 'part' || evType === 'scene') && linkedEp !== '' && (
                <select value={linkedPart} onChange={(event) => { setLinkedPart(event.target.value); setLinkedScene(''); }} className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent">
                  <option value="">파트 선택</option>
                  {selectedEpParts.map((part) => <option key={part.sheetName} value={part.sheetName}>{part.partId}파트 ({DEPARTMENT_CONFIGS[part.department as 'bg' | 'acting']?.shortLabel ?? part.department})</option>)}
                </select>
              )}
              {evType === 'scene' && linkedPart && (
                <select value={linkedScene} onChange={(event) => setLinkedScene(event.target.value)} className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent">
                  <option value="">씬 선택</option>
                  {selectedPartScenes.map((scene) => <option key={scene.sceneId || scene.no} value={scene.sceneId || String(scene.no)}>#{scene.no} {scene.sceneId}</option>)}
                </select>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">메모</label>
            <textarea aria-label="메모" value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="메모 (선택사항)" rows={2} className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary/40 resize-none outline-none focus:border-accent" />
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-bg-border bg-bg-card/95 px-5 py-4">
          <p className="min-h-4 text-[11px] text-text-secondary/75">{sharingCopy}</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-xs text-text-secondary hover:text-text-primary cursor-pointer">취소</button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="px-4 py-2 rounded-lg text-xs font-medium bg-accent hover:bg-accent/80 text-white disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed">만들기</button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

function TimeField({ label, value, onChange, colorMode, inputClass }: { label: string; value: string; onChange: (value: string) => void; colorMode: 'dark' | 'light'; inputClass: string }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-text-secondary">{label}</label>
      <input aria-label={label} type="time" step={600} value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClass} mt-1`} style={{ colorScheme: colorMode }} />
    </div>
  );
}
