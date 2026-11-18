// PD(주문서 쓰는 모델)에게 보내는 요청 몸 만들기와 답 읽기 (HTML pdInstructions · pdUserText · callPD · outputText). fetch 는 메인이 한다.
import { ORDER_SCHEMA, ORDER_SCHEMA_DIR, PERSP_EN, TILT_SENTENCE, TIMES_BUILTIN } from './constants';
import type { TimeOption } from './constants';
import { blocksForChat } from './blocks';
import { cameraSentence } from './camera';
import { dirMessage, dirNotes, dirRules } from './director';
import { placeLines, placeRules, samePlaceSentence, tiltLine } from './place';
import { drawSizes, effRatio } from './sizes';
import type { LibEntry, OrderInputs, OrderMaterials, OrderPlaceInput, PdAnswer, ReviseInput, StyleMode } from './types';

/** HTML timeList(): 기본 시간대 + 직접 만든 시간대. 설정 책장 times.user 의 {label, pd} 도 받는다 (name ← label, desc ← pd). */
export function timeList(user: Array<{ id: string; name?: string; label?: string; desc?: string; pd?: string }>): TimeOption[] {
  return TIMES_BUILTIN.concat((user || []).map((t) => ({ id: 'c:' + t.id, label: (t.name ?? t.label) as string, desc: t.desc ?? t.pd, user: true })));
}

export function timeForPD(id: string, times: TimeOption[]): string {
  const b = TIMES_BUILTIN.find((t) => t.id === id); if (b) return b.pd as string;
  const u = times.find((t) => t.id === id);
  return u ? 'custom preset "' + u.label + '". The team describes it in Korean: ' + (u.desc || u.label) + '. Write your own time block for it, as the manual says for custom presets.' : 'day';
}

export const libLine = (e: LibEntry) => e.id + ': ' + e.name + ' (' + e.place + ', ' + e.tod + ')';

export interface InstructionTexts { manualText: string; fixedText: string; rulesKo: string }

/** HTML pdInstructions(dir, chat, place): 매뉴얼 + 관리자 추가 규칙 + 기준 배경 절 + 지문 절. */
export function pdInstructions(t: InstructionTexts, dir: string[] | null, chat: boolean, place: Pick<OrderPlaceInput, 'mode' | 'n' | 'painted'> | null, time: string, placeSel: OrderMaterials['place']): string {
  return t.manualText + (t.rulesKo && t.rulesKo.trim() ? '\n\n## Extra rules from our art director (written in Korean)\nFollow these like the house rules. They win over the request.\n' + t.rulesKo.trim() + '\n' : '') +
    placeRules(place) + (dir && dir.length ? dirRules(chat, t.fixedText, time, placeSel) : '');
}

