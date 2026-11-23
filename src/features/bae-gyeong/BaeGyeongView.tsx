/**
 * BAE경 (Bflow 사이드바의 별도 메뉴, 景). 위쪽 탭: 작업대 · 기록 · 비용(검수자) · 설정 (14e 1장: '만들기' 탭은 뺐다).
 * 이 화면에 들어오는 길은 `canAccessBaeGyeong`(featureFlag.ts)을 거치고, 실제로 막는 것은 서버 함수다.
 * 만들기 상태(useBaeMake)는 이 화면 밖에 있어서, 다른 메뉴에 다녀와도 작업이 이어진다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, MonitorCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/useAuthStore';
import { baeJobHasLock, baeJobVariant, type BaeJob, type BaeUsageSummary } from '@/shared/bae/jobs';
import { useBaeStore, baeGw, type BaeTab } from './useBaeStore';
import { Workbench, type BaeStartKind } from './home/Workbench';
import { filterBaeRecordRows, type BaeDropView, type BaeDropZone, type BaeRecordListProps, type BaeReviewView } from './home/benchTypes';
import { RecordList } from './records/RecordList';
import { JobView } from './records/JobView';
import { useImageViewer } from './view/ImageViewer';
import { MakingStage } from './make/MakingStage';
import { BaeSettingsTab } from './settings/BaeSettingsTab';
import { baeBoard, baeDraftVsRecord, baeRecordEditBlock, useBaeMake, type BaeDraftMatch } from './state/useBaeMake';
import { useBaeLocal, useBaeTools, type BaeToolTarget } from './state/useBaeTools';
import { baeUpRunning, useBaeUpscale } from './state/useBaeUpscale';
import { useBaePcCheck } from './state/useBaePcCheck';
import { useBaeJobs, visibleBaeJobs } from './state/useBaeJobs';
import { BaeMakeLayer, useSeconds } from './state/BaeMakeLayer';
import { KIND_LABEL, activeBench, baeRecordTitle, jobViewProps, makingProps, recordBench, recordRow, reviewOf, stampPanelView, upscaleChildFact, wonOf } from './state/baeViewModel';
import { useBaeAngle, baeAngleActiveTarget, baeAngleRecordTarget, baeLayersFromActive, baeLayersFromRecord } from './state/useBaeAngle';
import type { AngleTarget } from './angle/controller';
import { TeamRecords } from './records/TeamRecords';
import { CostTab } from './costs/CostTab';
import { useBaeTeam } from './state/useBaeTeam';
import { useBaeStamps } from './state/useBaeStamps';
import { BAE_STAMP_LABEL, type BaeStamp } from '@/shared/bae/review';
import { useBaeJobJumpStore, usePendingBaeJobJump } from './comments/baeJobJump';
import { notifyBaeStampSlack } from './comments/baeCommentSlack';
import './bae-gyeong.css';

/** 기록 목록을 받은 계정 — 다른 계정으로 바뀌면 목록을 비운다 (화면을 다시 열 때마다 비우지는 않는다). */
let jobsActor: string | null = null;
/** 이 PC 원본 그림 주소 (없으면 null → 서버 미리보기). 판을 바꾸면(결과 도구) 새 주소로. */
function useLocalResult(jobId: string | null, updatedAt: string | null = null): string | null {
  const url = useBaeLocal((s) => (jobId ? s.urls[jobId] ?? null : null));
  useEffect(() => { if (jobId) useBaeLocal.getState().ensure(jobId); }, [jobId, updatedAt]);
  return url;
}
/** 그림 주소 → Blob (이 PC 원본 · 미리보기). */
async function blobOf(src: string): Promise<Blob> { const r = await fetch(src); if (!r.ok) throw new Error('그림을 불러오지 못했어요.'); return r.blob(); }
const imageOf = (list: Iterable<File> | null | undefined) => Array.from(list ?? []).find((f) => f.type.startsWith('image/')) ?? null;

