// 가이드 그림을 넣을 때 작업 폴더 제안 — 씬 상세 창의 가이드 넣기 길에서 부른다(설계 2026-11-10 4절).
// 그림 저장을 기다리게 하지 않는다: 부르고 잊는다. 안에서 생긴 오류는 콘솔에만 남기고 화면엔 아무것도 띄우지 않는다.
import { GuideFolderSuggestSheet } from '@/components/scenes/GuideFolderSuggestSheet';
import { isGuideFolderSuggestEnabled } from '@/services/settingsService';
import { useDataStore } from '@/stores/useDataStore';
import { useSceneWorkLinkStore } from '@/stores/useSceneWorkLinkStore';
import { leafName, type GuideImageMethod } from '@/utils/guideFolderSuggest';
import { buildGuideFolderSuggestion, type GuideFolderDeps } from '@/utils/guideFolderSuggestBuild';
import { findSceneLocation } from '@/utils/sceneBulkWorkLink';
import { getSceneWorkLinkSlots } from '@/utils/sceneWorkLinks';

/** 작업 링크 읽기를 이보다 오래 기다리지 않는다. 넘기면 '못 읽음' — 짐작 길은 제안하지 않는다. */
export const GUIDE_FOLDER_LINK_WAIT_MS = 3000;

/** 가장 최근 요청 번호 — 늦게 끝난 옛 요청(앞 그림)의 결과는 버린다. 같은 붙여넣기가 두 번 불려도 마지막 하나만 남는다. */
let requestSeq = 0;

async function loadLinks(sceneUuids: string[]): Promise<boolean> {
  const load = useSceneWorkLinkStore.getState().loadForSceneUuids(sceneUuids).then(
    () => true,
    (err) => {
      console.warn('[guideFolderSuggestion] 작업 링크 읽기 실패', err);
      return false;
    },
  );
  const timeout = new Promise<boolean>((resolve) => { window.setTimeout(() => resolve(false), GUIDE_FOLDER_LINK_WAIT_MS); });
  return Promise.race([load, timeout]);
}

const deps: GuideFolderDeps = {
  listDir: async (dir, kind) => (await window.electronAPI.workFolderListDir?.(dir, kind)) ?? null,
  loadLinks,
  bgSlots: (sceneUuid) => {
    const slots = getSceneWorkLinkSlots(useSceneWorkLinkStore.getState().linkMap, sceneUuid, 'bg');
    return { folder: slots.folder?.path || null, primaryFile: slots.primaryFile?.path || null };
  },
};

function imagePathOf(file: Blob | null | undefined): string {
  if (!(file instanceof File)) return '';
  try {
    return window.electronAPI.getPathForFile(file) || '';
  } catch {
    return '';   // 브라우저·슬랙에서 끌어온 그림, 메모리 속 붙여넣기 그림은 경로가 없다
  }
}

/** 다른 확인 창·모달이 떠 있는가 — 떠 있으면 그 위에 끼어들지 않는다. 이 제안 창 자신은 내용만 바꾼다. */
function otherModalOpen(): boolean {
  if (GuideFolderSuggestSheet.isOpen()) return false;
  return document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]') !== null;
}

export function suggestGuideFolder(input: { sceneUuid: string | null | undefined; method: GuideImageMethod; file?: Blob | null }): void {
  const seq = ++requestSeq;
  void (async () => {
    const { sceneUuid, method, file } = input;
    if (!sceneUuid) return;   // 씬 데이터가 없는 씬 — 작업 링크 칸도 잠겨 있다
    if (!(await isGuideFolderSuggestEnabled())) return;
    if (seq !== requestSeq) return;

    let imagePath = imagePathOf(file);
    if (!imagePath && method === 'paste') {
      imagePath = (await window.electronAPI.workFolderClipboardImagePath?.()) ?? '';
      if (seq !== requestSeq) return;
    }
    const fileName = file instanceof File && file.name && file.name !== 'image.png'
      ? file.name
      : imagePath ? leafName(imagePath) : null;

    const location = findSceneLocation(useDataStore.getState().episodes, sceneUuid);
    if (!location || location.part.department !== 'bg') return;
    const partSceneUuids = location.part.scenes
      .map((scene) => scene.id)
      .filter((id): id is string => !!id && id !== sceneUuid);
    const otherBgPartSceneUuids = location.episode.parts
      .filter((part) => part.department === 'bg' && part !== location.part)
      .flatMap((part) => part.scenes.map((scene) => scene.id))
      .filter((id): id is string => !!id);

    const suggestion = await buildGuideFolderSuggestion({
      sceneUuid,
      scene: { sceneId: location.scene.sceneId, partId: location.part.partId },
      method,
      imagePath,
      fileName,
      partSceneUuids,
      otherBgPartSceneUuids,
    }, deps);
    if (seq !== requestSeq || !suggestion) return;
    if (otherModalOpen()) return;
    GuideFolderSuggestSheet.show(suggestion);
  })().catch((err) => {
    console.warn('[guideFolderSuggestion] 제안 만들기 실패', err);
  });
}
