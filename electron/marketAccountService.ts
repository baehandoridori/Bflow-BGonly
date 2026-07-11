export type MarketEventKind = 'news' | 'shock-up' | 'shock-down' | 'trend' | 'halt';

export interface Holding {
  stockId: string;
  quantityShares: number;
  costBasisWon: number;
}

export interface MarketAccount {
  walletPoints: number;
  lifetimeEarnedPoints: number;
  cashWon: number;
  realizedPnlThisMonthWon: number;
  unrealizedPnlAtMonthStartWon: number;
  holdings: Holding[];
}

export interface MarketAdminEvent {
  id: string;
  stockId: string;
  kind: MarketEventKind;
  title: string;
  impactBps: number;
  startsAt: string;
  endsAt: string | null;
  revision: number;
}

export interface MarketAdminEventInput {
  stockId: string;
  kind: MarketEventKind;
  title: string;
  impactBps: number;
  startsAt: string;
  endsAt: string | null;
}

export type MarketCommand =
  | { kind: 'favorite'; requestId: string; stockId: string; wished: boolean }
  | { kind: 'read-reason'; requestId: string; stockId: string }
  | { kind: 'transfer'; requestId: string; direction: 'wallet-to-broker' | 'broker-to-wallet'; points: number }
  | { kind: 'buy'; requestId: string; stockId: string; quantityShares: number; quotedPriceWon: number; quotedRevision: number }
  | { kind: 'sell'; requestId: string; stockId: string; quantityShares: number | 'all'; quotedPriceWon: number; quotedRevision: number };

export type MarketRequestProbe = 'missing' | 'same' | 'conflict';

export interface MarketRemoteState {
  revision: number;
  account: MarketAccount;
  favoriteStockIds: string[];
  beginnerMission: 'favorite' | 'reason' | 'first-order' | 'complete';
  adminEvents: MarketAdminEvent[];
  requestProbe?: MarketRequestProbe;
}

const HANSOL_NAME = '배한솔';
const HANSOL_SLACK_ID = 'U05DFV9UAN5';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STOCK_IDS = new Set([
  'jbbj',
  'youtube',
  'meta-comedy',
  'netflix',
  'adobe',
  'wacom',
  'slack',
  'google-drive',
]);
const EVENT_KINDS = new Set<MarketEventKind>(['news', 'shock-up', 'shock-down', 'trend', 'halt']);
const BEGINNER_MISSIONS = new Set(['favorite', 'reason', 'first-order', 'complete']);
const REQUEST_PROBES = new Set<MarketRequestProbe>(['missing', 'same', 'conflict']);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = -MAX_SAFE_BIGINT;

export interface MarketCanonicalSession {
  userId: string | null;
  epoch: number;
  name?: string | null;
  slackId?: string | null;
}

interface MarketAuthorizationFingerprint {
  userId: string;
  epoch: number;
  name: string;
  slackId: string;
}

export interface MarketPersistence {
  read(userId: string, probe?: MarketCommand): Promise<unknown>;
  execute(userId: string, command: MarketCommand): Promise<unknown>;
  createAdminEvent(userId: string, input: MarketAdminEventInput): Promise<unknown>;
  deleteAdminEvent(userId: string, eventId: string): Promise<unknown>;
}

export interface MarketAccountServiceDependencies {
  getCanonicalSession(): MarketCanonicalSession;
  getNowMs(): number;
  resolveCanonicalQuote(
    stockId: string,
    nowMs: number,
    events: readonly MarketAdminEvent[],
  ): number;
  persistence: MarketPersistence;
  logger?: Pick<Console, 'error'>;
}

export interface MarketMutationQueue {
  enqueue<T>(userId: string, operation: () => Promise<T>): Promise<T>;
  drain(userId: string): Promise<void>;
  pendingUsers(): number;
}

