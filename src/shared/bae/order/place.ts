// 기준 배경 · 부품 시트 문장(3단계)과 화면 기울기 문장 (HTML 810~860줄).
import { PLACE_TXT, TILT_SENTENCE } from './constants';
import type { OrderInputs, OrderPlaceInput } from './types';

type PlaceLike = Pick<OrderPlaceInput, 'mode' | 'n' | 'painted'>;

export const SAME_PLACE_RE = () => /\[\s*SAME[\s_-]*PLACE\s*\]/gi;
export const imgsWord = (n: number) => (n <= 1 ? 'image 2' : n === 2 ? 'images 2 and 3' : 'images 2, 3 and 4');

/** HTML placeRules: PD 지침에 붙는 기준 배경 절. */
export function placeRules(pl: PlaceLike | null | undefined): string {
  if (!pl) return '';
  const room = pl.painted ? '\n\n' + PLACE_TXT.room.replace(/\{IMGS\}/g, imgsWord(pl.mode === 'sheet' ? 1 : pl.n)) : '';
  return '\n\n' + (pl.mode === 'sheet' ? PLACE_TXT.sheet : PLACE_TXT.base) + room;
}

export function samePlaceSentence(pl: PlaceLike | null | undefined): string {
  if (!pl) return '';
  const room = pl.painted ? ' ' + PLACE_TXT.roomSentence.replace(/\{IMGS\}/g, imgsWord(pl.mode === 'sheet' ? 1 : pl.n)) : '';
  if (pl.mode === 'sheet') return PLACE_TXT.samePlaceSheet.replace(/\{N\}/g, '2') + room;
  const n = pl.n, nums = Array.from({ length: n }, (_, i) => i + 2), list = n === 1 ? '2' : nums.slice(0, -1).join(', ') + ' and ' + nums[n - 1];
  return PLACE_TXT.samePlace.replace(/\{SUBJ\}/g, n === 1 ? 'Image ' + list + ' is a finished background' : 'Images ' + list + ' are finished backgrounds')
    .replace(/\{OBJ\}/g, (n === 1 ? 'image ' : 'images ') + list).replace(/\{S\}/g, n === 1 ? 's' : '') + room;
}

/** HTML samePlace: [SAME PLACE] → 팀 문장 (실제 그림 번호). 빠뜨렸으면 [STYLE] 앞에 넣고 notes 에 적는다. */
export function samePlace(p: string, pl: PlaceLike | null | undefined, notes: string[]): string {
  const s = samePlaceSentence(pl); if (!s) return p;
  if (SAME_PLACE_RE().test(p)) { let first = true; return p.replace(SAME_PLACE_RE(), () => { if (first) { first = false; return s; } return ''; }); }
  if (p.includes(s)) return p;
  notes.push('PD가 [SAME PLACE]를 빠뜨려서 앱이 [STYLE] 앞에 넣었어요.'); const at = p.search(/\[\s*STYLE\s*\]/i);
  return at >= 0 ? p.slice(0, at) + s + ' ' + p.slice(at) : p.trimEnd() + ' ' + s;
}

/** HTML sheetLine: 부품 시트 한 줄. bases = 기준 배경들의 메모와 부품 이름. */
export function sheetLine(bases: Array<{ note: string; parts: Array<{ name?: string }> }>): string {
  const used = bases.filter((b) => b.parts.length), n = used.length || 1, notes = used.map((b) => b.note.trim()).filter(Boolean);
  const names = [...new Set(used.reduce((a: string[], b) => a.concat(b.parts.map((p) => (p.name || '').trim()).filter(Boolean)), []))];
  return 'model sheet (기준 배경 부품 시트) of this same place: its furniture and fittings cut out from ' + (n === 1 ? 'a finished background of it' : (n === 2 ? 'two' : 'three') + ' finished backgrounds of it') +
    (notes.length ? " (the artist's notes in Korean: " + notes.join('; ') + ')' : '') + ', and swatches of its wall, side wall, floor and baseboard colors.' + (names.length ? ' Parts the artist named (Korean): ' + names.join(', ') + '.' : '');
}

/** HTML placeLines: 기준 배경이 없으면 빈 목록. */
export function placeLines(inp: Pick<OrderInputs, 'place'>): string[] {
  const pl = inp.place; if (!pl) return [];
  if (pl.mode === 'sheet') return ['Image 2: ' + sheetLine(pl.bases || [])];
  return pl.items.map((it, i) => 'Image ' + (i + 2) + ': base background (기준 배경) ' + (i + 1) + ": a finished background of this same place that our team already made for this episode. Artist's note: " + (it.note && it.note.trim() ? it.note.trim() : '(none)'));
}

export function tiltLine(t: number): string {
  const a = Math.abs(t);
  return 'Tilt: the artist drew this shot tilted by ' + a + '° (a dutch angle, ' + (t > 0 ? 'the right side higher' : 'the left side higher') + '). The app turned Image 1 level for you; it will turn the finished picture back by ' + a + '° and crop it to the final frame. So draw the picture level, exactly as Image 1 shows it: the horizon and the floor lines run as they run in Image 1, and vertical lines stay vertical. Do not mention the tilt in the prompt; the app adds a sentence about the white corners around the turned sketch.';
}

export function addTilt(p: string): string {
  if (p.includes(TILT_SENTENCE)) return p;
  const at = p.search(/Aspect ratio/i);
  return at > 0 ? p.slice(0, at).trimEnd() + ' ' + TILT_SENTENCE + ' ' + p.slice(at) : p.trimEnd() + ' ' + TILT_SENTENCE;
}
