import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import { toast } from 'sonner';

import {
  maxBuyableShares,
  validateMarketCommand,
} from '../../../features/playground/market/domain.ts';
import { formatShares, formatWon } from '../../../features/playground/market/format.ts';
import {
  createPendingMarketValueRequest,
  retryPendingMarketValueCommand,
  sameMarketValueCommand,
  type MarketValueCommand,
  type PendingMarketValueRequest,
} from '../../../features/playground/market/pendingValueRequest.ts';
import type {
  MarketAdminEvent,
  MarketSnapshot,
  MarketStock,
} from '../../../features/playground/market/types.ts';
import { useMarketPreviewStore } from '../../../features/playground/market/useMarketPreviewStore.ts';

export const MARKET_SHARE_CHOICES = [1, 5, 10, 'max', 'custom'] as const;

export type MarketOrderSide = 'buy' | 'sell';
export type MarketShareChoice = (typeof MARKET_SHARE_CHOICES)[number];
export type MarketOrderSurface = 'mobile-order' | 'confirm' | 'limit-edit' | 'limit-review' | null;

export interface FrozenMarketOrder {
  side: MarketOrderSide;
  quantityShares: number;
  quotedPriceWon: number;
  quotedRevision: number;
  estimatedTotalWon: number;
  availableCashWon: number;
  availableShares: number;
}

export interface MarketLimitDraft {
  side: MarketOrderSide;
  desiredPriceInput: string;
  quantityInput: string;
}

export interface MarketLimitReview {
  side: MarketOrderSide;
  desiredPriceWon: number;
  quantityShares: number;
  estimatedTotalWon: number;
}

interface PendingOrderDetails {
  frozen: FrozenMarketOrder;
  stockName: string;
  choice: MarketShareChoice;
}

type PendingOrderRequest = PendingMarketValueRequest<PendingOrderDetails>;

interface FreezeMarketOrderOptions {
  snapshot: MarketSnapshot;
  stock: MarketStock;
  side: MarketOrderSide;
  choice: MarketShareChoice;
  customSharesInput: string;
  quotedPriceWon: number;
}

interface UseMarketOrderControllerOptions {
  stockId: string;
  currentPriceWon: number;
  nowMs: number;
  onOpenAccount(): void;
}

export interface MarketOrderController {
  stock: MarketStock | null;
  snapshot: MarketSnapshot | null;
  side: MarketOrderSide;
  choice: MarketShareChoice;
  customSharesInput: string;
  frozenPreview: FrozenMarketOrder | null;
  confirmation: FrozenMarketOrder | null;
  surface: MarketOrderSurface;
  limitDraft: MarketLimitDraft;
  limitReview: MarketLimitReview | null;
  halted: boolean;
  controlsDisabled: boolean;
  confirmDisabled: boolean;
  pendingResolution: boolean;
  refreshRequired: boolean;
  submitting: boolean;
  validation: string | null;
  error: string | null;
  openerRef: MutableRefObject<HTMLElement | null>;
  selectSide(side: MarketOrderSide): void;
  selectChoice(choice: MarketShareChoice): void;
  setCustomSharesInput(value: string): void;
  openSheet(side: MarketOrderSide, opener: HTMLElement): void;
  openConfirmation(opener?: HTMLElement): void;
  confirm(): Promise<void>;
  reloadPending(): Promise<void>;
  close(): boolean;
  openLimit(opener?: HTMLElement): void;
  updateLimitDraft(patch: Partial<MarketLimitDraft>): void;
  reviewLimit(): void;
  editLimit(): void;
  finishLimitPreview(): void;
  onOpenAccount(): void;
}

function safeOrderTotal(quantityShares: number, quotedPriceWon: number): number {
  const total = quantityShares * quotedPriceWon;
  return Number.isSafeInteger(total) && total >= 0 ? total : 0;
}

export function freezeMarketOrder({
  snapshot,
  stock,
  side,
  choice,
  customSharesInput,
  quotedPriceWon,
}: FreezeMarketOrderOptions): FrozenMarketOrder {
  const holding = snapshot.account.holdings.find((item) => item.stockId === stock.id);
  const availableShares = holding?.quantityShares ?? 0;
  let quantityShares: number;
  if (choice === 'custom') quantityShares = Number(customSharesInput);
  else if (choice === 'max') {
    quantityShares = side === 'buy'
      ? maxBuyableShares(snapshot.account.cashWon, quotedPriceWon)
      : availableShares;
  } else quantityShares = choice;

  return {
    side,
    quantityShares,
    quotedPriceWon,
    quotedRevision: snapshot.revision,
    estimatedTotalWon: safeOrderTotal(quantityShares, quotedPriceWon),
    availableCashWon: snapshot.account.cashWon,
    availableShares,
  };
}

