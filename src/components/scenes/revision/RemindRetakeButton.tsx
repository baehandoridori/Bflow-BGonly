import { useEffect, useRef, useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { canRemindRetake, unfinishedRetakeAssigneeIds } from '@/shared/retakeNotifications';
import type { CompRevision } from '@/types';
import { toast } from 'sonner';

export function RemindRetakeButton({ revision }: { revision: CompRevision }) {
  const user = useAuthStore((s) => s.currentUser);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [message, setMessage] = useState('');
  const sending = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const identity = `${user?.id ?? ''}:${revision.id}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const targetCount = unfinishedRetakeAssigneeIds(revision).filter((id) => id !== user?.id).length;
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current += 1; }; }, []);
  useEffect(() => {
    generation.current += 1;
    sending.current = false;
    setBusy(false);
    setCooldown(0);
    setMessage('');
  }, [identity]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  if (!canRemindRetake(user, revision) || targetCount === 0) return null;

  const remind = async () => {
    if (sending.current || cooldown > 0) return;
    sending.current = true;
    const requestGeneration = ++generation.current;
    const requestIdentity = identity;
    const userId = user?.id;
    const isCurrentRequest = () => alive.current && generation.current === requestGeneration
      && identityRef.current === requestIdentity && useAuthStore.getState().currentUser?.id === userId;
    setBusy(true);
    setMessage('');
    try {
      const result = await window.electronAPI.remindRetake(revision.id);
      if (!isCurrentRequest()) return;
      if (result.status === 'cooldown') {
        setCooldown(result.cooldownSeconds ?? 30);
        setMessage('방금 알렸습니다. 잠시 후 다시 보낼 수 있어요.');
      } else if (result.status === 'nothing-to-send') {
        setMessage('다시 알릴 미완료 담당자가 없습니다.');
      } else {
        setCooldown(30);
        const text = result.simulated
          ? `테스트 알림을 ${result.recipients.length}명에게 보냈습니다.`
          : [result.inAppBroadcast ? '앱 알림 요청 완료' : '앱 알림 전송 실패',
            `슬랙 ${result.slackSentUserIds.length}명 전송`,
            result.slackMissingUserIds.length ? `슬랙 계정 미등록 ${result.slackMissingUserIds.length}명` : '',
            result.slackFailedUserIds.length ? `슬랙 실패 ${result.slackFailedUserIds.length}명` : '',
          ].filter(Boolean).join(' · ');
        setMessage(text);
        if (result.status === 'failed' || result.status === 'partial') toast.warning(text);
        else toast.success(text);
      }
    } catch (error) {
      if (isCurrentRequest()) {
        const text = error instanceof Error ? error.message : '알림을 보내지 못했습니다.';
        setMessage(text);
        toast.error(text);
      }
    } finally {
      if (isCurrentRequest()) {
        sending.current = false;
        setBusy(false);
      }
    }
  };

  return <div className="mt-2" onClick={(event) => event.stopPropagation()}>
    <button type="button" onClick={() => void remind()} disabled={busy || cooldown > 0}
      title={`아직 담당 완료하지 않은 ${targetCount}명에게 앱·슬랙 알림 보내기`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-bg-border px-2.5 py-1.5 text-xs text-text-secondary hover:text-accent hover:border-accent/50 disabled:opacity-50 disabled:cursor-not-allowed">
      {busy ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}
      {busy ? '알림 보내는 중' : cooldown > 0 ? `다시 알림 · ${cooldown}초` : `담당자에게 다시 알림 (${targetCount})`}
    </button>
    {message && <p role="status" className="mt-1 text-[11px] text-text-secondary">{message}</p>}
  </div>;
}
