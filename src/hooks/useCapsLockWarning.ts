import { useState, useCallback } from 'react';

/** Caps Lock 감지 — 비밀번호 입력에 사용. input의 onKeyDown/onKeyUp에 연결 */
export function useCapsLockWarning() {
  const [isCapsLockOn, setCapsLockOn] = useState(false);
  const onKey = useCallback((e: React.KeyboardEvent) => {
    // getModifierState는 keydown/keyup에서 모두 현재 상태를 반환
    setCapsLockOn(e.getModifierState('CapsLock'));
  }, []);
  return { isCapsLockOn, onKeyDown: onKey, onKeyUp: onKey };
}
