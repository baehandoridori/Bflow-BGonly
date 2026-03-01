import { useState, useEffect } from 'react';
import { X, Palmtree } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/cn';
import { useAppStore } from '@/stores/useAppStore';
import { submitVacation } from '@/services/vacationService';
import { VACATION_TYPES, type VacationType } from '@/types/vacation';

interface VacationRegisterModalProps {
  open: boolean;
  onClose: () => void;
  userName: string;
  /** 초기 날짜 (캘린더에서 날짜 클릭 시) */
  initialDate?: string;
  /** 등록 성공 후 콜백 */
  onSuccess?: () => void;
}

const TYPE_LABELS: Record<VacationType, string> = {
  '연차': '연차',
  '오전반차': '오전반차',
  '오후반차': '오후반차',
  '대체휴가': '대체휴가',
  '특별휴가': '특별휴가',
};

function fmtToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function VacationRegisterModal({
  open, onClose, userName, initialDate, onSuccess,
}: VacationRegisterModalProps) {
  const setToast = useAppStore((s) => s.setToast);

  const [type, setType] = useState<VacationType>('연차');
  const [startDate, setStartDate] = useState(initialDate ?? fmtToday());
  const [endDate, setEndDate] = useState(initialDate ?? fmtToday());
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 반차 선택 시 endDate를 startDate와 동일하게
  const isHalfDay = type === '오전반차' || type === '오후반차';
  useEffect(() => {
    if (isHalfDay) {
      setEndDate(startDate);
    }
  }, [isHalfDay, startDate]);

  // 초기값 리셋
  useEffect(() => {
    if (open) {
      setType('연차');
      setStartDate(initialDate ?? fmtToday());
      setEndDate(initialDate ?? fmtToday());
      setReason('');
      setError(null);
    }
  }, [open, initialDate]);

  const invalidateVacationCache = useAppStore((s) => s.invalidateVacationCache);

  const handleSubmit = async () => {
    if (!startDate || !endDate) {
      setError('날짜를 입력해주세요');
      return;
    }
    if (startDate > endDate) {
      setError('종료일이 시작일보다 빠릅니다');
      return;
    }

    // B1a: Optimistic — 모달 즉시 닫기, 백그라운드에서 API 호출
    setToast({ message: '휴가 등록 요청 중...', type: 'info' });
    onClose();

    try {
      const result = await submitVacation({
        name: userName,
        type,
        startDate,
        endDate,
        reason,
      });

      if (result.ok && result.success) {
        setToast({ message: '휴가가 등록되었습니다', type: 'success' });
        invalidateVacationCache();
        onSuccess?.();
        // 안전장치: GAS 파이프라인 완전 완료 후 데이터 한번 더 갱신
        setTimeout(() => {
          invalidateVacationCache();
          onSuccess?.();
        }, 3000);
      } else {
        // D3: 등록 실패 상세 알림
        setToast({ message: '휴가 등록 실패: ' + (result.error || result.state || '알 수 없는 오류'), type: 'error' });
      }
    } catch (err) {
      setToast({ message: '휴가 등록 실패: ' + (err instanceof Error ? err.message : String(err)), type: 'error' });
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
          {/* backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

          {/* modal */}
          <motion.div
            className="relative bg-bg-card/95 backdrop-blur-xl border border-bg-border/40 rounded-2xl shadow-2xl w-[400px] max-h-[90vh] overflow-auto"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border/30">
              <div className="flex items-center gap-2">
                <Palmtree size={16} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-text-primary">휴가 신청</h3>
              </div>
              <button onClick={onClose} className="p-1 text-text-secondary/50 hover:text-text-primary cursor-pointer">
                <X size={16} />
              </button>
            </div>

            {/* body */}
            <div className="px-5 py-4 space-y-4">
              {/* 종류 선택 */}
              <div>
                <label className="text-xs text-text-secondary/70 mb-1.5 block">종류</label>
                <div className="flex flex-wrap gap-1.5">
                  {VACATION_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer border',
                        type === t
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-bg-border/20 text-text-secondary/60 border-bg-border/30 hover:text-text-primary',
                      )}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* 날짜 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-secondary/70 mb-1.5 block">시작일</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-secondary/70 mb-1.5 block">종료일</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={isHalfDay}
                    className={cn(
                      'w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-emerald-400',
                      isHalfDay && 'opacity-50 cursor-not-allowed',
                    )}
                  />
                </div>
              </div>
              {isHalfDay && (
                <p className="text-[10px] text-text-secondary/40 -mt-2">반차는 시작일과 종료일이 동일합니다</p>
              )}

              {/* 사유 */}
              <div>
                <label className="text-xs text-text-secondary/70 mb-1.5 block">사유</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="개인사유"
                  className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-emerald-400"
                />
              </div>

              {/* 에러 */}
              {error && (
                <div className="px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
                  {error}
                </div>
              )}
            </div>

            {/* footer */}
            <div className="px-5 py-4 border-t border-bg-border/30">
              <button
                onClick={handleSubmit}
                className="w-full py-2.5 rounded-lg text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-500/80 text-white"
              >
                신청하기
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
