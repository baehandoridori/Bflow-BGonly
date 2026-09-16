export function normalizeCalendarTagIds(tagIds: readonly string[] | undefined, tagId?: string | null): string[] {
 const values = tagIds === undefined ? (tagId ? [tagId] : []) : tagIds;
 if (!Array.isArray(values) || values.some((id) => typeof id !== 'string' || !id.trim())) throw new Error('올바른 일정 태그 목록이 필요합니다.');
 return [...new Set(values)];
}
