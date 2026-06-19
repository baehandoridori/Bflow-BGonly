/**
 * 댓글/메모 텍스트를 엔티티 토큰으로 분해(스펙 §10.2 — 3단계: 멘션·경로).
 *  - path: G:\ 경로 (기존 pathLink.ts 규칙 재사용 — 줄끝까지)
 *  - mention: @이름 (userNames 에 정확히 매칭될 때만)
 *  - text: 그 외
 *
 * ⚠️ 멘션 규칙(MENTION_REGEX + userNames.includes)은 commentService.extractMentions 와
 *    반드시 동일하게 유지한다. 한쪽만 바꾸면 '알림은 가는데 칩은 안 뜸' 회귀가 난다.
 * 4a: 씬·컷 번호(컷N/cutN)도 감지. '씬N'은 sceneId(예 '5A')와 혼동 위험이라 제외(컷만 수치).
 *    앞 경계는 영숫자만 차단(uncut3 단어 내부 방지). 한글 바로 뒤(예 '한컷3')는 허용.
 *
 * 경로를 먼저 분리한 뒤(중첩 회피) 각 text 조각에서 mention·cut 을 위치순 병합한다
 * (PathLinkifiedText 의 renderTextSegment 철학 계승). 순수 함수 — node:test 검증.
 */
import { tokenizeGPaths } from './pathLink.ts';

export type EntityToken =
  | { type: 'text'; content: string }
  | { type: 'path'; content: string }
  | { type: 'mention'; content: string; name: string }
  | { type: 'cut'; content: string; number: number };

const MENTION_REGEX = /@(\S+)/g;
const CUT_REGEX = /(?<![A-Za-z0-9])(?:컷|cut)\s*(\d+)/gi;

function tokenizeTextSegment(text: string, userNames: string[]): EntityToken[] {
  const matches: { start: number; end: number; token: EntityToken }[] = [];
  for (const m of text.matchAll(MENTION_REGEX)) {
    if (m.index === undefined || !userNames.includes(m[1])) continue; // 무효 @ 는 평문으로
    matches.push({ start: m.index, end: m.index + m[0].length, token: { type: 'mention', content: m[0], name: m[1] } });
  }
  for (const m of text.matchAll(CUT_REGEX)) {
    if (m.index === undefined) continue;
    matches.push({ start: m.index, end: m.index + m[0].length, token: { type: 'cut', content: m[0], number: parseInt(m[1], 10) } });
  }
  matches.sort((a, b) => a.start - b.start);
  const out: EntityToken[] = [];
  let last = 0;
  for (const mt of matches) {
    if (mt.start < last) continue; // 겹침은 앞선 토큰 우선
    if (mt.start > last) out.push({ type: 'text', content: text.slice(last, mt.start) });
    out.push(mt.token);
    last = mt.end;
  }
  if (last < text.length) out.push({ type: 'text', content: text.slice(last) });
  return out;
}

export function tokenizeEntities(text: string, userNames: string[]): EntityToken[] {
  if (!text) return [];
  const out: EntityToken[] = [];
  for (const tok of tokenizeGPaths(text)) {
    if (tok.type === 'path') out.push({ type: 'path', content: tok.content });
    else out.push(...tokenizeTextSegment(tok.content, userNames));
  }
  return out;
}
