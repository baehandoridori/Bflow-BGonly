import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('playground market v3 release metadata stays aligned', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const updateNotes = JSON.parse(readFileSync('DEVLOG/update-notes.json', 'utf8'));

  assert.equal(packageJson.version, '1.87.0');
  assert.equal(packageLock.version, '1.87.0');
  assert.equal(packageLock.packages[''].version, '1.87.0');
  assert.equal(packageJson.dependencies['lightweight-charts'], '5.2.0');
  assert.equal(packageLock.packages[''].dependencies['lightweight-charts'], '5.2.0');
  assert.deepEqual(
    updateNotes.slice(0, 4).map((note: { version: string }) => note.version),
    ['1.87.0', '1.86.0', '1.85.0', '1.84.0'],
  );

  // 최신 릴리스(1.87.0)는 테트리스 플레이 + 게임별 순위표 + 신기록 슬랙 토글.
  assert.equal(updateNotes[0].version, '1.87.0');

  // 모의투자 시장 v3 릴리스(1.82.0) 메타데이터는 그대로 유지돼야 한다.
  const marketNote = updateNotes.find((note: { version: string }) => note.version === '1.82.0');
  assert.ok(marketNote, '1.82.0 market release note must remain');
  assert.equal(marketNote.version, '1.82.0');
  assert.equal(marketNote.title, 'JBBJ 모의투자가 더 쉽고 실제 시장처럼 움직여요');
  const releaseCopy = marketNote.items
    .flatMap((item: { summary: string; description: string }) => [item.summary, item.description])
    .join('\n');
  for (const phrase of [
    '양방향 빠른주문',
    '휠',
    '드래그',
    '핀치',
    '거래량',
    '장 전체',
    '업종',
    '종목',
    '덜 인위',
  ]) {
    assert.match(releaseCopy, new RegExp(phrase));
  }

  assert.deepEqual(updateNotes.find((note: { version: string }) => note.version === '1.80.0'), {
    version: '1.80.0',
    title: 'JBBJ 모의투자가 실제 시장처럼 움직여요',
    items: [
      {
        category: 'feature',
        summary: '실시간 선·캔들 차트로 시세 흐름을 살펴봐요',
        description: '배한솔 테스트 계정에서 움직이는 시세를 선 또는 캔들로 바꿔 보고, 여러 시간 간격과 기간을 선택해 시장 흐름을 천천히 익힐 수 있어요. 다른 팀원에게는 아직 공개되지 않아요.',
      },
      {
        category: 'ux',
        summary: '1주부터 쉽게 주문하고 매수·매도 버튼을 놓치지 않아요',
        description: '배한솔 테스트 계정에서 1주·5주·10주 단위로 주문할 수 있고, 화면을 내려도 매수·매도 조작부가 따라와요. 작은 화면에서는 아래쪽에 편하게 고정돼요.',
      },
      {
        category: 'stability',
        summary: '백만 포인트로 시작한 테스트 계좌 상태가 유지돼요',
        description: '배한솔 테스트 계정에 처음 한 번만 백만 포인트가 지급되고, 증권계좌로 옮긴 금액과 보유 종목·거래 결과가 앱을 다시 열어도 유지돼요.',
      },
      {
        category: 'ux',
        summary: '화면과 마우스의 뒤로가기를 편하게 써요',
        description: '배한솔 테스트 계정에서 화면 안의 뒤로가기 버튼과 마우스 뒤로가기가 같은 순서로 작동해, 종목·계좌·시장 사이를 더 쉽게 오갈 수 있어요.',
      },
    ],
  });
});

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

