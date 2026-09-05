import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as rememberedAuthStorage from '../electron/rememberedAuthStorage.ts';
import { SessionManager } from '../electron/sessionManager.ts';
import type { RememberedAuthSession, SessionManagerDependencies } from '../electron/sessionManager.ts';
import type { AuthStorageEncryption } from '../electron/rememberedAuthStorage.ts';

const mainSource = fs.readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
const mainAst = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
const writeNode = mainAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'writeRememberedAuthSession');
assert.ok(writeNode);
let readNode: ts.PropertyAssignment | undefined;
let writeBinding: ts.PropertyAssignment | undefined;
function findBindings(node: ts.Node): void {
  if (ts.isPropertyAssignment(node)) {
    if (node.name.getText(mainAst) === 'readRememberedSession') readNode = node;
    if (node.name.getText(mainAst) === 'writeRememberedSession') writeBinding = node;
  }
  ts.forEachChild(node, findBindings);
}
findBindings(mainAst);
assert.ok(readNode);
assert.ok(writeBinding);
const key = randomBytes(32);
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString(value: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  },
  decryptString(value: Buffer): string {
    const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
  },
};

const identity = { userId: 'user-a', userName: 'A', loggedInAt: '2026-09-06T00:00:00Z' };
const token = 'server-bearer-token-must-not-be-written-plainly';
const session: RememberedAuthSession = { ...identity, sessionToken: token };

async function storageHarness(t: test.TestContext, crypto: AuthStorageEncryption = encryption) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bflow-auth-storage-'));
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
  const context = vm.createContext({
    fs, path, Buffer, safeStorage: crypto, ...rememberedAuthStorage,
    getDataPath: () => directory,
    ensureDir: (target: string) => fs.mkdirSync(target, { recursive: true }),
  });
  const source = `${writeNode!.getText(mainAst)}\nglobalThis.storage = { ${readNode!.getText(mainAst)}, ${writeBinding!.getText(mainAst)} };`;
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  const authPath = path.join(directory, 'auth.json');
  const storage = context.storage as Pick<SessionManagerDependencies, 'readRememberedSession' | 'writeRememberedSession'>;
  const raw = () => fs.promises.readFile(authPath, 'utf8');
  const seed = (value: unknown) => fs.promises.writeFile(authPath, JSON.stringify(value));
  const revoked: string[] = [];
  const published: unknown[] = [];
  const manager = new SessionManager({
    ...storage,
    readUsers: async () => ({ users: [{ id: 'user-a', name: 'A' }], status: 'authoritative' }),
    remoteLogin: async () => ({ status: 'ok', user: { id: 'user-a', name: 'A' }, token }),
    remoteLogout: async (value) => { revoked.push(value); },
    beginPersonalDataTransition: () => undefined,
    endPersonalDataTransition: () => undefined,
    drainPersonalDataQueue: async () => undefined,
    beginPrivacyReplacementTransition: () => undefined,
    drainPrivacyReplacementTransition: async () => undefined,
    flushCalendarJournal: async () => undefined,
    setActivityUser: () => undefined,
    broadcast: (payload) => { published.push(payload); },
  });
  return { directory, authPath, raw, seed, manager, published, revoked, ...storage };
}

test('main remembered-session writer never leaves the bearer token on disk', async (t) => {
  const h = await storageHarness(t);
  await h.writeRememberedSession(session);
  const raw = await h.raw();
  assert.equal(raw.includes(token), false, 'auth.json must not contain the raw bearer token');
  assert.deepEqual(await fs.promises.readdir(h.directory), ['auth.json']);
  assert.equal(JSON.parse(raw).userId, 'user-a', 'identity-only readers retain their existing field');
});

test('main restore decrypts the token for its matching user and never exposes ciphertext or token to renderer', async (t) => {
  const h = await storageHarness(t);
  await h.writeRememberedSession(session);
  assert.equal((await h.manager.restore()).ok, true);
  assert.equal(h.manager.getSessionTokenFor('user-a'), token);
  assert.throws(() => h.manager.getSessionTokenFor('user-b'), /다시 로그인/);
  assert.deepEqual(h.manager.getCurrentPayload().session, identity);
  assert.equal(JSON.stringify(h.published).includes(token), false);
  assert.equal(JSON.stringify(h.published).includes('encryptedSessionToken'), false);
});

