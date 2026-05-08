import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Eye, Sparkles, Pencil, MessageSquare, RotateCw, Plus, Trash2, User, Grid3x3, Image as ImageIcon, ChevronRight } from 'lucide-react';
import { useActivityStore } from '@/stores/useActivityStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { useDataStore } from '@/stores/useDataStore';
import type { Activity, ActionType, Episode } from '@/types';
import { groupActivities, formatRelativeTime, getActivityVerb } from './utils';
import { ACTION_TYPE_COLOR, ACTION_TYPE_TO_GROUP } from './constants';
import {
  formatActivityGroupLabel,
  formatActivitySceneLabel,
  resolveActivitySceneNavigation,
} from './feedNavigation';
import { activityMatchesCell } from '../RecentActivityWidget';
import { getRangeBoundary } from './timeRange';

function ActionIcon({ type, size = 11 }: { type: ActionType; size?: number }) {
  const props = { size };
  switch (type) {
    case 'stage_lo':
    case 'stage_done':
      return <Check {...props} />;
    case 'stage_review':
      return <Eye {...props} />;
    case 'stage_png':
      return <Sparkles {...props} />;
    case 'memo_update':
      return <Pencil {...props} />;
    case 'comment_add':
      return <MessageSquare {...props} />;
    case 'revision_add':
    case 'revision_resolve':
      return <RotateCw {...props} />;
    case 'scene_add':
      return <Plus {...props} />;
    case 'scene_delete':
      return <Trash2 {...props} />;
    case 'assignee_change':
      return <User {...props} />;
    case 'layout_change':
      return <Grid3x3 {...props} />;
    case 'image_upload_storyboard':
    case 'image_upload_guide':
      return <ImageIcon {...props} />;
  }
}

function Pictogram({ type }: { type: ActionType }) {
  const color = ACTION_TYPE_COLOR[type];
  return (
    <span
      className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-[5px] flex-shrink-0"
      style={{
        background: `${color}33`, // alpha 0.2
        color,
      }}
    >
      <ActionIcon type={type} />
    </span>
  );
}

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white border border-white/10 flex-shrink-0"
      style={{ background: color }}
    >
      {name.charAt(0)}
    </div>
  );
}

