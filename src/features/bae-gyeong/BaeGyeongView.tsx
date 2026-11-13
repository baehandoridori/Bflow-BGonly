/**
 * BAE경 (Bflow 사이드바의 별도 메뉴, 景). 위쪽 탭: 작업대 · 기록 · 비용(검수자) · 설정 (14e 1장: '만들기' 탭은 뺐다).
 * 이 화면에 들어오는 길은 `canAccessBaeGyeong`(featureFlag.ts)을 거치고, 실제로 막는 것은 서버 함수다.
 * 만들기 상태(useBaeMake)는 이 화면 밖에 있어서, 다른 메뉴에 다녀와도 작업이 이어진다.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, MonitorCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/useAuthStore';
import type { BaeJob, BaeUsageSummary } from '@/shared/bae/jobs';
import { useBaeStore, baeGw, type BaeTab } from './useBaeStore';
import { Workbench, type BaeStartKind } from './home/Workbench';
import { filterBaeRecordRows, type BaeRecordListProps, type BaeReviewView } from './home/benchTypes';
import { RecordList } from './records/RecordList';
import { JobView } from './records/JobView';
import { MakingStage } from './make/MakingStage';
import { BaeSettingsTab } from './settings/BaeSettingsTab';
import { useBaeMake } from './state/useBaeMake';
import { useBaeJobs, visibleBaeJobs } from './state/useBaeJobs';
import { BaeMakeLayer, useSeconds } from './state/BaeMakeLayer';
import { activeBench, jobViewProps, makingProps, recordBench, recordRow, reviewOf, wonOf } from './state/baeViewModel';
import './bae-gyeong.css';

const LATER: Record<BaeStartKind, string> = {
  new: '', same: '같은 장소 다른 컷은 다음 단계에서 열려요.', layers: '레이어로 나누기는 5단계에서 열려요.', angle: '다른 각도로는 7단계에서 열려요.',
  upscale: '4K로 키우기는 4단계에서 열려요.', denoise: '노이즈 제거는 3단계에서 열려요.',
};

/** 이 PC 원본 그림 주소 (없으면 null → 서버 미리보기). 한 번 만든 주소는 다시 쓴다. */
const localUrls = new Map<string, string | null>();
/** 기록 목록을 받은 계정 — 다른 계정으로 바뀌면 목록을 비운다 (화면을 다시 열 때마다 비우지는 않는다). */
let jobsActor: string | null = null;
function useLocalResult(jobId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(jobId ? localUrls.get(jobId) ?? null : null);
  useEffect(() => {
    if (!jobId) { setUrl(null); return; }
    if (localUrls.has(jobId)) { setUrl(localUrls.get(jobId) ?? null); return; }
    let alive = true;
    void baeGw().localFile(jobId, 'result.png').then((bytes) => {
      const u = bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' })) : null;
      localUrls.set(jobId, u); if (alive) setUrl(u);
    }).catch(() => { localUrls.set(jobId, null); });
    return () => { alive = false; };
  }, [jobId]);
  return url;
}