test('legacy plaintext is migrated once before its token is returned to the session manager', async (t) => {
  let encryptions = 0;
  const h = await storageHarness(t, {
    ...encryption,
    encryptString(value) { encryptions++; return encryption.encryptString(value); },
  });
  await h.seed(session);
  assert.equal((await h.readRememberedSession())?.sessionToken, token);
  const firstDisk = await h.raw();
  assert.equal(firstDisk.includes(token), false);
  assert.equal(JSON.parse(firstDisk).encryptedSessionToken.version, 1);
  assert.equal((await h.readRememberedSession())?.sessionToken, token);
  assert.equal(await h.raw(), firstDisk, 'already encrypted records are not migrated repeatedly');
  assert.equal(encryptions, 1);
});

test('unavailable encryption preserves the active login but the next launch has no token', async (t) => {
  const h = await storageHarness(t, { ...encryption, isEncryptionAvailable: () => false });
  assert.equal((await h.manager.login({ name: 'A', password: 'test-only' })).ok, true);
  assert.equal(h.manager.getSessionTokenFor('user-a'), token);
  assert.equal((await h.readRememberedSession())?.sessionToken, null);
  assert.equal((await h.raw()).includes(token), false);
  assert.equal('encryptedSessionToken' in JSON.parse(await h.raw()), false);
});

test('an encryption exception never falls back to plaintext or blocks the active login', async (t) => {
  const h = await storageHarness(t, { ...encryption, encryptString: () => { throw new Error('key unavailable'); } });
  assert.equal((await h.manager.login({ name: 'A', password: 'test-only' })).ok, true);
  assert.equal(h.manager.getSessionToken(), token);
  assert.equal((await h.readRememberedSession())?.sessionToken, null);
  assert.equal((await h.raw()).includes(token), false);
});

test('legacy plaintext is removed even when OS encryption is unavailable', async (t) => {
  const h = await storageHarness(t, { ...encryption, isEncryptionAvailable: () => false });
  await h.seed(session);
  assert.equal((await h.readRememberedSession())?.sessionToken, null);
  assert.equal((await h.raw()).includes(token), false);
  assert.equal((await h.readRememberedSession())?.userId, 'user-a');
});

test('temporarily unavailable OS decryption restores only identity without leaking encrypted fields', async (t) => {
  let available = true;
  const h = await storageHarness(t, { ...encryption, isEncryptionAvailable: () => available });
  await h.writeRememberedSession(session);
  available = false;
  assert.equal((await h.manager.restore()).ok, true);
  assert.equal(h.manager.getSessionToken(), null);
  assert.deepEqual(h.manager.getCurrentPayload().session, identity);
  assert.throws(() => h.manager.getSessionTokenFor('user-a'), /로그인 세션이 필요/);
});

for (const corrupt of [
  { version: 1, ciphertext: 'not valid base64!?' },
  { version: 1, ciphertext: Buffer.from('damaged ciphertext').toString('base64') },
  { version: 2, ciphertext: encryption.encryptString(token).toString('base64') },
]) {
  test(`corrupt or unsupported ciphertext (${corrupt.version}, ${corrupt.ciphertext.length}) cannot downgrade to a legacy token`, async (t) => {
    const h = await storageHarness(t);
    await h.seed({ ...session, encryptedSessionToken: corrupt });
    assert.equal((await h.readRememberedSession())?.sessionToken, null);
    assert.equal((await h.raw()).includes(token), false, 'mixed legacy plaintext must also be removed');
    assert.equal((await h.manager.restore()).ok, true);
    assert.equal(h.manager.getSessionToken(), null);
    assert.deepEqual(h.manager.getCurrentPayload().session, identity);
  });
}

test('logout removes the remembered ciphertext and revokes only the in-memory token', async (t) => {
  const h = await storageHarness(t);
  await h.writeRememberedSession(session);
  await h.manager.restore();
  assert.equal((await h.manager.logout()).ok, true);
  assert.deepEqual(h.revoked, [token]);
  assert.equal(await h.raw(), 'null');
  assert.equal(await h.readRememberedSession(), null);
  assert.equal(h.manager.getSessionToken(), null);
  assert.deepEqual(await fs.promises.readdir(h.directory), ['auth.json']);
});

test('Linux basic_text is treated as unavailable instead of using its shared plaintext password', async (t) => {
  const h = await storageHarness(t);
  await rememberedAuthStorage.writeRememberedAuthFile(h.authPath, session, {
    ...encryption, getSelectedStorageBackend: () => 'basic_text',
  }, 'linux');
  assert.equal((await h.readRememberedSession())?.sessionToken, null);
  assert.equal('encryptedSessionToken' in JSON.parse(await h.raw()), false);
});

test('missing or malformed remembered files do not restore a token', async (t) => {
  const h = await storageHarness(t);
  assert.equal(await h.readRememberedSession(), null);
  await fs.promises.writeFile(h.authPath, '{truncated');
  assert.equal(await h.readRememberedSession(), null);
});
