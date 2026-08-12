// electron/presence/editingPresenceService.ts
import type { PresenceSnapshotBundle, EditingPresencePayload, PresenceKind } from './types';
import { buildWorkFileBasenameIndex, resolveIdsForBasenames, type WorkFileEntry } from './workFileIndex';
import { startMohoTitlePolling } from './mohoWindowPoller';
import { mergePresenceState } from './presenceMerge';
import { createDedupGate } from './dedupGate';

/** 파일 열림 감지 소스 1개 — kind 당 하나씩 main 이 등록한다 (씬·복장, 이후 파일 종류 확장). */
export interface PresenceSource {
  kind: PresenceKind;
  getEntries: () => WorkFileEntry[];
}

export interface EditingPresenceDeps {
  getCurrentUser: () => { userId: string; username: string } | null;
  /** 감지 소스 목록. 폴러는 1개 — 같은 basename 목록을 모든 소스로 해석해 한 payload 로 track 한다. */
  sources: PresenceSource[];
  track: (payload: EditingPresencePayload) => void;
  broadcast: (snapshot: PresenceSnapshotBundle) => void;
  now: () => string;
  intervalMs?: number;
  logCollision?: (basenames: string[]) => void;
}

export interface EditingPresenceHandle {
  /** 서비스 중단(앱 종료 시). */
  stop: () => void;
  /**
   * 사용자 신원 변경(로그아웃/로그인/계정 전환) 시 호출.
   * dedup 기억을 비워, 열린 Moho 파일 집합이 동일해도 다음 폴에서 새 신원으로 재track한다.
   */
  reset: () => void;
}

export function startEditingPresenceService(deps: EditingPresenceDeps): EditingPresenceHandle {
  const warned = new Set<string>();
  const gate = createDedupGate();

  const publish = (basenames: string[]) => {
    const user = deps.getCurrentUser();
    if (!user) return;
    // 폴러는 1개 — 같은 basename 목록을 소스(kind)별 인덱스로 해석해 한 payload 로 track 한다.
    // (presence payload 는 클라이언트당 1개라, kind 별로 따로 track 하면 서로 덮어쓴다.)
    const editing: Record<string, string[]> = {};
    const collisionSet = new Set<string>();
    for (const src of deps.sources) {
      const idx = buildWorkFileBasenameIndex(src.getEntries());
      const { ids, collisions } = resolveIdsForBasenames(idx, basenames);
      editing[src.kind] = ids;
      for (const c of collisions) collisionSet.add(c);
    }
    const fresh = [...collisionSet].filter((c) => !warned.has(c));
    if (fresh.length) { fresh.forEach((c) => warned.add(c)); deps.logCollision?.(fresh); }
    // 어느 kind 가 바뀌어도 재track — kind별 정렬 목록을 한 dedup 키로 합친다.
    const key = deps.sources
      .map((s) => `${s.kind}:${[...(editing[s.kind] ?? [])].sort().join('|')}`)
      .join('#');
    if (!gate.shouldEmit(key)) return;
    deps.track({
      userId: user.userId,
      username: user.username,
      // 구버전(≤v1.99) 호환 미러 — editing.scene 과 항상 동일.
      editingSceneUuids: editing['scene'] ?? [],
      editing,
      updatedAt: deps.now(),
    });
  };

  const polling = startMohoTitlePolling({ intervalMs: deps.intervalMs, onChange: publish });
  return {
    stop: () => polling.stop(),
    reset: () => { gate.reset(); polling.reset(); },
  };
}

/** main.ts의 onPresenceSync 콜백이 호출: 전체 상태 병합 → broadcast */
export function receivePresence(
  state: Record<string, EditingPresencePayload[]>,
  broadcast: (snapshot: PresenceSnapshotBundle) => void,
): void {
  broadcast(mergePresenceState(state));
}
