/**
 * 앱 설정 '움직임'(preferences.json 의 motionLevel)을 창마다 맞춘다. (움직임 폴리싱 바탕 B 2단계)
 *
 * - 시작: 저장값을 읽어 <html data-motion> 에 적는다(main.tsx 가 렌더 전에 한 번 부른다 — 메인 창·위젯 팝업 창 공통).
 * - 변경: 설정 화면이 saveMotionLevel 로 이 창에 바로 반영(낙관적)하고, 저장한 뒤 { motionLevel } 을 방송한다.
 *         다른 창(플로팅 위젯 등)은 방송을 받아 같은 값을 적는다.
 * 저장은 기존 개인 설정 경로(렌더러 → IPC → 메인이 %APPDATA% 파일에 씀)를 그대로 쓴다.
 */
import { loadPreferences, savePreferences } from '@/services/settingsService';
import {
  applyStoredMotionLevel,
  motionLevelBroadcastPayload,
  motionLevelFromBroadcast,
  motionLevelWriteMark,
  normalizeMotionLevel,
  setMotionLevel,
  type MotionLevel,
} from '@/utils/motionLevel';

let started = false;

/** 이 창의 방송 표시 — 방송은 보낸 창에도 돌아오므로, 자기 방송 중 오래된 것을 가려낸다. */
const windowTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let lastRequestSeq = 0;

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

/** 설정 화면에서 고를 때. 이 창에 먼저 반영하고, 파일에 저장한 뒤 다른 창에 알린다. */
export async function saveMotionLevel(value: MotionLevel): Promise<void> {
  const level = normalizeMotionLevel(value);
  lastRequestSeq += 1;
  const seq = lastRequestSeq;
  setMotionLevel(level);
  const existing = (await loadPreferences()) ?? {};
  await savePreferences({ ...existing, motionLevel: level });
  window.electronAPI?.preferencesBroadcastChange?.(motionLevelBroadcastPayload(level, { from: windowTag, seq }));
}
