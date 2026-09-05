import fs from 'node:fs';
import path from 'node:path';
import type { RememberedAuthSession } from './sessionManager';

/** Electron safeStorage is injected so storage can be checked without starting Electron. */
export interface AuthStorageEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend?(): string;
}

interface StoredAuthSession {
  userId: string;
  userName: string;
  loggedInAt: string;
  sessionToken: null;
  encryptedSessionToken?: { version: 1; ciphertext: string };
}

function canProtectToken(encryption: AuthStorageEncryption, platform: NodeJS.Platform): boolean {
  try {
    return encryption.isEncryptionAvailable()
      && (platform !== 'linux' || (encryption.getSelectedStorageBackend?.() ?? 'basic_text') !== 'basic_text');
  } catch {
    return false;
  }
}

function encodeSession(
  session: RememberedAuthSession,
  encryption: AuthStorageEncryption,
  platform: NodeJS.Platform,
): StoredAuthSession {
  const stored: StoredAuthSession = {
    userId: session.userId,
    userName: session.userName,
    loggedInAt: session.loggedInAt,
    sessionToken: null,
  };
  if (session.sessionToken && canProtectToken(encryption, platform)) {
    try {
      stored.encryptedSessionToken = {
        version: 1,
        ciphertext: encryption.encryptString(session.sessionToken).toString('base64'),
      };
    } catch { /* Keep identity only; never fall back to a plaintext bearer token. */ }
  }
  return stored;
}

async function writeStoredSession(authPath: string, session: StoredAuthSession | null): Promise<void> {
  await fs.promises.mkdir(path.dirname(authPath), { recursive: true });
  const tempPath = `${authPath}.tmp`;
  try {
    await fs.promises.writeFile(tempPath, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tempPath, authPath);
  } finally {
    await fs.promises.unlink(tempPath).catch(() => undefined);
  }
}

export async function writeRememberedAuthFile(
  authPath: string,
  session: RememberedAuthSession | null,
  encryption: AuthStorageEncryption,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  await writeStoredSession(authPath, session ? encodeSession(session, encryption, platform) : null);
}

export async function readRememberedAuthFile(
  authPath: string,
  encryption: AuthStorageEncryption,
  platform: NodeJS.Platform = process.platform,
): Promise<RememberedAuthSession | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.promises.readFile(authPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.userId !== 'string' || !record.userId
      || typeof record.userName !== 'string' || typeof record.loggedInAt !== 'string') return null;
    // Only these fields may reach SessionManager; disk encryption metadata stays in main.
    const session: RememberedAuthSession = {
      userId: record.userId,
      userName: record.userName,
      loggedInAt: record.loggedInAt,
      sessionToken: null,
    };
    if (Object.prototype.hasOwnProperty.call(record, 'encryptedSessionToken')) {
      const encrypted = record.encryptedSessionToken as Partial<StoredAuthSession['encryptedSessionToken']> | null;
      if (encrypted?.version === 1 && typeof encrypted.ciphertext === 'string'
        && encrypted.ciphertext && canProtectToken(encryption, platform)) {
        try {
          const bytes = Buffer.from(encrypted.ciphertext, 'base64');
          if (bytes.toString('base64') === encrypted.ciphertext) {
            session.sessionToken = encryption.decryptString(bytes) || null;
          }
        } catch { /* Another OS account, unavailable key, or corrupt token: require a new login. */ }
      }
      // An encrypted record never downgrades to a legacy plaintext token, even if both exist.
      if (typeof record.sessionToken === 'string') {
        await writeStoredSession(authPath, encodeSession(session, encryption, platform));
      }
      return session;
    }
    if (typeof record.sessionToken === 'string' && record.sessionToken) {
      const migrated = encodeSession({ ...session, sessionToken: record.sessionToken }, encryption, platform);
      // Finish the atomic replacement before accepting a legacy bearer token. If encryption is
      // unavailable, the replacement removes the plaintext and preserves only the identity.
      await writeStoredSession(authPath, migrated);
      if (migrated.encryptedSessionToken) session.sessionToken = record.sessionToken;
    }
    return session;
  } catch {
    // Unreadable data or a failed migration must never become an authenticated token fallback.
    return null;
  }
}