/** HTML pdUserText: PD 에게 가는 첫 글 (재료 설명). */
export function pdUserText(m: OrderMaterials, inp: OrderInputs, mode: StyleMode, lib: LibEntry[], manualIds: string[] | null | undefined, revise: ReviseInput | null | undefined, carry: string[] | null | undefined): string {
  const L: string[] = []; const z = drawSizes(m.ratio, m.tier, m.tilt), size = z.gen;
  L.push(z.tilt ? 'Aspect ratio: ' + effRatio(m.ratio, m.tier, m.tilt) + ' (the image will be ' + size[0] + 'x' + size[1] + ', drawn level; the final picture is ' + m.ratio + ', ' + z.out[0] + 'x' + z.out[1] + ', see Tilt below).' : 'Aspect ratio: ' + m.ratio + ' (the image will be ' + size[0] + 'x' + size[1] + ').');
  L.push('Time of day: ' + timeForPD(m.time, m.times));
  L.push('Place: ' + ({ auto: 'auto (decide from the sketch)', interior: 'interior', exterior: 'exterior' })[m.place]);
  const cam = cameraSentence(m);
  L.push(cam ? 'Perspective chosen by the artist: ' + PERSP_EN[m.persp as Exclude<typeof m.persp, 'auto'>] + '. Camera sentence, copy it verbatim as item 4: "' + cam + '"' : 'Perspective: auto (follow the sketch; there is no camera sentence).');
  L.push('Image 1: ' + (inp.rough.kind === 'guide' ? 'blurry layout guide (a detailed AI image or photo, blurred on purpose; layout source)' : 'rough sketch by our artist (layout source)') + (inp.rough.tilt ? ', turned level by the app (see Tilt)' : '') + (inp.rough.hasColor ? '. The artist painted flat color areas in it as color hints.' : '.'));
  if (inp.rough.tilt) L.push(tiltLine(inp.rough.tilt));
  if (inp.rough.annotated) { L.push("Image 1 with notes: the same picture with the artist's red notes, sent only to you. Note list (positions in % of the picture, x from the left, y from the top):"); L.push(inp.rough.notesText); }
  const off = inp.place ? inp.place.n : 0; placeLines(inp).forEach((t) => L.push(t));
  inp.refs.forEach((it, i) => L.push('Image ' + (off + i + 2) + ": reference image. Artist's note: " + (it.note && it.note.trim() ? it.note.trim() : '(none)')));
  if (inp.place) L.push('Style examples: ' + (inp.place.mode === 'base' ? 'base backgrounds are' : 'a model sheet is') + ' given, so the app sends no style examples this time; style_picks must be [].');
  else if (mode === 'auto') {
    if (lib.length) { L.push('Style examples: auto mode. Choose up to two from this style library (their small thumbnails follow the input images):'); lib.forEach((e) => L.push('  ' + libLine(e))); }
    else L.push('Style examples: the style library is empty, so style_picks must be [].');
  } else {
    const picks = (manualIds || []).map((id) => lib.find((e) => e.id === id)).filter((e): e is LibEntry => !!e);
    L.push('Style examples: manual mode. The artist chose ' + (picks.length ? picks.map(libLine).join('; ') + '. Return exactly these ids in this order as style_picks.' : 'none, so style_picks must be [].'));
  }
  L.push('Base style strip: always sent as the last image. In the prompt write {BASE} for its number and {S1}, {S2} for the style examples.');
  if (!revise && carry && carry.length) L.push('Earlier revision requests for this sketch (from the last order sheet made with the same Image 1; keep what they fixed unless the new request changes it):\n' + carry.map((t, i) => (i + 1) + ') ' + t).join('\n'));
  L.push("Artist's request (Korean): " + (m.request.trim() || '(없음)'));
  if (dirNotes(m.request).length) L.push("The parts of the request in { } are director's notes for this episode. They are also listed separately as DIRECTOR'S NOTES and they win over everything (see the last section of the manual).");
  if (revise) {
    L.push('REVISION MODE.');
    L.push('Previous order sheet (with real image numbers):\n"""\n' + revise.prev + '\n"""');
    L.push('In the previous order sheet, ' + revise.mapping + '. Write {S1}, {S2} and {BASE} again for those images.');
    L.push('Previous style_picks: ' + JSON.stringify(revise.picks) + (mode === 'manual' ? ' (manual mode: keep the artist\'s picks).' : ' (keep them unless the request asks for other style examples).'));
    if (revise.reviewImage) L.push('The art director reviewed the last result made from this order sheet. The image "Last result with red marks" shows it with their red marks; the review is in the request below.');
    L.push('Revision request from the artist (Korean): ' + revise.text);
    if (dirNotes(revise.text).length) L.push("The parts of the revision request in { } are new director's notes; they are in the list of DIRECTOR'S NOTES too.");
    L.push('Write the revised order sheet now, following "Revision mode" in the manual.' + (inp.place ? ' Keep the [SAME PLACE] marker right after the layout rule.' : ''));
  } else if (inp.place) {
    const sheet = inp.place.mode === 'sheet';
    L.push('Write the order sheet now. Follow the manual exactly: its markers or verbatim sentences, the numbers of Image 1 and the ' + (sheet ? 'model sheet' : 'base backgrounds') + (inp.refs.length ? ' and the references' : '') + ', the placeholders, and the section "' + (sheet ? 'Model sheet of the place (기준 배경 부품 시트)' : 'Base backgrounds (기준 배경)') + '" with its [SAME PLACE] marker' + (inp.place.painted ? ' and the section "Painted rough".' : '.'));
  } else L.push('Write the order sheet now. Follow the manual exactly: its markers or verbatim sentences, the numbers of Image 1 and the references, and the placeholders.');
  return L.join('\n');
}

export type PdContent = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'high' | 'auto' | 'low' };
export interface PdMessage { role: 'developer' | 'user'; content: PdContent[] }
export interface PdBody {
  model: string;
  instructions: string;
  input: PdMessage[];
  text: { format: { type: 'json_schema'; name: 'bae_order'; strict: true; schema: unknown } };
  store: false;
}

export interface PdRequestInput extends InstructionTexts {
  /** 설정 책장 models.pdModel (코드에 모델 이름을 두지 않는다). */
  model: string;
  materials: OrderMaterials;
  inputs: OrderInputs;
  styleMode: StyleMode;
  /** activeLibrary() — 켜 둔 예시만. */
  library: LibEntry[];
  manualIds: string[];
  /** 예시 썸네일 (libItem(e).thumb), id → 데이터 주소. PD 에게 보여 줄 것만 있으면 된다. */
  libThumbs: Record<string, string>;
  revise: ReviseInput | null;
  carry: string[];
  /** dirFor(...).ko */
  dir: string[];
}

