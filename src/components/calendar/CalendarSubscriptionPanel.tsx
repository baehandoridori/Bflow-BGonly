import { useEffect, useRef, useState } from 'react';
import { Copy, Link2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCalendarStore } from '@/stores/useCalendarStore';
import type { CalendarFeedRequest, CalendarFeedStatus } from '@/shared/calendarSubscription';

const button = 'rounded-lg border border-bg-border px-3 py-2 text-xs text-text-primary hover:bg-bg-border/40 disabled:opacity-40 disabled:cursor-not-allowed';
export function CalendarSubscriptionPanel({ calendarId, disabled = false, isAdminOverview = false }: { calendarId: string; disabled?: boolean; isAdminOverview?: boolean }) {
  const actorId = useAuthStore(state => state.currentUser?.id);
  const calendar = useCalendarStore(state => state.calendars.find(row => row.id === calendarId));
  const isOwner = Boolean(actorId && calendar?.ownerId === actorId);
  const canRead = Boolean(actorId && calendar && !isAdminOverview && !calendar.isAdminOverview);
  const ownerId = calendar?.ownerId;
  const [status, setStatus] = useState<CalendarFeedStatus | null>(null);
  const [issued, setIssued] = useState<{ url: string; revision: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const isCurrent = (ticket: number) => generation.current === ticket
    && useAuthStore.getState().currentUser?.id === actorId
    && canRead && useCalendarStore.getState().calendars.some(row => row.id === calendarId && row.ownerId === ownerId && !row.isAdminOverview);
  async function refresh() {
    if (!canRead || pending.current) return;
    const ticket = generation.current;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await window.electronAPI.calendarFeedStatus(calendarId);
      if (!isCurrent(ticket)) return;
      setStatus(result);
      setIssued(previous => result.enabled && result.url ? { url: result.url, revision: result.revision }
        : result.enabled && previous?.revision === result.revision ? previous : null);
    } catch {
      if (isCurrent(ticket)) { setStatus(null); setIssued(null); setError('구독 상태를 확인하지 못했어요. 새로고침해 주세요.'); }
    } finally {
      if (isCurrent(ticket)) { pending.current = false; setBusy(false); }
    }
  }
  useEffect(() => {
    generation.current += 1; pending.current = false;
    setStatus(null); setIssued(null); setError(''); setConfirm(null); setCopied(false);
    if (canRead) void refresh();
    const invalidate = useAuthStore.subscribe((next, previous) => {
      if (next.currentUser !== previous.currentUser) {
        generation.current += 1; pending.current = false; setIssued(null); setStatus(null); setConfirm(null); setBusy(false);
        if (next.currentUser?.id === actorId) void refresh();
      }
    });
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { generation.current += 1; invalidate(); window.removeEventListener('focus', onFocus); };
  }, [calendarId, actorId, ownerId, canRead]);
  async function manage(action: CalendarFeedRequest['action']) {
    if (!status || !isOwner || disabled || pending.current) return;
    const ticket = generation.current;
    const before = status;
    pending.current = true; setBusy(true); setError(''); setCopied(false); setConfirm(null); setIssued(null);
    setStatus({ ...before, enabled: action !== 'revoke' });
    try {
      const result = await window.electronAPI.calendarFeedManage({ calendarId, action, expectedRevision: before.revision });
      if (!isCurrent(ticket)) return;
      setStatus(result); setIssued(result.url ? { url: result.url, revision: result.revision } : null);
    } catch {
      if (!isCurrent(ticket)) return;
      setStatus(before); setError('저장 결과를 확인하지 못했어요. 상태를 새로 확인한 뒤 다시 시도해 주세요.');
      // A failed response can follow a committed change; reconcile before allowing another command.
      try { const canonical = await window.electronAPI.calendarFeedStatus(calendarId); if (isCurrent(ticket)) { setStatus(canonical); setIssued(canonical.enabled && canonical.url ? { url: canonical.url, revision: canonical.revision } : null); } }
      catch { if (isCurrent(ticket)) setStatus(null); }
    } finally { if (isCurrent(ticket)) { pending.current = false; setBusy(false); } }
  }
  if (!canRead) return isAdminOverview || calendar?.isAdminOverview
    ? <p className="text-xs leading-relaxed text-text-secondary">공유받은 캘린더에서만 구독 주소를 확인할 수 있어요. 관리자 조회만으로는 구독 주소를 볼 수 없어요.</p>
    : null;
  const blocked = busy || disabled;
  return <section className="space-y-3 border-t border-bg-border/70 pt-5" aria-label="외부 캘린더 구독">
    <div className="flex items-center justify-between gap-2">
      <h4 className="flex items-center gap-2 text-xs font-semibold text-text-primary"><Link2 size={14} /> 외부 캘린더에서 구독</h4>
      <button type="button" aria-label="구독 상태 새로고침" disabled={blocked} onClick={() => void refresh()} className="rounded p-1.5 text-text-secondary hover:bg-bg-border/40 disabled:opacity-40"><RefreshCw size={13} className={busy ? 'animate-spin' : ''} /></button>
    </div>
    <p className="text-[11px] leading-relaxed text-text-secondary">이 캘린더를 외부 앱에서 읽기 전용으로 볼 수 있어요. B flow에서 바꾼 일정은 외부 앱의 새로고침 주기에 따라 반영돼요.</p>
    <p className="rounded-lg bg-bg-primary p-3 text-[11px] leading-relaxed text-text-secondary">주소를 가진 누구나 이 캘린더의 일정 제목·시간·태그·메모를 볼 수 있어요. B flow의 팀원 공유 범위와 별개이며, 소유자만 주소를 발급하거나 중지할 수 있어요.</p>
    {status?.preview && <p className="text-[11px] text-accent">테스트 모드예요. 아래 주소는 관리 동작 확인용이며 외부 기기에서는 구독되지 않아요.</p>}
    <div aria-live="polite" className="text-xs text-text-primary">{busy ? '구독 상태 확인 중…' : status ? status.enabled ? '구독 주소 사용 중' : '외부 구독 꺼짐' : '구독 상태를 불러오는 중'}</div>
    {issued && status?.enabled && <div className="space-y-2">
      <label className="block text-[11px] text-text-secondary">구독 주소<input aria-label="외부 캘린더 구독 주소" type="text" readOnly value={issued.url} onFocus={event => event.currentTarget.select()} className="mt-1 w-full rounded-lg border border-bg-border bg-bg-primary px-3 py-2 text-xs text-text-primary" /></label>
      <button type="button" className={button} disabled={blocked} onClick={async () => {
        const ticket = generation.current;
        try { await navigator.clipboard.writeText(issued.url); if (isCurrent(ticket)) setCopied(true); }
        catch { if (isCurrent(ticket)) setError('복사하지 못했어요. 위 주소를 선택해서 복사해 주세요.'); }
      }}><Copy size={12} className="mr-1 inline" />{copied ? '복사했어요' : '주소 복사'}</button>
      <p className="text-[10px] leading-relaxed text-text-secondary">발급된 주소는 이 창을 다시 열어도 확인할 수 있어요. 공유받은 팀원도 같은 주소를 복사할 수 있어요.</p>
    </div>}
    {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    {!isOwner && <p className="text-[11px] leading-relaxed text-text-secondary">{status?.enabled ? '보기 전용이에요. 구독 주소를 확인하고 복사할 수 있어요.' : '소유자가 구독 주소를 발급하면 여기에 표시돼요.'} 주소 발급·교체·중지는 캘린더 소유자만 할 수 있어요.</p>}
    {isOwner && (confirm ? <div className="space-y-2 rounded-lg border border-bg-border p-3">
      <p className="text-[11px] leading-relaxed text-text-secondary">{confirm === 'rotate' ? '기존 주소가 무효화돼요. 외부 앱에서도 새 주소로 다시 구독해야 해요.' : '기존 주소로 새 일정을 받을 수 없게 돼요. 이미 외부 앱에 저장된 일정은 남을 수 있어요.'}</p>
      <button type="button" className={button} disabled={blocked} onClick={() => void manage(confirm)}>{confirm === 'rotate' ? '새 주소 발급' : '구독 중지'}</button>
      <button type="button" className="ml-2 text-xs text-text-secondary" disabled={blocked} onClick={() => setConfirm(null)}>취소</button>
    </div> : <div className="flex gap-2">{status?.enabled ? <>
      <button type="button" className={button} disabled={blocked} onClick={() => setConfirm('rotate')}>주소 교체</button>
      <button type="button" className={button} disabled={blocked} onClick={() => setConfirm('revoke')}>구독 중지</button>
    </> : <button type="button" className={button} disabled={blocked || !status} onClick={() => void manage('enable')}>구독 주소 발급</button>}</div>)}
    <details className="text-[11px] leading-relaxed text-text-secondary">
      <summary className="cursor-pointer text-text-primary">외부 캘린더에 추가하는 방법</summary>
      <p className="mt-2">구글: PC 웹 캘린더 → 다른 캘린더 옆 + → URL로 추가에서 주소를 붙여넣으세요.</p>
      <p className="mt-2">아이폰: 캘린더 앱 → 캘린더 → 캘린더 추가 → 구독 캘린더 추가에서 주소를 붙여넣으세요.</p>
      <p className="mt-2">맥: 캘린더 앱 → 파일 → 새로운 캘린더 구독에서 주소를 붙여넣으세요. 계정 또는 위치를 iCloud로 선택하면 같은 Apple 계정의 기기에서 볼 수 있어요.</p>
      <p className="mt-2">네이버: PC 캘린더 → 가져오기/내보내기 → 외부 URL에서 가져올 수 있어요. 이후 변경의 자동 갱신은 보장되지 않아요.</p>
      <p className="mt-2">일정은 B flow에서 수정하세요. 태그 이름은 전달되며 태그별 색상 표시는 외부 앱에 따라 달라요. 여기에 있는 구독 설정은 버튼을 누를 때 바로 적용돼요.</p>
    </details>
  </section>;
}
