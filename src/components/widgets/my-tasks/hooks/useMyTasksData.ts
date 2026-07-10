import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAllEpisodesFlat } from './useAllEpisodesFlat';
import type { Stage, Scene, Episode } from '@/types';
import {
  buildSequentialStagePatch,
  enqueueSequentialStageSave,
  getChangedSequentialStages,
  isSequentialStageComplete,
  persistSequentialStagePatchWithRollback,
  SEQUENTIAL_STAGE_ORDER,
} from '@/utils/sceneStageProgression';
import * as supabaseService from '@/services/supabaseService';
import type { CharacterTaskItem, SceneKey, PersonalTodo, PersonalTodoLabel, FlatScene, StageSaveBaseline, PersonalTodoStatus } from '../types';
import { createStageSaveBaseline } from '../types';
import { computeMyTasksStats } from '../statsUtils';
import type { MyTasksStats } from '../statsUtils';
import { hasPersonalTodoMigrationRun } from '../personalTodoMigration';
import { useMyCharacterTasks } from './useMyCharacterTasks';
import { usePersonalTodos } from './usePersonalTodos';
import type { PersonalTodoSyncState } from '../components/TodoMetadata';

const SAVE_FAIL_MESSAGE = '저장에 실패했어요. 잠시 후 다시 시도해주세요.';

/* ─── 유틸 ─────────────────────────────────── */
export function scenePct(s: Scene): number {
  return ([s.lo, s.done, s.review, s.png].filter(Boolean).length / 4) * 100;
}

// Legacy domain normalization is now inside usePersonalTodos. Historical
// import { normalizePersonalTodo } from '../personalTodoDomain';
// contract: return rows.map(normalizePersonalTodo);

/* ─── assigned 씬 키 퍼시스턴스 ─────────────────────────── */
async function loadAssignedSceneKeysFromSupabase(userId: string): Promise<SceneKey[] | null> {
  try {
    void userId;
    const data = await supabaseService.readTaskViews();
    return data ? data.assignedSceneKeys as SceneKey[] : [];
  } catch (err) {
    console.error('[MyTasks] Supabase 씬키 로드 실패:', err);
    return null;
  }
}

async function saveAssignedSceneKeysToSupabase(userId: string, sceneKeys: SceneKey[]): Promise<void> {
  try {
    void userId;
    const migrationReady = typeof localStorage !== 'undefined' && hasPersonalTodoMigrationRun(localStorage, userId);
    if (migrationReady) {
      await supabaseService.upsertTaskViews([], sceneKeys);
      return;
    }
    // Legacy personalTodos must survive until the canonical migration marker is
    // written. Read/merge the existing views instead of clearing them early.
    const existing = await supabaseService.readTaskViews();
    await supabaseService.upsertTaskViews(existing?.views ?? [], sceneKeys);
  } catch (err) {
    console.error('[MyTasks] 씬키 저장 실패:', err);
    throw err;
  }
}

export interface UseMyTasksDataResult {
  // 에피소드 (할일 추가 모달용 — 전체 에피소드)
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  // 사용자/로딩 상태
  currentUser: ReturnType<typeof useAuthStore.getState>['currentUser'];
  loadTimedOut: boolean;
  // 파생 상태
  /** 전체 에피소드 평탄화(QuickAdd 자동완성 후보용 — 재구독 회피) */
  allFlat: FlatScene[];
  allViewScenes: FlatScene[];
  pendingScenes: FlatScene[];
  doneScenes: FlatScene[];
  activePersonalTodos: PersonalTodo[];
  personalTodoLabels: PersonalTodoLabel[];
  pinnedPersonalTodos: PersonalTodo[];
  normalPersonalTodos: PersonalTodo[];
  personalTodoSyncState: PersonalTodoSyncState;
  pendingPersonalTodos: PersonalTodo[];
  donePersonalTodos: PersonalTodo[];
  pendingCharacterTasks: CharacterTaskItem[];
  doneCharacterTasks: CharacterTaskItem[];
  stats: MyTasksStats;
  existingKeys: Set<SceneKey>;
  assignedSceneKeySet: Set<SceneKey>;
  highlightTodoId: string | null;
  // 핸들러
  handleSceneToggle: (flat: FlatScene, stage: Stage) => Promise<void>;
  handleEditField: (flat: FlatScene, field: string, value: string) => Promise<void>;
  addScenes: (keys: SceneKey[]) => void;
  removeScene: (key: SceneKey) => void;
  addPersonalTodo: (todo: PersonalTodo) => Promise<void>;
  togglePersonalTodo: (todoId: string) => void;
  removePersonalTodo: (todoId: string) => Promise<void>;
  reorderPendingTodos: (reordered: PersonalTodo[]) => void;
  reorderPinnedTodos: (reordered: PersonalTodo[]) => void;
  updatePersonalTodo: (todoId: string, updates: Partial<PersonalTodo>) => Promise<void>;
  setPersonalTodoStatus: (todoId: string, status: PersonalTodoStatus) => Promise<boolean>;
  setPersonalTodoPinned: (todoId: string, pinned: boolean) => Promise<void>;
  retryPersonalTodoSync: () => Promise<void>;
}

