import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { chooseWorkFile, chooseWorkFolder } from '@/services/sceneWorkLinkService';
import { useSceneWorkLinkStore } from '@/stores/useSceneWorkLinkStore';
import { getSceneWorkLinkSlots } from '@/utils/sceneWorkLinks';
import type { SceneWorkLinkDepartment } from '@/types';

/**
 * 작업 링크 경로 저장 공용 코어 — 모든 upsert 진입점(컨텍스트 메뉴 + 인라인 WorkLinkRow)이
 * 이 함수 하나를 거쳐 스테일 슬롯 덮어쓰기로부터 보호된다.
 *
 * silent overwrite 방어: 그리드/시트/모달을 막 연 직후 링크 로드가 끝나기 전에는 실제 저장된
 * 링크가 있어도 빈 슬롯으로 보여 "연결" 이 활성이다. 그래서 `confirmIfExists` 일 때 upsert 전에
 * 그 씬 링크를 최신화(loadForSceneUuids)하고, 최신 linkMap 에 이미 링크가 있으면 확인을 받는다.
 *
 * @param confirmIfExists 빈 줄 알았던 슬롯('연결')에만 true. 이미 링크가 보이는 '변경' 은
 *                        사용자가 경로를 아는 상태라 false 로 두어 확인을 건너뛴다.
 * @returns 실제로 저장했으면 true, 씬/경로 없음·사용자 취소·실패면 false.
 */
export async function saveWorkLinkPathGuarded(opts: {
  sceneUuid: string | null | undefined;
  department: SceneWorkLinkDepartment;
  linkKind: 'folder' | 'primary_file';
  path: string;
  userId?: string | null;
  confirmIfExists: boolean;
}): Promise<boolean> {
  const { sceneUuid, department, linkKind, userId, confirmIfExists } = opts;
  const path = opts.path.trim();
  if (!sceneUuid || !path) return false;

  let existingPath: string | undefined;
  if (confirmIfExists) {
    // 저장 전 그 씬 링크를 최신화 — 로딩 레이스로 빈 줄 알았던 슬롯에 실은 링크가 있을 수 있다.
    // best-effort: 실패하면 그냥 (이전과 동일하게) 새 링크로 진행.
    try {
      await useSceneWorkLinkStore.getState().loadForSceneUuids([sceneUuid]);
    } catch (err) {
      console.warn('[sceneWorkLinkActions] 저장 전 링크 로드 실패', err);
    }

    // 최신 linkMap 에서 이 슬롯 재확인 — 이미 링크가 있으면 덮어쓰기 전 확인.
    const slots = getSceneWorkLinkSlots(useSceneWorkLinkStore.getState().linkMap, sceneUuid, department);
    existingPath = (linkKind === 'folder' ? slots.folder : slots.primaryFile)?.path || undefined;
    if (existingPath) {
      const ok = await ConfirmDialog.show({
        message: `이미 연결된 경로가 있어요:\n${existingPath}\n새 경로로 바꿀까요?`,
        confirmLabel: '바꾸기',
        tone: 'danger',
      });
      if (!ok) return false;
    }
  }

  try {
    await useSceneWorkLinkStore.getState().upsertLink({
      sceneUuid,
      department,
      linkKind,
      path,
      userId: userId ?? null,
    });
    toast.success(existingPath ? '작업 링크를 변경했습니다' : '작업 링크를 연결했습니다');
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`작업 링크 저장 실패: ${message}`);
    return false;
  }
}

/**
 * 우클릭 메뉴 등에서 빈 작업 링크 슬롯을 "연결" 할 때 공용으로 쓰는 핸들러.
 *
 * 폴더/파일 선택창을 띄우고, 사용자가 경로를 고르면 가드를 거쳐 저장한다.
 * (카드/시트/레거시 그리드 여러 곳이 동일 동작을 공유하도록 한 곳에 둠 — DRY)
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

  // 컨텍스트 메뉴의 '연결' 은 빈 슬롯 가정 진입점이라 항상 가드(로딩 레이스 대비).
  return saveWorkLinkPathGuarded({ sceneUuid, department, linkKind, path, userId, confirmIfExists: true });
}
