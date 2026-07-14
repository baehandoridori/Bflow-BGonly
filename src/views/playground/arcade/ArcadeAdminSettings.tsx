import { useArcadeStore } from '@/features/playground/arcade/useArcadeStore';

// 배한솔 관리자 영역 — 신기록 슬랙 알림 스위치. 게이트(authorizedHansol)는 호출부에서 건다.
export function ArcadeAdminSettings() {
  const enabled = useArcadeStore((state) => state.snapshot?.config.slackNotifyEnabled ?? false);
  const mutating = useArcadeStore((state) => state.mutating);
  const ready = useArcadeStore((state) => state.snapshot != null);
  const setSlackNotify = useArcadeStore((state) => state.setSlackNotify);

  return (
    <aside className="pg-arcade-admin" data-pg-arcade-admin aria-label="아케이드 관리 설정">
      <h3>아케이드 관리</h3>
      <div className="pg-arcade-admin__row">
        <label className="pg-arcade-admin__switch" htmlFor="arcade-slack-notify">
          <input
            id="arcade-slack-notify"
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={mutating || !ready}
            onChange={(event) => { void setSlackNotify(event.target.checked); }}
          />
          <span>신기록 슬랙 알림</span>
        </label>
      </div>
      <p className="pg-arcade-admin__hint">
        슬랙 워크플로 주소가 설정된 뒤에 실제로 발송돼요. 켜 두면 전체 최고 기록을 깰 때 자동으로 알려요.
      </p>
    </aside>
  );
}
