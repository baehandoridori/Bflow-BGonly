export interface SessionUserRecord extends Record<string, unknown> {
  id: string;
  name: string;
  password?: string;
}

export interface SanitizedSessionUser extends Record<string, unknown> {
  id: string;
  name: string;
}

export interface RememberedAuthSession {
  userId: string;
  userName: string;
  loggedInAt: string;
}

export interface CanonicalSessionPayload {
  user: SanitizedSessionUser | null;
  session: RememberedAuthSession | null;
  epoch: number;
}

export interface SessionActionResult {
  ok: boolean;
  payload: CanonicalSessionPayload;
  error?: string;
}

export type SessionUserDirectoryStatus = 'authoritative' | 'fallback' | 'remote-unavailable';
export interface SessionUserDirectoryResult {
  users: SessionUserRecord[];
  status: SessionUserDirectoryStatus;
}

export interface SessionManagerDependencies {
  readUsers(): Promise<SessionUserDirectoryResult>;
  readRememberedSession(): Promise<RememberedAuthSession | null>;
  writeRememberedSession(session: RememberedAuthSession | null): Promise<void>;
  drainPersonalDataQueue(userId: string): Promise<void>;
  beginPersonalDataTransition(userId: string, epoch: number): void;
  endPersonalDataTransition(userId: string, epoch: number): void;
  /** 새 세션을 publish하기 전에 이전 사용자의 replacement capability를 즉시 retire한다. */
  beginPrivacyReplacementTransition(userId: string, epoch: number): void;
  /** retire 뒤 남은 create/source-delete를 terminal 상태까지 정리한다. */
  drainPrivacyReplacementTransition(userId: string, epoch: number): Promise<void>;
  flushCalendarJournal(): Promise<void>;
  setActivityUser(user: { id: string; name: string } | null): void;
  broadcast(payload: CanonicalSessionPayload): void;
}

