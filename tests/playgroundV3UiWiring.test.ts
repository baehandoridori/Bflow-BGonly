import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('Playground owns a local header and named inline-size container', () => {
  const shell = readFileSync('src/views/playground/PlaygroundShell.tsx', 'utf8');
  const header = readFileSync('src/views/playground/PlaygroundHeader.tsx', 'utf8');
  const css = readFileSync('src/views/playground/playground.css', 'utf8');
  assert.match(shell, /data-pg-shell/);
  assert.match(shell, /data-pg-surface/);
  assert.match(shell, /<PlaygroundHeader/);
  assert.match(header, /data-pg-header/);
  assert.match(header, /JBBJ 하우스/);
  assert.match(header, /ranking\.balanceLabel/);
  assert.match(header, /ranking\.rankLabel/);
  assert.match(css, /container:\s*playground\s*\/\s*inline-size/);
  assert.match(css, /@container playground \(max-width: 970px\)/);
  assert.match(css, /@container playground \(max-width: 619px\)/);
  assert.match(css, /min-height:\s*88px/);
  assert.match(css, /grid-template-areas:\s*"identity house"\s*"balance balance"/);
  assert.match(css, /\.pg-header__actions\s*{\s*display:\s*contents;/);
  assert.match(css, /\.pg-header__identity\s*{[^}]*grid-area:\s*identity/);
  assert.match(css, /\.pg-header__house\s*{[^}]*grid-area:\s*house/);
  assert.match(css, /\.pg-header__balance\s*{[^}]*grid-area:\s*balance/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('compact back control keeps an accessible name when its visible label is hidden', () => {
  const header = readFileSync('src/views/playground/PlaygroundHeader.tsx', 'utf8');
  assert.match(header, /className="pg-header__back"[^>]*aria-label=\{backLabel\}/);
});

test('compact back control keeps a 44 by 44 pixel target', () => {
  const css = readFileSync('src/views/playground/playground.css', 'utf8');
  assert.match(css, /\.pg-header__back\s*{[^}]*min-width:\s*44px/);
  assert.match(css, /\.pg-header__back,\s*\.pg-header__house\s*{[^}]*min-height:\s*44px/);
});

test('Korean header description and status copy never renders below 14 pixels', () => {
  const css = readFileSync('src/views/playground/playground.css', 'utf8');
  for (const selector of [
    '.pg-header__copy p',
    '.pg-header__online-copy',
    '.pg-header__balance span',
    '.pg-header__house strong',
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blocks = [...css.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))];
    const fontSizes = blocks.flatMap((block) => (
      [...block[1].matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]))
    ));
    assert.ok(fontSizes.length > 0, `${selector} must define a pixel font-size`);
    assert.ok(fontSizes.every((fontSize) => fontSize >= 14), `${selector} must stay at or above 14px`);
  }
});

test('A lobby keeps the approved hero, four quick cards, ranking rail and non-nested actions', () => {
  for (const file of [
    'src/views/playground/PlaygroundGameArt.tsx',
    'src/views/playground/PlaygroundRecommendationHero.tsx',
    'src/views/playground/PlaygroundGameCard.tsx',
    'src/views/playground/PlaygroundRankingRail.tsx',
  ]) {
    assert.equal(existsSync(file), true, `${file} must exist`);
  }

  const lobby = readFileSync('src/views/playground/PlaygroundLobby.tsx', 'utf8');
  const hero = readFileSync('src/views/playground/PlaygroundRecommendationHero.tsx', 'utf8');
  const card = readFileSync('src/views/playground/PlaygroundGameCard.tsx', 'utf8');
  const rail = readFileSync('src/views/playground/PlaygroundRankingRail.tsx', 'utf8');
  const css = readFileSync('src/views/playground/playground.css', 'utf8');

  assert.match(lobby, /data-pg-lobby/);
  assert.match(lobby, /QUICK_ENTRIES\.map/);
  assert.match(hero, /<section[^>]*data-pg-hero/);
  assert.match(hero, /바로 플레이/);
  assert.match(hero, /다른 추천/);
  assert.equal((hero.match(/<button\b/g) ?? []).length, 2);
  assert.doesNotMatch(hero, /<button[^>]*data-pg-hero/);
  assert.match(card, /<button[^>]*data-pg-quick-card/);
  assert.match(rail, /data-pg-ranking/);
  assert.match(rail, /JBBJ 하우스에서 진행 중/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1\.72fr\)\s+minmax\(220px,\s*\.68fr\)/);
  assert.match(css, /min-height:\s*240px/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@container playground \(max-width: 970px\)[\s\S]*?\.pg-quick-grid\s*{[^}]*repeat\(2,/);
  assert.match(css, /@container playground \(max-width: 619px\)[\s\S]*?\.pg-lobby\s*{[^}]*padding:\s*10px/);
});

test('only PlaygroundView may read auth and market stores', () => {
  for (const file of [
    'src/views/playground/PlaygroundLobby.tsx',
    'src/views/playground/PlaygroundRecommendationHero.tsx',
    'src/views/playground/PlaygroundGameCard.tsx',
    'src/views/playground/PlaygroundRankingRail.tsx',
    'src/views/playground/PlaygroundGameArt.tsx',
    'src/views/playground/playgroundActivation.ts',
  ]) {
    assert.equal(existsSync(file), true, `${file} must exist`);
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /useAuthStore|useMarketPreviewStore/, file);
  }
});

