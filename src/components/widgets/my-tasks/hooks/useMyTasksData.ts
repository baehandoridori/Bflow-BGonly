import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAllEpisodesFlat } from './useAllEpisodesFlat';
import type { Stage, Scene, Episode } from '@/types';
import { createUuid } from '@/utils/createUuid';
import {
  buildSequentialStagePatch,
  enqueueSequentialStageSave,
  getChangedSequentialStages,
  isSequentialStageComplete,
  persistSequentialStagePatchWithRollback,
  SEQUENTIAL_STAGE_ORDER,
} from '@/utils/sceneStageProgression';
import {
  updateEvent as updateCalEvent,
  deleteEvent as deleteCalEvent,
  addEvent as addCalEvent,
  findEventByTodoId,
} from '@/services/calendarService';
import * as supabaseService from '@/services/supabaseService';
import type { SceneKey, PersonalTodo, TaskView, FlatScene, StageSaveBaseline } from '../types';
import { createStageSaveBaseline } from '../types';

const SAVE_FAIL_MESSAGE = '저장에 실패했어요. 잠시 후 다시 시도해주세요.';

/* ─── 유틸 ─────────────────────────────────── */
export function scenePct(s: Scene): number {
  return ([s.lo, s.done, s.review, s.png].filter(Boolean).length / 4) * 100;
}

/* ─── 커스텀 뷰 퍼시스턴스 (마이그레이션 전용) ──────────────────── */
const ASSIGNED_TODOS_KEY = 'bflow_assigned_personal_todos';
const ASSIGNED_SCENES_KEY = 'bflow_assigned_scene_keys';
const VIEWS_KEY = 'bflow_my_task_views';
const MIGRATION_DONE_KEY = 'bflow_migration_todos_done';
// 커스텀 뷰 제거(PR 1) 이후, 기존 task_views.views 에 남아 있던 커스텀 뷰 개인 할일을
// '내 할일'로 한 번만 옮기기 위한 마커
const CUSTOM_VIEW_TODOS_MIGRATED_KEY = 'bflow_customview_todos_migrated';

/* ─── Supabase 기반 로드/저장 함수 ──────────── */

async function loadTodosFromSupabase(userId: string): Promise<PersonalTodo[] | null> {
  try {
    const rows = await supabaseService.readTodos(userId);
    return rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      memo: r.memo,
      completed: r.completed,
      createdAt: r.createdAt,
      startDate: r.startDate ?? undefined,
      endDate: r.endDate ?? undefined,
      addToCalendar: r.addToCalendar,
    }));
  } catch (err) {
    console.error('[MyTasks] Supabase 할일 로드 실패:', err);
    return null;
  }
}

/** Supabase에 할일 저장. 서버에서 확정된 UUID를 반환 (로컬 ID가 ptodo_* 등이면 새 UUID 생성) */
async function saveTodoToSupabase(userId: string, todo: PersonalTodo, sortOrder?: number): Promise<string> {
  return supabaseService.upsertTodo(userId, {
    id: todo.id,
    title: todo.title,
    memo: todo.memo,
    completed: todo.completed,
    startDate: todo.startDate ?? null,
    endDate: todo.endDate ?? null,
    addToCalendar: todo.addToCalendar,
    sortOrder: sortOrder ?? 0,
    createdAt: todo.createdAt,
  });
}

async function deleteTodoFromSupabase(todoId: string): Promise<void> {
  await supabaseService.deleteTodo(todoId);
}

/** assigned 뷰에서 수동 추가한 씬 키만 저장 (기존 커스텀뷰 todos는 init에서 마이그레이션 후 비움) */
async function loadAssignedSceneKeysFromSupabase(userId: string): Promise<SceneKey[] | null> {
  try {
    const data = await supabaseService.readTaskViews(userId);
    if (!data) return [];
    return data.assignedSceneKeys as SceneKey[];
  } catch (err) {
    console.error('[MyTasks] Supabase 씬키 로드 실패:', err);
    return null;
  }
}

async function saveAssignedSceneKeysToSupabase(userId: string, sceneKeys: SceneKey[]): Promise<void> {
  await supabaseService.upsertTaskViews(userId, [], sceneKeys);
}

