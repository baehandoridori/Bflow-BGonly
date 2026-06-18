/**
 * 댓글/메모 텍스트를 엔티티 토큰으로 분해(스펙 §10.2 — 3단계: 멘션·경로).
 *  - path: G:\ 경로 (기존 pathLink.ts 규칙 재사용 — 줄끝까지)
 *  - mention: @이름 (userNames 에 정확히 매칭될 때만)
 *  - text: 그 외
 *
 * ⚠️ 멘션 규칙(MENTION_REGEX + userNames.includes)은 commentService.extractMentions 와
 *    반드시 동일하게 유지한다. 한쪽만 바꾸면 '알림은 가는데 칩은 안 뜸' 회귀가 난다.
 * ⚠️ 씬·컷 번호(컷N/cutN/씬N…)는 4단계에서 추가한다(클릭 점프와 함께). 여기엔 넣지 않는다.
 *
 * 경로를 먼저 분리한 뒤(중첩 회피) 각 text 조각에서 mention 을 분리한다
 * (PathLinkifiedText 의 renderTextSegment 철학 계승). 순수 함수 — node:test 검증.
 */
import { tokenizeGPaths } from './pathLink.ts';

export type EntityToken =
  | { type: 'text'; content: string }
  | { type: 'path'; content: string }
  | { type: 'mention'; content: string; name: string };

const MENTION_REGEX = /@(\S+)/g;

function tokenizeTextSegment(text: string, userNames: string[]): EntityToken[] {
  const out: EntityToken[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_REGEX)) {
    if (m.index === undefined) continue;
    if (!userNames.includes(m[1])) continue; // 무효 @ 는 평문으로(아래 text 흡수)
    if (m.index > last) out.push({ type: 'text', content: text.slice(last, m.index) });
    out.push({ type: 'mention', content: m[0], name: m[1] });
    last = m.index + m[0].length;
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
