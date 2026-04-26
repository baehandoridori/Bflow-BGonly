/**
 * G:\ 경로 인식 정규식.
 *
 * 본 모듈에서만 정의하고 메모(InlineTextareaRow) / 댓글(CommentPanel) / 메모위젯(PathLinkExtension Decoration) 3곳이
 * import해 공유한다. 정규식이 어긋나면 인식 결과가 분기되어 일관성이 깨지므로 상수로 묶어둔다.
 *
 * 종결자: 줄바꿈(\n, \r). Studio JBBJ 표준 폴더명에 공백이 들어가므로(예: "G:\공유 드라이브\...")
 * 단순 공백은 종결자로 쓰지 않는다. 사용자가 한 줄 안에 "G:\path 추가설명"처럼 쓰면 줄 끝까지 모두
 * 경로로 잡히므로, 경로 뒤에 부가 텍스트를 쓰려면 줄을 분리해야 한다.
 *
 * 대소문자: Windows 드라이브 letter 가 case-insensitive 이므로 `i` 플래그 사용.
 * 기존 데이터에 `g:\...` 소문자로 입력된 경로가 있어도 동일하게 인식한다.
 */
export const G_PATH_REGEX_GLOBAL = /G:\\[^\n\r]+/gi;

export interface PathToken {
  type: 'text' | 'path';
  content: string;
}

/** 텍스트를 [text, path, text, path, ...] 토큰 배열로 분리. */
export function tokenizeGPaths(text: string): PathToken[] {
  if (!text) return [];
  const tokens: PathToken[] = [];
  let lastIdx = 0;
  for (const match of text.matchAll(G_PATH_REGEX_GLOBAL)) {
    if (match.index === undefined) continue;
    if (match.index > lastIdx) {
      tokens.push({ type: 'text', content: text.slice(lastIdx, match.index) });
    }
    tokens.push({ type: 'path', content: match[0] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    tokens.push({ type: 'text', content: text.slice(lastIdx) });
  }
  return tokens;
}

/** 경로의 마지막 segment만 표시용으로 추출. 슬래시·역슬래시 혼용 모두 처리. */
export function shortenPath(fullPath: string): string {
  const segs = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segs[segs.length - 1] || fullPath;
}
