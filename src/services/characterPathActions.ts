import { toast } from 'sonner';
import { openWorkPath } from '@/services/sceneWorkLinkService';
import { fetchImageBlob, writeImageBlobToClipboard } from '@/utils/imageActions';
import { copyCharacterImageToClipboard } from '@/utils/characterImageCopy';
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
 * 캐릭터 그림 복사 — 올린 파일 그대로(원본)를 먼저 쓰고, 없으면 화면용 그림으로 대신한다(규칙은 characterImageCopy).
 * 원본은 그때 내려받으므로 누르자마자 '복사하는 중'을 보이고, 끝나면 같은 알림을 결과로 바꾼다.
 */
export async function copyCharacterImage(url: string | null | undefined): Promise<void> {
  if (!url) {
    toast.error('복사할 이미지가 없어요');
    return;
  }
  const pending = toast.loading('그림을 복사하는 중…');
  try {
    const result = await copyCharacterImageToClipboard({ fetchBlob: fetchImageBlob, write: writeImageBlobToClipboard }, url);
    if (result === 'shrunk') {
      toast.warning('줄어든 크기로 복사됐어요. 원래 크기로 쓰려면 이 그림을 다시 올려 주세요.', { id: pending, duration: 8000 });
    } else {
      toast.success('클립보드에 이미지 복사됨', { id: pending });
    }
  } catch (err) {
    console.error('[copyCharacterImage] 실패', err);
    toast.error('이미지 복사 실패', { id: pending });
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
