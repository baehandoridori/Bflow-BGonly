import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { broadcastSceneUpdate, broadcastSceneFieldUpdate, broadcastDataChange, broadcastCommentAdded, broadcastCalendarChanged } from './broadcast';

// ─── Supabase 클라이언트 (하드코딩 — 의사결정 #환경변수 참조) ───

const SUPABASE_URL = 'https://mpqifkpxalwxgcrddchv.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wcWlma3B4YWx3eGdjcmRkY2h2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0ODEzNjIsImV4cCI6MjA4OTA1NzM2Mn0.vkaColwt60z1fpxFP2FDSDSdomLSgpGK44xwZe-Gvio';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
  global: {
    headers: { 'X-Client-Info': 'bflow-electron' },
  },
});

// Node.js(Electron main)에는 글로벌 WebSocket이 없으므로 ws 패키지를 주입
// @ts-expect-error — globalThis.WebSocket 타입 불일치 (ws vs browser WebSocket)
globalThis.WebSocket = WebSocket;

// ─── 타입 ──────────────────────────────────────

/** readAllEpisodes 반환용 — 기존 sheets.ts와 동일한 구조 */
export interface SupabaseEpisodeData {
  episodeNumber: number;
  title: string;
  memo: string;
  parts: {
    partId: string;
    department: string;
    sheetName: string;         // 호환용: "EP01_A_BG" 형식 생성
    scenes: SupabaseSceneRow[];
  }[];
}

export interface SupabaseSceneRow {
  id: string;                  // Supabase UUID (sheets에는 없던 필드)
  no: number;
  sceneId: string;
  memo: string;
  storyboardUrl: string;
  guideUrl: string;
  assignee: string;
  layoutId: string;
  lo: boolean;
  done: boolean;
  review: boolean;
  png: boolean;
  completedBy?: string;
  completedAt?: string;
}

export interface SupabaseUser {
  id: string;
  name: string;
  role: string;
  password: string;
  slackId: string;
  hireDate: string;
  birthday: string;
  isInitialPassword: boolean;
  createdAt: string;
}

export interface SupabaseComment {
  id: string;
  partId: string;
  sceneId: string;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
}

