import { COMMENT_READ_STATE_EVENT, getCommentReadStateForUser, isCommentKeyUnread } from './commentReadStateService';
import { CHARACTER_COMMENT_SUMMARY_MAX_IDS, type CharacterCommentSummaries } from '../shared/characterCommentSummary';

export interface CharacterCommentBadgeState { count: number; seen: boolean }
type Listener = (state: CharacterCommentBadgeState | null) => void;
const CACHE_TTL_MS = 30_000;

/** One visible board shares metadata batches and one user read-state request. */
export class CharacterCommentSummaryCache {
  private scope = '';
  private userId = '';
  private generation = 0;
  private listeners = new Map<string, Set<Listener>>();
  private entries = new Map<string, { summary: CharacterCommentSummaries[string]; at: number }>();
  private versions = new Map<string, number>();
  private dirty = new Set<string>();
  private inFlight = new Set<string>();
  private retries = new Map<string, { attempt: number; version: number }>();
  private retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private readState: Record<string, string> = {};
  private readReady = false;
  private readDirty = true;
  private readVersion = 0;
  private reading = false;
  private readRetryAttempt = 0;
  private readRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private events: EventTarget | null = null;

  constructor(
    private readonly readSummaries: (ids: string[]) => Promise<CharacterCommentSummaries>,
    private readonly readStates: (userId: string) => Promise<Record<string, string>>,
    private readonly now: () => number = Date.now,
    private readonly retryDelaysMs: readonly number[] = [1_000, 3_000],
  ) {}

  subscribe(characterId: string, userId: string, connected: boolean, listener: Listener, events: EventTarget = window): () => void {
    const scope = `${userId}\0${connected}`;
    if (scope !== this.scope) {
      this.reset(); this.scope = scope; this.userId = userId;
    }
    if (!this.events) {
      this.events = events;
      events.addEventListener('bflow:comments-invalidated', this.onCommentsChanged);
      events.addEventListener(COMMENT_READ_STATE_EVENT, this.onReadStateChanged);
    }
    const generation = this.generation;
    const listeners = this.listeners.get(characterId) ?? new Set<Listener>();
    listeners.add(listener); this.listeners.set(characterId, listeners);
    const entry = this.entries.get(characterId);
    if ((!entry || this.now() - entry.at >= CACHE_TTL_MS) && !this.inFlight.has(characterId)
      && !this.retries.has(characterId)) this.dirty.add(characterId);
    listener(this.value(characterId));
    this.schedule(0);
    return () => {
      if (generation !== this.generation) return;
      listeners.delete(listener);
      if (!listeners.size) {
        this.listeners.delete(characterId);
        this.retries.delete(characterId);
      }
      if (!this.listeners.size) this.reset();
    };
  }

  private reset(): void {
    ++this.generation;
    this.clearReadRetry();
    if (this.timer) clearTimeout(this.timer);
    for (const timer of this.retryTimers) clearTimeout(timer);
    this.retryTimers.clear(); this.retries.clear();
    this.timer = undefined;
    this.events?.removeEventListener('bflow:comments-invalidated', this.onCommentsChanged);
    this.events?.removeEventListener(COMMENT_READ_STATE_EVENT, this.onReadStateChanged);
    this.events = null; this.scope = '';
    this.listeners.clear(); this.entries.clear(); this.versions.clear(); this.dirty.clear(); this.inFlight.clear();
    this.readState = {}; this.readReady = false; this.readDirty = true; this.readVersion = 0; this.reading = false;
  }

  private value(id: string): CharacterCommentBadgeState | null {
    const entry = this.entries.get(id);
    if (!entry || !this.readReady) return null;
    return { count: entry.summary.count,
      seen: !isCommentKeyUnread(entry.summary.latestOtherCreatedAt, this.readState[`char:${id}`]) };
  }

