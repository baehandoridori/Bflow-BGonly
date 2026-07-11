import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import { toast } from 'sonner';

import { getAccountSummary, validateMarketCommand } from '@/features/playground/market/domain';
import { formatPoints, formatWon } from '@/features/playground/market/format';
import {
  createPendingMarketValueRequest,
  retryPendingMarketValueCommand,
  sameMarketValueCommand,
  type PendingMarketValueRequest,
} from '@/features/playground/market/pendingValueRequest';
import type { MarketCommand } from '@/features/playground/market/types';
import {
  useMarketPreviewStore,
  VALUE_REFRESH_REQUIRED_MESSAGE,
} from '@/features/playground/market/useMarketPreviewStore';
import { MarketActionDialog } from './MarketActionDialog';
import { requestPointTransferDialogClose } from './pointTransferDialogState';

interface PointTransferDialogProps {
  direction: 'wallet-to-broker' | 'broker-to-wallet';
  open: boolean;
  openerRef: RefObject<HTMLElement>;
  onClose(): void;
}

const TRANSFER_PRESETS = [1000, 5000] as const;

interface PendingTransferDetails {
  direction: 'wallet-to-broker' | 'broker-to-wallet';
  points: number;
  sourceBalance: number;
  destinationBalance: number;
}

type PendingTransferRequest = PendingMarketValueRequest<PendingTransferDetails>;

