// 팀의 고정 문장: PD 가 [STYLE] 같은 자리표시를 쓰면 앱이 '고정 문장'의 글을 그 자리에 쓴다 (HTML parseBlocks ~ fillPlaceholders).
import { SHADOW_TXT, TILT_SENTENCE, TIME_KEY } from './constants';
import { samePlaceSentence } from './place';
import type { OrderPlaceInput, PlaceId } from './types';

const timeKey = (t: string): string | null => (Object.prototype.hasOwnProperty.call(TIME_KEY, t) ? TIME_KEY[t] : null);

export function parseBlocks(text: string): Record<string, string> {
  const out: Record<string, string> = {}; let key: string | null = null; let buf: string[] = [];
  const flush = () => { if (key) out[key] = buf.join('\n').trim(); };
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { flush(); key = m[1].trim().toUpperCase().replace(/\s+/g, ' '); buf = []; } else if (key) buf.push(line);
  }
  flush(); return out;
}

export interface BlockKit { one: (k: string) => string; colorMap: Record<string, string>; colorsFor: (t: string) => string }

export function blockKit(fixedText: string): BlockKit {
  const B = parseBlocks(fixedText);
  const one = (k: string) => (B[String(k).toUpperCase()] || '').replace(/\s*\n\s*/g, ' ').trim();
  const colorMap: Record<string, string> = {};
  (B['TREE COLORS'] || '').split(/\r?\n/).forEach((l) => { const m = /^\s*([a-z]+)\s*:\s*(.+)$/i.exec(l); if (m) colorMap[m[1].toLowerCase()] = m[2].trim(); });
  const colorsFor = (t: string) => {
    const k = (t === 'day' || t === 'dayflat') ? 'day' : t === 'sunset' ? 'sunset' : (t === 'night' || t === 'nightflat') ? 'night' : 'other';
    return colorMap[k] || colorMap.other || 'two flat greens';
  };
  return { one, colorMap, colorsFor };
}

export const splitItems = (s: unknown): string[] => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export interface ExpandContext { fixedText: string; time: string; place: PlaceId }

