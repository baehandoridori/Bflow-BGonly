/**
 * 씬 카드 — 컴포지팅 대시보드 핵심 단위.
 *
 * - 상단: sceneId + StatusDot
 * - 중단: 이미지 분할 (좌 storyboardUrl, 우 guideUrl)
 * - 하단: BG 담당자 / ACT 담당자
 * - 핀 / cascade / dock-lift / 단계 변경 색 펄스 + 보낸 사람 아바타 배지
 *
 * spec: 2026-05-21-compositing-dashboard-design.md (8.3~8.8, 13)
 */

import { useEffect, useMemo, useState } from 'react';
import { FileText, MessageCircle, Pin, Check } from 'lucide-react';
import { useCommentCount } from '../useCommentCount';
import { cn } from '@/utils/cn';
import type { CompositingState } from '@/types';
import { COMPOSITING_STATUS_LABEL, COMPOSITING_STATUS_TOKEN, COMPOSITING_ERROR_LABEL } from '@/utils/compositingLabels';
import { StatusDot } from '@/components/compositing-dashboard/common/StatusDot';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { useTransientHighlightStore, selectHighlight } from '@/stores/transientHighlightStore';
import { useAuthStore } from '@/stores/useAuthStore';
import type { CardScene } from '../cardSceneHelpers';
import { nameInitial, primaryAssignee } from '../cardSceneHelpers';

interface SceneCardProps {
  card: CardScene;
  /** 그 (epNum, sceneId) 의 compositing_states row. 없으면 'batch' 디폴트. */
  state: CompositingState | undefined;
  /** 진입 cascade 의 stagger 인덱스. */
  staggerIndex: number;
  /** 같은 파트의 sceneId 순 배열 — Shift+클릭 range 선택에 사용. */
  partSceneIds?: string[];
  /** disabled 시각 (filter 비매칭 등). */
  dimmed: boolean;
}

