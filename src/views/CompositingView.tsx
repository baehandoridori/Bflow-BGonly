import { useState, useEffect, useMemo, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Filter, ListFilter } from 'lucide-react';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { setRevisionsSheetsMode, buildSceneKey } from '@/services/revisionService';
import type { CompRevision, RevisionStatus } from '@/types';
import { parseSceneKey } from './compositing/utils';
import type { SceneInfo, SceneGroup } from './compositing/utils';
import { SceneRow, EpisodeFilter } from './compositing/SceneGroupSection';
import { DetailPanel } from './compositing/RevisionDetailPanel';

// ─── 메인 뷰 ─────────────────────────────────

export default function CompositingView() {
  const { currentUser } = useAuthStore();
  const dataConnected = useAppStore((s) => s.dataConnected);
  const episodes = useDataStore((s) => s.episodes);
  const { revisions, loadRevisions, updateStatus, isLoading } = useRevisionStore();

  const [selectedEp, setSelectedEp] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | RevisionStatus>('all');
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);

  // 선택된 리비전 객체
  const selectedRevision = useMemo(
    () => selectedRevisionId ? revisions.find(r => r.id === selectedRevisionId) ?? null : null,
    [revisions, selectedRevisionId],
  );

  useEffect(() => {
    setRevisionsSheetsMode(dataConnected);
    loadRevisions();
  }, [dataConnected, loadRevisions]);

  // 씬 정보 맵 빌드 (에피소드 데이터 + 리비전 sceneKey 매칭)
  const sceneInfoMap = useMemo(() => {
    const map = new Map<string, SceneInfo>();
    for (const ep of episodes) {
      for (const part of ep.parts) {
        for (const scene of part.scenes) {
          const sceneKey = buildSceneKey(part.sheetName, scene.sceneId);
          const nextInfo = {
            sceneKey,
            sceneId: scene.sceneId,
            sceneNo: scene.no,
            sceneName: scene.memo,
            sheetName: part.sheetName,
            part: part.partId,
            department: part.department as 'bg' | 'acting',
            assignee: scene.assignee,
          };
          const existing = map.get(sceneKey);
          if (!existing || (existing.department !== 'bg' && nextInfo.department === 'bg')) {
            map.set(sceneKey, nextInfo);
          }
        }
      }
    }
    return map;
  }, [episodes]);

  // 선택된 리비전의 씬 정보
  const selectedRevisionSceneInfo = useMemo(
    () => selectedRevision ? sceneInfoMap.get(selectedRevision.sceneKey) ?? null : null,
    [selectedRevision, sceneInfoMap],
  );

  // 씬 그룹 빌드
  const sceneGroups = useMemo(() => {
    // 에피소드 필터링
    const filteredEps = selectedEp
      ? episodes.filter(ep => ep.episodeNumber === selectedEp)
      : episodes;

    // 에피소드별 씬 목록 수집
    const allSceneKeys: string[] = [];
    for (const ep of filteredEps) {
      for (const part of ep.parts) {
        for (const scene of part.scenes) {
          const key = buildSceneKey(part.sheetName, scene.sceneId);
          allSceneKeys.push(key);
        }
      }
    }

    // 리비전을 sceneKey로 그룹핑
    const revByScene = new Map<string, CompRevision[]>();
    for (const rev of revisions) {
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
  }, [episodes, revisions, selectedEp, statusFilter, myTasksOnly, currentUser, sceneInfoMap]);

  // 통계
  const stats = useMemo(() => {
    const totalScenes = sceneGroups.length;
    const totalRevisions = sceneGroups.reduce((acc, g) => acc + g.revisions.length, 0);
    const totalOpen = revisions.filter(r => r.status !== 'resolved').length;
    return { totalScenes, totalRevisions, totalOpen };
  }, [sceneGroups, revisions]);

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
      setExpandedScenes(new Set(sceneGroups.filter(g => g.openCount > 0).map(g => g.sceneKey)));
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
    <div className="h-full flex">
      {/* 좌측: 씬 타임라인 */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* 헤더 */}
        <div className="shrink-0 px-6 pt-6 pb-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-text-primary">씬 타임라인</h1>
              <span className="text-xs text-text-secondary">
                {stats.totalScenes}개 씬 &middot; {stats.totalRevisions}개 피드백
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleAll}
                className="px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary border border-bg-border rounded-lg transition-colors cursor-pointer"
              >
                {expandedScenes.size > 0 ? '모두 접기' : '모두 펼치기'}
              </button>
            </div>
          </div>

          {/* 에피소드 필터 */}
          <EpisodeFilter episodes={episodes} selected={selectedEp} onSelect={setSelectedEp} />

          {/* 필터 바 */}
          <div className="flex items-center gap-3">
            {/* 상태 필터 */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-bg-primary/50">
              {([
                { key: 'all' as const, label: '전체' },
                { key: 'open' as const, label: '대기' },
                { key: 'in_progress' as const, label: '진행중' },
                { key: 'resolved' as const, label: '해결' },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`px-2.5 py-1 text-[11px] rounded-md font-medium transition-all cursor-pointer ${
                    statusFilter === key
                      ? 'bg-accent/20 text-accent shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 내 할 일 */}
            <button
              onClick={() => setMyTasksOnly(!myTasksOnly)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg border transition-all cursor-pointer ${
                myTasksOnly
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-bg-border text-text-secondary hover:text-text-primary'
              }`}
            >
              <ListFilter size={12} />
              내 할 일
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

        {/* 씬 타임라인 목록 */}
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
          ) : (
            <div className="divide-y divide-bg-border/20">
              {sceneGroups.map((group) => (
                <SceneRow
                  key={group.sceneKey}
                  group={group}
                  expanded={expandedScenes.has(group.sceneKey)}
                  selectedRevisionId={selectedRevisionId}
                  onToggle={() => toggleScene(group.sceneKey)}
                  onSelectRevision={handleSelectRevision}
                  onStatusChange={handleStatusChange}
                />
              ))}
            </div>
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
    </div>
  );
}
