import { useRef, useState, type RefObject } from 'react';
import { ArrowLeft, Check, WalletCards } from 'lucide-react';
import { toast } from 'sonner';

import {
  getBuyCostWon,
  getSellProjection,
  maxBuyableShares,
  validateMarketCommand,
} from '@/features/playground/market/domain';
import { formatShares, formatWon } from '@/features/playground/market/format';
import type {
  Holding,
  MarketCommand,
  MarketSnapshot,
  MarketStock,
} from '@/features/playground/market/types';
import { useMarketPreviewStore } from '@/features/playground/market/useMarketPreviewStore';
import { MarketActionDialog } from './MarketActionDialog';

interface MarketOrderPanelProps {
  stock: MarketStock;
  snapshot: MarketSnapshot;
  onOpenAccount(): void;
}

type OrderSide = 'buy' | 'sell';
const SHARE_PRESETS = [1, 5, 10] as const;
const LIMIT_PREVIEW_TOAST = '지정가 입력 흐름을 확인했어요. 실제 예약과 체결은 운영 시세 엔진 연결 후 활성화돼요.';

type SharePreset = (typeof SHARE_PRESETS)[number];
type BuyChoice = SharePreset | 'max';
type SellChoice = SharePreset | 'all' | 'custom';
type LimitQuantityChoice = SharePreset | 'custom';

interface LimitDraft {
  side: OrderSide;
  desiredPriceInput: string;
  quantityChoice: LimitQuantityChoice;
  customQuantityInput: string;
}

type DialogState =
  | {
    kind: 'buy-confirm';
    stockId: string;
    stockName: string;
    priceWon: number;
    quantityShares: number;
    totalWon: number;
    remainingCashWon: number;
  }
  | {
    kind: 'sell-confirm';
    stockId: string;
    stockName: string;
    priceWon: number;
    quantityShares: number | 'all';
    soldQuantityShares: number;
    proceedsWon: number;
    remainingQuantityShares: number;
  }
  | { kind: 'limit-edit'; draft: LimitDraft }
  | {
    kind: 'limit-review';
    draft: LimitDraft;
    desiredPriceWon: number;
    quantityShares: number;
    estimatedTotalWon: number;
  };

function selectedLimitQuantity(draft: LimitDraft): number {
  return draft.quantityChoice === 'custom'
    ? Number(draft.customQuantityInput)
    : draft.quantityChoice;
}

function limitDraftError(draft: LimitDraft): string | null {
  const desiredPriceWon = Number(draft.desiredPriceInput);
  const quantityShares = selectedLimitQuantity(draft);
  if (!Number.isSafeInteger(desiredPriceWon) || desiredPriceWon <= 0) {
    return '원하는 가격을 1원 이상 정수로 입력해 주세요';
  }
  if (!Number.isSafeInteger(quantityShares) || quantityShares <= 0) {
    return '주문 수량을 1주 이상 정수로 입력해 주세요';
  }
  if (!Number.isSafeInteger(desiredPriceWon * quantityShares)) {
    return '주문 금액이 너무 커요';
  }
  return null;
}

function orderDialogTitle(dialog: DialogState | null): string {
  if (dialog?.kind === 'buy-confirm') return '사기 전에 한 번 확인해요';
  if (dialog?.kind === 'sell-confirm') return '팔기 전에 한 번 확인해요';
  if (dialog?.kind === 'limit-review') return '원하는 가격 주문을 검토해요';
  return '원하는 가격에 주문하기';
}

function isLimitDialog(dialog: DialogState | null): boolean {
  return dialog?.kind === 'limit-edit' || dialog?.kind === 'limit-review';
}

function selectedSellQuantity(
  choice: SellChoice,
  customInput: string,
): number | 'all' {
  if (choice === 'all') return 'all';
  if (choice === 'custom') return Number(customInput);
  return choice;
}

function projectSale(
  holding: Holding | undefined,
  priceWon: number,
  quantityShares: number | 'all',
) {
  return holding ? getSellProjection(holding, priceWon, quantityShares) : null;
}

