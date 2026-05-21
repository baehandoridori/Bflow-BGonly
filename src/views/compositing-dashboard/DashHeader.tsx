/**
 * 컴포지팅 현황 대시보드 — 헤더.
 *
 * 구조 (좌 → 우):
 *   타이틀(컴포지팅 현황 · EPxx) + 진행률
 *   ◀ EP 칩 토글 (EP1·EP2·...) ▶
 *   담당 컴포지터 칩
 *   보는 사람 칩
 *   ↻ (cascade 재생 — 시연/디버그)
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (6.1~6.2)
 */

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, Eye, Lock, Unlock } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';

interface DashHeaderProps {
  episodeNumber: number | null;
  onCascadeReplay: () => void;
}

export function DashHeader({ episodeNumber, onCascadeReplay }: DashHeaderProps) {
  const episodes = useDataStore((s) => s.episodes);
  const compositingStates = useDataStore((s) => s.compositingStates);
  const setEpisode = useCompositingDashboardStore((s) => s.setEpisode);
  const users = useAuthStore((s) => s.users);
  const currentUser = useAuthStore((s) => s.currentUser);
  const viewerIsCompositor = currentUser?.isCompositor === true;

  // 활성 EP 목록 — useDataStore.episodes 는 이미 active 만 들어있다.
  // (아카이브된 EP 는 별도 archivedEpisodes state 로 관리됨, ScenesView/EpisodeView 참조.)
  const activeEpisodes = useMemo(
    () => [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber),
    [episodes],
  );

  // 현재 EP 의 진행률 — done 비율
  const progressPercent = useMemo(() => {
    if (episodeNumber === null) return 0;
    let total = 0;
    let done = 0;
    const prefix = `${episodeNumber}:`;
    for (const [key, row] of compositingStates) {
      if (!key.startsWith(prefix)) continue;
      total += 1;
      if (row.status === 'done') done += 1;
    }
    if (total === 0) return 0;
    return Math.round((done / total) * 100);
  }, [compositingStates, episodeNumber]);

  // 담당 컴포지터 — 본인이 컴포지터면 본인, 아니면 첫 번째 컴포지터.
  // 추후 EP 별 명시 가능 (spec 17.2 참조).
  const headCompositor = useMemo(() => {
    if (viewerIsCompositor && currentUser) return currentUser;
    return users.find((u) => u.isCompositor) ?? null;
  }, [users, viewerIsCompositor, currentUser]);

  // 보는 사람 — Realtime presence 결과 (Task 3.7 에서 wire). 현재는 빈 배열.
  const viewers: { id: string; name: string }[] = [];

  const handlePrev = () => {
    if (episodeNumber === null || activeEpisodes.length === 0) return;
    const idx = activeEpisodes.findIndex((e) => e.episodeNumber === episodeNumber);
    if (idx > 0) setEpisode(activeEpisodes[idx - 1].episodeNumber);
  };
  const handleNext = () => {
    if (episodeNumber === null || activeEpisodes.length === 0) return;
    const idx = activeEpisodes.findIndex((e) => e.episodeNumber === episodeNumber);
    if (idx >= 0 && idx < activeEpisodes.length - 1) setEpisode(activeEpisodes[idx + 1].episodeNumber);
  };

  const titleEp = episodeNumber !== null ? `EP${String(episodeNumber).padStart(2, '0')}` : '—';

  return (
    <header className="flex items-center justify-between gap-6 px-6 py-4 border-b border-bg-border/60">
      {/* 좌 : 타이틀 + 진행률 + prev/next */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, rgb(var(--color-accent)) 0%, rgb(var(--color-accent-sub)) 100%)' }}>
          <Clapper />
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-baseline gap-2.5">
            <h1 className="m-0 text-base font-bold text-text-primary">컴포지팅 현황</h1>
            <span className="text-xs text-text-secondary font-medium">{titleEp}</span>
            <span
              className="text-[11px] font-bold px-1.5 py-0.5 rounded-md"
              style={{ background: 'rgb(var(--color-accent) / 0.16)', color: 'rgb(var(--color-accent))' }}
            >
              진행률 {progressPercent}%
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-text-secondary">
            <button
              type="button"
              onClick={handlePrev}
              disabled={activeEpisodes.length === 0 || activeEpisodes[0]?.episodeNumber === episodeNumber}
              className="w-5 h-5 rounded flex items-center justify-center text-text-secondary disabled:opacity-30 hover:bg-bg-border/40 transition-colors"
              title="이전 에피소드"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="font-mono tabular-nums">{titleEp}</span>
            <button
              type="button"
              onClick={handleNext}
              disabled={activeEpisodes.length === 0 || activeEpisodes[activeEpisodes.length - 1]?.episodeNumber === episodeNumber}
              className="w-5 h-5 rounded flex items-center justify-center text-text-secondary disabled:opacity-30 hover:bg-bg-border/40 transition-colors"
              title="다음 에피소드"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* 가운데 : EP 칩 토글 */}
      <div className="flex items-center gap-1.5 flex-1 justify-center flex-wrap min-w-0">
        {activeEpisodes.map((ep) => {
          const active = ep.episodeNumber === episodeNumber;
          return (
            <button
              key={ep.episodeNumber}
              type="button"
              onClick={() => setEpisode(ep.episodeNumber)}
              className={cn(
                'min-w-[44px] px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all duration-200 border tabular-nums',
                active
                  ? 'bg-accent/16 border-accent/55 text-accent shadow-[0_0_10px_rgb(var(--color-accent)/0.18)]'
                  : 'bg-bg-card border-bg-border/55 text-text-secondary hover:text-text-primary hover:border-bg-border',
              )}
            >
              EP{String(ep.episodeNumber).padStart(2, '0')}
            </button>
          );
        })}
      </div>

      {/* 우 : 담당 컴포지터 / 보는 사람 / ↻ */}
      <div className="flex items-center gap-3 shrink-0">
        {headCompositor && (
          <div
            className={cn(
              'flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border',
              viewerIsCompositor
                ? 'bg-accent/14 border-accent/45'
                : 'bg-bg-card border-bg-border',
            )}
            title="현재 에피소드의 담당 컴포지터"
          >
            <UserDot name={headCompositor.name} />
            <div className="flex flex-col leading-tight">
              <span className="text-[9px] text-text-secondary font-semibold tracking-wider uppercase">담당 컴포지터</span>
              <span className={cn('text-[11px] font-bold', viewerIsCompositor ? 'text-accent' : 'text-text-primary')}>
                {headCompositor.name}
                {viewerIsCompositor && <span className="ml-1.5 text-[9px] font-medium opacity-80">(나)</span>}
              </span>
            </div>
            {viewerIsCompositor
              ? <Unlock size={11} className="text-accent ml-0.5" />
              : <Lock size={11} className="text-text-secondary ml-0.5" />}
          </div>
        )}

        {viewers.length > 0 && (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bg-card border border-bg-border"
            title={`지금 보는 사람: ${viewers.map((v) => v.name).join(', ')}`}
          >
            <Eye size={12} className="text-text-secondary" />
            <div className="flex">
              {viewers.slice(0, 3).map((v, i) => (
                <span key={v.id} style={{ marginLeft: i === 0 ? 0 : -6, zIndex: 10 - i }}>
                  <UserDot name={v.name} size={18} />
                </span>
              ))}
            </div>
            <span className="text-[10px] text-text-secondary font-medium ml-0.5 tabular-nums">{viewers.length}명</span>
          </div>
        )}

        <button
          type="button"
          onClick={onCascadeReplay}
          title="등장 애니메이션 다시 보기"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-border/50 transition-colors"
        >
          <RotateCw size={14} />
        </button>
      </div>
    </header>
  );
}

// ── 작은 유틸 ─────────────────────────────

function Clapper() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-3.6c1.1-.3 2.2.3 2.5 1.3Z" />
      <path d="m6.2 5.3 3.1 3.9" />
      <path d="m12.4 3.4 3.1 4" />
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

/** 단순한 이니셜 아바타 (담당 컴포지터/보는 사람 칩 안에서 사용). */
function UserDot({ name, size = 22 }: { name: string; size?: number }) {
  const initials = name.slice(0, 1) || '?';
  // 사용자 이름의 hash 로 tone 결정
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  const tone = hash;
  return (
    <span
      className="inline-flex items-center justify-center text-white font-bold shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${tone}, 60%, 55%), hsl(${(tone + 40) % 360}, 65%, 45%))`,
        boxShadow: `0 0 0 2px rgb(var(--color-bg-card))`,
      }}
    >
      {initials}
    </span>
  );
}
