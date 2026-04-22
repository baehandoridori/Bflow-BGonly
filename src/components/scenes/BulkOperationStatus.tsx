import { useEffect, useState } from 'react';
import { useBulkOperationsStore } from '@/stores/useBulkOperationsStore';

export function BulkOperationStatus() {
  const activeOp = useBulkOperationsStore((s) => s.activeOp);
  const clear = useBulkOperationsStore((s) => s.clear);
  const cancel = useBulkOperationsStore((s) => s.cancel);
  const [expanded, setExpanded] = useState(false);
  const [slowHint, setSlowHint] = useState(false);

  useEffect(() => {
    if (activeOp?.status !== 'in-flight') { setSlowHint(false); return; }
    const t = setTimeout(() => setSlowHint(true), 5000);
    return () => clearTimeout(t);
  }, [activeOp?.status, activeOp?.id]);

  useEffect(() => {
    if (activeOp?.status !== 'in-flight') return;
    const t = setTimeout(() => {
      const fresh = useBulkOperationsStore.getState().activeOp;
      if (fresh?.status === 'in-flight') {
        useBulkOperationsStore.getState().setStatus('network-error');
      }
    }, 10_000);
    return () => clearTimeout(t);
  }, [activeOp?.id]);

  useEffect(() => {
    if (activeOp?.status !== 'complete') return;
    const t = setTimeout(() => clear(), 2000);
    return () => clearTimeout(t);
  }, [activeOp?.status, clear]);

  useEffect(() => {
    if (activeOp?.status === 'cancelled') {
      const t = setTimeout(() => clear(), 600);
      return () => clearTimeout(t);
    }
  }, [activeOp?.status, clear]);

  if (!activeOp) return null;

  const label = kindLabel(activeOp.kind, activeOp.targetStage);

  return (
    <div className="fixed bottom-[120px] left-1/2 -translate-x-1/2 z-[100] bg-[#1A1D27] border border-[#2D3041] rounded-lg px-4 py-3 shadow-xl min-w-[320px] max-w-[500px]">
      <div className="flex items-center gap-3">
        <StatusIcon status={activeOp.status} />
        <div className="flex-1">
          <div className="text-sm text-[#E8E8EE]">{renderTitle(activeOp, label)}</div>
          {slowHint && activeOp.status === 'in-flight' && (
            <div className="text-xs text-[#FDCB6E] mt-1">네트워크가 느려요</div>
          )}
        </div>
        <Actions activeOp={activeOp} onCancel={cancel} onRetry={() => {
          // activeOp.retryExecutor를 사용해 실패 항목만 재전송
          void useBulkOperationsStore.getState().retryFailed();
        }} onClose={clear} />
      </div>

      {activeOp.failedItems.length > 0 && (
        <div className="mt-2">
          <button className="text-xs text-[#6C5CE7] underline" onClick={() => setExpanded(!expanded)}>
            {expanded ? '실패 목록 접기' : `실패 ${activeOp.failedItems.length}건 보기`}
          </button>
          {expanded && (
            <ul className="mt-1 text-xs text-[#8B8DA3] max-h-40 overflow-auto">
              {activeOp.failedItems.map((f) => (
                <li key={f.sceneUuid} className="py-0.5">
                  {f.sceneUuid.slice(0, 8)}… — {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  const map: Record<string, { char: string; color: string }> = {
    'in-flight':     { char: '⏳', color: 'text-[#6C5CE7]' },
    'partial-fail':  { char: '!',  color: 'text-red-500' },
    'network-error': { char: '⚠',  color: 'text-[#FDCB6E]' },
    'complete':      { char: '✓',  color: 'text-[#00B894]' },
    'cancelled':     { char: '⏹',  color: 'text-[#8B8DA3]' },
  };
  const m = map[status] ?? map['in-flight'];
  return <span className={`text-lg font-bold ${m.color}`}>{m.char}</span>;
}

function kindLabel(kind: string, stage?: string) {
  if (kind === 'delete') return '삭제';
  if (kind === 'stage-toggle') return `${(stage ?? '').toUpperCase()}`;
  if (kind === 'field-edit') return '편집';
  return '';
}

type ActiveOp = NonNullable<ReturnType<typeof useBulkOperationsStore.getState>['activeOp']>;

function renderTitle(op: ActiveOp, label: string) {
  const { status, completedCount, totalCount, failedItems } = op;
  const failedCount = failedItems.length;
  switch (status) {
    case 'in-flight': return `${label} ${completedCount}/${totalCount} 처리 중`;
    case 'complete': return `${totalCount}개 ${label} 완료`;
    case 'partial-fail': return `${completedCount}개 완료 · ${failedCount}개 실패`;
    case 'network-error': return `연결 끊김 — 다시 시도해주세요`;
    case 'cancelled': return `${label} 처리 중단됨`;
    default: return '';
  }
}

function Actions({ activeOp, onCancel, onRetry, onClose }: {
  activeOp: ActiveOp;
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const btn = 'px-2 py-1 text-xs rounded hover:bg-[#2D3041] text-[#E8E8EE]';
  if (activeOp.status === 'in-flight') return (
    <button className={btn} onClick={onCancel} title="이미 전송된 작업은 서버에서 계속 처리됩니다">취소</button>
  );
  if (activeOp.status === 'partial-fail' || activeOp.status === 'network-error') return (
    <div className="flex gap-1">
      <button className={btn} onClick={onRetry}>다시 시도</button>
      <button className={btn} onClick={onClose}>닫기</button>
    </div>
  );
  return null;
}
