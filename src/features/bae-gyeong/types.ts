import type { BaeAccess, BaeMember, BaeMemberRole } from '../../shared/bae/access';
import type { BaeSettingKey, BaeSettingRow } from '../../shared/bae/settings';
import type { BaeKeyStatus } from '../../shared/bae/secrets';

/** 메인이 화면에 주는 설정 책장 (본문은 관리자에게만). */
export interface BaeSettingsView {
  access: BaeAccess;
  rows: BaeSettingRow[];
  defaults: { manual: string | null; fixed: string | null };
}

export type BaeChange = 'settings' | 'members' | 'jobs';

/** preload 가 `window.baeGyeongAPI` 로 여는 통로, 그리고 테스트 모드의 가짜 저장소가 같은 모양으로 흉내 낸다. */
export interface BaeGateway {
  access(): Promise<BaeAccess>;
  settings(): Promise<BaeSettingsView>;
  settingsSave(key: BaeSettingKey, value: unknown, expectedRevision: number): Promise<BaeSettingRow>;
  settingsSeed(key: 'manual' | 'fixed', expectedRevision: number): Promise<BaeSettingRow>;
  settingsHistory(key: BaeSettingKey): Promise<BaeSettingRow[]>;
  keyStatus(): Promise<BaeKeyStatus>;
  keySet(key: string): Promise<BaeKeyStatus>;
  membersList(): Promise<BaeMember[]>;
  membersSet(userId: string, role: BaeMemberRole | null): Promise<BaeMember[]>;
  onChanged(callback: (what: BaeChange) => void): () => void;
}

declare global {
  interface Window { baeGyeongAPI?: BaeGateway }
}
