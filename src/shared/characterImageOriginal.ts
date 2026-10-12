// node --test 가 직접 import 하는 순수 모듈 — 런타임 import 를 두지 말 것 (main·화면이 함께 쓴다).

/**
 * 캐릭터 현황판 그림의 원본 보관 규칙 (v1.134.1).
 *
 * 화면에는 가볍게 줄인 그림(긴 변 800px)을 쓰고, 올린 파일 그대로를 그 옆에 함께 둔다.
 *   화면용  characters/{캐릭터}/{복장}/{고유값}.png|jpg   ← DB 에 적히는 주소
 *   원본    characters/{캐릭터}/{복장}/{고유값}.orig      ← 형식이 무엇이든 같은 이름, 종류는 Content-Type 으로
 * 원본 주소는 DB 에 따로 적지 않고 화면용 주소에서 만들어 낸다 — 복사·삭제하는 곳이 화면용 주소만 알면 된다.
 * 원본이 없는 그림(이 규칙 이전에 올린 것, 보관하지 못한 것)은 화면용 그림으로 대신한다.
 */

/** 화면용 그림의 긴 변 한계(px). */
export const CHARACTER_DISPLAY_MAX_PX = 800;

/** 원본으로 보관하는 파일 크기 한계 — 이보다 크면 화면용 그림만 올린다. */
export const CHARACTER_ORIGINAL_MAX_BYTES = 30 * 1024 * 1024;

// 공개 주소로 열리는 파일이라 스크립트를 담을 수 있는 형식(svg 등)은 받지 않는다.
const ORIGINAL_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif']);
const STORAGE_PUBLIC_PREFIX = '/storage/v1/object/public/scene-images/';
// 댓글 첨부(characters/{캐릭터}/comments/…)는 원본을 두지 않는다.
const DISPLAY_PATH = /^(characters\/[^/]+\/(?!comments\/)[^/]+\/[^/.]+)\.(?:jpg|png)$/;

/** 이 파일을 원본으로 함께 보관할 수 있는지 — 형식과 크기. */
export function canKeepCharacterOriginal(file: { type: string; size: number }): boolean {
  return ORIGINAL_MIME_TYPES.has(file.type) && file.size > 0 && file.size <= CHARACTER_ORIGINAL_MAX_BYTES;
}

/** 화면용 그림의 저장소 경로 → 원본 경로. 캐릭터 그림이 아니면 null. */
export function characterOriginalStoragePath(displayPath: string): string | null {
  const match = DISPLAY_PATH.exec(displayPath);
  return match ? `${match[1]}.orig` : null;
}

/** 화면용 그림의 공개 주소 → 원본 공개 주소. 저장소 밖 주소·캐릭터 그림이 아닌 주소는 null. */
export function characterOriginalImageUrl(displayUrl: string | null | undefined): string | null {
  if (!displayUrl) return null;
  const at = displayUrl.indexOf(STORAGE_PUBLIC_PREFIX);
  if (at < 0) return null;
  const start = at + STORAGE_PUBLIC_PREFIX.length;
  const original = characterOriginalStoragePath(displayUrl.slice(start).split(/[?#]/, 1)[0]);
  return original ? displayUrl.slice(0, start) + original : null;
}

/** 지울 경로 목록에 캐릭터 그림의 원본 경로를 끼워 넣는다 (없는 경로를 지워도 저장소는 오류를 내지 않는다). */
export function withCharacterOriginalPaths(paths: string[]): string[] {
  return paths.flatMap((path) => {
    const original = characterOriginalStoragePath(path);
    return original ? [path, original] : [path];
  });
}

/** 원본 data URL → 형식과 base64 내용. 받지 않는 형식·깨진 값은 null. */
export function parseCharacterOriginalDataUrl(dataUrl: string | null | undefined): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl ?? '');
  if (!match || !ORIGINAL_MIME_TYPES.has(match[1])) return null;
  return { mime: match[1], base64: match[2] };
}