/** HTML expandBlocks: 자리표시를 고정 문장으로 펴고, PD 가 빠뜨린 그림체 · 시간대 · 금지 목록을 넣는다. */
export function expandBlocks(prompt: string, nPicks: number, ctx: ExpandContext, opt: { replaced?: string[] } = {}): { text: string; notes: string[] } {
  const K = blockKit(ctx.fixedText), one = K.one; const src = String(prompt || ''); const rep = new Set(opt.replaced || []);
  const t = ctx.time, tk = timeKey(t), nightish = t === 'sunset' || t === 'night' || t === 'nightflat';
  const flat = t === 'dayflat' || t === 'nightflat' || /\[\s*LIGHT[\s_-]+FLAT\s*\]|Light: completely flat/i.test(src);
  const place = ctx.place === 'auto' ? null : ctx.place;
  const notes: string[] = []; let p = src; const had = { trees: false, cars: false };
  const timeBlock = (pl: string | null) => one('TIME ' + (tk || 'day') + ' ' + (pl || place || 'exterior'));
  const autoPlaceNote = () => { if (!place && !notes.some((n) => n.startsWith('장소가 자동이라'))) notes.push('장소가 자동이라 시간대 문장을 실외 기준으로 넣었어요. 실내 장면이면 장소를 실내로 고르고 주문서를 다시 만들어 주세요.'); };
  p = p.replace(/\[\s*STYLE\s*\]/gi, () => one('STYLE'));
  p = p.replace(/\[\s*TREES?\s*\]/gi, () => { had.trees = true; return one('TREES').replace(/\{TREE_COLORS\}/g, K.colorsFor(t)); });
  p = p.replace(/\[\s*CARS?(\s*[,:\-]?\s*EYE[\s_-]*LEVEL)?\s*\]/gi, (m0: string, eye: string | undefined) => { had.cars = true; return one('CARS').replace(/\{SHADOW\}/g, flat ? '' : SHADOW_TXT) + (eye ? ' ' + one('CARS EYE LEVEL') : ''); });
  p = p.replace(/\[\s*BUILDINGS?\s*\]/gi, () => one('BUILDINGS'));
  p = p.replace(/\[\s*TIME(?:\s*[:\-]?\s*(interior|exterior))?\s*\]/gi, (m0: string, pl: string | undefined) => {
    if (!pl) autoPlaceNote();
    if (!tk) notes.push('직접 만든 시간대인데 PD가 시간대 자리표시를 써서 낮 문장을 대신 넣었어요. 영어 주문서의 Time 문장을 확인해 주세요.');
    return timeBlock(pl ? pl.toLowerCase() : null);
  });
  if (flat) p = p.replace(/\[\s*LIGHT[\s_-]+EVEN\s*\]/gi, '');
  p = p.replace(/\[\s*LIGHT[\s_-]+FLAT\s*\]/gi, () => one('LIGHT FLAT'));
  p = p.replace(/\[\s*LIGHT[\s_-]+EVEN\s*\]/gi, () => one('LIGHT EVEN'));
  if (/(^|\s)Trees:/.test(p)) had.trees = true; if (/(^|\s)Cars:/.test(p)) had.cars = true;
  const autoItems = () => { const it: string[] = []; if (nPicks > 0) it.push(one('AVOID WITH STYLE EXAMPLES')); if (flat) it.push(one('AVOID WITH FLAT LIGHT')); if (had.trees) it.push(one('AVOID WITH TREES')); if (had.cars) it.push(one('AVOID WITH CARS')); return it; };
  const avoidLine = (extra: string, baseIn?: string) => {
    const base = baseIn || one(nightish ? 'AVOID NIGHT' : 'AVOID DAY');
    const have = new Set(splitItems(base.replace(/^Avoid:\s*/i, '').replace(/\.\s*$/, '')).map((s) => s.toLowerCase())); const add: string[] = [];
    autoItems().concat(splitItems(String(extra || '').replace(/^\s*[:\-]\s*/, '').replace(/[.;:\s]+$/, ''))).forEach((item) => {
      if (/^(people|none|n\/a|nothing|없음)$/i.test(item.trim())) return;
      const parts = splitItems(item).map((s) => s.toLowerCase()); if (!parts.length || parts.every((s) => have.has(s))) return;
      add.push(item); parts.forEach((s) => have.add(s));
    });
    if (!add.length) return base;
    return /,\s*people\.\s*$/i.test(base) ? base.replace(/,\s*people\.\s*$/i, ', ' + add.join(', ') + ', people.') : base.replace(/\.\s*$/, '') + ', ' + add.join(', ') + '.';
  };
  // [AVOID] 자리표시: 덧붙인 말을 모으고(뒤에 PD 가 쓴 문장 앞에서 멈춘다) 첫 자리만 남긴다
  const extras: string[] = []; let marked = false;
  p = p.replace(/\[\s*AVOID\s*(?::\s*([^\]]*))?\]([^\n\[]*)/gi, (m0: string, inner: string | undefined, after: string | undefined) => {
    let extra = (inner || '') + ' ' + (after || ''), tail = '';
    const cut = /(^|\s)(Text:|Aspect ratio|Generate an image)/.exec(extra); if (cut) { tail = extra.slice(cut.index).trim(); extra = extra.slice(0, cut.index); }
    extras.push(extra); const first = !marked; marked = true; return (first ? '\u0000AVOID\u0000' : '') + (tail ? ' ' + tail : '');
  });
  const written = /Avoid:[^\n]*?\bpeople\./i.exec(p) || (rep.has('AVOID') ? /Avoid:[^\n]*/i.exec(p) : null);
  if (written) p = p.replace(written[0], () => avoidLine(extras.join(','), written[0])).replace('\u0000AVOID\u0000', '');
  else if (marked) p = p.replace('\u0000AVOID\u0000', () => avoidLine(extras.join(',')));
  // 모든 주문서에 있어야 하는 세 문장: PD 가 빠뜨린 것을 넣는다
  const styleText = one('STYLE');
  if (styleText && !rep.has('STYLE') && !p.includes(styleText.slice(0, 60)) && !/shows the target drawing style/i.test(p)) {
    const at = p.search(/Images? \{S1\}|(^|\s)(Trees|Cars|Large buildings|Time|Text):/);
    p = at > 0 ? p.slice(0, at).trimEnd() + ' ' + styleText + ' ' + p.slice(at).trimStart() : p.trimEnd() + ' ' + styleText; notes.push('PD가 빠뜨린 그림체 문장을 앱이 넣었어요.');
  }
  if (tk && !rep.has('TIME') && !/(^|\s)Time:/.test(p)) {
    const at = p.search(/(^|\s)(Text|Avoid):|Aspect ratio/); const s = timeBlock(null); autoPlaceNote();
    p = at > 0 ? p.slice(0, at).trimEnd() + ' ' + s + ' ' + p.slice(at).trimStart() : p.trimEnd() + ' ' + s; notes.push('PD가 빠뜨린 시간대 문장을 앱이 넣었어요.');
  }
  if (!rep.has('AVOID') && !/(^|\s)Avoid:/.test(p)) { p = p.trimEnd() + ' ' + avoidLine(''); notes.push('PD가 빠뜨린 금지 목록을 앱이 넣었어요.'); }
  const left = [...new Set(p.match(/\[\s*(STYLE|TREES?|CARS?|BUILDINGS?|TIME|LIGHT|AVOID)\b[^\]\n]*\]|\[[A-Z][A-Z _]{2,30}\]/gi) || [])];
  if (left.length) notes.push('알 수 없는 자리표시가 남아 있어요: ' + left.join(', ') + '. 영어 주문서에서 확인해 주세요.');
  return { text: p.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').trim(), notes };
}

