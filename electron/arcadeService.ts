// 아케이드 포인트 서비스 (main 소유 canonical 세션).
// marketAccountService 의 축소 복제 — 의존성 주입만으로 node:test 에서 전부 목 가능하도록
// 런타임 의존성 없이 자립형으로 둔다.

const HANSOL_NAME = '배한솔';
const HANSOL_SLACK_ID = 'U05DFV9UAN5';

// constants.ts ARCADE_BALANCE.dailyLoginPoints 와 동기화되는 표시용 값(지갑 절대값은 서버가 정본).
const DAILY_LOGIN_POINTS = 20;

export type ArcadeCommandKind =
  | 'daily-login'
  | 'activity'
  | 'game-start'
  | 'game-finish'
  | 'achievement-unlock'
  | 'config-set';

export interface ArcadeExecuteCommand {
  kind: ArcadeCommandKind;
  requestId: string;
  activity?: string;
  runId?: string;
  gameId?: string;
  score?: number;
  durationMs?: number;
  meta?: Record<string, number>;
  achievementId?: string;
  slackNotifyEnabled?: boolean;
}

export interface ArcadeWalletMirror {
  walletPoints: number;
  lifetimeEarnedPoints: number;
}

export interface ArcadeExecuteResult {
  replayed?: boolean;
  granted?: boolean;
  attendance?: { streakDays: number; todayGranted: boolean };
  awarded?: boolean;
  points?: number;
  capped?: boolean;
  grade?: string;
  rewardPoints?: number;
  rewardCapped?: boolean;
  newAlltimeBest?: boolean;
  newWeeklyBest?: boolean;
  prevBestScore?: number | null;
  myBestScore?: number;
  todayRewardedRuns?: number;
  slackNotifyEnabled?: boolean;
  wallet?: ArcadeWalletMirror;
  config?: { slackNotifyEnabled: boolean };
  [key: string]: unknown;
}

export interface ArcadeActor {
  userId: string | null;
  name: string | null;
  slackId: string | null;
}

export interface ArcadeWalletUpdate {
  wallet: ArcadeWalletMirror;
  delta: number;
  reason: string;
}

export interface ArcadeSlackRecord {
  title: string;
  detail: string;
  player: string;
}

export interface AwardActivityInput {
  activity: 'scene-stage' | 'scene-phase-done' | 'comment' | 'retake-done';
  refId: string;
  stage?: string;
}

export interface ArcadeServiceDependencies {
  read(userId: string): Promise<unknown>;
  execute(userId: string, command: ArcadeExecuteCommand): Promise<unknown>;
  resolveActor(): ArcadeActor | null;
  broadcastWalletUpdate(update: ArcadeWalletUpdate): void;
  sendSlackRecord(record: ArcadeSlackRecord): void | Promise<void>;
  getNowMs(): number;
  // 진행 중 세션 변경(로그아웃/사용자 전환) 감지용 canonical 세션 epoch.
  getSessionEpoch(): number;
  logger?: Pick<Console, 'error'>;
}

// 진행 중 세션이 바뀌어 스테일 결과를 반영하지 않을 때 던진다.
export class ArcadeSessionChangedError extends Error {
  constructor() {
    super('세션이 바뀌어 아케이드 결과를 반영하지 않았어요');
    this.name = 'ArcadeSessionChangedError';
  }
}

// ArcadeExecuteCommand → RPC p_payload (requestId·kind 를 제외한 kind별 필드).
export function arcadeExecutePayload(command: ArcadeExecuteCommand): Record<string, unknown> {
  switch (command.kind) {
    case 'daily-login':
      return {};
    case 'activity':
      return { activity: command.activity };
    case 'game-start':
      return { runId: command.runId, gameId: command.gameId };
    case 'game-finish':
      return {
        runId: command.runId,
        gameId: command.gameId,
        score: command.score,
        durationMs: command.durationMs,
        meta: command.meta,
      };
    case 'achievement-unlock':
      return { achievementId: command.achievementId };
    case 'config-set':
      return { slackNotifyEnabled: command.slackNotifyEnabled };
    default:
      return {};
  }
}

interface ArcadeMutationQueue {
  enqueue<T>(userId: string, operation: () => Promise<T>): Promise<T>;
}

function createArcadeMutationQueue(): ArcadeMutationQueue {
  const tails = new Map<string, Promise<void>>();
  return {
    enqueue<T>(userId: string, operation: () => Promise<T>): Promise<T> {
      const previous = tails.get(userId) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(operation);
      const tail = result.then(() => undefined, () => undefined);
      tails.set(userId, tail);
      void tail.finally(() => {
        if (tails.get(userId) === tail) tails.delete(userId);
      });
      return result;
    },
  };
}

function isCanonical(actor: ArcadeActor | null): actor is ArcadeActor & { userId: string } {
  return (
    !!actor
    && typeof actor.userId === 'string'
    && actor.userId.length > 0
    && actor.name === HANSOL_NAME
    && actor.slackId === HANSOL_SLACK_ID
  );
}

function asResult(value: unknown): ArcadeExecuteResult {
  return value && typeof value === 'object' ? (value as ArcadeExecuteResult) : {};
}

export class ArcadeService {
  private readonly deps: ArcadeServiceDependencies;
  private readonly logger: Pick<Console, 'error'>;
  private readonly queue = createArcadeMutationQueue();
  private readonly dailyLoginAttempts = new Set<string>();

  constructor(deps: ArcadeServiceDependencies) {
    this.deps = deps;
    this.logger = deps.logger ?? console;
  }

