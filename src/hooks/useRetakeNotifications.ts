import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { getCanonicalRevisions, reportRetakeDeliveryFailure, setRevisionsSheetsMode } from '@/services/revisionService';
import { openRetakeInApp } from '@/utils/retakeNavigation';
import { toast } from 'sonner';
import type { RetakeDeliveryEvent, RetakeReminderPayload } from '@/shared/retakeNotifications';

/** Login catch-up reads canonical outstanding assignments; delivery events stay user-scoped. */
export function useRetakeNotifications(): void {
  const currentUser = useAuthStore((s) => s.currentUser);
  const authReady = useAuthStore((s) => s.authReady);
  const activeNotificationUser = useNotificationStore((s) => s.activeUserId);
  const dataConnected = useAppStore((s) => s.dataConnected);
  const retakeRequest = useAppStore((s) => s.retakeNavigationRequest);
  const localRevisions = useRevisionStore((s) => s.revisions);
  const seenReminders = useRef(new Set<string>());
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    if (!authReady || !currentUser || activeNotificationUser !== currentUser.id) return;
    const userId = currentUser.id;
    let cancelled = false;
    seenReminders.current.clear();
    // Both local and connected dashboards load their selected source before any retake screen is opened.
    setRevisionsSheetsMode(dataConnected);
    void useRevisionStore.getState().loadRevisions();
    if (dataConnected) void getCanonicalRevisions().then((revisions) => {
      if (cancelled || useAuthStore.getState().currentUser?.id !== userId
        || useNotificationStore.getState().activeUserId !== userId) return;
      const outstanding = revisions.filter((revision) =>
        revision.status !== 'resolved' && !revision.finalResolvedAt
        && revision.assigneeIds?.includes(userId)
        && revision.assigneeStates?.[userId]?.state !== 'done'
        && revision.requesterId !== userId,
      ).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50);
      for (const revision of outstanding) {
        useNotificationStore.getState().addNotification({
          type: 'revision', title: '담당 리테이크를 확인해주세요',
          body: revision.description,
          createdAt: revision.createdAt,
          metadata: { revisionId: revision.id, revisionAction: 'add', retakeHubSetId: revision.setId ?? undefined },
        });
      }
    }).catch((error) => { if (!cancelled) console.warn('[retake catch-up] 조회 실패', error); });
    const unsubscribe = window.electronAPI?.onSupabaseBroadcast?.((raw: unknown) => {
      const event = raw as { event?: string; payload?: RetakeReminderPayload | RetakeDeliveryEvent } | null;
      if (event?.event === 'retake-delivery-result') {
        const result = event.payload as RetakeDeliveryEvent | undefined;
        if (cancelled || !result || result.userId !== userId
          || typeof result.eventId !== 'string' || !result.eventId
          || (result.kind !== 'assignment' && result.kind !== 'reassignment')
          || (result.delivery?.status !== 'partial' && result.delivery?.status !== 'failed')
          || useAuthStore.getState().currentUser?.id !== userId
          || useNotificationStore.getState().activeUserId !== userId) return;
        const eventKey = `delivery:${result.eventId}`;
        if (seenReminders.current.has(eventKey)) return;
        seenReminders.current.add(eventKey);
        if (seenReminders.current.size > 200) seenReminders.current.delete(seenReminders.current.values().next().value!);
        // 최초 지정은 INSERT 알림을 사용하므로 별도 broadcast=false가 실패를 의미하지 않는다.
        reportRetakeDeliveryFailure(result.delivery, result.kind === 'reassignment');
        return;
      }
      const payload = event?.payload as RetakeReminderPayload | undefined;
      if (cancelled || event?.event !== 'retake-reminder' || !payload
        || !Array.isArray(payload.recipients) || !payload.recipients.includes(userId)
        || typeof payload.eventId !== 'string' || !payload.revisionId
        || useAuthStore.getState().currentUser?.id !== userId
        || useNotificationStore.getState().activeUserId !== userId
        || seenReminders.current.has(payload.eventId)) return;
      seenReminders.current.add(payload.eventId);
      if (seenReminders.current.size > 200) seenReminders.current.delete(seenReminders.current.values().next().value!);
      const isAssignment = payload.kind === 'assignment';
      const title = isAssignment ? '새 담당 리테이크가 있습니다' : '리테이크 진행 상태를 확인해주세요';
      const notificationId = useNotificationStore.getState().addNotification({
        type: 'revision', title,
        body: `${payload.senderName}님의 ${isAssignment ? '담당 지정' : '다시 알림'} · ${payload.description}`,
        createdAt: payload.createdAt,
        metadata: { revisionId: payload.revisionId, revisionAction: isAssignment ? 'add' : 'reminder',
          revisionEventId: payload.eventId, retakeHubSetId: payload.setId ?? undefined },
      });
      toast(title, {
        description: payload.description,
        action: { label: '리테이크 확인하기', onClick: () => {
          if (useAuthStore.getState().currentUser?.id !== userId
            || useNotificationStore.getState().activeUserId !== userId) return;
          useNotificationStore.getState().markAsRead(notificationId);
          openRetakeInApp(payload.revisionId);
        } },
      });
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [authReady, currentUser?.id, activeNotificationUser, dataConnected]);

  useEffect(() => {
    if (!retakeRequest || !authReady || !currentUser || !dataConnected) return;
    let cancelled = false;
    const userId = currentUser.id;
    const stillCurrent = () => !cancelled && useAppStore.getState().retakeNavigationRequest?.id === retakeRequest.id
      && useAuthStore.getState().currentUser?.id === userId;
    void getCanonicalRevisions().then((revisions) => {
      const app = useAppStore.getState();
      if (!stillCurrent()) return;
      const revision = revisions.find((item) => item.id === retakeRequest.revisionId);
      if (!revision) {
        app.finishRetakeNavigation(retakeRequest.id, null);
        toast.error('리테이크를 찾지 못했습니다. 삭제된 항목인지 확인해주세요.');
        return;
      }
      // The destination applies this verified snapshot after its ordinary list load, then consumes it.
      app.finishRetakeNavigation(retakeRequest.id, revision);
    }).catch(() => {
      if (!stillCurrent()) return;
      toast.error('리테이크를 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해주세요.', {
        action: { label: '다시 시도', onClick: () => { if (stillCurrent()) setRetryAttempt((attempt) => attempt + 1); } },
      });
    });
    return () => { cancelled = true; };
  }, [retakeRequest, authReady, currentUser?.id, dataConnected, retryAttempt]);

  useEffect(() => {
    if (!retakeRequest || !authReady || !currentUser || dataConnected) return;
    const revision = localRevisions.find((item) => item.id === retakeRequest.revisionId);
    if (revision) useAppStore.getState().finishRetakeNavigation(retakeRequest.id, revision);
  }, [retakeRequest, localRevisions, authReady, currentUser?.id, dataConnected]);
}
