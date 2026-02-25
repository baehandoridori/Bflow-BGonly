import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Film, User, FileText, Zap, Hash, Layers, CalendarDays, StickyNote } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { sceneProgress } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { Episode } from '@/types';
import { cn } from '@/utils/cn';
import { getEvents } from '@/services/calendarService';
import { readMetadataFromSheets } from '@/services/sheetsService';
import type { CalendarEvent } from '@/types/calendar';

/* ────────────────────────────────────────────────
   타입
   ──────────────────────────────────────────────── */
type ResultCategory = 'scene' | 'assignee' | 'episode' | 'part' | 'memo' | 'event' | 'action';

interface SearchResult {
  id: string;
  category: ResultCategory;
  title: string;
  subtitle: string;
  meta?: string;
  pct?: number; // 미니 프로그레스 바용
  icon: React.ReactNode;
  action: () => void;
}

/* ────────────────────────────────────────────────
   퍼지 검색 유틸
   ──────────────────────────────────────────────── */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 70;
  // character-by-character fuzzy
  let qi = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    } else {
      consecutive = 0;
    }
  }
  if (qi < q.length) return 0;
  return 30 + maxConsecutive * 10;
}

/* ────────────────────────────────────────────────
   카테고리 라벨
   ──────────────────────────────────────────────── */
const CATEGORY_LABELS: Record<ResultCategory, string> = {
  scene: '씬',
  assignee: '담당자',
  episode: '에피소드',
  part: '파트',
  memo: '메모',
  event: '캘린더 이벤트',
  action: '빠른 액션',
};

const CATEGORY_ORDER: ResultCategory[] = ['action', 'scene', 'part', 'assignee', 'episode', 'memo', 'event'];

/* ────────────────────────────────────────────────
   미니 프로그레스 바
   ──────────────────────────────────────────────── */
