import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

test('market semantic colors exist in CSS and Tailwind', () => {
  const css = readFileSync('src/index.css', 'utf8');
  const tailwind = readFileSync('tailwind.config.js', 'utf8');
  for (const token of ['market-up', 'market-down', 'market-flat', 'market-news']) {
    assert.match(css, new RegExp(`--color-${token}`));
    assert.match(tailwind, new RegExp(`'${token}'`));
  }
});

test('market rows map every trend to its semantic color class', () => {
  const source = readFileSync('src/views/playground/market/MarketRows.tsx', 'utf8');
  assert.match(source, /if \(trend === 'up'\) return 'text-market-up';/);
  assert.match(source, /if \(trend === 'down'\) return 'text-market-down';/);
  assert.match(source, /return 'text-market-flat';/);
});

test('quick order actions use sell-down then buy-up semantics with restrained motion', () => {
  const panel = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');
  const dock = readFileSync('src/views/playground/market/MarketMobileOrderDock.tsx', 'utf8');
  const sellPanel = panel.indexOf('id="market-order-sell-action"');
  const buyPanel = panel.indexOf('id="market-order-buy-action"');
  const sellDock = dock.indexOf('현재가 팔기');
  const buyDock = dock.indexOf('현재가 사기');

  assert.ok(sellPanel >= 0 && sellPanel < buyPanel);
  assert.ok(sellDock >= 0 && sellDock < buyDock);
  for (const source of [panel, dock]) {
    assert.match(source, /bg-market-down/);
    assert.match(source, /bg-market-up/);
    assert.match(source, /duration-(?:150|200)/);
    assert.match(source, /motion-reduce:transition-none/);
    assert.doesNotMatch(source, /transition-all|\btransition\s/);
  }
});

test('new market components do not hardcode hex colors', () => {
  const files = [
    'src/views/playground/market/MarketNav.tsx',
    'src/views/playground/market/MarketHome.tsx',
    'src/views/playground/market/MarketRows.tsx',
    'src/views/playground/market/StockDetailView.tsx',
    'src/views/playground/market/MarketPriceChart.tsx',
    'src/views/playground/market/MarketInteractiveChart.tsx',
    'src/views/playground/market/MarketOrderPanel.tsx',
    'src/views/playground/market/MarketOrderDialogs.tsx',
    'src/views/playground/market/MarketMobileOrderDock.tsx',
    'src/views/playground/market/MarketAdminPanel.tsx',
    'src/views/playground/market/useMarketOrderController.ts',
    'src/views/playground/market/MarketAccountView.tsx',
    'src/views/playground/market/PointTransferDialog.tsx',
  ];
  for (const file of files) {
    assert.equal(existsSync(file), true, `${file} must exist`);
    assert.doesNotMatch(readFileSync(file, 'utf8'), /#[0-9a-f]{3,8}\b/i, file);
  }
});

test('interactive market chart controls keep semantic themes and accessible restrained motion', () => {
  const chart = readFileSync('src/views/playground/market/MarketPriceChart.tsx', 'utf8');
  const interactivePath = 'src/views/playground/market/MarketInteractiveChart.tsx';
  assert.equal(existsSync(interactivePath), true, 'interactive market chart must exist');
  const interactive = readFileSync(interactivePath, 'utf8');

  for (const source of [chart, interactive]) {
    assert.match(source, /bg-bg-(?:primary|card)|border-bg-border/);
    assert.match(source, /text-text-(?:primary|secondary)/);
    assert.match(source, /focus-visible:(?:outline-none|ring-2)/);
    assert.match(source, /motion-reduce:transition-none/);
  }
  assert.match(chart, /min-h-11/);
  assert.match(interactive, /min-h-11/);
});

test('preview feature only reaches browser persistence through the injected storage adapter', () => {
  const collect = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(path).isDirectory() ? collect(path) : [path];
  });
  const files = [
    'src/views/PlaygroundView.tsx',
    ...collect('src/features/playground'),
    ...collect('src/views/playground'),
  ]
    .filter((file) => /\.tsx?$/.test(file));
  const storageAdapter = 'src/features/playground/market/localStorageGateway.ts';
  const bridgeAdapter = 'src/features/playground/market/gateway.ts';
  const chartPreferenceAdapter = 'src/features/playground/market/useMarketChartPreference.ts';
  const nativeBackAdapter = 'src/features/playground/nativeBackBridge.ts';
  const arcadeStorageAdapter = 'src/features/playground/arcade/localStorageGateway.ts';
  const arcadeBridgeAdapter = 'src/features/playground/arcade/gateway.ts';
  const arcadeWalletBridge = 'src/features/playground/arcade/walletBridge.ts';
  const allowlist = new Set([
    storageAdapter,
    bridgeAdapter,
    chartPreferenceAdapter,
    nativeBackAdapter,
    arcadeStorageAdapter,
    arcadeBridgeAdapter,
    arcadeWalletBridge,
  ]);
  for (const file of files.filter((file) => !allowlist.has(file))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /window\.electronAPI|localStorage|sessionStorage|indexedDB|ipcRenderer|from\s+['"]electron['"]|createClient\(|@supabase|@\/services\//i,
      file,
    );
  }
  const adapter = readFileSync(storageAdapter, 'utf8');
  assert.match(adapter, /storage:\s*Storage/);
  assert.match(adapter, /options\.storage\.getItem/);
  assert.match(adapter, /options\.storage\.setItem/);
  assert.doesNotMatch(
    adapter,
    /window\.electronAPI|window\.localStorage|globalThis\.localStorage|sessionStorage|indexedDB|ipcRenderer|from\s+['"]electron['"]|createClient\(|@supabase|@\/services\//i,
  );
  const bridge = readFileSync(bridgeAdapter, 'utf8');
  assert.match(bridge, /window\.electronAPI/);
  assert.doesNotMatch(
    bridge,
    /window\.localStorage|globalThis\.localStorage|sessionStorage|indexedDB|ipcRenderer|from\s+['"]electron['"]|createClient\(|@supabase|@\/services\//i,
  );
  const chartPreference = readFileSync(chartPreferenceAdapter, 'utf8');
  assert.match(chartPreference, /bflow:playground-market:chart-style:v2/);
  assert.match(chartPreference, /window\.localStorage/);
  assert.doesNotMatch(chartPreference, /cashWon|holding|account/i);
  const nativeBack = readFileSync(nativeBackAdapter, 'utf8');
  assert.match(nativeBack, /window\.electronAPI\?\.onPlaygroundNativeBack/);
  assert.doesNotMatch(nativeBack, /localStorage|sessionStorage|indexedDB|ipcRenderer|from\s+['"]electron['"]|createClient\(|@supabase|@\/services\//i);
});
