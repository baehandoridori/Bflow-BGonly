/**
 * DonutHero — '내 할일' 위젯 상단 진행 히어로 (시안15).
 *
 * - 더블베젤 도넛(트랙 링 + 진행 링): 내 씬의 단계 누적 진행을 뚜렷한 4색 세그먼트로.
 *   ★색은 단계 의미(준비→완료)를 나타내는 진행 게이지이며 부서 색 코드가 아니다.
 *   STAGE_COLORS(보라 명도 4톤)는 컴팩트 도넛서 구분이 안 돼, ACTION_TYPE_COLOR/
 *   디자인 토큰과 같은 뚜렷한 4색을 쓴다.
 * - 중앙 = 완료 씬 M / 전체 N (비개발자 멘탈모델: '몇 개 끝냈나'). 단계% 는 도넛 채움으로만.
 * - "오늘 마친 씬 N개" 칩 + 접으면 한 줄 strip.
 *
 * 카운트업/sweep 등 모션은 PR 5. 여기선 기본 transition 만.
 */
import { ChevronUp, ChevronDown, PartyPopper } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { MyTasksStats } from '../statsUtils';

/** 단계별 뚜렷한 4색 (ACTION_TYPE_COLOR / CLAUDE.md 디자인 토큰과 동일). 진행 게이지용. */
const DONUT_STAGE_COLORS = {
  lo: '#74B9FF',
  done: '#A29BFE',
  review: '#FDCB6E',
  png: '#00B894',
} as const;

const STAGE_ORDER = ['lo', 'done', 'review', 'png'] as const;

interface DonutHeroProps {
  stats: MyTasksStats;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function DonutHero({ stats, collapsed, onToggleCollapse }: DonutHeroProps) {
  const { sceneTotal, doneSceneCount, pendingSceneCount, personalTotal, stageCounts, stageProgressPct, todayCompletedScenes } = stats;
  const pctRounded = Math.round(stageProgressPct);

  // ── 접힘: 한 줄 strip ──
  if (collapsed) {
    return (
      <div className="flex items-center gap-2 px-1 pt-2 pb-1.5">
        <div className="flex-1 h-1.5 rounded-full bg-bg-border/20 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.min(stageProgressPct, 100)}%`,
              backgroundColor: stageProgressPct >= 100 ? DONUT_STAGE_COLORS.png : stageProgressPct >= 50 ? DONUT_STAGE_COLORS.review : '#6C5CE7',
            }}
          />
        </div>
        <span className="text-[11px] tabular-nums text-text-secondary/55 shrink-0">
          {doneSceneCount}/{sceneTotal} 씬 · {pctRounded}%
        </span>
        <button
          onClick={onToggleCollapse}
          className="p-0.5 text-text-secondary/40 hover:text-text-secondary cursor-pointer transition-colors shrink-0"
          title="펼치기"
          aria-label="진행 요약 펼치기"
        >
          <ChevronDown size={13} />
        </button>
      </div>
    );
  }

  // ── 펼침: 더블베젤 도넛 ──
  const R = 36;
  const SW = 9;
  const SIZE = 90;
  const C = 2 * Math.PI * R;
  const slots = sceneTotal * 4;
  const GAP = slots > 0 ? 2.5 : 0; // 세그먼트 경계 갭(px)

  // 단계 누적 세그먼트 (lo→done→review→png). 각 세그먼트 길이 = 해당 단계 체크 수 / 슬롯.
  let acc = 0;
  const segments = STAGE_ORDER.map((stage) => {
    const frac = slots > 0 ? stageCounts[stage] / slots : 0;
    const start = acc;
    acc += frac;
    if (frac <= 0) return null;
    const rawLen = frac * C;
    const drawLen = Math.max(0, rawLen - GAP);
    return {
      stage,
      color: DONUT_STAGE_COLORS[stage],
      dasharray: `${drawLen} ${C - drawLen}`,
      dashoffset: -start * C,
    };
  }).filter(Boolean) as { stage: string; color: string; dasharray: string; dashoffset: number }[];

  const allDone = sceneTotal > 0 && doneSceneCount === sceneTotal;

  return (
    <div className="flex items-center gap-3 px-1 pt-2 pb-2">
      {/* 도넛 */}
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE}>
          {/* 더블베젤: 바깥 옅은 링 + 트랙 링 */}
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R + 4} fill="none" stroke="rgb(var(--color-bg-border) / 0.25)" strokeWidth={1.5} />
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="rgb(var(--color-bg-border) / 0.55)" strokeWidth={SW} />
          {/* 단계 누적 세그먼트 */}
          {segments.map((seg) => (
            <circle
              key={seg.stage}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth={SW}
              strokeDasharray={seg.dasharray}
              strokeDashoffset={seg.dashoffset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              className="transition-all duration-500 ease-out"
            />
          ))}
        </svg>
        {/* 중앙: 완료 M / 전체 N */}
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          {sceneTotal > 0 ? (
            <>
              <span className="text-xl font-bold text-text-primary tabular-nums">{doneSceneCount}</span>
              <span className="text-[10px] text-text-secondary/55 tabular-nums mt-0.5">/ {sceneTotal} 씬</span>
            </>
          ) : (
            <span className="text-[11px] text-text-secondary/45">씬 없음</span>
          )}
        </div>
      </div>

      {/* 오른쪽: 통계 + 오늘 칩 */}
      <div className="flex flex-col min-w-0 flex-1 gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0">
            {allDone ? (
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-green-400">
                <PartyPopper size={13} className="opacity-80" /> 모든 씬 완료!
              </span>
            ) : (
              <span className="text-[12px] text-text-secondary/70 tabular-nums">
                완료 <span className="font-semibold text-text-primary">{doneSceneCount}</span>
                <span className="text-text-secondary/30"> · </span>
                진행 <span className="font-semibold text-text-primary">{pendingSceneCount}</span>
              </span>
            )}
            <span className="text-[11px] text-text-secondary/45 tabular-nums">
              개인 할일 {personalTotal}개
            </span>
          </div>
          <button
            onClick={onToggleCollapse}
            className="p-0.5 text-text-secondary/35 hover:text-text-secondary cursor-pointer transition-colors shrink-0"
            title="접기"
            aria-label="진행 요약 접기"
          >
            <ChevronUp size={14} />
          </button>
        </div>

        {/* 오늘 마친 씬 칩 */}
        {todayCompletedScenes > 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-full text-[10.5px] font-medium',
              'border',
            )}
            style={{ backgroundColor: '#00B89418', color: '#00B894', borderColor: '#00B89440' }}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#00B894' }} aria-hidden />
            오늘 마친 씬 {todayCompletedScenes}개
          </span>
        )}
      </div>
    </div>
  );
}
