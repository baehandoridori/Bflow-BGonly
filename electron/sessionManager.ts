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
  /**
   * 서버(app_login)가 발급한 로그인 세션 토큰. main 메모리에서만 평문으로 사용하고,
   * auth.json 에는 rememberedAuthStorage가 OS 암호화로 저장한다.
   * renderer 로 나가는 payload 에는 절대 포함하지 않는다(publish 가 벗겨낸다).
   * 서버 로그인 없이 로컬 저장소로만 대조한 세션은 null 이다.
   */
  sessionToken?: string | null;
}

export type RemoteLoginResult =
  | { status: 'ok'; token: string; user: SessionUserRecord }
  | { status: 'rejected'; error: string }
  | { status: 'unavailable'; error?: string };

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
  /**
   * 서버 로그인(app_login RPC). 비밀번호 대조와 세션 토큰 발급을 서버가 담당한다.
   * 없거나 'unavailable' 이면(오프라인·함수 미적용) 비밀번호를 가진 디렉터리(로컬 저장소)로만 대조한다.
   */
  remoteLogin?(name: string, password: string): Promise<RemoteLoginResult>;
  /** 세션 토큰 폐기(app_logout RPC). 실패해도 로그아웃은 진행한다(서버 쪽은 만료로 정리). */
  remoteLogout?(token: string): Promise<void>;
  readRememberedSession(): Promise<RememberedAuthSession | null>;
  writeRememberedSession(session: RememberedAuthSession | null): Promise<void>;
  drainPersonalDataQueue(userId: string): Promise<void>;
  beginPersonalDataTransition(userId: string, epoch: number): void;
  endPersonalDataTransition(userId: string, epoch: number): void;
  /** 새 세션을 publish하기 전에 이전 사용자의 replacement capability를 즉시 retire한다. */
  beginPrivacyReplacementTransition(userId: string, epoch: number): void;
  /** retire 뒤 남은 create/source-delete를 terminal 상태까지 정리한다. */
  drainPrivacyReplacementTransition(userId: string, epoch: number): Promise<void>;
  /** 새 canonical session을 publish한 뒤에만 이전 origin lock을 해제한다. */
  completePrivacyReplacementTransition?(userId: string, epoch: number): void;
  /** publish 전에 이후 단계가 실패하면, 정리 완료 origin을 현재 사용자에게 되돌린다. */
  abortPrivacyReplacementTransition?(userId: string, epoch: number): void;
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

/** renderer 에 보이는 세션: 토큰을 뺀 나머지. */
function publicSession(session: RememberedAuthSession | null): RememberedAuthSession | null {
  if (!session) return null;
  const { sessionToken: _token, ...visible } = session;
  return visible;
}

/**
 * The only authority for the personal-data owner. Login input contains a
 * password, but every stored/broadcast payload is sanitized before leaving the
 * main process.
 */
export class SessionManager {
  private payload: CanonicalSessionPayload = { user: null, session: null, epoch: 0 };
  /** 서버 세션 토큰. payload 와 분리해 두어 어떤 broadcast/IPC 응답에도 섞이지 않는다. */
  private sessionToken: string | null = null;
  private transitionTail: Promise<void> = Promise.resolve();
  private readonly dependencies: SessionManagerDependencies;

  constructor(dependencies: SessionManagerDependencies) { this.dependencies = dependencies; }

  /** main 프로세스 전용. renderer 로 나가는 어떤 payload 에도 넣지 않는다. */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  /** canonical 사용자와 일치할 때만 토큰을 준다. 토큰이 없거나(로컬 대조 세션) 다른 사용자면 재로그인 오류. */
  getSessionTokenFor(userId: string): string {
    if (!this.sessionToken || this.getCanonicalUserId() !== userId) {
      throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.');
    }
    return this.sessionToken;
  }

  private setSessionToken(next: string | null): void {
    const previous = this.sessionToken;
    this.sessionToken = next;
    if (previous && previous !== next) this.revokeRemoteToken(previous);
  }

  private revokeRemoteToken(token: string): void {
    const revoke = this.dependencies.remoteLogout;
    if (!revoke) return;
    void revoke(token).catch((error) => {
      console.warn('[auth] 서버 세션 폐기 실패 (만료로 정리됩니다):', errorMessage(error));
    });
  }

