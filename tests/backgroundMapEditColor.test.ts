import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_PRESETS, deriveThemeFromAccent, getLightColors, hslToRgb, rgbToHex } from '../src/themes.ts';
import {
  MAP_EDIT_MAIN_TONES, MAP_EDIT_MIN_CHROMA, MAP_EDIT_RESERVE_BELOW, MAP_EDIT_TONES,
  colorContrast, colorHue, colorTriple, hueDistance, mapEditColors,
} from '../src/features/backgrounds/mapEditColor.ts';
import type { MapEditColors } from '../src/features/backgrounds/mapEditColor.ts';

// The colour of the edit band. The limits below (70 and 45 degrees of hue, contrasts of 6 and 4.5) are measured with the
// module's own functions, so C-0 pins those functions to numbers first: a wrong measure would pass every limit it measures.

const directory = new URL('../src/features/backgrounds/', import.meta.url);
/** The page of the default theme, and the light page of every preset. */
const DARK = '15 17 23', LIGHT = '239 243 250';
/** The candidates, written out here: what the band has is compared with these, not with the module's own table. */
const TONES: { id: string; bright: MapEditColors; deep: MapEditColors }[] = [
  { id: 'amber', bright: { strip: '245 178 64', ink: '28 22 8' }, deep: { strip: '128 81 0', ink: '255 255 255' } },
  { id: 'cyan', bright: { strip: '86 204 222', ink: '6 28 34' }, deep: { strip: '0 102 117', ink: '255 255 255' } },
  { id: 'purple', bright: { strip: '220 150 255', ink: '24 10 34' }, deep: { strip: '134 46 178', ink: '255 255 255' } },
];
const [AMBER, CYAN, PURPLE] = TONES;
/** Which candidate these colours are a tone of. Undefined: none of them. */
const toneId = (colors: MapEditColors) => TONES.find(tone => [tone.bright, tone.deep].some(item => item.strip === colors.strip && item.ink === colors.ink))?.id;

function rgb(text: string): [number, number, number] {
  const triple = colorTriple(text);
  if (!triple) assert.fail(`not a colour: "${text}"`);
  return triple;
}
function hueOf(text: string): number {
  const hue = colorHue(rgb(text));
  if (hue === null) assert.fail(`a colour without a hue: "${text}"`);
  return hue;
}
const near = (actual: number | null, expected: number, within: number, what: string) => assert.ok(actual !== null && Math.abs(actual - expected) <= within, `${what}: ${actual}, expected ${expected} within ${within}`);
/** For the sweeps: the message is put together only when the check fails. */
function must(ok: boolean, what: () => string): void { if (!ok) assert.fail(what()); }

const PRESET_IDS = ['violet', 'cinema-red', 'midnight-blue', 'emerald', 'amber-gold', 'nameko'];
function preset(id: string) {
  const found = THEME_PRESETS.find(item => item.id === id);
  if (!found) assert.fail(`no preset "${id}"`);
  return found.colors;
}
/** What the band has under each preset, on the preset's own dark page and on the light page. Twelve rows, letter for letter. */
const PRESET_TABLE: { id: string; page: 'dark' | 'light'; strip: string; ink: string }[] = [
  { id: 'violet', page: 'dark', strip: '245 178 64', ink: '28 22 8' },
  { id: 'violet', page: 'light', strip: '128 81 0', ink: '255 255 255' },
  { id: 'cinema-red', page: 'dark', strip: '86 204 222', ink: '6 28 34' },
  { id: 'cinema-red', page: 'light', strip: '0 102 117', ink: '255 255 255' },
  { id: 'midnight-blue', page: 'dark', strip: '245 178 64', ink: '28 22 8' },
  { id: 'midnight-blue', page: 'light', strip: '128 81 0', ink: '255 255 255' },
  { id: 'emerald', page: 'dark', strip: '245 178 64', ink: '28 22 8' },
  { id: 'emerald', page: 'light', strip: '128 81 0', ink: '255 255 255' },
  { id: 'amber-gold', page: 'dark', strip: '86 204 222', ink: '6 28 34' },
  { id: 'amber-gold', page: 'light', strip: '0 102 117', ink: '255 255 255' },
  { id: 'nameko', page: 'dark', strip: '86 204 222', ink: '6 28 34' },
  { id: 'nameko', page: 'light', strip: '0 102 117', ink: '255 255 255' },
];
/** Those rows as the editor meets them: the two colours of the preset, and the page and the card they are painted on. */
function presetRows() {
  return PRESET_TABLE.map(row => {
    const colors = preset(row.id), surface = row.page === 'dark' ? colors : getLightColors(row.id);
    return { label: `${row.id}, ${row.page} page`, expected: { strip: row.strip, ink: row.ink }, accent: colors.accent, accentSub: colors.accentSub, page: surface.bgPrimary, card: surface.bgCard };
  });
}

