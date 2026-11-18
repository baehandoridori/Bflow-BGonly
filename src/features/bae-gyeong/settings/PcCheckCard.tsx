/**
 * 설정 탭의 '이 PC 점검' (모든 BAE경 사용자) 과 '팀 PC 점검' 표 (관리자 · 검수자). 계획 14b 10-5: 이 PC 점검은 팀원 설정에 남고
 * 결과가 관리자에게 보인다. 표는 서버 함수가 관리자 · 검수자에게만 열어 준다 — 그래서 설정의 관리자 칸이 아니라 검수자도 보는 이 자리에 둔다.
 * HTML pcCheck() 의 줄 모양 그대로: 점 색(좋음 · 주의 · 문제) · 이름 · 글, 맨 위 '정리'.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, MonitorCheck, RefreshCw, Users } from 'lucide-react';
import type { BaePcRow } from '@/shared/bae/pcCheck';
import { useBaeStore, baeGw } from '../useBaeStore';
import { useBaePcCheck } from '../state/useBaePcCheck';
import { whenText } from '../state/baeViewModel';
import { PC_CAN_LABEL, PC_LEVEL_LABEL, pcTeamCells, pcTeamSummary, pcUploadText, type PcCan } from './pcCheckView';
import './pc-check.css';

function PcRows({ rows, label }: { rows: BaePcRow[]; label: string }) {
  return (
    <ul className="bae-pcrows" aria-label={label}>
      {rows.map((r, i) => (
        <li key={i} className={`bae-pcrow is-${r.level}${r.name === '정리' ? ' is-sum' : ''}`}>
          <i aria-hidden="true" /><span className="bae-vh">{PC_LEVEL_LABEL[r.level]}: </span>
          <b>{r.name}</b><span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function PcCheckCard() {
  const s = useBaePcCheck();
  const r = s.result;
  return (
    <section className="bae-card" aria-labelledby="bae-pc-h">
      <div className="bae-card-head">
        <h3 className="bae-card-title" id="bae-pc-h"><MonitorCheck size={14} aria-hidden="true" /> 이 PC 점검</h3>
        {r ? <span className="bae-hint bae-num">점검한 때 {whenText(r.checkedAt)} · {r.pcName}</span> : null}
      </div>
      <p className="bae-card-sub">4K로 키우기 · 레이어로 나누기 · 다른 각도로가 이 PC에서 되는지 한 번에 확인해요 (0원). 점검하면 결과가 관리자에게도 보여요.</p>
      <div className="bae-row-line">
        <button type="button" className="bae-btn bae-btn-s" disabled={s.running} aria-busy={s.running || undefined} onClick={() => { void s.run(); }}>{r ? '다시 점검하기' : '점검하기'}</button>
      </div>
      {s.running ? (
        <ul className="bae-pcrows" aria-live="polite"><li className="bae-pcrow is-wait"><i aria-hidden="true" /><b>점검하는 중…</b><span>그래픽카드와 인터넷 연결을 확인하느라 몇 초 걸려요</span></li></ul>
      ) : s.error ? (
        <p className="bae-hint bae-error-text" role="alert">점검하지 못했어요: {s.error}</p>
      ) : r ? <PcRows rows={r.rows} label="이 PC 점검 결과" /> : null}
      {!s.running && r && s.upload !== 'idle' ? <p className={`bae-hint${s.upload === 'failed' ? ' bae-pc-quiet' : ''}`} role="status">{pcUploadText(s.upload, s.uploadError)}</p> : null}
    </section>
  );
}

const canCls = (c: PcCan) => (c === 'yes' ? 'bae-ok-text' : c === 'slow' ? 'bae-warn-text' : c === 'no' ? 'bae-error-text' : 'bae-hint');

/** 관리자 · 검수자: 누구 PC 에서 무엇이 되는지 (계획 14 9-4). 신호가 오면 다시 읽는다. */
export function PcCheckTeamCard() {
  const s = useBaePcCheck();
  const actorId = useBaeStore((x) => x.actorId);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!useBaePcCheck.getState().teamLoaded) void useBaePcCheck.getState().loadTeam();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = baeGw().onChanged((w) => {
      if (w !== 'pc-checks') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void useBaePcCheck.getState().loadTeam(); }, 1500);
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, [actorId]);
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <section className="bae-card" aria-labelledby="bae-pcteam-h">
      <div className="bae-card-head">
        <h3 className="bae-card-title" id="bae-pcteam-h"><Users size={14} aria-hidden="true" /> 팀 PC 점검</h3>
        <span className="bae-row-line">
          <span className="bae-hint bae-num">{s.teamLoaded ? pcTeamSummary(s.team) : ''}</span>
          <button type="button" className="bae-btn bae-btn-s bae-btn-ghost" disabled={s.teamLoading} onClick={() => { void s.loadTeam(); }}><RefreshCw size={14} aria-hidden="true" className={s.teamLoading ? 'bae-spin' : undefined} />새로 고침</button>
        </span>
      </div>
      <p className="bae-card-sub">팀원이 설정에서 '이 PC 점검'을 하면 사람 · PC마다 한 줄씩 올라와요. 갈아타기 전에 누구 PC에서 무엇이 되는지 볼 수 있어요. 관리자와 검수자만 봐요.</p>
      {s.teamError ? <p className="bae-hint bae-error-text" role="alert">표를 불러오지 못했어요: {s.teamError}</p> : null}
      {!s.teamLoaded && s.teamLoading ? <p className="bae-hint">불러오는 중…</p> : null}
      {s.teamLoaded && !s.team.length ? <p className="bae-hint">아직 올라온 점검이 없어요. 팀원에게 BAE경 설정의 '이 PC 점검'을 한 번 눌러 달라고 해 주세요.</p> : null}
      {s.team.length ? (
        <div className="bae-pct-wrap">
          <table className="bae-table bae-pct">
            <thead><tr><th>사람</th><th>PC</th><th>4K</th><th>레이어</th><th>각도</th><th>그래픽카드</th><th>앱</th><th>점검한 때</th><th><span className="bae-vh">자세히</span></th></tr></thead>
            <tbody>
              {s.team.map((row) => {
                const k = `${row.userId}:${row.pcId}`; const c = pcTeamCells(row); const isOpen = open.has(k);
                return [
                  <tr key={k} className={isOpen ? 'is-open' : undefined}>
                    <td><span className={`bae-pcdot is-${row.level}`} aria-hidden="true" /><span className="bae-vh">{PC_LEVEL_LABEL[row.level]}: </span>{row.userName || '(지운 사용자)'}</td>
                    <td className="bae-pct-pc">{row.pcName || '—'}</td>
                    {(['upscale', 'layers', 'angle'] as const).map((x) => <td key={x} className={canCls(c[x])}>{PC_CAN_LABEL[c[x]]}</td>)}
                    <td className={`bae-pct-gpu${c.gpuOk === false ? ' bae-warn-text' : ''}`}>{c.gpu || '—'}</td>
                    <td className="bae-num">{row.appVersion}</td>
                    <td className="bae-num">{whenText(row.checkedAt)}</td>
                    <td>{row.result ? (
                      <button type="button" className="bae-btn bae-btn-s bae-btn-ghost" aria-expanded={isOpen} onClick={() => toggle(k)}>
                        {isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}자세히
                      </button>
                    ) : null}</td>
                  </tr>,
                  isOpen && row.result ? (
                    <tr key={`${k}:rows`} className="bae-pct-detail"><td colSpan={9}><PcRows rows={row.result.rows} label={`${row.userName}의 ${row.pcName} 점검 결과`} /></td></tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
