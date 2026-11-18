/**
 * BAE경 '다른 각도로'의 글 (HTML v0.4.11 script_4.js 2755~3172줄 ANG 의 주문서 부분, 3999~4163줄의 메모 · 금액 · 이름).
 * 화면(엔진) · 메인(PD메모 요청 · 그림 주문서) · 시험이 함께 쓴다. DOM · Electron · '@/' 없이 상대 경로만 (node --test 가 바로 읽는다).
 *
 * 주문서는 카메라 문장 하나만 입체 판(엔진)에서 오고, 나머지는 장소 종류와 몇 가지 켬/끔으로 정해진다. 그래서 메인은
 * 화면이 보낸 카메라 문장으로 PD메모를 읽은 뒤에 주문서를 마저 만든다 (anglePromptText). 글자 하나도 HTML 과 다르면 안 된다.
 */
import { RATIOS, RATIO_ORDER, type TierId } from '../order/constants';
import { ratioNum } from '../order/sizes';

export type AngleKind = 'interior' | 'exterior';
export interface AngleKindInfo { h: number; zmax: number; ph: number; k: number; noun: string; mid: string; fill: string; same: string }
/** HTML ANG.KIND: 실내 · 실외의 눈높이(m) · 가장 먼 깊이 · 보는 곳 높이 · 돌기 반지름 · 주문서 낱말. */
export const ANGLE_KIND: Record<AngleKind, AngleKindInfo> = {
  interior: { h: 1.2, zmax: 25, ph: 0.8, k: 0.85, noun: 'the room', mid: 'the middle of the room', fill: 'continue the walls, floor and furniture', same: 'the same walls, floor, furniture and objects' },
  exterior: { h: 1.5, zmax: 60, ph: 1.6, k: 1.0, noun: 'the scene', mid: 'the middle of the scene', fill: 'continue the buildings, ground, plants and street', same: 'the same buildings, ground, plants and objects' },
};

/** 바로 고르기 버튼 (HTML AG_PRE). 'vp' = 투시만 바꾸기. */
export type AnglePreset = 'orig' | 'left45' | 'left20' | 'right20' | 'right45' | 'high' | 'low' | 'vp';
export const ANGLE_PRESET_LABEL: Record<AnglePreset, string> = { left45: '왼쪽 45°', left20: '왼쪽 20°', orig: '원래대로', right20: '오른쪽 20°', right45: '오른쪽 45°', high: '하이 앵글', low: '로우 앵글', vp: '투시만 바꾸기' };

/** 같은 공간 그림 (HTML AG_EXMAX · AG_EXCOL · AG_EXL · AG_EXKO): 8장까지, 그림마다 도면의 색. */
export const ANGLE_EX_MAX = 8;
export const ANGLE_EX_COLORS = ['#ea7a0e', '#0f9aa8', '#8e44ad', '#2e9e44', '#2f6fd6', '#d6449a', '#8a6a4b', '#a8901a'];
export const ANGLE_EX_LETTERS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
export const ANGLE_EX_COLOR_KO = ['주황', '청록', '보라', '초록', '파랑', '분홍', '갈색', '황토'];
/** B 화면의 0.5% 이상 보이는 더한 그림만 GPT 에게 (HTML AG_SEND_MIN). */
export const ANGLE_SEND_MIN = 0.005;
/** 밑면이 B 화면의 2% 이상이면 주문서에 (AG_UNDER_MIN), 투시만 바꾸기는 새로 그릴 곳 25% 부터 경고 (AG_VP_MUCH). */
export const ANGLE_UNDER_MIN = 0.02;
export const ANGLE_VP_MUCH = 0.25;

/** v0.4.10: 1m 아래는 5cm 단위 (HTML ANG.mKo · mEn). */
export const angleMKo = (h: number): string => h < 0.975 ? String(Math.round(h * 20) / 20) : h.toFixed(1);
export const angleMEn = (h: number): number => h < 0.975 ? Math.round(h * 20) / 20 : Math.round(h * 10) / 10;

/** PD메모가 주문서에 들어가는 모양: PD 가 쓴 문장, 또는 PD 를 못 불렀을 때 메모 글과 자리 그대로. */
export interface AngleMemo { pd?: string | null; raw?: string[] | null }
/** HTML ANG memoText. */
export function angleMemoText(m: AngleMemo | null | undefined): string {
  if (m && m.pd) return 'The art director\'s notes for this view: ' + String(m.pd).trim().replace(/\s+/g, ' ').replace(/([^.!?])$/, '$1.') + ' ';
  if (m && m.raw && m.raw.length) return 'The art director\'s notes for this view, with places in image 1 as x from the left and y from the top (never write these words in the picture): ' + m.raw.join('; ') + '. ';
  return '';
}
/** v0.4.10 밑면 문장 (HTML ANG.UNDER). */
export const ANGLE_UNDER = 'The eye is now lower than some things, such as a table top, so their top surfaces are hidden from here. The darker flat shapes in image 1 are their undersides seen from below: draw them as the underside and the front edge of those things, with their legs. ';