/**
 * '나의 할일' 위젯의 데이터/동기화 로직 훅.
 *
 * 커스텀 뷰(탭)는 제거되어 assigned(내 할일) 단일 뷰만 다룬다.
 * 개인 할일 CRUD/순서변경, 씬 단계 순차 토글, 캘린더 양방향 동기화,
 * 크로스 창 동기화, 낙관적 업데이트/롤백, ptodo_→UUID ID 교체를 모두 포함한다.
 */
export function useMyTasksData(isPopup: boolean): UseMyTasksDataResult {
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const episodes = useDataStore((s) => s.episodes);
  const updateSceneFieldOptimistic = useDataStore((s) => s.updateSceneFieldOptimistic);
  const currentUser = useAuthStore((s) => s.currentUser);
  const { pendingCharacterTasks, doneCharacterTasks } = useMyCharacterTasks();
  const personalTodos = usePersonalTodos();

  const stageSaveQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const stageSaveBaselineRef = useRef<Map<string, StageSaveBaseline>>(new Map());

  // 데이터 변경 알림: 팝업에서는 쿨다운 래퍼, 대시보드에서는 직접 호출
  const notifyChange = useCallback(async () => {
    if (isPopup) {
      const { notifyDataChangeWithCooldown } = await import('@/views/WidgetPopup');
      return notifyDataChangeWithCooldown();
    }
    return window.electronAPI?.dataNotifyChange?.();
  }, [isPopup]);

  // assigned 뷰에서 수동으로 추가한 씬 키
  const [assignedSceneKeys, setAssignedSceneKeys] = useState<SceneKey[]>([]);

  // 플로팅 위젯에서 메인 세션 수신 실패 시 안내 메시지 표시 (10초 타임아웃)
  const [loadTimedOut, setLoadTimedOut] = useState(false);

  // Supabase 초기화 완료 여부 (save effect에서 초기화 전 저장 방지)
  const _supabaseInitialized = useRef(false);

  // 외부(IPC)에서 받은 변경인지 추적 — 0 초과이면 브로드캐스트 스킵 (카운터로 중첩 안전)
  const _externalDepth = useRef(0);
  const broadcastTodoChange = useCallback(() => {
    if (_externalDepth.current > 0) return;
    if (isPopup) {
      import('@/views/WidgetPopup').then(() => {
        // 팝업에서는 쿨다운 없이 직접 notify (todo는 데이터 변경이 아님)
        window.electronAPI?.dataNotifyChange?.({ type: 'todo' } as import('@/types').SheetDeltaTodo);
      });
    } else {
      window.electronAPI?.dataNotifyChange?.({ type: 'todo' } as import('@/types').SheetDeltaTodo);
    }
  }, [isPopup]);

  // 플로팅 위젯에서 currentUser가 10초 내에 수신되지 않으면 안내 메시지로 전환
  useEffect(() => {
    if (currentUser) {
      setLoadTimedOut(false);
      return;
    }
    const timer = setTimeout(() => setLoadTimedOut(true), 10_000);
    return () => clearTimeout(timer);
  }, [currentUser]);

  // assigned 씬 키 로드. 개인 할일은 usePersonalTodos가 단일 소유한다.
  useEffect(() => {
    if (!currentUser?.id) return;
    _supabaseInitialized.current = false;
    _externalDepth.current++;
    setAssignedSceneKeys([]);
    requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });
    const userId = currentUser.id;
    loadAssignedSceneKeysFromSupabase(userId).then((sceneKeys) => {
      if (sceneKeys === null || useAuthStore.getState().currentUser?.id !== userId) return;
      _externalDepth.current++;
      setAssignedSceneKeys(sceneKeys);
      requestAnimationFrame(() => {
        _externalDepth.current = Math.max(0, _externalDepth.current - 1);
        if (useAuthStore.getState().currentUser?.id === userId) _supabaseInitialized.current = true;
      });
    });
    return () => {
      _supabaseInitialized.current = false;
    };
  }, [currentUser?.id]);

  // Supabase 저장: 씬키 변경 시 Supabase에 반영
  useEffect(() => {
    if (!_supabaseInitialized.current || !currentUser?.id) return;
    if (_externalDepth.current > 0) return;
    const userId = currentUser.id;
    saveAssignedSceneKeysToSupabase(userId, assignedSceneKeys).catch((err) => {
      const msg = String(err);
      if (!msg.includes('foreign key constraint')) {
        console.error('[MyTasks] 씬키 저장 실패:', err);
        toast.error(SAVE_FAIL_MESSAGE);
      }
    });
    broadcastTodoChange();
  }, [assignedSceneKeys]);

  // 전체 평탄화 (전체 에피소드 — EP 스코핑 영향 없음)
  const allFlat = useAllEpisodesFlat();

  // assigned 뷰에 해당하는 씬 (정렬만)
  const allViewScenes = useMemo(() => {
    const name = currentUser?.name ?? '';
    const manualKeys = new Set(assignedSceneKeys);
    const result = allFlat.filter((f) => {
      if (manualKeys.has(f.key)) return true;
      if (!name || !f.scene.assignee) return false;
      return f.scene.assignee.split(',').some((s) => s.trim() === name);
    });
    return result.sort((a, b) => {
      if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
      if (a.partId !== b.partId) return a.partId.localeCompare(b.partId);
      const aNum = parseInt(a.scene.sceneId.match(/\d+$/)?.[0] || '0', 10);
      const bNum = parseInt(b.scene.sceneId.match(/\d+$/)?.[0] || '0', 10);
      return aNum - bNum;
    });
  }, [allFlat, currentUser, assignedSceneKeys]);

  // 진행 중 / 완료 분리
  const pendingScenes = useMemo(() => allViewScenes.filter((f) => scenePct(f.scene) < 100), [allViewScenes]);
  const doneScenes = useMemo(() => allViewScenes.filter((f) => scenePct(f.scene) >= 100), [allViewScenes]);

  // 활성 뷰의 개인 할일
  const activePersonalTodos = personalTodos.todos;
  const pendingPersonalTodos = personalTodos.todos.filter((todo) => todo.status !== 'done');
  const donePersonalTodos = personalTodos.doneTodos;
  const personalTodoSyncState: PersonalTodoSyncState = personalTodos.loading
    ? 'pending'
    : personalTodos.syncNeeded
      ? 'sync-needed'
      : 'idle';

  // 통계는 순수 함수(statsUtils)로 위임 — 단계별/오늘 마친 씬 포함, 단위 테스트로 회귀 보호.
  // done/pending 분리는 함수 내부에서 하므로 allViewScenes + activePersonalTodos 만 넘긴다.
  // new Date()는 deps에 없다 → '오늘 마친 씬' 카운트의 자정 롤오버는 다음 데이터 변경
  // (토글/추가/realtime 수신) 시 갱신된다. B flow는 변경이 잦아 실사용 영향은 미미.
  const stats = useMemo(
    () => computeMyTasksStats(allViewScenes, activePersonalTodos, new Date(), [...pendingCharacterTasks, ...doneCharacterTasks]),
    [allViewScenes, activePersonalTodos, doneCharacterTasks, pendingCharacterTasks],
  );

  // 토글 핸들러 (씬 단계 순차 토글)
  const handleSceneToggle = useCallback(async (flat: FlatScene, stage: Stage) => {
    const { sheetName, scene, sceneIndex } = flat;
    const stagePatch = buildSequentialStagePatch(scene, stage);
    const changedStages = getChangedSequentialStages(scene, stagePatch);
    if (changedStages.length === 0) return;
    const saveQueueKey = scene.id ?? `${sheetName}:${scene.sceneId}`;
    if (!stageSaveQueueRef.current.has(saveQueueKey) && !stageSaveBaselineRef.current.has(saveQueueKey)) {
      stageSaveBaselineRef.current.set(saveQueueKey, createStageSaveBaseline(scene));
    }

    SEQUENTIAL_STAGE_ORDER.forEach((changedStage) => {
      updateSceneFieldOptimistic(sheetName, sceneIndex, changedStage, String(stagePatch[changedStage]));
    });

    const buildCompletionMeta = (previousScene: Scene | StageSaveBaseline) => {
      const prevCompletedBy = previousScene.completedBy ?? '';
      const prevCompletedAt = previousScene.completedAt ?? '';
      const wasAllDone = isSequentialStageComplete(previousScene);
      const willBeAllDone = isSequentialStageComplete(stagePatch);

      if (!wasAllDone && willBeAllDone) {
        return {
          nextCompletedBy: currentUser?.name ?? '알 수 없음',
          nextCompletedAt: new Date().toISOString(),
          prevCompletedBy,
          prevCompletedAt,
        };
      }
      if (!wasAllDone || willBeAllDone) return null;
      if (!prevCompletedBy && !prevCompletedAt) return null;
      return {
        nextCompletedBy: '',
        nextCompletedAt: '',
        prevCompletedBy,
        prevCompletedAt,
      };
    };

    const immediateCompletionMeta = buildCompletionMeta(scene);

    if (immediateCompletionMeta) {
      updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedBy', immediateCompletionMeta.nextCompletedBy);
      updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedAt', immediateCompletionMeta.nextCompletedAt);
    }

    const queuedSave = enqueueSequentialStageSave(stageSaveQueueRef.current, saveQueueKey, async () => {
      const previousBaseline = stageSaveBaselineRef.current.get(saveQueueKey) ?? createStageSaveBaseline(scene);
      const queuedChangedStages = getChangedSequentialStages(previousBaseline, stagePatch);
      const queuedCompletionMeta = buildCompletionMeta(previousBaseline);

      SEQUENTIAL_STAGE_ORDER.forEach((changedStage) => {
        updateSceneFieldOptimistic(sheetName, sceneIndex, changedStage, String(stagePatch[changedStage]));
      });
      if (queuedCompletionMeta) {
        updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedBy', queuedCompletionMeta.nextCompletedBy);
        updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedAt', queuedCompletionMeta.nextCompletedAt);
      }

      if (queuedChangedStages.length === 0 && !queuedCompletionMeta) return;

      try {
        const { updateCell, updateSceneCompletionMeta } = await import('@/services/supabaseService');
        if (queuedChangedStages.length > 0) {
          await persistSequentialStagePatchWithRollback(queuedChangedStages, stagePatch, previousBaseline, (changedStage, value) =>
            updateCell(sheetName, sceneIndex, changedStage, value, currentUser?.id),
          );
        }
        if (queuedCompletionMeta) {
          await updateSceneCompletionMeta(
            sheetName,
            sceneIndex,
            queuedCompletionMeta.nextCompletedBy && queuedCompletionMeta.nextCompletedAt
              ? {
                  completedBy: queuedCompletionMeta.nextCompletedBy,
                  completedAt: queuedCompletionMeta.nextCompletedAt,
                }
              : null,
          ).catch(() => {});
        }
        stageSaveBaselineRef.current.set(saveQueueKey, {
          ...createStageSaveBaseline(previousBaseline),
          ...stagePatch,
          completedBy: queuedCompletionMeta?.nextCompletedBy ?? previousBaseline.completedBy,
          completedAt: queuedCompletionMeta?.nextCompletedAt ?? previousBaseline.completedAt,
        });
        notifyChange();
      } catch (err) {
        console.error('[MyTasks 토글 실패]', err);
        toast.error(SAVE_FAIL_MESSAGE);
        stageSaveBaselineRef.current.set(saveQueueKey, previousBaseline);
        SEQUENTIAL_STAGE_ORDER.forEach((changedStage) => {
          updateSceneFieldOptimistic(sheetName, sceneIndex, changedStage, String(Boolean(previousBaseline[changedStage])));
        });
        if (queuedCompletionMeta) {
          updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedBy', queuedCompletionMeta.prevCompletedBy);
          updateSceneFieldOptimistic(sheetName, sceneIndex, 'completedAt', queuedCompletionMeta.prevCompletedAt);
        }
      }
    });
    await queuedSave;
    if (!stageSaveQueueRef.current.has(saveQueueKey)) {
      stageSaveBaselineRef.current.delete(saveQueueKey);
    }
  }, [updateSceneFieldOptimistic, currentUser, notifyChange]);

  // 인라인 필드 편집
  const handleEditField = useCallback(async (flat: FlatScene, field: string, value: string) => {
    const { sheetName, sceneIndex } = flat;
    updateSceneFieldOptimistic(sheetName, sceneIndex, field, value);

    try {
      const { updateSceneField } = await import('@/services/supabaseService');
      await updateSceneField(sheetName, sceneIndex, field, value);
      notifyChange();
    } catch (err) {
      console.error('[MyTasks 편집 실패]', err);
      toast.error(SAVE_FAIL_MESSAGE);
    }
  }, [updateSceneFieldOptimistic, notifyChange]);

  // 씬 추가/제거 (assigned 뷰 — 수동 씬 키)
  const addScenes = useCallback((keys: SceneKey[]) => {
    setAssignedSceneKeys((prev) => [...new Set([...prev, ...keys])]);
  }, []);
  const removeScene = useCallback((key: SceneKey) => {
    setAssignedSceneKeys((prev) => prev.filter((k) => k !== key));
  }, []);

  const existingKeys = useMemo(() => {
    const keys = new Set(assignedSceneKeys);
    allViewScenes.forEach((f) => keys.add(f.key));
    return keys;
  }, [assignedSceneKeys, allViewScenes]);

  // ─── 개인 할일 어댑터 ─────────────────────
  // 저장·낙관적 업데이트·캘린더 동기화는 usePersonalTodos가 단일 소유한다.
  // usePersonalTodos가 onPersonalTodoCommit/PersonalTodoLoadGate 경계를 소비하고
  // applyCalendarToTodoPatch를 통해 DB 허용 필드만 반영한다. 여기서는
  // payload.userId === currentUser?.id인 경우만 기존 위젯 알림을 보낸다.
  const addPersonalTodo = useCallback(async (todo: PersonalTodo) => {
    await personalTodos.addTodo(todo);
    broadcastTodoChange();
  }, [broadcastTodoChange, personalTodos.addTodo]);

  const togglePersonalTodo = useCallback((todoId: string) => {
    const todo = personalTodos.todos.find((item) => item.id === todoId);
    if (!todo) return;
    const nextStatus = todo.status === 'todo' ? 'doing' : todo.status === 'doing' ? 'done' : 'todo';
    void personalTodos.setStatus(todoId, nextStatus);
  }, [personalTodos.setStatus, personalTodos.todos]);

  const removePersonalTodo = useCallback(async (todoId: string) => {
    await personalTodos.deleteTodo(todoId);
    broadcastTodoChange();
  }, [broadcastTodoChange, personalTodos.deleteTodo]);

  const reorderPendingTodos = useCallback((reordered: PersonalTodo[]) => {
    void personalTodos.reorderGroup('normal', reordered);
  }, [personalTodos.reorderGroup]);
  const reorderPinnedTodos = useCallback((reordered: PersonalTodo[]) => {
    void personalTodos.reorderGroup('pinned', reordered);
  }, [personalTodos.reorderGroup]);

  const setPersonalTodoStatus = useCallback(async (todoId: string, status: PersonalTodoStatus) => {
    const committed = await personalTodos.setStatus(todoId, status);
    broadcastTodoChange();
    return committed;
  }, [broadcastTodoChange, personalTodos.setStatus]);

  const setPersonalTodoPinned = useCallback(async (todoId: string, pinned: boolean) => {
    await personalTodos.setPinned(todoId, pinned);
    broadcastTodoChange();
  }, [broadcastTodoChange, personalTodos.setPinned]);

  const updatePersonalTodo = useCallback(async (todoId: string, updates: Partial<PersonalTodo>) => {
    await personalTodos.patchTodo(todoId, updates);
    broadcastTodoChange();
  }, [broadcastTodoChange, personalTodos.patchTodo]);

  // 캘린더 → 할일 네비게이션: 해당 할일 하이라이트
  const [highlightTodoId, setHighlightTodoId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const todoId = (e as CustomEvent).detail?.todoId;
      if (!todoId) return;
      // 하이라이트
      setHighlightTodoId(todoId);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightTodoId(null), 3000);
    };
    window.addEventListener('bflow:navigate-to-todo', handler);
    return () => {
      window.removeEventListener('bflow:navigate-to-todo', handler);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // assigned 뷰에서 수동 추가된 씬 키 Set
  const assignedSceneKeySet = useMemo(() => new Set(assignedSceneKeys), [assignedSceneKeys]);

  return {
    episodes,
    episodeTitles,
    currentUser,
    loadTimedOut,
    allFlat,
    allViewScenes,
    pendingScenes,
    doneScenes,
    activePersonalTodos,
    personalTodoLabels: personalTodos.labels,
    pinnedPersonalTodos: personalTodos.pinnedTodos,
    normalPersonalTodos: personalTodos.normalTodos,
    personalTodoSyncState,
    pendingPersonalTodos,
    donePersonalTodos,
    pendingCharacterTasks,
    doneCharacterTasks,
    stats,
    existingKeys,
    assignedSceneKeySet,
    highlightTodoId,
    handleSceneToggle,
    handleEditField,
    addScenes,
    removeScene,
    addPersonalTodo,
    togglePersonalTodo,
    removePersonalTodo,
    reorderPendingTodos,
    reorderPinnedTodos,
    updatePersonalTodo,
    setPersonalTodoStatus,
    setPersonalTodoPinned,
    retryPersonalTodoSync: personalTodos.retrySync,
  };
}