async function migrateLocalStorageToSupabase(userId: string): Promise<void> {
  if (localStorage.getItem(MIGRATION_DONE_KEY)) return;

  console.log('[MyTasks] localStorage → Supabase 마이그레이션 시작');

  try {
    const rawTodos = localStorage.getItem(ASSIGNED_TODOS_KEY);
    if (rawTodos) {
      const todos: PersonalTodo[] = JSON.parse(rawTodos);
      // 이미 마이그레이션된 항목 추적 (재시도 시 중복 방지)
      const migratedKey = 'bflow_migration_todos_migrated_indices';
      const migratedSet = new Set<number>(
        JSON.parse(localStorage.getItem(migratedKey) || '[]'),
      );

      for (let i = 0; i < todos.length; i++) {
        if (migratedSet.has(i)) continue; // 이미 마이그레이션된 항목 스킵
        const todo = todos[i];
        await supabaseService.upsertTodo(userId, {
          title: todo.title,
          memo: todo.memo,
          completed: todo.completed,
          startDate: todo.startDate ?? null,
          endDate: todo.endDate ?? null,
          addToCalendar: todo.addToCalendar,
          sortOrder: i,
          createdAt: todo.createdAt,
        });
        migratedSet.add(i);
        localStorage.setItem(migratedKey, JSON.stringify([...migratedSet]));
      }

      localStorage.removeItem(migratedKey); // 완료 후 추적 키 제거
    }

    // 커스텀 뷰 개인 할일 평탄화: VIEWS_KEY 삭제 전에 각 뷰의 personalTodos를 assigned로 올림
    // (PR 1에서 커스텀 뷰 제거 — 아직 Supabase 마이그레이션 안 한 사용자 데이터 보호)
    const rawViews = localStorage.getItem(VIEWS_KEY);
    if (rawViews) {
      try {
        const views: Array<{ personalTodos?: PersonalTodo[] }> = JSON.parse(rawViews);
        // 이미 마이그레이션한 assigned todos의 id 집합
        const rawTodosForDedup = localStorage.getItem(ASSIGNED_TODOS_KEY);
        const assignedIds = new Set<string>(
          rawTodosForDedup ? JSON.parse(rawTodosForDedup).map((t: PersonalTodo) => t.id) : [],
        );
        const seenIds = new Set<string>();
        let viewTodoSortIndex = assignedIds.size; // assigned todos 뒤에 이어 붙임
        for (const view of views) {
          for (const todo of view?.personalTodos ?? []) {
            if (!todo?.id) continue;
            if (assignedIds.has(todo.id) || seenIds.has(todo.id)) continue; // id 기준 중복 제거
            seenIds.add(todo.id);
            await supabaseService.upsertTodo(userId, {
              id: todo.id,
              title: todo.title,
              memo: todo.memo,
              completed: todo.completed,
              startDate: todo.startDate ?? null,
              endDate: todo.endDate ?? null,
              addToCalendar: todo.addToCalendar,
              sortOrder: viewTodoSortIndex++,
              createdAt: todo.createdAt,
            });
          }
        }
      } catch (viewErr) {
        console.warn('[MyTasks] 커스텀 뷰 개인 할일 평탄화 실패 — 기존 데이터 보호를 위해 마이그레이션 중단:', viewErr);
        throw viewErr; // catch 블록으로 올려 MIGRATION_DONE_KEY 마커 미설정 → 다음 실행 시 재시도
      }
    }

    const rawSceneKeys = localStorage.getItem(ASSIGNED_SCENES_KEY);
    const sceneKeys = rawSceneKeys ? JSON.parse(rawSceneKeys) : [];
    if (sceneKeys.length > 0) {
      await supabaseService.upsertTaskViews(userId, [], sceneKeys);
    }

    localStorage.setItem(MIGRATION_DONE_KEY, 'true');
    localStorage.removeItem(ASSIGNED_TODOS_KEY);
    localStorage.removeItem(VIEWS_KEY);
    localStorage.removeItem(ASSIGNED_SCENES_KEY);

    console.log('[MyTasks] 마이그레이션 완료');
  } catch (err) {
    const msg = String(err);
    if (msg.includes('foreign key constraint') || msg.includes('violates')) {
      console.warn('[MyTasks] 마이그레이션 스킵: 사용자가 Supabase에 존재하지 않음 (재로그인 필요)');
    } else {
      console.error('[MyTasks] 마이그레이션 실패 (다음 실행 시 재시도):', err);
    }
  }
}