/** 주문서의 켬/끔 (HTML ANG.prompt 의 x): 더한 그림 수 · 붓 · PD메모 · 가까이 잡은 샷 · 밑면. */
export interface AnglePromptOpts { n?: number; notes?: boolean; memo?: AngleMemo | null; crop?: boolean; under?: boolean }

/**
 * HTML ANG.prompt / promptTight 그대로. sentence = 카메라 문장: 가까이 잡은 샷(crop)이면 ANG.sentence(S, cam, { tight: true }),
 * 아니면 ANG.sentence(S, cam). 둘 다 아니면 실험 1의 v0.4.5 주문서와 글자까지 같다.
 */
export function anglePromptText(kind: AngleKind, sentence: string, x: AnglePromptOpts = {}): string {
  const K = ANGLE_KIND[kind], n = Math.max(0, Math.min(8, x.n || 0)), refs = n ? 'images 2 to ' + (n + 2) : 'image 2';
  const nameN = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n];
  if (x.crop) return promptTight(sentence, x, n);
  const head = n ? 'Image 1 shows the place of ' + (n === 1 ? 'images 2 and 3' : refs) + ' from a new camera: ' + (n === 1 ? 'images 2 and 3' : refs) + ' are ' + nameN + ' views of the same place, 3D copies of them were put together and moved to this camera, so image 1 has the right camera, layout and positions, but it is rough. ' +
    'Flat grey areas are parts none of these pictures showed, and some edges are stretched or smeared. '
    : 'Image 1 shows the place of image 2 from a new camera: a 3D copy of image 2 was moved to this camera, so image 1 has the right camera, layout and positions, but it is rough. ' +
    'Flat grey areas are parts the original picture never showed, and some edges are stretched or smeared. ';
  const notes = (x.notes ? 'Loose colored brush strokes on image 1 are the artist\'s rough notes for what is there: follow their colors and placement, but draw those things properly in the style. ' : '') +
    angleMemoText(x.memo);   // v0.4.8 PD메모
  const same = n === 1 ? 'images 2 and 3' : refs;
  return head + (x.under ? ANGLE_UNDER : '') + notes + 'Draw the finished background exactly from the camera of image 1: keep its composition and the positions and sizes of everything in it, redraw everything cleanly, and fill the grey areas with what naturally belongs there (' + K.fill + '). ' +
    'It must clearly be the same place as ' + same + ' (' + K.same + ', with the same colors and the same light). For reference, the camera move' + (n ? ' from the camera of image 2' : '') + ' is: ' + sentence + ' ' +
    'Keep the exact drawing style of the reference' + (n ? 's' : '') + ': flat cel colors with hard edges, no gradients, no glow, no texture, no black outlines, shapes slightly hand-drawn and uneven, the same palette and the same brightness. No people, no new text or signs.';
}
// v0.4.9: a closer, tighter shot - image 2 is the part of the original that the new camera sees (cut out and enlarged)
function promptTight(sentenceTight: string, x: AnglePromptOpts, n: number): string {
  const both = n === 1 ? 'images 2 and 3' : 'images 2 to ' + (n + 2), others = n === 1 ? 'image 3' : n === 2 ? 'images 3 and 4' : 'images 3 to ' + (n + 2);
  const head = n ? 'Image 1 shows part of the place of ' + both + ' from a new, closer camera: image 2 is the part of the original picture that this camera sees (cut out of the original and enlarged), and ' + others + (n === 1 ? ' is another view' : ' are other views') + ' of the same place; 3D copies of the pictures were put together and moved to this camera, so image 1 has the right camera, framing and positions, but it is rough. ' +
    'Flat grey areas are parts none of these pictures showed, and some edges are stretched or smeared. '
    : 'Image 1 shows part of the place of image 2 from a new, closer camera: image 2 is the part of the original picture that this camera sees (cut out of the original and enlarged), and a 3D copy of the original picture was moved to this camera, so image 1 has the right camera, framing and positions, but it is rough. ' +
    'Flat grey areas are parts the original picture never showed, and some edges are stretched or smeared. ';
  const notes = (x.notes ? 'Loose colored brush strokes on image 1 are the artist\'s rough notes for what is there: follow their colors and placement, but draw those things properly in the style. ' : '') + angleMemoText(x.memo);
  return head + (x.under ? ANGLE_UNDER : '') + notes + 'Draw the finished background exactly from the camera of image 1: keep its framing, its composition and the positions and sizes of everything in it. ' +
    'Do not zoom out or widen the view, and do not add anything that is not in image 1: what is outside its frame stays out of the picture. Redraw everything cleanly and fill the grey areas by continuing what is next to them. ' +
    'Everything must look exactly as it does in ' + (n ? 'the references' : 'image 2') + ' (the same shapes, colors, materials and light). For reference, the camera move from the original picture\'s camera is: ' + sentenceTight + ' ' +
    'Keep the exact drawing style of the reference' + (n ? 's' : '') + ': flat cel colors with hard edges, no gradients, no glow, no texture, no black outlines, shapes slightly hand-drawn and uneven, the same palette and the same brightness. No people, no new text or signs.';
}

