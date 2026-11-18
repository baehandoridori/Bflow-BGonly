// 팀 기록 (검수자, 계획 14 6-1): 날짜순 목록에 작은 그림 · 만든 사람 · 이름이나 설명 · 종류 · 비용 · 도장.
// 거르기: 사람 · 기간 · 종류 · 도장 없음, 찾기: 설명 · 주문서 글 (서버가 거른다). 여러 건을 골라 '확인함' 한꺼번에.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/useAuthStore';
import { BAE_JOB_KINDS, type BaeJobKind } from '@/shared/bae/jobs';
import { BAE_TEAM_PERIOD_LABEL, type BaeTeamPeriod } from '@/shared/bae/review';
import { useBaeTeam } from '../state/useBaeTeam';
import { KIND_LABEL, teamRow } from '../state/baeViewModel';
import { RecordList } from './RecordList';
import { Seal } from './Seal';

const PERIODS: BaeTeamPeriod[] = ['today', 'week', 'month', 'all'];
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

export function TeamRecords({ scope, rate, actorId, selectedId, onPick }: { scope: ReactNode; rate: number; actorId: string; selectedId: string | null; onPick(id: string): void }) {
  const t = useBaeTeam();
  const users = useAuthStore((s) => s.users);
  const [view, setView] = useState<'grid' | 'list'>('list');
  useEffect(() => { if (!useBaeTeam.getState().loaded && !useBaeTeam.getState().loading) void useBaeTeam.getState().load(); }, []);
  const f = t.filter;
  const rows = useMemo(() => t.rows.map((j) => teamRow(j, rate)), [t.rows, rate]);
  const pickable = rows.filter((r) => r.pickable).map((r) => r.id);
  const picked = useMemo(() => new Set(t.picked), [t.picked]);
  const allOn = pickable.length > 0 && pickable.every((id) => picked.has(id));
  const nPicked = t.picked.filter((id) => pickable.includes(id)).length;
  // 사람 고르기: 팀 사람 모두 (이름 순) + 목록에만 있는 사람 (지운 사용자)
  const people = useMemo(() => {
    const m = new Map(users.map((u) => [u.id, u.name] as const));
    for (const j of t.rows) if (!m.has(j.userId)) m.set(j.userId, j.userName || '(지운 사용자)');
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  }, [users, t.rows]);
  const filtered = !!(f.userId || f.kind || f.unstamped || f.period !== 'all' || f.q.trim());

  const bulk = async () => {
    try {
      const r = await t.stampBulk(actorId);
      if (r.stamped) toast.success(`${r.stamped}건에 확인함 도장을 찍었어요${r.skipped ? ` (${r.skipped}건은 이미 도장이 있거나 만드는 중이라 그대로 뒀어요)` : ''}.`);
      else toast.message('찍을 기록이 없었어요. 이미 도장이 있거나 아직 만드는 중이에요.');
    } catch (e) { toast.error(`도장을 찍지 못했어요: ${errText(e)}`); }
  };

  const toolbar = (
    <div className="bae-filters" role="group" aria-label="팀 기록 거르기">
      <label className="bae-filter">
        <span className="bae-label">사람</span>
        <select className="bae-select" value={f.userId ?? ''} onChange={(e) => t.setFilter({ userId: e.target.value || null })}>
          <option value="">모두</option>
          {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <div className="bae-seg" role="group" aria-label="기간">
        {PERIODS.map((p) => <button key={p} type="button" className="bae-btn bae-btn-s" aria-pressed={f.period === p} onClick={() => t.setFilter({ period: p })}>{BAE_TEAM_PERIOD_LABEL[p]}</button>)}
      </div>
      <label className="bae-filter">
        <span className="bae-label">종류</span>
        <select className="bae-select" value={f.kind ?? ''} onChange={(e) => t.setFilter({ kind: (e.target.value || null) as BaeJobKind | null })}>
          <option value="">모두</option>
          {BAE_JOB_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </label>
      <button type="button" className="bae-btn bae-btn-s bae-toggle" aria-pressed={f.unstamped} onClick={() => t.setFilter({ unstamped: !f.unstamped })}>도장 없음</button>
      <span className="bae-hint bae-num">{t.loaded ? `${rows.length}건${t.more ? ' 넘게' : ''}` : ''}</span>
      <span className="bae-filters-end">
        <label className="bae-check">
          <input type="checkbox" checked={allOn} disabled={!pickable.length} onChange={(e) => t.pickAll(pickable, e.target.checked)} />
          도장 없는 것 모두 고르기
        </label>
        <button type="button" className="bae-btn bae-btn-s bae-btn-tint bae-stamp-btn is-seen" disabled={!nPicked || t.bulkBusy} onClick={() => void bulk()}>
          <Seal />{nPicked ? `${nPicked}건 확인함` : '골라서 확인함'}
        </button>
      </span>
    </div>
  );

  return (
    <RecordList
      title="팀 기록" scope={scope} toolbar={toolbar} maker
      rows={rows} total={rows.length} selectedId={selectedId} pickLabel="자세히 보기" onPick={onPick}
      view={view} onView={setView} query={f.q} onQuery={(q) => t.setFilter({ q })} searchLabel="설명, 주문서 글에서 찾기"
      select={{ picked, onToggle: t.toggle }}
      loading={t.loading && !t.loaded} error={t.error} onRetry={() => { void t.load(); }}
      emptyTitle={filtered ? '조건에 맞는 팀 기록이 없어요' : '아직 팀 기록이 없어요'}
      emptyText={filtered ? '거르기를 바꾸거나 풀어 보세요.' : '팀원이 BAE경으로 그림을 만들면 여기에 쌓여요.'}
      more={t.more ? { onMore: () => { void t.loadMore(); }, loading: t.loadingMore } : null}
    />
  );
}
