/**
 * caret 위치 기반 #태그 트리거 감지 + 삽입(4c). mentionQuery(@) 패턴의 # 버전.
 * detectHashtagQuery: caret 왼쪽으로 스캔, '#' 발견 시 query(공백 없음) 반환.
 * applyHashtag: '#쿼리' 범위를 마크다운 링크식 토큰으로 치환(serializeHashTag).
 * 순수 함수 — React/DOM 의존 없음. node:test 검증.
 */
import { serializeHashTag, type HashTag } from './hashEntity.ts';

const MAX_QUERY_LEN = 30;

export interface HashtagQuery {
  query: string; // '#' 뒤부터 caret 까지(공백 없음)
  start: number; // '#' 인덱스
  end: number; // caret 인덱스
}

export function detectHashtagQuery(text: string, caret: number): HashtagQuery | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '#') {
      // '#' 앞이 영숫자면 단어 내부(예 'abc#x')라 트리거 제외. 한글·기호·공백·시작은 허용.
      // 앞이 '[' 이면 직렬화된 태그 내부(예 '[#a001](bscene:...)')라 새 쿼리로 오인 금지.
      const before = i === 0 ? '' : text[i - 1];
      if (i !== 0 && (before === '[' || /[A-Za-z0-9]/.test(before))) return null;
      const query = text.slice(i + 1, caret);
      if (query.length >= MAX_QUERY_LEN) return null;
      if (/\s/.test(query)) return null;
      return { query, start: i, end: caret };
    }
    if (/\s/.test(ch)) return null; // 공백 만나면 토큰 종료 → 해시 아님
    i -= 1;
  }
  return null;
}

export function applyHashtag(
  text: string,
  start: number,
  end: number,
  tag: HashTag,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const needSpace = !after.startsWith(' ');
  const insert = `${serializeHashTag(tag)}${needSpace ? ' ' : ''}`;
  return { text: before + insert + after, caret: before.length + insert.length };
}