/**
 * 커스텀 뷰 제거(PR 1) 이후 일회성 DB 마이그레이션.
 *
 * 기존 사용자의 task_views.views 에는 커스텀 뷰별 personalTodos 가 남아 있을 수 있다.
 * 현재 코드는 씬키 저장 시 views 를 빈 배열로 덮어쓰므로, 그대로 두면 이 개인 할일들이
 * 영구 삭제된다. 이를 막기 위해 views 의 모든 personalTodos 를 평탄화해, 이미 로드한
 * assigned 할일에 id 기준으로 없는 것만 '내 할일'로 옮긴다.
 *
 * @param currentTodos 방금 로드한 assigned 할일 (id 기준 중복 제거에 사용)
 * @returns 새로 마이그레이션되어 state 에 합쳐야 할 할일 목록(서버 확정 id 반영).
 *          마이그레이션할 게 없으면 빈 배열. 읽기 실패 등 안전하게 스킵해야 하면 null.
 */
async function migrateCustomViewTodosToAssigned(
  userId: string,
  currentTodos: PersonalTodo[],
): Promise<PersonalTodo[] | null> {
  // 일회성: 이미 마이그레이션했으면 모을 게 없으므로 스킵
  if (localStorage.getItem(CUSTOM_VIEW_TODOS_MIGRATED_KEY)) return [];

  let data: { views: unknown[]; assignedSceneKeys: unknown[] } | null;
  try {
    data = await supabaseService.readTaskViews(userId);
  } catch (err) {
    // 읽기 실패 시 기존 데이터 보호: 마이그레이션 스킵(마커도 남기지 않아 다음에 재시도)
    console.error('[MyTasks] 커스텀 뷰 할일 마이그레이션 읽기 실패 — 스킵:', err);
    return null;
  }

  const views = (data?.views ?? []) as TaskView[];

  // 모든 커스텀 뷰의 personalTodos 평탄화 + (뷰 내) id 중복 제거
  const existingIds = new Set(currentTodos.map((t) => t.id));
  const seenIds = new Set<string>();
  const candidates: PersonalTodo[] = [];
  for (const view of views) {
    for (const todo of view?.personalTodos ?? []) {
      if (!todo?.id) continue;
      // 이미 내 할일에 있거나(같은 id) 이미 후보로 잡힌 id는 스킵 (title 무관, id만 기준)
      if (existingIds.has(todo.id) || seenIds.has(todo.id)) continue;
      seenIds.add(todo.id);
      candidates.push(todo);
    }
  }

  if (candidates.length === 0) {
    // 옮길 게 없어도 마커는 남겨 다음 로드에서 재시도하지 않게 함
    localStorage.setItem(CUSTOM_VIEW_TODOS_MIGRATED_KEY, 'true');
    return [];
  }

  // 후보들을 personal_todos 로 저장 (기존 할일 뒤에 이어 붙임)
  const migrated: PersonalTodo[] = [];
  try {
    for (let i = 0; i < candidates.length; i++) {
      const todo = candidates[i];
      const returnedId = await saveTodoToSupabase(userId, todo, currentTodos.length + i);
      migrated.push(returnedId && returnedId !== todo.id ? { ...todo, id: returnedId } : todo);
    }
  } catch (err) {
    // 저장 도중 실패: 지금까지 성공한 것은 반영하되, 마커/views 정리는 하지 않아 다음에 재시도
    console.error('[MyTasks] 커스텀 뷰 할일 저장 실패 — 일부만 반영:', err);
    return migrated;
  }

  // 마이그레이션 성공 → views 를 비워 정리 보장 (씬키는 보존)
  try {
    await supabaseService.upsertTaskViews(userId, [], (data?.assignedSceneKeys ?? []) as unknown[]);
    localStorage.setItem(CUSTOM_VIEW_TODOS_MIGRATED_KEY, 'true');
  } catch (err) {
    // 정리 실패해도 할일 저장은 성공했고, 후속 씬키 save effect 가 views 를 [] 로 덮으므로
    // 데이터 손실은 없다. 마커만 남기지 않아 다음 기회에 정리 재시도.
    console.error('[MyTasks] 커스텀 뷰 정리(views 비우기) 실패 — 후속 저장에서 자연 정리됨:', err);
  }

  console.log(`[MyTasks] 커스텀 뷰 개인 할일 ${migrated.length}건 → 내 할일로 마이그레이션 완료`);
  return migrated;
}

