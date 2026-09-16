import { normalizeCalendarTagIds } from '../../shared/calendarTagIds.ts';
interface TaggedEvent { tagId?: string; tagIds?: readonly string[] }
interface TagPresentation { id: string; name: string; color: string }

/** An explicit empty array clears legacy tagId; order also determines the event accent. */
export function getEventTagIds(event: TaggedEvent): string[] {
  return normalizeCalendarTagIds(event.tagIds, event.tagId);
}

export function toggleEventTag(selected: readonly string[], tagId: string | undefined): string[] {
  if (!tagId) return [];
  return selected.includes(tagId) ? selected.filter((id) => id !== tagId) : [...selected, tagId];
}

export function resolveEventTags<T extends TagPresentation>(event: TaggedEvent, tags: readonly T[]): T[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return getEventTagIds(event).flatMap((id) => {
    const tag = byId.get(id);
    return tag ? [tag] : [];
  });
}
