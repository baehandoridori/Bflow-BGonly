/**
 * Windows 알림을 눌렀을 때 갈 곳 — 씬 댓글 B안 §9 (v1.148.0).
 *
 * 렌더러가 Windows 알림을 띄울 때 이 묶음을 같이 보내고(notification:show-native 세 번째 인자),
 * 메인은 알림을 누르면 창을 앞으로 올린 뒤 그대로 돌려준다(notification:native-click).
 * 렌더러는 앱 안 토스트의 '댓글 보기'와 같은 길(읽음 → 씬·댓글로 이동)로 보낸다.
 * 메인·렌더러가 함께 쓰므로 바깥 모듈을 가져오지 않는다(node --test 로 검사).
 */

export interface NativeNotificationJump {
  /** 알림 목록의 id(합쳐졌으면 원래 줄 id) — 눌렀을 때 읽음 처리. */
  notificationId: string;
  /** 띄운 계정 — 그사이 계정이 바뀌었으면 이동하지 않는다. */
  userId: string | null;
  type: string;
  /** 이동에 필요한 값만(글자·숫자·참거짓, 글자 목록). */
  metadata: Record<string, string | number | boolean | string[]>;
}

const MAX_KEYS = 40;
const MAX_STRING = 2000;
const MAX_TOTAL = 8000;

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_STRING) return null;
  return trimmed;
}

/** 믿을 수 없는 입력 → 이동 묶음. 모양이 다르면 null(창만 올린다). */
export function parseNativeNotificationJump(raw: unknown): NativeNotificationJump | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const notificationId = cleanString(input.notificationId);
  const type = cleanString(input.type);
  if (!notificationId || !type || type.length > 40) return null;
  const userId = input.userId === null || input.userId === undefined ? null : cleanString(input.userId);
  if (input.userId !== null && input.userId !== undefined && !userId) return null;

  const metadata: NativeNotificationJump['metadata'] = {};
  const source = input.metadata;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    let total = 0;
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (Object.keys(metadata).length >= MAX_KEYS) break;
      if (!key || key.length > 60 || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      let kept: string | number | boolean | string[] | null = null;
      if (typeof value === 'string') kept = cleanString(value);
      else if (typeof value === 'number' && Number.isFinite(value)) kept = value;
      else if (typeof value === 'boolean') kept = value;
      else if (Array.isArray(value)) {
        const list = value.map(cleanString).filter((item): item is string => !!item).slice(0, 20);
        kept = list.length > 0 ? list : null;
      }
      if (kept === null) continue;
      total += key.length + JSON.stringify(kept).length;
      if (total > MAX_TOTAL) break;
      metadata[key] = kept;
    }
  }
  return { notificationId, userId, type, metadata };
}
