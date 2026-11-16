import type { BaeAccess, BaeMember, BaeMemberRole } from '../../shared/bae/access';
import type { BaeSettingKey, BaeSettingRow } from '../../shared/bae/settings';
import type { BaeKeyStatus } from '../../shared/bae/secrets';
import type { BaeJob, BaeJobPage, BaeTeamCursor, BaeTeamFilter, BaeTeamPage, BaeUsageSummary } from '../../shared/bae/jobs';
import type { BaeCostBucket, BaeStamp, BaeStampBulkResult, BaeStampEvent, BaeStampUnseen, BaeUsageTeam } from '../../shared/bae/review';
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

/** 'stamps' = 이 PC 의 다른 창에서 새 도장을 봤다 (景 숫자를 다시 읽는다). 나머지는 서버의 내용 없는 신호. */
export type BaeChange = 'settings' | 'members' | 'jobs' | 'stamps';

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
  // ── 관리자 화면 (8단계). 검수자만 되는 것은 서버가 거절한다. ──
  /** 팀 기록 '바뀐 것만' (신호가 왔을 때). */
  jobsTeam(since: string | null, limit?: number): Promise<BaeJobPage>;
  /** 팀 기록 거르기 · 다음 쪽 (서버가 거른다). */
  jobsTeamFind(filter: BaeTeamFilter, before: BaeTeamCursor | null, limit?: number): Promise<BaeTeamPage>;
  /** 확인 도장 (null = 도장 빼기). 다시는 한 줄 메모가 있어야 한다. 답은 그 작업 (PD 글 포함). */
  jobStamp(jobId: string, stamp: BaeStamp | null, note: string | null): Promise<BaeJob>;
  /** 여러 건에 '확인함' (도장이 이미 있는 것 · 만드는 중인 것은 그대로). */
  jobStampBulk(jobIds: string[]): Promise<BaeStampBulkResult>;
  /** 한 건의 도장 차례 (만든 사람 · 검수자). */
  jobStamps(jobId: string): Promise<BaeStampEvent[]>;
  /** 내 작업에 온 새 도장 (景 숫자 · 내 기록의 표시). */
  stampUnseen(): Promise<BaeStampUnseen>;
  /** 새 도장을 봤다 (upto 까지). 답은 그 뒤의 상태. */
  stampSeen(upto: number | null): Promise<BaeStampUnseen>;
  usageTeam(from: string | null, to: string | null, bucket: BaeCostBucket): Promise<BaeUsageTeam>;
  /** 팀 비용 CSV 를 저장 창으로 (메인이 만든다). 고른 자리, 그만두면 null. */
  usageExport(from: string | null, to: string | null, bucket: BaeCostBucket): Promise<string | null>;
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
