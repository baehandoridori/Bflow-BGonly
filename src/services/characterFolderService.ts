import { toast } from 'sonner';
import type { Character } from '@/types';
import { readMetadataFromSupabase, writeMetadataToSupabase } from '@/services/supabaseService';

export const CHARACTER_FOLDER_ROOT_META = {
  type: 'character-board',
  key: 'work-folder-root',
} as const;

export type PathCreateFolderResult = Awaited<
  ReturnType<NonNullable<typeof window.electronAPI.pathCreateFolder>>
>;

export function unwrapMetadataValue(row: unknown): string | null {
  let value: unknown = row;
  if (row && typeof row === 'object' && 'value' in (row as Record<string, unknown>)) {
    value = (row as Record<string, unknown>).value;
  }
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function readCharacterWorkFolderRoot(): Promise<string | null> {
  const row = await readMetadataFromSupabase(CHARACTER_FOLDER_ROOT_META.type, CHARACTER_FOLDER_ROOT_META.key);
  return unwrapMetadataValue(row);
}

export async function saveCharacterWorkFolderRoot(path: string): Promise<void> {
  await writeMetadataToSupabase(CHARACTER_FOLDER_ROOT_META.type, CHARACTER_FOLDER_ROOT_META.key, path.trim());
}

export async function createAndLinkCharacterFolder(
  character: Pick<Character, 'id' | 'name'>,
  updateCharacterFolder: (id: string, workFolderPath: string | null) => Promise<boolean>,
): Promise<boolean> {
  let root: string | null = null;
  try {
    root = await readCharacterWorkFolderRoot();
  } catch (err) {
    console.error('[character-folder] 기준 경로 조회 실패:', err);
    toast.error('폴더 기준 경로를 불러오지 못했어요');
    return false;
  }

  if (!root) {
    toast.error('폴더 기준 경로가 아직 설정되지 않았어요. 설정 → 관리자 탭에서 지정해주세요');
    return false;
  }

  if (!window.electronAPI?.pathCreateFolder) {
    toast.error('현재 환경에서는 폴더를 만들 수 없어요');
    return false;
  }

  const result = await window.electronAPI.pathCreateFolder(root, character.name);
  if (!result.ok || !result.path) {
    switch (result.code) {
      case 'parent-missing':
        toast.error('기준 경로를 찾을 수 없어요. G드라이브 연결을 확인해주세요');
        break;
      case 'permission':
        toast.error('폴더를 만들 권한이 없어요');
        break;
      case 'invalid-name':
        toast.error('캐릭터 이름으로 폴더를 만들 수 없어요');
        break;
      default:
        toast.error('폴더 만들기에 실패했어요');
        break;
    }
    return false;
  }

  const saved = await updateCharacterFolder(character.id, result.path);
  if (!saved) return false;

  toast.success(result.existed ? '이미 있던 폴더를 작업 폴더로 연결했어요' : '폴더를 만들고 작업 폴더로 연결했어요');
  return true;
}