/* ---------- PD메모 (HTML 4057~4105줄): 자리는 밑그림의 % (x 왼쪽부터, y 위부터) ---------- */
export type AngleNote =
  | { type: 'text'; x: number; y: number; text: string; size: number; seq?: number }
  | { type: 'arrow'; x1: number; y1: number; x2: number; y2: number; w?: number; seq?: number }
  | { type: 'mark'; pts: Array<[number, number]>; w?: number; seq?: number };

export const anglePct = (x: number, y: number): string => 'x ' + Math.round(x * 100) + '%, y ' + Math.round(y * 100) + '%';
export function angleNoteSpan(n: { pts: Array<[number, number]> }): { c: string; w: number; h: number } {
  const xs = n.pts.map((q) => q[0]), ys = n.pts.map((q) => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { c: anglePct((x0 + x1) / 2, (y0 + y1) / 2), w: Math.round((x1 - x0) * 100), h: Math.round((y1 - y0) * 100) };
}
/** PD 에게 주는 메모 목록 (HTML agNotesSummary). 결과 기록의 inputs.notes 에도 이 글. */
export function angleNotesSummary(list: readonly AngleNote[]): string {
  return list.map((n) => {
    if (n.type === 'text') return '- text "' + n.text.replace(/\s+/g, ' ').trim() + '" at (' + anglePct(n.x, n.y) + ')';
    if (n.type === 'arrow') return '- arrow from (' + anglePct(n.x1, n.y1) + ') to (' + anglePct(n.x2, n.y2) + ')';
    const b = angleNoteSpan(n); return '- circled or marked area around (' + b.c + '), about ' + b.w + '% wide and ' + b.h + '% tall';
  }).join('\n');
}
/** PD 가 메모를 못 읽었을 때 주문서에 그대로 넣는 글 (HTML agNotesRaw). */
export function angleNotesRaw(list: readonly AngleNote[]): string[] {
  return list.map((n) => n.type === 'text' ? '"' + n.text.replace(/\s+/g, ' ').trim() + '" at (' + anglePct(n.x, n.y) + ')' : n.type === 'arrow' ? 'something pointed at from (' + anglePct(n.x1, n.y1) + ') to (' + anglePct(n.x2, n.y2) + ')' : ((b) => 'the marked area around (' + b.c + '), about ' + b.w + '% wide and ' + b.h + '% tall')(angleNoteSpan(n)));
}
export const ANGLE_MEMO_SCHEMA = { type: 'object', properties: { notes_en: { type: 'string' }, notes_ko: { type: 'string' } }, required: ['notes_en', 'notes_ko'], additionalProperties: false };
export const ANGLE_MEMO_INS = ['You are the PD of a background art team. The art director is redrawing a place from a new camera.',
  'Image 1 is the rough of the new view that the picture model will get: a 3D copy of the earlier pictures seen from the new camera. Flat grey areas are parts no picture showed (the picture model fills them). Loose colored brush strokes are the art director\'s rough paint; they stay in image 1.',
  'Image 2 is the same rough with the art director\'s notes in pink-red: handwritten words, arrows and circled areas. The picture model never sees these notes. They are also listed in text, with their places as percent of the picture (x from the left, y from the top).',
  'Write what the notes ask for as short, plain English sentences for the picture model (notes_en), saying where by what is there and where it is in the frame (left, right, top, bottom, middle, the grey area ...). Translate Korean. Keep exactly the art director\'s intent and add nothing else.',
  'Never mention notes, arrows, circles, marks, pink or red, and never ask for written words in the picture. Give the same in one or two short Korean sentences (notes_ko) for the art director to check.'].join('\n');

/** HTML agMemoPD 의 요청 몸 (POST /responses). clean · noted = 메모 없는 · 있는 밑그림 (1024 폭 JPEG 데이터 주소). */
export function angleMemoBody(model: string, clean: string, noted: string, summary: string): Record<string, unknown> {
  const content = [{ type: 'input_text', text: 'The art director\'s notes on image 1:\n' + summary },
    { type: 'input_text', text: 'Image 1:' }, { type: 'input_image', image_url: clean, detail: 'high' },
    { type: 'input_text', text: 'Image 2 (image 1 with the notes; only for you):' }, { type: 'input_image', image_url: noted, detail: 'high' }];
  return { model, instructions: ANGLE_MEMO_INS, input: [{ role: 'user', content }], text: { format: { type: 'json_schema', name: 'bae_angle_notes', strict: true, schema: ANGLE_MEMO_SCHEMA } }, store: false };
}
/** HTML agMemoPD 의 답 읽기: notes_en 이 비면 실패 (그러면 메모 글을 그대로 넣는다). outputText 는 답의 글. */
export function readAngleMemo(outputText: string): { en: string; ko: string } {
  const obj = JSON.parse(outputText) as { notes_en?: unknown; notes_ko?: unknown };
  const en = String(obj.notes_en || '').trim(); if (!en) throw new Error('PD가 메모를 비워서 돌려줬어요');
  return { en, ko: String(obj.notes_ko || '').trim() };
}

/* ---------- 금액 줄 (HTML agEst · agMemoEst) ---------- */
/** GPT 그림 1장 어림 (실험에서 잰 값). n = 같이 보내는 더한 그림 수 (한 장에 약 10~20원 더). */
export function angleEst(n: number, krwPerUsd: number): string {
  const r = Number(krwPerUsd) || 1400, k = (u: number) => (Math.round(u * r / 10) * 10).toLocaleString('ko-KR');
  return '약 ' + k(0.056 + 0.010 * n) + '~' + k(0.07 + 0.015 * n) + '원';
}
/** PD 메모 읽기 어림: 입력 2,600 · 출력 900 토큰. price = 설정의 그 PD 모델 [입력, 출력] (백만 토큰당 달러). */
export function angleMemoEst(price: [number, number] | null | undefined, krwPerUsd: number): string {
  const p = price || [2, 10], r = Number(krwPerUsd) || 1400;
  return '약 ' + Math.max(1, Math.round((2600 * p[0] + 900 * p[1]) / 1e6 * r)) + '원';
}

/** 그림 모델에 부탁할 크기 (HTML agOutSize): 결과 그림은 그 크기 그대로, 다른 그림은 가장 가까운 비율의 지금 크기. */
export function angleOutSize(t: { kind: 'result' | 'file'; w: number; h: number }, tier: TierId = 'm'): [number, number] {
  const w = t.w, h = t.h;
  if (t.kind === 'result' && w % 16 === 0 && h % 16 === 0 && Math.max(w / h, h / w) <= 3 && w * h <= 3840 * 2160) return [w, h];
  const r = w / h, key = RATIO_ORDER.find((k) => Math.abs(ratioNum(k) - r) / r < 0.01);
  if (key) return (RATIOS[key].sizes[tier] || RATIOS[key].sizes.m).slice() as [number, number];
  const rr = Math.min(3, Math.max(1 / 3, r)), area = 2048 * 1152; return [Math.round(Math.sqrt(area * rr) / 16) * 16, Math.round(Math.sqrt(area / rr) / 16) * 16];
}
/** 결과의 비율 칸 (HTML: 원래 결과의 비율, 아니면 크기에서 찾은 비율). */
export function angleRatioOf(size: [number, number]): string | null {
  return RATIO_ORDER.find((k) => Math.abs(ratioNum(k) - size[0] / size[1]) / (size[0] / size[1]) < 0.01) || null;
}
/** 결과 파일 이름 (HTML rec.name): '거실_각도_오른쪽45.png'. */
export function angleResultName(fromName: string, label: string): string {
  const base = (fromName || 'BAE경.png').replace(/\.(png|jpe?g|webp)$/i, '');
  return base + '_각도_' + label.replace(/[\s°·]+/g, '') + '.png';
}
/** 결과 요약 줄 (HTML rec.summary). */
export function angleSummaryLine(label: string, nEx: number, strokes: number, notes: number, fromKind: 'result' | 'file', fromName: string): string {
  const base = (fromName || 'BAE경.png').replace(/\.(png|jpe?g|webp)$/i, '');
  return '다른 각도로: ' + label + (nEx ? ' + 같은 공간 그림 ' + nEx + '장' : '') + (strokes ? ' + 러프 덧대기' : '') + (notes ? ' + 메모 ' + notes + '개' : '') + ' (' + (fromKind === 'file' ? '불러온 그림 ' : '') + base + ')';
}