export function createMarketMutationQueue(): MarketMutationQueue {
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
    async drain(userId: string): Promise<void> {
      while (tails.has(userId)) await tails.get(userId);
    },
    pendingUsers: () => tails.size,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} 문자열을 확인할 수 없어요.`);
  }
  return value;
}

export function parseSafeMarketInteger(value: unknown, label: string): number {
  let parsed: bigint;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`${label} 값은 정수여야 해요.`);
    if (!Number.isSafeInteger(value)) throw new Error(`${label} 값이 안전한 정수 범위를 벗어났어요.`);
    return value;
  }
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) {
    throw new Error(`${label} 값은 정수여야 해요.`);
  }
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} 값은 정수여야 해요.`);
  }
  if (parsed < MIN_SAFE_BIGINT || parsed > MAX_SAFE_BIGINT) {
    throw new Error(`${label} 값이 안전한 정수 범위를 벗어났어요.`);
  }
  return Number(parsed);
}

export function normalizeMarketRequestId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('모의투자 요청 ID는 문자열이어야 해요.');
  }
  if (value.length < 1 || value.length > 200) {
    throw new Error('모의투자 요청 ID는 1~200자로 입력해 주세요.');
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200 || normalized !== value) {
    throw new Error('모의투자 요청 ID 앞뒤에 공백을 넣을 수 없어요.');
  }
  return normalized;
}

function parseNonNegativeInteger(value: unknown, label: string): number {
  const parsed = parseSafeMarketInteger(value, label);
  if (parsed < 0) throw new Error(`${label} 값은 0 이상이어야 해요.`);
  return parsed;
}

function parsePositiveInteger(value: unknown, label: string): number {
  const parsed = parseSafeMarketInteger(value, label);
  if (parsed <= 0) throw new Error(`${label} 값은 양의 정수여야 해요.`);
  return parsed;
}

function parseHolding(value: unknown): Holding {
  if (!isRecord(value)) throw new Error('보유 주식 정보를 확인할 수 없어요.');
  const stockId = parseString(value.stockId, '종목');
  if (!STOCK_IDS.has(stockId)) throw new Error('보유 종목을 확인할 수 없어요.');
  return {
    stockId,
    quantityShares: parsePositiveInteger(value.quantityShares, '보유 수량'),
    costBasisWon: parseNonNegativeInteger(value.costBasisWon, '보유 원가'),
  };
}

function parseAdminEvent(value: unknown): MarketAdminEvent {
  if (!isRecord(value)) throw new Error('시장 이벤트 정보를 확인할 수 없어요.');
  const stockId = parseString(value.stockId, '이벤트 종목');
  const kind = parseString(value.kind, '이벤트 종류') as MarketEventKind;
  const startsAt = parseString(value.startsAt, '이벤트 시작 시각');
  const endsAt = value.endsAt === null ? null : parseString(value.endsAt, '이벤트 종료 시각');
  if (!STOCK_IDS.has(stockId) || !EVENT_KINDS.has(kind)) {
    throw new Error('시장 이벤트 종류를 확인할 수 없어요.');
  }
  if (!Number.isFinite(Date.parse(startsAt)) || (endsAt !== null && !Number.isFinite(Date.parse(endsAt)))) {
    throw new Error('시장 이벤트 시각을 확인할 수 없어요.');
  }
  return {
    id: parseString(value.id, '이벤트 ID'),
    stockId,
    kind,
    title: parseString(value.title, '이벤트 제목'),
    impactBps: parseSafeMarketInteger(value.impactBps, '이벤트 영향'),
    startsAt,
    endsAt,
    revision: parsePositiveInteger(value.revision, '이벤트 revision'),
  };
}

