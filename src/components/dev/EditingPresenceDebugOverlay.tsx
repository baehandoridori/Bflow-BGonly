// src/components/dev/EditingPresenceDebugOverlay.tsx
// DEV 전용 종단 검증 오버레이 (PR3에서 제거). 현재 프레즌스 스냅샷을 화면 우하단에 표시.
import { useEditingPresenceStore } from '@/stores/useEditingPresenceStore';

export function EditingPresenceDebugOverlay() {
  // 훅은 항상 최상단에서 호출(rules-of-hooks). 렌더 게이트는 App 루트에서 import.meta.env.DEV로 처리.
  const byScene = useEditingPresenceStore((s) => s.byScene);
  if (!import.meta.env.DEV) return null;
  const rows = Object.entries(byScene);
  return (
    <div style={{ position: 'fixed', bottom: 8, right: 8, zIndex: 99999, background: 'rgba(0,0,0,.8)', color: '#fff', font: '11px monospace', padding: 8, borderRadius: 8, maxWidth: 320, pointerEvents: 'none' }}>
      <div style={{ opacity: .6 }}>[presence] {rows.length} scene(s)</div>
      {rows.map(([uuid, users]) => (<div key={uuid}>{uuid.slice(0, 8)}: {users.map((u) => u.username).join(', ')}</div>))}
    </div>
  );
}