test('C-0: the measures themselves: contrast, hue and hue distance are pinned to numbers, and the constants of the choice', () => {
  // WCAG contrast, with its gamma and its three weights.
  near(colorContrast([28, 22, 8], [245, 178, 64]), 9.70, 0.01, 'dark text on bright amber');
  near(colorContrast([255, 255, 255], [0, 102, 117]), 6.65, 0.01, 'white text on deep cyan');
  near(colorContrast([255, 255, 255], [0, 0, 0]), 21, 1e-9, 'white on black');
  assert.equal(colorContrast([28, 22, 8], [245, 178, 64]), colorContrast([245, 178, 64], [28, 22, 8]));
  assert.equal(colorContrast([255, 255, 255], [0, 102, 117]), colorContrast([0, 102, 117], [255, 255, 255]));
  // Hue: the three candidates and pure red.
  near(colorHue([245, 178, 64]), 37.8, 0.05, 'hue of amber');
  near(colorHue([86, 204, 222]), 187.9, 0.05, 'hue of cyan');
  near(colorHue([220, 150, 255]), 280.0, 0.05, 'hue of purple');
  assert.equal(colorHue([255, 0, 0]), 0);
  // And the two cases those leave out, by the accents of two presets: green the largest channel, and a red past 300 degrees.
  near(colorHue([16, 185, 129]), 160, 0.5, 'hue of the emerald accent');
  near(colorHue([225, 29, 72]), 347, 0.5, 'hue of the red accent');
  // Hue distance goes the short way round.
  assert.equal(hueDistance(350, 10), 20); assert.equal(hueDistance(10, 350), 20); assert.equal(hueDistance(0, 180), 180);
  assert.equal(MAP_EDIT_MIN_CHROMA, 0.08); assert.equal(MAP_EDIT_MAIN_TONES, 2); assert.equal(MAP_EDIT_RESERVE_BELOW, 60);
  assert.deepEqual(MAP_EDIT_TONES.map(tone => tone.id), ['amber', 'cyan', 'purple']);
});

test('C-1: six presets on two pages: the twelve rows of the table, letter for letter', () => {
  assert.deepEqual(THEME_PRESETS.map(item => item.id), PRESET_IDS);
  const rows = presetRows();
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.deepEqual(mapEditColors(row.accent, row.accentSub, row.page), row.expected, row.label);
    // A preset never reaches the reserve: with its accent in both places the answer is the same.
    assert.deepEqual(mapEditColors(row.accent, row.accent, row.page), row.expected, `${row.label}, the accent twice`);
  }
  // The light rows were all asked on the one light page.
  assert.deepEqual(rows.filter(row => row.page === LIGHT).map(row => row.label), PRESET_IDS.map(id => `${id}, light page`));
});

test('C-2: on those twelve rows the band stands apart from each colour of the theme, and reads on the page and on a card', () => {
  for (const row of presetRows()) {
    const colors = mapEditColors(row.accent, row.accentSub, row.page), strip = rgb(colors.strip), stripHue = hueOf(colors.strip);
    for (const themeColor of [row.accent, row.accentSub]) assert.ok(hueDistance(hueOf(themeColor), stripHue) >= 70, `${row.label}: ${colors.strip} is too near ${themeColor}`);
    assert.ok(colorContrast(rgb(colors.ink), strip) >= 6, `${row.label}: text on the band`);
    assert.ok(colorContrast(strip, rgb(row.page)) >= 4.5, `${row.label}: band on the page ${row.page}`);
    assert.ok(colorContrast(strip, rgb(row.card)) >= 4.5, `${row.label}: band on the card ${row.card}`);
    // None of the twelve is the reserve.
    assert.ok(['amber', 'cyan'].includes(toneId(colors) as string), `${row.label}: ${colors.strip} is the reserve, or no candidate`);
  }
});