/** PD 에게 보여 줄 예시 (HTML callPD 의 shown). */
export function shownLibrary(inp: Pick<OrderInputs, 'place'>, mode: StyleMode, lib: LibEntry[], manualIds: string[]): LibEntry[] {
  return inp.place ? [] : mode === 'auto' ? lib : manualIds.map((id) => lib.find((e) => e.id === id)).filter((e): e is LibEntry => !!e);
}

/**
 * HTML callPD 의 요청 몸. retryBody 는 지문이 있을 때만: developer 역할을 받지 않는 모델(400, /developer|role/)이면
 * 지문을 사용자 말 맨 앞에 붙여 다시 보내는 몸.
 */
export function buildPdRequest(q: PdRequestInput): { url: '/responses'; body: PdBody; retryBody: PdBody | null } {
  const inp = q.inputs, m = q.materials;
  const content: PdContent[] = [{ type: 'input_text', text: pdUserText(m, inp, q.styleMode, q.library, q.manualIds, q.revise, q.carry) }];
  content.push({ type: 'input_text', text: 'Image 1:' }); content.push({ type: 'input_image', image_url: inp.rough.small, detail: 'high' });
  if (inp.rough.annotated) { content.push({ type: 'input_text', text: "Image 1 with the artist's notes (only for you; the image model never sees the red notes):" }); content.push({ type: 'input_image', image_url: inp.rough.annotated, detail: 'high' }); }
  const off = inp.place ? inp.place.n : 0; const place = inp.place;
  if (place) place.items.forEach((it, i) => { content.push({ type: 'input_text', text: 'Image ' + (i + 2) + (place.mode === 'sheet' ? ' (model sheet):' : ' (base background ' + (i + 1) + '):') }); content.push({ type: 'input_image', image_url: it.small, detail: 'high' }); });
  inp.refs.forEach((it, i) => { content.push({ type: 'input_text', text: 'Image ' + (off + i + 2) + ':' }); content.push({ type: 'input_image', image_url: it.small, detail: 'auto' }); });
  if (q.revise && q.revise.reviewImage) { content.push({ type: 'input_text', text: "Last result made from the previous order sheet, with the art director's red marks (only for you; the image model never sees it):" }); content.push({ type: 'input_image', image_url: q.revise.reviewImage, detail: 'high' }); }
  for (const e of shownLibrary(inp, q.styleMode, q.library, q.manualIds)) {
    const thumb = q.libThumbs[e.id]; if (typeof thumb !== 'string') throw new Error('예시 ' + e.id + '의 썸네일이 없어요');
    content.push({ type: 'input_text', text: 'Style library ' + e.id + ': ' + e.name }); content.push({ type: 'input_image', image_url: thumb, detail: 'low' });
  }
  content.push({ type: 'input_text', text: 'Base style strip (always the last image):' }); content.push({ type: 'input_image', image_url: inp.base.small, detail: 'auto' });
  const dk = q.dir && q.dir.length ? q.dir : null;
  const body: PdBody = {
    model: q.model,
    instructions: pdInstructions(q, dk, false, inp.place, m.time, m.place),
    input: ((dk ? [{ role: 'developer', content: [{ type: 'input_text', text: dirMessage(dk) }] }] : []) as PdMessage[]).concat([{ role: 'user', content }]),
    text: { format: { type: 'json_schema', name: 'bae_order', strict: true, schema: dk ? ORDER_SCHEMA_DIR : ORDER_SCHEMA } },
    store: false,
  };
  const retryBody: PdBody | null = dk ? { ...body, input: [{ role: 'user', content: ([{ type: 'input_text', text: dirMessage(dk) }] as PdContent[]).concat(content) }] } : null;
  return { url: '/responses', body, retryBody };
}

/** HTML callPD: 첫 요청이 이 답이면 retryBody 로 다시 보낸다. */
export const pdShouldRetryWithoutDeveloper = (hasDir: boolean, status: number | undefined, message: string) => hasDir && status === 400 && /developer|role/i.test(message || '');

/** HTML outputText: Responses API 답에서 글을 꺼낸다. */
export function outputText(r: any): string {
  if (r && typeof r.output_text === 'string' && r.output_text) return r.output_text;
  for (const item of (r && r.output) || []) {
    if (item.type === 'message' && Array.isArray(item.content)) for (const c of item.content) {
      if (c.type === 'output_text' && c.text) return c.text;
      if (c.type === 'refusal') throw new Error('PD가 이 요청을 거절했어요: ' + c.refusal);
    }
  }
  throw new Error('주문서 응답이 비어 있어요. 다시 시도해 주세요.');
}