/** HTML toMarkers: 고칠 때 이전 주문서를 처음 주문서처럼 자리표시로 되돌려 보낸다. */
export function toMarkers(text: string, nRefs: number, nPicks: number, place: OrderPlaceInput | { mode: 'sheet' | 'base'; n: number; painted?: boolean } | null, fixedText: string): string {
  const K = blockKit(fixedText), one = K.one; const base = String(nRefs + 2 + nPicks); let p = String(text || '');
  if (place) { const sp = samePlaceSentence(place); if (sp && p.includes(sp)) p = p.split(sp).join('[SAME PLACE]'); }
  p = p.split(' ' + TILT_SENTENCE).join('').split(TILT_SENTENCE).join('');
  const fill = (s: string) => s.replace(/\{BASE\}/g, base);
  const swap = (sentence: string, marker: string) => { if (!sentence) return; const s = fill(sentence); if (p.includes(s)) p = p.split(s).join(marker); };
  swap(one('STYLE'), '[STYLE]');
  for (const c of new Set(Object.values(K.colorMap).concat(['two flat greens']))) swap(one('TREES').replace(/\{TREE_COLORS\}/g, c), '[TREES]');
  for (const sh of [SHADOW_TXT, '']) { const cars = one('CARS').replace(/\{SHADOW\}/g, sh); swap(cars + ' ' + one('CARS EYE LEVEL'), '[CARS EYE LEVEL]'); swap(cars, '[CARS]'); }
  swap(one('BUILDINGS'), '[BUILDINGS]');
  for (const k of Object.values(TIME_KEY)) for (const pl of ['exterior', 'interior']) swap(one('TIME ' + k + ' ' + pl), '[TIME ' + pl + ']');
  swap(one('LIGHT FLAT'), '[LIGHT FLAT]'); swap(one('LIGHT EVEN'), '[LIGHT EVEN]');
  p = p.replace(/Avoid:[^\n]*?\bpeople\./i, (line: string) => {
    const autos = ['AVOID WITH STYLE EXAMPLES', 'AVOID WITH FLAT LIGHT', 'AVOID WITH TREES', 'AVOID WITH CARS'].map((k) => fill(one(k))).filter(Boolean);
    for (const b of ['AVOID DAY', 'AVOID NIGHT'].map((k) => fill(one(k)))) {
      const head = b.replace(/,?\s*people\.\s*$/i, ''); if (!head || !line.startsWith(head)) continue;
      let rest = line.slice(head.length).replace(/,?\s*people\.\s*$/i, ''); autos.forEach((a) => { rest = rest.split(', ' + a).join(''); });
      const ex = splitItems(rest); return '[AVOID]' + (ex.length ? ' ' + ex.join(', ') : '');
    }
    return line;
  });
  return p;
}

