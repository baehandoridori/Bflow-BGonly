const DAY_MS = 24 * 60 * 60_000;
const KST_OFFSET_MS = 9 * 60 * 60_000;
const MARKET_OPEN_OFFSET_MS = 9 * 60 * 60_000;
const MARKET_NEWS_WINDOW_MS = 7 * 60 * 60_000;
const MINUTE_MS = 60_000;

export const AUTONOMOUS_NEWS_DECAY_MS = 3 * 60 * 60_000;

const STOCK_IDS = Object.freeze([
  'jbbj',
  'youtube',
  'meta-comedy',
  'netflix',
  'adobe',
  'wacom',
  'slack',
  'google-drive',
]);

const POSITIVE_NEWS = Object.freeze([
  ['신작 반응이 좋아요', '새 공개분에 대한 반응이 빠르게 퍼지고 있어요.'],
  ['협업 소식이 전해졌어요', '새 파트너십 기대감이 시장에 반영되고 있어요.'],
  ['이용 지표가 반등했어요', '최근 이용 흐름이 예상보다 단단하게 이어지고 있어요.'],
  ['제작 진행이 순조로워요', '예정된 일정이 안정적으로 이어진다는 소식이에요.'],
]);

const NEGATIVE_NEWS = Object.freeze([
  ['일정 조정 소식이 나왔어요', '일부 일정이 다시 조율된다는 소식이 전해졌어요.'],
  ['경쟁 소식에 반응했어요', '비슷한 분야의 새 소식이 잠시 부담으로 작용하고 있어요.'],
  ['비용 부담이 언급됐어요', '운영 비용에 관한 우려가 오늘 흐름에 반영되고 있어요.'],
  ['이용 지표가 주춤했어요', '최근 이용 흐름이 기대보다 느리다는 관측이 나왔어요.'],
]);

function hash32(input) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function unit(seed, label) {
  return hash32(`${seed}:${label}`) / 0x1_0000_0000;
}

function kstDayIndex(ms) {
  return Math.floor((ms + KST_OFFSET_MS) / DAY_MS);
}

function kstDayStartMs(dayIndex) {
  return dayIndex * DAY_MS - KST_OFFSET_MS;
}

function kstDate(dayIndex) {
  return new Date(kstDayStartMs(dayIndex) + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function assertRange(startMs, endMs) {
  if (![startMs, endMs].every(Number.isFinite)) {
    throw new RangeError('automatic news range must use finite timestamps');
  }
}

function buildAutomaticNewsForDay(dayIndex) {
  const date = kstDate(dayIndex);
  const seed = `automatic-news:${date}`;
  const stockId = STOCK_IDS[Math.floor(unit(seed, 'stock') * STOCK_IDS.length)];
  const positive = unit(seed, 'direction') >= 0.45;
  const headlines = positive ? POSITIVE_NEWS : NEGATIVE_NEWS;
  const [title, summary] = headlines[Math.floor(unit(seed, 'headline') * headlines.length)];
  const startOffsetMs = MARKET_OPEN_OFFSET_MS + Math.floor(
    unit(seed, 'time') * MARKET_NEWS_WINDOW_MS / (5 * MINUTE_MS),
  ) * 5 * MINUTE_MS;
  const durationMs = (90 + Math.floor(unit(seed, 'duration') * 91)) * MINUTE_MS;
  const startsAtMs = kstDayStartMs(dayIndex) + startOffsetMs;
  const endsAtMs = Math.min(kstDayStartMs(dayIndex) + DAY_MS - MINUTE_MS, startsAtMs + durationMs);
  const impactBps = (positive ? 1 : -1) * (90 + Math.floor(unit(seed, 'impact') * 91));

  return Object.freeze({
    id: `auto:${date}:${stockId}`,
    stockId,
    kind: 'news',
    title,
    summary,
    impactBps,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
    publishedAt: new Date(startsAtMs).toISOString(),
    revision: 1,
    automatic: true,
  });
}

export function getAutonomousMarketEventsForRange(startMs, endMs) {
  assertRange(startMs, endMs);
  if (endMs < startMs) return [];
  const firstDay = kstDayIndex(startMs);
  const lastDay = kstDayIndex(endMs);
  const events = [];
  for (let dayIndex = firstDay; dayIndex <= lastDay; dayIndex += 1) {
    events.push(buildAutomaticNewsForDay(dayIndex));
  }
  return events;
}

export function getAutonomousMarketNewsForNow(nowMs) {
  if (!Number.isFinite(nowMs)) throw new RangeError('automatic news time must be finite');
  const [event] = getAutonomousMarketEventsForRange(nowMs, nowMs);
  return Date.parse(event.startsAt) <= nowMs ? [event] : [];
}