test('C-3: a theme of one family: 7,200 accents on nine pages keep the distance and the contrasts, and never reach the reserve', () => {
  // Whether an accent has a hue, and which one, is taken from what it was made of: its h, and a limit written here.
  // Asked of the module instead, a module with another limit would excuse itself.
  const MIN_CHROMA = 0.08;
  const light = getLightColors('violet');
  const fixed = [...THEME_PRESETS.map(item => ({ page: item.colors.bgPrimary, card: item.colors.bgCard })), { page: light.bgPrimary, card: light.bgCard }];
  assert.equal(fixed.length, 7);
  let cases = 0, hueless = 0;
  for (let h = 0; h < 360; h++) for (const s of [20, 35, 60, 100]) for (const l of [15, 30, 50, 70, 85]) {
    const accent = hslToRgb(h, s, l), hex = rgbToHex(accent), hasHue = (1 - Math.abs(2 * l / 100 - 1)) * s / 100 >= MIN_CHROMA;
    // The page and the card of a theme made the old way from this accent alone, dark and light.
    const derived = (['dark', 'light'] as const).map(mode => { const theme = deriveThemeFromAccent(hex, hex, mode); return { page: theme.bgPrimary, card: theme.bgCard }; });
    for (const { page, card } of [...fixed, ...derived]) {
      const colors = mapEditColors(accent, accent, page), id = toneId(colors), strip = rgb(colors.strip);
      const where = () => `hsl(${h} ${s}% ${l}%) = ${accent} on ${page}: ${colors.strip}`;
      cases++;
      if (hasHue) must(hueDistance(h, hueOf(colors.strip)) >= 70, () => `${where()} is too near the accent`);
      else { hueless++; must(id === 'amber', () => `${where()} for an accent without a hue`); }
      must(id === 'amber' || id === 'cyan', () => `${where()} is the reserve, or no candidate`);
      must(colorContrast(rgb(colors.ink), strip) >= 6, () => `${where()}: text on the band`);
      must(colorContrast(strip, rgb(page)) >= 4.5, () => `${where()}: band on the page`);
      must(colorContrast(strip, rgb(card)) >= 4.5, () => `${where()}: band on the card ${card}`);
    }
  }
  assert.equal(cases, 64800);
  // Saturation 20% at lightness 15% and at 85%: 720 accents, each on nine pages.
  assert.equal(hueless, 6480);
});

