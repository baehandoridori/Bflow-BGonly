/**
 * 리테이크 sceneKey('EP01:A:1' 형식)에서 컷 점프용 씬 컨텍스트를 뽑는다(4a, P2).
 * episodeNumber 는 number 로 변환('EP01'→1). 형식이 안 맞으면 null → 호출 측은 onCutClick 생략.
 * (revisionService.parseRevisionSceneKey 는 episode 를 'EP01' 문자열로 주므로 별도)
 * 순수 함수 — node:test 검증.
 */
export function parseRevisionSceneContext(
  sceneKey: string | null | undefined,
): { episodeNumber: number; partId: string } | null {
  if (!sceneKey) return null;
  const segs = sceneKey.split(':');
  if (segs.length < 2) return null;
  const digits = segs[0].replace(/\D/g, '');
  const partId = segs[1];
  if (!digits || !partId) return null;
  const episodeNumber = parseInt(digits, 10);
  if (!Number.isFinite(episodeNumber)) return null;
  return { episodeNumber, partId };
}
