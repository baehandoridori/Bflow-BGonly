import { toast } from 'sonner';
import { chooseWorkFile, chooseWorkFolder } from '@/services/sceneWorkLinkService';
import { useSceneWorkLinkStore } from '@/stores/useSceneWorkLinkStore';
import type { SceneWorkLinkDepartment } from '@/types';

/**
 * 우클릭 메뉴 등에서 빈 작업 링크 슬롯을 "연결" 할 때 공용으로 쓰는 핸들러.
 *
 * 폴더/파일 선택창을 띄우고, 사용자가 경로를 고르면 낙관적 업데이트로 저장한다.
 * (카드/시트/레거시 그리드 3곳이 동일 동작을 공유하도록 한 곳에 둠 — DRY)
 *
 * @returns 실제로 연결에 성공하면 true, 씬 없음·사용자 취소면 false.
 */
export async function chooseAndLinkWorkPath(input: {
  sceneUuid: string | null | undefined;
  department: SceneWorkLinkDepartment;
  linkKind: 'folder' | 'primary_file';
  userId?: string | null;
}): Promise<boolean> {
  const { sceneUuid, department, linkKind, userId } = input;
  if (!sceneUuid) return false;

  const selected = linkKind === 'folder' ? await chooseWorkFolder() : await chooseWorkFile();
  const path = selected?.trim();
  if (!path) return false;

  try {
    await useSceneWorkLinkStore.getState().upsertLink({
      sceneUuid,
      department,
      linkKind,
      path,
      userId: userId ?? null,
    });
    toast.success('작업 링크를 연결했습니다');
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`작업 링크 저장 실패: ${message}`);
    return false;
  }
}