test('C-3b: a theme of two families: every pair of hues keeps 45 degrees from both, and the reserve is looked at below 60 degrees and only there', () => {
  // The hues of the three candidates and the limit of the reserve, written here apart from the module: the answer for
  // each pair is worked out below from these and from the two hues the pair was made of, with no function of the module.
  const AMBER_HUE = 37.8, CYAN_HUE = 187.9, PURPLE_HUE = 280.0, RESERVE_BELOW = 60;
  // A made hue moves about a tenth of a degree when it is rounded to three channels: pairs this near an edge are skipped.
  const EDGE = 0.5;
  const apart = (a: number, b: number) => { const degrees = Math.abs(a - b) % 360; return degrees > 180 ? 360 - degrees : degrees; };
  const made = Array.from({ length: 360 }, (_, h) => hslToRgb(h, 100, 50));
  let pairs = 0, purple = 0, skipped = 0;
  for (const page of [DARK, LIGHT]) for (let h1 = 0; h1 < 360; h1++) for (let h2 = 0; h2 < 360; h2++) {
    const colors = mapEditColors(made[h1], made[h2], page), id = toneId(colors), stripHue = hueOf(colors.strip);
    const where = () => `${h1}° with ${h2}° on ${page}: ${colors.strip}`;
    pairs++;
    must(hueDistance(h1, stripHue) >= 45 && hueDistance(h2, stripHue) >= 45, () => `${where()} is too near a colour of the theme`);
    must(colorContrast(rgb(colors.ink), rgb(colors.strip)) >= 6, () => `${where()}: text on the band`);
    must(colorContrast(rgb(colors.strip), rgb(page)) >= 4.5, () => `${where()}: band on the page`);
    // A candidate is as far from the theme as from the nearer of its two hues.
    const toAmber = Math.min(apart(h1, AMBER_HUE), apart(h2, AMBER_HUE)), toCyan = Math.min(apart(h1, CYAN_HUE), apart(h2, CYAN_HUE));
    const toPurple = Math.min(apart(h1, PURPLE_HUE), apart(h2, PURPLE_HUE)), fartherMain = Math.max(toAmber, toCyan);
    // One way: the reserve is taken only where both main candidates are within the limit.
    if (id === 'purple') { purple++; must(toAmber < RESERVE_BELOW && toCyan < RESERVE_BELOW, () => `${where()}, with amber ${toAmber}° and cyan ${toCyan}° away`); }
    // And back: wherever both are within the limit and the reserve is farther, it is the reserve. A module that looked at
    // the reserve only below 55 degrees would pass the check above and the 45 degrees, and fail here.
    if (Math.abs(toAmber - toCyan) < EDGE || Math.abs(toPurple - fartherMain) < EDGE || Math.abs(fartherMain - RESERVE_BELOW) < EDGE) { skipped++; continue; }
    const answer = toAmber < RESERVE_BELOW && toCyan < RESERVE_BELOW && toPurple > fartherMain ? 'purple' : toAmber > toCyan ? 'amber' : 'cyan';
    must(id === answer, () => `${where()}, expected ${answer} (amber ${toAmber}°, cyan ${toCyan}°, purple ${toPurple}° away)`);
  }
  assert.equal(pairs, 259200);
  assert.ok(purple > 0, 'no pair reached the reserve');
  assert.ok(skipped > 0 && skipped / pairs <= 0.03, `${skipped} of ${pairs} pairs were skipped`);
});

test('C-3c: a preset with only its main colour changed: the thirty mixes keep 45 degrees, four of them letter for letter', () => {
  const mixes = THEME_PRESETS.flatMap(kept => THEME_PRESETS.filter(taken => taken !== kept)
    .map(taken => ({ label: `${kept.id} with the accent of ${taken.id}`, accent: taken.colors.accent, accentSub: kept.colors.accentSub })));
  assert.equal(mixes.length, 30);
  for (const page of [DARK, LIGHT]) {
    let reserve = 0;
    for (const { label, accent, accentSub } of mixes) {
      const colors = mapEditColors(accent, accentSub, page), stripHue = hueOf(colors.strip);
      for (const themeColor of [accent, accentSub]) assert.ok(hueDistance(hueOf(themeColor), stripHue) >= 45, `${label}: ${colors.strip} is too near ${themeColor}`);
      assert.ok(toneId(colors), `${label}: ${colors.strip} is no candidate`);
      if (toneId(colors) === 'purple') reserve++;
    }
    // Twelve of the thirty reach the reserve.
    assert.equal(reserve, 12, `on ${page}`);
  }
  // [the preset that keeps its second accent, the preset whose accent it gets, what the band has]
  const fixed: [string, string, typeof PURPLE][] = [['amber-gold', 'midnight-blue', PURPLE], ['nameko', 'midnight-blue', PURPLE], ['emerald', 'cinema-red', PURPLE], ['violet', 'cinema-red', CYAN]];
  for (const [kept, taken, tone] of fixed) {
    assert.deepEqual(mapEditColors(preset(taken).accent, preset(kept).accentSub, DARK), tone.bright, `${kept} with the accent of ${taken}, dark page`);
    assert.deepEqual(mapEditColors(preset(taken).accent, preset(kept).accentSub, LIGHT), tone.deep, `${kept} with the accent of ${taken}, light page`);
  }
});

