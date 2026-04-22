import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useBulkOperationsStore } from '@/stores/useBulkOperationsStore';

/**
 * 일괄 작업 상태를 Sonner 토스트로 표시.
 * 자체 렌더 JSX 없이 activeOp 변화를 감지해 toast API를 호출만 한다.
 *
 * 설계:
 *  - 같은 op 동안 하나의 토스트 id(`bulk-op-<opId>`)를 재사용해 상태 전이마다 업데이트.
 *  - in-flight → loading 토스트 (스피너 기본 + "취소" cancel action)
 *  - complete  → success 토스트 + 자동 clear (2.5s)
 *  - partial-fail / network-error → error 토스트 + "다시 시도" action + "닫기" cancel
 *  - cancelled → 토스트 dismiss + clear
 *  - 5초 이상 in-flight 지속 시 loading 토스트 description에 "네트워크가 느려요" 힌트 추가.
 *
 * Sonner 기본 아이콘(loading/success/error)은 Lucide feather 계열로 앱 톤과 자연스럽게 어울린다.
 * 이전의 ⏳/✓/!/⚠/⏹ 이모지 혼용 이슈 제거.
 */
export function BulkOperationStatus() {
  const activeOp = useBulkOperationsStore((s) => s.activeOp);
  const clear = useBulkOperationsStore((s) => s.clear);
  const slowHintShownRef = useRef<Set<string>>(new Set());

  // 주요 상태 전이 → toast 업데이트
  useEffect(() => {
    if (!activeOp) return;
    const toastId = `bulk-op-${activeOp.id}`;
    const label = kindLabel(activeOp.kind, activeOp.targetStage);

    switch (activeOp.status) {
      case 'in-flight': {
        const description = slowHintShownRef.current.has(activeOp.id)
          ? '네트워크가 느려요'
          : undefined;
        toast.loading(renderInFlight(activeOp, label), {
          id: toastId,
          description,
          cancel: {
            label: '취소',
            onClick: () => useBulkOperationsStore.getState().cancel(),
          },
        });
        break;
      }
      case 'complete': {
        toast.success(`${activeOp.totalCount}개 ${label} 완료`, {
          id: toastId,
          duration: 2500,
        });
        const timer = setTimeout(() => clear(), 2500);
        return () => clearTimeout(timer);
      }
      case 'partial-fail': {
        const failedCount = activeOp.failedItems.length;
        const completed = activeOp.completedCount;
        toast.error(`${completed}개 완료 · ${failedCount}개 실패`, {
          id: toastId,
          description: renderFailureSample(activeOp.failedItems),
          duration: Infinity,
          action: {
            label: '다시 시도',
            onClick: () => {
              void useBulkOperationsStore.getState().retryFailed();
            },
          },
          cancel: {
            label: '닫기',
            onClick: () => clear(),
          },
        });
        break;
      }
      case 'network-error': {
        toast.error('연결 끊김 — 다시 시도해주세요', {
          id: toastId,
          duration: Infinity,
          action: {
            label: '다시 시도',
            onClick: () => {
              void useBulkOperationsStore.getState().retryFailed();
            },
          },
          cancel: {
            label: '닫기',
            onClick: () => clear(),
          },
        });
        break;
      }
      case 'cancelled': {
        toast.dismiss(toastId);
        const timer = setTimeout(() => clear(), 200);
        return () => clearTimeout(timer);
      }
    }
  }, [
    activeOp?.id,
    activeOp?.status,
    activeOp?.completedCount,
    activeOp?.failedItems.length,
    activeOp?.totalCount,
    clear,
  ]);

  // 5초 이상 in-flight 지속 → "네트워크가 느려요" 힌트를 loading 토스트 description에 갱신
  useEffect(() => {
    if (!activeOp || activeOp.status !== 'in-flight') return;
    const opId = activeOp.id;
    if (slowHintShownRef.current.has(opId)) return;
    const timer = setTimeout(() => {
      const fresh = useBulkOperationsStore.getState().activeOp;
      if (!fresh || fresh.id !== opId || fresh.status !== 'in-flight') return;
      slowHintShownRef.current.add(opId);
      const label = kindLabel(fresh.kind, fresh.targetStage);
      toast.loading(renderInFlight(fresh, label), {
        id: `bulk-op-${opId}`,
        description: '네트워크가 느려요',
        cancel: {
          label: '취소',
          onClick: () => useBulkOperationsStore.getState().cancel(),
        },
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, [activeOp?.id, activeOp?.status]);

  return null;
}

function kindLabel(kind: string, stage?: string): string {
  if (kind === 'delete') return '삭제';
  if (kind === 'stage-toggle') return (stage ?? '').toUpperCase();
  if (kind === 'field-edit') return '편집';
  return '';
}

type ActiveOp = NonNullable<ReturnType<typeof useBulkOperationsStore.getState>['activeOp']>;

function renderInFlight(op: ActiveOp, label: string): string {
  return `${label} ${op.completedCount}/${op.totalCount} 처리 중`;
}

function renderFailureSample(failed: ActiveOp['failedItems']): string | undefined {
  if (failed.length === 0) return undefined;
  const head = failed.slice(0, 2).map((f) => `${f.sceneUuid.slice(0, 8)}… (${f.error})`);
  const suffix = failed.length > 2 ? ` 외 ${failed.length - 2}건` : '';
  return head.join(', ') + suffix;
}
