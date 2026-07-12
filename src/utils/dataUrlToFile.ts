// node --test 가 직접 import 하는 순수 유틸 — @/ alias 런타임 import 금지 (테스트 로드가 깨진다).

/** data URL 을 File 로 — 클립보드 파일 붙여넣기(원본 바이트)를 기존 업로드 경로(File 기반)에 합류시키기 위함. */
export function dataUrlToFile(dataUrl: string, fileName: string): File | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: match[1] });
}