test('C-4: without a hue in the theme the first of the list, and one colour with a hue is enough to stand apart from', () => {
  const pages = [...THEME_PRESETS.map(item => item.colors.bgPrimary), LIGHT];
  // A grey, a near-white, a near-black, a warm grey just under the limit, and a near-white that HSL calls fully saturated.
  for (const grey of ['128 128 128', '242 242 242', '16 16 16', '140 132 120', '250 250 255']) {
    assert.equal(colorHue(rgb(grey)), null, grey);
    for (const page of pages) assert.equal(toneId(mapEditColors(grey, grey, page)), 'amber', `${grey} on ${page}`);
    assert.deepEqual(mapEditColors(grey, grey, DARK), AMBER.bright, grey);
    assert.deepEqual(mapEditColors(grey, grey, LIGHT), AMBER.deep, grey);
  }
  // A dull accent that does have a hue: the brown of a preset.
  assert.equal(typeof colorHue([129, 77, 65]), 'number');
  // One step above the limit (a spread of 0.082) there is a hue, and the band moves away from it.
  near(colorHue([140, 130, 119]), 31.4, 0.1, 'hue of the warm grey above the limit');
  assert.deepEqual(mapEditColors('140 130 119', '140 130 119', DARK), CYAN.bright);
  assert.deepEqual(mapEditColors('140 130 119', '140 130 119', LIGHT), CYAN.deep);
  // Only one of the two has a hue: the band stands apart from that one.
  assert.deepEqual(mapEditColors('128 128 128', '251 191 36', DARK), CYAN.bright);
  assert.deepEqual(mapEditColors('128 128 128', '34 211 238', DARK), AMBER.bright);
});

test('C-5: between the two main candidates the farther one is taken, on both sides of each middle, and the first one when they are as far', () => {
  // The middles are near 112.9 and 292.9 degrees. Even there a main candidate is far enough: the reserve is not taken.
  for (const [h, expected] of [[110, 'cyan'], [116, 'amber'], [290, 'amber'], [296, 'cyan']] as const) for (const page of [DARK, LIGHT]) {
    const color = hslToRgb(h, 100, 50), colors = mapEditColors(color, color, page);
    assert.equal(toneId(colors), expected, `${h}° on ${page}`);
    assert.ok(hueDistance(h, hueOf(colors.strip)) >= 70, `${h}° on ${page}: ${colors.strip} is too near`);
  }
  // Two greens that put amber and cyan each at 60 degrees from the theme, to the last digit. As far as each other: the
  // first of the list. And 60 is the limit of the reserve, which is looked at below it, not at it: purple, 152 degrees
  // away, is not taken.
  const equallyFar: [string, string] = ['67 181 0', '0 204 27'];
  assert.deepEqual([AMBER, CYAN].map(tone => Math.min(...equallyFar.map(color => hueDistance(hueOf(color), hueOf(tone.bright.strip))))), [60, 60]);
  assert.deepEqual(mapEditColors(equallyFar[0], equallyFar[1], DARK), AMBER.bright);
  assert.deepEqual(mapEditColors(equallyFar[1], equallyFar[0], LIGHT), AMBER.deep);
});

test('C-6: values that cannot be read: which of the three it is decides what the band still goes by', () => {
  // (가) None of the three can be read.
  assert.deepEqual(mapEditColors('', '', ''), AMBER.bright);
  // (나) The two colours of the theme cannot be read, the page can: the tone still follows the page.
  for (const unreadable of ['abc', '1 2', '300 0 0']) {
    assert.equal(colorTriple(unreadable), null, unreadable);
    assert.deepEqual(mapEditColors(unreadable, unreadable, DARK), AMBER.bright, `"${unreadable}" on the dark page`);
    assert.deepEqual(mapEditColors(unreadable, unreadable, LIGHT), AMBER.deep, `"${unreadable}" on the light page`);
  }
  // (다) The theme can be read, the page cannot: without a page, the bright tone.
  assert.deepEqual(mapEditColors('108 92 231', '162 155 254', ''), AMBER.bright);
  // (라) Only the second accent can be read: the band stands apart from that one.
  assert.deepEqual(mapEditColors('', '251 191 36', LIGHT), CYAN.deep);
  // Commas, a slash and spaces around the value are read.
  assert.deepEqual(colorTriple('108, 92, 231'), [108, 92, 231]);
  assert.deepEqual(colorTriple('108/92/231'), [108, 92, 231]);
  assert.deepEqual(colorTriple('  108 92 231 \n'), [108, 92, 231]);
  assert.equal(colorTriple(''), null);
  // A fourth part, as in a colour written with its opacity, is left out: the first three are the colour.
  assert.deepEqual(colorTriple('108 92 231 / 0.5'), [108, 92, 231]);
  // A channel below 0 is no colour, as one above 255 is none.
  assert.equal(colorTriple('-5 0 0'), null);
});

