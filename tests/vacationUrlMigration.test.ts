/**
 * 휴가 API 구 주소 자동 이관 테스트
 *
 * 문제: 2026-09-16 휴가 시스템이 구 Apps Script 웹 앱 → Supabase vacation-api 로 이관됐는데,
 * 예전에 설정 화면에서 '설정 저장'을 누른 PC 에는 %APPDATA%\Bflow-BGonly\vacation-config.json 에
 * 구 주소가 남아 있었다. 저장값이 기본 주소보다 우선이라 계속 구 주소로 붙었고, 구 웹 앱은 핑에
 * 응답하므로 '연결됨'으로 보이면서 이관 시점에 멈춘 옛 시트를 읽었다 → 슬랙으로 올린 휴가가 안 보였다.
 * 위젯 팝업은 설정 파일이 없으면 아예 연결을 시도하지 않아 '휴가 연동이 필요합니다'가 떴다.
 *
 * 해결: 연결 주소는 resolveVacationConnection() 한 곳에서 정한다(빈 설정·구 주소 → 기본 주소,
 * 구 주소는 파일도 새 주소로 다시 씀). 설정 화면은 구 주소 저장·연결 테스트를 거부하고,
 * 팝업은 메인 창 연결을 먼저 확인한 뒤 같은 규칙으로 붙는다.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

type VacationServiceModule = typeof import('../src/services/vacationService.ts');

const LEGACY_URL = 'https://script.google.com/macros/s/AKfycbLEGACY/exec';
const BUILTIN_TOKEN = 'BUILTIN-TOKEN';
const read = (p: string) => readFileSync(p, 'utf8');

// ── vacationService 번들 (실제 src/config.ts 의 DEFAULT_VACATION_URL 을 그대로 쓴다) ─────────
let serviceSource: Promise<string> | undefined;
let nonce = 0;

async function freshVacationService(): Promise<VacationServiceModule> {
  serviceSource ??= build({
    stdin: {
      contents: "export * from './src/services/vacationService.ts';",
      resolveDir: process.cwd(),
      sourcefile: 'vacation-url-migration-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    define: { __BFLOW_VACATION_TOKEN__: JSON.stringify(BUILTIN_TOKEN) },
  }).then((result) => result.outputFiles[0].text);
  const encoded = Buffer.from(await serviceSource).toString('base64');
  return await import(`data:text/javascript;base64,${encoded}#vacation-url-${nonce++}`) as VacationServiceModule;
}

type SettingsStub = {
  writes: Array<{ fileName: string; data: unknown }>;
};

/** 렌더러의 window.electronAPI.readSettings/writeSettings 를 흉내 낸다 */
function stubSettings(options: {
  stored?: unknown;
  readThrows?: boolean;
  writeThrows?: boolean;
}): SettingsStub {
  const stub: SettingsStub = { writes: [] };
  (globalThis as Record<string, unknown>).window = {
    electronAPI: {
      readSettings: async (fileName: string) => {
        assert.equal(fileName, 'vacation-config.json');
        if (options.readThrows) throw new Error('EACCES');
        return options.stored === undefined ? null : structuredClone(options.stored);
      },
      writeSettings: async (fileName: string, data: unknown) => {
        if (options.writeThrows) throw new Error('EPERM');
        stub.writes.push({ fileName, data: structuredClone(data) });
        return true;
      },
    },
  };
  return stub;
}

test.afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

// ── 구 주소 판정 ──────────────────────────────────────────────────────
test('isLegacyVacationUrl — 구 Apps Script 웹 앱 주소만 구 주소다', async () => {
  const { isLegacyVacationUrl } = await freshVacationService();
  for (const url of [
    LEGACY_URL,
    '  https://script.google.com/macros/s/AAA/exec  ',
    'http://script.google.com/macros/s/AAA/exec',
    'https://SCRIPT.GOOGLE.COM/macros/s/AAA/exec',
    'https://script.google.com/a/macros/studiojbbj.com/s/AAA/exec',
    'script.google.com/macros/s/AAA/exec',
  ]) {
    assert.equal(isLegacyVacationUrl(url), true, url);
  }
  for (const url of [
    'https://mpqifkpxalwxgcrddchv.supabase.co/functions/v1/vacation-api',
    'https://example.test/functions/v1/vacation-api',
    'https://script.google.com/home',
    'https://evil.example/script.google.com/macros/s/AAA/exec',
    '',
    '   ',
    null,
    undefined,
  ]) {
    assert.equal(isLegacyVacationUrl(url as string), false, String(url));
  }
});

