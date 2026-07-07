/**
 * 캐릭터 이름 헬퍼 — 이름 없이 추가(임시 이름) + 이미지 파일명 자동 지정(B4).
 *
 * 구글 문서가 "제목 없는 문서"로 먼저 만들고 나중에 이름을 잡아주는 흐름을 참고.
 * 빈 문자열을 저장하면 앱 곳곳(목록·댓글·나의할일 등)에서 빈칸으로 새므로,
 * 실제로 표시 가능한 임시 이름('새 캐릭터', '새 캐릭터 2' …)을 부여한다.
 */

/** 이름 없이 만든 캐릭터의 기본 임시 이름. */
export const TEMP_CHARACTER_NAME_BASE = '새 캐릭터';

const TEMP_CHARACTER_NAME_RE = /^새 캐릭터(?:\s+(\d+))?$/;

/** 임시(자동 부여) 이름인지 — 이미지 자동 지정은 이 이름일 때만 덮어쓴다. */
export function isTempCharacterName(name: string | null | undefined): boolean {
  return TEMP_CHARACTER_NAME_RE.test((name ?? '').trim());
}

/** 기존 이름과 겹치지 않는 임시 이름을 만든다: '새 캐릭터', '새 캐릭터 2', … */
export function nextTempCharacterName(existingNames: ReadonlyArray<string>): string {
  const used = new Set(existingNames.map((n) => n.trim()));
  if (!used.has(TEMP_CHARACTER_NAME_BASE)) return TEMP_CHARACTER_NAME_BASE;
  let n = 2;
  while (used.has(`${TEMP_CHARACTER_NAME_BASE} ${n}`)) n++;
  return `${TEMP_CHARACTER_NAME_BASE} ${n}`;
}

// 이미지 붙여넣기/기본 저장명처럼 캐릭터 이름으로 부적절한 일반 파일명.
const GENERIC_BASENAMES = new Set(['image', 'images', 'clipboard', 'untitled', 'download', '그림', '무제', '캡처']);
const GENERIC_PREFIXES = ['screenshot', 'screen shot', 'capture', '스크린샷', '화면 캡처', '화면캡처'];

/**
 * 이미지 파일 이름에서 캐릭터 이름을 뽑는다(확장자 제거 + trim).
 * 자동 지정에 부적절한 일반명(image/clipboard/스크린샷/순수숫자·날짜)은 null.
 */
export function deriveCharacterNameFromFileName(fileName: string | null | undefined): string | null {
  const raw = (fileName ?? '').trim();
  if (!raw) return null;
  // 마지막 확장자만 제거(예: '한솔 SWver12.png' → '한솔 SWver12', 'a.b.png' → 'a.b').
  const withoutExt = raw.replace(/\.[^.\s]+$/, '').trim();
  if (!withoutExt) return null;
  const lower = withoutExt.toLowerCase();
  if (GENERIC_BASENAMES.has(lower)) return null;
  if (GENERIC_PREFIXES.some((p) => lower.startsWith(p))) return null;
  // 순수 숫자 / 날짜·타임스탬프 형태(숫자·구분자만)는 이름으로 부적절.
  if (/^[\d\s._:\-]+$/.test(withoutExt)) return null;
  return withoutExt;
}