export interface SupabaseRevision {
  id: string;
  partId: string;
  sceneId: string;
  revisionNo: number;
  status: string;
  priority: string;
  description: string;
  frameNo: string;
  imageUrl: string;
  department: string;
  requesterId: string;
  requesterName: string;
  assignee: string;
  resolvedBy: string;
  resolvedNote: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

// ─── 헬퍼 ──────────────────────────────────────

/** 에피소드 번호 → "EP01" 형식 */
function epLabel(n: number): string {
  return `EP${String(n).padStart(2, '0')}`;
}

/** 호환용 sheetName 생성: "EP01_A_BG" */
function makeSheetName(epNum: number, partId: string, dept: string): string {
  const deptSuffix = dept === 'acting' ? 'ACT' : 'BG';
  return `${epLabel(epNum)}_${partId}_${deptSuffix}`;
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

const SCENE_COMPLETION_META_TYPE = 'scene-completion';

function parseSceneCompletionMeta(value: string | null | undefined): { completedBy: string; completedAt: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { completedBy?: unknown; completedAt?: unknown };
    if (typeof parsed.completedBy !== 'string' || typeof parsed.completedAt !== 'string') return null;
    if (!parsed.completedBy || !parsed.completedAt) return null;
    return { completedBy: parsed.completedBy, completedAt: parsed.completedAt };
  } catch {
    return null;
  }
}

// ─── 연결 테스트 ────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('episodes').select('id').limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ═══════════════════════════════════════════════
// EPISODES
// ═══════════════════════════════════════════════

/** 모든 에피소드 + 파트 + 씬 읽기 (기존 readAllEpisodes 대체) */
export async function readAllEpisodes(): Promise<SupabaseEpisodeData[]> {
  // 1) 활성 에피소드
  const { data: episodes, error: epErr } = await supabase
    .from('episodes')
    .select('id, episode_number, title, memo')
    .eq('status', 'active')
    .order('episode_number');
  throwIfError(epErr);
  if (!episodes || episodes.length === 0) return [];

  // 2) 활성 파트 (모든 에피소드)
  const epIds = episodes.map((e) => e.id);
  const { data: parts, error: partErr } = await supabase
    .from('parts')
    .select('id, episode_id, part_id, department')
    .in('episode_id', epIds)
    .eq('status', 'active')
    .order('part_id');
  throwIfError(partErr);

  // 3) 모든 씬 (활성 파트)
  const partIds = (parts || []).map((p) => p.id);
  let scenes: {
    id: string; part_id: string; scene_number: string; sort_order: number;
    memo: string; storyboard_url: string; guide_url: string; assignee: string;
    layout: string; lo: boolean; done: boolean; review: boolean; png: boolean;
  }[] = [];

  if (partIds.length > 0) {
    // Supabase IN 쿼리는 최대 수백 개까지 괜찮음
    const { data: sceneRows, error: sceneErr } = await supabase
      .from('scenes')
      .select('id, part_id, scene_number, sort_order, memo, storyboard_url, guide_url, assignee, layout, lo, done, review, png')
      .in('part_id', partIds)
      .order('sort_order');
    throwIfError(sceneErr);
    scenes = sceneRows || [];
  }

  const sceneCompletionById = new Map<string, { completedBy: string; completedAt: string }>();
  const sceneIds = scenes.map((scene) => scene.id);
  if (sceneIds.length > 0) {
    const { data: completionRows, error: completionErr } = await supabase
      .from('metadata')
      .select('key, value')
      .eq('type', SCENE_COMPLETION_META_TYPE)
      .in('key', sceneIds);
    throwIfError(completionErr);
    for (const row of completionRows || []) {
      const meta = parseSceneCompletionMeta(row.value as string | null | undefined);
      if (!meta) continue;
      sceneCompletionById.set(row.key as string, meta);
    }
  }

  // 4) 조립
  const scenesByPart = new Map<string, typeof scenes>();
  for (const s of scenes) {
    const arr = scenesByPart.get(s.part_id) || [];
    arr.push(s);
    scenesByPart.set(s.part_id, arr);
  }

  const partsByEp = new Map<string, typeof parts>();
  for (const p of parts || []) {
    const arr = partsByEp.get(p.episode_id) || [];
    arr.push(p);
    partsByEp.set(p.episode_id, arr);
  }

  return episodes.map((ep) => {
    const epParts = partsByEp.get(ep.id) || [];
    return {
      episodeNumber: ep.episode_number,
      title: ep.title || '',
      memo: ep.memo || '',
      parts: epParts.map((p) => {
        const partScenes = scenesByPart.get(p.id) || [];
        return {
          id: p.id,
          partId: p.part_id,
          department: p.department,
          sheetName: makeSheetName(ep.episode_number, p.part_id, p.department),
          scenes: partScenes.map((s) => ({
            ...(sceneCompletionById.get(s.id) ?? {}),
            id: s.id,
            no: s.sort_order,
            sceneId: s.scene_number,
            memo: s.memo || '',
            storyboardUrl: s.storyboard_url || '',
            guideUrl: s.guide_url || '',
            assignee: s.assignee || '',
            layoutId: s.layout || '',
            lo: s.lo,
            done: s.done,
            review: s.review,
            png: s.png,
          })),
        };
      }),
    };
  });
}

/** 에피소드 추가 */
export async function addEpisode(
  episodeNumber: number,
  department?: string,
): Promise<void> {
  // 에피소드 생성
  const { data: ep, error: epErr } = await supabase
    .from('episodes')
    .insert({ episode_number: episodeNumber })
    .select('id')
    .single();
  throwIfError(epErr);

  // 기본 파트 A 생성
  const depts = department ? [department] : ['bg', 'acting'];
  const partRows = depts.map((d) => ({
    episode_id: ep!.id,
    part_id: 'A',
    department: d,
  }));
  const { error: partErr } = await supabase.from('parts').insert(partRows);
  throwIfError(partErr);
  broadcastDataChange('episodes', 'INSERT');
}

/** 에피소드 소프트 삭제 */
export async function softDeleteEpisode(episodeNumber: number): Promise<void> {
  const { error } = await supabase
    .from('episodes')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('episode_number', episodeNumber);
  throwIfError(error);
  broadcastDataChange('episodes', 'DELETE');
}

/** 에피소드 아카이빙 */
export async function archiveEpisode(
  episodeNumber: number,
  archivedBy?: string,
  archiveMemo?: string,
): Promise<void> {
  const { error } = await supabase
    .from('episodes')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
      archived_by: archivedBy || null,
      archive_memo: archiveMemo || null,
      updated_at: new Date().toISOString(),
    })
    .eq('episode_number', episodeNumber);
  throwIfError(error);
  broadcastDataChange('episodes', 'UPDATE');
}

