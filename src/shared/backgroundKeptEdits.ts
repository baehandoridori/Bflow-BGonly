// The unsaved map edits this PC keeps (v1.140.0): what may be written, the limits, and the file of one account. The store of
// main and the mirror of the preview check with these alone, and the page takes the type. Pure: nothing comes from another module.

/** A map id: a UUID, as the library writes it (domain.ts). */
const MAP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The keys of a kept edit, and none else: a key of another version is refused, not carried along. */
const ENTRY_KEYS: readonly string[] = ['baseRevision', 'steps', 'keptAt', 'value', 'imageOmitted'];
/** An object of keys: not null, and not a list. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** A whole count from 0 on. */
function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export type KeptMapEdit = {
  /** The revision of the map the draft was opened on. Null: a map never saved (no path makes one today). */
  baseRevision: number | null;
  /** Finished edits not saved (mapDraftSteps): the count the band shows again after a restart. */
  steps: number;
  /** When it was written (ms since 1970). The newest is the map on show after a restart. */
  keptAt: number;
  /** The map as its draft held it once the edit settled. Opaque here: the renderer checks it as a map before it is restored. */
  value: unknown;
  /** The underlay was a data: picture and was left out (imageUrl ''): a restore takes the library's. */
  imageOmitted?: true;
};
export const KEPT_EDITS = { version: 1, maxEntryChars: 4_000_000, maxEntries: 100 } as const;
export const KEPT_EDITS_REFUSAL = {
  shape: '보관할 도면 편집의 모양이 올바르지 않아요.',
  size: '보관할 도면 편집이 너무 커요.',
  count: '이 PC에 보관할 수 있는 도면 편집은 100개까지예요.',
  version: '보관한 도면 편집 파일을 이 버전에서 읽을 수 없어요. 앱을 업데이트해 주세요.',
} as const;
/** Why an entry may not be written, or null when it may. */
export function keptEntryProblem(mapId: unknown, entry: unknown): string | null {
  if (typeof mapId !== 'string' || !MAP_ID.test(mapId) || !isRecord(entry) || Object.keys(entry).some(key => !ENTRY_KEYS.includes(key))) return KEPT_EDITS_REFUSAL.shape;
  const { baseRevision, steps, keptAt, value } = entry;
  if (!(baseRevision === null || isCount(baseRevision)) || !isCount(steps) || !(typeof keptAt === 'number' && Number.isFinite(keptAt) && keptAt >= 0)) return KEPT_EDITS_REFUSAL.shape;
  if (!isRecord(value) || value.id !== mapId || ('imageOmitted' in entry && entry.imageOmitted !== true)) return KEPT_EDITS_REFUSAL.shape;
  return JSON.stringify(entry).length > KEPT_EDITS.maxEntryChars ? KEPT_EDITS_REFUSAL.size : null;
}
/** The entries of a stored document that pass the check. The others stay in the file and are never handed out. */
export function keptEntriesOf(entries: unknown): Record<string, KeptMapEdit> {
  const kept: Record<string, KeptMapEdit> = {};
  if (!isRecord(entries)) return kept;
  for (const [mapId, entry] of Object.entries(entries)) if (keptEntryProblem(mapId, entry) === null) kept[mapId] = entry as KeptMapEdit;
  return kept;
}
/** The file of one account in the app's folder. */
export function keptEditsFileName(userId: string): string {
  const name = /^[a-z0-9_-]{1,64}$/.test(userId) ? userId : '=' + Array.from(new TextEncoder().encode(userId), byte => byte.toString(16).padStart(2, '0')).join('');
  return `background-map-kept.${name}.json`;
}
