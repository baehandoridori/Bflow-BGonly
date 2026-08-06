/**
 * 댓글/메모 텍스트를 엔티티 토큰으로 분해.
 *  - path: G:\ 경로 (pathLink.ts 규칙 재사용 — 줄끝까지)
 *  - mention: @이름 (userNames 에 정확히 매칭될 때만)
 *  - hash: #씬·파트·화 태그 마크다운 링크식 [#라벨](bscene|bpart|bepisode:...) (4c). parseHashTarget 로 검증.
 *  - text: 그 외
 *
 * ⚠️ 멘션 규칙(MENTION_REGEX + userNames.includes)은 commentService.extractMentions 와
 *    반드시 동일하게 유지한다. 한쪽만 바꾸면 '알림은 가는데 칩은 안 뜸' 회귀가 난다.
 *
 * 경로를 먼저 분리한 뒤(중첩 회피) 각 text 조각에서 mention·hash 를 위치순 병합한다
 * (PathLinkifiedText 의 renderTextSegment 철학 계승). 순수 함수 — node:test 검증.
 */
import { tokenizeGPaths } from './pathLink.ts';
import { parseHashTarget, type HashTarget } from './hashEntity.ts';

export type EntityToken =
  | { type: 'text'; content: string }
  | { type: 'path'; content: string }
  | { type: 'mention'; content: string; name: string }
  | { type: 'hash'; content: string; label: string; target: HashTarget };

const MENTION_REGEX = /@(\S+)/g;
// 4c: #씬·파트·화 태그(마크다운 링크식). [#라벨](bscene|bpart|bepisode:...) — 타깃은 parseHashTarget 로 검증.
const HASH_LINK_REGEX = /\[#([^\]]+)\]\((b(?:scene|part|episode|costume):[^)]+)\)/g;

function tokenizeTextSegment(text: string, userNames: string[]): EntityToken[] {
  const matches: { start: number; end: number; token: EntityToken }[] = [];
  for (const m of text.matchAll(MENTION_REGEX)) {
    if (m.index === undefined || !userNames.includes(m[1])) continue; // 무효 @ 는 평문으로
    matches.push({ start: m.index, end: m.index + m[0].length, token: { type: 'mention', content: m[0], name: m[1] } });
  }
  for (const m of text.matchAll(HASH_LINK_REGEX)) {
    if (m.index === undefined) continue;
    const target = parseHashTarget(m[2]);
    if (!target) continue; // 잘못된 타깃은 평문 유지
    matches.push({ start: m.index, end: m.index + m[0].length, token: { type: 'hash', content: m[0], label: m[1], target } });
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

/**
 * 직렬화된 엔티티 텍스트를 '평문 표시용' 문자열로 환원한다(4c).
 *  - #태그 마크다운 토큰('[#a001](bscene:...)') → '#a001'(라벨만)
 *  - 멘션('@이름')·경로(G:\...)·그 외 텍스트 → 그대로
 * EntityText(칩) 를 못 쓰는 표시 자리(검색 미리보기·truncate/slice·아카이브 트리 등)에서
 * 직렬화 토큰이 그대로 노출되지 않게 한다. 결과는 일반 문자열이라 slice/하이라이트와 호환된다.
 * 멘션 판별에 userNames 가 필요 없다(평문 환원 결과가 동일) → 인자 없이 호출한다.
 */
export function stripEntityTokens(text: string): string {
  if (!text) return '';
  return tokenizeEntities(text, [])
    .map((tok) => (tok.type === 'hash' ? `#${tok.label}` : tok.content))
    .join('');
}