/** 에피소드 아카이빙 해제 */
export async function unarchiveEpisode(episodeNumber: number): Promise<void> {
  const { error } = await supabase
    .from('episodes')
    .update({
      status: 'active',
      archived_at: null,
      archived_by: null,
      archive_memo: null,
      updated_at: new Date().toISOString(),
    })
    .eq('episode_number', episodeNumber);
  throwIfError(error);
  broadcastDataChange('episodes', 'UPDATE');
}

/** 아카이브된 에피소드 목록 */
export async function readArchivedEpisodes(): Promise<{
  episodeNumber: number;
  title: string;
  archivedBy: string;
  archivedAt: string;
  archiveMemo: string;
}[]> {
  const { data, error } = await supabase
    .from('episodes')
    .select('episode_number, title, archived_by, archived_at, archive_memo')
    .eq('status', 'archived')
    .order('episode_number');
  throwIfError(error);
  return (data || []).map((e) => ({
    episodeNumber: e.episode_number,
    title: e.title || '',
    archivedBy: e.archived_by || '',
    archivedAt: e.archived_at || '',
    archiveMemo: e.archive_memo || '',
  }));
}

// ═══════════════════════════════════════════════
// PARTS
// ═══════════════════════════════════════════════

/** 파트 추가 */
export async function addPart(
  episodeNumber: number,
  partId: string,
  department?: string,
): Promise<void> {
  // 에피소드 id 조회
  const { data: ep, error: epErr } = await supabase
    .from('episodes')
    .select('id')
    .eq('episode_number', episodeNumber)
    .single();
  throwIfError(epErr);

  const depts = department ? [department] : ['bg', 'acting'];
  const rows = depts.map((d) => ({
    episode_id: ep!.id,
    part_id: partId,
    department: d,
  }));
  const { error } = await supabase.from('parts').insert(rows);
  throwIfError(error);
  broadcastDataChange('parts', 'INSERT');
}

/** 파트 소프트 삭제 (sheetName으로 식별 — 호환용) */
export async function softDeletePart(sheetName: string): Promise<void> {
  const partUuid = await resolvePartId(sheetName);
  if (!partUuid) throw new Error(`파트를 찾을 수 없음: ${sheetName}`);
  const { error } = await supabase
    .from('parts')
    .update({ status: 'deleted', updated_at: new Date().toISOString() })
    .eq('id', partUuid);
  throwIfError(error);
  broadcastDataChange('parts', 'DELETE');
}

// ═══════════════════════════════════════════════
// SCENES
// ═══════════════════════════════════════════════

/** 씬 추가 (단일) */
export async function addScene(
  sheetName: string,
  sceneId: string,
  assignee: string,
  memo: string,
): Promise<void> {
  const partUuid = await resolvePartId(sheetName);
  if (!partUuid) throw new Error(`파트를 찾을 수 없음: ${sheetName}`);

  // sort_order: 기존 씬 중 최대값 + 1
  const { data: maxRow } = await supabase
    .from('scenes')
    .select('sort_order')
    .eq('part_id', partUuid)
    .order('sort_order', { ascending: false })
    .limit(1);
  const nextOrder = (maxRow?.[0]?.sort_order ?? 0) + 1;

  const { error } = await supabase.from('scenes').insert({
    part_id: partUuid,
    scene_number: sceneId,
    sort_order: nextOrder,
    assignee,
    memo,
  });
  throwIfError(error);
  broadcastDataChange('scenes', 'INSERT');
}