export function sanitizeSessionUser(user: SessionUserRecord): SanitizedSessionUser {
  const { password: _password, ...sanitized } = user;
  return sanitized as SanitizedSessionUser;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The only authority for the personal-data owner. Login input contains a
 * password, but every stored/broadcast payload is sanitized before leaving the
 * main process.
 */
export class SessionManager {
  private payload: CanonicalSessionPayload = { user: null, session: null, epoch: 0 };
  private transitionTail: Promise<void> = Promise.resolve();
  private readonly dependencies: SessionManagerDependencies;

  constructor(dependencies: SessionManagerDependencies) { this.dependencies = dependencies; }

  getCurrentPayload(): CanonicalSessionPayload {
    return {
      ...this.payload,
      user: this.payload.user ? { ...this.payload.user } : null,
      session: this.payload.session ? { ...this.payload.session } : null,
    };
  }

  getCanonicalUserId(): string | null {
    return this.payload.user?.id ?? null;
  }

  getEpoch(): number {
    return this.payload.epoch;
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transitionTail.then(operation, operation);
    this.transitionTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async prepareTransition(nextUserId: string | null): Promise<{ userId: string; epoch: number } | null> {
    const currentUserId = this.getCanonicalUserId();
    if (currentUserId && currentUserId !== nextUserId) {
      const transition = { userId: currentUserId, epoch: this.getEpoch() };
      let personalTransitionStarted = false;
      try {
        this.dependencies.beginPersonalDataTransition(transition.userId, transition.epoch);
        personalTransitionStarted = true;
        // 이 두 fence는 첫 await 전에 닫혀야 같은 BrowserWindow에서 다음 사용자가
        // 이전 사용자의 replacement를 계속 진행할 수 없다. 종료가 이미 시작됐다면
        // privacy begin이 throw하고, 아래 catch가 personal fence를 되돌린 채 B publish를 막는다.
        this.dependencies.beginPrivacyReplacementTransition(transition.userId, transition.epoch);
        await Promise.all([
          this.dependencies.drainPersonalDataQueue(currentUserId),
          this.dependencies.drainPrivacyReplacementTransition(transition.userId, transition.epoch),
        ]);
        await this.dependencies.flushCalendarJournal();
      } catch (error) {
        if (personalTransitionStarted) {
          this.dependencies.endPersonalDataTransition(transition.userId, transition.epoch);
        }
        throw error;
      }
      return transition;
    }
    return null;
  }

  private finishTransition(transition: { userId: string; epoch: number } | null): void {
    if (transition) this.dependencies.endPersonalDataTransition(transition.userId, transition.epoch);
  }

  private publish(user: SessionUserRecord | null, session: RememberedAuthSession | null): CanonicalSessionPayload {
    const previousId = this.getCanonicalUserId();
    const nextUser = user ? sanitizeSessionUser(user) : null;
    const nextId = nextUser?.id ?? null;
    const nextEpoch = previousId === nextId ? this.payload.epoch : this.payload.epoch + 1;
    this.payload = { user: nextUser, session, epoch: nextEpoch };
    this.dependencies.setActivityUser(nextUser ? { id: nextUser.id, name: nextUser.name } : null);
    this.dependencies.broadcast(this.getCurrentPayload());
    return this.getCurrentPayload();
  }

  login(input: { name: string; password: string; rememberMe?: boolean }): Promise<SessionActionResult> {
    return this.serialize(async () => {
      try {
        const { users } = await this.dependencies.readUsers();
        const user = users.find((candidate) => candidate.name === input.name);
        if (!user) return { ok: false, payload: this.getCurrentPayload(), error: '등록되지 않은 사용자입니다.' };
        if (user.password !== input.password) {
          return { ok: false, payload: this.getCurrentPayload(), error: '비밀번호가 일치하지 않습니다.' };
        }
        const transition = await this.prepareTransition(user.id);
        const session: RememberedAuthSession = {
          userId: user.id,
          userName: user.name,
          loggedInAt: new Date().toISOString(),
        };
        try {
          await this.dependencies.writeRememberedSession(input.rememberMe === false ? null : session);
          return { ok: true, payload: this.publish(user, session) };
        } finally {
          this.finishTransition(transition);
        }
      } catch (error) {
        return { ok: false, payload: this.getCurrentPayload(), error: errorMessage(error) };
      }
    });
  }

  restore(): Promise<SessionActionResult> {
    return this.serialize(async () => {
      try {
        if (this.getCanonicalUserId()) return { ok: true, payload: this.getCurrentPayload() };
        const remembered = await this.dependencies.readRememberedSession();
        if (!remembered?.userId) return { ok: true, payload: this.getCurrentPayload() };
        const directory = await this.dependencies.readUsers();
        const users = directory.users;
        const user = users.find((candidate) => candidate.id === remembered.userId);
        if (!user) {
          if (directory.status === 'authoritative') {
            await this.dependencies.writeRememberedSession(null);
            return { ok: false, payload: this.getCurrentPayload(), error: '저장된 사용자를 찾을 수 없습니다.' };
          }
          return { ok: false, payload: this.getCurrentPayload(), error: '사용자 정보를 일시적으로 확인할 수 없습니다.' };
        }
        return { ok: true, payload: this.publish(user, remembered) };
      } catch (error) {
        return { ok: false, payload: this.getCurrentPayload(), error: errorMessage(error) };
      }
    });
  }

  ensure(): Promise<SessionActionResult> {
    if (this.getCanonicalUserId()) return Promise.resolve({ ok: true, payload: this.getCurrentPayload() });
    return this.restore();
  }

  logout(): Promise<SessionActionResult> {
    return this.serialize(async () => {
      try {
        const transition = await this.prepareTransition(null);
        try {
          await this.dependencies.writeRememberedSession(null);
          return { ok: true, payload: this.publish(null, null) };
        } finally {
          this.finishTransition(transition);
        }
      } catch (error) {
        return { ok: false, payload: this.getCurrentPayload(), error: errorMessage(error) };
      }
    });
  }

  refreshCurrentUser(): Promise<SessionActionResult> {
    return this.serialize(async () => {
      try {
        const currentId = this.getCanonicalUserId();
        if (!currentId) return { ok: true, payload: this.getCurrentPayload() };
        const directory = await this.dependencies.readUsers();
        const users = directory.users;
        const user = users.find((candidate) => candidate.id === currentId);
        if (!user) {
          if (directory.status !== 'authoritative') {
            return { ok: true, payload: this.getCurrentPayload() };
          }
          const transition = await this.prepareTransition(null);
          try {
            await this.dependencies.writeRememberedSession(null);
            return { ok: true, payload: this.publish(null, null) };
          } finally {
            this.finishTransition(transition);
          }
        }
        return { ok: true, payload: this.publish(user, this.payload.session) };
      } catch (error) {
        return { ok: false, payload: this.getCurrentPayload(), error: errorMessage(error) };
      }
    });
  }
}