export function isStockTradingHalted(
  events: readonly MarketAdminEvent[],
  stockId: string,
  nowMs: number,
): boolean {
  return events.some((event) => {
    if (event.stockId !== stockId || event.kind !== 'halt') return false;
    const startsAtMs = Date.parse(event.startsAt);
    const endsAtMs = event.endsAt === null ? Number.POSITIVE_INFINITY : Date.parse(event.endsAt);
    return Number.isFinite(startsAtMs)
      && !Number.isNaN(endsAtMs)
      && startsAtMs <= nowMs
      && nowMs < endsAtMs;
  });
}

export function frozenOrdersMatch(left: FrozenMarketOrder, right: FrozenMarketOrder): boolean {
  return left.side === right.side
    && left.quantityShares === right.quantityShares
    && left.quotedPriceWon === right.quotedPriceWon
    && left.quotedRevision === right.quotedRevision
    && left.estimatedTotalWon === right.estimatedTotalWon
    && left.availableCashWon === right.availableCashWon
    && left.availableShares === right.availableShares;
}

function frozenOrderCommand(
  stockId: string,
  frozen: FrozenMarketOrder,
  requestId: string,
): MarketValueCommand {
  return {
    kind: frozen.side,
    requestId,
    stockId,
    quantityShares: frozen.quantityShares,
    quotedPriceWon: frozen.quotedPriceWon,
    quotedRevision: frozen.quotedRevision,
  };
}

function limitDraftError(draft: MarketLimitDraft): string | null {
  const desiredPriceWon = Number(draft.desiredPriceInput);
  const quantityShares = Number(draft.quantityInput);
  if (!Number.isSafeInteger(desiredPriceWon) || desiredPriceWon <= 0) {
    return '원하는 가격을 1원 이상 정수로 입력해 주세요.';
  }
  if (!Number.isSafeInteger(quantityShares) || quantityShares <= 0) {
    return '주문 수량을 1주 이상 정수로 입력해 주세요.';
  }
  if (!Number.isSafeInteger(desiredPriceWon * quantityShares)) return '주문 금액이 너무 커요.';
  return null;
}

