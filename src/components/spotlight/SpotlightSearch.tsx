import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Film, User, FileText, Zap, Hash, Layers, CalendarDays } from 'lucide-react';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { sceneProgress } from '@/utils/calcStats';
import { DEPARTMENT_CONFIGS } from '@/types';
import { cn } from '@/utils/cn';
import { getEvents } from '@/services/calendarService';
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
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([]);
  useEffect(() => { getEvents().then(setCalEvents); }, []);
  const {
    setView,
    setSelectedEpisode,
    setSelectedPart,
    setSelectedAssignee,
    setSelectedDepartment,
    setHighlightSceneId,
    setSearchQuery,
    setStatusFilter,
    setToast,
  } = useAppStore();

  /* ── 글로벌 단축키: Ctrl+Space ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

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
    // 필터 리셋
    setSearchQuery('');
    setStatusFilter('all');
    if (!opts.assignee) setSelectedAssignee(null);

    // 네비게이션
    setView('scenes');
    if (opts.episode !== undefined) setSelectedEpisode(opts.episode);
    if (opts.part !== undefined) setSelectedPart(opts.part);
    if (opts.department !== undefined) setSelectedDepartment(opts.department);
    if (opts.assignee) setSelectedAssignee(opts.assignee);
    if (opts.sceneId) setHighlightSceneId(opts.sceneId);
    if (opts.toastMsg) setToast(opts.toastMsg);
  }, [setView, setSelectedEpisode, setSelectedPart, setSelectedAssignee, setSelectedDepartment, setHighlightSceneId, setSearchQuery, setStatusFilter, setToast]);

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
        const partFullLabel = `${ep.title} ${partLabel} (${deptLabel})`;
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
            subtitle: `${ep.title} · ${totalScenes}개 씬`,
            meta: `${avgPct}%`,
            pct: avgPct,
            icon: <Layers size={16} />,
            score: partScore,
            action: () => {
              resetAndNavigate({
                episode: ep.episodeNumber,
                part: part.partId,
                department: part.department,
                toastMsg: `${ep.title} ${partLabel}(${deptLabel})로 이동합니다`,
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
              subtitle: `${ep.title} ${part.partId}파트 · ${deptLabel}`,
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
              subtitle: `${scene.sceneId} · ${ep.title} ${part.partId}파트`,
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
            resetAndNavigate({ assignee: name, toastMsg: `${name}님의 씬을 표시합니다` });
            close();
          },
        });
      }
    }

    // ── 에피소드 검색 ──
    for (const ep of episodes) {
      const epScore = Math.max(
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
          title: ep.title,
          subtitle: `${ep.parts.length}개 파트 · ${totalScenes}개 씬`,
          meta: `${avgPct}%`,
          pct: avgPct,
          icon: <Film size={16} />,
          score: epScore,
          action: () => {
            resetAndNavigate({ episode: ep.episodeNumber, toastMsg: `${ep.title}로 이동합니다` });
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
  }, [query, episodes, calEvents, resetAndNavigate, setView, setToast]);

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
              backgroundColor: 'rgba(0,0,0,0.45)',
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
              {/* 글래스 컨테이너 */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  backgroundColor: 'rgba(26,29,39,0.88)',
                  border: '1px solid rgba(45,48,65,0.6)',
                  boxShadow:
                    '0 24px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 1px 0 rgba(255,255,255,0.06) inset',
                }}
              >
                {/* ── 검색 입력 ── */}
                <div className="flex items-center gap-3 px-5 py-4">
                  <Search size={20} className="text-text-secondary/60 shrink-0" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="씬번호, 담당자, 에피소드 검색..."
                    className="flex-1 bg-transparent text-text-primary text-[15px] placeholder:text-text-secondary/50 outline-none"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <kbd className="hidden sm:flex items-center px-1.5 py-0.5 rounded text-[10px] text-text-secondary/50 border border-bg-border/40 font-mono">
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
                    <div className="px-5 py-10 text-center text-text-secondary/50 text-sm">
                      검색 결과가 없습니다
                    </div>
                  )}

                  {grouped.map((group) => (
                    <div key={group.category} className="mb-1">
                      <div className="px-5 pt-2.5 pb-1 text-[11px] font-medium text-text-secondary/50 uppercase tracking-wider">
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
                                isSelected ? 'text-accent' : 'text-text-secondary/50',
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
                              <div className="text-xs text-text-secondary/50 truncate">
                                {item.subtitle}
                              </div>
                            </div>
                            {item.pct !== undefined && <MiniProgress pct={item.pct} />}
                            {item.meta && (
                              <span className="text-[11px] text-text-secondary/50 shrink-0 font-mono tabular-nums w-8 text-right">
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
                <div className="flex items-center justify-between px-5 py-2 border-t border-bg-border/20 text-[10px] text-text-secondary/45">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <kbd className="px-1 py-px rounded bg-bg-primary/30 border border-bg-border/20 font-mono text-[10px]">
                        ↑↓
                      </kbd>
                      <span>이동</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="px-1 py-px rounded bg-bg-primary/30 border border-bg-border/20 font-mono text-[10px]">
                        ↵
                      </kbd>
                      <span>선택</span>
                    </span>
                  </div>
                  <span className="flex items-center gap-0.5">
                    <kbd className="px-1 py-px rounded bg-bg-primary/30 border border-bg-border/20 font-mono text-[10px]">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="px-1 py-px rounded bg-bg-primary/30 border border-bg-border/20 font-mono text-[10px]">Space</kbd>
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
