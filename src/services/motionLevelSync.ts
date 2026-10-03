/**
 * 앱 설정 '움직임'(preferences.json 의 motionLevel)을 창마다 맞춘다. (움직임 폴리싱 바탕 B 2단계)
 *
 * - 시작: 저장값을 읽어 <html data-motion> 에 적는다(main.tsx 가 렌더 전에 한 번 부른다 — 메인 창·위젯 팝업 창 공통).
 * - 변경: 설정 화면이 saveMotionLevel 로 이 창에 바로 반영(낙관적)하고, 저장한 뒤 { motionLevel } 을 방송한다.
 *         다른 창(플로팅 위젯 등)은 방송을 받아 같은 값을 적는다.
 *         파일에 쓰지 못하면 방송하지 않고 이 창을 파일에 남은 값으로 되돌린 뒤 짧게 알린다.
 * 저장은 기존 개인 설정 경로(렌더러 → IPC → 메인이 %APPDATA% 파일에 씀)를 그대로 쓴다.
 */
import { toast } from 'sonner';
import { loadPreferences, savePreferences } from '@/services/settingsService';
import {
  applyStoredMotionLevel,
  createMotionLevelSaveQueue,
  motionLevelBroadcastPayload,
  motionLevelFromBroadcast,
  motionLevelWriteMark,
  normalizeMotionLevel,
  setMotionLevel,
  type MotionLevel,
} from '@/utils/motionLevel';

/** 파일에 쓰지 못해 되돌렸을 때의 안내(제목 + 한 줄 설명). */
export const MOTION_LEVEL_SAVE_FAILED_MESSAGE = '움직임 설정을 저장하지 못했어요';
export const MOTION_LEVEL_SAVE_FAILED_DETAIL = '원래 설정으로 돌려 놓았어요';

let started = false;

/** 이 창의 방송 표시 — 방송은 보낸 창에도 돌아오므로, 자기 방송 중 오래된 것을 가려낸다. */
const windowTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let lastRequestSeq = 0;
/** 저장은 한 줄로 — 빠르게 연달아 골라도 옛 저장이 새 값 뒤에 파일·다른 창을 되돌리지 않는다. */
const saveQueue = createMotionLevelSaveQueue();

export function startMotionLevelSync(): void {
  if (started) return;
  started = true;

  const mark = motionLevelWriteMark();
  void loadPreferences()
    .then((prefs) => {
      applyStoredMotionLevel(prefs?.motionLevel, mark);
    })
    .catch((err) => console.warn('[설정] 움직임 설정 읽기 실패', err));

  window.electronAPI?.onPreferencesChanged?.((payload: unknown) => {
    const level = motionLevelFromBroadcast(payload, { from: windowTag, seq: lastRequestSeq });
    if (level) setMotionLevel(level);
  });
}

/**
 * 설정 화면에서 고를 때. 이 창에 먼저 반영하고, 파일에 저장한 뒤 다른 창에 알린다.
 * 저장은 차례로 — 앞 저장이 끝나기 전에 또 고르면, 앞 저장이 끝난 뒤 마지막 값만 쓰고 방송한다.
 * 파일에 쓰지 못하면(코덱스 2차 지적) 방송하지 않는다 — 방송하면 열린 창은 모두 새 값인데 다음 실행 때 옛 값으로 돌아간다.
 * 이 창도 파일에 남아 있는 값(다음 실행 때 쓰일 값)으로 되돌리고 짧게 알린다.
 */
export async function saveMotionLevel(value: MotionLevel): Promise<void> {
  const level = normalizeMotionLevel(value);
  lastRequestSeq += 1;
  const seq = lastRequestSeq;
  setMotionLevel(level);
  await saveQueue.enqueue(seq, async (isStale) => {
    const existing = (await loadPreferences()) ?? {};
    // 읽는 사이 더 새 값을 골랐으면 쓰지 않는다 — 다음 차례가 새 값을 쓰고 방송한다.
    if (isStale()) return;
    const saved = await savePreferences({ ...existing, motionLevel: level });
    if (!saved) {
      // 쓰는 사이 더 새 값을 골랐으면 다음 차례가 다시 쓴다 — 되돌리지도 알리지도 않는다.
      if (isStale()) return;
      setMotionLevel(normalizeMotionLevel(existing.motionLevel));
      toast.error(MOTION_LEVEL_SAVE_FAILED_MESSAGE, { description: MOTION_LEVEL_SAVE_FAILED_DETAIL });
      return;
    }
    window.electronAPI?.preferencesBroadcastChange?.(motionLevelBroadcastPayload(level, { from: windowTag, seq }));
  });
}