export function useMarketOrderController({
  stockId,
  currentPriceWon,
  nowMs,
  onOpenAccount,
}: UseMarketOrderControllerOptions): MarketOrderController {
  const snapshot = useMarketPreviewStore((state) => state.visible);
  const mutating = useMarketPreviewStore((state) => state.mutating);
  const loading = useMarketPreviewStore((state) => state.loading);
  const pendingValueCommand = useMarketPreviewStore((state) => state.pendingValueCommand);
  const valueRefreshRequired = useMarketPreviewStore((state) => state.valueRefreshRequired);
  const sessionKey = useMarketPreviewStore((state) => state.sessionKey);
  const storeError = useMarketPreviewStore((state) => state.error);
  const load = useMarketPreviewStore((state) => state.load);
  const execute = useMarketPreviewStore((state) => state.execute);
  const clearError = useMarketPreviewStore((state) => state.clearError);
  const stock = snapshot?.stocks.find((item) => item.id === stockId) ?? null;
  const [side, setSide] = useState<MarketOrderSide>('buy');
  const [choice, setChoice] = useState<MarketShareChoice>(1);
  const [customSharesInput, setCustomSharesInputState] = useState('1');
  const [surface, setSurface] = useState<MarketOrderSurface>(null);
  const [confirmation, setConfirmation] = useState<FrozenMarketOrder | null>(null);
  const [confirmationChoice, setConfirmationChoice] = useState<MarketShareChoice>(1);
  const [pendingOrder, setPendingOrder] = useState<PendingOrderRequest | null>(null);
  const [pendingOrderUncertain, setPendingOrderUncertain] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [limitDraft, setLimitDraft] = useState<MarketLimitDraft>({
    side: 'buy', desiredPriceInput: String(currentPriceWon), quantityInput: '1',
  });
  const [limitReview, setLimitReview] = useState<MarketLimitReview | null>(null);
  const submitLockRef = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const halted = snapshot
    ? isStockTradingHalted(snapshot.adminEvents, stockId, nowMs)
    : false;
  const frozenPreview = useMemo(() => (
    snapshot && stock
      ? freezeMarketOrder({
          snapshot,
          stock,
          side,
          choice,
          customSharesInput,
          quotedPriceWon: currentPriceWon,
        })
      : null
  ), [choice, currentPriceWon, customSharesInput, side, snapshot, stock]);
  const validation = useMemo(() => {
    if (!snapshot || !stock || !frozenPreview) return '종목을 찾지 못했어요.';
    if (halted) return '현재 거래가 잠시 멈췄어요.';
    return validateMarketCommand(
      snapshot,
      frozenOrderCommand(stock.id, frozenPreview, 'preview'),
      currentPriceWon,
    );
  }, [currentPriceWon, frozenPreview, halted, snapshot, stock]);
  const pendingResolution = pendingOrderUncertain;
  const refreshRequired = valueRefreshRequired;
  const pendingCommandMismatch = pendingValueCommand !== null
    && (pendingOrder === null
      || !sameMarketValueCommand(pendingValueCommand, pendingOrder.command));
  const controlsDisabled = mutating
    || submitting
    || pendingValueCommand !== null
    || valueRefreshRequired
    || !snapshot
    || !stock;
  const confirmDisabled = mutating
    || submitting
    || loading
    || pendingCommandMismatch
    || valueRefreshRequired
    || (pendingOrder === null && halted);

  const clearFeedback = () => {
    setLocalError(null);
    clearError();
  };

  const rememberOpener = (opener?: HTMLElement) => {
    if (opener && surface === null) openerRef.current = opener;
  };

  const selectSide = (nextSide: MarketOrderSide) => {
    if (controlsDisabled) return;
    setSide(nextSide);
    setChoice(1);
    clearFeedback();
  };

  const selectChoice = (nextChoice: MarketShareChoice) => {
    if (controlsDisabled) return;
    setChoice(nextChoice);
    clearFeedback();
  };

  const setCustomSharesInput = (value: string) => {
    setCustomSharesInputState(value);
    clearFeedback();
  };

  const openSheet = (nextSide: MarketOrderSide, opener: HTMLElement) => {
    if (controlsDisabled) return;
    openerRef.current = opener;
    setSide(nextSide);
    setChoice(1);
    setSurface('mobile-order');
    clearFeedback();
  };

  const openConfirmation = (opener?: HTMLElement) => {
    if (controlsDisabled) return;
    clearFeedback();
    rememberOpener(opener);
    const latest = useMarketPreviewStore.getState().visible;
    const latestStock = latest?.stocks.find((item) => item.id === stockId);
    if (!latest || !latestStock) {
      setLocalError('종목을 찾지 못했어요.');
      return;
    }
    if (isStockTradingHalted(latest.adminEvents, stockId, nowMs)) {
      setLocalError('현재 거래가 잠시 멈췄어요.');
      return;
    }
    const frozen = freezeMarketOrder({
      snapshot: latest,
      stock: latestStock,
      side,
      choice,
      customSharesInput,
      quotedPriceWon: currentPriceWon,
    });
    const error = validateMarketCommand(
      latest,
      frozenOrderCommand(stockId, frozen, 'preview'),
      currentPriceWon,
    );
    if (error) {
      setLocalError(error);
      return;
    }
    setConfirmation(frozen);
    setConfirmationChoice(choice);
    setLocalError(null);
    setSurface('confirm');
  };

  const confirm = async () => {
    if (!confirmation || submitLockRef.current || confirmDisabled) return;
    let attempt = pendingOrder;
    if (!attempt) {
      const latest = useMarketPreviewStore.getState().visible;
      const latestStock = latest?.stocks.find((item) => item.id === stockId);
      if (!latest || !latestStock) {
        setLocalError('종목을 찾지 못했어요.');
        return;
      }
      if (isStockTradingHalted(latest.adminEvents, stockId, nowMs)) {
        setLocalError('거래가 멈춰 주문할 수 없어요.');
        return;
      }
      const refreshed = freezeMarketOrder({
        snapshot: latest,
        stock: latestStock,
        side: confirmation.side,
        choice: confirmationChoice,
        customSharesInput: String(confirmation.quantityShares),
        quotedPriceWon: currentPriceWon,
      });
      const error = validateMarketCommand(
        latest,
        frozenOrderCommand(stockId, refreshed, 'preview'),
        currentPriceWon,
      );
      if (error) {
        setLocalError(error);
        return;
      }
      if (!frozenOrdersMatch(confirmation, refreshed)) {
        setConfirmation(refreshed);
        setLocalError('가격이나 잔액이 바뀌어 내용을 새로 고쳤어요. 다시 확인해 주세요.');
        return;
      }
      attempt = createPendingMarketValueRequest(
        frozenOrderCommand(stockId, refreshed, crypto.randomUUID()),
        { frozen: refreshed, stockName: latestStock.name, choice: confirmationChoice },
      );
      setPendingOrder(attempt);
      setPendingOrderUncertain(false);
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setLocalError(null);
    clearError();
    const command = retryPendingMarketValueCommand(attempt);
    if (command.kind !== 'buy' && command.kind !== 'sell') {
      submitLockRef.current = false;
      setSubmitting(false);
      setPendingOrder(null);
      setPendingOrderUncertain(false);
      setLocalError('주문 정보를 다시 확인해 주세요.');
      return;
    }
    const succeeded = await execute(command, command.quotedPriceWon);
    submitLockRef.current = false;
    setSubmitting(false);
    if (succeeded) {
      toast.success(
        `${attempt.details.stockName} ${formatShares(attempt.details.frozen.quantityShares)}를 ${attempt.details.frozen.side === 'buy' ? '사서' : '팔아'} ${formatWon(attempt.details.frozen.estimatedTotalWon)} 주문을 마쳤어요.`,
      );
      setPendingOrder(null);
      setPendingOrderUncertain(false);
      setConfirmation(null);
      setSurface(null);
      return;
    }
    const latestState = useMarketPreviewStore.getState();
    if (latestState.pendingValueCommand === null) {
      setPendingOrder(null);
      setPendingOrderUncertain(false);
      const latest = latestState.visible;
      const latestStock = latest?.stocks.find((item) => item.id === stockId);
      if (latest && latestStock) {
        setConfirmation(freezeMarketOrder({
          snapshot: latest,
          stock: latestStock,
          side: attempt.details.frozen.side,
          choice: attempt.details.choice,
          customSharesInput: String(attempt.details.frozen.quantityShares),
          quotedPriceWon: currentPriceWon,
        }));
      }
    } else {
      setPendingOrderUncertain(true);
    }
    const message = latestState.error
      ?? '주문을 완료하지 못했어요. 다시 확인해 주세요.';
    setLocalError(message);
    toast.error(message);
  };

  const close = (): boolean => {
    if (mutating || submitting || loading || pendingOrder || pendingValueCommand || valueRefreshRequired) {
      setLocalError(pendingOrder || pendingValueCommand || valueRefreshRequired
        ? '이전 주문 결과를 확인하거나 시장 정보를 다시 불러온 뒤 닫아 주세요.'
        : '주문 저장이 끝날 때까지 잠시 기다려 주세요.');
      return false;
    }
    setSurface(null);
    setConfirmation(null);
    setLimitReview(null);
    clearFeedback();
    return true;
  };

  const reloadPending = async () => {
    if ((!pendingOrder && !valueRefreshRequired) || mutating || submitting || loading) return;
    setSubmitting(true);
    setLocalError(null);
    await load(sessionKey ?? undefined);
    setSubmitting(false);
    const latestState = useMarketPreviewStore.getState();
    if (latestState.pendingValueCommand !== null || latestState.valueRefreshRequired) {
      setLocalError(latestState.error ?? '시장 정보를 다시 불러오지 못했어요.');
      return;
    }
    setPendingOrder(null);
    setPendingOrderUncertain(false);
    setConfirmation(null);
    setSurface(null);
    toast.info('최신 계좌와 보유 상태를 다시 불러왔어요.');
  };

  const openLimit = (opener?: HTMLElement) => {
    if (controlsDisabled) return;
    clearFeedback();
    rememberOpener(opener);
    setLimitDraft({ side, desiredPriceInput: String(currentPriceWon), quantityInput: '1' });
    setLimitReview(null);
    setSurface('limit-edit');
  };

  const updateLimitDraft = (patch: Partial<MarketLimitDraft>) => {
    setLimitDraft((current) => ({ ...current, ...patch }));
    setLocalError(null);
  };

  const reviewLimit = () => {
    const error = limitDraftError(limitDraft);
    if (error) {
      setLocalError(error);
      return;
    }
    const desiredPriceWon = Number(limitDraft.desiredPriceInput);
    const quantityShares = Number(limitDraft.quantityInput);
    setLimitReview({
      side: limitDraft.side,
      desiredPriceWon,
      quantityShares,
      estimatedTotalWon: desiredPriceWon * quantityShares,
    });
    setSurface('limit-review');
    setLocalError(null);
  };

  const editLimit = () => {
    setSurface('limit-edit');
    setLocalError(null);
  };

  const finishLimitPreview = () => {
    setSurface(null);
    setLimitReview(null);
    toast.info('지정가 주문 모양을 확인했어요. 실제 예약 주문은 아직 저장되지 않아요.');
  };

  return {
    stock,
    snapshot,
    side,
    choice,
    customSharesInput,
    frozenPreview,
    confirmation,
    surface,
    limitDraft,
    limitReview,
    halted,
    controlsDisabled,
    confirmDisabled,
    pendingResolution,
    refreshRequired,
    submitting,
    validation,
    error: localError ?? storeError,
    openerRef,
    selectSide,
    selectChoice,
    setCustomSharesInput,
    openSheet,
    openConfirmation,
    confirm,
    reloadPending,
    close,
    openLimit,
    updateLimitDraft,
    reviewLimit,
    editLimit,
    finishLimitPreview,
    onOpenAccount,
  };
}