export function MarketOrderPanel({ stock, snapshot, onOpenAccount }: MarketOrderPanelProps) {
  const visible = useMarketPreviewStore((state) => state.visible);
  const mutating = useMarketPreviewStore((state) => state.mutating);
  const storeError = useMarketPreviewStore((state) => state.error);
  const execute = useMarketPreviewStore((state) => state.execute);
  const clearError = useMarketPreviewStore((state) => state.clearError);
  const currentSnapshot = visible ?? snapshot;
  const currentStock = currentSnapshot.stocks.find((item) => item.id === stock.id) ?? stock;
  const holding = currentSnapshot.account.holdings.find((item) => item.stockId === stock.id);

  const [side, setSide] = useState<OrderSide>('buy');
  const [buyChoice, setBuyChoice] = useState<BuyChoice>(1);
  const [sellChoice, setSellChoice] = useState<SellChoice>(1);
  const [customSellShares, setCustomSellShares] = useState('1');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const easyOrderOpenerRef = useRef<HTMLButtonElement>(null);
  const limitOrderOpenerRef = useRef<HTMLButtonElement>(null);
  const submitLockRef = useRef(false);

  const buyQuantityShares = buyChoice === 'max'
    ? maxBuyableShares(currentSnapshot.account.cashWon, currentStock.referencePriceWon)
    : buyChoice;
  const sellQuantityShares = selectedSellQuantity(sellChoice, customSellShares);
  const buyCommand: MarketCommand = {
    kind: 'buy',
    requestId: 'preview',
    stockId: stock.id,
    quantityShares: buyQuantityShares,
    quotedPriceWon: currentStock.referencePriceWon,
  };
  const sellCommand: MarketCommand = {
    kind: 'sell',
    requestId: 'preview',
    stockId: stock.id,
    quantityShares: sellQuantityShares,
    quotedPriceWon: currentStock.referencePriceWon,
  };
  const buyValidation = validateMarketCommand(currentSnapshot, buyCommand);
  const sellValidation = validateMarketCommand(currentSnapshot, sellCommand);
  const buyCostWon = buyValidation === null
    ? getBuyCostWon(buyQuantityShares, currentStock.referencePriceWon)
    : null;
  const sellProjection = sellValidation === null
    ? projectSale(holding, currentStock.referencePriceWon, sellQuantityShares)
    : null;
  const activeValidation = side === 'buy' ? buyValidation : sellValidation;
  const displayedError = localError ?? activeValidation;
  const controlsDisabled = mutating || submitting;
  const dialogOpenerRef = (isLimitDialog(dialog)
    ? limitOrderOpenerRef
    : easyOrderOpenerRef) as RefObject<HTMLElement>;

  const clearFeedback = () => {
    setLocalError(null);
    setDialogError(null);
    clearError();
  };

  const openEasyConfirmation = () => {
    if (controlsDisabled) return;
    clearFeedback();
    const latest = useMarketPreviewStore.getState().visible;
    const latestStock = latest?.stocks.find((item) => item.id === stock.id);
    if (!latest || !latestStock) {
      setLocalError('종목을 찾지 못했어요');
      return;
    }
    const latestHolding = latest.account.holdings.find((item) => item.stockId === stock.id);

    if (side === 'buy') {
      const quantityShares = buyChoice === 'max'
        ? maxBuyableShares(latest.account.cashWon, latestStock.referencePriceWon)
        : buyChoice;
      const command: MarketCommand = {
        kind: 'buy',
        requestId: 'preview',
        stockId: stock.id,
        quantityShares,
        quotedPriceWon: latestStock.referencePriceWon,
      };
      const validation = validateMarketCommand(latest, command);
      if (validation) {
        setLocalError(validation);
        return;
      }
      const totalWon = getBuyCostWon(quantityShares, latestStock.referencePriceWon);
      setDialog({
        kind: 'buy-confirm',
        stockId: stock.id,
        stockName: latestStock.name,
        priceWon: latestStock.referencePriceWon,
        quantityShares,
        totalWon,
        remainingCashWon: latest.account.cashWon - totalWon,
      });
      return;
    }

    const quantityShares = selectedSellQuantity(sellChoice, customSellShares);
    const command: MarketCommand = {
      kind: 'sell',
      requestId: 'preview',
      stockId: stock.id,
      quantityShares,
      quotedPriceWon: latestStock.referencePriceWon,
    };
    const validation = validateMarketCommand(latest, command);
    if (validation || !latestHolding) {
      setLocalError(validation ?? '보유한 주식이 없어요');
      return;
    }
    const projection = getSellProjection(
      latestHolding,
      latestStock.referencePriceWon,
      quantityShares,
    );
    setDialog({
      kind: 'sell-confirm',
      stockId: stock.id,
      stockName: latestStock.name,
      priceWon: latestStock.referencePriceWon,
      quantityShares,
      soldQuantityShares: projection.soldQuantityShares,
      proceedsWon: projection.proceedsWon,
      remainingQuantityShares: latestHolding.quantityShares - projection.soldQuantityShares,
    });
  };

  const confirmEasyOrder = async () => {
    if (
      !dialog
      || (dialog.kind !== 'buy-confirm' && dialog.kind !== 'sell-confirm')
      || submitLockRef.current
      || mutating
    ) return;

    const refreshedMessage = '가격이나 보유 상태가 바뀌어 확인 내용을 새로 고쳤어요. 다시 확인해 주세요.';
    const latest = useMarketPreviewStore.getState().visible;
    const latestStock = latest?.stocks.find((item) => item.id === dialog.stockId);
    if (!latest || !latestStock) {
      setDialogError('종목을 찾지 못했어요');
      return;
    }
    const latestHolding = latest.account.holdings.find((item) => item.stockId === dialog.stockId);

    if (dialog.kind === 'buy-confirm') {
      const previewCommand: MarketCommand = {
        kind: 'buy',
        requestId: 'preview',
        stockId: dialog.stockId,
        quantityShares: dialog.quantityShares,
        quotedPriceWon: latestStock.referencePriceWon,
      };
      const validation = validateMarketCommand(latest, previewCommand);
      if (validation) {
        setDialogError(validation);
        return;
      }
      const totalWon = getBuyCostWon(dialog.quantityShares, latestStock.referencePriceWon);
      const refreshed: DialogState = {
        ...dialog,
        priceWon: latestStock.referencePriceWon,
        totalWon,
        remainingCashWon: latest.account.cashWon - totalWon,
      };
      if (
        refreshed.priceWon !== dialog.priceWon
        || refreshed.totalWon !== dialog.totalWon
        || refreshed.remainingCashWon !== dialog.remainingCashWon
      ) {
        setDialog(refreshed);
        setDialogError(refreshedMessage);
        return;
      }
    } else {
      const previewCommand: MarketCommand = {
        kind: 'sell',
        requestId: 'preview',
        stockId: dialog.stockId,
        quantityShares: dialog.quantityShares,
        quotedPriceWon: latestStock.referencePriceWon,
      };
      const validation = validateMarketCommand(latest, previewCommand);
      if (validation || !latestHolding) {
        setDialogError(validation ?? '보유한 주식이 없어요');
        return;
      }
      const projection = getSellProjection(
        latestHolding,
        latestStock.referencePriceWon,
        dialog.quantityShares,
      );
      const refreshed: DialogState = {
        ...dialog,
        priceWon: latestStock.referencePriceWon,
        soldQuantityShares: projection.soldQuantityShares,
        proceedsWon: projection.proceedsWon,
        remainingQuantityShares: latestHolding.quantityShares - projection.soldQuantityShares,
      };
      if (
        refreshed.priceWon !== dialog.priceWon
        || refreshed.soldQuantityShares !== dialog.soldQuantityShares
        || refreshed.proceedsWon !== dialog.proceedsWon
        || refreshed.remainingQuantityShares !== dialog.remainingQuantityShares
      ) {
        setDialog(refreshed);
        setDialogError(refreshedMessage);
        return;
      }
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setDialogError(null);
    clearError();
    const command: MarketCommand = dialog.kind === 'buy-confirm'
      ? {
        kind: 'buy',
        requestId: crypto.randomUUID(),
        stockId: dialog.stockId,
        quantityShares: dialog.quantityShares,
        quotedPriceWon: dialog.priceWon,
      }
      : {
        kind: 'sell',
        requestId: crypto.randomUUID(),
        stockId: dialog.stockId,
        quantityShares: dialog.quantityShares,
        quotedPriceWon: dialog.priceWon,
      };
    const succeeded = await execute(command);
    submitLockRef.current = false;
    setSubmitting(false);

    if (succeeded) {
      toast.success(dialog.kind === 'buy-confirm'
        ? `${dialog.stockName} ${formatShares(dialog.quantityShares)}를 ${formatWon(dialog.totalWon)}에 샀어요.`
        : `${dialog.stockName} ${formatShares(dialog.soldQuantityShares)}를 팔아 ${formatWon(dialog.proceedsWon)} 받았어요.`);
      setDialog(null);
      return;
    }

    const message = useMarketPreviewStore.getState().error
      ?? '주문을 완료하지 못했어요. 다시 확인해 주세요.';
    setDialogError(message);
    toast.error(message);
  };

  const closeOrderDialog = () => {
    if (submitting || mutating) {
      setDialogError('주문 저장이 끝날 때까지 잠시 기다려 주세요.');
      return;
    }
    setDialog(null);
    setDialogError(null);
  };

  const openLimitOrder = () => {
    if (controlsDisabled) return;
    clearFeedback();
    setDialog({
      kind: 'limit-edit',
      draft: {
        side,
        desiredPriceInput: String(currentStock.referencePriceWon),
        quantityChoice: 1,
        customQuantityInput: '1',
      },
    });
  };

  const updateLimitDraft = (patch: Partial<LimitDraft>) => {
    setDialog((current) => current?.kind === 'limit-edit'
      ? { ...current, draft: { ...current.draft, ...patch } }
      : current);
    setDialogError(null);
  };

  const reviewLimitOrder = () => {
    if (dialog?.kind !== 'limit-edit') return;
    const error = limitDraftError(dialog.draft);
    if (error) {
      setDialogError(error);
      return;
    }
    const desiredPriceWon = Number(dialog.draft.desiredPriceInput);
    const quantityShares = selectedLimitQuantity(dialog.draft);
    setDialog({
      kind: 'limit-review',
      draft: dialog.draft,
      desiredPriceWon,
      quantityShares,
      estimatedTotalWon: getBuyCostWon(quantityShares, desiredPriceWon),
    });
    setDialogError(null);
  };

  const finishLimitPreview = () => {
    if (dialog?.kind !== 'limit-review') return;
    setDialog(null);
    setDialogError(null);
    toast.info(LIMIT_PREVIEW_TOAST);
  };

  return (
    <div className="min-w-0">
      <p className="text-sm leading-6 text-text-secondary">
        현재 가격 <strong className="tabular-nums text-text-primary">{formatWon(currentStock.referencePriceWon)}</strong>
        {' · '}쓸 수 있는 예수금 <strong className="tabular-nums text-text-primary">{formatWon(currentSnapshot.account.cashWon)}</strong>
      </p>

      <fieldset disabled={controlsDisabled} className="mt-5 min-w-0 disabled:opacity-60">
        <legend className="sr-only">간편 주문 종류</legend>
        <div className="grid grid-cols-2 rounded-xl bg-bg-primary/55 p-1">
          {(['buy', 'sell'] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={side === item}
              onClick={() => {
                setSide(item);
                clearFeedback();
              }}
              className="min-h-11 cursor-pointer rounded-lg px-3 py-2 text-sm font-bold text-text-secondary transition-colors duration-200 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-bg-card aria-pressed:text-text-primary"
            >
              {item === 'buy' ? '사기' : '팔기'}
            </button>
          ))}
        </div>

        {side === 'buy' ? (
          <div className="mt-5">
            <p className="text-sm font-bold text-text-primary">현재 가격으로 바로 사기</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
              {SHARE_PRESETS.map((quantityShares) => (
                <button
                  key={quantityShares}
                  type="button"
                  aria-pressed={buyChoice === quantityShares}
                  onClick={() => {
                    setBuyChoice(quantityShares);
                    clearFeedback();
                  }}
                  className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
                >
                  {formatShares(quantityShares)}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={buyChoice === 'max'}
                onClick={() => {
                  setBuyChoice('max');
                  clearFeedback();
                }}
                className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
              >
                최대
              </button>
            </div>
            <dl className="mt-4 space-y-3 rounded-xl bg-bg-primary/45 p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-text-secondary">구매 수량</dt>
                <dd className="font-semibold tabular-nums text-text-primary">
                  {buyValidation === null ? formatShares(buyQuantityShares) : '확인 필요'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-text-secondary">구매 후 남는 예수금</dt>
                <dd className="font-semibold tabular-nums text-text-primary">
                  {buyCostWon === null
                    ? '확인 필요'
                    : formatWon(currentSnapshot.account.cashWon - buyCostWon)}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="mt-5">
            <p className="text-sm font-bold text-text-primary">보유한 주식에서 골라 팔기</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-2">
              {SHARE_PRESETS.map((quantityShares) => (
                <button
                  key={quantityShares}
                  type="button"
                  disabled={!holding}
                  aria-pressed={sellChoice === quantityShares}
                  onClick={() => {
                    setSellChoice(quantityShares);
                    clearFeedback();
                  }}
                  className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {formatShares(quantityShares)}
                </button>
              ))}
              <button
                type="button"
                disabled={!holding}
                aria-pressed={sellChoice === 'all'}
                onClick={() => {
                  setSellChoice('all');
                  clearFeedback();
                }}
                className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
              >
                전부
              </button>
              <button
                type="button"
                disabled={!holding}
                aria-pressed={sellChoice === 'custom'}
                onClick={() => {
                  setSellChoice('custom');
                  clearFeedback();
                }}
                className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
              >
                직접 입력
              </button>
            </div>
            {sellChoice === 'custom' && (
              <div className="mt-3">
                <label htmlFor="market-custom-sell-shares" className="text-sm font-semibold text-text-primary">
                  팔 수량
                </label>
                <div className="relative mt-2">
                  <input
                    id="market-custom-sell-shares"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={customSellShares}
                    onChange={(event) => {
                      setCustomSellShares(event.target.value);
                      clearFeedback();
                    }}
                    className="min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 pr-10 text-base tabular-nums text-text-primary outline-none transition-colors duration-200 focus:border-accent focus:ring-2 focus:ring-accent/30"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-text-secondary">주</span>
                </div>
              </div>
            )}
            <dl className="mt-4 space-y-3 rounded-xl bg-bg-primary/45 p-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-text-secondary">예상 판매 수량</dt>
                <dd className="font-semibold tabular-nums text-text-primary">
                  {sellProjection ? formatShares(sellProjection.soldQuantityShares) : '확인 필요'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-text-secondary">판매 후 받을 예수금</dt>
                <dd className="font-semibold tabular-nums text-text-primary">
                  {sellProjection ? formatWon(sellProjection.proceedsWon) : '확인 필요'}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </fieldset>

      <p
        id="market-order-error"
        className="mt-3 min-h-5 text-sm font-semibold text-text-primary"
        aria-live="polite"
      >
        {displayedError ?? ''}
      </p>

      <button
        ref={easyOrderOpenerRef}
        type="button"
        disabled={controlsDisabled || activeValidation !== null}
        onClick={openEasyConfirmation}
        aria-describedby="market-order-error"
        className="mt-2 min-h-12 w-full cursor-pointer rounded-xl bg-accent px-4 py-3 text-sm font-bold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card disabled:cursor-not-allowed disabled:opacity-50"
      >
        {activeValidation ?? (side === 'buy'
          ? `${formatShares(buyQuantityShares)} 사기`
          : `${formatShares(sellProjection?.soldQuantityShares ?? 0)} 팔기`)}
      </button>

      <button
        type="button"
        disabled={controlsDisabled}
        onClick={onOpenAccount}
        className="mt-2 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <WalletCards aria-hidden="true" size={18} />
        내 계좌에서 예수금 확인
      </button>

      <div className="mt-5 border-t border-bg-border pt-5">
        <button
          ref={limitOrderOpenerRef}
          type="button"
          disabled={controlsDisabled}
          onClick={openLimitOrder}
          className="min-h-11 w-full cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          원하는 가격에 주문하기
        </button>
        <p className="mt-2 text-xs leading-5 text-text-secondary">
          지정가 주문은 입력과 확인 모양만 미리 볼 수 있어요.
        </p>
      </div>

      <MarketActionDialog
        open={dialog !== null}
        title={orderDialogTitle(dialog)}
        description={isLimitDialog(dialog)
          ? '원하는 가격과 정수 주식 수량을 입력한 뒤, 실제로 저장하지 않는 검토 화면을 확인합니다.'
          : '최종 주문 전에 가격, 수량과 예상 합계를 확인합니다.'}
        openerRef={dialogOpenerRef}
        onClose={closeOrderDialog}
      >
        {dialog?.kind === 'buy-confirm' && (
          <div>
            <dl className="space-y-3 rounded-2xl bg-bg-primary/45 p-4 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-text-secondary">회사</dt><dd className="font-semibold text-text-primary">{dialog.stockName}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-text-secondary">현재 가격</dt><dd className="font-semibold tabular-nums text-text-primary">{formatWon(dialog.priceWon)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-text-secondary">살 수량</dt><dd className="font-semibold tabular-nums text-text-primary">{formatShares(dialog.quantityShares)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-text-secondary">주문 합계</dt><dd className="font-semibold tabular-nums text-text-primary">{formatWon(dialog.totalWon)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-text-secondary">구매 후 예수금</dt><dd className="font-semibold tabular-nums text-text-primary">{formatWon(dialog.remainingCashWon)}</dd></div>
            </dl>
            <p className="mt-3 min-h-5 text-sm font-semibold text-text-primary" aria-live="polite">
              {dialogError ?? storeError ?? ''}
            </p>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => void confirmEasyOrder()}
              className="mt-2 min-h-12 w-full cursor-pointer rounded-xl bg-accent px-4 py-3 text-sm font-bold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '주문을 저장하는 중…' : `${formatShares(dialog.quantityShares)} 사기`}
            </button>
          </div>
        )}

        {dialog?.kind === 'sell-confirm' && (
          <div>
            <dl className="space-y-3 rounded-2xl bg-bg-primary/45 p-4 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-text-secondary">회사</dt><dd className="font-semibold text-text-primary">{dialog.stockName}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-text-secondary">현재 가격</dt><dd className="font-semibold tabular-nums text-text-primary">{formatWon(dialog.priceWon)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-text-secondary">팔 수량</dt><dd className="font-semibold tabular-nums text-text-primary">{formatShares(dialog.soldQuantityShares)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-text-secondary">판매 후 받을 예수금</dt><dd className="font-semibold tabular-nums text-text-primary">{formatWon(dialog.proceedsWon)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-text-secondary">판매 후 남는 수량</dt><dd className="font-semibold tabular-nums text-text-primary">{formatShares(dialog.remainingQuantityShares)}</dd></div>
            </dl>
            <p className="mt-3 min-h-5 text-sm font-semibold text-text-primary" aria-live="polite">
              {dialogError ?? storeError ?? ''}
            </p>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => void confirmEasyOrder()}
              className="mt-2 min-h-12 w-full cursor-pointer rounded-xl bg-accent px-4 py-3 text-sm font-bold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '주문을 저장하는 중…' : `${formatShares(dialog.soldQuantityShares)} 팔기`}
            </button>
          </div>
        )}

        {dialog?.kind === 'limit-edit' && (
          <fieldset disabled={mutating} className="min-w-0 disabled:opacity-60">
            <legend className="sr-only">지정가 주문 미리보기 입력</legend>
            <div className="grid grid-cols-2 gap-2">
              {(['buy', 'sell'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={dialog.draft.side === item}
                  onClick={() => updateLimitDraft({ side: item })}
                  className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
                >
                  {item === 'buy' ? '사기' : '팔기'}
                </button>
              ))}
            </div>

            <label htmlFor="market-limit-price" className="mt-5 block text-sm font-semibold text-text-primary">
              원하는 가격
            </label>
            <input
              id="market-limit-price"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={dialog.draft.desiredPriceInput}
              onChange={(event) => updateLimitDraft({ desiredPriceInput: event.target.value })}
              className="mt-2 min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base tabular-nums text-text-primary outline-none transition-colors duration-200 focus:border-accent focus:ring-2 focus:ring-accent/30"
            />

            <p className="mt-5 text-sm font-semibold text-text-primary">주문 수량</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SHARE_PRESETS.map((quantityShares) => (
                <button
                  key={quantityShares}
                  type="button"
                  aria-pressed={dialog.draft.quantityChoice === quantityShares}
                  onClick={() => updateLimitDraft({ quantityChoice: quantityShares })}
                  className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-2 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
                >
                  {formatShares(quantityShares)}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={dialog.draft.quantityChoice === 'custom'}
                onClick={() => updateLimitDraft({ quantityChoice: 'custom' })}
                className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-2 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
              >
                직접 입력
              </button>
            </div>
            {dialog.draft.quantityChoice === 'custom' && (
              <div className="mt-3">
                <label htmlFor="market-limit-quantity" className="text-sm font-semibold text-text-primary">직접 입력할 수량</label>
                <input
                  id="market-limit-quantity"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={dialog.draft.customQuantityInput}
                  onChange={(event) => updateLimitDraft({ customQuantityInput: event.target.value })}
                  className="mt-2 min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base tabular-nums text-text-primary outline-none transition-colors duration-200 focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </div>
            )}
            <p className="mt-3 min-h-5 text-sm font-semibold text-text-primary" aria-live="polite">
              {dialogError ?? ''}
            </p>
            <button
              type="button"
              onClick={reviewLimitOrder}
              className="mt-2 min-h-12 w-full cursor-pointer rounded-xl bg-accent px-4 py-3 text-sm font-bold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              입력 내용 검토하기
            </button>
          </fieldset>
        )}

        {dialog?.kind === 'limit-review' && (
          <div>
            <div className="rounded-2xl bg-bg-primary/45 p-4">
              <p className="text-xs font-semibold text-text-secondary">
                {dialog.draft.side === 'buy' ? '사기' : '팔기'} · 실제 저장되지 않는 미리보기
              </p>
              <p className="mt-3 text-base font-bold leading-7 text-text-primary">
                가격이 {formatWon(dialog.desiredPriceWon)}가 되면 {formatShares(dialog.quantityShares)} 주문
              </p>
              <p className="mt-2 text-sm text-text-secondary">
                예상 합계 {formatWon(dialog.estimatedTotalWon)}
              </p>
            </div>
            <p className="mt-3 text-sm leading-6 text-text-secondary">
              이 단계에서는 예약 주문을 저장하지 않고 입력 흐름만 확인해요.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setDialog({ kind: 'limit-edit', draft: dialog.draft });
                  setDialogError(null);
                }}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-bg-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <ArrowLeft aria-hidden="true" size={17} />
                다시 입력
              </button>
              <button
                type="button"
                onClick={finishLimitPreview}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-bold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Check aria-hidden="true" size={17} />
                지정가 주문 모양 확인
              </button>
            </div>
          </div>
        )}
      </MarketActionDialog>
    </div>
  );
}
