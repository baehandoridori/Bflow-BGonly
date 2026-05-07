import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/utils/cn';
import type { UpdateInfo } from '@/types';

function createFallbackUpdateInfo(message = '업데이트 상태를 아직 확인하지 않았습니다.'): UpdateInfo {
  return {
    status: 'up-to-date',
    currentVersion: __APP_VERSION__,
    latestVersion: __APP_VERSION__,
    buildAt: '',
    ready: false,
    releaseNotes: [],
    message,
  };
}

function formatBuildTime(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCheckedAt(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatBytes(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  const mb = value / 1024 / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)}MB`;
}

export function UpdateCenterModal() {
  const updateInfo = useAppStore((s) => s.updateInfo);
  const updateCenterOpen = useAppStore((s) => s.updateCenterOpen);
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo);
  const setUpdateCenterOpen = useAppStore((s) => s.setUpdateCenterOpen);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const nextInfo = await window.electronAPI?.checkForUpdates?.();
      setUpdateInfo(nextInfo ?? createFallbackUpdateInfo('G드라이브 업데이트 정보를 찾지 못했습니다. 현재 버전으로 계속 사용할 수 있습니다.'));
      setLastCheckedAt(new Date());
    } catch {
      const message = '업데이트 상태를 새로 확인하지 못했습니다. 잠시 후 다시 시도해주세요.';
      setRefreshError(message);
      setUpdateInfo({
        ...createFallbackUpdateInfo(message),
        status: 'failed',
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, setUpdateInfo]);

  useEffect(() => {
    if (!updateCenterOpen) return;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setUpdateCenterOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const modal = modalRef.current;
      if (!modal) return;
      const focusable = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), '
          + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [updateCenterOpen, setUpdateCenterOpen]);

  useEffect(() => {
    if (!updateCenterOpen || updateInfo) return;
    void handleRefresh();
  }, [handleRefresh, updateCenterOpen, updateInfo]);

  if (!updateCenterOpen) return null;

  const displayInfo = updateInfo ?? createFallbackUpdateInfo();
  const hasRemoteUpdate = displayInfo.latestVersion !== displayInfo.currentVersion
    && displayInfo.status !== 'suppressed'
    && displayInfo.status !== 'up-to-date';
  const isPreparing = hasRemoteUpdate && (displayInfo.status === 'available' || displayInfo.status === 'downloading');
  const isApplying = displayInfo.status === 'applying';
  const canApply = displayInfo.ready && hasRemoteUpdate && !isApplying;
  const isFailed = displayInfo.status === 'failed';
  const isSuppressed = displayInfo.status === 'suppressed';
  const shouldHighlightLatest = hasRemoteUpdate && !isFailed;
  const downloadPercent = displayInfo.totalBytes && displayInfo.downloadedBytes != null
    ? Math.min(100, Math.max(0, Math.round((displayInfo.downloadedBytes / displayInfo.totalBytes) * 100)))
    : null;
  const statusText = isRefreshing
    ? '확인 중'
    : canApply
      ? '즉시 적용 가능'
      : isApplying
        ? '적용 중'
        : isPreparing
          ? '준비 중'
          : isFailed
            ? '준비 실패'
            : isSuppressed
              ? '자동 중단'
              : '최신 상태';
  const latestLabel = hasRemoteUpdate ? '준비된 최신 버전' : '업데이트 상태';
  const statusDescription = isRefreshing
    ? 'G드라이브 배포 정보를 다시 확인하고 있습니다.'
    : canApply
      ? '설치 파일이 로컬에 준비되었습니다. 적용하면 별도 진행 창이 뜬 뒤 새 버전으로 다시 열립니다.'
      : isApplying
        ? '업데이트 설치 창을 여는 중입니다. 앱이 잠시 닫혀도 정상 진행 중입니다.'
        : displayInfo.message
          ?? (isPreparing
            ? '새 버전 설치 파일을 로컬로 준비하고 있습니다. 준비되면 여기서 바로 적용할 수 있습니다.'
            : isFailed || isSuppressed
              ? '자동 업데이트 상태를 확인한 뒤 필요하면 정식 설치 파일로 갱신합니다.'
              : '현재 앱이 최신 상태입니다.');
  const notes = displayInfo.releaseNotes.length > 0
    ? displayInfo.releaseNotes
    : [{
      version: displayInfo.latestVersion,
      title: isFailed || isSuppressed ? '업데이트 상태 안내' : '업데이트 내역 확인',
      items: [
        isSuppressed
          ? '이전 업데이트 적용 실패 후 자동 재시도가 중단되어 있습니다. 정식 설치 파일로 갱신하거나 진단 로그를 확인해야 합니다.'
          : isFailed
            ? displayInfo.message ?? '업데이트 준비 중 문제가 발생했습니다. 다음 확인 때 다시 시도합니다.'
            : hasRemoteUpdate
              ? '새 버전이 준비되어 있습니다. 지금 업데이트하거나 앱을 종료할 때 적용할 수 있습니다.'
              : '새로고침을 누르면 G드라이브 배포 정보에서 버전별 업데이트 내역을 다시 불러옵니다.',
      ],
    }];
  const buildTime = formatBuildTime(displayInfo.buildAt);
  const checkedAtText = formatCheckedAt(lastCheckedAt);

  const handleApply = () => {
    if (!canApply) return;
    setUpdateInfo({
      ...displayInfo,
      status: 'applying',
      message: '업데이트 설치 창을 여는 중입니다. 앱이 잠시 후 닫힙니다.',
    });
    window.electronAPI?.applyUpdateNow?.();
  };

  return (
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/55 backdrop-blur-sm px-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-center-title"
        tabIndex={-1}
        className="w-full max-w-[720px] max-h-[86vh] overflow-hidden rounded-2xl border border-bg-border bg-bg-card/95 shadow-2xl shadow-black/40"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-bg-border/50">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-secondary">Version Center</p>
            <h2 id="update-center-title" className="mt-2 text-xl font-bold text-text-primary tracking-tight">업데이트 내역</h2>
            <p className="mt-1 text-sm text-text-secondary leading-relaxed">
              현재 버전, 최신 버전, 버전별 변경 내역을 확인합니다.
            </p>
            {checkedAtText && (
              <p className="mt-1 text-[11px] text-text-secondary/70">마지막 확인 {checkedAtText}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing || isApplying}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors',
                isRefreshing || isApplying
                  ? 'cursor-default border-bg-border bg-bg-border/20 text-text-secondary'
                  : 'cursor-pointer border-accent/30 bg-accent/10 text-accent-sub hover:bg-accent/18',
              )}
            >
              <RefreshCw size={14} className={cn(isRefreshing && 'animate-spin')} />
              새로고침
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setUpdateCenterOpen(false)}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-border/50 transition-colors cursor-pointer"
              aria-label="업데이트 내역 닫기"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(86vh-96px)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-bg-border/60 bg-bg-primary/35 p-4">
              <p className="text-xs text-text-secondary">현재 사용 중</p>
              <p className="mt-2 text-2xl font-bold text-text-primary tracking-tight">
                v{displayInfo.currentVersion}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                지금 이 버전으로 작업하고 있습니다. 업데이트 전까지 현재 화면은 유지됩니다.
              </p>
            </div>

            <div
              className={cn(
                'rounded-2xl border p-4',
                shouldHighlightLatest
                  ? 'bflow-update-latest-card border-accent/35 bg-accent/10'
                  : isFailed || isSuppressed
                    ? 'border-[#FDCB6E]/35 bg-[#FDCB6E]/10'
                    : 'border-bg-border/60 bg-bg-primary/35',
              )}
            >
              <p className="relative z-10 text-xs text-text-secondary">{latestLabel}</p>
              <div className="relative z-10 mt-2 flex items-center justify-between gap-3">
                <p
                  className={cn(
                    'text-2xl font-bold tracking-tight',
                    shouldHighlightLatest
                      ? 'text-accent-sub'
                      : isFailed || isSuppressed
                        ? 'text-[#FDCB6E]'
                        : 'text-text-primary',
                  )}
                >
                  v{displayInfo.latestVersion}
                </p>
                <button
                  type="button"
                  disabled={!canApply}
                  onClick={handleApply}
                  aria-label={canApply ? '즉시 업데이트' : statusText}
                  className={cn(
                    'group relative overflow-hidden rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-300',
                    canApply && 'bflow-update-apply-chip',
                    canApply
                      ? 'border-accent/35 bg-accent/15 text-accent-sub hover:border-accent/60 hover:bg-accent/25 cursor-pointer'
                      : 'border-bg-border bg-bg-border/20 text-text-secondary cursor-default',
                  )}
                >
                  <span className="relative z-10 inline-flex items-center gap-1.5">
                    {canApply ? <Download size={13} /> : <RefreshCw size={13} className={cn((isPreparing || isApplying || isRefreshing) && 'animate-spin')} />}
                    <span className="relative inline-block h-4 min-w-[76px] overflow-hidden text-center">
                      {canApply ? (
                        <>
                          <span className="absolute inset-0 transition-all duration-300 group-hover:-translate-y-2 group-hover:opacity-0 group-focus-visible:-translate-y-2 group-focus-visible:opacity-0">
                            {statusText}
                          </span>
                          <span className="absolute inset-0 translate-y-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                            즉시 업데이트
                          </span>
                        </>
                      ) : (
                        <span className="inline">{statusText}</span>
                      )}
                    </span>
                  </span>
                </button>
              </div>
              <p className="relative z-10 mt-2 text-xs leading-relaxed text-text-secondary">
                {statusDescription}
              </p>
              {refreshError && (
                <p className="relative z-10 mt-2 text-[11px] text-[#FDCB6E]">{refreshError}</p>
              )}
              {(isPreparing || isApplying) && displayInfo.totalBytes && (
                <div className="relative z-10 mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-bg-border/70">
                    <div
                      className={cn(
                        'h-full rounded-full bg-gradient-to-r from-accent to-accent-sub transition-all duration-300',
                        isApplying && 'bflow-update-progress-pulse',
                      )}
                      style={{ width: `${downloadPercent ?? 100}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-text-secondary/75">
                    {isApplying
                      ? '설치 적용 중'
                      : downloadPercent != null
                        ? `${downloadPercent}% 준비됨 · ${formatBytes(displayInfo.downloadedBytes)} / ${formatBytes(displayInfo.totalBytes)}`
                        : `설치 파일 준비 중 · ${formatBytes(displayInfo.totalBytes)}`}
                  </p>
                </div>
              )}
              {buildTime && (
                <p className="relative z-10 mt-2 text-[11px] text-text-secondary/70">
                  빌드 시각 {buildTime}
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {notes.map((note, noteIndex) => (
              <div
                key={`${note.version}-${note.title}-${noteIndex}`}
                className="rounded-2xl border border-bg-border/55 bg-bg-primary/25 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-text-primary">
                    {note.title || `v${note.version || displayInfo.latestVersion}`}
                  </p>
                  <span className="shrink-0 rounded-full border border-bg-border/70 px-2.5 py-1 text-[11px] font-mono text-text-secondary">
                    v{note.version || displayInfo.latestVersion}
                  </span>
                </div>
                <ul className="mt-3 space-y-2">
                  {note.items.map((item, itemIndex) => (
                    <li key={`${item}-${itemIndex}`} className="flex gap-2 text-sm leading-relaxed text-text-secondary">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs leading-relaxed text-text-secondary">
              업데이트가 준비되지 않았거나 실패해도 현재 버전으로 먼저 작업할 수 있습니다.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUpdateCenterOpen(false)}
                className="px-4 py-2 rounded-xl border border-bg-border text-sm text-text-secondary hover:text-text-primary hover:bg-bg-border/35 transition-colors cursor-pointer"
              >
                닫기
              </button>
              <button
                type="button"
                disabled={!canApply}
                onClick={handleApply}
                className={cn(
                  'px-4 py-2 rounded-xl border text-sm font-semibold transition-colors',
                  canApply
                    ? 'border-accent/35 bg-accent/15 text-accent-sub hover:bg-accent/25 cursor-pointer'
                    : 'border-bg-border bg-bg-border/20 text-text-secondary cursor-default',
                )}
              >
                지금 업데이트
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
