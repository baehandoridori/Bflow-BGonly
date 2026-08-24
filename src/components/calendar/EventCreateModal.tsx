import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import type { CalendarEvent, CalendarEventType } from '@/types/calendar';
import { EVENT_COLORS } from '@/types/calendar';
import { DEPARTMENT_CONFIGS } from '@/types';
import { fmtDate } from '@/utils/calendarDate';
import { floatingGlassStyle } from '@/utils/glassStyles';

/* ═══════════════════════════════════════════════════
   이벤트 생성/편집 모달
   ═══════════════════════════════════════════════════ */

export function EventCreateModal({
  initialDate,
  initialEndDate,
  episodes,
  onClose,
  onSave,
}: {
  initialDate?: string;
  initialEndDate?: string;
  episodes: { episodeNumber: number; title: string; parts: { partId: string; sheetName: string; department: string; scenes: { sceneId: string; no: number }[] }[] }[];
  onClose: () => void;
  onSave: (ev: Omit<CalendarEvent, 'id' | 'createdAt'>) => void;
}) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const colorMode = useAppStore((s) => s.colorMode);
  const today = fmtDate(new Date());
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [startDate, setStartDate] = useState(initialDate ?? today);
  const [endDate, setEndDate] = useState(initialEndDate ?? initialDate ?? today);
  const [color, setColor] = useState<string>(EVENT_COLORS[0]);
  const [evType, setEvType] = useState<CalendarEventType>('custom');
  const [isPrivate, setIsPrivate] = useState(false);

  // 연결 항목
  const [linkedEp, setLinkedEp] = useState<number | ''>('');
  const [linkedPart, setLinkedPart] = useState('');
  const [linkedScene, setLinkedScene] = useState('');

  const selectedEpParts = useMemo(() => {
    if (linkedEp === '') return [];
    return episodes.find((e) => e.episodeNumber === linkedEp)?.parts ?? [];
  }, [linkedEp, episodes]);

  const selectedPartScenes = useMemo(() => {
    if (!linkedPart) return [];
    return selectedEpParts.find((p) => p.sheetName === linkedPart)?.scenes ?? [];
  }, [linkedPart, selectedEpParts]);

  // 에피소드/파트/씬 선택 시 제목 자동 입력
  useEffect(() => {
    if (evType === 'custom') return;
    const ep = episodes.find((e) => e.episodeNumber === linkedEp);
    if (!ep) {
      // 에피소드 미선택 시 안내 제목
      if (evType === 'episode') setTitle('에피소드 선택...');
      else if (evType === 'part') setTitle('파트 선택...');
      else if (evType === 'scene') setTitle('씬 선택...');
      return;
    }
    const epLabel = episodeTitles[ep.episodeNumber] || ep.title;
    if (evType === 'episode') {
      setTitle(epLabel);
    } else if (evType === 'part' || evType === 'scene') {
      const part = selectedEpParts.find((p) => p.sheetName === linkedPart);
      if (!part) {
        // 파트 미선택 — 에피소드까지만 표시
        setTitle(`${epLabel} — 파트 선택...`);
      } else {
        const deptLabel = DEPARTMENT_CONFIGS[part.department as 'bg' | 'acting']?.shortLabel ?? '';
        if (evType === 'part') {
          setTitle(`${epLabel} ${part.partId}파트 (${deptLabel})`);
        } else if (evType === 'scene') {
          // 씬 선택 시 제목, 씬 미선택이면 파트까지만 표시
          setTitle(linkedScene
            ? `${epLabel} ${part.partId}파트 #${linkedScene}`
            : `${epLabel} ${part.partId}파트 (${deptLabel}) — 씬 선택...`);
        }
      }
    }
  }, [evType, linkedEp, linkedPart, linkedScene, episodes, selectedEpParts]);

  const handleSubmit = () => {
    if (!title.trim()) return;
    const partData = selectedEpParts.find((p) => p.sheetName === linkedPart);
    onSave({
      title: title.trim(),
      memo: memo.trim(),
      color,
      type: evType,
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      createdBy: currentUser?.name ?? '알 수 없음',
      linkedEpisode: linkedEp !== '' ? linkedEp : undefined,
      linkedPart: partData?.partId,
      linkedSheetName: linkedPart || undefined,
      linkedSceneId: linkedScene || undefined,
      linkedDepartment: partData?.department as 'bg' | 'acting' | undefined,
      isPrivate,
    });
  };

  return (
    <>
      {/* 배경 클릭으로 닫기 (반투명 오버레이 없음) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.01 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="absolute right-0 top-0 bottom-0 z-50 w-[24rem] max-h-full overflow-y-auto"
        style={{
          ...floatingGlassStyle,
          background: 'rgb(var(--color-bg-card) / 0.96)',
          borderLeft: '1px solid rgb(var(--color-bg-border) / 0.42)',
          boxShadow: '-14px 0 36px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.22))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border">
          <h3 className="text-sm font-bold text-text-primary">새 이벤트</h3>
          <button onClick={onClose} className="p-1 text-text-secondary hover:text-text-primary cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* 제목 */}
          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">제목</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="이벤트 이름"
              className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/40 outline-none focus:border-accent"
              autoFocus
            />
          </div>

          {/* 날짜 */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">시작일</label>
              <div className="relative mt-1">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-bg-card border border-accent/40 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 date-picker-hidden"
                  style={{ colorScheme: colorMode }}
                />
                <CalendarDays size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
              </div>
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">마감일</label>
              <div className="relative mt-1">
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-bg-card border border-accent/40 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 date-picker-hidden"
                  style={{ colorScheme: colorMode }}
                />
                <CalendarDays size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
              </div>
            </div>
          </div>

          {/* 이벤트 유형 */}
          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">유형</label>
            <div className="flex gap-1.5 mt-1">
              {([['custom', '일반'], ['episode', '에피소드'], ['part', '파트'], ['scene', '씬']] as const).map(([t, l]) => (
                <button
                  key={t}
                  onClick={() => {
                    setEvType(t);
                    // 더 구체적인 타입으로 갈 때 기존 선택 유지, 덜 구체적으로 갈 때만 초기화
                    if (t === 'custom') { setLinkedEp(''); setLinkedPart(''); setLinkedScene(''); }
                    else if (t === 'episode') { setLinkedPart(''); setLinkedScene(''); }
                    else if (t === 'part') { setLinkedScene(''); }
                    // 'scene' → 모든 기존 선택 유지
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer',
                    evType === t
                      ? 'bg-accent/20 text-accent'
                      : 'bg-bg-primary text-text-secondary hover:text-text-primary',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* 연결 항목 (에피소드/파트/씬 선택) */}
          {evType !== 'custom' && (
            <div className="flex flex-col gap-2 bg-bg-primary/50 rounded-xl p-3 border border-bg-border/50">
              <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">연결 대상</label>
              <select
                value={linkedEp}
                onChange={(e) => { setLinkedEp(e.target.value ? Number(e.target.value) : ''); setLinkedPart(''); setLinkedScene(''); }}
                className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
              >
                <option value="">에피소드 선택</option>
                {episodes.map((ep) => (
                  <option key={ep.episodeNumber} value={ep.episodeNumber}>{episodeTitles[ep.episodeNumber] || ep.title}</option>
                ))}
              </select>
              {(evType === 'part' || evType === 'scene') && linkedEp !== '' && (
                <select
                  value={linkedPart}
                  onChange={(e) => { setLinkedPart(e.target.value); setLinkedScene(''); }}
                  className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                >
                  <option value="">파트 선택</option>
                  {selectedEpParts.map((p) => (
                    <option key={p.sheetName} value={p.sheetName}>
                      {p.partId}파트 ({DEPARTMENT_CONFIGS[p.department as 'bg' | 'acting']?.shortLabel ?? p.department})
                    </option>
                  ))}
                </select>
              )}
              {evType === 'scene' && linkedPart && (
                <select
                  value={linkedScene}
                  onChange={(e) => setLinkedScene(e.target.value)}
                  className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                >
                  <option value="">씬 선택</option>
                  {selectedPartScenes.map((s) => (
                    <option key={s.sceneId || s.no} value={s.sceneId || String(s.no)}>
                      #{s.no} {s.sceneId}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* 색상 */}
          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">색상</label>
            <div className="flex gap-1.5 mt-1.5">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-6 h-6 rounded-full transition-all cursor-pointer',
                    color === c ? 'scale-110' : 'hover:scale-110',
                  )}
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px rgb(var(--color-bg-card)), 0 0 0 4px ${c}` : undefined }}
                />
              ))}
            </div>
          </div>

          {/* 메모 */}
          <div>
            <label className="text-xs font-semibold text-text-secondary/60 uppercase tracking-wider">메모</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모 (선택사항)"
              rows={2}
              className="mt-1 w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-secondary/40 resize-none outline-none focus:border-accent"
            />
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-bg-border/65 bg-bg-primary/60 px-3.5 py-3 cursor-pointer transition-colors hover:border-accent/30">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded accent-accent cursor-pointer"
            />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-text-primary">나만 보기</div>
              <p className="mt-1 text-[11px] leading-relaxed text-text-secondary/80">
                Google Calendar에는 올리지 않고 B flow에만 저장합니다. 같은 계정으로 로그인한 본인 기기에서만 계속 보입니다.
              </p>
            </div>
          </label>

          {/* 저장 */}
          <button
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="w-full py-2.5 rounded-xl text-sm font-medium bg-accent hover:bg-accent/80 text-white disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            이벤트 추가
          </button>
        </div>
      </motion.div>
    </>
  );
}