export function SceneCard({ card, state, staggerIndex, dimmed, partSceneIds }: SceneCardProps) {
  const status = state?.status ?? 'batch';
  const errorKind = state?.errorKind ?? null;
  const tokenVar = COMPOSITING_STATUS_TOKEN[status];

  const pinnedScene = useCompositingDashboardStore((s) => s.pinnedScene);
  const setPinnedScene = useCompositingDashboardStore((s) => s.setPinnedScene);
  const setDetailScene = useCompositingDashboardStore((s) => s.setDetailScene);
  const selectedSceneKeys = useCompositingDashboardStore((s) => s.selectedSceneKeys);
  const lastSelectedSceneKey = useCompositingDashboardStore((s) => s.lastSelectedSceneKey);
  const toggleSelectedScene = useCompositingDashboardStore((s) => s.toggleSelectedScene);
  const selectOnlyScene = useCompositingDashboardStore((s) => s.selectOnlyScene);
  const addSelectedSceneKeys = useCompositingDashboardStore((s) => s.addSelectedSceneKeys);
  const clearSelectedScenes = useCompositingDashboardStore((s) => s.clearSelectedScenes);

  const sceneKey = `${card.episodeNumber}:${card.sceneId}`;
  const isPinned = pinnedScene === sceneKey;
  // 다른 카드가 핀되었으면 본인은 살짝 흐려진다 — 핀 카드로 시선 집중.
  const otherPinned = pinnedScene !== null && pinnedScene !== sceneKey;
  const isMultiSelected = selectedSceneKeys.has(sceneKey);
  const hasAnySelection = selectedSceneKeys.size > 0;

  // 핀 해제 시 transition 끝까지 z-index 유지 — pin 풀리는 동안 다른 카드 뒤로 가는 시각 깜빡임 fix.
  const [unpinning, setUnpinning] = useState(false);
  useEffect(() => {
    if (isPinned) {
      setUnpinning(false);
      return;
    }
    setUnpinning(true);
    const t = window.setTimeout(() => setUnpinning(false), 260);
    return () => window.clearTimeout(t);
  }, [isPinned]);

  // transientHighlight — 다른 사용자 변경 시 색 펄스 + 보낸 사람 아바타 배지
  const highlight = useTransientHighlightStore((s) => selectHighlight(s, sceneKey));
  const allUsers = useAuthStore((s) => s.users);
  const byUser = useMemo(() => {
    if (!highlight?.by) return null;
    return allUsers.find((u) => u.id === highlight.by) ?? null;
  }, [highlight, allUsers]);

  const handleClick = (e: React.MouseEvent) => {
    // Cmd/Ctrl + 클릭 → 일괄 선택 토글 (핀/모달 동작 X)
    if (e.metaKey || e.ctrlKey) {
      toggleSelectedScene(sceneKey);
      return;
    }
    // Shift + 클릭 → 같은 파트 안에서 range 선택 (anchor = lastSelectedSceneKey)
    if (e.shiftKey && partSceneIds && partSceneIds.length > 0) {
      const lastSid = lastSelectedSceneKey?.split(':').slice(1).join(':');
      const anchorIdx = lastSid ? partSceneIds.indexOf(lastSid) : -1;
      const curIdx = partSceneIds.indexOf(card.sceneId);
      if (anchorIdx >= 0 && curIdx >= 0) {
        const [lo, hi] = anchorIdx < curIdx ? [anchorIdx, curIdx] : [curIdx, anchorIdx];
        const range = partSceneIds.slice(lo, hi + 1).map((sid) => `${card.episodeNumber}:${sid}`);
        addSelectedSceneKeys(range);
        return;
      }
    }
    // 일반 클릭 — 선택 중이면 선택 해제 + 핀 동작. 아니면 핀/모달.
    if (hasAnySelection) {
      clearSelectedScenes();
    }
    if (isPinned) {
      setDetailScene(sceneKey);
    } else {
      setPinnedScene(sceneKey);
    }
  };

  const bgName = primaryAssignee(card.bg?.assignee);
  const actName = primaryAssignee(card.act?.assignee);

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'scene-card bf-cascade-item relative flex flex-col rounded-lg overflow-hidden text-left',
        'border transition-all duration-200',
        isPinned ? 'pinned' : '',
        highlight ? 'flashing' : '',
        isPinned ? 'opacity-100' : (dimmed ? 'opacity-35' : (otherPinned ? 'opacity-55' : 'opacity-100')),
      )}
      style={{
        background: 'rgb(var(--color-bg-card))',
        borderColor: isMultiSelected
          ? 'rgb(var(--color-accent))'
          : isPinned
            ? 'rgb(var(--color-accent))'
            : `color-mix(in srgb, var(${tokenVar}) 40%, transparent)`,
        borderWidth: (isPinned || isMultiSelected) ? 2 : 1,
        outline: isMultiSelected
          ? '3px solid rgb(var(--color-accent) / 0.45)'
          : isPinned ? '3px solid rgb(var(--color-accent) / 0.25)' : 'none',
        outlineOffset: (isPinned || isMultiSelected) ? 1 : 0,
        width: 180,
        height: 220,
        animationDelay: `${staggerIndex * 28}ms`,
        // 핀 해제 시에도 transition 끝까지 z-index 유지 (260ms) — flicker 방지
        zIndex: isPinned ? 20 : (unpinning ? 15 : (otherPinned ? 1 : 1)),
        // bf-status-flash 용 변수
        ['--current-status-color' as any]: `var(${tokenVar})`,
        ['--current-status-color-bright' as any]: `color-mix(in srgb, var(${tokenVar}) 40%, transparent)`,
        // glow pulse 컬러
        ['--card-glow' as any]: 'rgb(var(--color-accent) / 0.4)',
      }}
      title={`${card.sceneId} · ${status}`}
    >
      {/* 상단 sceneId + 상태 라벨 + StatusDot */}
      <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 border-b border-bg-border/30">
        <span className="font-mono text-[11px] font-semibold text-text-primary">{card.sceneId}</span>
        <div className="flex items-center gap-1.5">
          {/* 핀 상태일 때만 단계 라벨을 풀로 표시 (정상 상태는 dot 만, 공간 절약) */}
          {isPinned && (
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{
                color: `var(${tokenVar})`,
                background: `color-mix(in srgb, var(${tokenVar}) 18%, transparent)`,
              }}
            >
              {COMPOSITING_STATUS_LABEL[status]}
            </span>
          )}
          <StatusDot status={status} size={isPinned ? 10 : 8} />
        </div>
      </div>

      {/* 중단 이미지 분할 */}
      <div className="flex-1 flex border-b border-bg-border/30 bg-bg-primary/40">
        <ImageSlot label="가이드" url={card.storyboardUrl} />
        <div className="w-px bg-bg-border/40" />
        <ImageSlot label="실제" url={card.guideUrl} />
      </div>

      {/* 하단 담당자 + 댓글/리비전 아이콘 */}
      <div className="flex flex-col gap-1 px-2.5 py-1.5 text-[10px]">
        {bgName && <AssigneeRow tag="BG" name={bgName} />}
        {actName && <AssigneeRow tag="ACT" name={actName} />}
        {!bgName && !actName && <span className="text-text-secondary/60">담당자 미지정</span>}
      </div>
      {/* 가장 하단 — LD/SD 라벨 + 메모 + 댓글 카운트 (이모지 제거, lucide 아이콘 사용) */}
      <CardFooter card={card} />

      {/* 일괄 선택 체크 — 좌상단 (선택된 카드만) */}
      {isMultiSelected && (
        <span
          className="absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center shadow-lg"
          style={{
            background: 'rgb(var(--color-accent))',
            color: '#fff',
            boxShadow: '0 0 0 2px rgb(var(--color-bg-card)), 0 0 10px rgb(var(--color-accent) / 0.6)',
          }}
          aria-label="선택됨"
        >
          <Check size={14} strokeWidth={3} />
        </span>
      )}

      {/* 핀 아이콘 — pinned 카드 좌상단 코너 (일괄 선택과 동시 X — isMultiSelected 가 우선) */}
      {isPinned && !isMultiSelected && (
        <span
          className="absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center shadow-lg"
          style={{
            background: 'rgb(var(--color-accent))',
            color: '#fff',
            boxShadow: '0 0 0 2px rgb(var(--color-bg-card)), 0 0 12px rgb(var(--color-accent) / 0.6)',
          }}
          aria-hidden="true"
        >
          <Pin size={13} strokeWidth={2.5} fill="#fff" />
        </span>
      )}

      {/* status='error' 인 경우 오류 사유 라벨 우상단 truncate */}
      {status === 'error' && errorKind && (
        <span
          className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[9px] font-bold pointer-events-none truncate max-w-[110px]"
          style={{
            background: `color-mix(in srgb, var(${COMPOSITING_STATUS_TOKEN.error}) 18%, transparent)`,
            color: `var(${COMPOSITING_STATUS_TOKEN.error})`,
            border: `1px solid color-mix(in srgb, var(${COMPOSITING_STATUS_TOKEN.error}) 50%, transparent)`,
          }}
        >
          {COMPOSITING_ERROR_LABEL[errorKind] ?? ''}
        </span>
      )}

      {/* highlight: 보낸 사람 아바타 배지 (2.5초) */}
      {highlight && byUser && (
        <span
          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md"
          style={{
            background: 'rgb(var(--color-accent))',
            boxShadow: '0 0 0 2px rgb(var(--color-bg-card)), 0 0 6px rgb(var(--color-accent) / 0.55)',
            animation: 'fadeOut 2500ms ease-in forwards',
          }}
          title={`${byUser.name} 가 단계 변경`}
        >
          {nameInitial(byUser.name)}
        </span>
      )}
    </button>
  );
}

