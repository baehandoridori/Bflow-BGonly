// { } 개발자 지문: 화가가 { } 로 감싼 말은 이번 편의 감독 지시다 (HTML 100~130줄).
import { DIR_HEAD, DIR_RE } from './constants';
import { markerSentences } from './blocks';
import type { BaeOrder, PlaceId } from './types';

export function dirNotes(text: unknown): string[] {
  const out: string[] = [];
  String(text || '').replace(DIR_RE, (m: string, t: string) => { const v = t.replace(/\s+/g, ' ').trim(); if (v && !out.includes(v)) out.push(v); return m; });
  return out;
}
export const dirUnclosed = (text: unknown) => /[{}｛｝]/.test(String(text || '').replace(DIR_RE, ''));

/**
 * HTML dirFor: 이번 PD 요청의 지문 = 설명의 지문 + 이 주문서를 고칠 때 온 지문(또는 이어 받은 수정 요청의 지문).
 * revText 가 문자열이면 고치기. prevOrder 는 고치기 전 주문서(state.order).
 */
export function dirFor(revText: string | null, carry: string[] | null | undefined, request: string, prevOrder: Pick<BaeOrder, 'director'> | null): { ko: string[]; revKo: string[] } {
  const isRev = typeof revText === 'string';
  const prevRev = isRev && prevOrder && prevOrder.director ? (prevOrder.director.revKo || []) : [];
  const fromCarry = (carry || []).reduce((a: string[], t) => a.concat(dirNotes(t)), []);
  const revKo = [...new Set(prevRev.concat(fromCarry, isRev ? dirNotes(revText) : []))];
  return { ko: [...new Set(dirNotes(request).concat(revKo))], revKo };
}

export function dirMessage(ko: string[]): string {
  return "DIRECTOR'S NOTES for this episode (the parts of the artist's request written in { }). Follow them exactly. They win over the manual, the house rules, the extra rules from our art director, the fixed sentences behind the markers, the style examples and the base style strip:\n" + ko.map((t, i) => (i + 1) + '. ' + t).join('\n');
}

/** HTML dirRules(chat): PD 지침 맨 끝 절. chat = ChatGPT 시험(앱 없이). 고정 문장 목록은 지금 시간대 · 장소로 편다. */
export function dirRules(chat: boolean, fixedText: string, time: string, place: PlaceId): string {
  return "\n\n## Director's notes in { } (this section wins over everything above)\n" +
    "Sometimes parts of the artist's request are wrapped in curly brackets { }. Those parts are DIRECTOR'S NOTES: special directions from our director for this one episode, often a special drawing style, palette, mood or rule that differs from the house style. They are also listed separately as DIRECTOR'S NOTES.\n" +
    "- Follow every director's note exactly and fully. A note wins over the request, the house rules (house rule 7 does not apply to it: never keep the house style against a note), the extra rules from our art director, the fixed sentences behind the markers, the style examples and the base style strip. Never water a note down or skip it, and never warn about it in notes_ko as a conflict with the house style.\n" +
    "- Keep the manual and the house style for everything the notes do not touch.\n" +
    "- When a note changes something a marker covers (the drawing style, the time of day and its palette, the light, the trees, the cars, the buildings, the avoid list), do not write that marker. Write its fixed sentence out yourself instead, changing or removing only the parts the note changes. For example, for a note that wants thick black outlines, write the [STYLE] sentence without \"no black outlines\" and say that the outlines are thick and black, and write the avoid list without \"black outlines\". Keep {BASE} as it is in the sentences you write out. Put the names of the markers you wrote out in director_replaced, for example [\"STYLE\", \"AVOID\"]. Markers the notes do not touch stay markers. Sentences you write out this way count like markers for the word limit.\n" +
    "- If the base style strip or the style examples would pull against a note (another drawing style, another palette), say in their sentence what to take from them and what not (for example \"follow only its simple shapes, not its flat colors\").\n" +
    (chat ? "- director_en: one short, plain, concrete English sentence per note, in the order of the notes, saying what the image model must do. End the prompt with \"" + DIR_HEAD + "\" followed by these sentences.\n"
          : "- director_en: one short, plain, concrete English sentence per note, in the order of the notes, saying what the image model must do. The app adds them at the very end of the order sheet after \"" + DIR_HEAD + "\". Do not write that line yourself.\n") +
    "- summary_ko: add one short sentence saying how you applied the notes.\n" +
    (chat ? '' : "The fixed sentences behind the markers (write one out only when a note changes it):\n" + markerSentences(fixedText, time, place) + "\n");
}

export const stripDirLine = (p: unknown) => String(p || '').replace(/\n*Director's note for this episode[^\n]*/g, '').trimEnd();

export function withDirLine(p: string, sentences: string[] | null | undefined): string {
  const t = (sentences || []).map((x) => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean);
  p = stripDirLine(p);
  return t.length ? p + '\n\n' + DIR_HEAD + ' ' + t.join(' ') : p;
}