test('C-7: of the two tones the one that stands out from the page: bright on a dark page, deep on a light one, and no mode is asked', () => {
  // A theme for each candidate: the default preset, the red preset, and the gold preset with only its main colour made blue.
  const themes: Record<string, [string, string]> = { amber: ['108 92 231', '162 155 254'], cyan: ['225 29 72', '251 113 133'], purple: ['59 130 246', '251 191 36'] };
  for (const tone of TONES) {
    const [accent, accentSub] = themes[tone.id];
    assert.deepEqual(mapEditColors(accent, accentSub, '15 17 23'), tone.bright, `${tone.id} on the dark page`);
    assert.deepEqual(mapEditColors(accent, accentSub, '239 243 250'), tone.deep, `${tone.id} on the light page`);
    // In between it is the two contrasts that are compared, not the page that is called dark or light: on a grey page
    // each candidate turns where its own two tones stand out as much, purple (past grey 130) before the other two (past 135).
    assert.deepEqual(mapEditColors(accent, accentSub, '130 130 130'), tone.bright, `${tone.id} on grey 130`);
    assert.deepEqual(mapEditColors(accent, accentSub, '133 133 133'), tone.id === 'purple' ? tone.deep : tone.bright, `${tone.id} on grey 133`);
    assert.deepEqual(mapEditColors(accent, accentSub, '136 136 136'), tone.deep, `${tone.id} on grey 136`);
  }
  // The page is all it is told: there is no argument for a colour mode.
  assert.equal(mapEditColors.length, 3);
});

test('C-8: the table of candidates: none near red, none greyish, each readable, two tones of one hue, and the three spread round the circle', () => {
  const spread = (text: string) => { const channels = rgb(text); return (Math.max(...channels) - Math.min(...channels)) / 255; };
  assert.equal(MAP_EDIT_TONES.length, 3);
  for (const tone of MAP_EDIT_TONES) {
    for (const colors of [tone.bright, tone.deep]) {
      assert.ok(hueDistance(hueOf(colors.strip), 0) >= 30, `${tone.id} ${colors.strip}: near red`);
      assert.ok(spread(colors.strip) >= 0.4, `${tone.id} ${colors.strip}: greyish`);
      assert.ok(colorContrast(rgb(colors.ink), rgb(colors.strip)) >= 6, `${tone.id} ${colors.strip}: text on the band`);
    }
    assert.ok(hueDistance(hueOf(tone.bright.strip), hueOf(tone.deep.strip)) <= 1, `${tone.id}: its two tones differ in hue`);
  }
  // Round the circle from each candidate to the next one. Half the narrowest gap is what a theme of two families is left with.
  const hues = MAP_EDIT_TONES.map(tone => hueOf(tone.bright.strip)).sort((a, b) => a - b);
  const gaps = hues.map((hue, index) => (index + 1 < hues.length ? hues[index + 1] : hues[0] + 360) - hue);
  assert.equal(gaps.length, 3);
  for (const gap of gaps) assert.ok(gap >= 90, `a gap of ${gap}°`);
  near(gaps.reduce((sum, gap) => sum + gap, 0), 360, 1e-9, 'the three gaps together');
});

/** The stylesheet of the map editor, line by line and as written (a rule is one line, comments stay): a fresh checkout has CRLF line ends. */
const sheet = (): string[] => readFileSync(new URL('backgrounds-map.css', directory), 'utf8').split(/\r?\n/);
/** The one base rule that starts with this, at the very start of its line: an override of it inside a media block is indented. */
function baseRule(lines: string[], opening: string): string {
  const found = lines.filter(line => line.startsWith(opening));
  assert.equal(found.length, 1, `one rule starts with "${opening}"`);
  return found[0];
}