// ─── 카드 푸터 (별도 분리 — useCommentCount 훅 사용) ───
function CardFooter({ card }: { card: CardScene }) {
  const lengthChange = card.bg?.lengthChange ?? card.act?.lengthChange;
  const memo = card.bg?.memo || card.act?.memo;
  // 한솔 정정 (2026-05-22): comments.scene_id 는 scene.no 의 숫자 문자열.
  // bgSceneNo / actSceneNo 두 키로 합산 fetch.
  const commentCount = useCommentCount(
    card.bgPartUuid, card.bg?.no,
    card.actPartUuid, card.act?.no,
  );
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 text-[9px] text-text-secondary"
      style={{ borderTop: '1px solid rgb(var(--color-bg-border) / 0.3)' }}
    >
      {lengthChange && (
        <span
          className="font-bold px-1 py-0.5 rounded border"
          style={{
            background: `color-mix(in srgb, var(${lengthChange === 'LD' ? '--status-done' : '--status-error'}) 22%, transparent)`,
            color: `var(${lengthChange === 'LD' ? '--status-done' : '--status-error'})`,
            borderColor: `var(${lengthChange === 'LD' ? '--status-done' : '--status-error'})`,
          }}
        >
          {lengthChange}
        </span>
      )}
      {memo && (
        <span
          className="flex items-center gap-1 truncate min-w-0"
          title={memo}
        >
          <FileText size={10} strokeWidth={2} className="shrink-0 text-text-secondary/80" />
          <span className="truncate">{memo}</span>
        </span>
      )}
      <span className="ml-auto flex items-center gap-0.5 text-text-secondary/85 shrink-0" title="댓글">
        <MessageCircle size={11} strokeWidth={2} />
        {commentCount > 0 && (
          <span className="font-semibold tabular-nums text-text-primary ml-0.5">{commentCount}</span>
        )}
      </span>
    </div>
  );
}

// ── 내부 위젯 ───────────────────────────

function ImageSlot({ label, url }: { label: string; url?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center relative overflow-hidden">
      {url
        ? <img src={url} alt={label} className="w-full h-full object-cover" loading="lazy" />
        : <span className="text-[9px] text-text-secondary/60">{label} 없음</span>}
    </div>
  );
}

function AssigneeRow({ tag, name }: { tag: 'BG' | 'ACT'; name: string }) {
  // 이름 해시로 톤 (DashHeader 의 UserDot 과 동일 룰)
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  const tone = hash;
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-flex items-center justify-center text-white font-bold rounded-full shrink-0"
        style={{
          width: 14,
          height: 14,
          fontSize: 7,
          background: `linear-gradient(135deg, hsl(${tone}, 60%, 55%), hsl(${(tone + 40) % 360}, 65%, 45%))`,
        }}
      >
        {nameInitial(name)}
      </span>
      <span className="text-[9px] text-text-secondary font-semibold w-7 shrink-0">{tag}</span>
      <span className="text-[10px] text-text-primary truncate">{name}</span>
    </div>
  );
}
