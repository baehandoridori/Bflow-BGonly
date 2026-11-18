// '피드백 내보내기' (HTML galExport · exDlg): 내 기록 머리의 버튼과, 검수한 그림 · 최근 그림을 물어보는 작은 창.
// 고를 기록은 이 화면의 내 기록 목록(useBaeJobs)에서 세고, zip 은 메인이 만든다 (글은 서버에서 다시 읽고 저장 창으로). 테스트 모드는 내려받기.
// 묻는 창은 앱의 확인 창(ConfirmDialog)과 같은 모양 · 같은 규칙 (Esc · 바깥 누름 = 취소, 처음 포커스는 취소, Tab 은 창 안에서만).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileArchive, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useModalFocus } from '@/hooks/useModalFocus';
import { cleanIpcErrorMessage } from '@/utils/ipcErrorMessage';
import { BAE_FEEDBACK_BUTTON_TITLE, baeFeedbackAsk, baeFeedbackAskText, baeFeedbackPick, baeFeedbackPlan } from '@/shared/bae/feedbackExport';
import { useBaeJobs, visibleBaeJobs } from '../state/useBaeJobs';
import { baeGw } from '../useBaeStore';

type Answer = 'fresh' | 'reviewed' | null;

function AskDialog({ reviewed, fresh, onAnswer }: { reviewed: number; fresh: number; onAnswer(a: Answer): void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const answerRef = useRef(onAnswer);
  answerRef.current = onAnswer;
  const { onKeyDown } = useModalFocus(boxRef, { active: true });
  const titleId = useId(); const textId = useId();
  const t = baeFeedbackAskText(reviewed, fresh);

  useEffect(() => {
    const focus = window.setTimeout(() => cancelRef.current?.focus({ preventScroll: true }), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      answerRef.current(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => { window.clearTimeout(focus); window.removeEventListener('keydown', onKey, { capture: true }); };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/50 bf-scrim-in" onMouseDown={(e) => { if (e.target === e.currentTarget) answerRef.current(null); }}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        tabIndex={-1}
        className="bg-bg-card border border-bg-border rounded-lg p-6 min-w-[320px] max-w-[480px] shadow-xl bf-modal-in"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="text-text-primary text-base font-semibold mb-2">{t.title}</h2>
        <p id={textId} className="text-text-primary text-sm mb-5 whitespace-pre-line">{t.text}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" className="px-4 py-2 rounded text-sm text-text-secondary hover:bg-bg-border hover:text-text-primary" onClick={() => answerRef.current(null)}>{t.cancel}</button>
          <button type="button" className="px-4 py-2 rounded text-sm text-text-primary border border-bg-border hover:bg-bg-border" onClick={() => answerRef.current('reviewed')}>{t.only}</button>
          <button type="button" className="px-4 py-2 rounded text-sm font-medium bg-accent hover:brightness-110 text-on-accent" onClick={() => answerRef.current('fresh')}>{t.fresh}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 내 기록 머리의 '피드백 내보내기'. 넣을 그림(다 그린 내 그림)이 없으면 보이지 않는다 (HTML 과 같음). */
export function FeedbackExportButton() {
  const rows = useBaeJobs((s) => s.rows);
  const local = useBaeJobs((s) => s.local);
  const has = useMemo(() => baeFeedbackPlan(visibleBaeJobs({ rows, local })).all.length > 0, [rows, local]);
  const [ask, setAsk] = useState<{ reviewed: number; fresh: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  /** 누른 때의 목록으로 다시 고른다 (묻는 동안 목록이 바뀌어도 고른 대로). */
  const run = async (withFresh: boolean) => {
    if (busyRef.current) return;
    const pick = baeFeedbackPick(baeFeedbackPlan(visibleBaeJobs(useBaeJobs.getState())), withFresh);
    if (!pick.jobs.length) { toast('내보낼 그림이 없어요'); return; }
    busyRef.current = true; setBusy(true);
    try {
      const r = await baeGw().feedbackExport({ mode: pick.mode, ids: pick.jobs.map((j) => j.id) });
      if (r.status === 'saved') toast.success(r.message);
      else if (r.status === 'empty') toast(r.message);
    } catch (e) {
      const m = cleanIpcErrorMessage(e, '묶지 못했어요');
      toast.error(m.startsWith('묶지 못했어요') ? m : `묶지 못했어요: ${m}`);
    } finally { busyRef.current = false; setBusy(false); }
  };
  const onClick = () => {
    if (busyRef.current) return;
    const plan = baeFeedbackPlan(visibleBaeJobs(useBaeJobs.getState()));
    const what = baeFeedbackAsk(plan);
    if (what === 'none') { toast('내보낼 그림이 없어요'); return; }
    if (what === 'ask') { setAsk({ reviewed: plan.reviewed.length, fresh: plan.fresh.length }); return; }
    void run(false);
  };
  const onAnswer = (a: Answer) => { setAsk(null); if (a) void run(a === 'fresh'); };

  if (!has && !busy) return null;
  return (
    <>
      <button type="button" className="bae-btn bae-btn-s" onClick={onClick} disabled={busy} aria-busy={busy || undefined} title={BAE_FEEDBACK_BUTTON_TITLE}>
        {busy ? <Loader2 size={14} className="bae-spin" aria-hidden="true" /> : <FileArchive size={14} aria-hidden="true" />}
        {busy ? '묶는 중' : '피드백 내보내기'}
      </button>
      {ask ? <AskDialog reviewed={ask.reviewed} fresh={ask.fresh} onAnswer={onAnswer} /> : null}
    </>
  );
}
