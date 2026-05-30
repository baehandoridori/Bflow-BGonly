import { useState, useEffect, useMemo, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { BarChart3, CheckCircle2, Circle, Clock, Filter, Layers, List, ListFilter, PlayCircle, Plus, Search } from 'lucide-react';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { setRevisionsSheetsMode, buildSceneKey } from '@/services/revisionService';
import { loadPartComments } from '@/services/commentService';
import type { CompRevision, RevisionStatus } from '@/types';
import {
  parseSceneKey,
  filterRevisionsBySearch,
  sortRevisions,
} from './compositing/utils';
import { buildFeedbackHubStats, buildFeedbackHubTree } from './compositing/feedbackHubUtils';
import type { SceneInfo, SceneGroup, SortMode } from './compositing/utils';
import { FeedbackTreeSection, EpisodeFilter } from './compositing/SceneGroupSection';
import { DetailPanel } from './compositing/RevisionDetailPanel';
import { EpisodeGroupSection } from './compositing/EpisodeGroupSection';
import { ProgressKanbanSection } from './compositing/ProgressKanbanSection';
import NewRevisionModal from './compositing/NewRevisionModal';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';

// v1.19.0: 그룹화 모드
type GroupMode = 'scene' | 'episode' | 'progress';

interface CompositingViewProps {
  previewMode?: boolean;
  previewCommentCountByRev?: Map<string, number>;
  previewCommentSeenByRev?: Map<string, boolean>;
}

// ─── 메인 뷰 ─────────────────────────────────

export default function CompositingView({
  previewMode = false,
  previewCommentCountByRev,
  previewCommentSeenByRev,
}: CompositingViewProps = {}) {
  const { currentUser } = useAuthStore();
  const dataConnected = useAppStore((s) => s.dataConnected);
  const episodes = useDataStore((s) => s.episodes);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);
  const { revisions, loadRevisions, updateStatus, isLoading } = useRevisionStore();
  const notifications = useNotificationStore((s) => s.notifications);

  const [selectedEp, setSelectedEp] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | RevisionStatus>('all');
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [autoExpandedOnce, setAutoExpandedOnce] = useState(false);
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [groupMode, setGroupMode] = useState<GroupMode>('scene');
  // v1.19.5: 헤더에서 직접 새 리비전 등록 모달 열기
  const [newRevModalOpen, setNewRevModalOpen] = useState(false);
  // v1.19.6: 리비전별 댓글 카운트 맵 (revisionId → count). 표시되는 sheetName 들의 댓글을 한 번 fetch 해 빌드.
  const [commentCountByRev, setCommentCountByRev] = useState<Map<string, number>>(() => new Map());
  // 댓글 변경(다른 창에서 추가/수정/삭제) 시 카운트 재빌드 트리거용 카운터
  const [commentRefreshTick, setCommentRefreshTick] = useState(0);

  // 선택된 리비전 객체
  const selectedRevision = useMemo(
    () => selectedRevisionId ? revisions.find(r => r.id === selectedRevisionId) ?? null : null,
    [revisions, selectedRevisionId],
  );

  useEffect(() => {
    if (previewMode) return;
    setRevisionsSheetsMode(dataConnected);
    loadRevisions();
  }, [dataConnected, loadRevisions, previewMode]);

  const effectiveCommentCountByRev = previewMode && previewCommentCountByRev
    ? previewCommentCountByRev
    : commentCountByRev;
  const notificationCommentSeenByRev = useMemo(() => {
    const states = new Map<string, { hasRead: boolean; hasUnread: boolean }>();

    for (const notification of notifications) {
      const revisionId = notification.metadata?.revisionId;
      const isRevisionComment =
        !!revisionId
        && (
          notification.type === 'comment'
          || notification.type === 'mention'
          || (notification.type === 'revision' && notification.metadata?.revisionAction === 'comment')
        );

      if (!revisionId || !isRevisionComment) continue;

      const state = states.get(revisionId) ?? { hasRead: false, hasUnread: false };
      if (notification.isRead) state.hasRead = true;
      else state.hasUnread = true;
      states.set(revisionId, state);
    }

    const seenByRev = new Map<string, boolean>();
    for (const [revisionId, state] of states) {
      seenByRev.set(revisionId, state.hasRead && !state.hasUnread);
    }
    return seenByRev;
  }, [notifications]);
  const effectiveCommentSeenByRev = previewMode ? previewCommentSeenByRev : notificationCommentSeenByRev;

  // 씬 정보 맵 빌드 (에피소드 데이터 + 리비전 sceneKey 매칭)
  //
  // v1.19.6: 부서(BG/ACT) 분리 폐기.
  // buildSceneKey 결과가 부서 무관(EP:Part:sceneId)이라 BG sheet 의 scene 과 ACT sheet 의 scene 이
  // 같은 sceneKey 에 매핑된다. 따라서 같은 씬의 BG/ACT 리비전은 자연스럽게 한 그룹으로 합산된다.
  //
  // SceneInfo 합병 규칙:
  // - sheetName/department: BG sheet 가 있으면 BG, 없으면 ACT (씬 모달 점프·댓글 라우팅 기준)
  // - assignee/sceneName/sceneUuid: 마찬가지로 BG 우선, fallback ACT
  const sceneInfoMap = useMemo(() => {
    const map = new Map<string, SceneInfo>();
    for (const ep of episodes) {
      for (const part of ep.parts) {
        for (const scene of part.scenes) {
          const sceneKey = buildSceneKey(part.sheetName, scene.sceneId);
          const nextInfo: SceneInfo = {
            sceneKey,
            sceneId: scene.sceneId,
            sceneNo: scene.no,
            sceneName: scene.memo,
            sheetName: part.sheetName,
            part: part.partId,
            department: part.department as 'bg' | 'acting',
            assignee: scene.assignee,
            // v1.19.0: 씬 모달 점프용 보강
            episodeNumber: ep.episodeNumber,
            partId: part.partId,
            sceneUuid: scene.id,
          };
          const existing = map.get(sceneKey);
          // BG sheet 가 있으면 BG 정보를 우선 채택. 이미 BG 가 등록되어 있으면 ACT 는 무시 (덮어쓰기 X).
          if (!existing || (existing.department !== 'bg' && nextInfo.department === 'bg')) {
            map.set(sceneKey, nextInfo);
          }
        }
      }
    }
    return map;
  }, [episodes]);

  // v1.19.0: 검색 + 정렬 적용된 리비전. 그룹핑 단계 입력으로 사용.
  // 코덱스 P2 fix (5차, 2026-05-05): "댓글 많은순" 정렬 시 commentCountByRev 전달.
  // 이전엔 인자 누락으로 sortRevisions 가 모든 리비전을 0 으로 취급해 정렬 무효였음.
  const searchedSorted = useMemo(() => {
    const filtered = filterRevisionsBySearch(revisions, searchQuery, sceneInfoMap);
    return sortRevisions(filtered, sortMode, effectiveCommentCountByRev);
  }, [revisions, searchQuery, sortMode, sceneInfoMap, effectiveCommentCountByRev]);

  // 선택된 리비전의 씬 정보
  const selectedRevisionSceneInfo = useMemo(
    () => selectedRevision ? sceneInfoMap.get(selectedRevision.sceneKey) ?? null : null,
    [selectedRevision, sceneInfoMap],
  );

  // 씬 그룹 빌드
  //
  // v1.19.6: sceneKey 단위 통합. buildSceneKey 가 부서 무관 키를 만들어 BG/ACT 가 같은 씬이면
  // 한 그룹에 두 부서 리비전이 모두 합산된다. allSceneKeys 에 BG·ACT 가 모두 push 되어도
  // sceneGroups 빌드 시 `seen.has(key)` 가드로 한 번만 그룹 생성.
  const sceneGroups = useMemo(() => {
    // 에피소드 필터링
    const filteredEps = selectedEp
      ? episodes.filter(ep => ep.episodeNumber === selectedEp)
      : episodes;

    // 에피소드별 씬 목록 수집 (BG/ACT 합산 → unique sceneKey 만 남김)
    const seenKey = new Set<string>();
    const allSceneKeys: string[] = [];
    for (const ep of filteredEps) {
      for (const part of ep.parts) {
        for (const scene of part.scenes) {
          const key = buildSceneKey(part.sheetName, scene.sceneId);
          if (seenKey.has(key)) continue;
          seenKey.add(key);
          allSceneKeys.push(key);
        }
      }
    }

    // 리비전을 sceneKey로 그룹핑 (검색·정렬 적용된 결과 기준)
    const revByScene = new Map<string, CompRevision[]>();
    for (const rev of searchedSorted) {
      const list = revByScene.get(rev.sceneKey) || [];
      list.push(rev);
      revByScene.set(rev.sceneKey, list);
    }

    // 그룹 빌드 (리비전이 있는 씬만)
    const groups: SceneGroup[] = [];
    const seen = new Set<string>();

    for (const key of allSceneKeys) {
      if (seen.has(key)) continue;
      seen.add(key);

      let sceneRevisions = revByScene.get(key) || [];
      if (sceneRevisions.length === 0) continue;

      // 상태 필터
      if (statusFilter !== 'all') {
        sceneRevisions = sceneRevisions.filter(r => r.status === statusFilter);
        if (sceneRevisions.length === 0) continue;
      }

      // 내 할 일 필터
      if (myTasksOnly && currentUser) {
        sceneRevisions = sceneRevisions.filter(
          r => r.assignee === currentUser.name || r.requesterName === currentUser.name,
        );
        if (sceneRevisions.length === 0) continue;
      }

      const info = sceneInfoMap.get(key);
      if (!info) {
        // sceneKey에 매칭되는 씬 데이터가 없는 경우 (삭제됐거나 다른 에피소드)
        const { ep, part, sceneId } = parseSceneKey(key);
        groups.push({
          sceneKey: key,
          info: {
            sceneKey: key,
            sceneId,
            sceneNo: 0,
            sceneName: `${ep} ${part}파트 #${sceneId}`,
            sheetName: '',
            part,
            department: 'bg',
            assignee: '',
          },
          revisions: sceneRevisions,
          openCount: sceneRevisions.filter(r => r.status !== 'resolved').length,
          uniqueRequesters: [...new Set(sceneRevisions.map(r => r.requesterName))],
        });
        continue;
      }

      groups.push({
        sceneKey: key,
        info,
        revisions: sceneRevisions,
        openCount: sceneRevisions.filter(r => r.status !== 'resolved').length,
        uniqueRequesters: [...new Set(sceneRevisions.map(r => r.requesterName))],
      });
    }

    // 또한, 선택된 에피소드에 속하지 않는 리비전도 표시 (selectedEp가 null일 때)
    if (selectedEp === null) {
      for (const [key, revs] of revByScene) {
        if (seen.has(key)) continue;
        seen.add(key);
        let sceneRevisions = [...revs];
        if (statusFilter !== 'all') {
          sceneRevisions = sceneRevisions.filter(r => r.status === statusFilter);
        }
        if (myTasksOnly && currentUser) {
          sceneRevisions = sceneRevisions.filter(
            r => r.assignee === currentUser.name || r.requesterName === currentUser.name,
          );
        }
        if (sceneRevisions.length === 0) continue;

        const { ep, part, sceneId } = parseSceneKey(key);
        groups.push({
          sceneKey: key,
          info: {
            sceneKey: key,
            sceneId,
            sceneNo: 0,
            sceneName: `${ep} ${part}파트 #${sceneId}`,
            sheetName: '',
            part,
            department: 'bg',
            assignee: '',
          },
          revisions: sceneRevisions,
          openCount: sceneRevisions.filter(r => r.status !== 'resolved').length,
          uniqueRequesters: [...new Set(sceneRevisions.map(r => r.requesterName))],
        });
      }
    }

    // 씬 번호 순 정렬 (미해결 많은 순 → 씬 번호 순)
    groups.sort((a, b) => {
      // 미해결 있는 것 먼저
      if (a.openCount > 0 && b.openCount === 0) return -1;
      if (a.openCount === 0 && b.openCount > 0) return 1;
      // 씬 번호 순
      return a.info.sceneNo - b.info.sceneNo;
    });

    return groups;
  }, [episodes, searchedSorted, selectedEp, statusFilter, myTasksOnly, currentUser, sceneInfoMap]);

  const visibleRevisions = useMemo(
    () => sceneGroups.flatMap((group) => group.revisions),
    [sceneGroups],
  );

  const feedbackTree = useMemo(
    () => buildFeedbackHubTree({ sceneGroups, episodes, getEpisodeDisplayName }),
    [sceneGroups, episodes, getEpisodeDisplayName],
  );

  // 통계
  const stats = useMemo(() => {
    const totalScenes = sceneGroups.length;
    const totalRevisions = visibleRevisions.length;
    return {
      totalScenes,
      totalRevisions,
      ...buildFeedbackHubStats({
        revisions: visibleRevisions,
        commentCountByRev: effectiveCommentCountByRev,
        currentUserName: currentUser?.name,
      }),
    };
  }, [sceneGroups.length, visibleRevisions, effectiveCommentCountByRev, currentUser?.name]);

  useEffect(() => {
    if (autoExpandedOnce || sceneGroups.length === 0) return;
    const openGroups = sceneGroups.filter((group) => group.openCount > 0);
    const groupsToOpen = openGroups.length > 0 ? openGroups : sceneGroups.slice(0, 8);
    setExpandedScenes(new Set(groupsToOpen.map((group) => group.sceneKey)));
    setAutoExpandedOnce(true);
  }, [autoExpandedOnce, sceneGroups]);

  useEffect(() => {
    if (!selectedRevisionId) return;
    if (visibleRevisions.some((revision) => revision.id === selectedRevisionId)) return;
    setSelectedRevisionId(null);
  }, [selectedRevisionId, visibleRevisions]);

  // v1.19.6: 표시되는 sheetName 집합으로 댓글 fetch → revisionId 기준 카운트 맵 빌드.
  // sceneGroups 의 info.sheetName 에서 unique 만 모아 loadPartComments 호출 (캐시되어 재호출은 가벼움).
  // BG↔ACT 통합 조회는 commentService 가 이미 처리하므로 한쪽만 호출해도 양쪽 댓글이 들어옴 → 중복 제거 필요.
  //
  // v1.19.7: dep 안정화 — sceneGroups 객체 ref 가 필터/검색 변경에도 갱신되어 N개 sheet 가 매번 재fetch 되던 것을
  // 정렬된 sheetName 키 문자열에 의존하도록 변경. (sheetName 에 콤마 없음이 보장되어 join(',') 안전.)
  const sheetNamesKey = useMemo(
    () =>
      Array.from(new Set(sceneGroups.map((g) => g.info.sheetName).filter(Boolean)))
        .sort()
        .join(','),
    [sceneGroups],
  );
  useEffect(() => {
    if (previewMode) {
      setCommentCountByRev(previewCommentCountByRev ?? new Map());
      return;
    }
    if (!sheetNamesKey) return;
    const sheetNames = sheetNamesKey.split(',');

    let cancelled = false;
    (async () => {
      try {
        const stores = await Promise.all(
          sheetNames.map((sn) => loadPartComments(sn).catch(() => ({}))),
        );
        if (cancelled) return;
        // revisionId → count (BG/ACT 통합 조회로 중복 들어올 수 있어 commentId 로 dedup)
        const seenCommentIds = new Set<string>();
        const counts = new Map<string, number>();
        for (const store of stores) {
          for (const list of Object.values(store)) {
            for (const c of list) {
              if (!c.revisionId) continue;
              if (seenCommentIds.has(c.id)) continue;
              seenCommentIds.add(c.id);
              counts.set(c.revisionId, (counts.get(c.revisionId) || 0) + 1);
            }
          }
        }
        setCommentCountByRev(counts);
      } catch (err) {
        if (!cancelled) console.warn('[CompositingView] 댓글 카운트 빌드 실패:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [sheetNamesKey, commentRefreshTick, previewMode, previewCommentCountByRev]);

  // 댓글 변경 이벤트 — 다른 창에서 댓글 추가/수정/삭제 시 카운트 재빌드.
  // commentService 가 invalidate 이벤트와 함께 캐시도 비우므로 다음 fetch 는 최신 데이터를 가져옴.
  useEffect(() => {
    const handler = () => setCommentRefreshTick((n) => n + 1);
    window.addEventListener('bflow:comments-invalidated', handler);
    return () => window.removeEventListener('bflow:comments-invalidated', handler);
  }, []);

  // 씬 토글
  const toggleScene = useCallback((sceneKey: string) => {
    setExpandedScenes(prev => {
      const next = new Set(prev);
      if (next.has(sceneKey)) next.delete(sceneKey);
      else next.add(sceneKey);
      return next;
    });
  }, []);

  // 모두 펼치기/접기
  const toggleAll = useCallback(() => {
    if (expandedScenes.size > 0) {
      setExpandedScenes(new Set());
    } else {
      const openGroups = sceneGroups.filter(g => g.openCount > 0);
      const groupsToOpen = openGroups.length > 0 ? openGroups : sceneGroups;
      setExpandedScenes(new Set(groupsToOpen.map(g => g.sceneKey)));
    }
  }, [expandedScenes.size, sceneGroups]);

  // 리비전 선택
  const handleSelectRevision = useCallback((rev: CompRevision) => {
    setSelectedRevisionId(prev => prev === rev.id ? null : rev.id);
  }, []);

  // 상태 변경
  const handleStatusChange = async (revId: string, sceneKey: string, status: RevisionStatus, note?: string) => {
    await updateStatus(revId, sceneKey, status, {
      resolvedBy: currentUser?.name,
      resolvedNote: note,
    });
  };

  return (
    <div className="h-full flex bg-bg-primary/40">
      {/* 좌측: 피드백 허브 */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* 헤더 */}
        <div className="shrink-0 px-6 pt-6 pb-4 space-y-3 border-b border-bg-border/25">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-text-primary">피드백 허브</h1>
                <span className="text-xs text-text-secondary">
                  {stats.totalScenes}개 씬 &middot; {stats.totalRevisions}개 피드백
                </span>
              </div>
              <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                씬별 피드백과 상태 흐름을 한 화면에서 정리합니다.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {groupMode === 'scene' && (
                <button
                  onClick={toggleAll}
                  className="compact-label-container inline-flex min-h-[34px] min-w-0 shrink items-center justify-center px-3 text-[11px] text-text-secondary hover:text-text-primary border border-bg-border rounded-lg transition-colors cursor-pointer"
                >
                  <CompactIconLabel
                    icon={<ListFilter size={12} strokeWidth={2.4} />}
                    label={expandedScenes.size > 0 ? '모두 접기' : '모두 펼치기'}
                  />
                </button>
              )}
              {/* v1.19.5: 헤더에서 직접 새 리비전 등록 */}
              <button
                onClick={() => setNewRevModalOpen(true)}
                className="compact-label-container min-h-[34px] inline-flex min-w-0 shrink items-center gap-1 px-3 text-[11px] font-bold rounded-md bg-accent text-white hover:opacity-90 transition-opacity cursor-pointer"
              >
                <CompactIconLabel icon={<Plus size={12} strokeWidth={2.5} />} label="새 피드백" />
              </button>
            </div>
          </div>

          {/* 검색 + 정렬 (Row 1) */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary/50" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="본문·씬·등록자·담당자 검색..."
                className="w-full min-h-[34px] pl-8 pr-3 bg-bg-primary/80 border border-bg-border/60 rounded-md text-[13px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/60"
              />
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="min-h-[34px] bg-bg-primary/80 border border-bg-border/60 rounded-md px-2 text-[12px] text-text-primary focus:outline-none focus:border-accent/60 cursor-pointer"
              >
                <option value="recent">최신순</option>
                <option value="oldest">오래된순</option>
                <option value="sceneNo">씬 번호순</option>
                <option value="comments">댓글 많은순</option>
              </select>
            </div>
            <div className="inline-flex min-h-[34px] bg-bg-primary rounded-lg p-1 gap-0.5 border border-bg-border/40 shrink-0">
              {([
                { key: 'scene' as const, label: '씬 트리', icon: <List size={12} strokeWidth={2.4} /> },
                { key: 'episode' as const, label: '에피소드별', icon: <Layers size={12} strokeWidth={2.4} /> },
                { key: 'progress' as const, label: '상태 보드', icon: <BarChart3 size={12} strokeWidth={2.4} /> },
              ]).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setGroupMode(key)}
                  className={`compact-label-container inline-flex min-w-0 shrink items-center justify-center px-3 text-[11px] rounded-md font-medium transition-all cursor-pointer ${
                    groupMode === key
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <CompactIconLabel icon={icon} label={label} />
                </button>
              ))}
            </div>
          </div>

          {/* 에피소드 필터 */}
          <EpisodeFilter episodes={episodes} selected={selectedEp} onSelect={setSelectedEp} />

          {/* 필터 바 */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* 상태 필터 */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-primary/50">
              {([
                { key: 'all' as const, label: '전체', icon: <Circle size={11} strokeWidth={2.4} /> },
                { key: 'open' as const, label: '대기', icon: <Clock size={11} strokeWidth={2.4} /> },
                { key: 'in_progress' as const, label: '진행중', icon: <PlayCircle size={11} strokeWidth={2.4} /> },
                { key: 'resolved' as const, label: '완료', icon: <CheckCircle2 size={11} strokeWidth={2.4} /> },
              ]).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`compact-label-container inline-flex min-w-0 shrink items-center justify-center px-2.5 py-1 text-[11px] rounded-md font-medium transition-all cursor-pointer ${
                    statusFilter === key
                      ? 'bg-accent/20 text-accent shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  <CompactIconLabel icon={icon} label={label} />
                </button>
              ))}
            </div>

            {/* 내 할 일 */}
            <button
              onClick={() => setMyTasksOnly(!myTasksOnly)}
              className={`compact-label-container flex min-w-0 shrink items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg border transition-all cursor-pointer ${
                myTasksOnly
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-bg-border text-text-secondary hover:text-text-primary'
              }`}
            >
              <CompactIconLabel icon={<ListFilter size={12} />} label={`내 관련 ${stats.myRelated}`} />
            </button>

            {stats.totalOpen > 0 && (
              <span
                className="text-[11px] font-medium rounded-full px-2.5 py-1"
                style={{ color: '#FDCB6E', backgroundColor: 'rgba(253, 203, 110, 0.12)' }}
              >
                {stats.totalOpen}건 미해결
              </span>
            )}
          </div>
        </div>

        {/* 피드백 목록 */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && revisions.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-text-secondary/50 text-sm">
              로딩 중...
            </div>
          ) : sceneGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-secondary/50">
              <Filter size={32} className="mb-3" />
              <p className="text-sm">피드백이 있는 씬이 없습니다</p>
              <p className="text-xs mt-1">씬 상세에서 수정 요청을 등록해보세요</p>
            </div>
          ) : groupMode === 'scene' ? (
            <FeedbackTreeSection
              episodeTrees={feedbackTree}
              expandedScenes={expandedScenes}
              selectedRevisionId={selectedRevisionId}
              commentCountByRev={effectiveCommentCountByRev}
              commentSeenByRev={effectiveCommentSeenByRev}
              onToggleScene={toggleScene}
              onSelectRevision={handleSelectRevision}
              onStatusChange={handleStatusChange}
            />
          ) : groupMode === 'episode' ? (
            <EpisodeGroupSection
              sceneGroups={sceneGroups}
              episodes={episodes}
              expandedScenes={expandedScenes}
              selectedRevisionId={selectedRevisionId}
              commentCountByRev={effectiveCommentCountByRev}
              commentSeenByRev={effectiveCommentSeenByRev}
              onSelectRevision={handleSelectRevision}
              onToggleScene={toggleScene}
            />
          ) : (
            // 코덱스 P2 fix (10차, 2026-05-05): 진행률별 모드도 sceneGroups 의 필터 적용된 리비전들을 사용.
            // searchedSorted 는 검색/정렬만 반영하고 selectedEp/statusFilter/myTasksOnly 무시 →
            // 사용자가 EP/상태/내할일 토글 후 진행률별 보기로 전환하면 무관한 리비전이 보임.
            <ProgressKanbanSection
              revisions={visibleRevisions}
              sceneInfoMap={sceneInfoMap}
              selectedRevisionId={selectedRevisionId}
              commentCountByRev={effectiveCommentCountByRev}
              commentSeenByRev={effectiveCommentSeenByRev}
              onSelectRevision={handleSelectRevision}
            />
          )}
        </div>
      </div>

      {/* 우측: 피드백 상세 패널 */}
      <AnimatePresence>
        {selectedRevision && (
          <DetailPanel
            key={selectedRevision.id}
            revision={selectedRevision}
            sceneInfo={selectedRevisionSceneInfo}
            onClose={() => setSelectedRevisionId(null)}
            onStatusChange={(status, note) =>
              handleStatusChange(selectedRevision.id, selectedRevision.sceneKey, status, note)
            }
          />
        )}
      </AnimatePresence>

      {/* v1.19.5: 새 리비전 등록 모달 (중앙) */}
      <NewRevisionModal
        open={newRevModalOpen}
        onClose={() => setNewRevModalOpen(false)}
      />
    </div>
  );
}