/** 씬 대량 추가 */
export async function addScenes(
  sheetName: string,
  scenes: { sceneId: string; assignee: string; memo: string }[],
): Promise<void> {
  const partUuid = await resolvePartId(sheetName);
  if (!partUuid) throw new Error(`파트를 찾을 수 없음: ${sheetName}`);

  const { data: maxRow } = await supabase
    .from('scenes')
    .select('sort_order')
    .eq('part_id', partUuid)
    .order('sort_order', { ascending: false })
    .limit(1);
  let nextOrder = (maxRow?.[0]?.sort_order ?? 0) + 1;

  const rows = scenes.map((s) => ({
    part_id: partUuid,
    scene_number: s.sceneId,
    sort_order: nextOrder++,
    assignee: s.assignee,
    memo: s.memo,
  }));
  const { error } = await supabase.from('scenes').insert(rows);
  throwIfError(error);
  broadcastDataChange('scenes', 'INSERT');
}

/** 씬 삭제 (UUID로 삭제) */
export async function deleteScene(sceneUuid: string): Promise<void> {
  const { error } = await supabase.from('scenes').delete().eq('id', sceneUuid);
  throwIfError(error);
  broadcastDataChange('scenes', 'DELETE');
}

/** 씬 체크박스 토글 */
export async function updateSceneStage(
  sceneUuid: string,
  stage: string,
  value: boolean,
  updatedBy?: string,
): Promise<void> {
  const update: Record<string, unknown> = {
    [stage]: value,
    updated_at: new Date().toISOString(),
  };
  if (updatedBy) update.updated_by = updatedBy;
  const { error } = await supabase.from('scenes').update(update).eq('id', sceneUuid);
  throwIfError(error);
  // DB 저장 성공 → 즉시 broadcast로 다른 클라이언트에 전파
  broadcastSceneUpdate(sceneUuid, stage, value, updatedBy);
}

/** 대량 씬 체크박스 토글 (부분 실패 허용) */
export async function bulkUpdateSceneStages(
  updates: { sceneUuid: string; stage: string; value: boolean }[],
  updatedBy?: string,
): Promise<void> {
  const results = await Promise.allSettled(
    updates.map((u) => updateSceneStage(u.sceneUuid, u.stage, u.value, updatedBy)),
  );
  const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (failures.length > 0) {
    const total = updates.length;
    const failedCount = failures.length;
    const firstReason = failures[0].reason instanceof Error
      ? failures[0].reason.message
      : String(failures[0].reason);
    throw new Error(
      `${total}개 중 ${failedCount}개 업데이트 실패: ${firstReason}`,
    );
  }
}

/** 씬 필드 업데이트 (memo, assignee, sceneId 등) */
export async function updateSceneField(
  sceneUuid: string,
  field: string,
  value: string,
  senderId?: string,
): Promise<void> {
  // 필드명 매핑 (camelCase → snake_case)
  const fieldMap: Record<string, string> = {
    sceneId: 'scene_number',
    memo: 'memo',
    assignee: 'assignee',
    storyboardUrl: 'storyboard_url',
    guideUrl: 'guide_url',
    layoutId: 'layout',
  };
  const dbField = fieldMap[field] || field;
  const update: Record<string, unknown> = { [dbField]: value, updated_at: new Date().toISOString() };
  if (senderId) update.updated_by = senderId;
  const { error } = await supabase
    .from('scenes')
    .update(update)
    .eq('id', sceneUuid);
  throwIfError(error);
  broadcastSceneFieldUpdate(sceneUuid, field, value, senderId);
}

// ═══════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════

/** 모든 사용자 읽기 */
export async function readUsers(): Promise<SupabaseUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('name');
  throwIfError(error);
  return (data || []).map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role || 'user',
    password: u.password || '',
    slackId: u.slack_id || '',
    hireDate: u.hire_date || '',
    birthday: u.birthday || '',
    isInitialPassword: u.is_initial_password ?? true,
    createdAt: u.created_at || '',
  }));
}

/** 사용자 추가 */
export async function addUser(user: SupabaseUser): Promise<void> {
  const { error } = await supabase.from('users').insert({
    id: user.id,
    name: user.name,
    role: user.role,
    password: user.password,
    slack_id: user.slackId,
    hire_date: user.hireDate,
    birthday: user.birthday,
    is_initial_password: user.isInitialPassword,
  });
  throwIfError(error);
  broadcastDataChange('users', 'INSERT');
}

