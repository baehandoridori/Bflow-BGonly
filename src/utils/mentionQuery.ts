/**
 * caret 위치 기반 @멘션 트리거 감지 (스펙 §10.2 — 텍스트 '중간'에서도 동작).
 *
 * 기존 댓글 입력은 text.lastIndexOf('@') 로 '마지막 @' 만 봐서 중간 멘션을 못 했다.
 * 여기서는 caret 에서 왼쪽으로 토큰 시작을 스캔하므로 어느 위치에서든 멘션이 잡힌다.
 * 순수 함수 — React/DOM 의존 없음. node:test 로 검증.
 */

const MAX_QUERY_LEN = 20;

export interface MentionQuery {
  query: string; // @ 뒤부터 caret 까지의 텍스트(공백 없음)
  start: number; // '@' 인덱스
  end: number;   // caret 인덱스 (호출부 activeRange.end 와 동일 계약)
}

/** caret 위치에서 활성 멘션 토큰을 찾는다. 없으면 null. */
export function detectMentionQuery(text: string, caret: number): MentionQuery | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') {
      // '@' 앞이 영문/숫자면 이메일(a@b) 가능성이라 멘션 트리거 제외.
      // 그 외(한글·기호·공백·문자열 시작)는 허용 — 한글은 '@'를 앞 단어에 공백 없이 붙여 쓰는 게
      // 자연스럽고, 표시 칩(EntityText)·알림(extractMentions, /@(\S+)/, 앞 무관)과 트리거를 정렬한다.
      const before = i === 0 ? '' : text[i - 1];
      if (i !== 0 && /[A-Za-z0-9]/.test(before)) return null;
      const query = text.slice(i + 1, caret);
      if (query.length >= MAX_QUERY_LEN) return null;
      if (/\s/.test(query)) return null;
      return { query, start: i, end: caret };
    }
    if (/\s/.test(ch)) return null; // 공백 만나면 토큰 종료 → 멘션 아님
    i -= 1;
  }
  return null;
}

/** 멘션 토큰(start~end)을 `@이름 ` 으로 치환하고 새 caret 위치를 돌려준다. */
export function applyMention(
  text: string,
  start: number,
  end: number,
  name: string,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const needSpace = !after.startsWith(' ');
  const insert = `@${name}${needSpace ? ' ' : ''}`;
  return { text: before + insert + after, caret: before.length + insert.length };
}