  // 네트워크 오류 1회 재시도 — 같은 request_id 를 재사용하므로 서버 멱등이 중복을 막는다.
  // retried=true 는 "첫 시도가 실패해 재시도했다"는 뜻: 이 경우 서버가 replayed 를 돌려줘도
  // 이 프로세스는 원 성공을 관찰하지 못했으므로 지갑을 반영·broadcast 해야 한다.
  private async withRetryMeta<T>(work: () => Promise<T>): Promise<{ value: T; retried: boolean }> {
    try {
      return { value: await work(), retried: false };
    } catch (error) {
      this.logger.error('[arcade] request failed, retrying once', error);
      return { value: await work(), retried: true };
    }
  }

  async read(userId: string): Promise<ArcadeExecuteResult> {
    const startedEpoch = this.deps.getSessionEpoch();
    const { value } = await this.withRetryMeta(() => this.deps.read(userId));
    this.assertSameSession(startedEpoch);
    return asResult(value);
  }

  private async executeWithMeta(
    userId: string,
    command: ArcadeExecuteCommand,
  ): Promise<{ result: ArcadeExecuteResult; retried: boolean }> {
    const startedEpoch = this.deps.getSessionEpoch();
    return this.queue.enqueue(userId, async () => {
      // 큐 대기 중 세션이 바뀌었으면(로그아웃/사용자 전환) RPC 자체를 실행하지 않는다
      // — 스테일 입장료 차감·포인트 지급을 서버에 남기지 않기 위해 쓰기 전에 먼저 검증한다.
      this.assertSameSession(startedEpoch);
      const { value, retried } = await this.withRetryMeta(() => this.deps.execute(userId, command));
      // RPC 후에도 재확인 — 스테일 결과를 반영·broadcast·슬랙하지 않는다.
      this.assertSameSession(startedEpoch);
      const result = asResult(value);
      this.maybeNotifyRecord(command, result, retried);
      return { result, retried };
    });
  }

  async execute(userId: string, command: ArcadeExecuteCommand): Promise<ArcadeExecuteResult> {
    const { result } = await this.executeWithMeta(userId, command);
    return result;
  }

  // 재시도 후 재생이면 이 프로세스가 원 성공을 못 봤으므로 지갑을 반영해야 한다.
  private shouldApplyWallet(result: ArcadeExecuteResult, retried: boolean): boolean {
    return !result.replayed || retried;
  }

  private assertSameSession(startedEpoch: number): void {
    if (this.deps.getSessionEpoch() !== startedEpoch) {
      throw new ArcadeSessionChangedError();
    }
  }

  async awardActivity(input: AwardActivityInput): Promise<void> {
    const actor = this.deps.resolveActor();
    if (!isCanonical(actor)) return;
    const requestId = this.activityRequestId(input);
    if (!requestId) return;
    try {
      const { result, retried } = await this.executeWithMeta(actor.userId, {
        kind: 'activity',
        requestId,
        activity: input.activity,
      });
      if (
        this.shouldApplyWallet(result, retried)
        && result.awarded
        && typeof result.points === 'number'
        && result.points > 0
        && result.wallet
      ) {
        this.deps.broadcastWalletUpdate({ wallet: result.wallet, delta: result.points, reason: input.activity });
      }
    } catch (error) {
      this.logger.error('[arcade] awardActivity failed', error);
    }
  }

  async grantDailyLogin(): Promise<void> {
    const actor = this.deps.resolveActor();
    if (!isCanonical(actor)) return;
    const today = this.kstToday();
    const key = `${actor.userId}|${today}`;
    if (this.dailyLoginAttempts.has(key)) return;
    try {
      const { result, retried } = await this.executeWithMeta(actor.userId, {
        kind: 'daily-login',
        requestId: `daily-login:${today}`,
      });
      // 성공 시에만 기억한다 — 자정 경계 등으로 실패하면 다음 트리거에서 재시도한다.
      this.dailyLoginAttempts.add(key);
      if (this.shouldApplyWallet(result, retried) && result.wallet) {
        this.deps.broadcastWalletUpdate({
          wallet: result.wallet,
          delta: DAILY_LOGIN_POINTS,
          reason: 'daily-login',
        });
      }
    } catch (error) {
      this.logger.error('[arcade] grantDailyLogin failed', error);
    }
  }

  private maybeNotifyRecord(command: ArcadeExecuteCommand, result: ArcadeExecuteResult, retried: boolean): void {
    if (
      command.kind !== 'game-finish'
      || !result.newAlltimeBest
      || !result.slackNotifyEnabled
      || !this.shouldApplyWallet(result, retried)
    ) {
      return;
    }
    const actor = this.deps.resolveActor();
    const player = actor?.name ?? HANSOL_NAME;
    const score = typeof command.score === 'number' ? command.score : 0;
    const detail = result.prevBestScore == null
      ? `첫 기록 ${score}`
      : `이전 최고 ${result.prevBestScore} → ${score}`;
    try {
      void Promise.resolve(this.deps.sendSlackRecord({ title: '새 기록 달성', detail, player }))
        .catch((error) => this.logger.error('[arcade] slack record failed', error));
    } catch (error) {
      this.logger.error('[arcade] slack record failed', error);
    }
  }

  private activityRequestId(input: AwardActivityInput): string | null {
    switch (input.activity) {
      case 'scene-stage':
        return input.stage ? `scene-stage:${input.refId}:${input.stage}` : null;
      case 'scene-phase-done':
        return `scene-phase-done:${input.refId}`;
      case 'comment':
        return `comment:${input.refId}`;
      case 'retake-done':
        return `retake-done:${input.refId}`;
      default:
        return null;
    }
  }

  private kstToday(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(this.deps.getNowMs()));
  }
}