export function parseMarketRemoteState(value: unknown): MarketRemoteState {
  if (!isRecord(value) || !isRecord(value.account)) {
    throw new Error('시장 계좌 응답 형식을 확인할 수 없어요.');
  }
  const holdingsRaw = value.account.holdings;
  const favoritesRaw = value.favoriteStockIds;
  const eventsRaw = value.adminEvents;
  if (!Array.isArray(holdingsRaw) || !Array.isArray(favoritesRaw) || !Array.isArray(eventsRaw)) {
    throw new Error('시장 계좌 목록 형식을 확인할 수 없어요.');
  }
  const holdings = holdingsRaw.map(parseHolding);
  const holdingIds = holdings.map((holding) => holding.stockId);
  if (new Set(holdingIds).size !== holdingIds.length) throw new Error('보유 종목이 중복되어 있어요.');
  const favoriteStockIds = favoritesRaw.map((stockId) => parseString(stockId, '찜 종목'));
  if (
    favoriteStockIds.some((stockId) => !STOCK_IDS.has(stockId))
    || new Set(favoriteStockIds).size !== favoriteStockIds.length
  ) {
    throw new Error('찜 종목 정보를 확인할 수 없어요.');
  }
  const beginnerMission = parseString(value.beginnerMission, '초보 미션');
  if (!BEGINNER_MISSIONS.has(beginnerMission)) throw new Error('초보 미션 정보를 확인할 수 없어요.');
  let requestProbe: MarketRequestProbe | undefined;
  if (value.requestProbe !== undefined && value.requestProbe !== null) {
    const parsedRequestProbe = parseString(value.requestProbe, '요청 확인 결과') as MarketRequestProbe;
    if (!REQUEST_PROBES.has(parsedRequestProbe)) {
      throw new Error('요청 확인 결과를 확인할 수 없어요.');
    }
    requestProbe = parsedRequestProbe;
  }
  const adminEvents = eventsRaw.map(parseAdminEvent);
  if (new Set(adminEvents.map((event) => event.id)).size !== adminEvents.length) {
    throw new Error('시장 이벤트가 중복되어 있어요.');
  }
  return {
    revision: parsePositiveInteger(value.revision, '계좌 revision'),
    account: {
      walletPoints: parseNonNegativeInteger(value.account.walletPoints, '지갑 포인트'),
      lifetimeEarnedPoints: parseNonNegativeInteger(value.account.lifetimeEarnedPoints, '누적 포인트'),
      cashWon: parseNonNegativeInteger(value.account.cashWon, '예수금'),
      realizedPnlThisMonthWon: parseSafeMarketInteger(
        value.account.realizedPnlThisMonthWon,
        '이번 달 실현 손익',
      ),
      unrealizedPnlAtMonthStartWon: parseSafeMarketInteger(
        value.account.unrealizedPnlAtMonthStartWon,
        '월초 평가 손익',
      ),
      holdings,
    },
    favoriteStockIds,
    beginnerMission: beginnerMission as MarketRemoteState['beginnerMission'],
    adminEvents,
    ...(requestProbe ? { requestProbe } : {}),
  };
}

class MarketSessionError extends Error {}
class MarketQuoteChangedError extends Error {}
class MarketTradingHaltedError extends Error {}

const MARKET_QUOTE_CHANGED_MESSAGE = '가격이 바뀌었어요. 현재 가격을 확인하고 다시 주문해 주세요.';

function hasActiveTradingHalt(
  events: readonly MarketAdminEvent[],
  stockId: string,
  nowMs: number,
): boolean {
  return events.some((event) => {
    if (event.stockId !== stockId || event.kind !== 'halt') return false;
    const startsAtMs = Date.parse(event.startsAt);
    const endsAtMs = event.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(event.endsAt);
    return Number.isFinite(startsAtMs)
      && !Number.isNaN(endsAtMs)
      && startsAtMs <= nowMs
      && nowMs < endsAtMs;
  });
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : '';
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return isRecord(error) && typeof error.message === 'string' ? error.message : String(error);
}

