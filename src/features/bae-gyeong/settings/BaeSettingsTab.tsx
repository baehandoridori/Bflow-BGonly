/**
 * BAE경 '설정' 탭 (계획 14b 10-5). 팀원에게는 지금 쓰는 판 번호와 그림 모델 이름만,
 * 관리자에게는 키 · 그림 모델 · 매뉴얼 · 고정 문장 · 덧붙일 지침 · 가격표 · API 주소 · 지평선 보정 · '모두에게 열기'.
 * 저장은 판 번호를 맞춰 보낸다 (다른 관리자가 먼저 바꿨으면 거절). 화면에 먼저 보이고, 실패하면 되돌린다.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, History, KeyRound, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { BAE_SETTING_DEFAULTS, baeSettingProblem, type BaeSettingKey, type BaeSettingRow } from '@/shared/bae/settings';
import { useBaeStore, baeGw } from '../useBaeStore';

const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function useRowValue<T>(key: BaeSettingKey, fallback: T): { row: BaeSettingRow | undefined; value: T } {
  const row = useBaeStore((s) => s.rows.find((r) => r.key === key));
  return { row, value: (row?.value as T | null | undefined) ?? fallback };
}

async function saveSetting(key: BaeSettingKey, value: unknown, row: BaeSettingRow | undefined, okText: string): Promise<boolean> {
  const problem = baeSettingProblem(key, value);
  if (problem) { toast.error(problem); return false; }
  const before = useBaeStore.getState().rows;
  const optimistic: BaeSettingRow = { key, value, revision: (row?.revision ?? 0) + 1, version: row?.version ?? null, updatedAt: new Date().toISOString(), updatedBy: null };
  useBaeStore.setState({ rows: [...before.filter((r) => r.key !== key), optimistic] });
  try {
    const saved = await baeGw().settingsSave(key, value, row?.revision ?? 0);
    useBaeStore.setState((s) => ({ rows: [...s.rows.filter((r) => r.key !== key), saved] }));
    toast.success(okText);
    return true;
  } catch (e) {
    useBaeStore.setState({ rows: before });
    toast.error(`저장하지 못했어요: ${errText(e)}`);
    return false;
  }
}

function KeyCard() {
  const status = useBaeStore((s) => s.keyStatus);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  async function put() {
    if (busy || !draft.trim()) return;
    setBusy(true);
    try {
      const st = await baeGw().keySet(draft);
      useBaeStore.setState({ keyStatus: st });
      toast.success('키를 금고에 넣었어요. 모든 PC가 다음 호출부터 이 키를 써요.');
    } catch (e) { toast.error(`키를 넣지 못했어요: ${errText(e)}`); }
    finally { setDraft(''); setBusy(false); }   // 넣은 글자는 화면에 남기지 않는다
  }
  return (
    <section className="bae-card" aria-labelledby="bae-key-h">
      <div className="bae-card-head">
        <h3 className="bae-card-title" id="bae-key-h"><KeyRound size={14} aria-hidden="true" /> OpenAI 키 (팀 공용)</h3>
        <span className="bae-row-line">
          {status?.hasKey ? <span className="bae-ok-text">키 있음 · 바꾼 날 {day(status.updatedAt)}</span> : <span className="bae-warn-text">키 없음</span>}
        </span>
      </div>
      <p className="bae-card-sub">키는 서버 금고에만 있어요. 화면에는 '있음'과 바꾼 날만 보여요. 팀원 PC는 로그인한 Bflow가 메모리에만 받아 써요.</p>
      <div className="bae-row-line">
        <input className="bae-input" style={{ maxWidth: 420 }} type="password" autoComplete="off" spellCheck={false} aria-label="새 OpenAI 키" placeholder="sk-로 시작하는 키를 붙여 넣기" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="button" className="bae-btn bae-btn-s bae-btn-primary" disabled={busy || !draft.trim()} onClick={() => void put()}>{status?.hasKey ? '키 바꾸기' : '키 넣기'}</button>
      </div>
    </section>
  );
}

function ModelsCard({ admin }: { admin: boolean }) {
  const { row, value } = useRowValue('models', BAE_SETTING_DEFAULTS.models);
  const [edit, setEdit] = useState<typeof value | null>(null);
  return (
    <section className="bae-card" aria-labelledby="bae-models-h">
      <div className="bae-card-head">
        <h3 className="bae-card-title" id="bae-models-h">그림 모델</h3>
        <span className="bae-hint">{row ? `판 ${row.revision} · ${day(row.updatedAt)}` : '처음 값'}</span>
      </div>
      <p className="bae-row-line"><span>그림 모델 <b>{value.imageLabel}</b></span><span className="bae-hint">품질 높음으로 고정 · PD {value.pdModel}</span></p>
      <p className="bae-card-sub">팀원 화면에는 모델을 고르는 곳이 없어요. 모델을 바꿀 일이 생기면 여기서 바꾸고, 다시 배포하지 않아도 돼요.</p>
      {admin && !edit && <div><button type="button" className="bae-btn bae-btn-s" onClick={() => setEdit({ ...value })}>바꾸기</button></div>}
      {admin && edit && (
        <div className="bae-set">
          {(['imageLabel', 'imageModel', 'imageQuality', 'pdModel'] as const).map((k) => (
            <label key={k} className="bae-row-line"><span className="bae-label" style={{ width: 120 }}>{{ imageLabel: '보이는 이름', imageModel: '그림 모델 이름', imageQuality: '품질', pdModel: 'PD 모델 이름' }[k]}</span>
              <input className="bae-input" style={{ maxWidth: 360 }} value={edit[k]} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>
          ))}
          <div className="bae-row-line"><button type="button" className="bae-btn bae-btn-s bae-btn-primary" onClick={() => void saveSetting('models', edit, row, '그림 모델 설정을 바꿨어요.').then((ok) => { if (ok) setEdit(null); })}>저장</button><button type="button" className="bae-btn bae-btn-s bae-btn-ghost" onClick={() => setEdit(null)}>그만두기</button></div>
        </div>
      )}
    </section>
  );
}

const TEXT_INFO: Record<'manual' | 'fixed' | 'guidance', { title: string; sub: string }> = {
  manual: { title: 'PD 매뉴얼', sub: 'PD가 주문서를 쓸 때 따르는 규칙이에요. 고치면 판이 올라가고, 다음 주문서부터 모두가 새 판을 써요.' },
  fixed: { title: '고정 문장', sub: "주문서의 [STYLE] 같은 자리에 앱이 넣는 문장이에요. '## ' 이름 줄은 지우지 마세요." },
  guidance: { title: 'PD에게 덧붙일 지침 (한국어)', sub: '아트 디렉터의 추가 규칙이에요. 매뉴얼 위에 얹혀요. 비워 둬도 돼요.' },
};

function TextCard({ k }: { k: 'manual' | 'fixed' | 'guidance' }) {
  const row = useBaeStore((s) => s.rows.find((r) => r.key === k));
  const defaults = useBaeStore((s) => s.defaults);
  const [draft, setDraft] = useState<string | null>(null);
  const [history, setHistory] = useState<BaeSettingRow[] | null>(null);
  const text = (row?.value as { text?: string } | null)?.text ?? '';
  const info = TEXT_INFO[k];
  async function seed() {
    if (k === 'guidance') return;
    try {
      const saved = await baeGw().settingsSeed(k, row?.revision ?? 0);
      useBaeStore.setState((s) => ({ rows: [...s.rows.filter((r) => r.key !== k), saved] }));
      toast.success(`${info.title} 처음 글(${saved.version ?? ''})을 올렸어요.`);
    } catch (e) { toast.error(`올리지 못했어요: ${errText(e)}`); }
  }
  async function openHistory() {
    try { setHistory(await baeGw().settingsHistory(k)); } catch (e) { toast.error(`기록을 불러오지 못했어요: ${errText(e)}`); }
  }
  return (
    <section className="bae-card" aria-labelledby={`bae-${k}-h`}>
      <div className="bae-card-head">
        <h3 className="bae-card-title" id={`bae-${k}-h`}>{info.title}</h3>
        <span className="bae-hint">
          {row ? `${row.version ? row.version + ' · ' : ''}판 ${row.revision} · ${day(row.updatedAt)}` : k === 'guidance' ? '비어 있음' : `서버에 아직 없음 · 앱의 처음 글 ${k === 'manual' ? defaults.manual ?? '' : defaults.fixed ?? ''}을 써요`}
        </span>
      </div>
      <p className="bae-card-sub">{info.sub}</p>
      <div className="bae-row-line">
        {!row && k !== 'guidance' && <button type="button" className="bae-btn bae-btn-s bae-btn-primary" onClick={() => void seed()}>처음 글 올리기</button>}
        {draft === null && <button type="button" className="bae-btn bae-btn-s" onClick={() => setDraft(text)}>{row || k === 'guidance' ? '고치기' : '직접 쓰기'}</button>}
        {row && <button type="button" className="bae-btn bae-btn-s bae-btn-ghost" onClick={() => void openHistory()}><History size={14} aria-hidden="true" />지난 판</button>}
      </div>
      {draft !== null && (
        <>
          <textarea className="bae-textarea" aria-label={`${info.title} 글`} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="bae-row-line">
            <button type="button" className="bae-btn bae-btn-s bae-btn-primary" onClick={() => void saveSetting(k, { text: draft }, row, `${info.title}을(를) 저장했어요. 판 ${(row?.revision ?? 0) + 1}.`).then((ok) => { if (ok) setDraft(null); })}>저장</button>
            <button type="button" className="bae-btn bae-btn-s bae-btn-ghost" onClick={() => setDraft(null)}>그만두기</button>
            <span className="bae-hint bae-num">{draft.length.toLocaleString()}자</span>
          </div>
        </>
      )}
      {history && (
        <table className="bae-table">
          <thead><tr><th>판</th><th>버전</th><th>날짜</th><th><span className="bae-vh">되돌리기</span></th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.revision}>
                <td className="bae-num">{h.revision}</td><td>{h.version ?? ''}</td><td className="bae-num">{day(h.updatedAt)}</td>
                <td>{row && h.revision !== row.revision && (
                  <button type="button" className="bae-btn bae-btn-s bae-btn-ghost" onClick={() => void saveSetting(k, h.value, row, `판 ${h.revision}의 글로 되돌렸어요 (새 판 ${row.revision + 1}).`).then((ok) => { if (ok) setHistory(null); })}><RotateCcw size={14} aria-hidden="true" />이 판으로 되돌리기</button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function NumbersCard() {
  const prices = useRowValue('prices', BAE_SETTING_DEFAULTS.prices);
  const api = useRowValue('api_base', BAE_SETTING_DEFAULTS.api_base);
  const horizon = useRowValue('horizon', BAE_SETTING_DEFAULTS.horizon);
  const [rate, setRate] = useState(String(prices.value.krwPerUsd));
  const [base, setBase] = useState(api.value);
  const [calib, setCalib] = useState(String(horizon.value.calib));
  useEffect(() => { setRate(String(prices.value.krwPerUsd)); }, [prices.value.krwPerUsd]);
  useEffect(() => { setBase(api.value); }, [api.value]);
  useEffect(() => { setCalib(String(horizon.value.calib)); }, [horizon.value.calib]);
  return (
    <section className="bae-card" aria-labelledby="bae-num-h">
      <h3 className="bae-card-title" id="bae-num-h">가격표 · API 주소 · 지평선 보정</h3>
      <p className="bae-hint">그림 글 입력 ${prices.value.image.text} · 그림 입력 ${prices.value.image.image} · 출력 ${prices.value.image.out} / 100만 토큰. PD {Object.entries(prices.value.pd).map(([m, p]) => `${m} $${p[0]}/$${p[1]}`).join(', ')}</p>
      <label className="bae-row-line"><span className="bae-label" style={{ width: 120 }}>환율 (원/달러)</span><input className="bae-input bae-num" style={{ maxWidth: 140 }} inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} />
        <button type="button" className="bae-btn bae-btn-s" onClick={() => void saveSetting('prices', { ...prices.value, krwPerUsd: Number(rate) }, prices.row, '환율을 바꿨어요.')}>저장</button></label>
      <label className="bae-row-line"><span className="bae-label" style={{ width: 120 }}>API 주소</span><input className="bae-input" style={{ maxWidth: 360 }} value={base} onChange={(e) => setBase(e.target.value)} />
        <button type="button" className="bae-btn bae-btn-s" onClick={() => void saveSetting('api_base', base.trim(), api.row, 'API 주소를 바꿨어요.')}>저장</button></label>
      <label className="bae-row-line"><span className="bae-label" style={{ width: 120 }}>지평선 높이 보정</span><input className="bae-input bae-num" style={{ maxWidth: 140 }} inputMode="decimal" value={calib} onChange={(e) => setCalib(e.target.value)} />
        <button type="button" className="bae-btn bae-btn-s" onClick={() => void saveSetting('horizon', { calib: Number(calib) }, horizon.row, '지평선 보정을 바꿨어요.')}>저장</button></label>
    </section>
  );
}

function AccessCard() {
  const { row, value } = useRowValue('access', BAE_SETTING_DEFAULTS.access);
  return (
    <section className="bae-card" aria-labelledby="bae-acc-h">
      <h3 className="bae-card-title" id="bae-acc-h">누가 쓰나</h3>
      <label className="bae-switch"><input type="checkbox" checked={value.open} onChange={(e) => void saveSetting('access', { open: e.target.checked }, row, e.target.checked ? '로그인한 팀원 모두가 BAE경을 쓸 수 있어요.' : '이제 지정한 사람만 BAE경을 써요.')} />모두에게 열기</label>
      <p className="bae-card-sub">끄면 관리자와 'BAE경 사용자 · 검수자'로 지정한 사람만 써요. 지정은 Bflow 설정의 '권한 · 노출'에서 해요.</p>
    </section>
  );
}

export function BaeSettingsTab() {
  const access = useBaeStore((s) => s.access);
  const manual = useBaeStore((s) => s.rows.find((r) => r.key === 'manual'));
  const fixed = useBaeStore((s) => s.rows.find((r) => r.key === 'fixed'));
  const defaults = useBaeStore((s) => s.defaults);
  const models = useBaeStore((s) => s.rows.find((r) => r.key === 'models'));
  const label = useMemo(() => ((models?.value as { imageLabel?: string } | null)?.imageLabel) ?? BAE_SETTING_DEFAULTS.models.imageLabel, [models]);
  return (
    <div className="bae-set">
      <section className="bae-card" aria-labelledby="bae-now-h">
        <h3 className="bae-card-title" id="bae-now-h">지금 쓰는 판</h3>
        <p className="bae-row-line">
          <span>PD 매뉴얼 {manual?.version ?? defaults.manual ?? ''}{manual ? ` · 판 ${manual.revision}` : ''}</span>
          <span>고정 문장 {fixed?.version ?? defaults.fixed ?? ''}{fixed ? ` · 판 ${fixed.revision}` : ''}</span>
          <span>그림 모델 {label}</span>
        </p>
        <p className="bae-card-sub">관리자가 고치면 다음 주문서부터 모두에게 같은 판이 쓰여요. 어떤 그림이 어느 판으로 그려졌는지 기록에 남아요.</p>
      </section>
      {access.isAdmin ? (
        <>
          <KeyCard />
          <ModelsCard admin />
          <TextCard k="manual" />
          <TextCard k="fixed" />
          <TextCard k="guidance" />
          <NumbersCard />
          <AccessCard />
        </>
      ) : (
        <p className="bae-hint"><AlertTriangle size={12} aria-hidden="true" /> 키 · 매뉴얼 · 가격표는 관리자만 바꿀 수 있어요.</p>
      )}
    </div>
  );
}
