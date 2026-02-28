import type { WhiteboardData, WhiteboardLayer, WhiteboardStroke, WhiteboardTab } from '@/types/whiteboard';

const LOCAL_FILE = 'whiteboard-local.json';
const POLL_INTERVAL = 2500;
const SAVE_DEBOUNCE = 500;
const MAX_RETRIES = 3;

// ─── 기본 데이터 ────────────────────────────────────────────

export function createDefaultWhiteboardData(): WhiteboardData {
  return {
    version: 1,
    layers: [{ id: 'layer-1', name: '레이어 1', visible: true, order: 0 }],
    strokes: [],
    canvasWidth: 1920,
    canvasHeight: 1080,
    lastModified: Date.now(),
  };
}

// ─── 로컬 저장소 (AppData) ──────────────────────────────────

export async function loadLocalWhiteboard(): Promise<WhiteboardData> {
  const data = await window.electronAPI?.readSettings(LOCAL_FILE);
  if (data && typeof data === 'object' && 'version' in (data as WhiteboardData)) {
    return data as WhiteboardData;
  }
  return createDefaultWhiteboardData();
}

export async function saveLocalWhiteboard(data: WhiteboardData): Promise<void> {
  data.lastModified = Date.now();
  await window.electronAPI?.writeSettings(LOCAL_FILE, data);
}

// ─── 공유 저장소 (공유 드라이브) ────────────────────────────

export async function loadSharedWhiteboard(): Promise<WhiteboardData | null> {
  const result = await window.electronAPI?.whiteboardReadShared();
  if (!result) return null;
  if (!result.ok) throw new Error(result.error ?? '공유 화이트보드 읽기 실패');
  return result.data;
}

async function writeSharedWithRetry(data: WhiteboardData, retries = MAX_RETRIES): Promise<void> {
  for (let i = 0; i < retries; i++) {
    const result = await window.electronAPI?.whiteboardWriteShared(data);
    if (result?.ok) return;
    if (i < retries - 1) await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('공유 화이트보드 저장 실패 (재시도 초과)');
}

export async function saveSharedWhiteboard(data: WhiteboardData): Promise<void> {
  data.lastModified = Date.now();
  await writeSharedWithRetry(data);
}

// ─── 스트로크 ID 기반 병합 ──────────────────────────────────

export function mergeWhiteboardData(local: WhiteboardData, remote: WhiteboardData): WhiteboardData {
  const remoteStrokeIds = new Set(remote.strokes.map((s) => s.id));
  const localStrokeIds = new Set(local.strokes.map((s) => s.id));

  // 원격에 없는 다른 사용자의 스트로크 → 삭제된 것
  // 원격에만 있는 스트로크 → 추가
  const merged: WhiteboardStroke[] = [];

  // 원격 스트로크 전부 포함
  for (const s of remote.strokes) {
    merged.push(s);
  }

  // 로컬에만 있는 스트로크 추가 (현재 사용자가 방금 추가한 것)
  for (const s of local.strokes) {
    if (!remoteStrokeIds.has(s.id)) {
      merged.push(s);
    }
  }

  return {
    ...remote,
    strokes: merged,
    layers: remote.layers, // 레이어 메타데이터는 원격 우선
    lastModified: Math.max(local.lastModified, remote.lastModified),
  };
}

// ─── 디바운스 저장 유틸 ─────────────────────────────────────

export function createDebouncedSave(tab: WhiteboardTab) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return (data: WhiteboardData) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        if (tab === 'local') {
          await saveLocalWhiteboard(data);
        } else {
          await saveSharedWhiteboard(data);
        }
      } catch (err) {
        console.error('[WhiteboardService] 저장 실패:', err);
      }
    }, SAVE_DEBOUNCE);
  };
}

// ─── 폴링 (공용 탭) ────────────────────────────────────────

export function startSharedPolling(
  onUpdate: (data: WhiteboardData) => void,
  getLastModified: () => number,
): () => void {
  let active = true;

  const poll = async () => {
    if (!active) return;
    try {
      const remote = await loadSharedWhiteboard();
      if (remote && remote.lastModified > getLastModified()) {
        onUpdate(remote);
      }
    } catch {
      // 공유 드라이브 미연결 시 무시
    }
    if (active) setTimeout(poll, POLL_INTERVAL);
  };

  setTimeout(poll, POLL_INTERVAL);

  return () => { active = false; };
}

// ─── 경고 체크 ──────────────────────────────────────────────

export function checkDataWarnings(data: WhiteboardData): string[] {
  const warnings: string[] = [];
  if (data.strokes.length > 10000) {
    warnings.push(`스트로크 수가 ${data.strokes.length.toLocaleString()}개입니다. 성능이 저하될 수 있습니다.`);
  }
  const jsonSize = JSON.stringify(data).length;
  if (jsonSize > 5 * 1024 * 1024) {
    warnings.push(`파일 크기가 ${(jsonSize / 1024 / 1024).toFixed(1)}MB입니다. 동기화가 느려질 수 있습니다.`);
  }
  return warnings;
}
