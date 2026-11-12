/**
 * 씬 그림(스토리보드·가이드·댓글 그림)의 저장소 경로 규칙.
 * electron/storage.ts 가 올릴 때 쓰고, node --test 가 직접 import 한다 — electron·supabase 를 import 하지 말 것.
 */

/** sheetName 예: "EP01_A_BG" → { ep: "EP01", partId: "A", dept: "BG" } */
function parseSheetName(sheetName: string): { ep: string; partId: string; dept: string } {
  const m = sheetName.match(/^(EP\d+)_([A-Z])_(BG|ACT)$/);
  if (!m) throw new Error(`Invalid sheetName: ${sheetName}`);
  return { ep: m[1], partId: m[2], dept: m[3] };
}

/**
 * 경로에 넣을 씬 번호 폴더 이름.
 * Supabase Storage 는 경로에 영문·숫자와 몇몇 기호만 받는다 — 씬 번호를 그대로 넣던 때는 '쿠키001' 같은
 * 한글 씬의 그림이 400 "Invalid key" 로 늘 거절됐다(2026-11-12).
 * 영문·숫자·-·_ 는 그대로 두고(그런 번호는 예전과 같은 폴더), 나머지 글자는 이어진 덩어리마다
 * UTF-8 바이트의 16진수를 점 사이에 적는다: 쿠키001 → .ecbfa0ed82a4.001, m012,m029 → m012.2c.m029.
 * 원래 글자로 남는 것에는 점이 없어서 다른 번호끼리 같은 폴더가 되지 않고,
 * 결과는 공개 주소(encodeURI)에서도 글자가 그대로라 지울 때 주소에서 같은 경로를 되찾는다.
 */
export function sceneImageStorageFolder(sceneId: string): string {
  return sceneId.replace(/[^A-Za-z0-9_-]+/g, (run) => `.${utf8Hex(run)}.`);
}

function utf8Hex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** uniq 는 같은 ms 안의 충돌을 막는 `${Date.now()}_${임의 8자}` — 호출자가 만든다. */
export function buildSceneImageStoragePath(
  sheetName: string,
  sceneId: string,
  imageType: string,
  ext: 'jpg' | 'png',
  uniq: string,
): string {
  // 캐릭터 댓글 이미지 — sheetName='char', sceneId=characterId. 씬 EP 경로 규칙(parseSheetName) 대신 캐릭터 경로로.
  if (sheetName === 'char') {
    return `characters/${sceneId}/comments/${imageType}_${uniq}.${ext}`;
  }
  const { ep, partId, dept } = parseSheetName(sheetName);
  return `${ep}/${partId}/${dept}/${sceneImageStorageFolder(sceneId)}/${imageType}_${uniq}.${ext}`;
}