export function PointTransferDialog({
  direction,
  open,
  openerRef,
  onClose,
}: PointTransferDialogProps) {
  const visible = useMarketPreviewStore((state) => state.visible);
  const confirmed = useMarketPreviewStore((state) => state.confirmed);
  const mutating = useMarketPreviewStore((state) => state.mutating);
  const loading = useMarketPreviewStore((state) => state.loading);
  const valueRefreshRequired = useMarketPreviewStore((state) => state.valueRefreshRequired);
  const pendingValueCommand = useMarketPreviewStore((state) => state.pendingValueCommand);
  const sessionKey = useMarketPreviewStore((state) => state.sessionKey);
  const storeError = useMarketPreviewStore((state) => state.error);
  const load = useMarketPreviewStore((state) => state.load);
  const execute = useMarketPreviewStore((state) => state.execute);
  const clearError = useMarketPreviewStore((state) => state.clearError);
  const [amountInput, setAmountInput] = useState('1000');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransferRequest | null>(null);
  const [pendingTransferUncertain, setPendingTransferUncertain] = useState(false);
  const submitLockRef = useRef(false);
  const amountInputId = useId();

  const isDeposit = direction === 'wallet-to-broker';
  const title = isDeposit ? '투자 계좌에 포인트 넣기' : '투자 계좌에서 포인트 빼기';
  const sourceLabel = isDeposit ? '포인트 지갑 잔액' : '꺼낼 수 있는 예수금';
  const resultLabel = isDeposit ? '이동 후 예수금' : '이동 후 포인트 지갑';
  const actionLabel = isDeposit ? '넣기' : '빼기';
  const pendingResolution = pendingTransferUncertain;
  const pendingCommandMismatch = pendingValueCommand !== null
    && (pendingTransfer === null
      || !sameMarketValueCommand(pendingValueCommand, pendingTransfer.command));
  const controlsDisabled = submitting
    || mutating
    || loading
    || pendingValueCommand !== null
    || valueRefreshRequired;
  const balanceSnapshot = submitting || mutating || pendingResolution || valueRefreshRequired
    ? confirmed ?? visible
    : visible;
  const summary = balanceSnapshot ? getAccountSummary(balanceSnapshot) : null;
  const sourceBalance = summary
    ? (isDeposit ? summary.walletPoints : summary.cashWon)
    : 0;
  const amount = Number(amountInput);
  const amountIsValidInteger = Number.isSafeInteger(amount) && amount > 0;
  const previewCommand: MarketCommand = {
    kind: 'transfer',
    requestId: 'preview',
    direction,
    points: amount,
  };
  const validation = balanceSnapshot
    ? validateMarketCommand(balanceSnapshot, previewCommand)
    : '계좌 정보를 불러오지 못했어요';
  const resultBalance = summary && validation === null && amountIsValidInteger
    ? (isDeposit ? summary.cashWon : summary.walletPoints) + amount
    : null;
  const displayedError = localError ?? validation ?? storeError;

  useEffect(() => {
    if (!open) return;
    const state = useMarketPreviewStore.getState();
    if (state.pendingValueCommand !== null || state.valueRefreshRequired) return;
    setAmountInput('1000');
    setPendingTransfer(null);
    setPendingTransferUncertain(false);
    setLocalError(null);
    clearError();
  }, [clearError, direction, open, valueRefreshRequired]);

  const clearFeedback = () => {
    setLocalError(null);
    clearError();
  };

  const updateAmount = (value: string) => {
    clearFeedback();
    setAmountInput(value);
  };

  const submitTransfer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || mutating || loading || submitLockRef.current) return;

    if (useMarketPreviewStore.getState().valueRefreshRequired) {
      setLocalError(VALUE_REFRESH_REQUIRED_MESSAGE);
      return;
    }

    let attempt = pendingTransfer;
    if (!attempt) {
      if (useMarketPreviewStore.getState().pendingValueCommand !== null) {
        setLocalError('이전 거래 결과를 먼저 확인하거나 계좌 정보를 다시 불러와 주세요.');
        return;
      }
      const latest = useMarketPreviewStore.getState().visible;
      if (!latest) {
        setLocalError('계좌 정보를 불러오지 못했어요');
        return;
      }

      const points = Number(amountInput);
      const validationMessage = validateMarketCommand(latest, {
        kind: 'transfer',
        requestId: 'preview',
        direction,
        points,
      });
      if (validationMessage) {
        setLocalError(validationMessage);
        return;
      }

      const latestSummary = getAccountSummary(latest);
      const sourceBalance = direction === 'wallet-to-broker'
        ? latestSummary.walletPoints
        : latestSummary.cashWon;
      const destinationBalance = direction === 'wallet-to-broker'
        ? latestSummary.cashWon
        : latestSummary.walletPoints;
      attempt = createPendingMarketValueRequest({
        kind: 'transfer',
        requestId: crypto.randomUUID(),
        direction,
        points,
      }, {
        direction,
        points,
        sourceBalance,
        destinationBalance,
      });
      setPendingTransfer(attempt);
      setPendingTransferUncertain(false);
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setLocalError(null);
    clearError();
    const command = retryPendingMarketValueCommand(attempt);
    if (command.kind !== 'transfer') {
      submitLockRef.current = false;
      setSubmitting(false);
      setPendingTransfer(null);
      setPendingTransferUncertain(false);
      setLocalError('포인트 이동 정보를 다시 확인해 주세요.');
      return;
    }
    const succeeded = await execute(command);
    submitLockRef.current = false;
    setSubmitting(false);

    if (succeeded) {
      toast.success(
        `${formatPoints(attempt.details.points)}를 ${attempt.details.direction === 'wallet-to-broker' ? '투자 계좌에 넣었어요.' : '포인트 지갑으로 뺐어요.'}`,
      );
      setPendingTransfer(null);
      setPendingTransferUncertain(false);
      requestPointTransferDialogClose({
        blocked: false,
        setLocalError,
        clearError,
        onClose,
      });
      return;
    }

    const latestState = useMarketPreviewStore.getState();
    if (latestState.pendingValueCommand === null) {
      setPendingTransfer(null);
      setPendingTransferUncertain(false);
    } else {
      setPendingTransferUncertain(true);
    }
    const message = latestState.error
      ?? '포인트를 이동하지 못했어요. 다시 확인해 주세요.';
    setLocalError(message);
    toast.error(message);
  };

  const closeTransferDialog = () => {
    if (pendingTransfer || pendingValueCommand || valueRefreshRequired) {
      setLocalError('이동 결과를 확인하거나 계좌 정보를 다시 불러온 뒤 닫아 주세요.');
      return;
    }
    requestPointTransferDialogClose({
      blocked: submitting || mutating || loading,
      setLocalError,
      clearError,
      onClose,
    });
  };

  const reloadPendingTransfer = async () => {
    if (
      (!pendingTransfer && !valueRefreshRequired)
      || submitting
      || mutating
      || loading
      || submitLockRef.current
    ) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setLocalError(null);
    await load(sessionKey ?? undefined);
    submitLockRef.current = false;
    setSubmitting(false);
    const latestState = useMarketPreviewStore.getState();
    if (latestState.pendingValueCommand !== null || latestState.valueRefreshRequired) {
      setLocalError(latestState.error ?? '계좌 정보를 다시 불러오지 못했어요.');
      return;
    }
    setPendingTransfer(null);
    setPendingTransferUncertain(false);
    toast.info('최신 포인트 지갑과 투자 계좌를 다시 불러왔어요.');
    requestPointTransferDialogClose({
      blocked: false,
      setLocalError,
      clearError,
      onClose,
    });
  };

  return (
    <MarketActionDialog
      open={open}
      title={title}
      description={`${sourceLabel}에서 옮길 포인트를 선택합니다.`}
      openerRef={openerRef}
      onClose={closeTransferDialog}
    >
      <form onSubmit={(event) => void submitTransfer(event)}>
        <div className="rounded-2xl bg-bg-primary/45 p-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-text-secondary">{sourceLabel}</span>
            <strong className="tabular-nums text-text-primary">
              {isDeposit ? formatPoints(sourceBalance) : formatWon(sourceBalance)}
            </strong>
          </div>
        </div>

        <fieldset disabled={controlsDisabled} className="mt-5 min-w-0 disabled:opacity-60">
          <legend className="sr-only">{title}</legend>
          <label htmlFor={amountInputId} className="text-sm font-semibold text-text-primary">
            {isDeposit ? '넣을 금액' : '뺄 금액'}
          </label>
          <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <input
              id={amountInputId}
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={amountInput}
              onChange={(event) => updateAmount(event.target.value)}
              className="min-h-12 min-w-0 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base tabular-nums text-text-primary outline-none transition-colors duration-200 focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
            <output
              htmlFor={amountInputId}
              className="max-w-32 break-words text-right text-sm font-semibold tabular-nums text-text-primary"
            >
              {amountIsValidInteger ? formatPoints(amount) : '금액 확인'}
            </output>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {TRANSFER_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => updateAmount(String(preset))}
                className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-2 py-2 text-sm font-semibold tabular-nums text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {formatPoints(preset)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => updateAmount(String(sourceBalance))}
              className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-2 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              전부
            </button>
          </div>
        </fieldset>

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-bg-border pt-4 text-sm">
          <span className="text-text-secondary">{resultLabel}</span>
          <strong className="tabular-nums text-text-primary">
            {resultBalance === null
              ? '—'
              : isDeposit ? formatWon(resultBalance) : formatPoints(resultBalance)}
          </strong>
        </div>

        <div className="mt-4 space-y-1 text-xs leading-5 text-text-secondary">
          <p>1P = 1원</p>
          <p>수수료가 없고 투자 실적에는 포함되지 않아요</p>
          <p>투자 중인 포인트는 주식을 판 뒤 뺄 수 있어요</p>
        </div>

        <p className="mt-3 min-h-5 text-sm font-semibold text-text-primary" aria-live="polite">
          {displayedError ?? ''}
        </p>
        {(pendingResolution || valueRefreshRequired) && (
          <p className="mt-1 text-xs leading-5 text-text-secondary">
            {pendingResolution
              ? '이동 결과를 받지 못했어요. 같은 요청을 다시 확인하면 포인트가 중복으로 이동하지 않아요.'
              : '서버의 최신 잔액을 확인해야 다음 포인트 이동을 안전하게 시작할 수 있어요.'}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || mutating || loading || valueRefreshRequired || pendingCommandMismatch || (!pendingTransfer && validation !== null)}
          className="mt-2 min-h-12 w-full cursor-pointer rounded-xl bg-accent px-4 py-3 text-sm font-bold text-on-accent transition-colors duration-200 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting
            ? pendingResolution ? '이동 결과를 확인하는 중…' : '포인트 이동 중…'
            : pendingResolution
              ? '이동 결과 다시 확인'
              : `${amountIsValidInteger ? formatPoints(amount) : '0P'} ${actionLabel}`}
        </button>
        {(pendingResolution || valueRefreshRequired) && (
          <button
            type="button"
            disabled={submitting || mutating || loading}
            onClick={() => void reloadPendingTransfer()}
            className="mt-2 min-h-11 w-full cursor-pointer rounded-xl border border-bg-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            계좌 정보 다시 불러오기
          </button>
        )}
      </form>
    </MarketActionDialog>
  );
}
