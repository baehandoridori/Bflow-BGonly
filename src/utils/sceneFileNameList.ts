import { normalizeSceneIdKey } from './sceneIdKey.ts';

/** 규칙의 손잡이. 값은 SCENE_NAME_RULES 한 곳에서 바꾼다(15.1). */
export interface SceneNameRules {
  /** P1: 물결표 범위(a001~005)를 읽는다. */
  tildeRange: boolean;
  /** 범위 하나가 펼쳐지는 최대 개수(양 끝 포함). 넘으면 범위로 읽지 않는다. */
  maxRangeCount: number;
  /** 씬 번호로 읽는 숫자의 최대 자릿수. 넘는 숫자 덩이는 통째로 건너뛴다. */
  maxDigits: number;
  /** 글자 없이 적힌 숫자를 씬 번호로 믿는 최소 자릿수(연결한 씬 번호와 자릿수가 같으면 이보다 짧아도 믿는다). */
  minSceneDigits: number;
  /** P4: 켜면 파일 이름에 연결한 씬 자신의 번호가 있어야 그 목록을 읽는다. 끄면(정해진 값) 글자가 맞고 번호가 둘 이상인 목록은 자기 번호가 없어도 읽는다. */
  requireOwnNumber: boolean;
}

export const SCENE_NAME_RULES: Readonly<SceneNameRules> = {
  tildeRange: true,
  maxRangeCount: 50,
  maxDigits: 4,
  minSceneDigits: 3,
  requireOwnNumber: false,
};

export interface SceneNameRef {
  /** 앞의 0을 뗀 번호. 1 = 001. */
  number: number;
  /** 숫자 바로 뒤의 영문 1~3자(대문자). 없으면 ''. */
  suffix: string;
  /** 범위가 펼쳐져 생긴 번호(이름에 직접 적히지 않았다). */
  ranged: boolean;
}

export interface SceneNameList {
  /** 목록 맨 앞 숫자에 붙은 글자(소문자). 없으면 ''. */
  prefix: string;
  /** 맨 앞 숫자의 자릿수('001'이면 3). 목록의 모든 숫자가 이 자릿수다. */
  width: number;
  /** 적힌 순서대로, 같은 번호·접미사는 한 번만. */
  refs: SceneNameRef[];
}

export interface SceneIdParts { letters: string; number: number; suffix: string }

const LETTER = /[a-z]/;
const DIGIT = /[0-9]/;
const ALNUM = /[a-z0-9]/;
const SPACE = / /;

export function workFileName(path: string): string {
  // 빈 경로와 '\'·'/'로 끝나는 경로(폴더)는 마지막 조각이 ''이다.
  return path.trim().split(/[\\/]/).pop() ?? '';
}

function normalizeName(path: string): string {
  return workFileName(path)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u301c\u223c]/g, '~')
    .replace(/\s+/g, ' ')
    .trim();
}

function run(s: string, from: number, re: RegExp): number {
  let i = from;
  while (i < s.length && re.test(s[i])) i += 1;
  return i;
}

interface NumberToken { prefix: string; digits: string; suffix: string; closed: boolean; end: number }

/** from 자리에서 '(글자)(틈)숫자(접미)'를 읽는다. closed = 숫자 뒤에 접미가 아닌 글자가 붙어 목록이 여기서 끝난다. */
function readNumber(s: string, from: number, rules: SceneNameRules): NumberToken | null {
  const lettersEnd = run(s, from, LETTER);
  const prefix = s.slice(from, lettersEnd);
  let at = lettersEnd;
  if (prefix && (s[at] === ' ' || s[at] === '_' || s[at] === '-') && DIGIT.test(s[at + 1] ?? '')) at += 1;
  const digitsEnd = run(s, at, DIGIT);
  const digits = s.slice(at, digitsEnd);
  if (!digits || digits.length > rules.maxDigits) return null;
  const tailEnd = run(s, digitsEnd, LETTER);
  const tail = s.slice(digitsEnd, tailEnd);
  if (!tail) return { prefix, digits, suffix: '', closed: false, end: digitsEnd };
  if (tail.length <= 3 && !DIGIT.test(s[tailEnd] ?? '')) {
    return { prefix, digits, suffix: tail.toUpperCase(), closed: false, end: tailEnd };
  }
  return { prefix, digits, suffix: '', closed: true, end: digitsEnd };
}

function readSeparator(s: string, from: number): number {
  let at = run(s, from, SPACE);
  if (/[,_+&]/.test(s[at] ?? '')) at = run(s, at + 1, SPACE);
  return at;
}

