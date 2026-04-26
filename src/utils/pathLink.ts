/**
 * G:\ 경로 인식 정규식.
 *
 * 본 모듈에서만 정의하고 4곳(tokenizeGPaths / PathLinkMark inputRule / pasteRule / 향후 확장)이
 * import해 공유한다. 정규식이 어긋나면 인식 결과가 분기되어 일관성이 깨지므로 상수로 묶어둔다.
 */
export const G_PATH_REGEX_GLOBAL = /G:\\[^\s\n]+/g;
export const G_PATH_REGEX_INPUT_RULE = /(G:\\[^\s\n]+)\s$/;
export const G_PATH_REGEX_PASTE_RULE = /G:\\[^\s\n]+/g;

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
