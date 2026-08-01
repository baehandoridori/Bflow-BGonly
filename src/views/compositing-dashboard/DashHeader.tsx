/**
 * 컴포지팅 현황 대시보드 — 헤더.
 *
 * 구조 (좌 → 우):
 *   타이틀(컴포지팅 현황 · 에피소드 이름) + 진행률
 *   ◀ 에피소드 칩 토글 ▶
 *   담당 컴포지터 칩
 *   보는 사람 칩
 *   ↻ (cascade 재생 — 시연/디버그)
 *
 * spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md (6.1~6.2)
 */

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCw, Eye, Lock, Unlock, FileText, Pencil } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useDataStore, compositingKey } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { isCompositorForCompositing, isCompletedStatus } from '@/utils/compositingLabels';
import { CompositorAssignPopover } from '@/components/compositing/CompositorAssignPopover';

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
  const viewerIsCompositor = isCompositorForCompositing(currentUser);

  // 활성 EP 목록 — useDataStore.episodes 는 이미 active 만 들어있다.
  // (아카이브된 EP 는 별도 archivedEpisodes state 로 관리됨, ScenesView/EpisodeView 참조.)
  const activeEpisodes = useMemo(
    () => [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber),
    [episodes],
  );

  // v1.30.0+ (한솔 정정): EP 코드 대신 에피소드 표시명 + 메모 표시.
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);
  const episodeMemos = useDataStore((s) => s.episodeMemos);
  const currentEp = episodes.find((e) => e.episodeNumber === episodeNumber);
  const episodeDisplayTitle = useMemo(
    () => currentEp
      ? getEpisodeDisplayName(currentEp)
      : (episodeNumber !== null ? `EP${String(episodeNumber).padStart(2, '0')}` : ''),
    [currentEp, episodeNumber, getEpisodeDisplayName, episodeTitles],
  );
  const episodeMemo = episodeNumber !== null ? (episodeMemos?.[episodeNumber] ?? '') : '';

  // 현재 EP 의 진행률 — 한솔 정의 (2026-05-22): "완료된 부분 = done + aggregated".
  // 코덱스 2차 P2 (2026-05-22): 분모를 compositingStates rows 가 아닌 EP 의 전체 씬 수로.
  //   row 가 없는 씬 (batch 디폴트) 도 분모에 포함. 1 개만 done 인데 100% 로 부풀던 문제 fix.
  const progressPercent = useMemo(() => {
    if (episodeNumber === null) return 0;
    const ep = episodes.find((e) => e.episodeNumber === episodeNumber);
    if (!ep) return 0;
    // EP 의 모든 씬 수집 — sceneId 단위 dedup. BG 소문자 d001 / ACT 대문자 D001 은 한 컷이므로
    //   대소문자 무관(소문자)으로 dedup 해야 분모가 부풀지 않는다(컴포지팅 카드 병합과 동일 규칙).
    const sceneIds = new Set<string>();
    for (const part of ep.parts) {
      for (const sc of part.scenes) sceneIds.add((sc.sceneId || '').trim().toLowerCase());
    }
    const total = sceneIds.size;
    if (total === 0) return 0;
    let done = 0;
    for (const sceneId of sceneIds) {
      const row = compositingStates.get(compositingKey(episodeNumber, sceneId));
      if (isCompletedStatus(row?.status)) done += 1;
    }
    return Math.round((done / total) * 100);
  }, [compositingStates, episodeNumber, episodes]);

  // 담당 컴포지터 — 지정된 사람 전원. 본인이 지정돼 있으면 맨 앞으로 올려 '(나)' 를 먼저 보여준다.
  //   (예전엔 첫 1명만 보여줘서 여러 명 지정해도 헤더에 한 명만 드러났다.)
  const compositors = useMemo(() => {
    const assigned = users.filter((u) => u.isCompositor === true);
    const mine = currentUser ? assigned.filter((u) => u.id === currentUser.id) : [];
    const others = currentUser ? assigned.filter((u) => u.id !== currentUser.id) : assigned;
    return [...mine, ...others];
  }, [users, currentUser]);

  // 지정 UI 는 어드민만. 일반 사용자에게는 지금까지처럼 읽기 전용 칩이다.
  const canAssignCompositor = currentUser?.role === 'admin';
  const [assignOpen, setAssignOpen] = useState(false);

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

  const episodeSubLabel = episodeDisplayTitle || '—';

  return (
    <header className="flex items-center justify-between gap-6 px-6 py-4 border-b border-bg-border/60">
      {/* 좌 : 타이틀 + 진행률 + prev/next */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, rgb(var(--color-accent)) 0%, rgb(var(--color-accent-sub)) 100%)' }}>
          <Clapper />
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <h1 className="m-0 text-base font-bold text-text-primary shrink-0">컴포지팅 현황</h1>
            <span className="text-sm font-semibold text-text-primary truncate min-w-0" title={episodeDisplayTitle}>
              {episodeDisplayTitle || '—'}
            </span>
            <span
              className="text-[11px] font-bold px-1.5 py-0.5 rounded-md shrink-0"
              style={{ background: 'rgb(var(--color-accent) / 0.16)', color: 'rgb(var(--color-accent))' }}
            >
              진행률 {progressPercent}%
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-text-secondary min-w-0">
            <button
              type="button"
              onClick={handlePrev}
              disabled={activeEpisodes.length === 0 || activeEpisodes[0]?.episodeNumber === episodeNumber}
              className="w-5 h-5 rounded flex items-center justify-center text-text-secondary disabled:opacity-30 hover:bg-bg-border/40 transition-colors shrink-0"
              title="이전 에피소드"
            >
              <ChevronLeft size={14} />
            </button>
            {episodeMemo ? (
              <span className="flex items-center gap-1 truncate min-w-0" title={episodeMemo}>
                <FileText size={11} strokeWidth={2} className="shrink-0 text-text-secondary/70" />
                <span className="truncate">{episodeMemo}</span>
              </span>
            ) : (
              <span className="truncate min-w-0 text-text-secondary/70" title={episodeSubLabel}>{episodeSubLabel}</span>
            )}
            <button
              type="button"
              onClick={handleNext}
              disabled={activeEpisodes.length === 0 || activeEpisodes[activeEpisodes.length - 1]?.episodeNumber === episodeNumber}
              className="w-5 h-5 rounded flex items-center justify-center text-text-secondary disabled:opacity-30 hover:bg-bg-border/40 transition-colors shrink-0"
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
          const episodeLabel = getEpisodeDisplayName(ep);
          return (
            <button
              key={ep.episodeNumber}
              type="button"
              onClick={() => setEpisode(ep.episodeNumber)}
              title={episodeLabel}
              className={cn(
                'min-w-[56px] max-w-[9.5rem] px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all duration-200 border',
                active
                  ? 'bg-accent/16 border-accent/55 text-accent shadow-[0_0_10px_rgb(var(--color-accent)/0.18)]'
                  : 'bg-bg-card border-bg-border/55 text-text-secondary hover:text-text-primary hover:border-bg-border',
              )}
            >
              <span className="block truncate">{episodeLabel}</span>
            </button>
          );
        })}
      </div>

      {/* 우 : 담당 컴포지터 / 보는 사람 / ↻ */}
      <div className="flex items-center gap-3 shrink-0">
        {(compositors.length > 0 || canAssignCompositor) && (
          <div className="relative">
            {(() => {
              const viewerIsAssigned = Boolean(currentUser && compositors.some((u) => u.id === currentUser.id));
              const label = compositors.length === 0
                ? '지정 안 됨'
                : `${compositors[0].name}${compositors.length > 1 ? ` 외 ${compositors.length - 1}` : ''}`;
              const chipClass = cn(
                'flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full border transition-colors',
                viewerIsCompositor ? 'bg-accent/14 border-accent/45' : 'bg-bg-card border-bg-border',
                canAssignCompositor && 'cursor-pointer hover:border-accent/60',
              );
              const inner = (
                <>
                  {compositors.length > 0 ? (
                    <span className="flex shrink-0">
                      {compositors.slice(0, 3).map((u, i) => (
                        <span key={u.id} style={{ marginLeft: i === 0 ? 0 : -7, zIndex: 10 - i }}>
                          <UserDot name={u.name} />
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-bg-border text-[10px] text-text-secondary">?</span>
                  )}
                  <div className="flex flex-col leading-tight min-w-0">
                    <span className="text-[9px] text-text-secondary font-semibold tracking-wider uppercase">
                      담당 컴포지터{compositors.length > 1 && ` ${compositors.length}명`}
                    </span>
                    <span className={cn('text-[11px] font-bold truncate', viewerIsCompositor ? 'text-accent' : 'text-text-primary')}>
                      {label}
                      {viewerIsAssigned && <span className="ml-1.5 text-[9px] font-medium opacity-80">(나)</span>}
                    </span>
                  </div>
                  {canAssignCompositor
                    ? <Pencil size={11} className="text-text-secondary ml-0.5" />
                    : viewerIsCompositor
                      ? <Unlock size={11} className="text-accent ml-0.5" />
                      : <Lock size={11} className="text-text-secondary ml-0.5" />}
                </>
              );
              const tooltip = compositors.length > 0
                ? `담당 컴포지터: ${compositors.map((u) => u.name).join(', ')}`
                : '담당 컴포지터가 아직 지정되지 않았어요';
              return canAssignCompositor ? (
                <button
                  type="button"
                  onClick={() => setAssignOpen((v) => !v)}
                  aria-haspopup="dialog"
                  aria-expanded={assignOpen}
                  title={`${tooltip} — 눌러서 지정`}
                  className={chipClass}
                >
                  {inner}
                </button>
              ) : (
                <div className={chipClass} title={tooltip}>{inner}</div>
              );
            })()}
            {assignOpen && canAssignCompositor && <CompositorAssignPopover onClose={() => setAssignOpen(false)} />}
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
