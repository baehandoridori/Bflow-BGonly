import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BAE_SETTING_KEYS, BAE_SETTING_DEFAULTS, baeSettingProblem, textVersion } from '../src/shared/bae/settings.ts';
import { baeKeyProblem, maskSecrets } from '../src/shared/bae/secrets.ts';
import { createBaePreviewGateway } from '../src/features/bae-gyeong/previewGateway.ts';

const FAKE_KEY = 'sk-test-local-only-0123456789abcdef';

test('the settings keys are one closed list, the same in TypeScript and in SQL', () => {
  const sql = readFileSync(new URL('../DEVLOG/migrations/2026-11-13-bae-gyeong-base.sql', import.meta.url), 'utf8');
  const check = /key TEXT PRIMARY KEY CHECK \(key IN \(([^)]*)\)\)/.exec(sql);
  assert.ok(check, 'the CHECK list of bae_gyeong_settings');
  assert.deepEqual(check![1].split(',').map((s) => s.trim().replace(/'/g, '')), [...BAE_SETTING_KEYS]);
  const save = /IF p_key IS NULL OR p_key NOT IN \(([^)]*)\)/.exec(sql);
  assert.deepEqual(save![1].split(',').map((s) => s.trim().replace(/'/g, '')), [...BAE_SETTING_KEYS]);
});

test('setting values are checked before they are saved', () => {
  assert.equal(baeSettingProblem('manual', { text: '# BAE PD manual v1.8\n...' }), null);
  assert.ok(baeSettingProblem('manual', { text: '  ' }));
  assert.ok(baeSettingProblem('manual', 'just text'));
  assert.equal(baeSettingProblem('guidance', { text: '' }), null, 'the extra guidance may be empty');
  assert.equal(baeSettingProblem('models', BAE_SETTING_DEFAULTS.models), null);
  assert.equal(BAE_SETTING_DEFAULTS.models.imageModel, 'gpt-image-2.5-sunburst', '14e 2장: 2.5 Sunburst');
  assert.equal(BAE_SETTING_DEFAULTS.models.imageQuality, 'high');
  assert.ok(baeSettingProblem('api_base', 'http://api.openai.com/v1'), 'https only');
  assert.equal(baeSettingProblem('api_base', 'https://api.openai.com/v1'), null);
  assert.ok(baeSettingProblem('horizon', { calib: 99 }));
  assert.equal(baeSettingProblem('prices', BAE_SETTING_DEFAULTS.prices), null);
  assert.equal(textVersion('# BAE PD manual v1.7\n\n## Role'), 'v1.7');
  assert.equal(textVersion('# BAE fixed sentences v1\n'), 'v1');
});

test('a key never shows: masked in any text, and only an sk- line is accepted', () => {
  const msg = `401 Incorrect API key provided: ${FAKE_KEY}. Authorization: Bearer ${FAKE_KEY}`;
  const masked = maskSecrets(msg);
  assert.ok(!masked.includes('0123456789abcdef'), masked);
  assert.match(masked, /sk-…\(가림\)/);
  assert.equal(baeKeyProblem(`  ${FAKE_KEY}\n`), null, 'spaces and a line end around it are cut');
  assert.ok(baeKeyProblem('hello'));
  assert.ok(baeKeyProblem(`${FAKE_KEY} ${FAKE_KEY}`));
});

function memoryStorage() { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, dump: () => [...m.values()].join('\n') }; }

test('the preview keeps the server\'s rules: admin, list, open switch, revisions, bodies for admins only, no key letters', async () => {
  const storage = memoryStorage();
  let who = { id: 'admin', name: '관리자', role: 'admin' };
  const gw = createBaePreviewGateway({ storage, identity: () => who, knownUserIds: () => ['admin', 'm1', 'm2'], now: () => '2026-11-13T12:00:00.000Z' });
  assert.deepEqual(await gw.access(), { isAdmin: true, canUse: true, canReview: true, open: false });
  const seeded = await gw.settingsSeed('manual', 0);
  assert.equal(seeded.revision, 1); assert.equal(seeded.version, 'v1.7');
  await assert.rejects(gw.settingsSave('manual', { text: '# BAE PD manual v1.8\nx' }, 0), /먼저 바꿨/);
  const saved = await gw.settingsSave('manual', { text: '# BAE PD manual v1.8\nx' }, 1);
  assert.equal(saved.revision, 2); assert.equal(saved.version, 'v1.8');
  assert.equal((await gw.settingsHistory('manual')).length, 2);
  const status = await gw.keySet(` ${FAKE_KEY} `);
  assert.equal(status.hasKey, true);
  assert.ok(!storage.dump().includes('0123456789abcdef'), 'the preview stores no letter of the key');
  await gw.membersSet('m1', 'user'); await gw.membersSet('m2', 'reviewer');
  // a user: uses, sees the version but not the body, cannot save or see the list
  who = { id: 'm1', name: '사용자', role: 'user' };
  const view = await gw.settings();
  assert.deepEqual(view.access, { isAdmin: false, canUse: true, canReview: false, open: false });
  const manual = view.rows.find((r) => r.key === 'manual')!;
  assert.equal(manual.value, null); assert.equal(manual.bodyHidden, true); assert.equal(manual.version, 'v1.8');
  await assert.rejects(gw.settingsSave('access', { open: true }, 0), /관리자만/);
  await assert.rejects(gw.membersList(), /관리자만/);
  await assert.rejects(gw.keySet(FAKE_KEY), /관리자만/);
  // a reviewer reviews
  who = { id: 'm2', name: '검수자', role: 'user' };
  assert.equal((await gw.access()).canReview, true);
  // nobody on the list: no use, until the admin opens it to everyone
  who = { id: 'x', name: '팀원', role: 'user' };
  assert.equal((await gw.access()).canUse, false);
  await assert.rejects(gw.keyStatus(), /권한이 없습니다/);
  who = { id: 'admin', name: '관리자', role: 'admin' };
  await gw.settingsSave('access', { open: true }, 0);
  who = { id: 'x', name: '팀원', role: 'user' };
  assert.deepEqual(await gw.access(), { isAdmin: false, canUse: true, canReview: false, open: true });
});

test('the preview tells other windows only that something changed', async () => {
  const posted: unknown[] = [];
  const channel = { postMessage: (m: unknown) => posted.push(m), addEventListener: () => {}, removeEventListener: () => {} };
  const gw = createBaePreviewGateway({ storage: memoryStorage(), identity: () => ({ id: 'admin', name: 'a', role: 'admin' }), knownUserIds: () => ['admin'], channel });
  const seen: string[] = []; const off = gw.onChanged((w) => seen.push(w));
  await gw.settingsSave('horizon', { calib: 3 }, 0);
  off();
  assert.deepEqual(seen, ['settings']);
  assert.deepEqual(posted, [{ bae: 'settings' }], 'no value rides on the signal');
});
