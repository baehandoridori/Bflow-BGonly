import type {
  MarketAdminEventInput,
  MarketEventKind,
} from '@/features/playground/market/types';

export interface MarketAdminEventDraft {
  stockId: string;
  kind: MarketEventKind;
  title: string;
  impactBpsInput: string;
  startsAtInput: string;
  endsAtInput: string;
  indefinite: boolean;
}

export interface MarketAdminEventBuildResult {
  input: MarketAdminEventInput | null;
  error: string | null;
}

export function toLocalDateTimeInput(value: Date): string {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function buildMarketAdminEventInput(
  draft: MarketAdminEventDraft,
): MarketAdminEventBuildResult {
  const title = draft.title.trim();
  const impactBps = Number(draft.impactBpsInput);
  const startsAtMs = Date.parse(draft.startsAtInput);
  const endsAtMs = draft.indefinite || !draft.endsAtInput
    ? null
    : Date.parse(draft.endsAtInput);

  if (!draft.stockId) return { input: null, error: '종목을 선택해 주세요.' };
  if (!title || title.length > 160) return { input: null, error: '제목을 1~160자로 입력해 주세요.' };
  if (!Number.isSafeInteger(impactBps)) return { input: null, error: '영향을 정수 bp로 입력해 주세요.' };
  if (!Number.isFinite(startsAtMs)) return { input: null, error: '시작 시간을 확인해 주세요.' };
  if (draft.kind === 'halt' && endsAtMs === null && !draft.indefinite) {
    return { input: null, error: '거래 정지는 종료 시간을 넣거나 무기한을 선택해 주세요.' };
  }
  if (endsAtMs !== null && (!Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs)) {
    return { input: null, error: '종료 시간은 시작 시간보다 뒤여야 해요.' };
  }
  if ((draft.kind === 'shock-up' || draft.kind === 'shock-down') && impactBps <= 0) {
    return { input: null, error: '상승·하락 충격의 크기는 1bp 이상이어야 해요.' };
  }
  if (draft.kind === 'halt' && impactBps !== 0) {
    return { input: null, error: '거래 정지의 가격 영향은 0bp여야 해요.' };
  }

  return {
    input: {
      stockId: draft.stockId,
      kind: draft.kind,
      title,
      impactBps,
      startsAt: new Date(startsAtMs).toISOString(),
      endsAt: endsAtMs === null ? null : new Date(endsAtMs).toISOString(),
    },
    error: null,
  };
}
