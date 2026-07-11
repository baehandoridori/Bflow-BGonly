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

test('new market components do not hardcode hex colors', () => {
  const files = [
    'src/views/playground/market/MarketNav.tsx',
    'src/views/playground/market/MarketHome.tsx',
    'src/views/playground/market/MarketRows.tsx',
    'src/views/playground/market/StockDetailView.tsx',
    'src/views/playground/market/MarketPriceChart.tsx',
    'src/views/playground/market/MarketOrderPanel.tsx',
    'src/views/playground/market/MarketAccountView.tsx',
    'src/views/playground/market/PointTransferDialog.tsx',
  ];
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /#[0-9a-f]{3,8}\b/i, file);
});

test('preview feature cannot reach production persistence APIs', () => {
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
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /window\.electronAPI|localStorage|sessionStorage|indexedDB|ipcRenderer|from\s+['"]electron['"]|createClient\(|@supabase|@\/services\//i,
      file,
    );
  }
});
