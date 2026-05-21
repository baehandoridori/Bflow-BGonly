/**
 * 컴포지팅 씬 상세 모달.
 *
 * - 헤더 (sceneId · EP · 파트 · n번째 컷)
 * - 이미지 두 장 (가이드 / 실제) — 크게
 * - 단계 변경 그리드 (6 칩 — 컴포지터만 활성)
 * - status='error' 일 때 오류 사유 5+기타 칩
 * - 담당자 (BG / ACT)
 * - 활동 기록 (간단 — 최신 변경 정보 1줄)
 * - 키보드 단축키: 1~6 단계, Esc 닫기, ← → prev/next 씬
 *
 * spec: 2026-05-21-compositing-dashboard-design.md (9.x)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { CompositingErrorKind, CompositingState, CompositingStatus } from '@/types';
import {
  COMPOSITING_STATUS_LABEL,
  COMPOSITING_STATUS_ORDER,
  COMPOSITING_STATUS_TOKEN,
  COMPOSITING_ERROR_LABEL,
} from '@/utils/compositingLabels';
import { useDataStore, compositingKey } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { buildCardScenes, flattenCardScenes, primaryAssignee } from '../cardSceneHelpers';
import { toggleCompositingStatus, updateCompositingError } from '../compositingActions';

interface CompositingSceneModalProps {
  sceneKey: string;       // `${episodeNumber}:${sceneId}`
  episodeNumber: number;
  isCompositor: boolean;
}

const ERROR_KINDS: CompositingErrorKind[] = ['missing_file', 'fix_blemish', 'retake', 'canceled_scene', 'other'];

export function CompositingSceneModal({ sceneKey, episodeNumber, isCompositor }: CompositingSceneModalProps) {
  const setDetailScene = useCompositingDashboardStore((s) => s.setDetailScene);
  const compositingStates = useDataStore((s) => s.compositingStates);
  const episodes = useDataStore((s) => s.episodes);
  const currentUser = useAuthStore((s) => s.currentUser);
  const users = useAuthStore((s) => s.users);

  const state = compositingStates.get(sceneKey);
  const status: CompositingStatus = state?.status ?? 'batch';
  const errorKind = state?.errorKind ?? null;
  const errorNote = state?.errorNote ?? '';

  const allScenes = useMemo(() => {
    const ep = episodes.find((e) => e.episodeNumber === episodeNumber);
    return flattenCardScenes(buildCardScenes(ep));
  }, [episodes, episodeNumber]);

  const sceneId = sceneKey.split(':').slice(1).join(':');
  const card = allScenes.find((s) => s.sceneId === sceneId);
  const currentIndex = allScenes.findIndex((s) => s.sceneId === sceneId);

  const updatedByName = useMemo(() => {
    if (!state?.updatedBy) return null;
    return users.find((u) => u.id === state.updatedBy)?.name ?? state.updatedBy;
  }, [state, users]);

  const [localNote, setLocalNote] = useState(errorNote);
  useEffect(() => { setLocalNote(errorNote); }, [errorNote, sceneKey]);

  // ── 단계 변경 ──
  const handleStatus = useCallback((next: CompositingStatus) => {
    if (!isCompositor || !currentUser || !card) return;
    if (next === status) return;
    toggleCompositingStatus({
      episodeNumber,
      sceneId: card.sceneId,
      partId: card.partId,
      next,
      currentUserId: currentUser.id,
    });
  }, [isCompositor, currentUser, card, status, episodeNumber]);

  const handleErrorKind = useCallback((kind: CompositingErrorKind) => {
    if (!isCompositor || !currentUser || !card) return;
    updateCompositingError({
      episodeNumber,
      sceneId: card.sceneId,
      partId: card.partId,
      currentUserId: currentUser.id,
      errorKind: kind,
      errorNote: kind === 'other' ? localNote : null,
    });
  }, [isCompositor, currentUser, card, episodeNumber, localNote]);

  const close = useCallback(() => setDetailScene(null), [setDetailScene]);

  const moveTo = useCallback((dir: -1 | 1) => {
    if (currentIndex < 0) return;
    const nextIdx = currentIndex + dir;
    if (nextIdx < 0 || nextIdx >= allScenes.length) return;
    const nextCard = allScenes[nextIdx];
    setDetailScene(compositingKey(nextCard.episodeNumber, nextCard.sceneId));
  }, [currentIndex, allScenes, setDetailScene]);

  // ── 키보드 단축키 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowLeft') { moveTo(-1); return; }
      if (e.key === 'ArrowRight') { moveTo(1); return; }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 6) {
        handleStatus(COMPOSITING_STATUS_ORDER[n - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, moveTo, handleStatus]);

  if (!card) {
    return (
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
        onClick={close}
      >
        <div className="bg-bg-card text-text-primary rounded-lg p-6 text-sm">
          씬 정보를 찾을 수 없습니다.
          <button onClick={close} className="ml-3 underline">닫기</button>
        </div>
      </div>
    );
  }

  const bgName = primaryAssignee(card.bg?.assignee);
  const actName = primaryAssignee(card.act?.assignee);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
      onClick={close}
    >
      <div
        className="bg-bg-card text-text-primary rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-bg-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-bg-border">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <span className="font-mono text-sm font-bold">{card.sceneId}</span>
            <span className="text-xs text-text-secondary">
              EP{String(card.episodeNumber).padStart(2, '0')} · 파트 {card.partId}
              {currentIndex >= 0 && ` · ${currentIndex + 1}번째 컷`}
            </span>
          </div>
          <button onClick={close} className="w-8 h-8 rounded-md hover:bg-bg-border/50 flex items-center justify-center" title="닫기 (Esc)">
            <X size={16} />
          </button>
        </div>

        {/* 이미지 두 장 */}
        <div className="grid grid-cols-2 gap-3 p-4 bg-bg-primary/30">
          <ImagePane label="가이드" url={card.storyboardUrl} />
          <ImagePane label="실제" url={card.guideUrl} />
        </div>

        {/* 단계 그리드 */}
        <div className="px-5 py-4 border-t border-bg-border">
          <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">단계</div>
          <div
            className={cn(
              'flex flex-wrap gap-2',
              !isCompositor && 'opacity-40 cursor-not-allowed',
            )}
            title={!isCompositor ? '컴포지터만 단계를 변경할 수 있습니다' : undefined}
          >
            {COMPOSITING_STATUS_ORDER.map((st) => {
              const active = status === st;
              const tokenVar = COMPOSITING_STATUS_TOKEN[st];
              return (
                <button
                  key={st}
                  type="button"
                  disabled={!isCompositor}
                  onClick={() => handleStatus(st)}
                  className={cn(
                    'px-3 py-1.5 text-[12px] font-semibold rounded-full transition-all duration-150 border tabular-nums',
                    active ? 'shadow-[0_0_10px_currentColor]' : '',
                  )}
                  style={{
                    background: active ? `rgb(var(${tokenVar}))` : 'transparent',
                    color: active ? '#fff' : `var(${tokenVar})`,
                    borderColor: `rgb(var(${tokenVar}) / ${active ? '1' : '0.45'})`,
                  }}
                >
                  {COMPOSITING_STATUS_LABEL[st]}
                </button>
              );
            })}
          </div>
        </div>

        {/* 오류 사유 — status='error' 일 때만 */}
        {status === 'error' && (
          <div className="px-5 py-4 border-t border-bg-border">
            <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">오류 사유</div>
            <div className={cn('flex flex-wrap gap-2', !isCompositor && 'opacity-40 cursor-not-allowed')}>
              {ERROR_KINDS.map((kind) => {
                const active = errorKind === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={!isCompositor}
                    onClick={() => handleErrorKind(kind)}
                    className={cn(
                      'px-3 py-1.5 text-[11px] font-semibold rounded-full transition-all duration-150 border',
                      active
                        ? 'bg-status-error/22 border-status-error/70 text-status-error'
                        : 'bg-transparent border-bg-border text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {COMPOSITING_ERROR_LABEL[kind]}
                  </button>
                );
              })}
            </div>
            {errorKind === 'other' && (
              <textarea
                value={localNote}
                onChange={(e) => setLocalNote(e.target.value.slice(0, 100))}
                onBlur={() => {
                  if (!currentUser || !isCompositor) return;
                  updateCompositingError({
                    episodeNumber,
                    sceneId: card.sceneId,
                    partId: card.partId,
                    currentUserId: currentUser.id,
                    errorKind: 'other',
                    errorNote: localNote,
                  });
                }}
                disabled={!isCompositor}
                maxLength={100}
                placeholder="기타 사유 (최대 100자)"
                className="mt-3 w-full px-3 py-2 text-[12px] rounded-md bg-bg-primary/40 border border-bg-border focus:outline-none focus:border-accent/60 resize-none disabled:opacity-40"
                rows={2}
              />
            )}
          </div>
        )}

        {/* 담당자 */}
        <div className="px-5 py-4 border-t border-bg-border">
          <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">담당자</div>
          <div className="flex items-center gap-5 text-[12px]">
            <div className="flex items-center gap-2">
              <span className="text-text-secondary font-semibold w-7">BG</span>
              <span className="text-text-primary">{bgName || <span className="text-text-secondary/60">미지정</span>}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-secondary font-semibold w-7">ACT</span>
              <span className="text-text-primary">{actName || <span className="text-text-secondary/60">미지정</span>}</span>
            </div>
          </div>
        </div>

        {/* 활동 기록 (MVP — 마지막 변경 1줄만) */}
        <div className="px-5 py-4 border-t border-bg-border">
          <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2">활동 기록</div>
          {state ? (
            <div className="text-[12px] text-text-secondary">
              <span className="font-semibold text-text-primary">{updatedByName ?? '알 수 없음'}</span>
              가 <span className="font-semibold text-text-primary">{COMPOSITING_STATUS_LABEL[status]}</span> 로 변경
              {' · '}
              <span className="font-mono tabular-nums text-text-secondary/80">
                {state.updatedAt ? new Date(state.updatedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : ''}
              </span>
            </div>
          ) : (
            <div className="text-[12px] text-text-secondary/70">아직 변경 기록이 없습니다.</div>
          )}
        </div>

        {/* 푸터 단축키 안내 */}
        <div className="px-5 py-2 border-t border-bg-border bg-bg-primary/30 text-[10px] text-text-secondary/70 flex items-center justify-between">
          <span>단축키: 1~6 단계 변경 · ← → 이전/다음 씬 · Esc 닫기</span>
          <span className="font-mono tabular-nums">{currentIndex + 1}/{allScenes.length}</span>
        </div>
      </div>
    </div>
  );
}

function ImagePane({ label, url }: { label: string; url?: string }) {
  return (
    <div className="relative aspect-video bg-bg-primary rounded-md overflow-hidden border border-bg-border/60">
      <span className="absolute top-2 left-2 z-10 text-[10px] font-bold px-1.5 py-0.5 rounded bg-bg-card/85 text-text-secondary">
        {label}
      </span>
      {url
        ? <img src={url} alt={label} className="w-full h-full object-contain" />
        : (
          <div className="w-full h-full flex items-center justify-center text-text-secondary/60 text-[11px]">
            이미지 없음
          </div>
        )}
    </div>
  );
}