export default function BaeGyeongView() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { access, loading, error, tab, setTab, start, keyStatus, row } = useBaeStore();
  const make = useBaeMake();
  const jobs = useBaeJobs();
  const [selId, setSelId] = useState<string | null>(null);
  const [recSel, setRecSel] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');
  const [usage, setUsage] = useState<BaeUsageSummary | null>(null);
  const rate = Number((row('prices')?.value as { krwPerUsd?: unknown } | undefined)?.krwPerUsd) || 1400;

  useEffect(() => {
    const id = currentUser?.id ?? null;
    if (jobsActor !== id) { useBaeJobs.getState().reset(); jobsActor = id; }
    void start(id);
  }, [currentUser?.id, start]);
  // 이 화면이 보이는 동안: 만드는 창이 저절로 뜰 수 있고, 기록은 신호가 올 때만 '바뀐 것만' 다시 받는다.
  useEffect(() => {
    useBaeMake.setState({ viewVisible: true });
    return () => useBaeMake.setState({ viewVisible: false });
  }, []);
  useEffect(() => {
    if (!access.canUse) return;
    const g = baeGw();
    const loadUsage = () => {
      const d = new Date(); const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
      void g.usageSummary(from, null).then(setUsage).catch(() => undefined);
    };
    void jobs.load(); loadUsage(); void g.online().catch(() => undefined);
    const off = g.onChanged((what) => { if (what === 'jobs') { void useBaeJobs.getState().load(); loadUsage(); } });
    const onOnline = () => { void g.online().catch(() => undefined); };
    window.addEventListener('online', onOnline);
    return () => { off(); window.removeEventListener('online', onOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.canUse]);

  const active = make.job;
  const live = active && (active.phase === 'ordering' || active.phase === 'drawing');
  const sec = useSeconds(active?.startedAt ?? null, !!live);
  const rows = useMemo(() => visibleBaeJobs(jobs), [jobs]);
  const withPd = (j: BaeJob | null): BaeJob | null => { if (!j) return null; const d = jobs.details[j.id]; return d && d.updatedAt >= j.updatedAt ? { ...j, pd: d.pd, stampBy: d.stampBy, stampNote: d.stampNote } : j; };
  const picked: BaeJob | null = rows.find((r) => r.id === (selId ?? '')) ?? null;
  const showActive = !!active && (!selId || selId === active.id);
  const benchRecord = withPd(showActive ? null : picked ?? (active ? null : rows[0] ?? null));
  const localBench = useLocalResult(benchRecord?.id ?? null);
  const recordPicked = withPd(rows.find((r) => r.id === recSel) ?? null);
  useEffect(() => { if (benchRecord && !benchRecord.pd) void jobs.loadDetail(benchRecord.id, benchRecord.updatedAt); }, [benchRecord?.id, benchRecord?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (recordPicked && !recordPicked.pd) void jobs.loadDetail(recordPicked.id, recordPicked.updatedAt); }, [recordPicked?.id, recordPicked?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const localRec = useLocalResult(recordPicked?.id ?? null);

  const tabs: Array<{ id: BaeTab; label: string; show: boolean }> = [
    { id: 'bench', label: '작업대', show: true },
    { id: 'records', label: '기록', show: true },
    { id: 'costs', label: '비용', show: access.canReview },
    { id: 'settings', label: '설정', show: true },
  ];
  const activeTab = tabs.find((t) => t.id === tab && t.show)?.id ?? 'bench';
  const onStart = (kind: BaeStartKind) => { if (kind === 'new') { setSelId(null); make.openMaterial('new'); } else toast.message(LATER[kind]); };

  const rowViews = rows.map((j) => recordRow(j, rate, null));
  const activeRow = active && !rows.some((r) => r.id === active.id) && (live || active.phase === 'ordered')
    ? [{ id: active.id, thumb: active.inputs?.rough.small ?? null, thumbAlt: null, title: active.order?.summary?.slice(0, 40) || '새 배경', name: '', sub: '',
      kindLabel: '새 배경', when: '', took: live ? `${sec}초째` : '', cost: wonOf(active.orderCostUsd ?? 0, rate), state: 'live' as const,
      stateLabel: active.phase === 'drawing' ? '그리는 중' : active.phase === 'ordering' ? '주문서 쓰는 중' : '주문서 확인 대기', stamp: null }]
    : [];
  const allRows = [...activeRow, ...rowViews];
  const onRename = async (id: string, name: string) => {
    const j = rows.find((r) => r.id === id); if (!j) return;
    useBaeJobs.getState().putLocal({ ...j, name: name.trim() || null, updatedAt: new Date().toISOString() });
    try { await baeGw().jobPatch(id, j.status, { name }); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  const log = (pick: (id: string) => void, pickLabel: string): BaeRecordListProps => ({
    rows: filterBaeRecordRows(allRows, query), total: allRows.length, selectedId: pickLabel === '작업판에 올리기' ? (selId ?? active?.id ?? rows[0]?.id ?? null) : recSel,
    pickLabel, onPick: pick, view, onView: setView, query, onQuery: setQuery, onRename: (id, n) => { void onRename(id, n); },
    loading: jobs.loading && !jobs.loaded, error: jobs.error, onRetry: () => { void jobs.load(true); }, emptyText: '위의 새 배경 만들기로 시작하면 여기에 쌓여요.',
    onAll: () => setTab('records'),
  });
  const saveAs = async (id: string, title: string) => {
    try {
      const name = `BAE경_${title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || id.slice(0, 8)}.png`;
      const where = await baeGw().saveAs(id, name);
      if (where) toast.success('저장했어요'); else if (where === null && !window.baeGyeongAPI) toast.message('테스트 모드에서는 파일로 저장하지 않아요.');
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };
  const saveReview = async (j: BaeJob, v: BaeReviewView) => {
    useBaeJobs.getState().putLocal({ ...j, selfReview: { ...v }, updatedAt: new Date().toISOString() });
    try { await baeGw().jobPatch(j.id, j.status, { selfReview: { ...v } }); toast.success('검수를 남겼어요'); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  if (error) {
    return (
      <div className="bae-root">
        <div className="bae-msg" role="alert">
          <p className="bae-msg-title">BAE경을 불러오지 못했어요</p>
          <p className="bae-msg-text">{error}</p>
          <button type="button" className="bae-btn bae-btn-s" onClick={() => void useBaeStore.getState().refresh()}>다시 시도</button>
        </div>
      </div>
    );
  }
  if (!loading && !access.canUse) {
    return (
      <div className="bae-root">
        <div className="bae-msg">
          <p className="bae-msg-title">BAE경을 쓸 권한이 없어요</p>
          <p className="bae-msg-text">관리자에게 'BAE경 사용자'로 지정해 달라고 요청해 주세요.</p>
        </div>
      </div>
    );
  }

  let bench = null; let busy = null;
  if (showActive && active) { const b = activeBench(rate, sec); bench = b.bench; busy = b.busy; }
  else if (benchRecord) bench = recordBench(benchRecord, rate, localBench);
  const big = !!live && make.makingBig && showActive;

  return (
    <div className="bae-root" data-bae-tab={activeTab}>
      <nav className="bae-tabs" aria-label="BAE경 안의 화면">
        <div className="bae-tablist">
          {tabs.filter((t) => t.show).map((t) => (
            <button key={t.id} type="button" className="bae-tab" aria-current={activeTab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="bae-usage">
          <dl className="bae-month"><dt>이번 달 내 사용</dt><dd className="bae-num">{usage?.images ?? 0}장</dd><dd className="bae-num">{wonOf(usage?.usd ?? 0, rate)}</dd></dl>
          <button type="button" className={`bae-btn bae-btn-ghost bae-btn-s bae-pc${keyStatus?.hasKey ? '' : ' is-not-ready'}`} onClick={() => setTab('settings')}>
            {keyStatus?.hasKey ? <MonitorCheck size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
            {keyStatus?.hasKey ? '이 PC 준비됨' : '키가 아직 없어요'}
          </button>
        </div>
      </nav>
      {activeTab === 'bench' && (big
        ? <MakingStage {...makingProps(sec)} />
        : (
          <Workbench
            onStart={onStart}
            bench={bench}
            busy={showActive ? busy : null}
            actions={{
              onEditMat: () => make.openMaterial(),
              onOpenStyle: () => make.openStyle(),
              onOpenOrder: () => make.openMake(),
              onExpand: () => make.unfold(),
              onStop: () => { void make.stop(); },
              onRetry: () => { if (active?.phase === 'order-failed') void make.submitOrder(); else if (active?.order) make.openMake(); else make.openMaterial(); },
              onSave: () => { const id = showActive ? active?.id : benchRecord?.id; if (id) void saveAs(id, bench?.title ?? ''); },
              onZoom: () => { const id = showActive ? active?.id : benchRecord?.id; if (id) { setRecSel(id); setTab('records'); } },
              onReview: () => { const id = showActive ? active?.id : benchRecord?.id; if (id) { setRecSel(id); setTab('records'); } },
            }}
            log={log((id) => setSelId(id === active?.id ? null : id), '작업판에 올리기')}
          />
        ))}
      {activeTab === 'records' && (recordPicked
        ? <JobView {...jobViewProps(recordPicked, rate, localRec, {
          backLabel: '기록으로', onBack: () => setRecSel(null), onSave: () => { void saveAs(recordPicked.id, recordPicked.name ?? ''); },
          review: recordPicked.userId === currentUser?.id && recordPicked.status === 'done' ? { value: reviewOf(recordPicked), onSave: (v) => { void saveReview(recordPicked, v); } } : null,
        })} />
        : <RecordList {...log((id) => setRecSel(id), '자세히 보기')} title="내 기록" onAll={undefined} />)}
      {activeTab === 'costs' && (
        <section className="bae-log" aria-label="비용">
          <div className="bae-log-msg"><p className="bae-msg-title">팀 비용 표는 8단계에서 열려요</p><p className="bae-msg-text">이번 달 내 사용: {usage?.images ?? 0}장 · {wonOf(usage?.usd ?? 0, rate)}</p></div>
        </section>
      )}
      {activeTab === 'settings' && <BaeSettingsTab />}
      <BaeMakeLayer />
    </div>
  );
}