  /**
   * 서버 로그인이 우선이다. 서버가 거절하면 그대로 실패하고, 서버에 닿을 수 없을 때만
   * 비밀번호를 가진 디렉터리(로컬 사용자 저장소)로 대조한다. Supabase 디렉터리는 비밀번호를
   * 돌려주지 않으므로 이 경로에서는 절대 통과할 수 없다.
   */
  private async verifyCredentials(
    name: string,
    password: string,
  ): Promise<{ ok: true; user: SessionUserRecord; token: string | null } | { ok: false; error: string }> {
    const remote = this.dependencies.remoteLogin
      ? await this.dependencies.remoteLogin(name, password)
      : { status: 'unavailable' as const };
    if (remote.status === 'rejected') return { ok: false, error: remote.error };
    if (remote.status === 'ok') return { ok: true, user: remote.user, token: remote.token };
    const { users } = await this.dependencies.readUsers();
    const user = users.find((candidate) => candidate.name === name);
    if (!user) return { ok: false, error: '등록되지 않은 사용자입니다.' };
    if (typeof user.password !== 'string') {
      return {
        ok: false,
        error: remote.error
          ? `로그인 서버에 연결하지 못했습니다: ${remote.error}`
          : '로그인 서버에 연결하지 못해 비밀번호를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      };
    }
    if (user.password !== password) return { ok: false, error: '비밀번호가 일치하지 않습니다.' };
    return { ok: true, user, token: null };
  }

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
      let privacyTransitionDrained = false;
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
        privacyTransitionDrained = true;
        await this.dependencies.flushCalendarJournal();
      } catch (error) {
        // drain 뒤 journal/remembered-session 준비가 실패하면 A는 계속 canonical이다.
        // 이때만 origin lock을 되돌려 A가 다음 이관을 정상적으로 시작할 수 있다.
        // drain 자체 실패는 fail-closed로 lock을 남겨 B publish를 계속 막는다.
        if (privacyTransitionDrained) {
          this.dependencies.abortPrivacyReplacementTransition?.(transition.userId, transition.epoch);
        }
        if (personalTransitionStarted) {
          this.dependencies.endPersonalDataTransition(transition.userId, transition.epoch);
        }
        throw error;
      }
      return transition;
    }
    return null;
  }

  private finishTransition(
    transition: { userId: string; epoch: number } | null,
    published: boolean,
  ): void {
    if (!transition) return;
    if (published) {
      // publish 직후에만 이전 epoch lock을 해제한다. 그 전에는 old renderer가 A로
      // 보일 수 있으므로, drain 종료만으로 해제하면 race가 다시 열린다.
      this.dependencies.completePrivacyReplacementTransition?.(transition.userId, transition.epoch);
    } else {
      this.dependencies.abortPrivacyReplacementTransition?.(transition.userId, transition.epoch);
    }
    this.dependencies.endPersonalDataTransition(transition.userId, transition.epoch);
  }

  private publish(user: SessionUserRecord | null, session: RememberedAuthSession | null): CanonicalSessionPayload {
    const previousId = this.getCanonicalUserId();
    const nextUser = user ? sanitizeSessionUser(user) : null;
    const nextId = nextUser?.id ?? null;
    const nextEpoch = previousId === nextId ? this.payload.epoch : this.payload.epoch + 1;
    this.payload = { user: nextUser, session: publicSession(session), epoch: nextEpoch };
    this.dependencies.setActivityUser(nextUser ? { id: nextUser.id, name: nextUser.name } : null);
    this.dependencies.broadcast(this.getCurrentPayload());
    return this.getCurrentPayload();
  }

  login(input: { name: string; password: string; rememberMe?: boolean }): Promise<SessionActionResult> {
    return this.serialize(async () => {
      try {
        const verified = await this.verifyCredentials(input.name, input.password);
        if (verified.ok === false) return { ok: false, payload: this.getCurrentPayload(), error: verified.error };
        const { user, token } = verified;
        const transition = await this.prepareTransition(user.id);
        const session: RememberedAuthSession = {
          userId: user.id,
          userName: user.name,
          loggedInAt: new Date().toISOString(),
          sessionToken: token,
        };
        let published = false;
        try {
          await this.dependencies.writeRememberedSession(input.rememberMe === false ? null : session);
          this.setSessionToken(token);
          const payload = this.publish(user, session);
          published = true;
          return { ok: true, payload };
        } finally {
          this.finishTransition(transition, published);
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
        // Legacy identity-only records and unavailable OS decryption are not a
        // server login. Keep the record intact so decryption can be retried.
        if (this.dependencies.remoteLogin && !remembered.sessionToken?.trim()) {
          return {
            ok: false,
            payload: this.getCurrentPayload(),
            error: '저장된 로그인 정보를 다시 확인해야 합니다. 이름과 비밀번호로 다시 로그인해 주세요.',
          };
        }
        const directory = await this.dependencies.readUsers();
        const users = directory.users;
        const user = users.find((candidate) => candidate.id === remembered.userId);
        if (!user) {
          if (directory.status === 'authoritative') {
            await this.dependencies.writeRememberedSession(null);
            if (remembered.sessionToken) this.revokeRemoteToken(remembered.sessionToken);
            return { ok: false, payload: this.getCurrentPayload(), error: '저장된 사용자를 찾을 수 없습니다.' };
          }
          return { ok: false, payload: this.getCurrentPayload(), error: '사용자 정보를 일시적으로 확인할 수 없습니다.' };
        }
        this.setSessionToken(remembered.sessionToken ?? null);
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
        let published = false;
        try {
          await this.dependencies.writeRememberedSession(null);
          const payload = this.publish(null, null);
          published = true;
          this.setSessionToken(null);
          return { ok: true, payload };
        } finally {
          this.finishTransition(transition, published);
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
          let published = false;
          try {
            await this.dependencies.writeRememberedSession(null);
            const payload = this.publish(null, null);
            published = true;
            this.setSessionToken(null);
            return { ok: true, payload };
          } finally {
            this.finishTransition(transition, published);
          }
        }
        return { ok: true, payload: this.publish(user, this.payload.session) };
      } catch (error) {
        return { ok: false, payload: this.getCurrentPayload(), error: errorMessage(error) };
      }
    });
  }
}