/** HTML callPD 뒷부분: 답을 주문서 JSON 으로 읽고 비용을 센다. prices = 설정 책장 prices.pd (백만 토큰당 달러). */
export function readPdResponse(r: any, model: string, prices: Record<string, [number, number]>): { obj: PdAnswer; cost: number | null } {
  let obj: PdAnswer;
  try { obj = JSON.parse(outputText(r)); } catch (e) { if (e instanceof Error && e.message.startsWith('PD')) throw e; throw new Error('주문서 형식을 읽지 못했어요. 다시 시도해 주세요.'); }
  if (!obj || !obj.prompt) throw new Error('주문서가 비어 있어요. 다시 시도해 주세요.');
  return { obj, cost: pdCost(r && r.usage, model, prices) };
}

export function pdCost(usage: { input_tokens?: number; output_tokens?: number } | null | undefined, model: string, prices: Record<string, [number, number]>): number | null {
  const p = Object.prototype.hasOwnProperty.call(prices, model) ? prices[model] : undefined; const u = usage || null;
  return (u && p) ? (u.input_tokens || 0) / 1e6 * p[0] + (u.output_tokens || 0) / 1e6 * p[1] : null;
}

/* ---------- 'API 키 없이 ChatGPT로 테스트하기' 글 (HTML btnCopyChat) ---------- */
export interface ChatTestInput extends InstructionTexts {
  materials: OrderMaterials;
  inputs: OrderInputs;
  styleMode: StyleMode;
  library: LibEntry[];
  manualPicks: string[];
}
export function chatTestText(q: ChatTestInput): { text: string; toast: string | null } {
  const inp = q.inputs, m = q.materials, lib = q.library;
  const picks = !inp.place && q.styleMode === 'manual' ? q.manualPicks.map((id) => lib.find((e) => e.id === id)).filter((e): e is LibEntry => !!e) : [];
  const toast = inp.rough.tilt ? 'ChatGPT 테스트에서는 기울기를 돌려 주지 않아요. 수평 그림이 나와요.'
    : !inp.place && q.styleMode === 'auto' && lib.length ? "ChatGPT 테스트에서는 '직접 고르기'로 고른 예시만 함께 보내요. 지금은 기준 이미지만 보내요." : null;
  const nPl = inp.place ? inp.place.n : 0, nR = inp.refs.length + nPl, nP = picks.length, base = nR + 2 + nP;
  const order = ['Image 1 = the layout source'];
  if (inp.place) order.push(inp.place.mode === 'sheet' ? 'Image 2 = the model sheet of the place' : nPl === 1 ? 'Image 2 = the base background' : 'Images 2 to ' + (nPl + 1) + ' = the base backgrounds');
  if (inp.refs.length) order.push((inp.refs.length === 1 ? 'Image ' + (nPl + 2) : 'Images ' + (nPl + 2) + ' to ' + (nR + 1)) + ' = the references');
  picks.forEach((e, i) => order.push('Image ' + (nR + 2 + i) + ' = style example ' + e.id + ' (' + e.name + ')'));
  order.push('Image ' + base + ' = the base style strip');
  const userText = pdUserText(m, inp, 'manual', lib, picks.map((e) => e.id), null, null); const dirK = dirNotes(m.request);
  const text = pdInstructions(q, dirK.length ? dirK : null, true, inp.place, m.time, m.place) + '\n\n' + blocksForChat(q.fixedText, m.time, m.place) + (inp.place ? '\n[SAME PLACE] = ' + samePlaceSentence(inp.place) : '') + (inp.rough.tilt ? '\nBefore "Aspect ratio", add this sentence: ' + TILT_SENTENCE : '') + (dirK.length ? '\n\n' + dirMessage(dirK) : '') + '\n\n---\n\n' + userText +
    '\n\nIn this chat the images are attached in this exact order: ' + order.join('; ') + '. The style library thumbnails are not attached.' +
    (inp.rough.annotated ? ' "Image 1 with notes" is not attached either: read the note list above instead.' : '') +
    '\nWrite the real numbers instead of the placeholders: {S1} = ' + (nP >= 1 ? nR + 2 : '(none)') + ', {S2} = ' + (nP >= 2 ? nR + 3 : '(none)') + ', {BASE} = ' + base + '. Leave out the style example sentence if there are no style examples.' +
    '\nFirst show the order sheet as JSON (summary_ko, notes_ko, style_picks, style_reason_ko' + (dirK.length ? ', director_en, director_replaced' : '') + ', prompt). Then generate the image yourself, using exactly the prompt you wrote and the attached images.';
  return { text, toast };
}
