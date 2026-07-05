import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { chooseWorkFile, chooseWorkFolder } from '@/services/sceneWorkLinkService';
import { useSceneWorkLinkStore } from '@/stores/useSceneWorkLinkStore';
import { getSceneWorkLinkSlots } from '@/utils/sceneWorkLinks';
import type { SceneWorkLinkDepartment } from '@/types';

/**
 * 우클릭 메뉴 등에서 빈 작업 링크 슬롯을 "연결" 할 때 공용으로 쓰는 핸들러.
 *
 * 폴더/파일 선택창을 띄우고, 사용자가 경로를 고르면 낙관적 업데이트로 저장한다.
 * (카드/시트/레거시 그리드 여러 곳이 동일 동작을 공유하도록 한 곳에 둠 — DRY)
 *
 * silent overwrite 방어: 그리드/시트를 막 연 직후 링크 로드가 끝나기 전에는 실제 저장된
 * 링크가 있어도 빈 슬롯으로 보여 "연결" 이 활성이다. 그래서 upsert 전에 그 씬 링크를
 * 최신화(loadForSceneUuids)하고, 최신 linkMap 에 이미 링크가 있으면 확인을 받는다.
 * 이 핸들러를 쓰는 모든 진입점이 한 번에 안전해진다.
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

  // 저장 전 그 씬 링크를 최신화 — 로딩 레이스로 빈 줄 알았던 슬롯에 실은 링크가 있을 수 있다.
  // best-effort: 실패하면 그냥 (이전과 동일하게) 새 링크로 진행.
  try {
    await useSceneWorkLinkStore.getState().loadForSceneUuids([sceneUuid]);
  } catch (err) {
    console.warn('[sceneWorkLinkActions] 저장 전 링크 로드 실패', err);
  }

  // 최신 linkMap 에서 이 슬롯 재확인 — 이미 링크가 있으면 덮어쓰기 전 확인.
  const slots = getSceneWorkLinkSlots(useSceneWorkLinkStore.getState().linkMap, sceneUuid, department);
  const existing = linkKind === 'folder' ? slots.folder : slots.primaryFile;
  if (existing?.path) {
    const ok = await ConfirmDialog.show({
      message: `이미 연결된 경로가 있어요:\n${existing.path}\n새 경로로 바꿀까요?`,
      confirmLabel: '바꾸기',
      tone: 'danger',
    });
    if (!ok) return false;
  }

  try {
    await useSceneWorkLinkStore.getState().upsertLink({
      sceneUuid,
      department,
      linkKind,
      path,
      userId: userId ?? null,
    });
    toast.success(existing?.path ? '작업 링크를 변경했습니다' : '작업 링크를 연결했습니다');
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`작업 링크 저장 실패: ${message}`);
    return false;
  }
}
