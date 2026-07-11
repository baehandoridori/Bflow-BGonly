import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

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

test('new market components do not hardcode hex colors', () => {
  const files = [
    'src/views/playground/market/MarketNav.tsx',
    'src/views/playground/market/MarketHome.tsx',
    'src/views/playground/market/MarketRows.tsx',
    'src/views/playground/market/StockDetailView.tsx',
    'src/views/playground/market/MarketPriceChart.tsx',
    'src/views/playground/market/MarketOrderPanel.tsx',
    'src/views/playground/market/MarketOrderDialogs.tsx',
    'src/views/playground/market/MarketMobileOrderDock.tsx',
    'src/views/playground/market/MarketAdminPanel.tsx',
    'src/views/playground/market/useMarketOrderController.ts',
    'src/views/playground/market/MarketAccountView.tsx',
    'src/views/playground/market/PointTransferDialog.tsx',
  ];
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /#[0-9a-f]{3,8}\b/i, file);
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
  for (const file of files.filter((file) => (
    file !== storageAdapter
    && file !== bridgeAdapter
    && file !== chartPreferenceAdapter
    && file !== nativeBackAdapter
  ))) {
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