export default function BaeGyeongView() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { access, loading, error, tab, setTab, start, keyStatus, row } = useBaeStore();
  const make = useBaeMake();
  const jobs = useBaeJobs();
  const tools = useBaeTools();
  const upscale = useBaeUpscale();
  /** 4K로 키우는 중인 그림이 나온 기록 (그 기록의 4K 버튼이 '키우는 중') */
  const upParent = upscale.up && baeUpRunning(upscale.up.phase) ? upscale.up.parentJobId : null;
  const [drop, setDrop] = useState<{ mode: 'drag' | 'paste'; file: File | null } | null>(null);
  const denoiseFileRef = useRef<HTMLInputElement>(null);
  const upscaleFileRef = useRef<HTMLInputElement>(null);
  const layersFileRef = useRef<HTMLInputElement>(null);
  const angleFileRef = useRef<HTMLInputElement>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [recSel, setRecSel] = useState<string | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');
  const [usage, setUsage] = useState<BaeUsageSummary | null>(null);
  const rate = Number((row('prices')?.value as { krwPerUsd?: unknown } | undefined)?.krwPerUsd) || 1400;
  // ── 8단계: 내 기록 | 팀 기록 (검수자), 확인 도장, 새 도장 표시 ──
  const [recScope, setRecScope] = useState<'mine' | 'team'>('mine');
  const [teamSel, setTeamSel] = useState<string | null>(null);
  const team = useBaeTeam();
  const users = useAuthStore((s) => s.users);
  const stampIds = useBaeStamps((s) => s.ids);
  const stampFresh = useBaeStamps((s) => s.fresh);
  const stampCount = useBaeStamps((s) => s.count);
  const marked = useMemo(() => new Set([...stampIds, ...stampFresh]), [stampIds, stampFresh]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? '검수자';
  // ── 9단계 코멘트: 종 · Windows 알림 · 슬랙 바로가기(bflow://bae/…) · 댓글 링크로 온 '이 기록 열기' ──
  //   요청(comments/baeJobJump)은 이 화면이 권리를 다 읽은 뒤 한 번만 꺼낸다. 내 기록이면 '내 기록', 남의 기록은 검수자만 '팀 기록'으로.
  //   볼 수 있는지는 서버가 다시 정한다(한 건 읽기가 거절되면 알리고 열지 않는다). 가리킨 코멘트는 그 기록의 코멘트 칸이 강조한다.
  const jump = usePendingBaeJobJump();
  const [focusComment, setFocusComment] = useState<{ jobId: string; commentId: string | null } | null>(null);

  useEffect(() => {
    const id = currentUser?.id ?? null;
    if (jobsActor !== id) { useBaeJobs.getState().reset(); useBaeTeam.getState().reset(); useBaePcCheck.getState().reset(); jobsActor = id; }
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
    const off = g.onChanged((what) => {
      if (what !== 'jobs') return;
      void useBaeJobs.getState().load(); loadUsage();
      if (useBaeTeam.getState().loaded) void useBaeTeam.getState().refresh();   // 팀 기록도 '바뀐 것만'
    });
    const onOnline = () => { void g.online().catch(() => undefined); };
    window.addEventListener('online', onOnline);
    return () => { off(); window.removeEventListener('online', onOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.canUse]);

  const active = make.job;
  const live = active && (active.phase === 'ordering' || active.phase === 'drawing');
  const sec = useSeconds(active?.startedAt ?? null, !!live || active?.phase === 'revising');
  const zoom = useImageViewer();
  // 크게 보며 그리던 작업이 다 되면 만드는 화면에 잠깐 남아 마무리 장면(점이 풀리며 완성 그림)을 보여 주고 작업대로 (2026-11-18)
  const bigDrawId = useRef<string | null>(null);
  const [finaleOver, setFinaleOver] = useState<string | null>(null);
  const rows = useMemo(() => visibleBaeJobs(jobs), [jobs]);
  const withPd = (j: BaeJob | null): BaeJob | null => { if (!j) return null; const d = jobs.details[j.id]; return d && (d.updatedAt >= j.updatedAt || !j.pd) ? { ...j, pd: d.pd, stampBy: d.stampBy, stampNote: d.stampNote } : j; };
  const picked: BaeJob | null = rows.find((r) => r.id === (selId ?? '')) ?? null;
  const showActive = !!active && (!selId || selId === active.id);
  const benchRecord = withPd(showActive ? null : picked ?? (active ? null : rows[0] ?? null));
  const localBench = useLocalResult(benchRecord?.id ?? null, benchRecord?.updatedAt ?? null);
  const recordPicked = withPd(rows.find((r) => r.id === recSel) ?? null);
  // 한 건의 PD 글: 처음 열 때와 그 줄이 바뀌었을 때만 받는다 (결과 판만 바꾼 줄도 PD 글은 그대로 보여 준다)
  useEffect(() => { if (benchRecord) void jobs.loadDetail(benchRecord.id, benchRecord.updatedAt); }, [benchRecord?.id, benchRecord?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // 작업대에서 보는 내 기록의 주문서 고치기 (2026-11-23): 재료 창이 그 그림 때와 같은지 본다 (그리는 손을 따라가지 않게 잠깐 쉬었다가)
  const [recMatch, setRecMatch] = useState<{ id: string; v: BaeDraftMatch } | null>(null);
  const recEditable = !!benchRecord && !!currentUser && benchRecord.userId === currentUser.id && !baeRecordEditBlock(benchRecord);
  useEffect(() => {
    if (!recEditable || !benchRecord) return;
    let gone = false; const rec = benchRecord;
    const t = window.setTimeout(() => { void baeDraftVsRecord(rec).then((v) => { if (!gone) setRecMatch({ id: rec.id, v }); }).catch(() => undefined); }, 600);
    return () => { gone = true; window.clearTimeout(t); };
  }, [recEditable, benchRecord?.id, benchRecord?.images.rough, make.boardRev, make.request, make.ratio, make.refs.length, make.bases.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (recordPicked) void jobs.loadDetail(recordPicked.id, recordPicked.updatedAt); }, [recordPicked?.id, recordPicked?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const localRec = useLocalResult(recordPicked?.id ?? null, recordPicked?.updatedAt ?? null);
  // 팀 기록 한 건: 목록에서 빠져도(예: '도장 없음'에서 도장을 찍음) 연 채로 둔다
  const teamBase: BaeJob | null = recScope === 'team' && teamSel ? (team.rows.find((r) => r.id === teamSel) ?? team.details[teamSel] ?? null) : null;
  const teamDetail = teamBase ? team.details[teamBase.id] : undefined;
  const teamPicked: BaeJob | null = teamBase
    ? (teamDetail && teamDetail.updatedAt >= teamBase.updatedAt ? teamDetail : { ...teamBase, pd: teamBase.pd ?? teamDetail?.pd, stampBy: teamBase.stampBy ?? teamDetail?.stampBy, stampNote: teamBase.stampNote ?? teamDetail?.stampNote })
    : null;
  const localTeam = useLocalResult(teamPicked && teamPicked.userId === currentUser?.id ? teamPicked.id : null, teamPicked?.updatedAt ?? null);
  useEffect(() => { if (teamPicked) { void useBaeTeam.getState().loadDetail(teamPicked.id, teamPicked.updatedAt); void useBaeTeam.getState().loadHistory(teamPicked.id); } }, [teamPicked?.id, teamPicked?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (recordPicked) void useBaeTeam.getState().loadHistory(recordPicked.id); }, [recordPicked?.id, recordPicked?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // 검수자에서 빠지면 곧바로 팀 기록을 닫는다 ('members' 신호 → 권리 다시 읽기)
  useEffect(() => { if (!access.canReview) { setRecScope('mine'); setTeamSel(null); useBaeTeam.getState().reset(); } }, [access.canReview]);
  // 내 기록을 보면 새 도장(좋아요 · 다시)을 본 것으로 적는다 — 景 숫자가 사라지고, 줄의 '새 도장' 표시는 이 화면을 떠날 때까지 남는다
  useEffect(() => { if (tab === 'records' && recScope === 'mine' && access.canUse && stampCount > 0) void useBaeStamps.getState().markSeen(); }, [tab, recScope, access.canUse, stampCount]);
  useEffect(() => () => useBaeStamps.getState().clearFresh(), []);
  useEffect(() => {
    if (!jump || loading || !currentUser || !access.canUse) return;
    const req = useBaeJobJumpStore.getState().consume(jump.seq);
    if (!req) return;
    const me = currentUser.id;
    setTab('records');
    setFocusComment({ jobId: req.jobId, commentId: req.commentId });
    const openMine = () => { setRecScope('mine'); setTeamSel(null); setRecSel(req.jobId); };
    if (rows.some((r) => r.id === req.jobId && r.userId === me)) { openMine(); return; }
    void baeGw().jobGet(req.jobId).then((j) => {
      if (useAuthStore.getState().currentUser?.id !== me) return;
      if (j.userId === me) { openMine(); return; }
      if (useBaeStore.getState().access.canReview) {
        useBaeTeam.getState().put(j);
        setRecScope('team'); setRecSel(null); setTeamSel(j.id);
        return;
      }
      setFocusComment(null);
      toast.error('이 기록은 만든 사람과 검수자만 볼 수 있어요');
    }).catch((e) => {
      setFocusComment(null);
      toast.error(`이 기록을 열 수 없어요: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, [jump, loading, currentUser?.id, access.canUse]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 한 건 보기의 코멘트 칸(9단계). 서버에 있는 기록만 — 이 PC 에서 방금 만들어 아직 안 올라간 작업은 서버가 모르니 칸을 그리지 않는다. */
  const commentsFor = (j: BaeJob, onServer: boolean) => (onServer
    ? { jobId: j.id, jobName: baeRecordTitle(j), focusCommentId: focusComment?.jobId === j.id ? focusComment.commentId : null }
    : null);
  const doStamp = async (j: BaeJob, s: BaeStamp | null, note: string) => {
    if (!currentUser) return;
    const before = { stamp: j.stamp, note: j.stampNote ?? null, by: j.stampBy ?? null };
    try {
      const saved = await useBaeTeam.getState().stamp(j, s, s === null ? null : note.trim() || null, currentUser.id);
      if (saved.userId === currentUser.id) useBaeJobs.getState().putLocal(saved);
      toast.success(s === null ? '도장을 뺐어요' : `${BAE_STAMP_LABEL[s]} 도장을 찍었어요`);
      // 9단계: 좋아요 · 다시는 만든 사람에게 슬랙으로도(종 알림은 서버가 도장 → 코멘트 한 줄로 만든다). 같은 도장을 다시 누른 것은 보내지 않는다.
      const changed = before.stamp !== s || before.note !== (saved.stampNote ?? null) || before.by !== currentUser.id;
      if ((s === 'good' || s === 'again') && changed) {
        void notifyBaeStampSlack({ job: { id: saved.id, userId: saved.userId, name: baeRecordTitle(saved) }, stamp: s, note: saved.stampNote ?? null, me: currentUser, users })
          .then((r) => { if (r && r.failed > 0) toast.error('만든 사람에게 슬랙으로 알리지 못했어요'); })
          .catch(() => undefined);
      }
    } catch (e) { toast.error(`도장을 찍지 못했어요: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const stampFor = (j: BaeJob) => stampPanelView(j, team.history[j.id], {
    nameOf, fresh: marked.has(j.id) && j.userId === currentUser?.id, canStamp: access.canReview, saving: !!team.stamping[j.id],
    onStamp: (s, note) => { void doStamp(j, s, note); },
  });
  const scopeSeg = access.canReview ? (
    <div className="bae-seg bae-scope" role="group" aria-label="누구의 기록">
      <button type="button" className="bae-btn bae-btn-s" aria-pressed={recScope === 'mine'} onClick={() => { setRecScope('mine'); setTeamSel(null); }}>내 기록</button>
      <button type="button" className="bae-btn bae-btn-s" aria-pressed={recScope === 'team'} onClick={() => { setRecScope('team'); setRecSel(null); }}>팀 기록</button>
    </div>
  ) : undefined;

  const tabs: Array<{ id: BaeTab; label: string; show: boolean }> = [
    { id: 'bench', label: '작업대', show: true },
    { id: 'records', label: '기록', show: true },
    { id: 'costs', label: '비용', show: access.canReview },
    { id: 'settings', label: '설정', show: true },
  ];
  const activeTab = tabs.find((t) => t.id === tab && t.show)?.id ?? 'bench';
  const onStart = (kind: BaeStartKind) => {
    if (kind === 'new') { setSelId(null); make.openMaterial('new'); }
    else if (kind === 'same') { setSelId(null); void make.openSame(); }
    else if (kind === 'denoise') denoiseFileRef.current?.click();   // 14d 8장 6번: 먼저 그림을 고르고, 고르면 창
    else if (kind === 'upscale') { if (!upscaleBusyShown(null)) upscaleFileRef.current?.click(); }
    else if (kind === 'layers') layersFileRef.current?.click();   // 레이어 · 각도도 먼저 그림을 고르고, 고르면 창
    else angleFileRef.current?.click();
  };
  // 그림 파일을 끌고 오거나(Ctrl+V 로 붙여 넣으면) 작업판이 '놓는 자리' 여섯 칸으로 (14b 10-2). 창이 떠 있으면 그 창이 받는다.
  const benchFree = tab === 'bench' && !make.win && !(make.job && (make.job.phase === 'ordering' || make.job.phase === 'drawing') && make.makingBig);
  useEffect(() => {
    if (!benchFree || !access.canUse) { setDrop(null); return; }
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setDrop((d) => d ?? { mode: 'drag', file: null }); } };
    const onOver = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const onLeave = (e: DragEvent) => { if (!e.relatedTarget && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight)) setDrop((d) => (d?.mode === 'drag' ? null : d)); };
    const onDrop = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); setDrop((d) => (d?.mode === 'drag' ? null : d)); };
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null; if (t && (t.closest('input, textarea, [contenteditable="true"]'))) return;
      const f = imageOf(Array.from(e.clipboardData?.files ?? [])); if (!f) return;
      e.preventDefault(); setDrop({ mode: 'paste', file: f });
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrop(null); };
    window.addEventListener('dragenter', onEnter); window.addEventListener('dragover', onOver); window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop); window.addEventListener('paste', onPaste); window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragover', onOver); window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop); window.removeEventListener('paste', onPaste); window.removeEventListener('keydown', onKey);
    };
  }, [benchFree, access.canUse]);
  const onZone = (zone: BaeDropZone, dropped: File | null) => {
    const file = dropped ?? drop?.file ?? null; setDrop(null);
    if (!file) { toast('그림 파일만 놓을 수 있어요'); return; }
    if (zone === 'rough') { setSelId(null); make.openMaterial('new'); void baeBoard().loadFile(file); }
    else if (zone === 'base') { setSelId(null); void make.openSame(file); }
    else if (zone === 'denoise') void tools.openDenoise({ blob: file, label: file.name });
    else if (zone === 'upscale') void upscale.open({ blob: file, label: file.name });
    else if (zone === 'layers') void useBaeAngle.getState().openLayersFile(file);
    else void useBaeAngle.getState().openAngleFile(file);
  };
  const dropView: BaeDropView | null = drop && benchFree ? { mode: drop.mode, onZone, onCancel: () => setDrop(null) } : null;
  // 결과 도구 (다듬기 · 기준 배경으로 새 컷): 지금 작업이거나 기록 한 건
  const targetOf = (j: BaeJob | null): BaeToolTarget | null => (j ? { jobId: j.id, variant: baeJobVariant(j), hasLock: baeJobHasLock(j) } : null);
  const noiseFor = (t: BaeToolTarget | null, local: string | null, j: BaeJob | null, title: string) => {
    if (!t) return;
    if (local || !j) { void tools.toggleNoise(t); return; }
    // 다른 PC 에서 만든 그림: 미리보기로 노이즈 제거 창을 연다 (새 도구 작업)
    const src = j.images.result; if (!src) { toast('이 그림의 원본도 미리보기도 없어요'); return; }
    void blobOf(src).then((b) => tools.openDenoise({ blob: b, label: title, parentJobId: j.id })).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  };
  /** 4K로 키우는 중이면 그 창을 다시 띄운다 (같은 기록이면 알림 없이). 띄웠으면 true. */
  const upscaleBusyShown = (jobId: string | null) => {
    const cur = useBaeUpscale.getState().up;
    if (!cur || !baeUpRunning(cur.phase)) return false;
    useBaeUpscale.getState().show();
    if (!jobId || cur.parentJobId !== jobId) toast('지금 키우는 그림이 끝나면 다른 그림을 키울 수 있어요');
    return true;
  };
  /** 결과 도구의 4K로 키우기: 이 PC 원본(없으면 서버 미리보기)으로 4K 창 (14d 2장 '결과 크게 보기의 4K로 키우기'). */
  const upscaleFrom = (src: string | null, a: { jobId: string; label: string; ratio: string | null; fromPreview: boolean }) => {
    if (upscaleBusyShown(a.jobId)) return;
    if (!src) { toast('이 그림의 원본도 미리보기도 없어요'); return; }
    void blobOf(src).then((b) => upscale.open({ blob: b, label: a.label, parentJobId: a.jobId, ratio: a.ratio, fromPreview: a.fromPreview }))
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  };
  const upscaleRecord = (j: BaeJob, local: string | null, title: string) => {
    const desc = (j.summary.request ?? '').replace(/[{｛][^}｝]*[}｝]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    upscaleFrom(local ?? j.images.result ?? null, { jobId: j.id, label: title || j.name || desc || j.summary.source || KIND_LABEL[j.kind] || '그림', ratio: j.summary.ratio ?? null, fromPreview: !local });
  };
  /** 한 건 보기의 숫자에 '뒤에 한 일: 4K' 를 붙인다 (이 기록에서 나온 4K 기록이 있으면). */
  const withUpscaleFact = <T extends { facts: { k: string; v: string }[] }>(p: T, j: BaeJob): T => {
    const f = upscaleChildFact(j, rows); return f ? { ...p, facts: [...p.facts, f] } : p;
  };
  const useBaseFrom = (src: string | null) => {
    if (!src) { toast('기준 배경으로 쓸 그림이 없어요'); return; }
    setSelId(null); void make.openSame(src);
  };
  // ── 이어서 만들기: 다른 각도로 (7단계) · 레이어로 나누기 (5단계) ──
  const angleOpen = (p: Promise<AngleTarget | null>) => {
    void p.then((t) => { if (t) useBaeAngle.getState().openAngle(t); else toast('이 그림의 원본도 미리보기도 없어요'); })
      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
  };
  const angleRecord = (j: BaeJob, title: string) => angleOpen(baeAngleRecordTarget(j, title || baeRecordTitle(j)));
  const layersRecord = (j: BaeJob, title: string) => { void baeLayersFromRecord(j, title || baeRecordTitle(j)); };
  /** 지금 작업의 결과: 기록 줄이 이미 왔으면 그것으로 (다른 각도 기록 · 영어 주문서가 같이 간다), 아니면 이 화면의 그림으로. */
  const angleActive = (title: string) => {
    const a = useBaeMake.getState().job; if (!a?.result) return;
    const rec = rows.find((r) => r.id === a.id && r.status === 'done');
    if (rec) { angleRecord(rec, title); return; }
    angleOpen(baeAngleActiveTarget({ jobId: a.id, url: a.result.url, name: title || '지금 그림', variant: a.result.variant, place: a.kind === 'angle' ? null : make.place, prompt: a.promptText || null }));
  };
  const layersActive = (title: string) => {
    const a = useBaeMake.getState().job; if (!a?.result) return;
    void baeLayersFromActive({ jobId: a.id, url: a.result.url, label: title || '지금 그림', notes: a.kind === 'angle' ? '' : make.request });
  };
  /** 레이어 작업의 PSD 가 있는 폴더 (이 PC). 메인은 이번에 앱을 켠 뒤 나눈 작업만 안다. */
  const showPsd = async (jobId: string) => {
    const gw = window.baeLayersAPI;
    if (!gw) { toast.message('테스트 모드에서는 폴더를 열지 않아요.'); return; }
    const ok = await gw.showPsd(jobId).catch(() => false);
    if (!ok) toast('PSD 폴더를 열지 못했어요. 이 PC에서 이번에 앱을 켠 뒤 나눈 그림만 열 수 있어요.');
  };
  const psdFor = (j: BaeJob) => (j.kind === 'layers' && j.status === 'done' && j.result.layers && j.userId === currentUser?.id ? () => { void showPsd(j.id); } : undefined);
  /** 각도 작업이 실패했거나 각도를 다시 맞출 때: 마지막에 연 그림으로 각도 창 */
  const reopenAngle = () => { if (!useBaeAngle.getState().reopenAngle()) toast('다시 열 그림이 없어요. 결과나 그림 파일로 다른 각도로를 열어 주세요.'); };

  const rowViews = rows.map((j) => ({ ...recordRow(j, rate, null), fresh: marked.has(j.id) }));
  const activeRow = active && !rows.some((r) => r.id === active.id) && (live || active.phase === 'ordered')
    ? [{ id: active.id, thumb: active.angle?.rough ?? active.inputs?.rough.small ?? null, thumbAlt: null,
      title: active.angle ? `다른 각도 ${active.angle.label}` : active.order?.summary?.slice(0, 40) || '새 배경', name: '', sub: '',
      kindLabel: KIND_LABEL[active.kind], when: '', took: live ? `${sec}초째` : '', cost: wonOf(active.orderCostUsd ?? 0, rate), state: 'live' as const,
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
  /** 팀 기록 한 건 (검수자): 도장 칸이 오른쪽에. 다른 사람의 원본은 이 PC 에 없어서 PNG 저장 · 다듬기는 내 작업일 때만. */
  const teamJobView = (j: BaeJob) => {
    const mine = j.userId === currentUser?.id;
    const p = jobViewProps(j, rate, mine ? localTeam : null, {
      backLabel: '팀 기록으로', onBack: () => { setTeamSel(null); setFocusComment(null); },
      onSave: mine ? () => { void saveAs(j.id, j.name ?? ''); } : undefined,
      review: null,
      onNoise: mine ? () => noiseFor(targetOf(j), localTeam, j, j.name ?? '') : undefined,
      onLock: mine ? () => { const t = targetOf(j); if (t) void tools.toggleLock(t); } : undefined,
      onUpscale: mine ? () => upscaleRecord(j, localTeam, j.name ?? '') : undefined,
      onUseBase: () => useBaseFrom((mine ? localTeam : null) ?? j.images.result ?? null),
      onLayers: mine ? () => layersRecord(j, j.name ?? '') : undefined,
      onAngle: mine ? () => angleRecord(j, j.name ?? '') : undefined,
      onShowPsd: psdFor(j),
    }, tools.busy[j.id], upParent === j.id);
    return { ...withUpscaleFact(p, j), result: p.result && !mine ? { ...p.result, tools: null } : p.result, stamp: stampFor(j), comments: commentsFor(j, true) };
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
  if (showActive && active) { const b = activeBench(rate, sec, tools.busy[active.id], upParent === active.id); bench = b.bench; busy = b.busy; }
  else if (benchRecord) bench = recordBench(benchRecord, rate, localBench, tools.busy[benchRecord.id], upParent === benchRecord.id,
    recEditable ? { match: recMatch?.id === benchRecord.id ? recMatch.v : null, onStarted: () => setSelId(null) } : undefined);
  const activeTarget: BaeToolTarget | null = showActive && active?.result ? { jobId: active.id, variant: active.result.variant, hasLock: active.result.hasLock } : null;
  const bigLive = !!live && make.makingBig && showActive;
  if (bigLive && active?.phase === 'drawing') bigDrawId.current = active.id;
  const finale = !bigLive && showActive && make.makingBig && !!active && active.phase === 'done' && !!active.result && bigDrawId.current === active.id
    && finaleOver !== active.id && Date.now() - (active.doneAt ?? 0) < 10_000;
  const big = bigLive || finale;
  const endFinale = () => { if (active) setFinaleOver(active.id); bigDrawId.current = null; };

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
        ? <MakingStage {...makingProps(sec, endFinale)} />
        : (
          <Workbench
            onStart={onStart}
            bench={bench}
            busy={showActive ? busy : null}
            drop={dropView}
            actions={{
              onEditMat: () => { if (active?.kind === 'angle') reopenAngle(); else make.openMaterial(); },
              onOpenStyle: () => make.openStyle(),
              onExpand: () => make.unfold(),
              onStop: () => { void make.stop(); },
              // 그리다 실패한 작업은 2 주문서 칸의 '그림 만들기'로 다시 그린다 (다시 시도 버튼이 돈을 바로 쓰지 않게)
              onRetry: showActive && active?.order && active.kind !== 'angle' && active.phase !== 'order-failed' ? undefined
                : () => { if (active?.kind === 'angle') reopenAngle(); else if (active?.phase === 'order-failed') void make.submitOrder(); else make.openMaterial(); },
              onSave: () => { const id = showActive ? active?.id : benchRecord?.id; if (id) void saveAs(id, bench?.title ?? ''); },
              // 결과 크게 보기: 작업판 그대로 두고 확대 보기 (휠 · 끌기 · 작은 지도 · 원본 크기)
              onZoom: () => { if (bench?.result) zoom.open({ src: bench.result.src, alt: bench.result.alt, title: bench.title }); },
              onReview: () => { const id = showActive ? active?.id : benchRecord?.id; if (id) { setRecSel(id); setTab('records'); } },
              onNoise: () => { if (activeTarget) void tools.toggleNoise(activeTarget); else noiseFor(targetOf(benchRecord), localBench, benchRecord, bench?.title ?? ''); },
              onLock: () => { const t = activeTarget ?? targetOf(benchRecord); if (t) void tools.toggleLock(t); },
              onUpscale: () => {
                if (showActive && active) upscaleFrom(active.result?.url ?? null, { jobId: active.id, label: bench?.title ?? '', ratio: make.ratio, fromPreview: false });
                else if (benchRecord) upscaleRecord(benchRecord, localBench, bench?.title ?? '');
              },
              onUseBase: () => useBaseFrom(showActive ? active?.result?.url ?? null : localBench ?? benchRecord?.images.result ?? null),
              onLayers: () => { if (showActive) layersActive(bench?.title ?? ''); else if (benchRecord) layersRecord(benchRecord, bench?.title ?? ''); },
              onAngle: () => { if (showActive) angleActive(bench?.title ?? ''); else if (benchRecord) angleRecord(benchRecord, bench?.title ?? ''); },
            }}
            log={log((id) => setSelId(id === active?.id ? null : id), '작업판에 올리기')}
          />
        ))}
      {activeTab === 'records' && recScope === 'team' && access.canReview && currentUser && (teamPicked
        ? <JobView {...teamJobView(teamPicked)} />
        : <TeamRecords scope={scopeSeg} rate={rate} actorId={currentUser.id} selectedId={teamSel} onPick={(id) => setTeamSel(id)} />)}
      {activeTab === 'records' && !(recScope === 'team' && access.canReview) && (recordPicked
        ? <JobView {...withUpscaleFact(jobViewProps(recordPicked, rate, localRec, {
          backLabel: '기록으로', onBack: () => { setRecSel(null); setFocusComment(null); }, onSave: () => { void saveAs(recordPicked.id, recordPicked.name ?? ''); },
          review: recordPicked.userId === currentUser?.id && recordPicked.status === 'done' ? { value: reviewOf(recordPicked), onSave: (v) => { void saveReview(recordPicked, v); } } : null,
          onNoise: () => noiseFor(targetOf(recordPicked), localRec, recordPicked, recordPicked.name ?? ''),
          onLock: () => { const t = targetOf(recordPicked); if (t) void tools.toggleLock(t); },
          onUpscale: () => upscaleRecord(recordPicked, localRec, recordPicked.name ?? ''),
          onUseBase: () => useBaseFrom(localRec ?? recordPicked.images.result ?? null),
          onLayers: () => layersRecord(recordPicked, recordPicked.name ?? ''),
          onAngle: () => angleRecord(recordPicked, recordPicked.name ?? ''),
          onShowPsd: psdFor(recordPicked),
        }, tools.busy[recordPicked.id], upParent === recordPicked.id), recordPicked)} stamp={stampFor(recordPicked)}
          comments={commentsFor(recordPicked, jobs.rows.some((r) => r.id === recordPicked.id) || !!jobs.details[recordPicked.id])} />
        : <RecordList {...log((id) => setRecSel(id), '자세히 보기')} title="내 기록" onAll={undefined} scope={scopeSeg} />)}
      {activeTab === 'costs' && access.canReview && <CostTab rate={rate} />}
      {activeTab === 'settings' && <BaeSettingsTab />}
      {/* 그림 고르기 (시작 줄의 도구). 노이즈 제거 칸이 맨 뒤 — 3단계 화면 시험이 마지막 칸을 쓴다 */}
      <input ref={layersFileRef} data-pick="layers" className="bae-vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { const f = imageOf(e.target.files ? Array.from(e.target.files) : null); e.target.value = ''; if (f) void useBaeAngle.getState().openLayersFile(f); }} />
      <input ref={angleFileRef} data-pick="angle" className="bae-vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { const f = imageOf(e.target.files ? Array.from(e.target.files) : null); e.target.value = ''; if (f) void useBaeAngle.getState().openAngleFile(f); }} />
      <input ref={upscaleFileRef} data-pick="upscale" className="bae-vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { const f = imageOf(e.target.files ? Array.from(e.target.files) : null); e.target.value = ''; if (f) void upscale.open({ blob: f, label: f.name }); }} />
      <input ref={denoiseFileRef} data-pick="denoise" className="bae-vh" type="file" accept="image/*" tabIndex={-1} aria-hidden="true"
        onChange={(e) => { const f = imageOf(e.target.files ? Array.from(e.target.files) : null); e.target.value = ''; if (f) void tools.openDenoise({ blob: f, label: f.name }); }} />
      <BaeMakeLayer />
      {zoom.viewer}
    </div>
  );
}
