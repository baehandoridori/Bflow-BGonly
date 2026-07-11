import { useRef, useState, type FormEvent } from 'react';
import { Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import type { MarketEventKind } from '@/features/playground/market/types';
import {
  ADMIN_WRITE_UNCERTAIN_MESSAGE,
  useMarketPreviewStore,
} from '@/features/playground/market/useMarketPreviewStore';
import { MarketActionDialog } from './MarketActionDialog';
import {
  buildMarketAdminEventInput,
  toLocalDateTimeInput,
  type MarketAdminEventDraft,
} from './marketAdminEventForm';
import {
  formatMarketAdminEventStart,
  selectManageableMarketAdminEvents,
} from './marketAdminEventList';

interface MarketAdminPanelProps {
  authorizedHansol: boolean;
}

interface AdminPreset {
  label: string;
  kind: MarketEventKind;
  title: string;
  impactBps: number;
  durationMinutes: number | null;
}

const ADMIN_PRESETS: readonly AdminPreset[] = [
  { label: '호재 뉴스', kind: 'news', title: '좋은 소식이 공개됐어요', impactBps: 120, durationMinutes: 120 },
  { label: '악재 뉴스', kind: 'news', title: '주의할 소식이 공개됐어요', impactBps: -120, durationMinutes: 120 },
  { label: '상승 충격', kind: 'shock-up', title: '갑작스러운 매수세가 들어왔어요', impactBps: 350, durationMinutes: 30 },
  { label: '하락 충격', kind: 'shock-down', title: '갑작스러운 매도세가 나왔어요', impactBps: 350, durationMinutes: 30 },
  { label: '상승 추세', kind: 'trend', title: '천천히 상승하는 흐름이에요', impactBps: 180, durationMinutes: 240 },
  { label: '하락 추세', kind: 'trend', title: '천천히 하락하는 흐름이에요', impactBps: -180, durationMinutes: 240 },
  { label: '거래 정지', kind: 'halt', title: '시장 점검으로 거래를 잠시 멈춰요', impactBps: 0, durationMinutes: 30 },
];

function draftFromPreset(preset: AdminPreset, stockId: string): MarketAdminEventDraft {
  const startsAt = new Date();
  const endsAt = preset.durationMinutes === null
    ? null
    : new Date(startsAt.getTime() + preset.durationMinutes * 60_000);
  return {
    stockId,
    kind: preset.kind,
    title: preset.title,
    impactBpsInput: String(preset.impactBps),
    startsAtInput: toLocalDateTimeInput(startsAt),
    endsAtInput: endsAt ? toLocalDateTimeInput(endsAt) : '',
    indefinite: false,
  };
}

export function MarketAdminPanel({ authorizedHansol }: MarketAdminPanelProps) {
  const snapshot = useMarketPreviewStore((state) => state.visible);
  const mutating = useMarketPreviewStore((state) => state.mutating);
  const loading = useMarketPreviewStore((state) => state.loading);
  const adminWriteUncertain = useMarketPreviewStore((state) => state.adminWriteUncertain);
  const sessionKey = useMarketPreviewStore((state) => state.sessionKey);
  const storeError = useMarketPreviewStore((state) => state.error);
  const load = useMarketPreviewStore((state) => state.load);
  const createAdminEvent = useMarketPreviewStore((state) => state.createAdminEvent);
  const deleteAdminEvent = useMarketPreviewStore((state) => state.deleteAdminEvent);
  const clearError = useMarketPreviewStore((state) => state.clearError);
  const openerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [draft, setDraft] = useState<MarketAdminEventDraft>(() => (
    draftFromPreset(ADMIN_PRESETS[0], 'jbbj')
  ));

  if (!authorizedHansol) return null;
  if (!snapshot) return null;
  const manageableEvents = selectManageableMarketAdminEvents(snapshot.adminEvents, Date.now());

  const selectPreset = (preset: AdminPreset) => {
    setDraft(draftFromPreset(preset, draft.stockId));
    setLocalError(null);
    clearError();
  };

  const close = () => {
    if (saving || mutating) {
      setLocalError('저장이 끝날 때까지 잠시 기다려 주세요.');
      return;
    }
    setOpen(false);
    setLocalError(null);
    clearError();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || mutating) return;
    const result = buildMarketAdminEventInput(draft);
    if (!result.input) {
      setLocalError(result.error);
      return;
    }
    setSaving(true);
    setLocalError(null);
    clearError();
    const succeeded = await createAdminEvent(result.input);
    setSaving(false);
    if (succeeded) {
      toast.success('시장 이벤트를 저장하고 최신 시장 정보로 갱신했어요.');
      return;
    }
    const message = useMarketPreviewStore.getState().error ?? '시장 이벤트를 저장하지 못했어요.';
    setLocalError(message);
    toast.error(message);
  };

  const remove = async (eventId: string) => {
    if (saving || mutating) return;
    setSaving(true);
    setLocalError(null);
    clearError();
    const succeeded = await deleteAdminEvent(eventId);
    setSaving(false);
    if (succeeded) {
      toast.success('효과를 종료하고 이벤트 기록도 삭제했어요.');
      return;
    }
    const message = useMarketPreviewStore.getState().error ?? '시장 이벤트를 종료하지 못했어요.';
    setLocalError(message);
    toast.error(message);
  };

  const reloadAuthoritativeState = async () => {
    if (saving || mutating || loading) return;
    setSaving(true);
    setLocalError(null);
    await load(sessionKey ?? undefined);
    setSaving(false);
  };

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-bg-border px-3 py-2 text-sm font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Settings2 aria-hidden="true" size={17} />
        시장 관리
      </button>
      <MarketActionDialog
        open={open}
        title="시장 관리"
        description="종목에 뉴스, 가격 영향 또는 거래 정지를 한 번만 저장합니다."
        openerRef={openerRef}
        onClose={close}
      >
        <form onSubmit={(event) => void submit(event)}>
          {adminWriteUncertain && (
            <div className="mb-5 rounded-2xl border border-market-news/45 bg-market-news/10 p-4" role="alert">
              <p className="text-sm font-semibold leading-6 text-text-primary">
                {ADMIN_WRITE_UNCERTAIN_MESSAGE}
              </p>
              <button
                type="button"
                disabled={saving || mutating || loading}
                onClick={() => void reloadAuthoritativeState()}
                className="mt-3 min-h-11 w-full cursor-pointer rounded-xl border border-bg-border px-4 py-2 text-sm font-bold text-text-primary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                시장 정보 다시 확인
              </button>
            </div>
          )}
          <fieldset disabled={saving || mutating || adminWriteUncertain} className="min-w-0 disabled:opacity-60">
            <legend className="sr-only">시장 이벤트 입력</legend>
            <p className="text-sm font-semibold text-text-primary">빠른 설정</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ADMIN_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={draft.kind === preset.kind && draft.title === preset.title}
                  onClick={() => selectPreset(preset)}
                  className="min-h-11 cursor-pointer rounded-xl border border-bg-border px-2 py-2 text-xs font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-text-primary"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <label htmlFor="market-admin-stock" className="mt-5 block text-sm font-semibold text-text-primary">종목</label>
            <select
              id="market-admin-stock"
              value={draft.stockId}
              onChange={(event) => setDraft((current) => ({ ...current, stockId: event.target.value }))}
              className="mt-2 min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              {snapshot.stocks.map((stock) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
            </select>

            <label htmlFor="market-admin-kind" className="mt-4 block text-sm font-semibold text-text-primary">이벤트 종류</label>
            <select
              id="market-admin-kind"
              value={draft.kind}
              onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as MarketEventKind }))}
              className="mt-2 min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              <option value="news">뉴스</option>
              <option value="shock-up">상승 충격</option>
              <option value="shock-down">하락 충격</option>
              <option value="trend">추세</option>
              <option value="halt">거래 정지</option>
            </select>

            <label htmlFor="market-admin-title" className="mt-4 block text-sm font-semibold text-text-primary">제목</label>
            <input
              id="market-admin-title"
              maxLength={160}
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              className="mt-2 min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />

            <label htmlFor="market-admin-impact" className="mt-4 block text-sm font-semibold text-text-primary">가격 영향 (bp, +/−)</label>
            <input
              id="market-admin-impact"
              type="number"
              step="1"
              inputMode="numeric"
              value={draft.impactBpsInput}
              onChange={(event) => setDraft((current) => ({ ...current, impactBpsInput: event.target.value }))}
              className="mt-2 min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base tabular-nums text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="market-admin-start" className="block text-sm font-semibold text-text-primary">시작</label>
                <input
                  id="market-admin-start"
                  type="datetime-local"
                  value={draft.startsAtInput}
                  onChange={(event) => setDraft((current) => ({ ...current, startsAtInput: event.target.value }))}
                  className="mt-2 min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label htmlFor="market-admin-end" className="block text-sm font-semibold text-text-primary">종료 (선택)</label>
                <input
                  id="market-admin-end"
                  type="datetime-local"
                  disabled={draft.indefinite}
                  value={draft.endsAtInput}
                  onChange={(event) => setDraft((current) => ({ ...current, endsAtInput: event.target.value }))}
                  className="mt-2 min-h-11 w-full rounded-xl border border-bg-border bg-bg-primary/45 px-3 py-2 text-base text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
                />
              </div>
            </div>
            {draft.kind === 'halt' && (
              <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm font-semibold text-text-primary focus-within:ring-2 focus-within:ring-accent">
                <input
                  type="checkbox"
                  checked={draft.indefinite}
                  onChange={(event) => setDraft((current) => ({ ...current, indefinite: event.target.checked }))}
                  className="h-5 w-5 accent-accent"
                />
                종료 시간을 정하지 않고 무기한 정지
              </label>
            )}
          </fieldset>

          <p className="mt-3 min-h-5 text-sm font-semibold text-text-primary" aria-live="polite">
            {localError ?? storeError ?? ''}
          </p>
          <button
            type="submit"
            disabled={saving || mutating || adminWriteUncertain}
            className="mt-2 min-h-12 w-full cursor-pointer rounded-xl bg-accent px-4 py-3 text-sm font-bold text-on-accent transition-colors duration-200 motion-reduce:transition-none hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '저장하는 중…' : '시장에 적용하기'}
          </button>
        </form>

        <section className="mt-6 border-t border-bg-border pt-5" aria-labelledby="active-market-events-heading">
          <h3 id="active-market-events-heading" className="text-sm font-bold text-text-primary">적용 중 · 예정</h3>
          {manageableEvents.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {manageableEvents.map((row) => {
                const event = row.event;
                return (
                  <li key={event.id} className="flex min-w-0 flex-col items-stretch justify-between gap-3 rounded-xl bg-bg-primary/45 p-3 sm:flex-row sm:items-center">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-text-primary">{event.title}</span>
                      <span className="mt-1 block text-xs font-semibold text-text-primary">
                        {row.status === 'active'
                          ? '적용 중'
                          : row.status === 'scheduled' && row.startsAtMs !== null
                            ? `예정 · ${formatMarketAdminEventStart(row.startsAtMs)}`
                            : '시간 확인 필요'}
                      </span>
                      <span className="mt-1 block text-xs text-text-secondary">{event.kind} · {event.impactBps > 0 ? '+' : ''}{event.impactBps}bp</span>
                    </span>
                    <button
                      type="button"
                      disabled={saving || mutating || adminWriteUncertain}
                      onClick={() => void remove(event.id)}
                      className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-bg-border px-3 py-2 text-xs font-semibold text-text-secondary transition-colors duration-200 motion-reduce:transition-none hover:bg-bg-border/35 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:shrink-0"
                      aria-label={`${event.title} 효과 종료 및 기록 삭제`}
                    >
                      <Trash2 aria-hidden="true" size={16} />
                      효과 종료 · 기록도 삭제
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text-secondary">적용 중이거나 예정된 이벤트가 없어요.</p>
          )}
        </section>
      </MarketActionDialog>
    </>
  );
}
