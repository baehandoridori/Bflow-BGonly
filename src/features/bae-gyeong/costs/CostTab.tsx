// 비용 탭 (검수자, 계획 14 4-3 · 6-1): 사람 × 기간 표, 종류별 합, 이번 달 팀 합계, CSV 내보내기.
// 숫자는 서버 장부 줄을 묶은 것 그대로이고, 표의 합이 같은 장부 줄들의 합과 같은지 화면에도 적는다.
// 한도: 설정 책장에 월 한도 값이 아직 없어서 '한도 대비'는 그리지 않는다 (OpenAI 쪽 월 하드 한도는 그쪽 화면에서 본다).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  BAE_COST_RANGE_LABEL, baeCostBucketsFor, baeCostRangeDates, baeCostTable,
  type BaeCostBucket, type BaeCostRange, type BaeUsageTeam,
} from '@/shared/bae/review';
import { baeGw } from '../useBaeStore';
import { wonOf } from '../state/baeViewModel';
import '../records/review.css';

const RANGES: BaeCostRange[] = ['this-month', 'last-month', 'three-months', 'this-year'];
const BUCKET_LABEL: Record<BaeCostBucket, string> = { day: '일', week: '주', month: '달' };
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));
const usd = (v: number) => `$${v.toFixed(v >= 10 ? 2 : 4)}`;

