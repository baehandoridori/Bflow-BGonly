/**
 * 리테이크 sceneKey('EP01:A:1' 형식)에서 씬 컨텍스트(EP·파트)를 뽑는다.
 * episodeNumber 는 number 로 변환('EP01'→1). 형식이 안 맞으면 null.
 * (revisionService.parseRevisionSceneKey 는 episode 를 'EP01' 문자열로 주므로 별도)
 * 순수 함수 — node:test 검증.
 */
export function parseRevisionSceneContext(
  sceneKey: string | null | undefined,
): { episodeNumber: number; partId: string } | null {
  if (!sceneKey) return null;
  const segs = sceneKey.split(':');
  if (segs.length < 2) return null;
  // EP 접두어 + 숫자만(자릿수 무관)인 형식만 인정. 'EP00'/접두어없음/중간글자 섞임은 거부.
  const epMatch = /^EP(\d+)$/i.exec(segs[0].trim());
  const partId = segs[1];
  if (!epMatch || !partId) return null;
  const episodeNumber = parseInt(epMatch[1], 10);
  if (!Number.isInteger(episodeNumber) || episodeNumber <= 0) return null;
  return { episodeNumber, partId };
}

/**
 * 댓글 sceneKey(commentService 형 'sheetName:sceneNo', 예 'EP01_A_BG:3')에서 씬 컨텍스트를 뽑는다.
 * sheetName 'EP01_A_BG' → {episodeNumber:1, partId:'A', department:'bg'}. 부서 접미어(_BG/_ACT)를 보존해
 * BG/ACT 를 구분한다(접미어 없는 legacy 는 bg). 형식 불일치 시 null.
 */
export function parseCommentSceneContext(
  sceneKey: string | null | undefined,
): { episodeNumber: number; partId: string; department: 'bg' | 'acting' } | null {
  if (!sceneKey) return null;
  const sheetName = sceneKey.split(':')[0];
  const m = /^EP(\d+)_([A-Za-z])(?:_(BG|ACT))?/i.exec(sheetName);
  if (!m) return null;
  const episodeNumber = parseInt(m[1], 10);
  if (!Number.isInteger(episodeNumber) || episodeNumber <= 0) return null;
  const department = m[3] && m[3].toUpperCase() === 'ACT' ? 'acting' : 'bg';
  // partId 는 원본 casing 보존(앱이 소문자 acting 파트도 지원).
  return { episodeNumber, partId: m[2], department };
}
