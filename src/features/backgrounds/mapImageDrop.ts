import { spacesAt } from './mapStack.ts';
import type { BackgroundCommand, BackgroundMap, BackgroundNode, BackgroundPlace, BackgroundSnapshot, BackgroundView } from './types.ts';

export const MAP_IMAGE_ADD = { maxFiles: 10, maxBytes: 20 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] as readonly string[],
  nameLimit: 160, pathLimit: 4096, viewLimit: 1000, addedMarkMs: 6000, promptGraceMs: 400 } as const;
/** What a background made here starts as (K2). The ghost card shows the same two words. */
export const MAP_IMAGE_DEFAULTS = { shot: 'wide', time: 'day', variantName: '낮' } as const;
export type MapImageScope = 'map' | 'space' | 'camera'; export type MapImageBlock = 'read-only' | 'no-map' | 'locked-camera' | 'locked-space';
/** What the pictures are added to. `nodeId` is null for the map itself; `name` is the name the image list shows. */
export type MapImageAim = { mapId: string; scope: MapImageScope; nodeId: string | null; name: string; cameraId: string | null };
export type MapImageTarget =
  | { status: 'blocked'; reason: MapImageBlock; name: string }
  /** `placeNodeId`: who holds that place, a space id or null for the map. `placeKept`: the saved map holds it there too (false: only the draft does, tied since the last save). */
  | (MapImageAim & { status: 'ready'; placeId: string; placeName: string; cameraPlaceId: string | null; placeNodeId: string | null; placeKept: boolean })
  /** `placeNodeId`: who gets the place, a space id or null for the map. `placeWas`: what that node holds now (null, or the id of a place that is gone). */
  | (MapImageAim & { status: 'needs-place'; placeNodeId: string | null; placeWas: string | null; ownerKind: 'space' | 'map'; ownerName: string;
    suggestedName: string; parentPlaceId: string | null; sameNamePlaceId: string | null });
export type MapImageOpenTarget = Exclude<MapImageTarget, { status: 'blocked' }>;

type Space = Extract<BackgroundNode, { type: 'space' }>;
/** The first `limit` UTF-16 units of a text, never half a character: a character of two units that the cut would part is left out whole. */
function cut(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const last = text.charCodeAt(limit - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit);
}
/** A name inside a sentence, as the dialogs of the editor put it: between ‘ and ’, and 이름 없음 for an empty one. */
const quoted = (name: string) => `‘${name || '이름 없음'}’`;

/** The target is what the image list names: the selected camera, the selected space (or that of a selected symbol), else the map. The pointer never decides.
 *  `maps`: the maps as the editor shows them, a draft standing in for its saved map. Read for one thing only: which places are in use (3.2). */