test('destination returns use the common history Back while lobby and house cards retain origin wipes', () => {
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
  assert.match(playground, /route\.kind === 'house'[\s\S]*?onBack:\s*requestBack/);
  assert.match(playground, /returnLabel=\{route\.returnTo === 'house' \? 'JBBJ 하우스' : '게임 로비'\}/);
  assert.match(playground, /onBack=\{requestBack\}/);
  assert.match(playground, /<MarketRouter[\s\S]*?onBack=\{requestBack\}/);
  assert.match(house, /pointFromButtonActivation\(event\)/);
  assert.match(comingSoon, /onClick=\{onBack\}/);
  assert.match(marketNav, /onClick=\{onBack\}/);
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

test('stock detail merges company price change and reason before chart, holding and news', () => {
  const source = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');
  const sections = ['summary', 'chart', 'holding', 'news'];
  const positions = sections.map((section) => source.indexOf(`data-market-detail-section="${section}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  const orderAside = source.indexOf('aria-labelledby="easy-order-heading"');
  assert.ok(positions.at(-1)! < orderAside, 'desktop sidebar must follow all left-column content in DOM order');
  for (const label of ['오늘 움직인 이유', '가격 그래프', '내 보유 상태', '빠른주문', '최근 소식']) {
    assert.match(source, new RegExp(label));
  }
  assert.doesNotMatch(source, /aria-label="회사 한 줄 설명"|aria-label="현재 가격과 오늘의 변화"/);
  for (const forbidden of ['PER', 'PBR', '체결 강도', '호가창']) assert.doesNotMatch(source, new RegExp(forbidden));
});

test('home rows and detail consume the shared engine quote context instead of seed history', () => {
  const router = readFileSync('src/views/playground/market/MarketRouter.tsx', 'utf8');
  const home = readFileSync('src/views/playground/market/MarketHome.tsx', 'utf8');
  const rows = readFileSync('src/views/playground/market/MarketRows.tsx', 'utf8');
  const detail = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');
  const seed = readFileSync('src/features/playground/market/seed.ts', 'utf8');

  assert.equal((router.match(/buildMarketQuoteContext\(/g) ?? []).length, 1);
  assert.match(home, /quoteContext/);
  assert.match(rows, /sparklineByStockId/);
  assert.match(detail, /previousCloseWonByStockId/);
  assert.doesNotMatch(rows, /todaySeriesAtQuote|stock\.series\.today/);
  assert.doesNotMatch(home, /stock\.series\.|stock\.previousCloseWon/);
  assert.doesNotMatch(detail, /stock\.series\.|stock\.previousCloseWon/);
  assert.match(seed, /fallback/i);
  assert.doesNotMatch(seed, /getStockQuote/);
});

test('market dialog is portalled, labelled, inert and focus-safe', () => {
  const source = readFileSync('src/views/playground/market/MarketActionDialog.tsx', 'utf8');
  const orderPanel = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');
  assert.match(source, /createPortal/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /\.inert\s*=\s*true/);
  assert.match(source, /document\.body\.style\.overflow/);
  assert.match(source, /document\.body\.style\.overflow\s*=\s*['"]hidden['"]/);
  assert.match(source, /document\.body\.style\.overflow\s*=\s*previousBodyOverflow/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /usePlaygroundBackInterceptor/);
  assert.match(source, /FOCUSABLE_SELECTOR/);
  assert.match(source, /presentation === 'sheet'/);
  assert.match(source, /initialFocusFallbackId/);
  assert.match(source, /const activeControl = active instanceof HTMLElement[\s\S]*?controls\.includes\(active\)/);
  assert.match(source, /if \(activeControl === null\)/);
  assert.match(source, /if \(controls\.length === 0\)[\s\S]*?panel\.focus\(\)/);
  assert.match(source, /\(event\.shiftKey \? last : first\)\.focus\(\)/);
  assert.match(source, /activeControl === first[\s\S]*?last\.focus\(\)/);
  assert.match(source, /activeControl === last[\s\S]*?first\.focus\(\)/);
  assert.match(source, /aria-label="대화상자 닫기"/);
  assert.match(orderPanel, /<fieldset[\s\S]*?disabled=\{controller\.controlsDisabled\}/);

  const enabledControlsSource = source.slice(
    source.indexOf('function enabledControls'),
    source.indexOf('function canReceiveProgrammaticFocus'),
  );
  assert.match(enabledControlsSource, /!element\.matches\(':disabled'\)/);

  const restoreFocusSource = source.slice(
    source.indexOf('const RESTORE_FOCUS_FALLBACK_IDS'),
    source.indexOf('export function MarketActionDialog'),
  );
  for (const fallbackId of ['easy-order-heading', 'market-order-quantity', 'market-page-title']) {
    assert.match(restoreFocusSource, new RegExp(`['"]${fallbackId}['"]`));
  }
  assert.match(restoreFocusSource, /document\.contains\(element\)/);
  assert.match(restoreFocusSource, /!element\.matches\(':disabled'\)/);
  assert.match(restoreFocusSource, /canRestoreDialogFocus\(opener\)/);
  assert.match(restoreFocusSource, /target\?\.focus\(\)/);
  assert.match(source, /restoreDialogFocus\(openerRef\.current, previouslyFocused\)/);
});

test('global order toaster is portalled beyond the dialog inert root boundary', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const dialog = readFileSync('src/views/playground/market/MarketActionDialog.tsx', 'utf8');
  const order = readFileSync('src/views/playground/market/useMarketOrderController.ts', 'utf8');
  const orderDialogs = readFileSync('src/views/playground/market/MarketOrderDialogs.tsx', 'utf8');

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
  assert.match(orderDialogs, /aria-live="polite"/);
  assert.match(order, /confirmDisabledReason/);
  assert.match(orderDialogs, /controller\.error \?\? controller\.confirmDisabledReason \?\? ''/);
  assert.match(orderDialogs, /id="market-confirm-disabled-reason"/);
  assert.match(orderDialogs, /aria-describedby="market-confirm-disabled-reason"/);
});

test('detail chart and order panel keep the approved source contracts', () => {
  const chart = readFileSync('src/views/playground/market/MarketPriceChart.tsx', 'utf8');
  const interactivePath = 'src/views/playground/market/MarketInteractiveChart.tsx';
  assert.equal(existsSync(interactivePath), true, 'Lightweight Charts React boundary must exist');
  const interactive = readFileSync(interactivePath, 'utf8');
  const order = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');
  const controller = readFileSync('src/views/playground/market/useMarketOrderController.ts', 'utf8');
  for (const label of ['선', '캔들', '1분', '5분', '10분', '15분', '1시간', '1일', '오늘', '1주', '1개월', '6개월', '전체', '가격 정보가 아직 없어요']) {
    assert.match(chart, new RegExp(label));
  }
  assert.match(chart, /MarketInteractiveChart/);
  assert.match(chart, /buildMarketDisplayCandles/);
  assert.match(interactive, /createMarketChartAdapter/);
  assert.match(interactive, /차트를 불러오지 못했어요/);
  assert.match(interactive, /차트 다시 불러오기/);
  assert.equal(existsSync('src/views/playground/market/MarketChartCanvas.tsx'), false);
  assert.doesNotMatch(interactive, /<canvas|type="range"|onPointerMove|nearestMarketCandleIndex/);
  assert.doesNotMatch(chart, /#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(interactive, /#[0-9a-f]{3,8}/i);

  for (const label of [
    '몇 주 주문할까요?', '1주', '5주', '10주', '최대',
    '판매 가능', '구매 가능', '판매 예상 금액', '구매 예상 금액',
    '현재가 팔기', '현재가 사기', '내 주식 평균', '현재 손익', '보유 수량', '현재 평가금',
  ]) {
    assert.match(order, new RegExp(label));
  }
  for (const removed of ['현재 가격으로 바로 사기', '직접 입력', '원하는 가격에 주문하기', '지정가 주문']) {
    assert.doesNotMatch(order, new RegExp(removed));
  }
  assert.match(controller, /MARKET_SHARE_CHOICES\s*=\s*\[1,\s*5,\s*10,\s*'max'\]/);
  assert.match(controller, /quantityInput/);
  assert.match(controller, /setQuantityInput/);
  assert.match(controller, /validateMarketCommand/);
  assert.match(controller, /maxBuyableShares/);
  assert.match(order, /formatWon/);
  assert.match(order, /formatShares/);
  assert.doesNotMatch(order, /getBuyProjection|SHARE_SCALE|ratioBps|quantityMicros|pricePoints/);
  assert.doesNotMatch(order, /applyMarketCommand/);
});

test('stock detail and router switch at 1280px between fluid plus 360px and the fixed dock', () => {
  const source = readFileSync('src/views/playground/market/StockDetailView.tsx', 'utf8');
  const router = readFileSync('src/views/playground/market/MarketRouter.tsx', 'utf8');
  const dock = readFileSync('src/views/playground/market/MarketMobileOrderDock.tsx', 'utf8');
  assert.match(source, /xl:max-w-\[1200px\]/);
  assert.match(source, /xl:grid-cols-\[minmax\(0,1fr\)_360px\]/);
  assert.match(source, /xl:gap-x-6/);
  assert.match(source, /pb-\[calc\([^\]]*env\(safe-area-inset-bottom\)[^\]]*\)\]/);
  assert.match(router, /matchMedia\(['"]\(min-width: 1280px\)['"]\)/);
  assert.match(dock, /grid-cols-2/);
  assert.match(dock, /safe-area-inset-(?:left|right|bottom)/);
  assert.match(dock, /role="status"/);
  assert.match(dock, /aria-describedby=\{disabledReason/);
});

test('mobile order sheet uses the shared panel and preferred side only for description and focus', () => {
  const dialogs = readFileSync('src/views/playground/market/MarketOrderDialogs.tsx', 'utf8');
  const actionDialog = readFileSync('src/views/playground/market/MarketActionDialog.tsx', 'utf8');

  assert.equal((dialogs.match(/<MarketOrderPanel\b/g) ?? []).length, 1);
  assert.match(dialogs, /controller\.side === 'sell'/);
  assert.match(dialogs, /initialFocusId=\{controller\.surface === 'mobile-order'/);
  assert.match(dialogs, /initialFocusFallbackId=\{controller\.surface === 'mobile-order'/);
  assert.match(dialogs, /presentation=\{controller\.surface === 'mobile-order' \? 'sheet' : 'dialog'\}/);
  assert.match(dialogs, /market-order-sell-action/);
  assert.match(dialogs, /market-order-buy-action/);
  assert.match(dialogs, /market-order-sell-reason/);
  assert.match(dialogs, /market-order-buy-reason/);
  assert.match(actionDialog, /initialFocusId/);
  assert.match(actionDialog, /initialFocusFallbackId/);
  assert.match(actionDialog, /document\.getElementById\(initialFocusId\)/);
  assert.match(actionDialog, /document\.getElementById\(initialFocusFallbackId\)/);
  assert.match(actionDialog, /const sheetBackdropClass = ['"][^'"]*items-end[^'"]*xl:items-center/);
  assert.match(actionDialog, /const sheetPanelClass = ['"][^'"]*rounded-t-3xl[^'"]*safe-area-inset-bottom[^'"]*xl:rounded-3xl/);

  const panel = readFileSync('src/views/playground/market/MarketOrderPanel.tsx', 'utf8');
  assert.match(panel, /id="market-order-sell-reason"[\s\S]*?tabIndex=\{-1\}/);
  assert.match(panel, /id="market-order-buy-reason"[\s\S]*?tabIndex=\{-1\}/);
});

test('easy order revalidates frozen confirmation before creating a request id', () => {
  const source = readFileSync('src/views/playground/market/useMarketOrderController.ts', 'utf8');
  const start = source.indexOf('const confirm = async');
  const end = source.indexOf('const close', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);

  const latestSnapshot = handler.indexOf('useMarketPreviewStore.getState().visible');
  const validate = handler.indexOf('validateMarketCommand');
  const createRequestId = handler.indexOf('crypto.randomUUID()');
  const execute = handler.indexOf('await execute(command, command.quotedPriceWon)');
  assert.ok(latestSnapshot >= 0 && latestSnapshot < validate);
  assert.ok(validate < createRequestId && createRequestId < execute);
  assert.match(handler, /freezeMarketOrder/);
  assert.match(handler, /frozenOrdersMatch/);
  assert.match(handler, /다시 확인해 주세요/);
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
  const source = readFileSync('src/views/playground/market/useMarketOrderController.ts', 'utf8');
  const dialogs = readFileSync('src/views/playground/market/MarketOrderDialogs.tsx', 'utf8');
  const start = source.indexOf('const close =');
  const end = source.indexOf('\n  };', start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /pendingOrder/);
  assert.match(handler, /pendingValueCommand/);
  assert.match(handler, /주문 저장이 끝날 때까지/);
  assert.match(dialogs, /onClose=\{controller\.close\}/);
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
  assert.match(source.slice(closeStart, closeEnd), /pendingTransfer\s*\|\|\s*pendingValueCommand/);
  assert.match(source.slice(closeStart, closeEnd), /submitting\s*\|\|\s*mutating\s*\|\|\s*loading/);
  assert.match(source, /submitting\s*\|\|\s*mutating\s*\|\|\s*pendingResolution/);
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
  assert.match(failurePath, /const message\s*=\s*latestState\.error/);
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
