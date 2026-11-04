/** 알림 설정 — 순수 모듈(node --test 로 바로 검사). 화면·알림 띄우기는 notificationHelper.ts. */

/**
 * 알림 설정(v1.146.0 — 씬 댓글 B안 §6.4). '나를 부른 알림'(멘션·답글·배정·피드백)은 항상 켜져 있어 키가 없다.
 * 예전 키(sceneChange·commentNotify·sound·syncComplete·toastDuration)는 읽을 때 resolveNotificationSettings 가 옮긴다.
 */
export interface NotificationSettings {
  /** 내 씬 자동 알림 — 담당 씬 댓글·단계 변경(조용함). 기본 켜짐. */
  sceneAuto?: boolean;
  /** 리테이크 알림 — 등록·진행·해결·리테이크 댓글. 기본 켜짐. */
  retake?: boolean;
  /** 반응 알림 — 내 댓글에 단 이모지. 기본 꺼짐. */
  reaction?: boolean;
  /** Windows 알림(앱이 뒤에 있을 때). 기본 켜짐. */
  osNotification?: boolean;
}

/** 저장된 설정(예전 키 포함) → 지금 설정. 예전 '내 씬 변경'·'내 씬 댓글'을 하나라도 껐으면 '내 씬 자동 알림'도 꺼진 것으로 본다. */
export function resolveNotificationSettings(saved: Record<string, unknown> | null | undefined): Required<NotificationSettings> {
  const s = saved ?? {};
  const bool = (key: string): boolean | undefined => (typeof s[key] === 'boolean' ? (s[key] as boolean) : undefined);
  const legacyAuto = bool('sceneChange') === false || bool('commentNotify') === false ? false : undefined;
  return {
    sceneAuto: bool('sceneAuto') ?? legacyAuto ?? true,
    retake: bool('retake') ?? true,
    reaction: bool('reaction') ?? false,
    osNotification: bool('osNotification') ?? true,
  };
}