export function resolveMapImageTarget(snapshot: BackgroundSnapshot, maps: readonly BackgroundMap[], map: BackgroundMap | undefined, selected: BackgroundNode | undefined): MapImageTarget {
  if (!map) return { status: 'blocked', reason: 'no-map', name: '' };
  if (!snapshot.canManage) return { status: 'blocked', reason: 'read-only', name: '' };
  // A place is there when the library has it: the id of a place deleted since, which a draft may still hold, is none.
  const placeOf = (id: string | null) => snapshot.places.find(place => place.id === id);
  const spaceOf = (id: string | null) => map.nodes.find((node): node is Space => node.type === 'space' && node.id === id);
  const saved = snapshot.maps.find(item => item.id === map.id);
  const aim = (scope: MapImageScope, node: BackgroundNode | null): MapImageAim =>
    ({ mapId: map.id, scope, nodeId: node ? node.id : null, name: node ? node.name : map.name, cameraId: node?.type === 'camera' ? node.id : null });
  const ready = (to: MapImageAim, place: BackgroundPlace, cameraPlaceId: string | null, holder: string | null): MapImageTarget => ({
    ...to, status: 'ready', placeId: place.id, placeName: place.name, cameraPlaceId, placeNodeId: holder,
    // Kept: the saved map holds that place at that node too. Else the draft alone ties it, since the last save, until 도면 저장.
    placeKept: !!saved && (holder === null ? saved.placeId === place.id : saved.nodes.some(node => node.type === 'space' && node.id === holder && node.placeId === place.id)),
  });
  const needsPlace = (to: MapImageAim, owner: Space | null): MapImageTarget => {
    const ownerName = owner ? owner.name : map.name, suggestedName = cut(ownerName.trim(), MAP_IMAGE_ADD.nameLimit) || '새 장소';
    // A new place of a space hangs under the place of the map; one of the map itself, or of a map without a place, at the top.
    const parentPlaceId = owner ? placeOf(map.placeId)?.id ?? null : null;
    // In use: the place of a map, or of a space of it, in a saved map, in a map as the editor shows it (a draft of another map
    // too), or in this one. A place of that name another space uses is not offered: one Enter would put the pictures there.
    const used = new Set<string | null>();
    for (const item of [...snapshot.maps, ...maps, map]) {
      used.add(item.placeId);
      for (const node of item.nodes) if (node.type === 'space') used.add(node.placeId);
    }
    const same = snapshot.places.find(place => place.name.trim() === suggestedName && place.parentId === parentPlaceId && !used.has(place.id));
    return { ...to, status: 'needs-place', placeNodeId: owner ? owner.id : null, placeWas: owner ? owner.placeId : map.placeId, ownerKind: owner ? 'space' : 'map',
      ownerName, suggestedName, parentPlaceId, sameNamePlaceId: same ? same.id : null };
  };
  if (selected?.type === 'camera') {
    if (selected.locked) return { status: 'blocked', reason: 'locked-camera', name: selected.name };
    // The space it stands in: the topmost that holds its point on the whole map (a room hidden by the eye is a room). Its
    // property is read only where it stands in none: written when it was made, it stays as the camera moves.
    const home = spacesAt(map, selected)[0] ?? spaceOf(selected.spaceId), own = placeOf(home ? home.placeId : null);
    if (home && own) return ready(aim('camera', selected), own, own.id, home.id);
    const shared = placeOf(map.placeId);
    if (shared) return ready(aim('camera', selected), shared, null, null);
    // The place asked for goes to the space it stands in, unless that one is locked: to the map then.
    return needsPlace(aim('camera', selected), home && !home.locked ? home : null);
  }
  const space = selected?.type === 'space' ? selected : selected?.type === 'symbol' ? spaceOf(selected.spaceId) : undefined;
  if (space) {
    // Its own place alone: the backgrounds of the place of the map are not in the list of a space.
    const own = placeOf(space.placeId);
    if (own) return ready(aim('space', space), own, null, space.id);
    return space.locked ? { status: 'blocked', reason: 'locked-space', name: space.name } : needsPlace(aim('space', space), space);
  }
  const shared = placeOf(map.placeId);
  return shared ? ready(aim('map', null), shared, null, null) : needsPlace(aim('map', null), null);
}
export type MapImageWords = { title: string; detail: string; blocked: boolean };
/** Where a lock is undone: in edit mode alone, folded under 위치·크기·잠금, so the words say it. */
const UNLOCK = '도면을 편집하면서 속성의 ‘위치·크기·잠금’에서 잠금을 해제하고 다시 넣어 주세요.';
/** Why a file of another type goes in nowhere, one sentence: the overlay says it while such files are dragged, the list of what was refused after (4.6). */
const WRONG_TYPE = 'PNG·JPG·WebP 그림만 넣을 수 있어요.';
/** What the overlay says of a target, and why nothing goes in: the first row of 3.3 that fits. */
export function mapImageTargetWords(target: MapImageTarget, facts: { editing: boolean; running: boolean; wrongType: boolean }): MapImageWords {
  if (target.status === 'blocked' && target.reason === 'no-map') return { title: '여기에는 넣을 수 없어요', detail: '도면을 먼저 만들어 주세요.', blocked: true };
  if (target.status === 'blocked' && target.reason === 'read-only') return { title: '여기에는 넣을 수 없어요', detail: '이 계정으로는 그림을 넣을 수 없어요.', blocked: true };
  if (facts.running) return { title: '지금은 넣을 수 없어요', detail: '앞에 넣던 그림을 마치는 중이에요. 끝난 뒤에 다시 넣어 주세요.', blocked: true };
  if (facts.wrongType) return { title: '넣을 수 없는 파일이에요', detail: WRONG_TYPE, blocked: true };
  if (target.status === 'blocked') return { title: `${quoted(target.name)}에는 넣을 수 없어요`,
    detail: target.reason === 'locked-camera' ? `잠긴 카메라예요. ${UNLOCK}` : `잠겨 있어서 배경 장소를 이어 줄 수 없어요. ${UNLOCK}`, blocked: true };
  // What the pictures go in as. 도면에 추가 alone would read as the picture under the map.
  const title = target.scope === 'camera' ? `${quoted(target.name)}의 시점으로 추가` : target.scope === 'space' ? `${quoted(target.name)}의 배경으로 추가` : `${quoted(target.name)} 도면의 배경으로 추가`;
  if (target.status === 'needs-place') return { title, detail: '놓으면 배경 장소부터 정해요.', blocked: false };
  // A camera names the place its pictures go to: nothing else on screen does.
  if (target.scope === 'camera') return { title, blocked: false,
    detail: facts.editing ? `그림은 ${quoted(target.placeName)} 장소에 바로 저장되고, 카메라에 이어 주는 것은 '도면 저장' 때 저장돼요.` : `놓으면 ${quoted(target.placeName)} 장소에 바로 저장돼요.` };
  return { title, detail: target.placeKept ? '놓으면 바로 저장돼요.' : "그림은 바로 저장되고, 배경 장소를 이어 둔 것은 '도면 저장' 때 저장돼요.", blocked: false };
}
/** The sentences of the place prompt (6.2). `parentName`: the name of the place a new one is made under, null for none. */
export function mapImagePlaceWords(target: Extract<MapImageTarget, { status: 'needs-place' }>, count: number, drafted: boolean, parentName: string | null): { lead: string; ask: string; parent: string; note: string } {
  const onMap = target.ownerKind === 'map', owner = quoted(target.ownerName), tied = onMap ? '이 도면' : owner;
  // A space or a road by its name alone. A camera says first that it stands there: the place goes to where it stands.
  const lead = `${target.scope === 'camera' ? `${quoted(target.name)} 카메라가 있는 ` : ''}${onMap ? `${owner} 도면에는 아직 대표 장소가 없어요.` : `${owner}에는 아직 배경 장소가 없어요.`}`;
  return {
    lead, ask: `그림 ${count}장을 넣을 장소를 정해 주세요. 정한 장소는 ${onMap ? '이 도면의 대표 장소' : `${owner}의 배경 장소`}가 돼요.`,
    parent: parentName === null ? '맨 위 장소로 만들어져요.' : `${quoted(parentName)} 아래에 만들어져요.`,
    // A draft open when the prompt came up: the tie waits for 도면 저장 with the other edits.
    note: drafted ? `장소와 그림은 바로 저장돼요. ${tied}에 이어 주는 것은 다른 편집처럼 '도면 저장' 때 저장돼요.` : `장소와 그림, ${tied}에 이어 주는 것까지 바로 저장돼요.`,
  };
}
/** A file as the rules see it. `byPath`: the main process reads it from `path` (a file copied in Explorer). `pasted`: it came in a paste. */
export type MapImageFileFacts = { name: string; type: string; size: number; path: string; lastModified: number; byPath: boolean; pasted: boolean }; export type MapImageRefusal = 'type' | 'size' | 'webp-path';
/** A picture on its way in, as far as the rules read it: a file of the page (four fields of a `File`: a real one fits), or a path the main process reads. */
export type MapImageSourceLike = { kind: 'file'; file: { readonly name: string; readonly type: string; readonly size: number; readonly lastModified: number }; path: string; pasted: boolean } | { kind: 'path'; path: string };
/** The type of a path by its last extension, read in lower case: the six of a picture file the clipboard may name. */
const PATH_TYPES = new Map([['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'], ['gif', 'image/gif'], ['bmp', 'image/bmp']]);
/** What follows the last slash of either kind. */
const lastPart = (path: string) => path.slice(Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1);
/** A path as two of them are compared (4.6): its spaces aside, either slash, any case. '' for none. */
const pathKey = (path: string) => path.trim().replace(/\\/g, '/').toLowerCase();
export function mapImageSourceFacts(source: MapImageSourceLike): MapImageFileFacts {
  if (source.kind === 'path') return mapImagePathFacts(source.path);
  // The four fields alone: a File has more, none of it read here.
  const { name, type, size, lastModified } = source.file;
  return { name, type, size, path: source.path, lastModified, byPath: false, pasted: source.pasted };
}
/** A file known by its path alone: named by its last part, typed by its last extension (사진.PNG is a PNG). How big it is the main process sees. */
export function mapImagePathFacts(path: string): MapImageFileFacts {
  const trimmed = path.trim(), name = lastPart(trimmed), dot = name.lastIndexOf('.');
  return { name, type: dot < 0 ? '' : PATH_TYPES.get(name.slice(dot + 1).toLowerCase()) ?? '', size: 0, path: trimmed, lastModified: 0, byPath: true, pasted: true };
}
/** The files in the order handed in, each by the rows of 4.6: `accepted` and `index` are places in that list. */
export function sortMapImageFiles(files: readonly MapImageFileFacts[]): { accepted: number[]; refused: { index: number; reason: MapImageRefusal }[]; over: number } {
  const accepted: number[] = [], refused: { index: number; reason: MapImageRefusal }[] = [], seen = new Set<string>();
  let over = 0;
  files.forEach((file, index) => {
    // The same file as one before it, whatever became of that one, is counted once and said nothing of: by the path where it
    // has one, else by name, size and time of change. Pasted data is never the same as another.
    const path = pathKey(file.path), same = path ? `path ${path}` : file.pasted ? null : `file ${JSON.stringify([file.name, file.size, file.lastModified])}`;
    if (same !== null) { if (seen.has(same)) return; seen.add(same); }
    const reason: MapImageRefusal | null = file.byPath && file.type === 'image/webp' ? 'webp-path'
      : !MAP_IMAGE_ADD.types.includes(file.type) ? 'type' : file.size > MAP_IMAGE_ADD.maxBytes ? 'size' : null;
    if (reason) refused.push({ index, reason });
    // Asked last: a file that is refused anyway is said as such, not counted over.
    else if (accepted.length >= MAP_IMAGE_ADD.maxFiles) over += 1;
    else accepted.push(index);
  });
  return { accepted, refused, over };
}
export const MAP_IMAGE_REFUSAL_TEXT: Record<MapImageRefusal, string> = {
  'webp-path': "WebP 파일은 복사해서 붙여 넣을 수 없어요. 끌어다 놓거나 '＋ 이미지 추가'로 넣어 주세요.", type: WRONG_TYPE, size: '20MB보다 큰 그림은 넣을 수 없어요.',
};
/** What was refused, in the order it came: each file by its name, with why. */
export function mapImageRefusedList(files: readonly MapImageFileFacts[], refused: readonly { index: number; reason: MapImageRefusal }[]): { name: string; reason: string }[] {
  return refused.map(({ index, reason }) => ({ name: files[index].name, reason: MAP_IMAGE_REFUSAL_TEXT[reason] }));
}
/** True only when at least one file item is dragged, every file item names its type (not ''), and none of them is PNG, JPEG or WebP. Items that are not files are not counted: text alone is false. */
export function mapImageDragRefused(items: readonly { kind: string; type: string }[]): boolean {
  const files = items.filter(item => item.kind === 'file');
  return files.length > 0 && files.every(item => item.type !== '' && !MAP_IMAGE_ADD.types.includes(item.type));
}
/** The names the engine gives a pasted picture, lower case as they are: IMAGE.PNG is a name of its own. */
const PASTED_NAMES: readonly string[] = ['image.png', 'image.jpg', 'image.jpeg', 'image.webp'];
/** The name a background made of a file starts from: pasted data by the time on this PC, any other file by its name (the last part of its path
 *  when it has none) less the last dot and what follows. 160 units at most, never half a character. */
