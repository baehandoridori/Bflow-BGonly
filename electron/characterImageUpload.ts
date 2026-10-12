// node --test 가 직접 import 하는 순수 모듈 — electron·supabase 를 import 하지 말 것 (저장소는 주입받는다).

// @ts-expect-error TS5097 — Node 내장 TS 테스트는 runtime import의 .ts 확장자가 필요하고, Electron 빌드는 Vite가 번들한다.
import { CHARACTER_ORIGINAL_MAX_BYTES, characterOriginalStoragePath, parseCharacterOriginalDataUrl } from '../src/shared/characterImageOriginal.ts';

export interface CharacterImageStore {
  /** 실패하면 throw. */
  upload(path: string, body: Buffer, contentType: string): Promise<void>;
  publicUrl(path: string): string;
}

/**
 * 캐릭터 그림 올리기 — 화면용 그림을 올리고, 올린 파일 그대로(원본)를 그 옆에 함께 둔다.
 * 원본은 덤이다: 없거나 올리지 못해도 그림 올리기는 성공으로 두고 originalSaved 로만 알린다.
 */
export async function uploadCharacterImageFiles(
  store: CharacterImageStore,
  input: {
    characterId: string;
    costumeId: string;
    uniq: string;
    display: { buffer: Buffer; mime: string; ext: 'jpg' | 'png' };
    originalDataUrl?: string | null;
  },
): Promise<{ url: string; originalSaved: boolean }> {
  const path = `characters/${input.characterId}/${input.costumeId}/${input.uniq}.${input.display.ext}`;
  await store.upload(path, input.display.buffer, input.display.mime);
  const url = store.publicUrl(path);

  const original = parseCharacterOriginalDataUrl(input.originalDataUrl);
  const originalPath = characterOriginalStoragePath(path);
  if (!original || !originalPath) return { url, originalSaved: false };
  const body = Buffer.from(original.base64, 'base64');
  if (body.length === 0 || body.length > CHARACTER_ORIGINAL_MAX_BYTES) return { url, originalSaved: false };
  try {
    await store.upload(originalPath, body, original.mime);
    return { url, originalSaved: true };
  } catch (err) {
    console.warn('[Storage] 캐릭터 그림 원본 보관 실패(화면용 그림은 올라감):', err instanceof Error ? err.message : err);
    return { url, originalSaved: false };
  }
}