test('기본 주소는 새 휴가 API(vacation-api)이고 구 주소가 아니다', async () => {
  const { isLegacyVacationUrl } = await freshVacationService();
  const config = read('src/config.ts');
  const match = config.match(/export const DEFAULT_VACATION_URL = '([^']+)';/);
  assert.ok(match, 'DEFAULT_VACATION_URL 선언');
  assert.match(match![1], /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/vacation-api$/);
  assert.equal(isLegacyVacationUrl(match![1]), false);
});

// ── 실제로 쓸 주소·토큰 ───────────────────────────────────────────────
function defaultUrl(): string {
  return read('src/config.ts').match(/export const DEFAULT_VACATION_URL = '([^']+)';/)![1];
}

test('구 주소가 저장돼 있으면 새 주소로 연결하고, 파일도 새 주소로 다시 쓴다 (apiToken·다른 키 보존)', async () => {
  const vac = await freshVacationService();
  const settings = stubSettings({
    stored: { webAppUrl: LEGACY_URL, apiToken: 'MY-TOKEN', note: '손으로 적어 둔 값' },
  });

  const resolved = await vac.resolveVacationConnection();

  assert.equal(resolved.url, defaultUrl(), '구 주소 대신 기본 주소로 붙는다');
  assert.equal(resolved.apiToken, 'MY-TOKEN', '설정 파일 토큰이 빌드 토큰보다 우선');
  assert.equal(resolved.savedApiToken, 'MY-TOKEN');
  assert.equal(resolved.migratedFromLegacy, true);
  assert.equal(resolved.hasSavedConfig, true);
  assert.deepEqual(settings.writes, [{
    fileName: 'vacation-config.json',
    data: { webAppUrl: defaultUrl(), apiToken: 'MY-TOKEN', note: '손으로 적어 둔 값' },
  }], '주소만 바꾸고 나머지 키는 그대로 다시 쓴다');
});

test('설정이 없거나 주소가 비었으면 기본 주소 + 빌드 토큰, 파일은 건드리지 않는다', async () => {
  const vac = await freshVacationService();
  for (const stored of [undefined, {}, { webAppUrl: '' }, { webAppUrl: '   ' }]) {
    const settings = stubSettings({ stored });
    const resolved = await vac.resolveVacationConnection();
    assert.equal(resolved.url, defaultUrl(), JSON.stringify(stored));
    assert.equal(resolved.apiToken, BUILTIN_TOKEN, JSON.stringify(stored));
    assert.equal(resolved.migratedFromLegacy, false);
    assert.deepEqual(settings.writes, [], `다시 쓰지 않는다: ${JSON.stringify(stored)}`);
  }
});

test('새 주소(또는 사용자가 일부러 넣은 다른 주소)는 그대로 쓴다', async () => {
  const vac = await freshVacationService();
  const custom = 'https://staging.example.test/functions/v1/vacation-api';
  const settings = stubSettings({ stored: { webAppUrl: custom } });

  const resolved = await vac.resolveVacationConnection();

  assert.equal(resolved.url, custom);
  assert.equal(resolved.apiToken, BUILTIN_TOKEN, '파일에 토큰이 없으면 빌드 토큰');
  assert.equal(resolved.savedApiToken, '');
  assert.equal(resolved.migratedFromLegacy, false);
  assert.deepEqual(settings.writes, []);
});

test('파일을 못 읽거나 모양이 이상하면 기본 주소로 안전하게 가고, 읽지 못한 파일은 덮어쓰지 않는다', async () => {
  const vac = await freshVacationService();
  for (const options of [
    { readThrows: true },
    { stored: 'not-an-object' },
    { stored: [LEGACY_URL] },
    { stored: { webAppUrl: 42 } },
  ]) {
    const settings = stubSettings(options);
    const resolved = await vac.resolveVacationConnection();
    assert.equal(resolved.url, defaultUrl(), JSON.stringify(options));
    assert.deepEqual(settings.writes, [], JSON.stringify(options));
  }
});

test('파일 다시 쓰기가 실패해도 이번 연결은 새 주소로 한다', async () => {
  const vac = await freshVacationService();
  stubSettings({ stored: { webAppUrl: LEGACY_URL }, writeThrows: true });

  const resolved = await vac.resolveVacationConnection();

  assert.equal(resolved.url, defaultUrl());
  assert.equal(resolved.migratedFromLegacy, true);
});

