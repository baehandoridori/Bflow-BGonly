import { useState, useEffect } from 'react';
import { X, Palmtree, Loader2, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/cn';
import { useAppStore } from '@/stores/useAppStore';
import { fetchDahyuList, deleteDahyuRequest } from '@/services/vacationService';
import type { DahyuListEntry } from '@/types/vacation';

interface DahyuDeleteModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function DahyuDeleteModal({ open, onClose, onSuccess }: DahyuDeleteModalProps) {
  const setToast = useAppStore((s) => s.setToast);
  const invalidateVacationCache = useAppStore((s) => s.invalidateVacationCache);

  const [items, setItems] = useState<DahyuListEntry[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());

    setLoading(true);
    fetchDahyuList()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  const toggleRow = (rowIndex: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex); else next.add(rowIndex);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setIsSubmitting(true);
    try {
      const result = await deleteDahyuRequest(Array.from(selected));
      if (result.ok && result.success) {
        setToast({ message: `대체휴가 ${result.deleted.length}건 삭제 완료`, type: 'success' });
        invalidateVacationCache();
        onSuccess?.();
        onClose();
      } else {
        const msg = result.failed.length > 0
          ? `삭제 실패: ${result.failed.length}건`
          : result.state || '삭제에 실패했습니다';
        setToast({ message: msg, type: 'error' });
      }
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : '삭제 실패', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

          <motion.div
            className="relative bg-bg-card/95 backdrop-blur-xl border border-bg-border/40 rounded-2xl shadow-2xl w-[460px] max-h-[90vh] overflow-auto"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border/30">
              <div className="flex items-center gap-2">
                <Trash2 size={16} className="text-red-400" />
                <h3 className="text-sm font-semibold text-text-primary">대체휴가 삭제</h3>
              </div>
              <button onClick={onClose} className="p-1 text-text-secondary/50 hover:text-text-primary cursor-pointer">
                <X size={16} />
              </button>
            </div>

            {/* body */}
            <div className="px-5 py-4 space-y-4">
              <label className="text-xs text-text-secondary/70 mb-1.5 block">삭제할 대체휴가 선택</label>
              {loading ? (
                <div className="flex items-center gap-2 py-3 justify-center">
                  <Loader2 size={14} className="text-accent animate-spin" />
                  <span className="text-xs text-text-secondary/50">대휴 목록 로드 중...</span>
                </div>
              ) : items.length === 0 ? (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Palmtree size={14} className="text-text-secondary/30" />
                  <p className="text-xs text-text-secondary/50">보유 중인 대체휴가가 없습니다</p>
                </div>
              ) : (
                <div className="max-h-[300px] overflow-auto rounded-lg border border-bg-border/30">
                  {items.map((item) => {
                    const isChecked = selected.has(item.rowIndex);
                    return (
                      <button
                        key={item.rowIndex}
                        onClick={() => toggleRow(item.rowIndex)}
                        className={cn(
                          'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors cursor-pointer border-b border-bg-border/15 last:border-b-0',
                          isChecked ? 'bg-red-500/10' : 'hover:bg-bg-border/10',
                        )}
                      >
                        <div className={cn(
                          'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                          isChecked ? 'bg-red-500 border-red-500' : 'border-bg-border/50',
                        )}>
                          {isChecked && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-text-primary">{item.name}</span>
                            <span className="text-[10px] text-text-secondary/50">{item.grantDate}</span>
                          </div>
                          {item.reason && (
                            <p className="text-[10px] text-text-secondary/40 truncate">{item.reason}</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {selected.size > 0 && (
                <p className="text-[10px] text-red-400/70">{selected.size}건 선택됨</p>
              )}
            </div>

            {/* footer */}
            <div className="px-5 py-4 border-t border-bg-border/30">
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || selected.size === 0}
                className={cn(
                  'w-full py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2',
                  isSubmitting || selected.size === 0
                    ? 'bg-red-500/30 text-red-400/60 cursor-not-allowed'
                    : 'bg-red-500 hover:bg-red-500/80 text-white',
                )}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    삭제 처리 중...
                  </>
                ) : (
                  '삭제하기'
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