export interface UseMyTasksDataResult {
  // 에피소드 (할일 추가 모달용 — 전체 에피소드)
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  // 사용자/로딩 상태
  currentUser: ReturnType<typeof useAuthStore.getState>['currentUser'];
  loadTimedOut: boolean;
  // 파생 상태
  allViewScenes: FlatScene[];
  pendingScenes: FlatScene[];
  doneScenes: FlatScene[];
  activePersonalTodos: PersonalTodo[];
  pendingPersonalTodos: PersonalTodo[];
  donePersonalTodos: PersonalTodo[];
  stats: { total: number; fullyDone: number; pct: number };
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
  updatePersonalTodo: (todoId: string, updates: Partial<PersonalTodo>) => Promise<void>;
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

  // assigned(내 할일) 뷰 전용 개인 할일
  const [assignedTodos, setAssignedTodos] = useState<PersonalTodo[]>([]);
  // assigned 뷰에서 수동으로 추가한 씬 키
  const [assignedSceneKeys, setAssignedSceneKeys] = useState<SceneKey[]>([]);

  // 플로팅 위젯에서 메인 세션 수신 실패 시 안내 메시지 표시 (10초 타임아웃)
  const [loadTimedOut, setLoadTimedOut] = useState(false);

  // Supabase 초기화 완료 여부 (save effect에서 초기화 전 저장 방지)
  const _supabaseInitialized = useRef(false);

  // 외부(IPC)에서 받은 변경인지 추적 — 0 초과이면 브로드캐스트 스킵 (카운터로 중첩 안전)
  const _externalDepth = useRef(0);
  // ptodo_* → UUID 매핑 (비동기 ID 교체 진행 중일 때 삭제 등에서 사용)
  const _pendingIdMap = useRef(new Map<string, string>());
  // 서버 응답 전에 삭제된 할일 ID (UUID 반환 시 서버에서도 삭제)
  const _deletedBeforeSync = useRef(new Set<string>());

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

  // Supabase 초기화: 마이그레이션 후 데이터 로드
  useEffect(() => {
    if (!currentUser?.id) return;
    // 사용자 전환 시 이전 사용자 상태가 새 사용자 ID로 저장되는 것을 방지
    // save effect가 로드 완료 전에 실행되지 않도록 초기화 플래그를 즉시 해제
    _supabaseInitialized.current = false;
    _externalDepth.current++;
    setAssignedTodos([]);
    setAssignedSceneKeys([]);
    requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });
    const userId = currentUser.id;
    (async () => {
      await migrateLocalStorageToSupabase(userId);
      const [todos, sceneKeys] = await Promise.all([
        loadTodosFromSupabase(userId),
        loadAssignedSceneKeysFromSupabase(userId),
      ]);
      if (todos === null || sceneKeys === null) {
        console.warn('[MyTasks] 초기 로드 실패 — 서버 데이터 덮어쓰기 방지를 위해 초기화 건너뜀');
        return;
      }
      // 일회성 마이그레이션: 기존 커스텀 뷰에 남아 있던 개인 할일을 '내 할일'로 합침.
      // (DB 쓰기는 await로 먼저 끝내고, 합친 결과를 아래 가드 안에서 한 번에 setState)
      // 읽기 실패 등 안전 스킵이 필요하면 null → 빈 배열로 처리(기존 데이터 보호).
      const migratedTodos = (await migrateCustomViewTodosToAssigned(userId, todos)) ?? [];
      const mergedTodos = migratedTodos.length > 0 ? [...todos, ...migratedTodos] : todos;
      _externalDepth.current++;
      setAssignedTodos(mergedTodos);
      setAssignedSceneKeys(sceneKeys);
      requestAnimationFrame(() => {
        _externalDepth.current = Math.max(0, _externalDepth.current - 1);
        _supabaseInitialized.current = true;
      });
    })();
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