// ── 앱 시작(메인 창) ──────────────────────────────────────────────────
test('앱 시작: 저장값을 직접 쓰지 않고 resolveVacationConnection 결과로 연결한다', () => {
  const app = read('src/App.tsx');
  assert.match(app, /const vacConnection = await resolveVacationConnection\(\);/);
  assert.match(app, /connectVacation\(vacConnection\.url, vacConnection\.apiToken\)/);
  assert.doesNotMatch(app, /vacConfig\?\.webAppUrl \|\|/, '저장값 우선 폴백이 남아 있으면 구 주소로 붙는다');
});

test('설정 파일을 직접 읽어 연결하는 곳이 없다 (전부 resolveVacationConnection 경유)', () => {
  const offenders: string[] = [];
  for (const rel of readdirSync('src', { recursive: true }) as string[]) {
    const path = join('src', rel).replaceAll('\\', '/');
    if (!/\.(ts|tsx)$/.test(path)) continue;
    if (path === 'src/services/vacationService.ts' || path.startsWith('src/mocks/')) continue;
    if (/\bloadVacationConfig\(/.test(read(path))) offenders.push(path);
  }
  assert.deepEqual(offenders, [], '저장된 주소를 그대로 쓰면 구 주소 이관이 빠진다');
});

// ── 설정 화면 ─────────────────────────────────────────────────────────
test('설정 화면: 구 주소 안내 문구가 이관 날짜를 알려 준다', async () => {
  const vac = await freshVacationService();
  assert.equal(vac.legacyVacationUrlError(defaultUrl()), null);
  assert.equal(vac.legacyVacationUrlError(''), null);
  const message = vac.legacyVacationUrlError(LEGACY_URL);
  assert.ok(message);
  assert.match(message!, /구 휴가 웹 앱/);
  assert.match(message!, /2026-09-16 이관으로 종료/);
});

/** `const name = async (...) => { ... };` 한 덩어리를 잘라 낸다 */
function handlerBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = async () => {`);
  assert.notEqual(start, -1, `${name} 핸들러`);
  const end = src.indexOf('\n  };', start);
  assert.notEqual(end, -1);
  return src.slice(start, end);
}

test('설정 화면: 저장·연결 테스트 모두 구 주소를 먼저 거부한다 (거부하면 저장·연결하지 않는다)', () => {
  const src = read('src/components/settings/SheetsSection.tsx');

  const reject = src.slice(src.indexOf('const rejectLegacyVacationUrl = (): boolean => {'));
  assert.match(reject, /^const rejectLegacyVacationUrl = \(\): boolean => \{\s*const legacyError = legacyVacationUrlError\(vacationUrl\);\s*if \(!legacyError\) return false;\s*setVacationUrl\(DEFAULT_VACATION_URL\);\s*setVacationError\(legacyError\);/,
    '구 주소면 입력칸을 새 주소로 되돌리고 안내를 띄운다');

  const save = handlerBody(src, 'handleVacationSave');
  const saveGuard = save.indexOf('if (rejectLegacyVacationUrl()) return;');
  assert.notEqual(saveGuard, -1, '저장 전에 구 주소 거부');
  assert.ok(saveGuard < save.indexOf('saveVacationConfig('), '거부 검사가 저장보다 먼저');

  const connect = handlerBody(src, 'handleVacationConnect');
  const connectGuard = connect.indexOf('if (rejectLegacyVacationUrl()) return;');
  assert.notEqual(connectGuard, -1, '연결 테스트 전에 구 주소 거부');
  assert.ok(connectGuard < connect.indexOf('connectVacation('), '거부 검사가 연결보다 먼저');
});

test('설정 화면: 입력칸 기본값은 새 주소, 열 때도 저장값 대신 resolveVacationConnection 결과를 보여 준다', () => {
  const src = read('src/components/settings/SheetsSection.tsx');
  assert.match(src, /const \[vacationUrl, setVacationUrl\] = useState\(DEFAULT_VACATION_URL \|\| ''\);/);
  assert.match(src, /const vacConnection = await resolveVacationConnection\(\);\s*setVacationUrl\(vacConnection\.url\);/);
  assert.match(src, /connectVacation\(vacConnection\.url, vacConnection\.apiToken\)/);
});

// ── 위젯 팝업 ─────────────────────────────────────────────────────────
type PopupVacationStub = {
  connected: boolean | Error;
  resolved: { url: string; apiToken: string };
  connectResult: { ok: boolean; error: string | null };
  calls: string[];
};

let popupSource: Promise<string> | undefined;

async function loadConnectPopupVacation(stub: PopupVacationStub): Promise<() => Promise<boolean>> {
  popupSource ??= build({
    entryPoints: ['src/views/WidgetPopup.tsx'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    write: false,
    packages: 'external',
    external: ['@/*', '*.css'],
  }).then((result) => result.outputFiles[0].text);
  const source = await popupSource;

  const nodeRequire = createRequire(import.meta.url);
  const noop = () => undefined;
  const mockExport: unknown = new Proxy(noop, {
    get: (_target, key) => (key === '__esModule' ? true : mockExport),
  });
  const mockModule = new Proxy({ __esModule: true } as Record<string, unknown>, {
    get: (_target, key) => (key === '__esModule' ? true : mockExport),
  });
  const vacationService = {
    __esModule: true,
    checkVacationConnection: async () => {
      stub.calls.push('check');
      if (stub.connected instanceof Error) throw stub.connected;
      return stub.connected;
    },
    resolveVacationConnection: async () => {
      stub.calls.push('resolve');
      return { ...stub.resolved, savedApiToken: '', hasSavedConfig: false, migratedFromLegacy: false };
    },
    connectVacation: async (url: string, apiToken?: string) => {
      stub.calls.push(`connect ${url} ${apiToken ?? ''}`);
      return stub.connectResult;
    },
  };
  const runtimeRequire = (id: string): unknown => {
    if (id === 'react' || id === 'react/jsx-runtime' || id === 'react-dom') return nodeRequire(id);
    if (id === '@/services/vacationService') return vacationService;
    return mockModule;
  };
  const module = { exports: {} as Record<string, unknown> };
  new Function('require', 'module', 'exports', source)(runtimeRequire, module, module.exports);
  const fn = module.exports.connectPopupVacation;
  assert.equal(typeof fn, 'function', 'WidgetPopup 가 connectPopupVacation 을 내보낸다');
  return fn as () => Promise<boolean>;
}

const NEW_URL = 'https://mpqifkpxalwxgcrddchv.supabase.co/functions/v1/vacation-api';

test('팝업: 메인 프로세스가 이미 연결돼 있으면 그대로 쓰고 다른 주소로 다시 붙지 않는다', async () => {
  const stub: PopupVacationStub = {
    connected: true,
    resolved: { url: NEW_URL, apiToken: 'T' },
    connectResult: { ok: true, error: null },
    calls: [],
  };
  const connectPopupVacation = await loadConnectPopupVacation(stub);
  assert.equal(await connectPopupVacation(), true);
  assert.deepEqual(stub.calls, ['check']);
});

test('팝업: 연결이 없으면(설정 파일이 없어도) 기본 주소 폴백으로 붙는다', async () => {
  const stub: PopupVacationStub = {
    connected: false,
    resolved: { url: NEW_URL, apiToken: 'T' },
    connectResult: { ok: true, error: null },
    calls: [],
  };
  const connectPopupVacation = await loadConnectPopupVacation(stub);
  assert.equal(await connectPopupVacation(), true);
  assert.deepEqual(stub.calls, ['check', 'resolve', `connect ${NEW_URL} T`]);
});

test('팝업: 상태 확인이 실패해도 직접 연결을 시도하고, 연결 실패는 false', async () => {
  const stub: PopupVacationStub = {
    connected: new Error('ipc down'),
    resolved: { url: NEW_URL, apiToken: '' },
    connectResult: { ok: false, error: '연결 실패' },
    calls: [],
  };
  const connectPopupVacation = await loadConnectPopupVacation(stub);
  assert.equal(await connectPopupVacation(), false);
  assert.deepEqual(stub.calls, ['check', 'resolve', `connect ${NEW_URL} `]);
});

test('팝업: 초기화에서 connectPopupVacation 결과로 연결 상태를 켠다', () => {
  const popup = read('src/views/WidgetPopup.tsx');
  assert.match(popup, /if \(await connectPopupVacation\(\)\) \{\s*useAppStore\.getState\(\)\.setVacationConnected\(true\);/);
  assert.doesNotMatch(popup, /if \(vacConfig\?\.webAppUrl\)/, '설정 파일이 없으면 연결을 건너뛰던 분기');
});