export function readSceneNameLists(path: string, rules: SceneNameRules = SCENE_NAME_RULES): SceneNameList[] {
  const s = normalizeName(path);
  const lists: SceneNameList[] = [];
  // 범위로 받아들이지 않은 '~' 바로 뒤에서 시작하는 목록은 버린다(잘린 뒷부분이 따로 목록이 되지 않게).
  let dropAt = -1;
  let i = 0;
  while (i < s.length) {
    if (!ALNUM.test(s[i]) || (i > 0 && ALNUM.test(s[i - 1]))) { i += 1; continue; }
    const head = readNumber(s, i, rules);
    if (!head) { i = Math.max(i + 1, run(s, i, ALNUM)); continue; }
    const dropped = i === dropAt;
    const width = head.digits.length;
    const refs: SceneNameRef[] = [];
    const add = (number: number, suffix: string, ranged: boolean) => {
      const found = refs.find((ref) => ref.number === number && ref.suffix === suffix);
      if (!found) refs.push({ number, suffix, ranged });
      else if (!ranged) found.ranged = false;
    };
    add(Number(head.digits), head.suffix, false);
    let last = head;
    let afterRange = false;
    let end = head.end;
    while (!last.closed) {
      const tilde = run(s, end, SPACE);
      if (s[tilde] === '~') {
        const rightAt = run(s, tilde + 1, SPACE);
        const right = rules.tildeRange && !afterRange && !last.suffix ? readNumber(s, rightAt, rules) : null;
        const from = Number(last.digits);
        const to = right ? Number(right.digits) : NaN;
        if (
          !right || right.suffix || right.closed
          || (right.prefix && right.prefix !== head.prefix)
          || right.digits.length !== width
          || !(to > from) || to - from + 1 > rules.maxRangeCount
        ) { dropAt = rightAt; break; }
        for (let n = from + 1; n < to; n += 1) add(n, '', true);
        add(to, '', false);
        last = right; end = right.end; afterRange = true;
        continue;
      }
      const next = readSeparator(s, end);
      if (next === end) break;
      const item = readNumber(s, next, rules);
      if (!item || (item.prefix && item.prefix !== head.prefix) || item.digits.length !== width) break;
      add(Number(item.digits), item.suffix, false);
      last = item; end = item.end; afterRange = false;
    }
    if (!dropped) lists.push({ prefix: head.prefix, width, refs });
    i = Math.max(end, i + 1);
  }
  return lists;
}

export function splitSceneId(sceneId: string | null | undefined): SceneIdParts | null {
  const match = /^([a-z]*)(\d+)([a-z]{0,3})$/.exec((sceneId ?? '').trim().toLowerCase());
  if (!match) return null;
  return { letters: match[1], number: Number(match[2]), suffix: match[3].toUpperCase() };
}

export function sceneFamily(sceneId: string | null | undefined, partId: string | null | undefined): string | null {
  const parts = splitSceneId(sceneId);
  if (!parts) return null;
  return parts.letters || (partId ?? '').trim().slice(0, 1).toLowerCase();
}

export function sceneRefKey(sceneId: string | null | undefined, family: string): string | null {
  const parts = splitSceneId(sceneId);
  if (!parts) return null;
  const key = normalizeSceneIdKey(`${parts.letters}${parts.number}`, family);
  return /^\d+$/.test(key) ? `${key}${parts.suffix}` : null;
}

export function refKey(ref: { number: number; suffix: string }): string {
  return `${ref.number}${ref.suffix}`;
}

/** 씬 번호처럼 쓴 숫자인가 — 자릿수가 minSceneDigits 이상이거나, 연결한 씬 번호의 자릿수와 같다. */
function sceneLikeWidth(width: number, sceneId: string, rules: SceneNameRules): boolean {
  return width >= rules.minSceneDigits || width === (/\d+/.exec(sceneId)?.[0].length ?? 0);
}

export function sceneListForScene(
  path: string,
  scene: { sceneId: string; partId: string },
  rules: SceneNameRules = SCENE_NAME_RULES,
): SceneNameList | null {
  const family = sceneFamily(scene.sceneId, scene.partId);
  if (family === null) return null;
  const self = sceneRefKey(scene.sceneId, family);
  if (self === null) return null;
  const lists = readSceneNameLists(path, rules);
  const inFamily = (list: SceneNameList) => list.prefix === family || list.prefix === family.slice(0, 1);
  // 맞는 목록이 여럿이면: 번호가 둘 이상인 것 먼저, 그래도 여럿이면 왼쪽 것.
  const pick = (pool: SceneNameList[]) => pool.find((list) => list.refs.length > 1) ?? pool[0] ?? null;
  const fits = lists.filter((list) => {
    const hasSelf = list.refs.some((ref) => refKey(ref) === self);
    if (list.prefix === '') return hasSelf && sceneLikeWidth(list.width, scene.sceneId, rules);
    if (!inFamily(list)) return false;
    // P4(끈 것이 정해진 값): 번호가 둘 이상이면 자기 번호가 없어도 맞는다. 번호가 하나뿐인 목록은 늘 자기 번호여야 한다(시안: 씬 하나뿐인 이름은 묻지 않는다).
    return hasSelf || (!rules.requireOwnNumber && list.refs.length > 1);
  });
  const lettered = fits.filter((list) => list.prefix !== '');
  if (lettered.length > 0) return pick(lettered);
  // 글자가 붙은 씬 목록이 이름에 따로 있으면(이 가족의 것이거나 번호가 둘 이상) 글자 없는 조각을 이 씬의 목록으로 읽지 않는다.
  const hasLetteredSceneList = lists.some((list) => (
    list.prefix !== '' && sceneLikeWidth(list.width, scene.sceneId, rules) && (inFamily(list) || list.refs.length > 1)
  ));
  if (hasLetteredSceneList) return null;
  return pick(fits);
}

export function namesOtherScenes(
  path: string,
  scene: { sceneId: string; partId: string },
  rules: SceneNameRules = SCENE_NAME_RULES,
): boolean {
  if (sceneListForScene(path, scene, rules)) return false;
  return readSceneNameLists(path, rules).some((list) => (
    list.prefix !== '' && list.refs.length > 1 && sceneLikeWidth(list.width, scene.sceneId, rules)
  ));
}