function friendlyPersistenceError(operation: 'read' | 'write', error: unknown): Error {
  if (
    error instanceof MarketSessionError
    || error instanceof MarketQuoteChangedError
    || error instanceof MarketTradingHaltedError
  ) return error;
  const code = errorCode(error);
  const message = errorText(error);
  if (/42501/.test(code) || /canonical Hansol|limited to canonical Hansol|access/i.test(message)) {
    return new Error('배한솔 계정에서만 모의투자를 이용할 수 있어요.');
  }
  if (/23505/.test(code) || /request id conflict/i.test(message)) {
    return new Error('같은 요청이 다른 내용으로 다시 들어왔어요. 새로고침 후 다시 시도해 주세요.');
  }
  if (/market trading is halted|거래.*정지|halted/i.test(message)) {
    return new MarketTradingHaltedError('현재 거래가 정지되어 주문할 수 없어요.');
  }
  if (/market quote changed|가격이 바뀌었어요\. 현재 가격을 확인하고 다시 주문해 주세요\./i.test(message)) {
    return new MarketQuoteChangedError(MARKET_QUOTE_CHANGED_MESSAGE);
  }
  if (/insufficient|잔액|보유/i.test(message)) {
    return new Error('잔액이나 보유 수량이 달라졌어요. 새로고침 후 다시 확인해 주세요.');
  }
  if (/^(22|23)/.test(code) || /invalid|safe range|정수|양의/i.test(message)) {
    return new Error('입력한 거래 내용을 확인해 주세요.');
  }
  return new Error(operation === 'read'
    ? '모의투자 계좌를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
    : '모의투자 거래를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
}

export class MarketAccountService {
  readonly queue = createMarketMutationQueue();
  private readonly dependencies: MarketAccountServiceDependencies;
  private readonly logger: Pick<Console, 'error'>;
  private readonly transitioningSessions = new Set<string>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly pendingByUser = new Map<string, Set<Promise<unknown>>>();
  private quitting = false;

  constructor(dependencies: MarketAccountServiceDependencies) {
    this.dependencies = dependencies;
    this.logger = dependencies.logger ?? console;
  }

  beginQuitting(): void { this.quitting = true; }
  getPendingCount(): number { return this.pending.size; }

  beginSessionTransition(userId: string, epoch: number): void {
    this.transitioningSessions.add(`${userId}\u0000${epoch}`);
  }

  endSessionTransition(userId: string, epoch: number): void {
    this.transitioningSessions.delete(`${userId}\u0000${epoch}`);
  }

  private capture(): MarketAuthorizationFingerprint {
    if (this.quitting) throw new MarketSessionError('앱이 종료 중이라 새 거래를 시작할 수 없어요.');
    const session = this.dependencies.getCanonicalSession();
    if (!session.userId || !UUID_PATTERN.test(session.userId)) {
      throw new MarketSessionError('로그인 세션을 확인할 수 없어요.');
    }
    if (session.name !== HANSOL_NAME || session.slackId !== HANSOL_SLACK_ID) {
      throw new MarketSessionError('배한솔 계정에서만 모의투자를 이용할 수 있어요.');
    }
    if (this.transitioningSessions.has(`${session.userId}\u0000${session.epoch}`)) {
      throw new MarketSessionError('사용자 세션이 바뀌는 중이에요. 잠시 후 다시 시도해 주세요.');
    }
    return {
      userId: session.userId,
      epoch: session.epoch,
      name: session.name,
      slackId: session.slackId,
    };
  }

  private assertCurrent(captured: MarketAuthorizationFingerprint): void {
    const current = this.dependencies.getCanonicalSession();
    if (
      current.userId !== captured.userId
      || current.epoch !== captured.epoch
      || current.name !== captured.name
      || current.slackId !== captured.slackId
    ) {
      throw new MarketSessionError('모의투자 권한이나 사용자 세션이 바뀌어 결과를 반영하지 않았어요.');
    }
  }

  private track<T>(userId: string, promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    const userPending = this.pendingByUser.get(userId) ?? new Set<Promise<unknown>>();
    userPending.add(promise);
    this.pendingByUser.set(userId, userPending);
    void promise.finally(() => {
      this.pending.delete(promise);
      userPending.delete(promise);
      if (userPending.size === 0 && this.pendingByUser.get(userId) === userPending) {
        this.pendingByUser.delete(userId);
      }
    }).catch(() => { /* caller observes the original promise */ });
    return promise;
  }

  private async persist(
    operation: 'read' | 'write',
    work: () => Promise<unknown>,
  ): Promise<MarketRemoteState> {
    try {
      return parseMarketRemoteState(await work());
    } catch (error) {
      this.logger.error(`[market] ${operation} failed`, error);
      throw friendlyPersistenceError(operation, error);
    }
  }

  async read(): Promise<MarketRemoteState> {
    const captured = this.capture();
    const request = this.persist('read', () => this.dependencies.persistence.read(captured.userId))
      .then((state) => {
        this.assertCurrent(captured);
        return state;
      });
    return this.track(captured.userId, request);
  }

  private mutate(
    work: (userId: string, revalidateAuthorization: () => void) => Promise<unknown>,
  ): Promise<MarketRemoteState> {
    const captured = this.capture();
    const revalidateAuthorization = () => this.assertCurrent(captured);
    const queued = this.queue.enqueue(captured.userId, () => {
      revalidateAuthorization();
      return this.persist(
        'write',
        () => work(captured.userId, revalidateAuthorization),
      );
    });
    const request = queued.then((state) => {
      this.assertCurrent(captured);
      return state;
    });
    return this.track(captured.userId, request);
  }

  async execute(command: MarketCommand): Promise<MarketRemoteState> {
    const requestId = normalizeMarketRequestId(
      isRecord(command) ? command.requestId : undefined,
    );
    const normalizedCommand = { ...command, requestId } as MarketCommand;
    return this.mutate(async (userId, revalidateAuthorization) => {
      let canonicalCommand = normalizedCommand;
      if (normalizedCommand.kind === 'buy' || normalizedCommand.kind === 'sell') {
        const current = await this.persist(
          'read',
          () => this.dependencies.persistence.read(userId, normalizedCommand),
        );
        revalidateAuthorization();
        if (current.requestProbe === 'same') return current;
        if (current.requestProbe === 'conflict') throw new Error('request id conflict');
        if (current.requestProbe !== 'missing') {
          throw new Error('market request probe is unavailable');
        }
        if (
          !Number.isSafeInteger(normalizedCommand.quotedRevision)
          || normalizedCommand.quotedRevision <= 0
          || normalizedCommand.quotedRevision !== current.revision
        ) {
          throw new MarketQuoteChangedError(MARKET_QUOTE_CHANGED_MESSAGE);
        }
        const currentSecondMs = Math.floor(this.dependencies.getNowMs() / 1000) * 1000;
        if (hasActiveTradingHalt(current.adminEvents, normalizedCommand.stockId, currentSecondMs)) {
          throw new MarketTradingHaltedError('현재 거래가 정지되어 주문할 수 없어요.');
        }
        const canonicalQuoteWon = this.dependencies.resolveCanonicalQuote(
          normalizedCommand.stockId,
          currentSecondMs,
          current.adminEvents,
        );
        if (
          !Number.isSafeInteger(canonicalQuoteWon)
          || canonicalQuoteWon <= 0
          || normalizedCommand.quotedPriceWon !== canonicalQuoteWon
        ) {
          throw new MarketQuoteChangedError(
            MARKET_QUOTE_CHANGED_MESSAGE,
          );
        }
        canonicalCommand = { ...normalizedCommand, quotedPriceWon: canonicalQuoteWon };
        revalidateAuthorization();
      }
      return this.dependencies.persistence.execute(userId, canonicalCommand);
    });
  }

  async createAdminEvent(input: MarketAdminEventInput): Promise<MarketRemoteState> {
    return this.mutate((userId) => this.dependencies.persistence.createAdminEvent(userId, input));
  }

  async deleteAdminEvent(eventId: string): Promise<MarketRemoteState> {
    if (!UUID_PATTERN.test(eventId)) throw new Error('삭제할 시장 이벤트를 확인할 수 없어요.');
    return this.mutate((userId) => this.dependencies.persistence.deleteAdminEvent(userId, eventId));
  }

  async drainUser(userId: string): Promise<void> {
    await this.queue.drain(userId);
    while (this.pendingByUser.has(userId)) {
      await Promise.allSettled([...(this.pendingByUser.get(userId) ?? [])]);
    }
  }

  async waitForIdle(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      const completed = Promise.allSettled([...this.pending]).then(() => true);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timedOut = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), remaining);
      });
      const finished = await Promise.race([completed, timedOut]);
      if (timer) clearTimeout(timer);
      if (!finished) return false;
    }
    return true;
  }
}