  private emit(id?: string): void {
    for (const [key, listeners] of this.listeners) {
      if (id && key !== id) continue;
      const value = this.value(key);
      for (const listener of listeners) listener(value);
    }
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, delay);
  }

  private clearReadRetry(): void {
    if (this.readRetryTimer) clearTimeout(this.readRetryTimer);
    this.readRetryTimer = undefined;
    this.readRetryAttempt = 0;
  }

  private retryReadState(generation: number, version: number): void {
    if (generation !== this.generation || version !== this.readVersion || !this.listeners.size) return;
    const delay = this.retryDelaysMs[this.readRetryAttempt++];
    if (delay === undefined) return;
    const timer = setTimeout(() => {
      if (this.readRetryTimer !== timer || generation !== this.generation || version !== this.readVersion) return;
      this.readRetryTimer = undefined;
      this.readDirty = true;
      this.schedule(0);
    }, delay);
    this.readRetryTimer = timer;
  }

  private retryFailedBatch(batch: string[], versions: number[], generation: number): void {
    if (generation !== this.generation) return;
    const byAttempt = new Map<number, Array<{ id: string; state: { attempt: number; version: number } }>>();
    batch.forEach((id, index) => {
      if (!this.listeners.has(id) || versions[index] !== (this.versions.get(id) ?? 0)) return;
      const state = { attempt: (this.retries.get(id)?.attempt ?? 0) + 1, version: versions[index] };
      this.retries.set(id, state);
      if (state.attempt > this.retryDelaysMs.length) return;
      const group = byAttempt.get(state.attempt) ?? [];
      group.push({ id, state }); byAttempt.set(state.attempt, group);
    });
    for (const [attempt, group] of byAttempt) {
      const timer = setTimeout(() => {
        this.retryTimers.delete(timer);
        if (generation !== this.generation) return;
        let pending = false;
        for (const { id, state } of group) {
          if (this.listeners.has(id) && this.retries.get(id) === state
            && state.version === (this.versions.get(id) ?? 0)) {
            this.dirty.add(id); pending = true;
          }
        }
        if (pending) this.schedule(0);
      }, this.retryDelaysMs[attempt - 1]);
      this.retryTimers.add(timer);
    }
  }

  private flush(): void {
    const generation = this.generation;
    if (this.readDirty && !this.reading) {
      const version = this.readVersion;
      this.readDirty = false; this.reading = true;
      void this.readStates(this.userId).then((state) => {
        if (generation !== this.generation || version !== this.readVersion) return;
        this.clearReadRetry();
        this.readState = state; this.readReady = true; this.emit();
      }).catch((error) => {
        if (generation !== this.generation || version !== this.readVersion) return;
        console.warn('[캐릭터 댓글 배지] 읽음 조회 실패', error);
        this.retryReadState(generation, version);
      }).finally(() => {
        if (generation !== this.generation) return;
        this.reading = false;
        if (this.readDirty) this.schedule(0);
      });
    }
    const ids = [...this.dirty].filter(id => this.listeners.has(id) && !this.inFlight.has(id));
    for (let offset = 0; offset < ids.length; offset += CHARACTER_COMMENT_SUMMARY_MAX_IDS) {
      const batch = ids.slice(offset, offset + CHARACTER_COMMENT_SUMMARY_MAX_IDS);
      const versions = batch.map(id => this.versions.get(id) ?? 0);
      for (const id of batch) { this.dirty.delete(id); this.inFlight.add(id); }
      void this.readSummaries(batch).then((summaries) => {
        if (generation !== this.generation) return;
        batch.forEach((id, index) => {
          if (versions[index] !== (this.versions.get(id) ?? 0)) return;
          this.retries.delete(id);
          this.entries.set(id, { summary: summaries[id] ?? { count: 0, latestOtherCreatedAt: null }, at: this.now() });
          this.emit(id);
        });
      }).catch((error) => {
        if (generation !== this.generation) return;
        console.warn('[캐릭터 댓글 배지] 요약 조회 실패', error);
        this.retryFailedBatch(batch, versions, generation);
      }).finally(() => {
        if (generation !== this.generation) return;
        for (const id of batch) this.inFlight.delete(id);
        if ([...this.dirty].some(id => this.listeners.has(id))) this.schedule(0);
      });
    }
  }

  private onCommentsChanged = (event: Event): void => {
    const detail = (event as CustomEvent<{ characterId?: string; sheetName?: string }>).detail;
    if (detail?.sheetName && !detail.characterId) return;
    const ids = detail?.characterId ? [detail.characterId] : [...new Set([...this.entries.keys(), ...this.listeners.keys(), ...this.inFlight])];
    for (const id of ids) {
      this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
      this.retries.delete(id);
      this.entries.delete(id);
      if (this.listeners.has(id)) this.dirty.add(id);
    }
    if (ids.some(id => this.listeners.has(id))) this.schedule(100);
  };

  private onReadStateChanged = (event: Event): void => {
    const userId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
    if (userId && userId !== this.userId) return;
    this.clearReadRetry();
    ++this.readVersion; this.readDirty = true;
    this.schedule(0);
  };
}

const sharedCache = new CharacterCommentSummaryCache(
  async (ids) => {
    const read = window.electronAPI?.getCharacterCommentSummaries;
    if (!read) throw new Error('캐릭터 댓글 요약을 불러올 수 없습니다.');
    return read(ids);
  },
  (userId) => getCommentReadStateForUser(userId, { throwOnReadError: true }),
);

export function subscribeCharacterCommentSummary(characterId: string, userId: string, connected: boolean, listener: Listener): () => void {
  return sharedCache.subscribe(characterId, userId, connected, listener);
}
