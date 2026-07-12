import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import type { MarketAdminEvent } from '../src/features/playground/market/types.ts';

test('stock detail uses the approved 1280px two-column layout with a scrollable sticky order card', () => {
  const source = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');

  assert.match(source, /xl:grid-cols-\[minmax\(0,1fr\)_360px\]/);
  assert.match(source, /grid-template-areas:[^\n]*'summary_order'/);
  assert.match(source, /xl:sticky/);
  assert.match(source, /xl:top-/);
  assert.match(source, /xl:max-h-\[calc\(100dvh-/);
  assert.match(source, /xl:overflow-y-auto/);
  assert.match(source, /pb-\[calc\([^\]]*env\(safe-area-inset-bottom\)[^\]]*\)\]/);
});

test('market router mounts one controller and keeps the mobile dock outside its scroll container', () => {
  const router = readFileSync('src/views/playground/market/MarketRouter.tsx', 'utf8');
  const dockPath = 'src/views/playground/market/MarketMobileOrderDock.tsx';
  const dialogPath = 'src/views/playground/market/MarketOrderDialogs.tsx';

  assert.equal(existsSync(dockPath), true, 'mobile order dock must exist');
  assert.equal(existsSync(dialogPath), true, 'one shared order dialog host must exist');
  assert.equal((router.match(/useMarketOrderController\(/g) ?? []).length, 1);
  assert.equal((router.match(/<MarketOrderDialogs\b/g) ?? []).length, 1);
  assert.equal((router.match(/<MarketMobileOrderDock\b/g) ?? []).length, 1);
  assert.match(router, /data-market-scroll-container/);
  assert.match(router, /data-market-scroll-container[\s\S]*?<\/div>\s*\{!desktopOrderLayout && <MarketMobileOrderDock/);

  const dock = existsSync(dockPath) ? readFileSync(dockPath, 'utf8') : '';
  const sell = dock.indexOf('현재가 팔기');
  const buy = dock.indexOf('현재가 사기');
  assert.ok(sell >= 0 && sell < buy, 'mobile dock must keep sell before buy');
  assert.match(dock, /controller\.openSheet\(event\.currentTarget,\s*'sell'\)/);
  assert.match(dock, /controller\.openSheet\(event\.currentTarget,\s*'buy'\)/);
  assert.match(dock, /fixed/);
  assert.match(dock, /xl:hidden/);
  assert.match(dock, /safe-area-inset-bottom/);
  assert.match(dock, /min-h-11/);

  const dialogs = readFileSync(dialogPath, 'utf8');
  const actionDialog = readFileSync('src/views/playground/market/MarketActionDialog.tsx', 'utf8');
  assert.match(dialogs, /focusKey=\{controller\.surface/);
  assert.match(actionDialog, /focusKey/);
});

test('xl transition retargets dialog focus before closing an open mobile order surface', () => {
  const router = readFileSync('src/views/playground/market/MarketRouter.tsx', 'utf8');
  const detail = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');
  const effectStart = router.indexOf('previousDesktopOrderLayout');
  const effectEnd = router.indexOf('\n  },', effectStart);
  assert.ok(effectStart >= 0 && effectEnd > effectStart);
  const transitionEffect = router.slice(effectStart, effectEnd);
  const retarget = transitionEffect.indexOf('controller.openerRef.current');
  const close = transitionEffect.indexOf('controller.close()');
  assert.ok(retarget >= 0 && retarget < close, 'focus target must change before dialog close');
  assert.match(transitionEffect, /easy-order-heading|market-page-title/);
  assert.match(detail, /id="easy-order-heading"[^>]*tabIndex=\{-1\}/);
});

test('desktop and mobile order surfaces share one labelled quantity input and exact presets', () => {
  const source = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');
  const controller = readFileSync('src/views/playground/market/useMarketOrderController.ts', 'utf8');

  assert.match(controller, /MARKET_SHARE_CHOICES\s*=\s*\[1,\s*5,\s*10,\s*'max'\]/);
  for (const label of ['1주', '5주', '10주', '최대']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /<label htmlFor="market-order-quantity"/);
  assert.match(source, /id="market-order-quantity"/);
  assert.match(source, /controller\.setQuantityInput\(event\.target\.value\)/);
  assert.match(source, /controller\.stepQuantity\(-1\)/);
  assert.match(source, /controller\.stepQuantity\(1\)/);
  assert.match(source, /aria-label=\{choice === 'max' \? '구매 가능한 최대'/);
  assert.doesNotMatch(source, /직접 입력|choice === 'custom'|selectSide\(/);
  for (const legacy of ['100P', '500P', '1,000P', '전부', '25%', '50%', '100%']) {
    assert.doesNotMatch(source, new RegExp(legacy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(source, /useMarketOrderController\(|useMarketPreviewStore/);
});

test('quick order panel keeps the approved information order and independent side actions', () => {
  const source = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');
  const sections = ['quote', 'quantity', 'presets', 'availability', 'estimates', 'actions', 'holding', 'note'];
  const positions = sections.map((section) => source.indexOf(`data-market-order-section="${section}"`));
  assert.ok(positions.every((position) => position >= 0), 'every quick-order section must be marked');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);

  for (const label of [
    '현재 가격', '예수금', '판매 가능', '구매 가능', '판매 예상 금액', '구매 예상 금액',
    '현재가 팔기', '현재가 사기', '내 주식 평균', '현재 손익', '보유 수량', '현재 평가금',
    '아직 보유한 주식이 없어요', '실제 주문 전에는 현재 가격과 수량을 한 번 더 확인합니다.',
  ]) assert.match(source, new RegExp(label));

  assert.match(source, /id="market-order-sell-action"[\s\S]*?disabled=\{controller\.controlsDisabled\s*\|\|\s*controller\.validationBySide\.sell !== null\}/);
  assert.match(source, /id="market-order-buy-action"[\s\S]*?disabled=\{controller\.controlsDisabled\s*\|\|\s*controller\.validationBySide\.buy !== null\}/);
  assert.match(source, /controller\.openConfirmation\('sell',\s*event\.currentTarget\)/);
  assert.match(source, /controller\.openConfirmation\('buy',\s*event\.currentTarget\)/);
  assert.match(source, /aria-describedby="market-order-sell-reason"/);
  assert.match(source, /aria-describedby="market-order-buy-reason"/);
  assert.match(source, /bg-market-down/);
  assert.match(source, /bg-market-up/);
  assert.doesNotMatch(source, /openLimit|원하는 가격에 주문하기|지정가 주문|bg-accent\b/);
});

test('one quantity builds independent buy and sell validation and the stepper never drops below one share', async () => {
  const controller = await import('../src/views/playground/market/useMarketOrderController.ts');
  assert.equal(typeof controller.getMarketOrderPreviewState, 'function');
  assert.equal(typeof controller.stepMarketQuantityInput, 'function');
  assert.equal(typeof controller.resolveMarketShareChoiceQuantity, 'function');

  const { createMarketPreviewSeed } = await import(
    '../src/features/playground/market/seed.ts'
  );
  const snapshot = createMarketPreviewSeed();
  snapshot.account.cashWon = 10_000;
  snapshot.account.holdings = [{ stockId: 'jbbj', quantityShares: 1, costBasisWon: 1_700 }];
  const stock = snapshot.stocks.find((item) => item.id === 'jbbj')!;
  const holdingLimited = controller.getMarketOrderPreviewState({
    snapshot, stock, quantityShares: 2, quotedPriceWon: 1_842,
  });

  assert.equal(holdingLimited.previewBySide.buy.quantityShares, 2);
  assert.equal(holdingLimited.previewBySide.sell.quantityShares, 2);
  assert.equal(holdingLimited.validationBySide.buy, null);
  assert.equal(holdingLimited.validationBySide.sell, '보유 주식 수량이 부족해요');
  assert.equal(holdingLimited.availableBuyShares, 5);
  assert.equal(holdingLimited.availableSellShares, 1);

  snapshot.account.cashWon = 1_000;
  snapshot.account.holdings = [{ stockId: 'jbbj', quantityShares: 5, costBasisWon: 8_500 }];
  const cashLimited = controller.getMarketOrderPreviewState({
    snapshot, stock, quantityShares: 2, quotedPriceWon: 1_842,
  });
  assert.equal(cashLimited.validationBySide.buy, '예수금이 부족해요');
  assert.equal(cashLimited.validationBySide.sell, null);

  assert.equal(controller.stepMarketQuantityInput('1', -1), '1');
  assert.equal(controller.stepMarketQuantityInput('2', -1), '1');
  assert.equal(controller.stepMarketQuantityInput('1', 1), '2');
  assert.equal(controller.stepMarketQuantityInput('', -1), '1');
  assert.equal(controller.resolveMarketShareChoiceQuantity('max', 5), 5);
  assert.equal(controller.resolveMarketShareChoiceQuantity('max', 0), 1);
  assert.equal(controller.resolveMarketShareChoiceQuantity(10, 5), 10);
});

test('shared max always means max buyable and opening either sheet side preserves the common quantity', async () => {
  const controller = await import('../src/views/playground/market/useMarketOrderController.ts');
  assert.equal(controller.resolveMarketShareChoiceQuantity('max', 5), 5);
  assert.equal(controller.resolveMarketShareChoiceQuantity('max', 9), 9);
  assert.equal('transitionMarketOrderSide' in controller, false);

  const source = readFileSync('src/views/playground/market/useMarketOrderController.ts', 'utf8');
  const openSheetSource = source.slice(
    source.indexOf('const openSheet ='),
    source.indexOf('const openConfirmation ='),
  );
  assert.match(openSheetSource, /setSide\(preferredSide \?\? side\)/);
  assert.doesNotMatch(openSheetSource, /setQuantityInputState|applySideChange|transitionMarketOrderSide/);
  const controllerInterface = source.slice(
    source.indexOf('export interface MarketOrderController'),
    source.indexOf('function safeOrderTotal'),
  );
  for (const legacyAlias of [
    /\n\s+choice:/,
    /customSharesInput:/,
    /frozenPreview:/,
    /\n\s+validation:/,
    /selectSide\(/,
    /setCustomSharesInput\(/,
  ]) assert.doesNotMatch(controllerInterface, legacyAlias);
  assert.equal((controllerInterface.match(/openSheet\(/g) ?? []).length, 1);
  assert.equal((controllerInterface.match(/openConfirmation\(/g) ?? []).length, 1);
});

test('order controller freezes snapshot revision with the quote, revalidates drift, blocks halts and creates one request id', async () => {
  const helperPath = 'src/views/playground/market/useMarketOrderController.ts';
  assert.equal(existsSync(helperPath), true, 'shared order controller must exist');
  const source = readFileSync(helperPath, 'utf8');

  for (const field of [
    'side',
    'quantityShares',
    'quotedPriceWon',
    'quotedRevision',
    'estimatedTotalWon',
    'availableCashWon',
    'availableShares',
  ]) assert.match(source, new RegExp(field));
  assert.match(source, /maxBuyableShares/);
  assert.match(source, /isStockTradingHalted/);
  assert.match(source, /다시 확인/);
  assert.equal((source.match(/crypto\.randomUUID\(\)/g) ?? []).length, 1);
  assert.equal((source.match(/await execute\(/g) ?? []).length, 1);
  const failurePath = source.slice(source.indexOf('const succeeded = await execute'));
  const failedOrderOnly = failurePath.slice(
    failurePath.indexOf('const message'),
    failurePath.indexOf('const close'),
  );
  assert.match(failedOrderOnly, /latestState\.error/);
  assert.match(failedOrderOnly, /다시 확인해 주세요/);
  assert.doesNotMatch(failedOrderOnly, /setSurface\(null\)/);

  const { freezeMarketOrder, frozenOrdersMatch, isStockTradingHalted } = await import(
    '../src/views/playground/market/useMarketOrderController.ts'
  );
  const { createMarketPreviewSeed } = await import(
    '../src/features/playground/market/seed.ts'
  );
  const snapshot = createMarketPreviewSeed();
  snapshot.account.cashWon = 10_000;
  snapshot.account.holdings = [{ stockId: 'jbbj', quantityShares: 7, costBasisWon: 7_000 }];
  const stock = snapshot.stocks.find((item) => item.id === 'jbbj')!;

  assert.deepEqual(freezeMarketOrder({
    snapshot,
    stock,
    side: 'buy',
    quantityShares: 3,
    quotedPriceWon: 3_000,
  }), {
    side: 'buy',
    quantityShares: 3,
    quotedPriceWon: 3_000,
    quotedRevision: snapshot.revision,
    estimatedTotalWon: 9_000,
    availableCashWon: 10_000,
    availableShares: 7,
  });
  assert.deepEqual(freezeMarketOrder({
    snapshot,
    stock,
    side: 'sell',
    quantityShares: 7,
    quotedPriceWon: 3_000,
  }), {
    side: 'sell',
    quantityShares: 7,
    quotedPriceWon: 3_000,
    quotedRevision: snapshot.revision,
    estimatedTotalWon: 21_000,
    availableCashWon: 10_000,
    availableShares: 7,
  });
  const frozen = freezeMarketOrder({
    snapshot,
    stock,
    side: 'buy',
    quantityShares: 1,
    quotedPriceWon: 3_000,
  });
  assert.equal(frozenOrdersMatch(frozen, { ...frozen }), true);
  assert.equal(frozenOrdersMatch(frozen, { ...frozen, availableCashWon: 9_999 }), false);
  assert.equal(frozenOrdersMatch(frozen, { ...frozen, quotedRevision: frozen.quotedRevision + 1 }), false);
  assert.equal(freezeMarketOrder({
    snapshot, stock, side: 'sell', quantityShares: 2, quotedPriceWon: 3_000,
  }).side, 'sell');
  assert.equal(freezeMarketOrder({
    snapshot, stock, side: 'buy', quantityShares: 2, quotedPriceWon: 3_000,
  }).side, 'buy');
  const openConfirmationStart = source.indexOf('const openConfirmation =');
  const openConfirmationEnd = source.indexOf('\n  const confirm =', openConfirmationStart);
  const openConfirmationSource = source.slice(openConfirmationStart, openConfirmationEnd);
  assert.match(openConfirmationSource, /setSide\(nextSide\)/);
  assert.match(openConfirmationSource, /side:\s*nextSide/);
  assert.equal(isStockTradingHalted([{
    id: 'halt-live', stockId: 'jbbj', kind: 'halt', title: '점검', impactBps: 0,
    startsAt: '2026-07-11T00:00:00.000Z', endsAt: null, revision: 2,
  }], 'jbbj', Date.parse('2026-07-11T00:01:00.000Z')), true);
});

test('shared pending request helper preserves the exact command and frozen UI details', async () => {
  const helperPath = 'src/features/playground/market/pendingValueRequest.ts';
  assert.equal(existsSync(helperPath), true, 'shared pending value request helper must exist');
  const {
    createPendingMarketValueRequest,
    retryPendingMarketValueCommand,
  } = await import('../src/features/playground/market/pendingValueRequest.ts');
  const { fingerprintMarketCommand } = await import(
    '../src/features/playground/market/previewGateway.ts'
  );
  const command = {
    kind: 'buy', requestId: 'preserved-id', stockId: 'jbbj', quantityShares: 7,
    quotedPriceWon: 1_842, quotedRevision: 4,
  } as const;
  const details = { quantityShares: 7, quotedPriceWon: 1_842, label: '최대' };
  const pending = createPendingMarketValueRequest(command, details);
  const retry = retryPendingMarketValueCommand(pending);

  assert.deepEqual(retry, command);
  assert.notEqual(retry, command);
  assert.deepEqual(pending.details, details);
  assert.equal(pending.fingerprint, fingerprintMarketCommand(command));
  assert.notEqual(
    fingerprintMarketCommand(command),
    fingerprintMarketCommand({ ...command, quotedRevision: command.quotedRevision + 1 }),
  );
});

test('order and point transfer use one pending lifecycle instead of minting retry ids', () => {
  const controller = readFileSync('src/views/playground/market/useMarketOrderController.ts', 'utf8');
  const dialogs = readFileSync('src/views/playground/market/MarketOrderDialogs.tsx', 'utf8');
  const transfer = readFileSync('src/views/playground/market/PointTransferDialog.tsx', 'utf8');
  const account = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  for (const source of [controller, transfer]) {
    assert.match(source, /createPendingMarketValueRequest/);
    assert.match(source, /retryPendingMarketValueCommand/);
    assert.match(source, /pendingValueCommand/);
    assert.match(source, /다시 불러/);
  }
  assert.match(dialogs, /주문 결과 다시 확인/);
  assert.match(transfer, /이동 결과 다시 확인/);
  assert.match(transfer, /const valueRefreshRequired = useMarketPreviewStore/);
  assert.match(transfer, /pendingTransfer\s*\|\|\s*pendingValueCommand\s*\|\|\s*valueRefreshRequired/);
  assert.match(transfer, /!pendingTransfer\s*&&\s*!valueRefreshRequired/);
  assert.match(transfer, /pendingResolution\s*\|\|\s*valueRefreshRequired/);
  assert.match(account, /const valueRefreshRequired = useMarketPreviewStore/);
  assert.match(account, /disabled=\{mutating\s*\|\|\s*valueRefreshRequired\}/);
  assert.match(account, /load\(sessionKey\s*\?\?\s*undefined\)/);
  assert.match(account, /최신 계좌 정보 다시 불러오기/);
});

test('authorized Hansol alone gets the compact market admin dialog', () => {
  const home = readFileSync('src/views/playground/market/MarketHome.tsx', 'utf8');
  const panelPath = 'src/views/playground/market/MarketAdminPanel.tsx';
  assert.equal(existsSync(panelPath), true, 'market admin panel must exist');
  const panel = existsSync(panelPath) ? readFileSync(panelPath, 'utf8') : '';

  assert.match(home, /authorizedHansol/);
  assert.match(home, /authorizedHansol\s*&&\s*\(/);
  assert.match(home, /<MarketAdminPanel/);
  assert.match(panel, /if \(!authorizedHansol\) return null/);
  assert.match(panel, /시장 관리/);
  for (const preset of ['호재 뉴스', '악재 뉴스', '상승 충격', '하락 충격', '상승 추세', '하락 추세', '거래 정지']) {
    assert.match(panel, new RegExp(preset));
  }
  for (const input of ['stockId', 'kind', 'title', 'impactBps', 'startsAt', 'endsAt', 'indefinite']) {
    assert.match(panel, new RegExp(input));
  }
  assert.match(panel, /saving/);
  assert.match(panel, /disabled=\{saving/);
  assert.match(panel, /효과 종료/);
  assert.match(panel, /기록도 삭제/);
  assert.match(panel, /adminWriteUncertain/);
  assert.match(panel, /시장 정보 다시 확인/);
  assert.match(panel, /load\(sessionKey/);
  assert.match(panel, /selectManageableMarketAdminEvents/);
  assert.match(panel, /row\.status === 'scheduled'/);
  assert.match(panel, /예정/);
  assert.match(panel, /formatMarketAdminEventStart/);
  assert.match(panel, /시간 확인 필요/);
  assert.match(
    panel,
    /manageableEvents\.map\(\(row\)[\s\S]*disabled=\{saving \|\| mutating \|\| adminWriteUncertain\}/,
  );
});

test('admin event selector keeps active and scheduled rows, drops expired rows, and leaves invalid rows deletable', async () => {
  const selectorPath = 'src/views/playground/market/marketAdminEventList.ts';
  assert.equal(existsSync(selectorPath), true, 'admin event list selector must exist');
  const {
    formatMarketAdminEventStart,
    selectManageableMarketAdminEvents,
  } = await import('../src/views/playground/market/marketAdminEventList.ts');
  const nowMs = Date.parse('2026-07-12T00:00:00.000Z');
  const event = (
    id: string,
    startsAt: string,
    endsAt: string | null,
  ): MarketAdminEvent => ({
    id,
    stockId: 'jbbj',
    kind: 'news',
    title: id,
    impactBps: 100,
    startsAt,
    endsAt,
    revision: 1,
  });
  const rows = selectManageableMarketAdminEvents([
    event('scheduled-late', '2026-07-12T03:00:00.000Z', '2026-07-12T04:00:00.000Z'),
    event('expired', '2026-07-11T20:00:00.000Z', '2026-07-12T00:00:00.000Z'),
    event('invalid-start', 'not-a-date', null),
    event('active-recent', '2026-07-11T23:00:00.000Z', '2026-07-12T01:00:00.000Z'),
    event('scheduled-early', '2026-07-12T01:00:00.000Z', null),
    event('active-old', '2026-07-11T22:00:00.000Z', null),
    event('invalid-end', '2026-07-12T02:00:00.000Z', 'bad-end'),
  ], nowMs);

  assert.deepEqual(rows.map((row) => [row.event.id, row.status]), [
    ['active-old', 'active'],
    ['active-recent', 'active'],
    ['scheduled-early', 'scheduled'],
    ['scheduled-late', 'scheduled'],
    ['invalid-end', 'invalid'],
    ['invalid-start', 'invalid'],
  ]);
  assert.equal(rows.some((row) => row.event.id === 'expired'), false);
  const scheduled = rows.find((row) => row.event.id === 'scheduled-early');
  assert.ok(scheduled && scheduled.startsAtMs !== null);
  assert.match(formatMarketAdminEventStart(scheduled.startsAtMs), /\d{1,2}:\d{2}/);
  assert.equal(formatMarketAdminEventStart(Number.NaN), '시간 확인 필요');
  assert.equal(formatMarketAdminEventStart(Number.MAX_VALUE), '시간 확인 필요');
});

test('market admin form enforces halt end-or-indefinite and preserves signed impact', async () => {
  const helperPath = 'src/views/playground/market/marketAdminEventForm.ts';
  assert.equal(existsSync(helperPath), true, 'admin event form helper must exist');
  const { buildMarketAdminEventInput } = await import(
    '../src/views/playground/market/marketAdminEventForm.ts'
  );

  const missingEnd = buildMarketAdminEventInput({
    stockId: 'jbbj', kind: 'halt', title: '점검', impactBpsInput: '0',
    startsAtInput: '2026-07-11T10:00', endsAtInput: '', indefinite: false,
  });
  assert.equal(missingEnd.input, null);
  assert.match(missingEnd.error ?? '', /종료 시간|무기한/);

  const trend = buildMarketAdminEventInput({
    stockId: 'jbbj', kind: 'trend', title: '천천히 하락', impactBpsInput: '-125',
    startsAtInput: '2026-07-11T10:00', endsAtInput: '2026-07-11T11:00', indefinite: false,
  });
  assert.equal(trend.error, null);
  assert.equal(trend.input?.impactBps, -125);
  assert.ok(trend.input?.startsAt.endsWith('Z'));
});

test('account and transfer explain point-to-won conversion and projected balances', () => {
  const account = readFileSync('src/views/playground/market/MarketAccountView.tsx', 'utf8');
  const transfer = readFileSync('src/views/playground/market/PointTransferDialog.tsx', 'utf8');

  assert.match(account, /max-w-\[520px\]/);
  assert.match(account, /1P = 1원/);
  assert.match(account, /아직 보유한 주식이 없어요/);
  assert.match(account, /종목 둘러보기/);
  for (const label of ['이동 후 예수금', '이동 후 포인트 지갑', 'formatWon', 'formatPoints']) {
    assert.match(transfer, new RegExp(label));
  }
});
