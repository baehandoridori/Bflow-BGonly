// node --test 가 직접 import 하는 순수 유틸 — @/ alias 런타임 import 금지 (받기·쓰기는 주입받는다).

import { CHARACTER_DISPLAY_MAX_PX, characterOriginalImageUrl } from '../shared/characterImageOriginal.ts';

export interface CharacterImageCopyDeps {
  /** 주소의 그림을 받는다 — 없거나 받지 못하면 throw. */
  fetchBlob(url: string): Promise<Blob>;
  /** 그림을 클립보드에 쓰고 쓴 그림의 픽셀 크기를 돌려준다 — 실패하면 throw. */
  write(blob: Blob): Promise<{ width: number; height: number }>;
}

/**
 * original — 올린 파일 그대로(원본)를 복사했다.
 * display  — 화면용 그림을 복사했다(줄어든 적 없는 그림이라 이것이 곧 원래 크기).
 * shrunk   — 화면용 그림을 복사했는데, 줄어든 채로만 남은 그림이다(원본 보관 이전에 올렸거나 원본을 쓰지 못함).
 */
export type CharacterImageCopyResult = 'original' | 'display' | 'shrunk';

/**
 * 캐릭터 그림 복사 — 원본을 먼저 쓰고, 원본이 없거나 쓰지 못하면 화면용 그림으로 대신한다.
 * 화면용 그림은 긴 변 800px 로 줄어 있어서, 그것만 복사하면 Moho 등에 원래보다 작게 붙는다.
 */
export async function copyCharacterImageToClipboard(
  deps: CharacterImageCopyDeps,
  url: string,
): Promise<CharacterImageCopyResult> {
  const originalUrl = characterOriginalImageUrl(url);
  if (originalUrl) {
    try {
      await deps.write(await deps.fetchBlob(originalUrl));
      return 'original';
    } catch {
      // 원본이 없거나(예전 그림) 받은 원본을 쓰지 못했다 — 화면용으로 대신한다.
    }
  }
  const size = await deps.write(await deps.fetchBlob(url));
  // 원본을 두는 그림인데 화면용의 긴 변이 딱 한계면 줄어든 그림이다 — 조용히 작게 붙지 않도록 호출부가 알린다.
  return originalUrl && Math.max(size.width, size.height) === CHARACTER_DISPLAY_MAX_PX ? 'shrunk' : 'display';
}
