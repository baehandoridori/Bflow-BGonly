import { useState, useEffect } from 'react';
import { X, Palmtree, Loader2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/cn';
import { useAppStore } from '@/stores/useAppStore';
import { grantDahyu, fetchAllEmployeeNames } from '@/services/vacationService';

interface DahyuGrantModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

function fmtToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function DahyuGrantModal({ open, onClose, onSuccess }: DahyuGrantModalProps) {
  const setToast = useAppStore((s) => s.setToast);
  const invalidateVacationCache = useAppStore((s) => s.invalidateVacationCache);

  const [names, setNames] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [grantDate, setGrantDate] = useState(fmtToday());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingNames, setLoadingNames] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setReason('');
    setGrantDate(fmtToday());

    setLoadingNames(true);
    fetchAllEmployeeNames()
      .then(setNames)
      .catch(() => setNames([]))
      .finally(() => setLoadingNames(false));
  }, [open]);

  const toggleName = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    setIsSubmitting(true);
    try {
      const result = await grantDahyu({
        targets: Array.from(selected),
        reason,
        grantDate,
      });
      if (result.ok && result.success) {
        setToast({ message: `대체휴가 지급 완료 (${result.granted.length}명)`, type: 'success' });
        invalidateVacationCache();
        onSuccess?.();
        onClose();
      } else {
        const msg = result.failed.length > 0
          ? `지급 실패: ${result.failed.join(', ')}`
          : result.state || '지급에 실패했습니다';
        setToast({ message: msg, type: 'error' });
      }
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : '지급 실패', type: 'error' });
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
            className="relative bg-bg-card/95 backdrop-blur-xl border border-bg-border/40 rounded-2xl shadow-2xl w-[420px] max-h-[90vh] overflow-auto"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border/30">
              <div className="flex items-center gap-2">
                <Palmtree size={16} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-text-primary">대체휴가 지급</h3>
              </div>
              <button onClick={onClose} className="p-1 text-text-secondary/50 hover:text-text-primary cursor-pointer">
                <X size={16} />
              </button>
            </div>

            {/* body */}
            <div className="px-5 py-4 space-y-4">
              {/* 지급 대상 */}
              <div>
                <label className="text-xs text-text-secondary/70 mb-1.5 block">지급 대상 (복수 선택 가능)</label>
                {loadingNames ? (
                  <div className="flex items-center gap-2 py-3 justify-center">
                    <Loader2 size={14} className="text-accent animate-spin" />
                    <span className="text-xs text-text-secondary/50">직원 목록 로드 중...</span>
                  </div>
                ) : names.length === 0 ? (
                  <p className="text-xs text-text-secondary/50 py-2">직원 목록을 불러올 수 없습니다</p>
                ) : (
                  <div className="max-h-[200px] overflow-auto rounded-lg border border-bg-border/30 p-2">
                    <div className="flex flex-wrap gap-1.5">
                      {names.map((name) => {
                        const isChecked = selected.has(name);
                        return (
                          <button
                            key={name}
                            onClick={() => toggleName(name)}
                            className={cn(
                              'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border',
                              isChecked
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : 'bg-bg-border/20 text-text-secondary/60 border-bg-border/30 hover:text-text-primary',
                            )}
                          >
                            {isChecked && <Check size={10} />}
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {selected.size > 0 && (
                  <p className="text-[10px] text-emerald-400/70 mt-1">{selected.size}명 선택됨</p>
                )}
              </div>

              {/* 사유 */}
              <div>
                <label className="text-xs text-text-secondary/70 mb-1.5 block">지급 사유</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="야근 대체"
                  className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-emerald-400"
                />
              </div>

              {/* 지급 일자 */}
              <div>
                <label className="text-xs text-text-secondary/70 mb-1.5 block">지급 일자</label>
                <input
                  type="date"
                  value={grantDate}
                  onChange={(e) => setGrantDate(e.target.value)}
                  className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-emerald-400"
                />
              </div>

              <p className="text-[10px] text-text-secondary/40">* 1인당 1일씩 지급됩니다</p>
            </div>

            {/* footer */}
            <div className="px-5 py-4 border-t border-bg-border/30">
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || selected.size === 0}
                className={cn(
                  'w-full py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2',
                  isSubmitting || selected.size === 0
                    ? 'bg-emerald-500/30 text-emerald-400/60 cursor-not-allowed'
                    : 'bg-emerald-500 hover:bg-emerald-500/80 text-white',
                )}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    지급 처리 중...
                  </>
                ) : (
                  '지급하기'
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
