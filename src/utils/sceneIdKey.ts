/**
 * sceneId 정규화 유틸 — 병합 / lookup / 리테이크 공용
 *
 * 같은 파트 안에서 BG "ac001", ACT "a001", 숫자만 있는 "001" 은 같은
 * "1번 씬" 으로 취급한다. 반면 `v2a001` 처럼 접두사 안에 다른 식별자가
 * 붙은 경우는 별도 씬으로 남겨야 한다.
 */

const TRAILING_DIGIT_GROUP_RE = /\d+$/;
const DIGITS_ONLY_RE = /^\d+$/;

function normalizePartId(partId: string | null | undefined): string {
  return (partId || '').trim().slice(0, 1).toLowerCase();
}

export function normalizeSceneIdKey(
  sceneId: string | null | undefined,
  partId?: string | null,
): string {
  const rawSceneId = (sceneId || '').trim();
  if (!rawSceneId) return '';

  const lowerSceneId = rawSceneId.toLowerCase();
  const trailingDigits = lowerSceneId.match(TRAILING_DIGIT_GROUP_RE)?.[0] ?? '';
  const normalizedDigits = trailingDigits ? String(Number(trailingDigits)) : '';
  const normalizedPart = normalizePartId(partId);

  if (DIGITS_ONLY_RE.test(lowerSceneId)) return String(Number(lowerSceneId));
  if (normalizedPart && normalizedDigits && new RegExp(`^${normalizedPart}[a-z]*\\d+$`).test(lowerSceneId)) {
    return normalizedDigits;
  }

  return lowerSceneId;
}

export function buildCanonicalSceneId(
  partId: string | null | undefined,
  sceneId: string | null | undefined,
): string {
  const normalizedKey = normalizeSceneIdKey(sceneId, partId);
  if (!normalizedKey) return '';

  if (DIGITS_ONLY_RE.test(normalizedKey)) {
    const normalizedPart = normalizePartId(partId);
    const paddedNumber = normalizedKey.padStart(3, '0');
    return normalizedPart ? `${normalizedPart}${paddedNumber}` : paddedNumber;
  }

  return normalizedKey;
}
