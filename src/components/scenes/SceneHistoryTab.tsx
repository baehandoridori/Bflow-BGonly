import { useState, Fragment, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Layers } from 'lucide-react';
import { cn } from '@/utils/cn';
import { formatStamp } from '@/utils/formatTime';
import { describeActivity, deptPrefix } from './activityLabels';
import type { Activity } from '@/types';
import { groupStageToggles, type HistoryRow, type StageGroupRow } from './historyGrouping';

/**
 * 씬 상세 모달 — 히스토리 탭.
 *
 * 데이터는 모달이 fetch (한솔 결정 2026-05-02 — 중복 IPC 호출 제거).
 * activities prop 으로 전달받음.
 *
 * 디자인:
 *   - 세로 타임라인 (accent 그라디언트 라인)
 *   - 같은 user + 부서 + 5분 내 단계 토글들은 1줄로 그룹화 + 클릭 펼침
 *   - 새 활동 도착 시 fade + slide-in (AnimatePresence)
 *   - 좌측 원형 노드 (lucide 아이콘) + 우측 본문 (사용자 / 부서 · 라벨 / 시각)
 */

export interface SceneHistoryTabProps {
  /** 모달이 useSceneActivities 로 fetch 한 활동들 (최신 → 오래된) */
  activities: Activity[];
}

export function SceneHistoryTab({ activities }: SceneHistoryTabProps) {
  // 5분 그룹화 적용 — 같은 user + 부서 + 5분 내 단계 토글 → 1줄
  const rows = useMemo(() => groupStageToggles(activities, 5 * 60 * 1000), [activities]);

  if (activities.length === 0) {
    return (
      <div className="px-5 py-14 text-center text-xs text-text-secondary/50">
        기록된 활동이 없습니다
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      <ol className="relative pl-7">
        {/* 세로 타임라인 라인 — accent 그라디언트 */}
        <span
          aria-hidden
          className="absolute left-[11px] top-2 bottom-2 w-px"
          style={{
            background:
              'linear-gradient(180deg, rgb(var(--color-accent) / 0.6), rgb(var(--color-accent) / 0.2), transparent)',
          }}
        />
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.li
              key={row.kind === 'single' ? row.activity.id : row.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative mb-3 last:mb-0"
            >
              {row.kind === 'single' ? (
                <SingleRow activity={row.activity} />
              ) : (
                <GroupRow group={row} />
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}

function SingleRow({ activity }: { activity: Activity }) {
  const v = describeActivity(activity);
  const Icon = v.Icon;
  return (
    <>
      <span
        aria-hidden
        className="absolute -left-7 top-1.5 inline-flex w-[22px] h-[22px] items-center justify-center rounded-full bg-bg-card"
        style={{
          border: `1.5px solid ${v.tone}`,
          color: v.tone,
          boxShadow: `0 0 0 3px rgb(var(--color-bg-card)), 0 0 8px ${v.tone}40`,
        }}
      >
        <Icon size={11} strokeWidth={2.5} aria-hidden />
      </span>
      <div className="text-[12px] text-text-primary leading-snug">
        <span className="font-bold" style={{ color: v.tone }}>{activity.userName}</span>{' '}
        <span className="text-text-secondary/80">{deptPrefix(activity.department)}</span>
        <span>{v.text}</span>
      </div>
      <div className="text-[10.5px] text-text-secondary/60 mt-0.5 tabular-nums">
        {formatStamp(activity.createdAt, { withYearAlways: true })}
      </div>
    </>
  );
}

/** 5분 그룹화된 단계 토글 묶음 — 클릭 펼침 */
function GroupRow({ group }: { group: StageGroupRow }) {
  const [open, setOpen] = useState(false);
  const tone = 'rgb(var(--color-accent-sub))';
  const dep = group.department;

  // 그룹 라벨 — 부서 stage_labels 기반으로 "LO · 완료 · 취소된 검수" 식
  const summary = group.items.map((it) => {
    const v = describeActivity(it);
    return v.text; // "LO 완료" / "검수 취소"
  }).join(' · ');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/30 rounded-md"
        aria-expanded={open}
      >
        <span
          aria-hidden
          className="absolute -left-7 top-1.5 inline-flex w-[22px] h-[22px] items-center justify-center rounded-full bg-bg-card"
          style={{
            border: `1.5px solid ${tone}`,
            color: tone,
            boxShadow: `0 0 0 3px rgb(var(--color-bg-card)), 0 0 8px ${tone}40`,
          }}
        >
          <Layers size={11} strokeWidth={2.5} aria-hidden />
        </span>
        <div className="text-[12px] text-text-primary leading-snug flex items-center gap-1">
          <span className="font-bold" style={{ color: tone }}>{group.userName}</span>
          <span className="text-text-secondary/80">{deptPrefix(dep)}</span>
          <span>{summary}</span>
          <ChevronRight
            size={12}
            className={cn('text-text-secondary/60 transition-transform duration-200', open && 'rotate-90')}
            aria-hidden
          />
        </div>
        <div className="text-[10.5px] text-text-secondary/60 mt-0.5 tabular-nums">
          {formatStamp(group.firstAt, { withYearAlways: true })}
          {' ~ '}
          {formatStamp(group.lastAt)}
          <span className="ml-1 text-text-secondary/40">· {group.items.length}건</span>
        </div>
      </button>

      {/* 펼침 */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2 ml-1 pl-3 border-l border-bg-border/50 overflow-hidden space-y-1.5"
          >
            {group.items.map((it) => {
              const v = describeActivity(it);
              return (
                <li key={it.id} className="text-[11px] text-text-secondary flex items-center gap-2">
                  <span className="tabular-nums w-12 shrink-0">{formatStamp(it.createdAt)}</span>
                  <span style={{ color: v.tone }}>{v.text}</span>
                </li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
    </>
  );
}
