import { toast } from 'sonner';
import { openWorkPath } from '@/services/sceneWorkLinkService';
import { copyImageToClipboard } from '@/utils/imageActions';
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

export async function copyCharacterImage(url: string | null | undefined): Promise<void> {
  if (!url) {
    toast.error('복사할 이미지가 없어요');
    return;
  }
  await copyImageToClipboard(url);
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