  useEffect(() => {
    if (!_supabaseInitialized.current || !currentUser?.id) return;
    if (_externalDepth.current > 0) return;
    const userId = currentUser.id;
    // assignedTodos 전체를 재저장 (순서 포함)
    // 반환된 UUID가 기존 ID와 다르면 로컬 state 갱신 (ptodo_* → UUID 전환)
    assignedTodos.forEach((todo, i) => {
      saveTodoToSupabase(userId, todo, i).then((returnedId) => {
        if (returnedId && returnedId !== todo.id) {
          _pendingIdMap.current.set(todo.id, returnedId);
          _externalDepth.current++;
          setAssignedTodos((prev) =>
            prev.map((t) => (t.id === todo.id ? { ...t, id: returnedId } : t)),
          );
          requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });
        }
      }).catch((err) => {
        const msg = String(err);
        if (!msg.includes('foreign key constraint')) {
          console.error('[MyTasks] 할일 저장 실패:', err);
          toast.error(SAVE_FAIL_MESSAGE);
        }
      });
    });
    broadcastTodoChange();
  }, [assignedTodos]);

  // 다른 창에서 할일이 변경되면 Supabase에서 다시 읽기
  useEffect(() => {
    const handler = () => {
      if (!currentUser?.id) return;
      const userId = currentUser.id;
      _externalDepth.current++;
      Promise.all([
        loadTodosFromSupabase(userId),
        loadAssignedSceneKeysFromSupabase(userId),
      ]).then(([todos, sceneKeys]) => {
        if (todos === null || sceneKeys === null) {
          console.warn('[MyTasks] 크로스 창 리로드 실패 — 서버 데이터 덮어쓰기 방지를 위해 상태 갱신 건너뜀');
          _externalDepth.current = Math.max(0, _externalDepth.current - 1);
          return;
        }
        setAssignedTodos(todos);
        setAssignedSceneKeys(sceneKeys);
        requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });
      });
    };
    window.addEventListener('bflow:todos-changed', handler);
    const ipcCleanup = window.electronAPI?.onDataChanged?.((delta) => {
      if (delta && (delta as any).type === 'todo') {
        handler();
      }
    });
    return () => {
      window.removeEventListener('bflow:todos-changed', handler);
      ipcCleanup?.();
    };
  }, [currentUser?.id]);

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
  const activePersonalTodos = assignedTodos;
  const pendingPersonalTodos = useMemo(() => activePersonalTodos.filter((t) => !t.completed), [activePersonalTodos]);
  const donePersonalTodos = useMemo(() => activePersonalTodos.filter((t) => t.completed), [activePersonalTodos]);

  const stats = useMemo(() => {
    const sceneTotal = allViewScenes.length;
    const personalTotal = activePersonalTodos.length;
    const total = sceneTotal + personalTotal;
    const sceneStages = sceneTotal * 4;
    const sceneChecked = allViewScenes.reduce((s, f) => s + [f.scene.lo, f.scene.done, f.scene.review, f.scene.png].filter(Boolean).length, 0);
    const personalDone = donePersonalTodos.length;
    const fullyDone = doneScenes.length + personalDone;
    // 씬: 4단계 가중, 개인 할일: 1단계 가중
    const totalWeight = sceneStages + personalTotal;
    const checkedWeight = sceneChecked + personalDone;
    const pct = totalWeight > 0 ? (checkedWeight / totalWeight) * 100 : 0;
    return { total, fullyDone, pct };
  }, [allViewScenes, doneScenes, activePersonalTodos, donePersonalTodos]);

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

  // ─── 개인 할일 조작 ─────────────────────
  const addPersonalTodo = useCallback(async (todo: PersonalTodo) => {
    // _externalDepth 카운터로 useEffect 재저장 방지 (여기서 직접 저장하므로)
    _externalDepth.current++;
    setAssignedTodos((prev) => [...prev, todo]);
    requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });
    // 다른 창에 할일 추가 알림 (effect가 _externalDepth로 스킵되므로 수동 호출)
    broadcastTodoChange();
    // Supabase 저장 (낙관적: 상태 반영 후 비동기 저장)
    if (currentUser?.id) {
      saveTodoToSupabase(currentUser.id, todo, assignedTodos.length).then(async (returnedId) => {
        if (returnedId && returnedId !== todo.id) {
          // 서버 응답 전에 이미 삭제되었으면 → 서버에서도 삭제
          if (_deletedBeforeSync.current.has(todo.id)) {
            _deletedBeforeSync.current.delete(todo.id);
            deleteTodoFromSupabase(returnedId).catch(() => {});
            return;
          }
          _pendingIdMap.current.set(todo.id, returnedId);
          _externalDepth.current++;
          setAssignedTodos((prev) => prev.map((t) => t.id === todo.id ? { ...t, id: returnedId } : t));
          requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });
          // 캘린더 이벤트의 linkedTodoId도 갱신 (old ID → new UUID)
          if (todo.addToCalendar) {
            try {
              const calEvent = await findEventByTodoId(todo.id);
              if (calEvent) {
                await updateCalEvent(calEvent.id, { linkedTodoId: returnedId });
              }
            } catch { /* 캘린더 미연결 시 무시 */ }
          }
        }
      }).catch((err) => {
        console.error('[MyTasks] 할일 추가 저장 실패:', err);
        toast.error(SAVE_FAIL_MESSAGE);
      });
    }
    // 캘린더 연동: addToCalendar가 true이고 날짜가 있으면 캘린더 이벤트 생성
    if (todo.addToCalendar && (todo.startDate || todo.endDate)) {
      try {
        const startDate = todo.startDate || todo.endDate!;
        const endDate = todo.endDate || todo.startDate!;
        await addCalEvent({
          id: `cal_${todo.id}`,
          title: todo.title,
          memo: todo.memo,
          color: '#6C5CE7',
          type: 'custom',
          startDate,
          endDate,
          createdBy: currentUser?.name ?? '알 수 없음',
          createdAt: new Date().toISOString(),
          linkedTodoId: todo.id,
        });
      } catch (err) {
        console.error('[MyTasks] 캘린더 이벤트 추가 실패:', err);
      }
    }
  }, [assignedTodos, currentUser, broadcastTodoChange]);

  const togglePersonalTodo = useCallback((todoId: string) => {
    const updater = (todos: PersonalTodo[]) => todos.map((t) => t.id === todoId ? { ...t, completed: !t.completed } : t);
    // _externalDepth 카운터로 catch-all effect 억제 (여기서 직접 저장하므로)
    _externalDepth.current++;
    setAssignedTodos((prev) => {
      const newList = updater(prev);
      // Supabase 저장
      const updated = newList.find((t) => t.id === todoId);
      if (updated && currentUser?.id) {
        saveTodoToSupabase(currentUser.id, updated, newList.indexOf(updated)).catch((err) => {
          console.error('[MyTasks] 할일 토글 저장 실패:', err);
          toast.error(SAVE_FAIL_MESSAGE);
        });
      }
      return newList;
    });
    requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });
  }, [currentUser]);

  const removePersonalTodo = useCallback(async (todoId: string) => {
    // 낙관적: 목록에서 즉시 제거
    // ID 매핑 확인: ptodo_* → UUID 교체가 진행 중이면 서버 UUID로 삭제
    const resolvedId = _pendingIdMap.current.get(todoId) || todoId;
    _pendingIdMap.current.delete(todoId);
    // 매핑이 아직 안 됐으면 (서버 응답 전) → 나중에 UUID 반환 시 삭제하도록 등록
    if (resolvedId === todoId && todoId.startsWith('ptodo_')) {
      _deletedBeforeSync.current.add(todoId);
    }

    setAssignedTodos((prev) => prev.filter((t) => t.id !== todoId && t.id !== resolvedId));
    // Supabase 삭제
    if (currentUser?.id) {
      deleteTodoFromSupabase(resolvedId).catch((err) => {
        console.error('[MyTasks] 할일 삭제 실패:', err);
        toast.error(SAVE_FAIL_MESSAGE);
      });
    }
    // 캘린더 이벤트도 삭제 (없으면 no-op)
    try {
      await deleteCalEvent(`cal_${todoId}`);
    } catch (err) {
      console.error('[MyTasks] 캘린더 이벤트 삭제 실패:', err);
    }
  }, [currentUser]);

  const reorderPendingTodos = useCallback((reordered: PersonalTodo[]) => {
    const completed = activePersonalTodos.filter((t) => t.completed);
    const newList = [...reordered, ...completed];
    // _externalDepth 카운터로 catch-all effect 억제 (전체 저장을 여기서 직접 처리하므로)
    _externalDepth.current++;
    setAssignedTodos(newList);
    requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });
    // Supabase: 순서 변경 저장 (debounce 없이 바로 저장)
    if (currentUser?.id) {
      const userId = currentUser.id;
      newList.forEach((todo, i) => {
        saveTodoToSupabase(userId, todo, i).catch((err) => {
          console.error('[MyTasks] 할일 순서 저장 실패:', err);
          toast.error(SAVE_FAIL_MESSAGE);
        });
      });
    }
  }, [activePersonalTodos, currentUser]);

  // ─── 개인 할일 업데이트 (인라인 편집 + 캘린더 동기화) ─────────────────────
  const updatePersonalTodo = useCallback(async (todoId: string, updates: Partial<PersonalTodo>) => {
    // 현재 todo 찾기
    const oldTodo = assignedTodos.find((t) => t.id === todoId);
    if (!oldTodo) return;

    const newTodo = { ...oldTodo, ...updates };

    // 낙관적 UI 업데이트 + Supabase 저장
    const updater = (todos: PersonalTodo[]) => todos.map((t) => t.id === todoId ? newTodo : t);
    // _externalDepth 카운터로 catch-all effect 억제 (여기서 직접 저장하므로)
    _externalDepth.current++;
    setAssignedTodos((prev) => {
      const newList = updater(prev);
      if (currentUser?.id) {
        saveTodoToSupabase(currentUser.id, newTodo, newList.indexOf(newTodo)).catch((err) => {
          console.error('[MyTasks] 할일 업데이트 저장 실패:', err);
          toast.error(SAVE_FAIL_MESSAGE);
        });
      }
      return newList;
    });
    requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });

    // 캘린더 동기화
    const calEventId = `cal_${todoId}`;
    try {
      if (updates.addToCalendar !== undefined) {
        if (updates.addToCalendar && !oldTodo.addToCalendar) {
          // 캘린더 연동 ON → 이벤트 생성 (날짜 없으면 오늘로 fallback + 할일에도 저장)
          const todayStr = new Date().toISOString().slice(0, 10);
          const startDate = newTodo.startDate || newTodo.endDate || todayStr;
          const endDate = newTodo.endDate || newTodo.startDate || startDate;
          if (!newTodo.startDate || !newTodo.endDate) {
            // 할일 자체에도 fallback 날짜 저장
            const dateUpdates: Partial<PersonalTodo> = {};
            if (!newTodo.startDate) dateUpdates.startDate = startDate;
            if (!newTodo.endDate) dateUpdates.endDate = endDate;
            Object.assign(newTodo, dateUpdates);
          }
          await addCalEvent({
            id: calEventId,
            title: newTodo.title,
            memo: newTodo.memo,
            color: '#6C5CE7',
            type: 'custom',
            startDate,
            endDate,
            createdBy: currentUser?.name ?? '알 수 없음',
            createdAt: new Date().toISOString(),
            linkedTodoId: todoId,
          });
        } else if (!updates.addToCalendar && oldTodo.addToCalendar) {
          // 캘린더 연동 OFF → 이벤트 삭제
          await deleteCalEvent(calEventId);
        }
      } else if (newTodo.addToCalendar) {
        // 날짜가 비워졌으면 캘린더 연동 해제
        if (!newTodo.startDate && !newTodo.endDate) {
          await deleteCalEvent(calEventId);
          Object.assign(newTodo, { addToCalendar: false });
        } else {
          // addToCalendar이 이미 true인 상태에서 title/date 변경 → 이벤트 업데이트
          const calUpdates: Record<string, string> = {};
          if (updates.title !== undefined) calUpdates.title = updates.title;
          // 날짜: 비워진 경우 다른 쪽 날짜로 채움 (캘린더 이벤트는 항상 날짜 필요)
          const todayFallback = new Date().toISOString().slice(0, 10);
          if ('startDate' in updates) calUpdates.startDate = updates.startDate || newTodo.endDate || todayFallback;
          if ('endDate' in updates) calUpdates.endDate = updates.endDate || newTodo.startDate || todayFallback;
          if (Object.keys(calUpdates).length > 0) {
            await updateCalEvent(calEventId, calUpdates);
          }
        }
      }
    } catch (err) {
      console.error('[MyTasks] 캘린더 동기화 실패:', err);
    }
  }, [assignedTodos, currentUser]);

  // ─── 캘린더 변경 리스너 (역방향 동기화) ─────────────────────
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;

      // eventId 없음 = syncIncremental 후 전체 변경 알림 → 할일-연결 이벤트 일괄 역동기화
      if (!detail?.eventId) {
        const { getEvents: fetchEvents } = await import('@/services/calendarService');
        const allEvents = await fetchEvents();
        const linkedEvents = allEvents.filter((ev) => ev.linkedTodoId);
        const todoUpdater = (t: PersonalTodo, calEvent: { title: string; startDate: string; endDate: string }) => {
          const changed = t.title !== calEvent.title || t.startDate !== calEvent.startDate || t.endDate !== calEvent.endDate;
          return changed ? { ...t, title: calEvent.title, startDate: calEvent.startDate, endDate: calEvent.endDate } : t;
        };
        for (const calEvent of linkedEvents) {
          const tid = calEvent.linkedTodoId!;
          setAssignedTodos((prev) => prev.map((t) => t.id === tid ? todoUpdater(t, calEvent) : t));
        }
        return;
      }

      const eventId = detail.eventId as string;

      // todo 연결 이벤트 확인:
      // 1) cal_xxx 형식의 로컬 ID
      // 2) Google ID → linkedTodoId로 역추적
      let todoId: string | null = null;
      if (eventId.startsWith('cal_')) {
        todoId = eventId.replace(/^cal_/, '');
      } else {
        const { getEvents: fetchEvents } = await import('@/services/calendarService');
        const allEvents = await fetchEvents();
        const matched = allEvents.find((ev) => ev.id === eventId && ev.linkedTodoId);
        if (matched?.linkedTodoId) todoId = matched.linkedTodoId;
      }
      if (!todoId) return;

      if (detail.action === 'delete') {
        // 캘린더 이벤트 삭제됨 → todo의 addToCalendar 플래그만 해제 (todo 자체는 유지)
        const calUpdater = (todos: PersonalTodo[]) =>
          todos.map((t) => t.id === todoId ? { ...t, addToCalendar: false } : t);
        // _externalDepth 카운터로 catch-all effect 억제 (여기서 직접 저장하므로)
        _externalDepth.current++;
        setAssignedTodos((prev) => {
          const newList = calUpdater(prev);
          const updated = newList.find((t) => t.id === todoId);
          if (updated && currentUser?.id) {
            saveTodoToSupabase(currentUser.id, updated, newList.indexOf(updated)).catch(() => {});
          }
          return newList;
        });
        requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });
      }

      if (detail.action === 'update') {
        // 캘린더 이벤트 업데이트됨 → todo에 title/dates 역동기화
        const calEvent = await findEventByTodoId(todoId);
        if (calEvent) {
          const calUpdater = (todos: PersonalTodo[]) =>
            todos.map((t) => t.id === todoId ? {
              ...t,
              title: calEvent.title,
              startDate: calEvent.startDate,
              endDate: calEvent.endDate,
            } : t);
          // _externalDepth 카운터로 catch-all effect 억제 (여기서 직접 저장하므로)
          _externalDepth.current++;
          setAssignedTodos((prev) => {
            const newList = calUpdater(prev);
            const updated = newList.find((t) => t.id === todoId);
            if (updated && currentUser?.id) {
              saveTodoToSupabase(currentUser.id, updated, newList.indexOf(updated)).catch(() => {});
            }
            return newList;
          });
          requestAnimationFrame(() => { _externalDepth.current = Math.max(0, _externalDepth.current - 1); });
        }
      }
    };
    window.addEventListener('bflow:calendar-changed', handler);
    return () => window.removeEventListener('bflow:calendar-changed', handler);
  }, [currentUser]);

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
    allViewScenes,
    pendingScenes,
    doneScenes,
    activePersonalTodos,
    pendingPersonalTodos,
    donePersonalTodos,
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
    updatePersonalTodo,
  };
}
