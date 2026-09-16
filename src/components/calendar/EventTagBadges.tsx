import { useCalendarStore } from '@/stores/useCalendarStore';
import type { CalendarEvent } from '@/types/calendar';
import { resolveEventTags } from './eventTagPresentation';

export function EventTagBadges({ event, compact = false, tooltip = false }: { event: CalendarEvent; compact?: boolean; tooltip?: boolean }) {
  const tags = useCalendarStore((state) => state.tags);
  const selected = resolveEventTags(event, tags);
  if (!selected.length) return null;
  return <span aria-label="일정 태그" className={`flex min-w-0 gap-1 ${compact ? 'flex-nowrap overflow-hidden' : 'flex-wrap'} ${tooltip ? 'mt-2' : ''}`}>
    {selected.map((tag) => <span key={tag.id} data-calendar-tag={tag.id} className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 font-medium ${compact ? 'py-0 text-[9px] leading-[16px]' : 'py-0.5 text-[10px] leading-[14px]'}`} style={{ backgroundColor: `color-mix(in srgb, ${tag.color} 28%, ${tooltip ? 'rgb(var(--color-tooltip-bg, 26 29 39))' : 'rgb(var(--color-bg-card))'})`, color: tooltip ? 'rgb(var(--color-tooltip-text))' : 'rgb(var(--color-text-primary))', border: `1px solid ${tag.color}80` }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />{tag.name}
    </span>)}
  </span>;
}