test('C-9: the stylesheet starts from the default theme: its one line of defaults holds what the function gives for that theme', () => {
  const defaults = baseRule(sheet(), '.bmap-layout { --bmap-edit:');
  assert.equal(defaults, '.bmap-layout { --bmap-edit:245 178 64; --bmap-edit-ink:28 22 8; --bmap-edit-h:40px; }');
  // What is painted before the script has run, and what the script then writes under the default theme, are one colour.
  const colors = mapEditColors('108 92 231', '162 155 254', '15 17 23');
  assert.equal(/--bmap-edit:([^;]*);/.exec(defaults)?.[1], colors.strip);
  assert.equal(/--bmap-edit-ink:([^;]*);/.exec(defaults)?.[1], colors.ink);
});

test('C-10: the band, the frame and the dot are painted with the two variables: no rule of theirs holds a colour of its own', () => {
  const lines = sheet();
  const strip = baseRule(lines, '.bmap-edit-strip {'), frame = baseRule(lines, '.bmap-main.is-editing .bmap-canvas-wrap::after {');
  const dot = baseRule(lines, '.bmap-draft-dot {'), pill = baseRule(lines, '.bmap-edit-strip[data-phase="changed"] .bmap-edit-state>span {');
  assert.ok(strip.includes('background:rgb(var(--bmap-edit))') && strip.includes('color:rgb(var(--bmap-edit-ink))'), strip);
  assert.ok(frame.includes('border:2px solid rgb(var(--bmap-edit))'), frame);
  assert.ok(dot.includes('color:rgb(var(--bmap-edit))'), dot);
  assert.ok(pill.includes('background:rgb(var(--bmap-edit-ink))') && pill.includes('color:rgb(var(--bmap-edit))'), pill);
  // Every rule of theirs, read without its indent: the overrides inside the media blocks are rules of theirs too. The
  // line that sets the variables starts with `.bmap-layout` and is not one of them.
  const own = lines.filter(line => ['.bmap-edit', '.bg-library .bmap-edit', '.bmap-main.is-editing', '.bmap-draft-dot'].some(start => line.trimStart().startsWith(start)));
  // Asked first: over no lines the loop below would pass. The four rules above are among them, and so are indented ones.
  assert.ok(own.length >= 20, `${own.length} rules of the band, the frame and the dot`);
  for (const rule of [strip, frame, dot, pill]) assert.ok(own.includes(rule), rule);
  assert.ok(own.some(line => line !== line.trimStart()), 'no indented rule was read');
  // A hex colour; `rgb(` of anything but the two variables (`rgb(28 22 8)` would be right in one tone of the six); a colour
  // by its name (not found by a word edge: these lines hold `white-space`); `hsl(`.
  for (const line of own) for (const colour of [/#[0-9a-fA-F]{3,8}\b/, /rgb\((?!var\(--bmap-edit)/, /(?<![\w-])(?:white|black)(?![\w-])/, /hsla?\(/]) assert.doesNotMatch(line, colour);
});

test('C-11: the colour module and the status module stay pure: no import in the first, no three.js and no DOM in either', () => {
  // Read as written, comments and all.
  const colorSource = readFileSync(new URL('mapEditColor.ts', directory), 'utf8');
  assert.ok(colorSource.includes('export function mapEditColors('));
  // An import statement at the start of a line, not the word: the comment at the head says "no imports".
  assert.doesNotMatch(colorSource, /^import\b/m);
  // Nor a module brought in without such a line: a re-export, an import inside a function, an import after an indent.
  assert.doesNotMatch(colorSource, /\bfrom\s*['"]|\bimport\s*[('"]/);
  for (const word of ['document', 'window', 'getComputedStyle']) assert.equal(colorSource.includes(word), false, `mapEditColor.ts names ${word}`);
  const statusSource = readFileSync(new URL('mapEditStatus.ts', directory), 'utf8');
  assert.ok(statusSource.includes('export function mapEditStatus('));
  // The import and the access, not the words.
  assert.doesNotMatch(statusSource, /from\s+['"]three/, 'mapEditStatus.ts imports three.js');
  assert.doesNotMatch(statusSource, /\b(?:document|window)\.\w/, 'mapEditStatus.ts touches the DOM');
});