/** HTML blocksForChat: 앱 없이 ChatGPT 로 시험할 때 자리표시 대신 쓸 문장들. */
export function blocksForChat(fixedText: string, time: string, placeSel: PlaceId): string {
  const K = blockKit(fixedText), one = K.one; const t = time, tk = timeKey(t) || 'day', flat = t === 'dayflat' || t === 'nightflat'; const pl = placeSel === 'auto' ? 'exterior' : placeSel;
  const night = t === 'sunset' || t === 'night' || t === 'nightflat';
  const L = ['## Fixed sentences for the markers', 'There is no app between you and the picture here: write these sentences out in full where the markers go.',
    '[STYLE] = ' + one('STYLE'), '[TREES] = ' + one('TREES').replace(/\{TREE_COLORS\}/g, K.colorsFor(t)),
    '[CARS] = ' + one('CARS').replace(/\{SHADOW\}/g, flat ? '' : SHADOW_TXT), '[CARS EYE LEVEL] = the [CARS] sentence, then: ' + one('CARS EYE LEVEL'),
    '[BUILDINGS] = ' + one('BUILDINGS'), '[TIME] = ' + one('TIME ' + tk + ' ' + pl), '[TIME exterior] = ' + one('TIME ' + tk + ' exterior'), '[TIME interior] = ' + one('TIME ' + tk + ' interior'),
    '[LIGHT FLAT] = ' + one('LIGHT FLAT'), '[LIGHT EVEN] = ' + one('LIGHT EVEN'),
    '[AVOID] = ' + one(night ? 'AVOID NIGHT' : 'AVOID DAY') + ' Before "people", add: ' + [one('AVOID WITH STYLE EXAMPLES') + ' (only with style examples)', flat ? one('AVOID WITH FLAT LIGHT') : '', one('AVOID WITH TREES') + ' (with trees)', one('AVOID WITH CARS') + ' (with cars)', 'and your scene items'].filter(Boolean).join('; ') + '.'];
  return L.join('\n');
}

/** HTML markerSentences: blocksForChat 의 머리 두 줄을 뺀 것 (지문 규칙에 붙는다). */
export const markerSentences = (fixedText: string, time: string, place: PlaceId) => blocksForChat(fixedText, time, place).split('\n').slice(2).join('\n');

/** HTML fillPlaceholders: {BASE} {S1} {S2} 를 실제 그림 번호로. */
export function fillPlaceholders(prompt: string, nRefs: number, nPicks: number): { text: string; leftover: boolean } {
  const base = nRefs + 2 + nPicks; const s1 = nPicks >= 1 ? nRefs + 2 : base; const s2 = nPicks >= 2 ? nRefs + 3 : s1;
  const leftover = nPicks === 0 && /\{S[12]\}/.test(prompt);
  return { text: prompt.replace(/\{BASE\}/g, String(base)).replace(/\{S1\}/g, String(s1)).replace(/\{S2\}/g, String(s2)), leftover };
}
