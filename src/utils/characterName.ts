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

/**
 * 중복 판정용 이름 키(피드백 55) — 유니코드 정규화(NFC) + 모든 공백 제거 + 소문자.
 * '찜질방 사장'/'찜질방사장', 'Kim'/'kim' 을 같은 이름으로 본다.
 */
export function characterNameKey(name: string | null | undefined): string {
  return (name ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

type NamedCharacterLike = { name: string; status: 'active' | 'archived' };

/**
 * 입력 이름과 겹치는 기존 캐릭터를 찾는다(피드백 55).
 * 활성 캐릭터가 우선 — 활성·보관이 동시에 겹치면 활성만 돌려준다(보관은 활성이 없을 때만).
 * 빈 이름(공백만)은 임시 이름이 부여되므로 겹침 없음.
 */
export function findDuplicateCharacters<T extends NamedCharacterLike>(
  characters: ReadonlyArray<T>,
  name: string,
): { active: T | null; archived: T | null } {
  const key = characterNameKey(name);
  if (!key) return { active: null, archived: null };
  const matches = characters.filter((c) => characterNameKey(c.name) === key);
  const active = matches.find((c) => c.status !== 'archived') ?? null;
  const archived = active ? null : matches.find((c) => c.status === 'archived') ?? null;
  return { active, archived };
}

/**
 * 입력 중 '비슷한 이름' 제안(피드백 55) — 활성 캐릭터 중 이름 키와 입력 키가 한쪽이 다른 쪽을 포함하는 것
 * (정확히 같은 이름은 제외 — 그건 중복 차단이 맡는다). 이름 순 정렬 후 최대 limit 개.
 * 양방향인 이유: '한솔' 이 있는데 '한솔이' 를 치는(접미사·오타) 경우도 잡아야 중복 카드를 막는다.
 */
export function suggestSimilarCharacters<T extends NamedCharacterLike>(
  characters: ReadonlyArray<T>,
  name: string,
  limit = 3,
): T[] {
  const key = characterNameKey(name);
  if (!key) return [];
  return characters
    .filter((c) => c.status !== 'archived')
    .filter((c) => {
      const candidate = characterNameKey(c.name);
      return candidate !== key && (candidate.includes(key) || key.includes(candidate));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .slice(0, limit);
}

/** 작업 폴더 '만들기' 확인 창 문구(피드백 57-1) — 어디에 어떤 이름으로 만들지 + 임시 이름 경고. */
export function buildCharacterFolderConfirmMessage(root: string, characterName: string): string {
  const lines = [
    `아래 위치에 '${characterName}' 폴더를 만들고 작업 폴더로 연결할까요?`,
    root,
    '이미 같은 이름의 폴더가 있으면 새로 만들지 않고 그 폴더를 연결만 해요.',
  ];
  if (isTempCharacterName(characterName)) {
    lines.push('지금 이름은 임시 이름이에요 — 폴더 이름으로 쓰기 전에 캐릭터 이름부터 정하는 게 좋아요.');
  }
  return lines.join('\n');
}