test('button activation preserves mouse coordinates and centers keyboard activation', async () => {
  const helperPath = 'src/views/playground/playgroundActivation.ts';
  assert.equal(existsSync(helperPath), true, 'shared Playground activation helper must exist');
  const helper = readFileSync(helperPath, 'utf8');
  assert.match(
    helper,
    /originFromActivation\(\s*event\.clientX,\s*event\.clientY,\s*event\.detail,\s*event\.currentTarget\.getBoundingClientRect\(\)/s,
  );
  const { originFromActivation } = await import(
    '../src/features/playground/transition/dotWipeMath.ts'
  );

  const rect = { left: 10, top: 20, width: 40, height: 30 };
  assert.deepEqual(originFromActivation(73, 91, 1, rect), { x: 73, y: 91 });
  assert.deepEqual(originFromActivation(0, 0, 0, rect), { x: 30, y: 35 });
});

test('lobby actions keep 44px targets, visible focus and Korean copy at 14px or larger', () => {
  const css = readFileSync('src/views/playground/playground.css', 'utf8');

  assert.match(
    css,
    /\.pg-hero__play,\s*\.pg-hero__shuffle\s*{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/,
  );
  assert.match(css, /\.pg-quick-card\s*{[^}]*min-height:\s*(?:1[0-9]{2}|[5-9][0-9])px/);
  assert.match(css, /\.pg-house-teaser\s*{[^}]*min-height:\s*(?:[5-9][0-9]|[1-9][0-9]{2,})px/);
  assert.match(css, /\.playground-shell button:focus-visible\s*{[^}]*outline:\s*3px solid/);

  for (const selector of [
    '.pg-rank-pill',
    '.pg-hero p',
    '.pg-quick-card > strong',
    '.pg-quick-card > span:last-child',
    '.pg-ranking__head h3',
    '.pg-ranking__head span',
    '.pg-wallet p',
    '.pg-ranking__list li',
    '.pg-house-teaser',
    '.pg-house-teaser small',
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blocks = [...css.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))];
    const fontSizes = blocks.flatMap((block) => (
      [...block[1].matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]))
    ));
    assert.ok(fontSizes.length > 0, `${selector} must define a pixel font-size`);
    assert.ok(fontSizes.every((fontSize) => fontSize >= 14), `${selector} must stay at or above 14px`);
  }
});

test('C house restores challenge, podium and exactly five dock entries', async () => {
  const house = readFileSync('src/views/playground/JbbjHouse.tsx', 'utf8');
  const { HOUSE_DOCK_ENTRIES } = await import('../src/features/playground/catalog.ts');

  assert.equal(HOUSE_DOCK_ENTRIES.length, 5);
  assert.match(house, /data-pg-house/);
  assert.match(house, /data-pg-challenge/);
  assert.match(house, /TEAM CHALLENGE/);
  assert.match(house, /68,400/);
  assert.match(house, /data-pg-podium/);
  assert.match(house, /HOUSE_DOCK_ENTRIES\.map/);
  assert.match(house, /data-pg-dock-entry/);
  assert.match(house, /프리뷰 챌린지/);
  assert.match(house, /entry\.kind === 'disabled'[\s\S]*?<div[\s\S]*?aria-disabled="true"/);
  assert.match(house, /pointFromButtonActivation\(event\)/);
  assert.doesNotMatch(house, /useMarketPreviewStore/);
});

