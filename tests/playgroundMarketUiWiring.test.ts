import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('market home preserves the approved information order', () => {
  const source = readFileSync('src/views/playground/market/MarketHome.tsx', 'utf8');
  const labels = ['오늘의 JBBJ 시장', '찜한 주식', '오늘 가격에 영향을 준 소식', '모든 주식', '초보 미션'];
  const positions = labels.map((label) => source.indexOf(label));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('lobby includes random recommendation, market, three games and JBBJ house', () => {
  const source = readFileSync('src/views/playground/PlaygroundLobby.tsx', 'utf8');
  for (const label of ['오늘의 추천', 'JBBJ 증권', '테트리스', '스도쿠', '스네이크', 'JBBJ 하우스']) {
    assert.match(source, new RegExp(label));
  }
});

test('market shell has a stable loading and retry boundary', () => {
  const source = readFileSync('src/views/playground/market/MarketDataBoundary.tsx', 'utf8');
  assert.match(source, /시장 정보를 불러오는 중/);
  assert.match(source, /시장 정보를 불러오지 못했어요/);
  assert.match(source, /다시 불러오기/);
  assert.match(source, /aria-live="polite"/);
});

test('market routes select the loading skeleton variant used by MarketRouter', async () => {
  const helperPath = 'src/views/playground/market/marketDataBoundaryView.ts';
  assert.equal(existsSync(helperPath), true, 'executable market boundary helpers must exist');
  const { selectMarketLoadingVariant } = await import(
    '../src/views/playground/market/marketDataBoundaryView.ts'
  );
  const router = readFileSync('src/views/playground/market/MarketRouter.tsx', 'utf8');

  assert.equal(selectMarketLoadingVariant({ kind: 'account' }), 'account');
  assert.equal(selectMarketLoadingVariant({ kind: 'home' }), 'market');
  assert.equal(selectMarketLoadingVariant({ kind: 'stock', stockId: 'jbbj-test' }), 'market');
  assert.match(router, /selectMarketLoadingVariant\(route\)/);
});

test('production loading skeletons render the account dimensions and generic fallback', async () => {
  const helperPath = 'src/views/playground/market/marketDataBoundaryView.ts';
  assert.equal(existsSync(helperPath), true, 'executable market boundary helpers must exist');
  const { MarketLoadingSkeleton } = await import(
    '../src/views/playground/market/marketDataBoundaryView.ts'
  );

  const accountMarkup = renderToStaticMarkup(createElement(MarketLoadingSkeleton, {
    variant: 'account',
  }));
  const marketMarkup = renderToStaticMarkup(createElement(MarketLoadingSkeleton, {
    variant: 'market',
  }));

  assert.match(accountMarkup, /max-w-\[980px\]/);
  assert.match(accountMarkup, /lg:grid-cols-\[184px_minmax\(0,1fr\)\]/);
  assert.match(accountMarkup, /max-w-\[520px\]/);
  const accountMenu = accountMarkup.match(/<nav[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.match(accountMenu, /self-start/);
  assert.equal((accountMenu.match(/min-h-11/g) ?? []).length, 5);
  for (const rowHeight of ['min-h-11', 'min-h-16', 'min-h-[72px]', 'min-h-12']) {
    assert.match(accountMarkup, new RegExp(rowHeight.replace(/[\[\]]/g, '\\$&')));
  }
  assert.match(accountMarkup, /animate-pulse/);
  assert.match(accountMarkup, /motion-reduce:animate-none/);

  assert.match(marketMarkup, /max-w-5xl/);
  for (const height of ['h-28', 'h-48', 'h-72']) assert.match(marketMarkup, new RegExp(height));
  assert.doesNotMatch(marketMarkup, /max-w-\[980px\]|max-w-\[520px\]|min-h-\[72px\]/);
});

test('market boundary resolver chooses retry error, loading, and visible content', async () => {
  const helperPath = 'src/views/playground/market/marketDataBoundaryView.ts';
  assert.equal(existsSync(helperPath), true, 'executable market boundary helpers must exist');
  const { resolveMarketBoundaryState } = await import(
    '../src/views/playground/market/marketDataBoundaryView.ts'
  );
  const boundary = readFileSync('src/views/playground/market/MarketDataBoundary.tsx', 'utf8');

  assert.equal(resolveMarketBoundaryState({ hasVisibleSnapshot: false, error: null }), 'loading');
  assert.equal(
    resolveMarketBoundaryState({ hasVisibleSnapshot: false, error: 'load failed' }),
    'error',
  );
  assert.equal(resolveMarketBoundaryState({ hasVisibleSnapshot: true, error: null }), 'content');
  assert.equal(
    resolveMarketBoundaryState({ hasVisibleSnapshot: true, error: 'mutation failed' }),
    'content',
  );
  assert.match(boundary, /resolveMarketBoundaryState\(/);
  assert.match(boundary, /boundaryState === 'error'/);
  assert.match(boundary, /boundaryState === 'loading'/);
});

test('market search follows the keyboard combobox contract', () => {
  const source = readFileSync('src/views/playground/market/MarketNav.tsx', 'utf8');
  for (const contract of ['role="combobox"', 'aria-activedescendant', 'role="listbox"', 'role="option"', 'ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'aria-live="polite"']) {
    assert.match(source, new RegExp(contract));
  }
});

test('reason selection navigates immediately while persistence settles in the background', () => {
  const source = readFileSync('src/views/playground/market/MarketHome.tsx', 'utf8');
  const start = source.indexOf('const openStockAfterReadingReason');
  const end = source.indexOf('\n  };', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);

  assert.doesNotMatch(handler, /\basync\b|\bawait\b/);
  assert.match(handler, /\.catch\(\(\) => undefined\)/);
  assert.ok(handler.indexOf('execute({') < handler.indexOf('onOpenStock(stockId)'));
});

test('destination returns preserve their source while lobby and house cards retain origin wipes', () => {
  const playground = readFileSync('src/views/PlaygroundView.tsx', 'utf8');
  const lobby = readFileSync('src/views/playground/PlaygroundLobby.tsx', 'utf8');
  const activation = readFileSync('src/views/playground/playgroundActivation.ts', 'utf8');
  const card = readFileSync('src/views/playground/PlaygroundGameCard.tsx', 'utf8');
  const hero = readFileSync('src/views/playground/PlaygroundRecommendationHero.tsx', 'utf8');
  const house = readFileSync('src/views/playground/JbbjHouse.tsx', 'utf8');
  const comingSoon = readFileSync('src/views/playground/ComingSoonGame.tsx', 'utf8');
  const marketNav = readFileSync('src/views/playground/market/MarketNav.tsx', 'utf8');

  assert.match(playground, /getPlaygroundMovePlan/);
  assert.match(playground, /\.\.\.plan\.request/);
  assert.match(playground, /route\.kind === 'house'[\s\S]*?onBack:\s*\(\) => move\(\{ kind: 'go-lobby' \}\)/);
  assert.match(playground, /returnLabel=\{route\.returnTo === 'house' \? 'JBBJ 하우스' : '게임 로비'\}/);
  assert.match(playground, /onBack=\{\(\) => move\(\{ kind: 'return-to-source' \}\)\}/);
  assert.match(playground, /onExit=\{\(\) => move\(\{ kind: 'return-to-source' \}\)\}/);
  assert.match(house, /pointFromButtonActivation\(event\)/);
  assert.match(comingSoon, /onClick=\{onBack\}/);
  assert.match(marketNav, /onClick=\{onExit\}/);
  for (const source of [comingSoon, marketNav]) {
    assert.doesNotMatch(source, /originFromActivation/);
  }
  assert.match(activation, /originFromActivation/);
  assert.match(card, /pointFromButtonActivation\(event\)/);
  assert.match(hero, /pointFromButtonActivation\(event\)/);
  assert.match(house, /pointFromButtonActivation\(event\)/);
  assert.match(lobby, /onPlayGame\(entry\.gameId,\s*origin\)/);
  assert.match(lobby, /onOpenMarket\(origin\)/);
});

test('completed mission disclosure summary has a 44px padded target', () => {
  const source = readFileSync('src/views/playground/market/MarketHome.tsx', 'utf8');
  const className = source.match(/<summary className="([^"]+)"/)?.[1] ?? '';

  assert.match(className, /\bmin-h-11\b/);
  assert.match(className, /\bpx-\d+\b/);
  assert.match(className, /\bpy-\d+\b/);
});

test('stock detail uses the approved beginner-first order', () => {
  const source = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');
  const labels = ['회사 한 줄 설명', '현재 가격과 오늘의 변화', '오늘 움직인 이유', '가격 그래프', '내 보유 상태', '간편 주문', '최근 소식'];
  const positions = labels.map((label) => source.indexOf(label));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  for (const forbidden of ['PER', 'PBR', '체결 강도', '호가창']) assert.doesNotMatch(source, new RegExp(forbidden));
});

test('market dialog is portalled, labelled, inert and focus-safe', () => {
  const source = readFileSync('src/views/playground/market/MarketActionDialog.tsx', 'utf8');
  assert.match(source, /createPortal/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /\.inert\s*=\s*true/);
  assert.match(source, /openerRef\.current.*focus/);
});

test('global order toaster is portalled beyond the dialog inert root boundary', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const dialog = readFileSync('src/views/playground/market/MarketActionDialog.tsx', 'utf8');
  const order = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');

  assert.match(dialog, /document\.getElementById\(['"]root['"]\)/);
  assert.match(dialog, /root\.inert\s*=\s*true/);
  assert.match(dialog, /root\.setAttribute\(['"]aria-hidden['"],\s*['"]true['"]\)/);
  assert.equal((app.match(/<Toaster\b/g) ?? []).length, 1);
  assert.match(
    app,
    /createPortal\(\s*<Toaster\b[\s\S]*?\/>\s*,\s*document\.body\s*,?\s*\)/,
  );

  assert.match(order, /toast\.success\(/);
  assert.match(order, /toast\.error\(/);
  assert.equal((order.match(
    /<p className="mt-3 min-h-5 text-sm font-semibold text-text-primary" aria-live="polite">\s*\{dialogError \?\? storeError \?\? ''\}\s*<\/p>/g,
  ) ?? []).length, 2);
});

test('detail chart and order panel keep the approved source contracts', () => {
  const chart = readFileSync('src/views/playground/market/MarketPriceChart.tsx', 'utf8');
  const order = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');
  for (const label of ['오늘', '1주', '1개월', '전체', '가격 정보가 아직 없어요']) {
    assert.match(chart, new RegExp(label));
  }
  assert.match(chart, /getChartGeometry\([^)]*720[^)]*280/s);
  assert.match(chart, /text-market-up/);
  assert.match(chart, /text-market-down/);
  assert.match(chart, /text-market-flat/);
  assert.doesNotMatch(chart, /#[0-9a-f]{3,8}/i);

  for (const label of ['현재 가격으로 바로 사기', '최대', '전부', '직접 입력', '원하는 가격에 주문하기']) {
    assert.match(order, new RegExp(label));
  }
  assert.match(order, /SHARE_PRESETS\s*=\s*\[1,\s*5,\s*10\]/);
  assert.match(order, /validateMarketCommand/);
  assert.match(order, /getSellProjection/);
  assert.match(order, /getBuyCostWon/);
  assert.match(order, /maxBuyableShares/);
  assert.match(order, /formatWon/);
  assert.match(order, /formatShares/);
  assert.doesNotMatch(order, /getBuyProjection|SHARE_SCALE|ratioBps|quantityMicros|pricePoints/);
  assert.doesNotMatch(order, /applyMarketCommand/);
});

test('stock detail xl shell contains both fixed columns, gap and horizontal padding', () => {
  const source = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');
  assert.match(source, /xl:max-w-\[1200px\]/);
  assert.match(source, /xl:grid-cols-\[minmax\(0,760px\)_360px\]/);
  assert.match(source, /xl:gap-x-6/);
});

test('easy order revalidates frozen confirmation before creating a request id', () => {
  const source = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');
  const start = source.indexOf('const confirmEasyOrder');
  const end = source.indexOf('const openLimitOrder', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);

  const latestSnapshot = handler.indexOf('useMarketPreviewStore.getState().visible');
  const validate = handler.indexOf('validateMarketCommand');
  const createRequestId = handler.indexOf('crypto.randomUUID()');
  const execute = handler.indexOf('await execute(command)');
  assert.ok(latestSnapshot >= 0 && latestSnapshot < validate);
  assert.ok(validate < createRequestId && createRequestId < execute);
  assert.match(handler, /getBuyCostWon/);
  assert.match(handler, /getSellProjection/);
  assert.match(handler, /확인 내용을 새로 고쳤어요/);
});

test('market views centralize P, won and whole-share formatting without point-priced stock copy', () => {
  const files = [
    'src/views/playground/market/MarketRows.tsx',
    'src/views/playground/market/MarketPriceChart.tsx',
    'src/views/playground/market/StockDetailView.tsx',
    'src/views/playground/market/MarketOrderPanel.tsx',
    'src/views/playground/market/MarketAccountView.tsx',
    'src/views/playground/market/PointTransferDialog.tsx',
  ];
  const sources = files.map((file) => readFileSync(file, 'utf8'));
  for (const source of sources) {
    assert.doesNotMatch(source, /pricePoints|cashPoints|costBasisPoints|quantityMicros/);
  }
  assert.match(sources[0], /formatWon/);
  assert.match(sources[1], /formatWon/);
  assert.match(sources[2], /formatWon/);
  assert.match(sources[3], /formatWon/);
  assert.match(sources[3], /formatShares/);
  assert.match(sources[4], /formatPoints/);
  assert.match(sources[4], /formatWon/);
  assert.match(sources[4], /formatShares/);
  assert.match(sources[5], /formatPoints/);
  assert.match(sources[5], /formatWon/);
});

test('order dialog refuses to close while its mutation is running', () => {
  const source = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');
  const start = source.indexOf('const closeOrderDialog');
  const end = source.indexOf('\n  };', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /submitting\s*\|\|\s*mutating/);
  assert.match(handler, /주문 저장이 끝날 때까지/);
  assert.match(source, /onClose=\{closeOrderDialog\}/);
});

test('account stays a 520px single column with simple rows and no chart', () => {
  const source = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  assert.match(source, /max-w-\[520px\]/);
  for (const label of ['투자 계좌', '총자산', '넣기', '빼기', '포인트 지갑', '현재 내 투자 현황', '내 투자 실적']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /아직 보유한 주식이 없어요/);
  assert.match(source, /종목 둘러보기/);
  assert.doesNotMatch(source, /MarketPriceChart|price-chart|7일|전체 기간/);
  assert.doesNotMatch(source, /한솔님의 투자 계좌/);
});

test('account side menu exposes only Assets as implemented', () => {
  const source = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  for (const label of ['자산', '거래내역', '주문내역', '수익분석', '계좌관리']) assert.match(source, new RegExp(label));
  assert.match(source, /<button[\s\S]*?aria-current="page"[\s\S]*?>[\s\S]*?자산/);
  assert.match(source, /aria-disabled="true"/);
  assert.match(source, /준비 중/);
});

test('account wires separate deposit and withdrawal dialogs to stable opener refs', () => {
  const dialogPath = 'src/views/playground/market/PointTransferDialog.tsx';
  assert.equal(existsSync(dialogPath), true, 'PointTransferDialog must exist');
  const account = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  const dialog = readFileSync(dialogPath, 'utf8');

  assert.match(account, /depositOpenerRef/);
  assert.match(account, /withdrawalOpenerRef/);
  assert.match(account, /ref=\{depositOpenerRef\}/);
  assert.match(account, /ref=\{withdrawalOpenerRef\}/);
  assert.match(account, /direction="wallet-to-broker"/);
  assert.match(account, /direction="broker-to-wallet"/);
  assert.equal((account.match(/<PointTransferDialog\b/g) ?? []).length, 2);

  assert.match(dialog, /MarketActionDialog/);
  assert.match(dialog, /TRANSFER_PRESETS\s*=\s*\[1000,\s*5000\]/);
  for (const label of ['투자 계좌에 포인트 넣기', '투자 계좌에서 포인트 빼기', '포인트 지갑 잔액', '꺼낼 수 있는 예수금', '이동 후 예수금', '이동 후 포인트 지갑', '1P = 1원', '수수료가 없고 투자 실적에는 포함되지 않아요', '투자 중인 포인트는 주식을 판 뒤 뺄 수 있어요']) {
    assert.match(dialog, new RegExp(label));
  }
  assert.match(dialog, /type="number"/);
  assert.match(dialog, /min="1"/);
  assert.match(dialog, /step="1"/);
  assert.match(dialog, /inputMode="numeric"/);
  assert.match(dialog, /aria-live="polite"/);
  assert.doesNotMatch(dialog, /applyMarketCommand/);
});

test('point transfer revalidates before one request id and blocks duplicate submission', () => {
  const dialogPath = 'src/views/playground/market/PointTransferDialog.tsx';
  assert.equal(existsSync(dialogPath), true, 'PointTransferDialog must exist');
  const source = readFileSync(dialogPath, 'utf8');
  const start = source.indexOf('const submitTransfer');
  const end = source.indexOf('const closeTransferDialog', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);

  const latestSnapshot = handler.indexOf('useMarketPreviewStore.getState().visible');
  const validate = handler.indexOf('validateMarketCommand');
  const createRequestId = handler.indexOf('crypto.randomUUID()');
  const execute = handler.indexOf('await execute(command)');
  assert.ok(latestSnapshot >= 0 && latestSnapshot < validate);
  assert.ok(validate < createRequestId && createRequestId < execute);
  assert.equal((handler.match(/await execute\(command\)/g) ?? []).length, 1);
  assert.match(handler, /submitLockRef\.current/);
  assert.match(handler, /submitting/);
  assert.match(handler, /mutating/);

  const closeStart = source.indexOf('const closeTransferDialog');
  const closeEnd = source.indexOf('\n  };', closeStart);
  assert.ok(closeStart >= 0 && closeEnd > closeStart);
  assert.match(source.slice(closeStart, closeEnd), /submitting\s*\|\|\s*mutating/);
  assert.match(source, /submitting\s*\|\|\s*mutating\s*\?\s*confirmed\s*\?\?\s*visible\s*:\s*visible/);
});

test('point transfer only shows a projected balance for a valid amount', () => {
  const source = readFileSync('src/views/playground/market/PointTransferDialog.tsx', 'utf8');
  assert.match(
    source,
    /const resultBalance = summary\s*&&\s*validation === null\s*&&\s*amountIsValidInteger/,
  );
});

test('point transfer failure keeps its inline error and also raises a global toast', () => {
  const source = readFileSync('src/views/playground/market/PointTransferDialog.tsx', 'utf8');
  assert.match(source, /import \{ toast \} from 'sonner';/);

  const submitStart = source.indexOf('const submitTransfer');
  const closeStart = source.indexOf('const closeTransferDialog', submitStart);
  assert.ok(submitStart >= 0 && closeStart > submitStart);
  const submitHandler = source.slice(submitStart, closeStart);
  const failureStart = submitHandler.indexOf('if (succeeded)');
  assert.ok(failureStart >= 0);
  const failurePath = submitHandler.slice(failureStart);

  assert.equal((failurePath.match(/const message\s*=/g) ?? []).length, 1);
  assert.match(failurePath, /const message\s*=\s*useMarketPreviewStore\.getState\(\)\.error/);
  assert.match(failurePath, /setLocalError\(message\)/);
  assert.match(failurePath, /toast\.error\(message\)/);
  assert.ok(failurePath.indexOf('setLocalError(message)') < failurePath.indexOf('toast.error(message)'));
  assert.match(source, /aria-live="polite"[\s\S]*\{displayedError \?\? ''\}/);
});

test('allowed point transfer close clears local and shared errors while blocked close stays open', async () => {
  const helperPath = 'src/views/playground/market/pointTransferDialogState.ts';
  assert.equal(existsSync(helperPath), true, 'executable point transfer close helper must exist');
  const { requestPointTransferDialogClose } = await import(
    '../src/views/playground/market/pointTransferDialogState.ts'
  );
  const source = readFileSync('src/views/playground/market/PointTransferDialog.tsx', 'utf8');
  const allowedEvents: string[] = [];

  const allowed = requestPointTransferDialogClose({
    blocked: false,
    setLocalError: (message) => allowedEvents.push(`local:${String(message)}`),
    clearError: () => allowedEvents.push('store:clear'),
    onClose: () => allowedEvents.push('dialog:close'),
  });
  assert.equal(allowed, true);
  assert.deepEqual(allowedEvents, ['local:null', 'store:clear', 'dialog:close']);

  const blockedEvents: string[] = [];
  const blocked = requestPointTransferDialogClose({
    blocked: true,
    setLocalError: (message) => blockedEvents.push(`local:${String(message)}`),
    clearError: () => blockedEvents.push('store:clear'),
    onClose: () => blockedEvents.push('dialog:close'),
  });
  assert.equal(blocked, false);
  assert.deepEqual(blockedEvents, ['local:포인트 이동이 끝날 때까지 잠시 기다려 주세요.']);

  const submitStart = source.indexOf('const submitTransfer');
  const closeStart = source.indexOf('const closeTransferDialog', submitStart);
  const successStart = source.indexOf('if (succeeded)', submitStart);
  assert.ok(submitStart >= 0 && successStart > submitStart && closeStart > successStart);
  const successClose = source.slice(successStart, closeStart);
  assert.match(successClose, /requestPointTransferDialogClose\(/);
  assert.doesNotMatch(successClose, /\bonClose\(\)/);

  const closeEnd = source.indexOf('\n  };', closeStart);
  assert.ok(closeEnd > closeStart);
  assert.match(source.slice(closeStart, closeEnd), /requestPointTransferDialogClose\(/);
});
