import { useState } from 'react';

import { useArcadeStore } from '@/features/playground/arcade/useArcadeStore';
import type { ArcadeGameId, ArcadeLeaderboardEntry } from '@/features/playground/arcade/types';
import { useAuthStore } from '@/stores/useAuthStore';

// 게임별 순위표 — 스냅샷 leaderboard 를 그대로 보여준다(별도 fetch 없음). finishRun 후 자동 최신화.
const GAME_TABS: { id: ArcadeGameId; label: string }[] = [
  { id: 'snake', label: '스네이크' },
  { id: 'tetris', label: '테트리스' },
];

const PERIOD_TABS = [
  { id: 'all', label: '전체' },
  { id: 'weekly', label: '이번 주' },
] as const;

type PeriodId = (typeof PERIOD_TABS)[number]['id'];

// 게임별 점수 단위(라벨). 지금은 둘 다 '점'이지만 게임이 늘면 여기서 갈린다.
const SCORE_UNIT: Record<ArcadeGameId, string> = { snake: '점', tetris: '점' };

const VISIBLE_ROWS = 5;

function formatAchievedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

export function ArcadeRankingPanel() {
  const snapshot = useArcadeStore((state) => state.snapshot);
  const myUserId = useAuthStore((state) => state.currentUser?.id ?? null);
  const [game, setGame] = useState<ArcadeGameId>('snake');
  const [period, setPeriod] = useState<PeriodId>('all');

  const stats = snapshot?.games[game];
  const entries: ArcadeLeaderboardEntry[] = period === 'all'
    ? stats?.leaderboardAll ?? []
    : stats?.leaderboardWeekly ?? [];
  const top = entries.slice(0, VISIBLE_ROWS);
  const unit = SCORE_UNIT[game];

  return (
    <aside className="pg-arank" data-pg-arank aria-label="게임별 순위표">
      <div className="pg-arank__head">
        <h3>게임별 순위표</h3>
        <div className="pg-arank__tabs" role="tablist" aria-label="기간">
          {PERIOD_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={period === tab.id}
              className={period === tab.id ? 'is-active' : ''}
              onClick={() => setPeriod(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pg-arank__games" role="tablist" aria-label="게임">
        {GAME_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={game === tab.id}
            className={game === tab.id ? 'is-active' : ''}
            onClick={() => setGame(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ol className="pg-arank__list">
        {Array.from({ length: VISIBLE_ROWS }, (_, index) => {
          const entry = top[index];
          const isMe = entry != null && myUserId != null && entry.userId === myUserId;
          return (
            <li key={entry?.userId ?? `empty-${index}`} className={isMe ? 'is-me' : ''} data-pg-arank-row>
              <span className="pg-arank__rank">{index + 1}</span>
              <span className="pg-arank__name">{entry ? entry.name : '—'}</span>
              <span className="pg-arank__score">
                {entry ? `${entry.score.toLocaleString('ko-KR')}${unit}` : '—'}
              </span>
              <span className="pg-arank__date">{entry ? formatAchievedAt(entry.at) : '—'}</span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
