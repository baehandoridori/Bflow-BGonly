// node --test 가 직접 import 하는 순수 유틸 — 런타임 import 를 두지 말 것 (@/ alias 는 테스트 로드를 깨뜨린다).

/**
 * 클립보드 CFSTR_FILENAMEW('FileNameW') 파싱 — 탐색기 '파일 복사' 시 함께 실리는 등록 포맷.
 * 내용: 첫 번째 파일의 전체 경로 하나, UTF-16LE 널 종단.
 *
 * 주의: 사전정의 포맷 CF_HDROP(ID 15)는 Electron 의 readBuffer 로 읽을 수 없다 —
 * readBuffer('CF_HDROP') 는 같은 이름의 커스텀 포맷을 새로 등록해 항상 빈 버퍼가 나온다.
 * 'FileNameW' 는 RegisterClipboardFormat 등록 포맷이라 이름이 매칭되어 정상 동작한다 (Electron 33 실기 검증).
 */
export function parseFileNameWBuffer(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 2) return null;
  const text = buffer.toString('utf16le');
  const nul = text.indexOf('\0');
  const filePath = (nul >= 0 ? text.slice(0, nul) : text).trim();
  return filePath.length > 0 ? filePath : null;
}

const IMAGE_EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

/** 이미지 확장자면 MIME 반환, 아니면 null. (psd/clip/moho 같은 작업 파일은 거른다) */
export function imageMimeForPath(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return null;
  return IMAGE_EXT_MIME[filePath.slice(dot).toLowerCase()] ?? null;
}