/** 사용자 업데이트 */
export async function updateUser(
  userId: string,
  updates: Record<string, string>,
): Promise<void> {
  // camelCase → snake_case 변환
  const dbUpdates: Record<string, unknown> = {};
  const fieldMap: Record<string, string> = {
    name: 'name', role: 'role', password: 'password',
    slackId: 'slack_id', hireDate: 'hire_date', birthday: 'birthday',
    isInitialPassword: 'is_initial_password',
  };
  for (const [k, v] of Object.entries(updates)) {
    dbUpdates[fieldMap[k] || k] = v;
  }
  const { error } = await supabase.from('users').update(dbUpdates).eq('id', userId);
  throwIfError(error);
  broadcastDataChange('users', 'UPDATE');
}

/** 사용자 삭제 */
export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabase.from('users').delete().eq('id', userId);
  throwIfError(error);
  broadcastDataChange('users', 'DELETE');
}

// ═══════════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════════

/** 파트별 댓글 읽기 */
export async function readCommentsForPart(partUuid: string): Promise<SupabaseComment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('part_id', partUuid)
    .order('created_at');
  throwIfError(error);
  return (data || []).map((c) => ({
    id: c.id,
    partId: c.part_id,
    sceneId: c.scene_id,
    userId: c.user_id,
    userName: c.user_name,
    text: c.text,
    mentions: c.mentions || [],
    createdAt: c.created_at,
    editedAt: c.edited_at,
  }));
}

/** 댓글 추가 */
export async function addComment(
  commentId: string,
  partUuid: string,
  sceneId: string,
  userId: string,
  userName: string,
  text: string,
  mentions: string[],
  createdAt: string,
): Promise<void> {
  const { error } = await supabase.from('comments').insert({
    id: commentId,
    part_id: partUuid,
    scene_id: sceneId,
    user_id: userId,
    user_name: userName,
    text,
    mentions,
    created_at: createdAt,
  });
  throwIfError(error);
  broadcastCommentAdded(sceneId, userName, userId, text, mentions);
}

/** 댓글 수정 */
export async function editComment(
  commentId: string,
  text: string,
  mentions: string[],
): Promise<void> {
  const { error } = await supabase
    .from('comments')
    .update({ text, mentions, edited_at: new Date().toISOString() })
    .eq('id', commentId);
  throwIfError(error);
  broadcastDataChange('comments', 'UPDATE');
}

/** 댓글 삭제 */
export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  throwIfError(error);
  broadcastDataChange('comments', 'DELETE');
}

// ═══════════════════════════════════════════════
// PRIVATE_CALENDAR_EVENTS — 사용자 전용 비공개 일정 (Google Calendar 비연동)
// ═══════════════════════════════════════════════

export interface SupabasePrivateEvent {
  id: string;
  user_id: string;
  title: string;
  memo: string | null;
  color: string | null;
  type: string | null;
  start_date: string;
  end_date: string;
  linked_episode: number | null;
  linked_part: string | null;
  linked_sheet_name: string | null;
  linked_scene_id: string | null;
  linked_department: string | null;
  linked_todo_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function readPrivateEvents(userId: string): Promise<SupabasePrivateEvent[]> {
  const { data, error } = await supabase
    .from('private_calendar_events')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: false });
  throwIfError(error);
  return (data as SupabasePrivateEvent[]) || [];
}

export async function addPrivateEvent(input: {
  user_id: string;
  title: string;
  memo?: string;
  color?: string;
  type?: string;
  start_date: string;
  end_date: string;
  linked_episode?: number | null;
  linked_part?: string | null;
  linked_sheet_name?: string | null;
  linked_scene_id?: string | null;
  linked_department?: string | null;
  linked_todo_id?: string | null;
  created_by?: string;
}): Promise<SupabasePrivateEvent> {
  const { data, error } = await supabase
    .from('private_calendar_events')
    .insert(input)
    .select('*')
    .single();
  throwIfError(error);
  broadcastDataChange('private_calendar_events', 'INSERT');
  broadcastCalendarChanged('INSERT');
  return data as SupabasePrivateEvent;
}