export function mapImageBaseName(file: Pick<MapImageFileFacts, 'name' | 'path' | 'pasted'>, at: Date): string {
  if (file.pasted && !file.path.trim() && PASTED_NAMES.includes(file.name))
    return `붙여 넣은 그림 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const whole = file.name || lastPart(file.path.trim()), dot = whole.lastIndexOf('.');
  return cut((dot < 0 ? whole : whole.slice(0, dot)).trim(), MAP_IMAGE_ADD.nameLimit).trimEnd() || '이름 없는 그림';
}
/** The name, or with ` (2)`, ` (3)`… where it is taken: within 160 units still, cut never through a character and with no space left before the number. */
export function uniqueMapImageName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let count = 2; ; count += 1) {
    const suffix = ` (${count})`, name = `${cut(base, MAP_IMAGE_ADD.nameLimit - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(name)) return name;
  }
}
export type MapImagePlaceChoice = { kind: 'existing'; placeId: string } | { kind: 'new'; name: string };
/** `newPlace` is saved first when it is not null. `place`: the tie the pictures stand on, the node that holds or is given the place (`nodeId` a space id, or null for the map)
 *  and what it held when the target was read (`was`: the place itself for a target that had one, else null or the id of a place that is gone).
 *  `items`: one for each picture that is uploaded (`index`: its place in the list handed in, not among the accepted ones). `reused`: backgrounds that are there already, to which a camera is tied; `reusedNames`: their names, in that order. */