function MiniProgress({ pct }: { pct: number }) {
  const color =
    pct >= 100 ? 'rgba(0,184,148,1)'
    : pct >= 75 ? 'rgba(253,203,110,1)'
    : pct >= 50 ? 'rgba(225,112,85,1)'
    : pct >= 25 ? 'rgba(255,159,67,1)'
    : 'rgba(255,107,107,1)';

  return (
    <div className="w-12 h-1.5 rounded-full bg-bg-border/40 overflow-hidden shrink-0">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(pct, 100)}%`,
          backgroundColor: color,
          transition: 'width 300ms ease-out',
        }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────
   SpotlightSearch 메인 컴포넌트
   ──────────────────────────────────────────────── */
export function SpotlightSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const epName = (ep: Episode) => episodeTitles[ep.episodeNumber] || ep.title;
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([]);
  useEffect(() => { getEvents().then(setCalEvents); }, []);
  const episodeMemos = useDataStore((s) => s.episodeMemos);
  const [partMemos, setPartMemos] = useState<Record<string, string>>({});
  // 파트 메모 로드
  useEffect(() => {
    (async () => {
      const memos: Record<string, string> = {};
      for (const ep of episodes) {
        for (const part of ep.parts) {
          try {
            const data = await readMetadataFromSheets('part-memo', part.sheetName);
            if (data?.value) memos[part.sheetName] = data.value;
          } catch { /* 무시 */ }
        }
      }
      if (Object.keys(memos).length > 0) setPartMemos(memos);
    })();
  }, [episodes]);
  const {
    setView,
    setSelectedEpisode,
    setSelectedPart,
    setSelectedAssignee,
    setSelectedDepartment,
    setHighlightSceneId,
    setSearchQuery,
    setStatusFilter,
    setSceneViewMode,
    setSceneGroupMode,
    setToast,
    setHighlightUserName,
  } = useAppStore();

  /* ── 글로벌 단축키: Ctrl+Space ── */
  const isOpenRef = useRef(isOpen);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 입력 필드에 포커스 중이면 IME 충돌 방지를 위해 무시
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || (document.activeElement as HTMLElement)?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        // 입력 필드에서는 IME 전환을 위해 가로채지 않음
        if (isEditable && !isOpenRef.current) return;
        e.preventDefault();
        setIsOpen((prev) => !prev);
        return;
      }
      if (e.key === 'Escape' && isOpenRef.current) {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []); // 의존성 없음 — isOpenRef로 최신 상태 참조

  /* ── 열릴 때 포커스 & 쿼리 초기화 ── */
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  /* ── 필터 리셋 후 네비게이션 헬퍼 ── */
  const resetAndNavigate = useCallback((opts: {
    episode?: number;
    part?: string;
    department?: 'bg' | 'acting';
    assignee?: string;
    sceneId?: string;
    toastMsg?: string;
  }) => {
    // 필터 리셋 + 뷰 모드 초기화 (카드뷰, 씬번호별)
    setSearchQuery('');
    setStatusFilter('all');
    setSceneViewMode('card');
    setSceneGroupMode('flat');
    if (!opts.assignee) setSelectedAssignee(null);

    // 네비게이션
    setView('scenes');
    if (opts.episode !== undefined) setSelectedEpisode(opts.episode);
    if (opts.part !== undefined) setSelectedPart(opts.part);
    if (opts.department !== undefined) setSelectedDepartment(opts.department);
    if (opts.assignee) setSelectedAssignee(opts.assignee);
    if (opts.sceneId) setHighlightSceneId(opts.sceneId);
    if (opts.toastMsg) setToast(opts.toastMsg);
  }, [setView, setSelectedEpisode, setSelectedPart, setSelectedAssignee, setSelectedDepartment, setHighlightSceneId, setSearchQuery, setStatusFilter, setSceneViewMode, setSceneGroupMode, setToast]);

  /* ── 검색 결과 빌드 ── */
  const results = useMemo<SearchResult[]>(() => {
    const close = () => setIsOpen(false);

    // 빈 쿼리 → 빠른 액션만 표시
    if (!query.trim()) {
      return [
        {
          id: 'action-dashboard',
          category: 'action',
          title: '대시보드',
          subtitle: '전체 현황 대시보드로 이동',
          icon: <Zap size={16} />,
          action: () => { setView('dashboard'); close(); },
        },
        {
          id: 'action-scenes',
          category: 'action',
          title: '씬 목록',
          subtitle: '씬 관리 뷰로 이동',
          icon: <Zap size={16} />,
          action: () => { setView('scenes'); close(); },
        },
        {
          id: 'action-episode',
          category: 'action',
          title: '에피소드 현황',
          subtitle: '에피소드별 현황 뷰로 이동',
          icon: <Zap size={16} />,
          action: () => { setView('episode'); close(); },
        },
        {
          id: 'action-assignee',
          category: 'action',
          title: '인원별 현황',
          subtitle: '담당자별 태스크 뷰로 이동',
          icon: <Zap size={16} />,
          action: () => { setView('assignee'); close(); },
        },
        {
          id: 'action-team',
          category: 'action',
          title: '팀원 현황',
          subtitle: '등록된 팀원 목록 보기',
          icon: <Zap size={16} />,
          action: () => { setView('team'); close(); },
        },
      ];
    }

    const q = query.trim();
    const items: (SearchResult & { score: number })[] = [];

    // ── 씬 & 메모 검색 ──
    for (const ep of episodes) {
      for (const part of ep.parts) {
        // ── 파트 검색 ──
        const deptLabel = DEPARTMENT_CONFIGS[part.department].shortLabel;
        const partLabel = `${part.partId}파트`;
        const partFullLabel = `${epName(ep)} ${partLabel} (${deptLabel})`;
        const partScore = Math.max(
          fuzzyScore(q, partLabel),
          fuzzyScore(q, `${part.partId}`),
          fuzzyScore(q, partFullLabel),
        );
        if (partScore > 0) {
          const totalScenes = part.scenes.length;
          const progressSum = part.scenes.reduce((s, sc) => s + sceneProgress(sc), 0);
          const avgPct = totalScenes > 0 ? Math.round(progressSum / totalScenes) : 0;
          items.push({
            id: `part-${part.sheetName}`,
            category: 'part',
            title: `${partLabel} (${deptLabel})`,
            subtitle: `${epName(ep)} · ${totalScenes}개 씬`,
            meta: `${avgPct}%`,
            pct: avgPct,
            icon: <Layers size={16} />,
            score: partScore,
            action: () => {
              resetAndNavigate({
                episode: ep.episodeNumber,
                part: part.partId,
                department: part.department,
                toastMsg: `${epName(ep)} ${partLabel}(${deptLabel})로 이동합니다`,
              });
              close();
            },
          });
        }

        for (const scene of part.scenes) {
          const sceneScore = fuzzyScore(q, scene.sceneId);
          if (sceneScore > 0) {
            const pct = Math.round(sceneProgress(scene));
            items.push({
              id: `scene-${part.sheetName}-${scene.sceneId}`,
              category: 'scene',
              title: scene.sceneId,
              subtitle: `${epName(ep)} ${part.partId}파트 · ${deptLabel}`,
              meta: `${pct}%`,
              pct,
              icon: <Hash size={16} />,
              score: sceneScore,
              action: () => {
                resetAndNavigate({
                  episode: ep.episodeNumber,
                  part: part.partId,
                  department: part.department,
                  sceneId: scene.sceneId,
                });
                close();
              },
            });
          }
          if (scene.memo && fuzzyScore(q, scene.memo) > 0) {
            items.push({
              id: `memo-${part.sheetName}-${scene.sceneId}`,
              category: 'memo',
              title: scene.memo.length > 50 ? scene.memo.slice(0, 50) + '...' : scene.memo,
              subtitle: `${scene.sceneId} · ${epName(ep)} ${part.partId}파트`,
              icon: <FileText size={16} />,
              score: fuzzyScore(q, scene.memo),
              action: () => {
                resetAndNavigate({
                  episode: ep.episodeNumber,
                  part: part.partId,
                  department: part.department,
                  sceneId: scene.sceneId,
                });
                close();
              },
            });
          }
        }

        // ── 파트 메모 검색 ──
        const partMemoText = partMemos[part.sheetName];
        if (partMemoText) {
          const pmScore = fuzzyScore(q, partMemoText);
          if (pmScore > 0) {
            items.push({
              id: `partmemo-${part.sheetName}`,
              category: 'memo',
              title: partMemoText.length > 50 ? partMemoText.slice(0, 50) + '...' : partMemoText,
              subtitle: `파트 메모 · ${epName(ep)} ${part.partId}파트 (${deptLabel})`,
              icon: <StickyNote size={16} />,
              score: pmScore,
              action: () => {
                resetAndNavigate({
                  episode: ep.episodeNumber,
                  part: part.partId,
                  department: part.department,
                });
                close();
              },
            });
          }
        }
      }

      // ── 에피소드 메모 검색 ──
      const epMemoText = episodeMemos[ep.episodeNumber];
      if (epMemoText) {
        const emScore = fuzzyScore(q, epMemoText);
        if (emScore > 0) {
          items.push({
            id: `epmemo-${ep.episodeNumber}`,
            category: 'memo',
            title: epMemoText.length > 50 ? epMemoText.slice(0, 50) + '...' : epMemoText,
            subtitle: `에피소드 메모 · ${epName(ep)}`,
            icon: <StickyNote size={16} />,
            score: emScore,
            action: () => {
              resetAndNavigate({
                episode: ep.episodeNumber,
                toastMsg: `${epName(ep)} 메모`,
              });
              close();
            },
          });
        }
      }
    }

    // ── 담당자 검색 ──
    const assigneeMap = new Map<string, { total: number; progressSum: number }>();
    for (const ep of episodes) {
      for (const part of ep.parts) {
        for (const scene of part.scenes) {
          if (!scene.assignee) continue;
          const entry = assigneeMap.get(scene.assignee) || { total: 0, progressSum: 0 };
          entry.total++;
          entry.progressSum += sceneProgress(scene);
          assigneeMap.set(scene.assignee, entry);
        }
      }
    }
    for (const [name, data] of assigneeMap) {
      const score = fuzzyScore(q, name);
      if (score > 0) {
        const avgPct = Math.round(data.progressSum / data.total);
        items.push({
          id: `assignee-${name}`,
          category: 'assignee',
          title: name,
          subtitle: `${data.total}개 씬 담당`,
          meta: `${avgPct}%`,
          pct: avgPct,
          icon: <User size={16} />,
          score,
          action: () => {
            setView('team');
            setHighlightUserName(name);
            setToast(`${name}님의 정보를 표시합니다`);
            close();
          },
        });
      }
    }

    // ── 에피소드 검색 ──
    for (const ep of episodes) {
      const epDisplayName = epName(ep);
      const epScore = Math.max(
        fuzzyScore(q, epDisplayName),
        fuzzyScore(q, ep.title),
        fuzzyScore(q, `EP${ep.episodeNumber}`),
        fuzzyScore(q, String(ep.episodeNumber)),
      );
      if (epScore > 0) {
        const totalScenes = ep.parts.reduce((sum, p) => sum + p.scenes.length, 0);
        const progressSum = ep.parts.reduce(
          (sum, p) => sum + p.scenes.reduce((s, sc) => s + sceneProgress(sc), 0),
          0,
        );
        const avgPct = totalScenes > 0 ? Math.round(progressSum / totalScenes) : 0;
        items.push({
          id: `episode-${ep.episodeNumber}`,
          category: 'episode',
          title: epDisplayName,
          subtitle: `${ep.parts.length}개 파트 · ${totalScenes}개 씬`,
          meta: `${avgPct}%`,
          pct: avgPct,
          icon: <Film size={16} />,
          score: epScore,
          action: () => {
            resetAndNavigate({ episode: ep.episodeNumber, toastMsg: `${epDisplayName}로 이동합니다` });
            close();
          },
        });
      }
    }

    // ── 캘린더 이벤트 검색 (제목 + 메모 + 타입) ──
    const typeLabels: Record<string, string> = { custom: '일반', episode: '에피소드', part: '파트', scene: '씬' };
    for (const ev of calEvents) {
      if (!ev) continue;
      const titleScore = ev.title ? fuzzyScore(q, ev.title) : 0;
      const memoScore = ev.memo ? fuzzyScore(q, ev.memo) : 0;
      const typeScore = ev.type && typeLabels[ev.type] ? fuzzyScore(q, typeLabels[ev.type]) * 0.5 : 0;
      const evScore = Math.max(titleScore, memoScore, typeScore);
      if (evScore > 0) {
        const typeLabel = ev.type && typeLabels[ev.type] ? `[${typeLabels[ev.type]}] ` : '';
        items.push({
          id: `event-${ev.id}`,
          category: 'event',
          title: ev.title || '(제목 없음)',
          subtitle: `${typeLabel}${ev.startDate} → ${ev.endDate}${ev.memo ? ` · ${ev.memo.slice(0, 30)}` : ''}`,
          icon: <CalendarDays size={16} />,
          score: evScore,
          action: () => {
            setView('schedule');
            setToast(`캘린더: ${ev.title || '이벤트'}`);
            close();
          },
        });
      }
    }

    // 점수 내림차순 정렬, 상위 20개
    items.sort((a, b) => b.score - a.score);
    return items.slice(0, 20);
  }, [query, episodes, calEvents, episodeMemos, partMemos, resetAndNavigate, setView, setToast]);

  /* ── 카테고리별 그룹핑 ── */
  const grouped = useMemo(() => {
    return CATEGORY_ORDER
      .map((cat) => ({
        category: cat,
        label: CATEGORY_LABELS[cat],
        items: results.filter((r) => r.category === cat),
      }))
      .filter((g) => g.items.length > 0);
  }, [results]);

  const flatResults = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  /* ── 키보드 네비게이션 ── */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flatResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && flatResults[selectedIndex]) {
        e.preventDefault();
        flatResults[selectedIndex].action();
      }
    },
    [flatResults, selectedIndex],
  );

  /* ── 선택 항목 스크롤 ── */
  useEffect(() => {
    const el = resultsRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  /* ── 쿼리 변경 시 선택 초기화 ── */
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── 백드롭 ── */}
          <motion.div
            className="fixed inset-0 z-[9998]"
            style={{
              backgroundColor: 'rgb(var(--color-overlay) / var(--overlay-alpha))',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setIsOpen(false)}
          />

          {/* ── 검색 패널 ── */}
          <div className="fixed inset-0 z-[9999] flex justify-center pointer-events-none" style={{ paddingTop: '14vh' }}>
            <motion.div
              className="pointer-events-auto w-full max-w-[560px] h-fit"
              initial={{ opacity: 0, y: -24, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* 글래스 컨테이너 — 라이트/다크 모드 자동 대응 */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  backgroundColor: 'rgb(var(--color-bg-card) / 0.92)',
                  border: '1px solid rgb(var(--color-bg-border) / 0.5)',
                  boxShadow:
                    '0 24px 48px rgb(var(--color-shadow) / var(--shadow-alpha)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset, 0 1px 0 rgb(var(--color-glass-highlight) / calc(var(--glass-highlight-alpha) * 1.5)) inset',
                }}
              >
                {/* ── 검색 입력 ── */}
                <div className="flex items-center gap-3 px-5 py-4">
                  <Search size={20} className="text-text-secondary shrink-0" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="씬번호, 담당자, 에피소드 검색..."
                    className="flex-1 bg-transparent text-text-primary text-base placeholder:text-text-secondary/60 outline-none"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <kbd className="hidden sm:flex items-center px-1.5 py-0.5 rounded text-[11px] text-text-secondary/60 border border-bg-border/40 font-mono">
                    ESC
                  </kbd>
                </div>

                {/* ── 구분선 ── */}
                <div className="mx-4 h-px bg-bg-border/30" />

                {/* ── 결과 목록 ── */}
                <div
                  ref={resultsRef}
                  className="max-h-[340px] overflow-y-auto py-1.5"
                  style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(139,141,163,0.2) transparent' }}
                >
                  {flatResults.length === 0 && query.trim() && (
                    <div className="px-5 py-10 text-center text-text-secondary/70 text-sm">
                      검색 결과가 없습니다
                    </div>
                  )}

                  {grouped.map((group) => (
                    <div key={group.category} className="mb-1">
                      <div className="px-5 pt-2.5 pb-1 text-xs font-medium text-text-secondary/70 uppercase tracking-wider">
                        {group.label}
                      </div>
                      {group.items.map((item) => {
                        const idx = flatResults.indexOf(item);
                        const isSelected = idx === selectedIndex;
                        return (
                          <button
                            key={item.id}
                            data-idx={idx}
                            onClick={item.action}
                            onMouseEnter={() => setSelectedIndex(idx)}
                            className={cn(
                              'w-full flex items-center gap-3 px-5 py-2.5 text-left cursor-pointer',
                              'transition-all duration-100',
                              isSelected
                                ? 'bg-accent/15 border-l-2 border-accent pl-[18px]'
                                : 'hover:bg-bg-border/15 border-l-2 border-transparent pl-[18px]',
                            )}
                          >
                            <span
                              className={cn(
                                'shrink-0 transition-colors duration-75',
                                isSelected ? 'text-accent' : 'text-text-secondary/70',
                              )}
                            >
                              {item.icon}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className={cn(
                                'text-sm font-medium truncate',
                                isSelected ? 'text-text-primary' : 'text-text-primary/80',
                              )}>
                                {item.title}
                              </div>
                              <div className="text-[13px] text-text-secondary/70 truncate">
                                {item.subtitle}
                              </div>
                            </div>
                            {item.pct !== undefined && <MiniProgress pct={item.pct} />}
                            {item.meta && (
                              <span className="text-xs text-text-secondary/70 shrink-0 font-mono tabular-nums w-8 text-right">
                                {item.meta}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* ── 하단 힌트 ── */}
                <div className="flex items-center justify-between px-5 py-2.5 border-t border-bg-border/25 text-[11px] text-text-secondary/60">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <kbd className="px-1 py-px rounded bg-bg-primary/30 border border-bg-border/25 font-mono text-[11px]">
                        ↑↓
                      </kbd>
                      <span>이동</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1 py-px rounded bg-bg-primary/30 border border-bg-border/25 font-mono text-[11px]">
                        ↵
                      </kbd>
                      <span>선택</span>
                    </span>
                  </div>
                  <span className="flex items-center gap-0.5">
                    <kbd className="px-1 py-px rounded bg-bg-primary/30 border border-bg-border/25 font-mono text-[11px]">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="px-1 py-px rounded bg-bg-primary/30 border border-bg-border/25 font-mono text-[11px]">Space</kbd>
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
