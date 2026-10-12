import { toast } from 'sonner';
import { openWorkPath } from '@/services/sceneWorkLinkService';
import { fetchImageBlob, writeImageBlobToClipboard } from '@/utils/imageActions';
import { CHARACTER_DISPLAY_MAX_PX, characterOriginalImageUrl } from '@/shared/characterImageOriginal';
import { getPathBaseName, getResolvedCharacterFolderAfterFilePick } from '@/utils/characterAssets';

export function displayCharacterPathName(path: string | null | undefined): string {
  return getPathBaseName(path) || '미등록';
}

export async function openStoredCharacterPath(targetPath: string | null | undefined, label: string): Promise<void> {
  const path = (targetPath ?? '').trim();
  if (!path) {
    toast.error(`${label} 경로가 등록되지 않았어요`);
    return;
  }
  const res = await openWorkPath(path);
  if (!res.ok) toast.error(`${label} 열기에 실패했어요`);
}

/**
 * 캐릭터 그림 복사 — 올린 파일 그대로(원본)를 먼저 쓴다.
 * 화면에 쓰는 그림은 긴 변 800px 로 줄어 있어서, 그것을 복사하면 Moho 등에 원래보다 작게 붙는다.
 * 원본이 없는 그림(원본 보관 이전에 올렸거나 보관하지 못한 것)만 화면용 그림으로 대신한다.
 */
export async function copyCharacterImage(url: string | null | undefined): Promise<void> {
  if (!url) {
    toast.error('복사할 이미지가 없어요');
    return;
  }
  try {
    const originalUrl = characterOriginalImageUrl(url);
    const original = originalUrl ? await fetchImageBlob(originalUrl).catch(() => null) : null;
    const size = await writeImageBlobToClipboard(original ?? await fetchImageBlob(url));
    // 원본 없이 긴 변이 딱 화면용 한계면 줄어든 채로만 남은 그림이다 — 조용히 작게 붙지 않도록 알린다.
    if (!original && Math.max(size.width, size.height) === CHARACTER_DISPLAY_MAX_PX) {
      toast.warning('줄어든 크기로 복사됐어요. 원래 크기로 쓰려면 이 그림을 다시 올려 주세요.', { duration: 8000 });
    } else {
      toast.success('클립보드에 이미지 복사됨');
    }
  } catch (err) {
    console.error('[copyCharacterImage] 실패', err);
    toast.error('이미지 복사 실패');
  }
}

export async function resolveFolderAfterCharacterFilePick(currentFolderPath: string | null, filePath: string): Promise<string> {
  if (currentFolderPath?.trim()) return currentFolderPath;
  try {
    const dirname = await window.electronAPI?.pathDirname?.(filePath);
    if (dirname) return dirname;
  } catch {
    // Fall back to the renderer-safe path parser below.
  }
  return getResolvedCharacterFolderAfterFilePick(currentFolderPath, filePath);
}