function getUserColorFromId(userId: string): string {
  // 간단한 hash → HSL 색상 (deterministic)
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h}, 70%, 65%), hsl(${(h + 30) % 360}, 70%, 75%))`;
}

interface FeedItemRowProps {
  activity: Activity;
  isSelf: boolean;
  isInsideGroup?: boolean;
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  /** v1.23.0: 셀 필터 적용 시 매칭 강조 */
  highlight?: boolean;
  /** v1.23.0: 셀 필터 적용 시 비매칭 dim */
  dimmed?: boolean;
  highlightRef?: React.Ref<HTMLDivElement>;
}

function FeedItemRow({ activity, isSelf, isInsideGroup, episodes, episodeTitles, highlight, dimmed, highlightRef }: FeedItemRowProps) {
  const verb = getActivityVerb(activity);
  const displayLabel = formatActivitySceneLabel(activity.sceneLabel, activity.episodeNumber, episodeTitles);
  const navTarget = resolveActivitySceneNavigation(activity, episodes);
  const canNavigate = !!navTarget;
  const handleClick = useCallback(() => {
    if (!navTarget) return;
    const app = useAppStore.getState();
    app.setSelectedEpisode(navTarget.episodeNumber);
    app.setSelectedPart(navTarget.partId);
    app.setView('scenes');
    app.setPendingDeepLink({ sheetName: navTarget.sheetName, sceneId: navTarget.sceneId });
  }, [navTarget]);
  return (
    <div
      ref={highlightRef}
      onClick={handleClick}
      role={canNavigate ? 'button' : undefined}
      tabIndex={canNavigate ? 0 : undefined}
      onKeyDown={canNavigate ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      } : undefined}
      className={`flex gap-2.5 py-2 px-3.5 border-b border-bg-border/15 transition-all duration-200 hover:bg-bg-border/20 ${
        canNavigate ? 'cursor-pointer' : ''
      } relative ${isSelf ? 'bg-accent/[0.04]' : ''} ${isInsideGroup ? 'pl-12' : ''} ${
        highlight ? 'bg-[#FDCB6E]/10 shadow-[inset_3px_0_0_#FFE5A0]' : ''
      } ${dimmed ? 'opacity-30' : ''}`}
    >
      {isSelf && !isInsideGroup && (
        <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent-sub" />
      )}
      {!isInsideGroup && (
        <Avatar name={activity.userName} color={getUserColorFromId(activity.userId)} />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-[12.5px] flex-wrap">
          {!isInsideGroup && (
            <>
              <span className="font-semibold text-text-primary">
                {activity.userName}
                {isSelf && <span className="ml-1 text-[10.5px] text-accent-sub font-medium">(나)</span>}
              </span>
            </>
          )}
          <Pictogram type={activity.actionType} />
          <span className="text-text-secondary">{verb}</span>
          {displayLabel && (
            <span
              className="px-1.5 py-[1px] rounded text-[11.5px] font-medium"
              style={{
                color: 'var(--color-accent-sub, #A29BFE)',
                background: 'rgba(108, 92, 231, 0.1)',
              }}
            >
              {displayLabel}
            </span>
          )}
        </div>
        <div className="text-[11px] text-text-secondary/60 mt-0.5">
          {formatRelativeTime(activity.createdAt)}
        </div>
      </div>
    </div>
  );
}

interface FeedGroupProps {
  items: Activity[];
  isSelf: boolean;
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  highlight?: boolean;
  dimmed?: boolean;
  highlightRef?: React.Ref<HTMLDivElement>;
  matches?: (a: Activity) => boolean;
}

function FeedGroup({ items, isSelf, episodes, episodeTitles, highlight, dimmed, highlightRef, matches }: FeedGroupProps) {
  const [open, setOpen] = useState(isSelf); // 본인 그룹은 자동 펼침
  const head = items[0];
  const verb = getActivityVerb(head);
  const groupLabel = formatActivityGroupLabel(head, episodeTitles);

  return (
    <div
      ref={highlightRef}
      className={`border-b border-bg-border/15 ${isSelf ? 'bg-accent/[0.04]' : ''} relative transition-all duration-200 ${
        highlight ? 'bg-[#FDCB6E]/10 shadow-[inset_3px_0_0_#FFE5A0]' : ''
      } ${dimmed ? 'opacity-30' : ''}`}
    >
      {isSelf && <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent-sub" />}
      <div
        className="flex gap-2.5 py-2 px-3.5 cursor-pointer transition-colors hover:bg-bg-border/20"
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar name={head.userName} color={getUserColorFromId(head.userId)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] flex-wrap">
            <span className="font-semibold text-text-primary">
              {head.userName}
              {isSelf && <span className="ml-1 text-[10.5px] text-accent-sub font-medium">(나)</span>}
            </span>
            <Pictogram type={head.actionType} />
            <span className="text-text-secondary">{verb}</span>
            {groupLabel && (
              <span
                className="px-1.5 py-[1px] rounded text-[11.5px] font-medium"
                style={{ color: 'var(--color-accent-sub, #A29BFE)', background: 'rgba(108, 92, 231, 0.1)' }}
              >
                {groupLabel}
              </span>
            )}
            <span className="text-[11px] text-text-secondary/60">· {items.length}건</span>
          </div>
          <div className="text-[11px] text-text-secondary/60 mt-0.5 flex items-center gap-1.5">
            <span>{formatRelativeTime(head.createdAt)}</span>
            <span className="text-text-secondary/40">·</span>
            <span>5분 내 묶음</span>
          </div>
        </div>
        <span
          className="ml-1 text-text-secondary/50 self-center transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <ChevronRight size={14} />
        </span>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden bg-bg-border/30"
          >
            {items.map((it) => {
              const innerMatch = matches ? matches(it) : false;
              return (
                <FeedItemRow
                  key={it.id}
                  activity={it}
                  isSelf={isSelf}
                  isInsideGroup
                  episodes={episodes}
                  episodeTitles={episodeTitles}
                  highlight={innerMatch}
                />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ActivityFeed() {
  const { activities, filters, hasMore, isLoading, loadMore, cellFilter, timeUnit, rangeIdx } = useActivityStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstHighlightRef = useRef<HTMLDivElement>(null);

  // 필터 적용 + 그룹화
  const feedItems = useMemo(() => {
    const filtered = activities.filter((a) => filters.groups.has(ACTION_TYPE_TO_GROUP[a.actionType]));
    return groupActivities(filtered);
  }, [activities, filters]);

  // 셀 필터 매칭 헬퍼 (codex 3차 P1: range 경계도 검증)
  const currentRange = useMemo(() => getRangeBoundary(timeUnit, rangeIdx), [timeUnit, rangeIdx]);
  const matches = useCallback((a: Activity) => {
    if (!cellFilter) return false;
    return activityMatchesCell(a, timeUnit, cellFilter, currentRange);
  }, [cellFilter, timeUnit, currentRange]);

  // 셀 필터 적용 시 첫 매칭 항목으로 자동 스크롤
  useEffect(() => {
    if (!cellFilter) return;
    // 다음 tick 에 scroll (DOM 그려진 후)
    const t = setTimeout(() => {
      firstHighlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => clearTimeout(t);
  }, [cellFilter, feedItems]);

  // 무한 스크롤
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (!hasMore || isLoading) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
        loadMore();
      }
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore, isLoading, loadMore]);

  if (activities.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-6 py-10">
        <div className="text-text-secondary/60 text-xs">
          아직 활동 기록이 없습니다
          <div className="text-text-secondary/40 text-[11px] mt-1">
            첫 변경이 발생하면 여기에 표시됩니다
          </div>
        </div>
      </div>
    );
  }

  // 첫 매칭 (cellFilter 있을 때만) — scroll target
  let firstMatchAssigned = false;
  const claimFirstMatch = (): React.Ref<HTMLDivElement> | undefined => {
    if (!cellFilter || firstMatchAssigned) return undefined;
    firstMatchAssigned = true;
    return firstHighlightRef;
  };

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      {feedItems.map((item) => {
        if (item.type === 'item') {
          const isSelf = item.activity.userId === currentUser?.id;
          const isMatch = matches(item.activity);
          const isDimmed = !!cellFilter && !isMatch;
          return (
            <FeedItemRow
              key={item.activity.id}
              activity={item.activity}
              isSelf={isSelf}
              episodes={episodes}
              episodeTitles={episodeTitles}
              highlight={isMatch}
              dimmed={isDimmed}
              highlightRef={isMatch ? claimFirstMatch() : undefined}
            />
          );
        } else {
          const isSelf = item.items[0].userId === currentUser?.id;
          const groupHasMatch = item.items.some(matches);
          const groupDimmed = !!cellFilter && !groupHasMatch;
          // v1.23.0 (codex 1차 P2): 매칭이 하나라도 있으면 그룹 강조.
          // every() 로는 그룹 접힌 상태에서 사용자가 매칭을 못 보는 회귀 발생.
          return (
            <FeedGroup
              key={item.key}
              items={item.items}
              isSelf={isSelf}
              episodes={episodes}
              episodeTitles={episodeTitles}
              highlight={groupHasMatch && !!cellFilter}
              dimmed={groupDimmed}
              highlightRef={groupHasMatch ? claimFirstMatch() : undefined}
              matches={matches}
            />
          );
        }
      })}
      {isLoading && (
        <div className="text-center py-3 text-[11px] text-text-secondary/50">로딩 중...</div>
      )}
      {!hasMore && activities.length > 0 && (
        <div className="text-center py-3 text-[11px] text-text-secondary/40">
          이전 활동은 자동 정리되었습니다
        </div>
      )}
    </div>
  );
}