export function CostTab({ rate }: { rate: number }) {
  const [range, setRange] = useState<BaeCostRange>('this-month');
  const [bucket, setBucket] = useState<BaeCostBucket>('day');
  const [report, setReport] = useState<BaeUsageTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const gen = useRef(0);
  const buckets = baeCostBucketsFor(range);
  const b = buckets.includes(bucket) ? bucket : 'week';

  const load = useCallback(async () => {
    const my = ++gen.current; setLoading(true);
    try {
      const { from, to } = baeCostRangeDates(range, new Date());
      const r = await baeGw().usageTeam(from, to, b);
      if (my === gen.current) { setReport(r); setError(null); }
    } catch (e) { if (my === gen.current) setError(errText(e)); }
    finally { if (my === gen.current) setLoading(false); }
  }, [range, b]);
  useEffect(() => { void load(); }, [load]);
  // 장부 줄은 작업과 함께 올라온다: 'jobs' 신호가 오면 (몰려 와도 한 번) 다시 받는다 — 고정 간격으로 다시 받지 않는다.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = baeGw().onChanged((w) => { if (w !== 'jobs') return; if (timer) clearTimeout(timer); timer = setTimeout(() => { void load(); }, 2500); });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [load]);

  const table = useMemo(() => (report ? baeCostTable(report) : null), [report]);
  const exportCsv = async () => {
    if (exporting) return; setExporting(true);
    try {
      const { from, to } = baeCostRangeDates(range, new Date());
      const where = await baeGw().usageExport(from, to, b);
      if (where) toast.success('CSV로 저장했어요');
      else if (!window.baeGyeongAPI) toast.message('테스트 모드에서는 파일로 저장하지 않아요.');
    } catch (e) { toast.error(`내보내지 못했어요: ${errText(e)}`); }
    finally { setExporting(false); }
  };

  return (
    <section className="bae-log bae-cost" aria-labelledby="bae-cost-h">
      <div className="bae-log-head">
        <h2 className="bae-h2" id="bae-cost-h">팀 비용</h2>
        <div className="bae-log-tools">
          <div className="bae-seg" role="group" aria-label="범위">
            {RANGES.map((r) => <button key={r} type="button" className="bae-btn bae-btn-s" aria-pressed={range === r} onClick={() => setRange(r)}>{BAE_COST_RANGE_LABEL[r]}</button>)}
          </div>
          <div className="bae-seg" role="group" aria-label="표의 칸">
            {(['day', 'week', 'month'] as const).map((k) => (
              <button key={k} type="button" className="bae-btn bae-btn-s" aria-pressed={b === k} disabled={!buckets.includes(k)} title={buckets.includes(k) ? undefined : '올해는 주나 달로 봐요'} onClick={() => setBucket(k)}>{BUCKET_LABEL[k]}</button>
            ))}
          </div>
          <button type="button" className="bae-btn bae-btn-s" disabled={exporting || !report} onClick={() => void exportCsv()}>
            {exporting ? <Loader2 size={14} className="bae-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}CSV 내보내기
          </button>
        </div>
      </div>

      {error ? (
        <div className="bae-log-msg bae-log-err" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <p className="bae-msg-title">비용을 불러오지 못했어요</p>
          <p className="bae-msg-text">{error}</p>
          <button type="button" className="bae-btn bae-btn-s" onClick={() => void load()}>다시 시도</button>
        </div>
      ) : !report || !table ? (
        <div className="bae-log-msg" aria-busy="true"><p className="bae-msg-text"><Loader2 size={14} className="bae-spin" aria-hidden="true" /> 장부를 읽는 중이에요</p></div>
      ) : (
        <>
          <div className="bae-cost-cards" aria-busy={loading}>
            <dl className="bae-cost-card">
              <dt>이번 달 팀 합계</dt>
              <dd className="bae-cost-big bae-num">{wonOf(report.month.usd, rate)}</dd>
              <dd className="bae-hint bae-num">{usd(report.month.usd)} · 부른 횟수 {report.month.n.toLocaleString('ko-KR')}번</dd>
            </dl>
            <dl className="bae-cost-card">
              <dt>{BAE_COST_RANGE_LABEL[range]} 합계</dt>
              <dd className="bae-cost-big bae-num">{wonOf(table.total.usd, rate)}</dd>
              <dd className="bae-hint bae-num">{usd(table.total.usd)} · 부른 횟수 {table.total.n.toLocaleString('ko-KR')}번 · {table.people.length}명</dd>
            </dl>
            <dl className="bae-cost-card">
              <dt>종류별</dt>
              <dd className="bae-cost-kinds">
                {table.kinds.length ? table.kinds.map((k) => (
                  <span key={k.kind} className="bae-cost-kind"><span className="bae-label">{k.label}</span><span className="bae-num">{wonOf(k.usd, rate)}</span><span className="bae-hint bae-num">{k.n}번</span></span>
                )) : <span className="bae-hint">아직 없어요</span>}
              </dd>
            </dl>
          </div>
          <p className={`bae-cost-check${table.check.same ? ' is-ok' : ' is-bad'}`} role="status">
            {table.check.same ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
            {table.check.same
              ? `표의 합이 장부 ${table.check.ledgerN.toLocaleString('ko-KR')}줄의 합(${usd(table.check.ledgerUsd)})과 같아요.`
              : `표의 합(${usd(table.check.tableUsd)})이 장부 줄의 합(${usd(table.check.ledgerUsd)})과 달라요. 다시 불러와 주세요.`}
          </p>

          {table.people.length ? (
            <div className="bae-cost-scroll" role="region" aria-label="사람 × 기간 표" tabIndex={0}>
              <table className="bae-table bae-cost-table">
                <thead>
                  <tr>
                    <th scope="col" className="bae-cost-name">사람</th>
                    {table.periods.map((p) => <th key={p.key} scope="col" className="c-num">{p.label}</th>)}
                    <th scope="col" className="c-num bae-cost-sum">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {table.people.map((person) => (
                    <tr key={person.userId}>
                      <th scope="row" className="bae-cost-name">{person.name}</th>
                      {table.periods.map((p) => {
                        const c = person.cells[p.key];
                        return <td key={p.key} className={`c-num bae-num${c ? '' : ' is-empty'}`} title={c ? `${usd(c.usd)} · ${c.n}번` : undefined}>{c ? wonOf(c.usd, rate) : '·'}</td>;
                      })}
                      <td className="c-num bae-num bae-cost-sum" title={`${usd(person.usd)} · ${person.n}번`}>{wonOf(person.usd, rate)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" className="bae-cost-name">합계</th>
                    {table.periods.map((p) => <td key={p.key} className={`c-num bae-num${p.n ? '' : ' is-empty'}`}>{p.n ? wonOf(p.usd, rate) : '·'}</td>)}
                    <td className="c-num bae-num bae-cost-sum">{wonOf(table.total.usd, rate)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="bae-log-msg"><p className="bae-msg-title">이 범위에는 쓴 비용이 없어요</p><p className="bae-msg-text">다른 범위를 골라 보세요.</p></div>
          )}
          <p className="bae-hint">원은 설정의 환율({rate.toLocaleString('ko-KR')}원/달러)로 셈했어요. 칸 위에 마우스를 올리면 달러와 부른 횟수가 보여요. 한 달에 한 번 OpenAI 사용량 화면의 총액과 견줘 보세요.</p>
        </>
      )}
    </section>
  );
}