export async function updatePrivateEvent(
  id: string,
  updates: Partial<{
    title: string;
    memo: string;
    color: string;
    type: string;
    start_date: string;
    end_date: string;
    linked_episode: number | null;
    linked_part: string | null;
    linked_sheet_name: string | null;
    linked_scene_id: string | null;
    linked_department: string | null;
    linked_todo_id: string | null;
  }>,
): Promise<void> {
  const patch = { ...updates, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('private_calendar_events').update(patch).eq('id', id);
  throwIfError(error);
  broadcastDataChange('private_calendar_events', 'UPDATE');
  broadcastCalendarChanged('UPDATE');
}

export async function deletePrivateEvent(id: string): Promise<void> {
  const { error } = await supabase.from('private_calendar_events').delete().eq('id', id);
  throwIfError(error);
  broadcastDataChange('private_calendar_events', 'DELETE');
  broadcastCalendarChanged('DELETE');
}

/** 특정 비공개 이벤트의 소유자(user_id) 조회 — IPC 핸들러에서 권한 검증용. */
export async function getPrivateEventOwner(id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('private_calendar_events')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();
  throwIfError(error);
  return (data as { user_id: string } | null)?.user_id ?? null;
}

// ═══════════════════════════════════════════════
// COMP_REVISIONS
// ═══════════════════════════════════════════════

/** 모든 리비전 읽기 */
export async function readAllRevisions(): Promise<(SupabaseRevision & { sceneKey: string })[]> {
  const { data, error } = await supabase
    .from('comp_revisions')
    .select('*')
    .order('created_at');
  throwIfError(error);
  return (data || []).map(mapRevision);
}

/** sceneKey (EP01:A:a001) → part UUID 역조회 */
async function resolvePartUuid(sceneKey: string, department: string): Promise<string> {
  // sceneKey 형식: "EP01:A:a001"
  const parts = sceneKey.split(':');
  const epStr = parts[0] || ''; // "EP01"
  const partLetter = parts[1] || ''; // "A"
  const epNum = parseInt(epStr.replace(/\D/g, ''), 10);
  if (!epNum || !partLetter) throw new Error(`잘못된 sceneKey 형식: ${sceneKey}`);

  // episodes → parts 조인으로 UUID 조회
  const { data, error } = await supabase
    .from('parts')
    .select('id, episodes!inner(episode_number)')
    .eq('episodes.episode_number', epNum)
    .eq('part_id', partLetter)
    .eq('department', department || 'bg')
    .limit(1)
    .single();
  if (error || !data) throw new Error(`파트 UUID 조회 실패 (sceneKey=${sceneKey}, dept=${department}): ${error?.message}`);
  return data.id as string;
}

/** 리비전 추가 */
export async function addRevision(
  id: string,
  partUuid: string,
  sceneId: string,
  revisionNo: number,
  status: string,
  priority: string,
  description: string,
  frameNo: string,
  imageUrl: string,
  department: string,
  requesterId: string,
  requesterName: string,
  assignee: string,
  createdAt: string,
): Promise<void> {
  // partUuid가 비어있으면 sceneId(=sceneKey)에서 역조회
  let resolvedPartUuid = partUuid;
  if (!resolvedPartUuid) {
    resolvedPartUuid = await resolvePartUuid(sceneId, department);
  }

  const { error } = await supabase.from('comp_revisions').insert({
    id,
    part_id: resolvedPartUuid,
    scene_id: sceneId,
    revision_no: revisionNo,
    status,
    priority,
    description,
    frame_no: frameNo,
    image_url: imageUrl,
    department,
    requester_id: requesterId,
    requester_name: requesterName,
    assignee,
    created_at: createdAt,
  });
  throwIfError(error);
  broadcastDataChange('comp_revisions', 'INSERT');
}

/** 리비전 업데이트 */
export async function updateRevision(
  id: string,
  updates: Record<string, string>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const fieldMap: Record<string, string> = {
    status: 'status', priority: 'priority', description: 'description',
    frameNo: 'frame_no', imageUrl: 'image_url', assignee: 'assignee',
    resolvedBy: 'resolved_by', resolvedNote: 'resolved_note',
    resolvedAt: 'resolved_at', updatedAt: 'updated_at',
  };
  for (const [k, v] of Object.entries(updates)) {
    dbUpdates[fieldMap[k] || k] = v;
  }
  const { error } = await supabase.from('comp_revisions').update(dbUpdates).eq('id', id);
  throwIfError(error);
  broadcastDataChange('comp_revisions', 'UPDATE');
}

function mapRevision(r: Record<string, unknown>): SupabaseRevision & { sceneKey: string } {
  return {
    id: r.id as string,
    partId: r.part_id as string,
    sceneId: r.scene_id as string,
    sceneKey: (r.scene_id as string) || '',  // scene_id에 sceneKey 저장 (호환용)
    revisionNo: r.revision_no as number,
    status: (r.status as string) || 'open',
    priority: (r.priority as string) || 'normal',
    description: (r.description as string) || '',
    frameNo: (r.frame_no as string) || '',
    imageUrl: (r.image_url as string) || '',
    department: (r.department as string) || '',
    requesterId: (r.requester_id as string) || '',
    requesterName: (r.requester_name as string) || '',
    assignee: (r.assignee as string) || '',
    resolvedBy: (r.resolved_by as string) || '',
    resolvedNote: (r.resolved_note as string) || '',
    createdAt: (r.created_at as string) || '',
    updatedAt: (r.updated_at as string) || '',
    resolvedAt: (r.resolved_at as string) || null,
  };
}

// ═══════════════════════════════════════════════
// METADATA
// ═══════════════════════════════════════════════

/** 모든 메타데이터 읽기 */
export async function readAllMetadata(): Promise<{ type: string; key: string; value: string; updatedAt: string }[]> {
  const { data, error } = await supabase
    .from('metadata')
    .select('type, key, value, updated_at');
  throwIfError(error);
  return (data || []).map((m) => ({
    type: m.type,
    key: m.key,
    value: m.value || '',
    updatedAt: m.updated_at || '',
  }));
}

/** 특정 메타데이터 읽기 */
export async function readMetadata(
  type: string,
  key: string,
): Promise<{ type: string; key: string; value: string; updatedAt: string } | null> {
  const { data, error } = await supabase
    .from('metadata')
    .select('type, key, value, updated_at')
    .eq('type', type)
    .eq('key', key)
    .maybeSingle();
  throwIfError(error);
  if (!data) return null;
  return { type: data.type, key: data.key, value: data.value || '', updatedAt: data.updated_at || '' };
}

/** 메타데이터 쓰기 (upsert) */
export async function writeMetadata(type: string, key: string, value: string): Promise<void> {
  const { error } = await supabase
    .from('metadata')
    .upsert(
      { type, key, value, updated_at: new Date().toISOString() },
      { onConflict: 'type,key' },
    );
  throwIfError(error);
  broadcastDataChange('metadata', 'UPSERT');
}

// ═══════════════════════════════════════════════
// 내부 헬퍼: sheetName → part UUID 변환
// ═══════════════════════════════════════════════

/**
 * sheetName (예: "EP01_A_BG") → parts 테이블의 UUID를 반환.
 * 기존 sheets API와의 호환성을 위해 사용.
 */
async function resolvePartId(sheetName: string): Promise<string | null> {
  // "EP01_A_BG" → episodeNumber=1, partId='A', department='bg'
  const match = sheetName.match(/^EP(\d+)_([A-Z])_(BG|ACT)$/);
  if (!match) return null;

  const epNum = parseInt(match[1], 10);
  const partId = match[2];
  const dept = match[3] === 'ACT' ? 'acting' : 'bg';

  const { data: ep } = await supabase
    .from('episodes')
    .select('id')
    .eq('episode_number', epNum)
    .single();
  if (!ep) return null;

  const { data: part } = await supabase
    .from('parts')
    .select('id')
    .eq('episode_id', ep.id)
    .eq('part_id', partId)
    .eq('department', dept)
    .single();

  return part?.id || null;
}

// ─── Personal Todos ──────────────────────────────

export interface SupabaseTodo {
  id: string;
  userId: string;
  title: string;
  memo: string;
  completed: boolean;
  startDate: string | null;
  endDate: string | null;
  addToCalendar: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export async function readTodos(userId: string): Promise<SupabaseTodo[]> {
  const { data, error } = await supabase
    .from('personal_todos')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order');
  throwIfError(error);
  return (data || []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    title: r.title,
    memo: r.memo || '',
    completed: r.completed,
    startDate: r.start_date,
    endDate: r.end_date,
    addToCalendar: r.add_to_calendar,
    sortOrder: r.sort_order ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function upsertTodo(
  userId: string,
  todo: {
    id?: string;
    title: string;
    memo: string;
    completed: boolean;
    startDate?: string | null;
    endDate?: string | null;
    addToCalendar?: boolean;
    sortOrder?: number;
    createdAt?: string;
  },
): Promise<string> {
  const now = new Date().toISOString();
  // UUID 형식 검증: 기존 localStorage ID (ptodo_*)는 UUID가 아니므로 새 ID 생성
  const isValidUuid = todo.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(todo.id);
  const row = {
    ...(isValidUuid ? { id: todo.id } : {}),
    user_id: userId,
    title: todo.title,
    memo: todo.memo,
    completed: todo.completed,
    start_date: todo.startDate ?? null,
    end_date: todo.endDate ?? null,
    add_to_calendar: todo.addToCalendar ?? false,
    sort_order: todo.sortOrder ?? 0,
    created_at: todo.createdAt ?? now,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('personal_todos')
    .upsert(row, { onConflict: 'id' })
    .select('id')
    .single();
  throwIfError(error);
  return data!.id;
}

export async function deleteTodo(todoId: string): Promise<void> {
  const { error } = await supabase
    .from('personal_todos')
    .delete()
    .eq('id', todoId);
  throwIfError(error);
}

// ─── Task Views ──────────────────────────────

export async function readTaskViews(userId: string): Promise<{ views: unknown[]; assignedSceneKeys: unknown[] } | null> {
  const { data, error } = await supabase
    .from('task_views')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  throwIfError(error);
  if (!data) return null;
  return {
    views: data.views || [],
    assignedSceneKeys: data.assigned_scene_keys || [],
  };
}

export async function upsertTaskViews(
  userId: string,
  views: unknown[],
  assignedSceneKeys: unknown[],
): Promise<void> {
  const { error } = await supabase
    .from('task_views')
    .upsert(
      {
        user_id: userId,
        views,
        assigned_scene_keys: assignedSceneKeys,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  throwIfError(error);
}

// ─── Memos ──────────────────────────────

export async function readMemo(userId: string, widgetId: string): Promise<{
  tabs: unknown[];
  activeTabId: string | null;
  fontSize: number;
} | null> {
  const { data, error } = await supabase
    .from('memos')
    .select('*')
    .eq('user_id', userId)
    .eq('widget_id', widgetId)
    .maybeSingle();
  throwIfError(error);
  if (!data) return null;
  return {
    tabs: data.tabs || [],
    activeTabId: data.active_tab_id,
    fontSize: data.font_size ?? 14,
  };
}

export async function upsertMemo(
  userId: string,
  widgetId: string,
  memoData: { tabs: unknown[]; activeTabId: string | null; fontSize: number },
): Promise<void> {
  const { error } = await supabase
    .from('memos')
    .upsert(
      {
        user_id: userId,
        widget_id: widgetId,
        tabs: memoData.tabs,
        active_tab_id: memoData.activeTabId,
        font_size: memoData.fontSize,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,widget_id' },
    );
  throwIfError(error);
}

export async function readAllMemos(userId: string): Promise<Array<{
  widgetId: string;
  tabs: unknown[];
  activeTabId: string | null;
  fontSize: number;
}>> {
  const { data, error } = await supabase
    .from('memos')
    .select('*')
    .eq('user_id', userId);
  throwIfError(error);
  return (data || []).map((r) => ({
    widgetId: r.widget_id,
    tabs: r.tabs || [],
    activeTabId: r.active_tab_id,
    fontSize: r.font_size ?? 14,
  }));
}
