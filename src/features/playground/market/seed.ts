import { getAccountSummary, getStockQuote } from './domain.ts';
import type { MarketPeriod, MarketSnapshot, MarketStock, PricePoint } from './types';

interface StockSeed {
  id: string;
  name: string;
  symbol: string;
  character: string;
  description: string;
  pricePoints: number;
  previousClosePoints: number;
  reason: string;
}

const STOCK_INPUTS: StockSeed[] = [
  { id: 'jbbj', name: 'JBBJ', symbol: 'JBBJ', character: '콘텐츠 스튜디오', description: '우리 팀의 작품과 캐릭터를 만드는 스튜디오예요.', pricePoints: 1842, previousClosePoints: 1700, reason: '새 프로젝트 공개 소식 뒤 관심이 크게 늘었어요.' },
  { id: 'youtube', name: 'YouTube', symbol: 'YT', character: '영상 플랫폼', description: '전 세계 시청자에게 영상을 전하는 플랫폼이에요.', pricePoints: 1260, previousClosePoints: 1222, reason: '신규 채널 성장 소식이 긍정적으로 반영됐어요.' },
  { id: 'meta-comedy', name: '메타코미디', symbol: 'META', character: '코미디 콘텐츠', description: '코미디언과 새로운 웃음 콘텐츠를 만드는 회사예요.', pricePoints: 920, previousClosePoints: 944, reason: '신작 공개 전 관망하는 움직임이 많았어요.' },
  { id: 'netflix', name: 'Netflix', symbol: 'NFLX', character: '글로벌 스트리밍', description: '다양한 나라의 작품을 보여주는 스트리밍 서비스예요.', pricePoints: 1540, previousClosePoints: 1528, reason: '특별한 소식 없이 보통 범위에서 움직였어요.' },
  { id: 'adobe', name: 'Adobe', symbol: 'ADBE', character: '창작 소프트웨어', description: '그림과 영상 제작에 쓰는 창작 도구를 만들어요.', pricePoints: 770, previousClosePoints: 779, reason: '업데이트 평가가 엇갈리며 소폭 내렸어요.' },
  { id: 'wacom', name: 'Wacom', symbol: 'WACM', character: '창작 장비', description: '그림을 그리는 펜과 태블릿을 만드는 회사예요.', pricePoints: 430, previousClosePoints: 412, reason: '새 태블릿 공개 소식 뒤 관심이 늘었어요.' },
  { id: 'slack', name: 'Slack', symbol: 'WORK', character: '팀 커뮤니케이션', description: '팀이 대화하고 자료를 나누는 협업 도구예요.', pricePoints: 610, previousClosePoints: 610, reason: '특별한 소식 없이 보통 범위에서 움직였어요.' },
  { id: 'google-drive', name: 'Google Drive', symbol: 'GDRV', character: '파일 협업', description: '팀 파일을 보관하고 함께 편집하게 해주는 서비스예요.', pricePoints: 505, previousClosePoints: 498, reason: '협업 기능 개선 소식이 작게 반영됐어요.' },
];

const PERIOD_SCALE: Record<MarketPeriod, number> = { today: 1, week: 1.8, month: 2.6, all: 4 };
const PERIOD_SPAN_MS: Record<MarketPeriod, number> = {
  today: 10 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  all: 180 * 24 * 60 * 60 * 1000,
};
const PREVIEW_END_MS = Date.parse('2026-07-11T19:00:00+09:00');
const PREVIEW_NEWS_MS = Date.parse('2026-07-11T15:00:00+09:00');

function makeSeries(stock: StockSeed, period: MarketPeriod): PricePoint[] {
  const scaledChange = Math.round((stock.pricePoints - stock.previousClosePoints) * PERIOD_SCALE[period]);
  const start = stock.pricePoints - scaledChange;
  const values = [
    start,
    Math.round(start + scaledChange * 0.18),
    Math.round(start + scaledChange * 0.42),
    Math.round(start + scaledChange * 0.66),
    Math.round(start + scaledChange * 0.82),
    stock.pricePoints,
  ];
  const newsIndex = period === 'today' ? 3 : 4;
  return values.map((pricePoints, index) => ({
    at: new Date(index === newsIndex
      ? PREVIEW_NEWS_MS
      : PREVIEW_END_MS - PERIOD_SPAN_MS[period] + (PERIOD_SPAN_MS[period] * index) / (values.length - 1)).toISOString(),
    pricePoints,
    ...(index === newsIndex ? { newsId: `${stock.id}-news` } : {}),
  }));
}

function toStock(input: StockSeed): MarketStock {
  return {
    ...input,
    series: {
      today: makeSeries(input, 'today'),
      week: makeSeries(input, 'week'),
      month: makeSeries(input, 'month'),
      all: makeSeries(input, 'all'),
    },
  };
}

export function createMarketPreviewSeed(): MarketSnapshot {
  const stocks = STOCK_INPUTS.map(toStock);
  const snapshot: MarketSnapshot = {
    revision: 1,
    marketOpenLabel: '24시간 열림',
    stocks,
    news: stocks.map((stock) => {
      const quote = getStockQuote(stock);
      const movement = quote.changeRate > 0
        ? `${Math.abs(quote.changeRate)}% 올랐어요`
        : quote.changeRate < 0
          ? `${Math.abs(quote.changeRate)}% 내렸어요`
          : '가격 변화가 없었어요';
      return {
        id: `${stock.id}-news`,
        stockId: stock.id,
        title: stock.reason,
        summary: `${stock.name}은 오늘 ${movement}.`,
        publishedAt: '2026-07-11T15:00:00+09:00',
      };
    }),
    favoriteStockIds: ['jbbj', 'youtube', 'wacom'],
    account: {
      walletPoints: 18450,
      cashPoints: 3640,
      realizedPnlThisMonthPoints: 1240,
      unrealizedPnlAtMonthStartPoints: 0,
      holdings: [
        { stockId: 'jbbj', quantityMicros: 2_000_000, costBasisPoints: 3550 },
        { stockId: 'youtube', quantityMicros: 2_000_000, costBasisPoints: 2480 },
        { stockId: 'wacom', quantityMicros: 3_490_698, costBasisPoints: 1470 },
      ],
    },
    beginnerMission: 'reason',
  };
  const summary = getAccountSummary(snapshot);
  const pricesAreValid = stocks.every((stock) => (
    Number.isSafeInteger(stock.pricePoints)
    && stock.pricePoints > 0
    && Number.isSafeInteger(stock.previousClosePoints)
    && stock.previousClosePoints > 0
    && stock.series.today.at(-1)?.pricePoints === stock.pricePoints
  ));
  if (!pricesAreValid || summary.holdingsValuePoints !== 7705 || summary.unrealizedPnlPoints !== 205) {
    throw new Error('market preview seed invariant drifted');
  }
  return snapshot;
}
