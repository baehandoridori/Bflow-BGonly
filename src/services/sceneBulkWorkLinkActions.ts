import { toast } from 'sonner';
import { showUndoToast } from '@/components/common/UndoToast';
import { BulkWorkLinkDialog } from '@/components/scenes/BulkWorkLinkDialog';
import { useDataStore } from '@/stores/useDataStore';
import { useSceneWorkLinkStore } from '@/stores/useSceneWorkLinkStore';
import {
  BULK_LINK_TEXT, buildBulkLinkOffer, bulkLinkRecheckFailedText, bulkLinkResultText, bulkLinkSourceChangedText, bulkUndoResultText,
  findBulkLinkScope, planBulkLink, planBulkUndo, sameWorkPath,
  type BulkLinkOffer, type BulkLinkWrite,
} from '@/utils/sceneBulkWorkLink';
import { getSceneWorkLinkSlots } from '@/utils/sceneWorkLinks';
import type { SceneWorkLinkDepartment } from '@/types';

/** 후보의 링크를 읽는 데 이보다 오래 걸리면 제안을 버린다. */
export const BULK_LINK_OFFER_MAX_WAIT_MS = 3000;
/** 누르는 순간의 다시 읽기를 이보다 오래 기다리지 않는다. 넘기면 쓰지 않는다 — 한꺼번에 연결은 알리고 끝내고(7.2), 되돌리기는 '되돌리기'를 다시 건다(7.4). */
export const BULK_LINK_RECHECK_MAX_WAIT_MS = 1500;
/** '되돌리기'를 누를 수 있는 시간. 다시 건 '되돌리기'도 같다. */
export const BULK_LINK_UNDO_MS = 10_000;

let offerRun = 0;

/** 다른 확인 창·모달이 떠 있는가 — 떠 있으면 그 위에 끼어들지 않는다(5절). */
function otherModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]') !== null;
}

/**
 * 누르는 순간의 칸을 믿을 수 있게 그 씬들의 링크를 다시 읽는다(5절).
 * 읽기를 제때 마쳤을 때만 참을 돌려준다. 읽기가 실패했거나 BULK_LINK_RECHECK_MAX_WAIT_MS를 넘겼으면 거짓이다.
 */
async function reloadLinks(sceneUuids: string[]): Promise<boolean> {
  const load = useSceneWorkLinkStore.getState().loadForSceneUuids(sceneUuids).then(
    () => true,
    (err) => {
      console.warn('[sceneBulkWorkLink] 누르는 순간의 링크 다시 읽기 실패', err);
      return false;
    },
  );
  const timeout = new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), BULK_LINK_RECHECK_MAX_WAIT_MS); });
  return Promise.race([load, timeout]);
}

export async function offerBulkWorkLink(input: {
  sceneUuid: string;
  department: SceneWorkLinkDepartment;
  path: string;
  userId: string | null;
  /** 한 칸 저장의 성공 알림. 한꺼번에 연결의 결과 알림을 띄울 때 닫는다. */
  savedToastId?: string | number;
}): Promise<void> {
  try {
    if (BulkWorkLinkDialog.isOpen()) return;
    const run = ++offerRun;
    const scope = findBulkLinkScope(useDataStore.getState().episodes, input.sceneUuid, input.department, input.path);
    if (!scope) return;
    const uuids = [...scope.named, ...scope.layout]
      .map((scene) => scene.id)
      .filter((id): id is string => Boolean(id));
    const startedAt = Date.now();
    if (uuids.length > 0) await useSceneWorkLinkStore.getState().loadForSceneUuids(uuids);
    if (run !== offerRun || BulkWorkLinkDialog.isOpen()) return;
    if (Date.now() - startedAt > BULK_LINK_OFFER_MAX_WAIT_MS) return;
    const linkMap = useSceneWorkLinkStore.getState().linkMap;
    const own = getSceneWorkLinkSlots(linkMap, input.sceneUuid, input.department).primaryFile?.path;
    if (!sameWorkPath(own, input.path)) return;
    const offer = buildBulkLinkOffer(scope, input.path, input.department, linkMap);
    if (!offer) return;
    if (otherModalOpen()) return;
    const selected = await BulkWorkLinkDialog.show(offer);
    if (!selected || selected.length === 0) return;
    await runBulkWorkLink(offer, selected, input.userId, input.savedToastId);
  } catch (err) {
    console.warn('[sceneBulkWorkLink] 한꺼번에 연결 제안을 건너뜁니다', err);
  }
}

async function runBulkWorkLink(
  offer: BulkLinkOffer,
  selectedKeys: string[],
  userId: string | null,
  savedToastId: string | number | undefined,
): Promise<void> {
  const picked = new Set(selectedKeys);
  const uuids = offer.candidates
    .filter((item) => picked.has(item.key))
    .map((item) => item.sceneUuid)
    .filter((id): id is string => Boolean(id));
  const fresh = await reloadLinks([offer.linkedSceneUuid, ...uuids]);
  if (!fresh) {
    toast.error(bulkLinkRecheckFailedText(offer.linkedSceneId));
    return;
  }
  const store = useSceneWorkLinkStore.getState();
  const own = getSceneWorkLinkSlots(store.linkMap, offer.linkedSceneUuid, offer.department).primaryFile?.path;
  if (!sameWorkPath(own, offer.path)) {
    toast(bulkLinkSourceChangedText(offer.linkedSceneId));
    return;
  }
  // 창이 떠 있는 사이 씬 번호·레이아웃이 바뀌었을 수 있다 — 지금의 씬 자료로 묶음을 다시 찾는다(읽기 없음).
  const scope = findBulkLinkScope(useDataStore.getState().episodes, offer.linkedSceneUuid, offer.department, offer.path);
  const plan = planBulkLink(offer, selectedKeys, store.linkMap, scope);
  const settled = await Promise.allSettled(plan.writes.map((write) => store.upsertLink({
    sceneUuid: write.sceneUuid,
    department: offer.department,
    linkKind: 'primary_file',
    path: offer.path,
    userId,
  })));
  const done: BulkLinkWrite[] = [];
  const failed: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') done.push(plan.writes[index]);
    else {
      failed.push(plan.writes[index].sceneId);
      console.warn('[sceneBulkWorkLink] 연결 실패', plan.writes[index].sceneId, result.reason);
    }
  });
  const message = bulkLinkResultText({ linked: done.map((write) => write.sceneId), failed, changed: plan.changed });
  if (done.length === 0) {
    if (failed.length > 0) toast.error(message);
    else toast(message);
    return;
  }
  toast.success(message);
}