export type MapImagePlan = { mapId: string; scope: MapImageScope; targetName: string; placeId: string; placeName: string; newPlace: BackgroundPlace | null;
  place: { nodeId: string | null; was: string | null }; cameraId: string | null; cameraPlaceId: string | null;
  items: { index: number; viewId: string; name: string }[]; reused: string[]; reusedNames: string[]; refused: { index: number; name: string; reason: MapImageRefusal }[]; over: number };
/** What a batch ties to the map, and stands on: the place of its owner (`place`, `placeId`: set when the owner still holds `was`, and done already for a target that had its place), and for a camera the views. `viewIds`: the backgrounds of the batch that are in the library, reused and added. */
export type MapImageLink = { place: { nodeId: string | null; was: string | null }; placeId: string; cameraId: string | null; viewIds: readonly string[] };
/** `link`: how what was to be tied to the map went. 'none': nothing was to be tied, or it is there and saved already. 'draft' | 'saved': it is the draft's (put there now, or since the last save), or was saved at once (`partial`: only some of it could be).
 *  'kept' | 'undone' | 'gone': it was the draft's and was saved with it since, or is there no longer; or the pictures themselves were deleted (only mapImageOutcomeNow says these). 'missed': none of it could be tied. 'failed': the save of the map was refused (`linkCause`).
 *  `reusedName`: the name of the first background that was there already. `failed`: how many pictures are in the list of those that did not go in. `byPath`: the batch came from a file copied in Explorer. */
export type MapImageOutcome = { scope: MapImageScope; targetName: string; placeName: string; added: number; reused: number; reusedName?: string; failed: number; over: number; byPath?: boolean;
  link: 'none' | 'draft' | 'saved' | 'kept' | 'undone' | 'gone' | 'missed' | 'failed'; partial?: boolean; linkCause?: string };
