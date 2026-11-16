import type { BaeAccess, BaeMember, BaeMemberRole } from '../../shared/bae/access';
import type { BaeSettingKey, BaeSettingRow } from '../../shared/bae/settings';
import type { BaeKeyStatus } from '../../shared/bae/secrets';
import type { BaeJob, BaeJobPage, BaeUsageSummary } from '../../shared/bae/jobs';
import type {
  BaeDrawCall, BaeDrawOutcome, BaeFailure, BaeOrderCall, BaeOrderOutcome, BaeProgress,
  BaeDrawFinishCall, BaeDrawFinishOutcome, BaeResultSetCall, BaeResultSetOutcome, BaeToolJobCall, BaeToolJobOutcome,
} from '../../shared/bae/makeCalls';

/** 이 PC 의 초안 (재료 창을 닫았다 열어도 이어서). 그림은 정해 둔 이름의 PNG 바이트. */
export interface BaeDraftData { data: unknown; images: Record<string, Uint8Array>; savedAt?: string; missing?: string[] }

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
  /** 내 작업 기록: 커서가 없으면 최근 것부터, 있으면 그 뒤에 바뀐 것만 (plan 14 5-3 '바뀐 것만 받기'). */
  jobsMine(since: string | null, limit?: number): Promise<BaeJobPage>;
  jobGet(jobId: string): Promise<BaeJob>;
  jobHide(jobId: string, hidden: boolean): Promise<BaeJob>;
  usageSummary(from: string | null, to: string | null): Promise<BaeUsageSummary>;
  // ── 만들기 (메인이 PD · 그림 모델을 부른다. 화면을 떠나도 계속된다) ──
  order(call: BaeOrderCall): Promise<BaeOrderOutcome | BaeFailure>;
  draw(call: BaeDrawCall): Promise<BaeDrawOutcome | BaeFailure>;
  /** 그린 뒤 화면이 마무리한 그림을 보내 작업을 끝낸다 (draw 의 답에 finish 가 있을 때만). */
  drawFinish(call: BaeDrawFinishCall): Promise<BaeDrawFinishOutcome | BaeFailure>;
  /** 결과 판 바꾸기: 색 맞춤 켜고 끄기 · 노이즈 제거와 되돌리기 (이 PC 원본이 있을 때만). */
  resultSet(call: BaeResultSetCall): Promise<BaeResultSetOutcome | BaeFailure>;
  /** 도구만 쓴 작업 한 건 (노이즈 제거 창). */
  toolJob(call: BaeToolJobCall): Promise<BaeToolJobOutcome | BaeFailure>;
  abort(jobId: string): Promise<boolean>;
  /** 그림 이름 · 검수 (만든 사람만). status 는 지금 상태 그대로. */
  jobPatch(jobId: string, status: BaeJob['status'], patch: { name?: string | null; selfReview?: Record<string, unknown> | null }): Promise<boolean>;
  active(): Promise<Array<{ jobId: string; phase: 'order' | 'draw'; startedAt: number }>>;
  localFile(jobId: string, name: string): Promise<Uint8Array | null>;
  saveAs(jobId: string, defaultName: string): Promise<string | null>;
  draftSave(draft: BaeDraftData): Promise<boolean>;
  draftLoad(): Promise<BaeDraftData | null>;
  draftClear(): Promise<boolean>;
  online(): Promise<boolean>;
  onProgress(callback: (p: BaeProgress) => void): () => void;
  onChanged(callback: (what: BaeChange) => void): () => void;
}

declare global {
  interface Window { baeGyeongAPI?: BaeGateway }
}