test('game preparation screen renders dedicated art and source-aware return copy', () => {
  const source = readFileSync('src/views/playground/ComingSoonGame.tsx', 'utf8');

  assert.match(source, /data-pg-game-stage/);
  assert.match(source, /PlaygroundGameArt/);
  assert.match(source, /returnLabel/);
  assert.match(source, /game\.stageReward/);
  assert.match(source, /게임 준비 중/);
  assert.doesNotMatch(source, /START GAME|게임 시작/);
});

test('house and game preparation use the real Shell with source-aware returns', () => {
  const source = readFileSync('src/views/PlaygroundView.tsx', 'utf8');

  assert.match(source, /route\.kind === 'house' && \(\s*<PlaygroundShell/);
  assert.match(source, /titleId:\s*'playground-house-title'/);
  assert.match(source, /title:\s*'JBBJ 하우스'/);
  assert.match(source, /onBack:\s*\(\) => move\(\{ kind: 'go-lobby' \}\)/);
  assert.match(source, /<JbbjHouse[\s\S]*?ranking=\{ranking\}/);
  assert.match(source, /route\.kind === 'coming-soon' && \(\s*<PlaygroundShell/);
  assert.match(source, /game=\{GAME_DEFINITIONS\[route\.game\]\}/);
  assert.match(source, /returnLabel=\{route\.returnTo === 'house' \? 'JBBJ 하우스' : '게임 로비'\}/);
  assert.match(source, /onBack=\{\(\) => move\(\{ kind: 'return-to-source' \}\)\}/);
  assert.match(source, /onExit=\{\(\) => move\(\{ kind: 'return-to-source' \}\)\}/);
});

test('house and game actions keep 44px targets, visible focus and Korean copy at 14px or larger', () => {
  const css = readFileSync('src/views/playground/playground.css', 'utf8');

  assert.match(css, /\.pg-dock\s*{[^}]*min-height:\s*(?:[5-9][0-9]|[1-9][0-9]{2,})px/);
  assert.match(css, /\.pg-game-screen__back\s*{[^}]*min-height:\s*44px/);
  assert.match(css, /\.playground-shell button:focus-visible\s*{[^}]*outline:\s*3px solid/);

  for (const selector of [
    '.pg-challenge p',
    '.pg-challenge__preview',
    '.pg-challenge__progress',
    '.pg-podium h3',
    '.pg-podium li',
    '.pg-podium__me',
    '.pg-dock b',
    '.pg-dock small',
    '.pg-game-screen__info p',
    '.pg-tag--soon',
    '.pg-game-screen__back',
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blocks = [...css.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))];
    const fontSizes = blocks.flatMap((block) => (
      [...block[1].matchAll(/font-size:\s*([0-9.]+)px/g)].map((match) => Number(match[1]))
    ));
    assert.ok(fontSizes.length > 0, `${selector} must define a pixel font-size`);
    assert.ok(fontSizes.every((fontSize) => fontSize >= 14), `${selector} must stay at or above 14px`);
  }
});

test('PlaygroundView wires the approved lobby through the store-aware root only', () => {
  const source = readFileSync('src/views/PlaygroundView.tsx', 'utf8');
  const recommendation = readFileSync('src/features/playground/recommendation.ts', 'utf8');

  assert.match(source, /useAuthStore/);
  assert.match(source, /useMarketPreviewStore/);
  assert.match(source, /useState\(createRecommendationSession\)/);
  assert.match(source, /advanceRecommendation/);
  assert.match(source, /buildPointRanking/);
  assert.match(source, /visible\?\.account\.walletPoints \?\? null/);
  assert.match(source, /visible\?\.account\.cashPoints \?\? null/);
  assert.match(source, /route\.kind === 'lobby' && \(\s*<PlaygroundShell/);
  assert.match(source, /<PlaygroundLobby/);
  assert.match(source, /recommendation=\{recommendation\.current\}/);
  assert.match(source, /onShuffle=\{\(\) => setRecommendation/);
  assert.match(source, /ranking=\{ranking\}/);
  assert.match(source, /marketCashPoints=\{marketCashPoints\}/);
  assert.match(source, /<JbbjHouse/);
  assert.match(source, /<ComingSoonGame/);
  assert.match(source, /<MarketRouter/);
  assert.doesNotMatch(recommendation, /export function pickRecommendation/);
});
