import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import {
  broadcastSceneUpdate, broadcastSceneFieldUpdate, broadcastScenePhaseUpdate, broadcastDataChange,
  broadcastCommentAdded, broadcastCalendarChanged, broadcastCommentReactionChanged,
  broadcastCommentReactionNotification, broadcastCommentReactionNotificationRemoved, broadcastActivityRemoved,
} from './broadcast';
import { deleteImage as storageDeleteImage } from './storage';
import { createRetryManager } from './retry-utils';

// ─── 일괄 작업 타입 ─────────────────────────────

export type BulkStageUpdate = {
  sceneUuid: string;
  stage: 'lo' | 'done' | 'review' | 'png';
  value: boolean;
  /**
   * 완료 메타 설정/해제 시맨틱:
   * - `undefined`: 변경 없음 (메타 건드리지 않음)
   * - `null`: 명시적 해제 (RPC가 metadata 행 DELETE)
   * - `string`: 설정 (RPC가 UPSERT)
   */
  completedBy?: string | null;
  completedAt?: string | null;
};

export type BulkFieldUpdate = {
  sceneUuid: string;
  fields: {
    assignee?: string;
    memo?: string;
    layoutId?: string;
    storyboardUrl?: string;
    guideUrl?: string;
  };
};

export type BulkUpdateResult = {
  sceneUuid: string;
  success: boolean;
  error?: string;
};

type RpcRow = { scene_uuid: string; success: boolean; error: string | null };

function mapRpcRows(rows: RpcRow[] | null): BulkUpdateResult[] {
  return (rows ?? []).map((row) => ({
    sceneUuid: row.scene_uuid,
    success: row.success,
    error: row.error ?? undefined,
  }));
}

// ─── 테스트 훅 ─────────────────────────────
// BFLOW_FORCE_FAIL_RATE=0.3 등으로 설정 시 성공 결과 중 일부를 강제로 실패 처리.
// 일괄 작업 재시도/부분 실패 UX 검증 용도. 프로덕션에서는 env 미설정이라 no-op.
function maybeForceFail(results: BulkUpdateResult[]): BulkUpdateResult[] {
  const rate = Number(process.env.BFLOW_FORCE_FAIL_RATE ?? '0');
  if (!rate || rate <= 0) return results;
  return results.map((r) =>
    r.success && Math.random() < rate
      ? { ...r, success: false, error: 'forced failure (test hook)' }
      : r
  );
}

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
  reelFilePath: string | null;
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
  /** v1.18.1: 컴포지터 단일 boolean (BG/ACT 부서 구분 없음). */
  isCompositor?: boolean;
}

export interface SupabaseComment {
  id: string;
  partId: string;
  sceneId: string;
  /** 한솔 결정 (v1.15.9): 정확한 씬 매칭용 UUID (catch-up 의 navigateToScene 에서 활용) */
  sceneUuid?: string | null;
  /** 캐릭터 현황판 댓글이면 해당 캐릭터 id, 씬 댓글이면 null/undefined. */
  characterId?: string | null;
  /** 캐릭터 댓글이 특정 복장 맥락이면 복장 id (이번 스레드 분기엔 미사용, 컬럼만 보존). */
  costumeId?: string | null;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];
  images: string[];
  createdAt: string;
  editedAt: string | null;
  /** v1.18.0: 리비전 맥락 댓글이면 해당 리비전 id, 일반 씬 댓글이면 null. */
  revisionId?: string | null;
  /** v1.24.0: 1단계 대댓글이면 부모 댓글 id, 일반 댓글이면 null. */
  parentCommentId?: string | null;
}

export interface CommentReadStateRow {
  userId: string;
  sceneThreadKey: string;
  lastReadAt: string;
  updatedAt: string;
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
  assigneeIds: string[];
  assigneeStates: Record<string, { state: string; note?: string; startedAt?: string; doneAt?: string }>;
  setId: string | null;
  finalResolvedBy: string;
  finalResolvedAt: string | undefined;
}

export type SceneWorkLinkDepartment = 'bg' | 'acting';
export type SceneWorkLinkKind = 'folder' | 'primary_file' | 'extra_file';

export interface SceneWorkLinkInput {
  sceneUuid: string;
  department: SceneWorkLinkDepartment;
  linkKind: SceneWorkLinkKind;
  path: string;
  label?: string | null;
  sortOrder?: number;
  userId?: string | null;
}

export interface SupabaseSceneWorkLink {
  id: string;
  sceneUuid: string;
  department: SceneWorkLinkDepartment;
  linkKind: SceneWorkLinkKind;
  path: string;
  label: string | null;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
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

type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
};

function isMissingCommentReadStateRpcError(error: SupabaseErrorLike | null): boolean {
  if (!error) return false;

  const message = String(error.message ?? '').toLowerCase();
  return error.code === 'PGRST202'
    || (
      message.includes('upsert_comment_read_state')
      && message.includes('could not find the function')
      && message.includes('schema cache')
    );
}

function isDuplicateKeyError(error: SupabaseErrorLike | null): boolean {
  if (!error) return false;
  const message = String(error.message ?? '').toLowerCase();
  return error.code === '23505' || message.includes('duplicate key');
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
    .select('id, episode_number, title, memo, reel_file_path')
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
    created_at?: string | null; updated_at?: string | null;
    scene_state?: string | null; work_round?: number | null; feedback_round?: number | null;
  }[] = [];

  if (partIds.length > 0) {
    // Supabase IN 쿼리는 최대 수백 개까지 괜찮음.
    // PostgREST 는 한 응답을 기본 1000행으로 제한한다. 스튜디오 전체 씬이 1000개를 넘으면
    // 단일 select 로는 뒷부분(높은 sort_order) 씬이 통째로 누락되고, 그 결과 씬 추가 폼이
    // 이미 존재하는 번호를 "다음 번호"로 제안해 UNIQUE(part_id, scene_number) 위반(중복 키)으로
    // 추가가 실패한다. → range() 로 페이지를 끝까지 받아 전체 씬을 적재한다.
    // sort_order 동률이 있어도 페이지 경계에서 누락/중복이 없도록 고유키(id)로 2차 정렬한다.
    const SCENE_PAGE_SIZE = 1000;
    for (let from = 0; ; from += SCENE_PAGE_SIZE) {
      const { data: sceneRows, error: sceneErr } = await supabase
        .from('scenes')
        .select('id, part_id, scene_number, sort_order, memo, storyboard_url, guide_url, assignee, layout, lo, done, review, png, length_change, created_at, updated_at, scene_state, work_round, feedback_round')
        .in('part_id', partIds)
        .order('sort_order')
        .order('id')
        .range(from, from + SCENE_PAGE_SIZE - 1);
      throwIfError(sceneErr);
      if (!sceneRows || sceneRows.length === 0) break;
      scenes.push(...sceneRows);
      if (sceneRows.length < SCENE_PAGE_SIZE) break;
    }
  }

  const sceneCompletionById = new Map<string, { completedBy: string; completedAt: string }>();
  const sceneIds = scenes.map((scene) => scene.id);
  if (sceneIds.length > 0) {
    // PostgREST 는 GET 쿼리의 URL 길이 한계가 약 2~4KB.
    // UUID 36자 × N개를 `in(...)` 파라미터로 넣으면 200~300개를 넘어서는 순간 400 Bad Request.
    // 스튜디오 규모 확장(에피소드당 150~300씬 × 수십 에피소드)에 대비해 배치 분할.
    // 100개 배치 = URL 약 3.7KB, 10,000개 씬도 100회 RTT 로 커버 가능.
    // 향후 데이터가 수만 건 규모로 커지면 PostgreSQL RPC 함수로 POST 1회 호출로 전환 고려.
    const BATCH = 100;
    const completionRows: Array<{ key: string; value: string | null }> = [];
    for (let i = 0; i < sceneIds.length; i += BATCH) {
      const chunk = sceneIds.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('metadata')
        .select('key, value')
        .eq('type', SCENE_COMPLETION_META_TYPE)
        .in('key', chunk);
      throwIfError(error);
      if (data) completionRows.push(...(data as Array<{ key: string; value: string | null }>));
    }
    for (const row of completionRows) {
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
      reelFilePath: (ep as { reel_file_path?: string | null }).reel_file_path ?? null,
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
            lengthChange: (s as { length_change?: 'LD' | 'SD' | null }).length_change ?? null,
            createdAt: s.created_at || undefined,
            updatedAt: s.updated_at || undefined,
            // v1.25.0~ 액팅 단계 토글 (BG 씬은 NULL 유지)
            sceneState: (s as { scene_state?: string | null }).scene_state ?? null,
            workRound: (s as { work_round?: number | null }).work_round ?? 0,
            feedbackRound: (s as { feedback_round?: number | null }).feedback_round ?? 0,
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

  // 이슈 F(2026-04-23): 같은 이름의 soft-deleted 파트가 있으면 진짜 DELETE로 정리.
  // UNIQUE(episode_id, part_id, department) 제약이 deleted 행을 잡고 있어 재생성이 실패하던 문제 해결.
  // CASCADE 덕분에 해당 파트의 자식 scenes·comments·comp_revisions까지 자동 정리되어
  // '같은 이름 재생성 시 데이터 계승' 버그도 동시에 차단.
  for (const d of depts) {
    const { error: delErr } = await supabase
      .from('parts')
      .delete()
      .eq('episode_id', ep!.id)
      .eq('part_id', partId)
      .eq('department', d)
      .eq('status', 'deleted');
    if (delErr) throwIfError(delErr);
  }

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
): Promise<{ sceneUuid: string | null }> {
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

  // INSERT + RETURNING id — audit 에서 sceneId 채움 (한솔 결정 2026-05-02).
  const { data, error } = await supabase
    .from('scenes')
    .insert({
      part_id: partUuid,
      scene_number: sceneId,
      sort_order: nextOrder,
      assignee,
      memo,
    })
    .select('id')
    .single();
  throwIfError(error);
  broadcastDataChange('scenes', 'INSERT');
  return { sceneUuid: (data?.id as string) ?? null };
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

/** 씬 삭제 (UUID로 삭제) — DB row 삭제 전에 Storage 이미지 먼저 정리해 고아 파일 방지 */
export async function deleteScene(sceneUuid: string): Promise<void> {
  // 1) Storage 이미지 URL 조회 (DB 삭제 전에)
  const { data: scene } = await supabase
    .from('scenes')
    .select('storyboard_url, guide_url')
    .eq('id', sceneUuid)
    .maybeSingle();

  // 2) Storage 삭제 (실패해도 DB 삭제는 계속 — 부분 고아 < 완전 고아)
  if (scene?.storyboard_url) {
    await storageDeleteImage(scene.storyboard_url).catch((err) =>
      console.warn('[Storage] storyboard 삭제 실패:', err));
  }
  if (scene?.guide_url) {
    await storageDeleteImage(scene.guide_url).catch((err) =>
      console.warn('[Storage] guide 삭제 실패:', err));
  }

  // 3) DB row 삭제 (comments 등은 FK CASCADE 로 자동 정리)
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

/** v1.25.0~ 액팅 씬 단계 상태 + 차수 업데이트 (한 번의 트랜잭션으로 3컬럼 동기화).
 *  spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md (섹션 7-3)
 *
 *  코덱스 5차 P1 #11 fix: scene_state 변경 시 legacy lo/done/review/png 도 함께 dual-write.
 *  calcStats, sheet 뷰 등 다른 surface 가 아직 legacy boolean 을 읽으므로 split state 방지.
 *  마이그레이션 SQL 의 매핑과 round-trip 가능하도록 다음 규칙:
 *    wait     → 모두 false (체크 없음)
 *    work     → lo=true, done=true (2원화까지 체크)
 *    feedback → lo=true, done=true, review=true (동화까지 체크)
 *    done     → 모두 true (최종까지 체크)
 *  BG 가 새 시스템 도입 시 dual-write 는 제거하고 새 컬럼 단일 진실이 됨. */
export async function updateScenePhase(
  sceneUuid: string,
  sceneState: 'wait' | 'work' | 'feedback' | 'done',
  workRound: number,
  feedbackRound: number,
  updatedBy?: string,
): Promise<void> {
  const legacyFlags = (() => {
    switch (sceneState) {
      case 'wait':     return { lo: false, done: false, review: false, png: false };
      case 'work':     return { lo: true,  done: true,  review: false, png: false };
      case 'feedback': return { lo: true,  done: true,  review: true,  png: false };
      case 'done':     return { lo: true,  done: true,  review: true,  png: true  };
    }
  })();
  const update: Record<string, unknown> = {
    scene_state: sceneState,
    work_round: workRound,
    feedback_round: feedbackRound,
    ...legacyFlags,
    updated_at: new Date().toISOString(),
  };
  if (updatedBy) update.updated_by = updatedBy;
  const { error } = await supabase.from('scenes').update(update).eq('id', sceneUuid);
  throwIfError(error);
  broadcastScenePhaseUpdate(sceneUuid, sceneState, workRound, feedbackRound, updatedBy);
  // legacy stage 도 broadcast — 다른 view 가 즉시 반영하도록 4개 컬럼 각각
  for (const [stage, value] of Object.entries(legacyFlags)) {
    broadcastSceneUpdate(sceneUuid, stage, value, updatedBy);
  }
}

// ═══════════════════════════════════════════════
// v1.25.5 ACTING FEEDBACK NOTIFICATIONS (catch-up)
// ═══════════════════════════════════════════════
// broadcast 만으로는 오프라인/로그아웃 시 영구 손실 → DB row 영구 저장.
// 댓글 멘션 catch-up 흐름과 평행 구조 (fetchMissedMentions 와 같은 패턴).

export interface FeedbackNotificationPayload {
  senderId: string;
  senderName: string;
  sceneUuid: string;
  sceneId: string;
  sheetName: string;
  episodeNumber: number;
  fromState: string;
  toState: string;
  workRound: number;
  feedbackRound: number;
  message?: string;
}

export interface MissedFeedbackNotification {
  id: string;
  senderId: string;
  senderName: string;
  sceneUuid: string | null;
  sceneId: string;
  sheetName: string;
  episodeNumber: number;
  fromState: string | null;
  toState: string;
  workRound: number;
  feedbackRound: number;
  message: string | null;
  createdAt: string;
}

/** 알림 row INSERT — recipient 한 명당 한 row. broadcast 와 별개 영구 저장.
 *  v1.25.5 코덱스 1차 P2 #3 fix: INSERT 결과의 (recipient_id, id) 매핑을 반환 →
 *  broadcast payload 에 포함시켜 수신자가 자기 row ID 로 markRead 가능. */
export interface FeedbackInsertResult {
  id: string;
  createdAt: string;
}

export async function insertActingFeedbackNotifications(
  payload: FeedbackNotificationPayload,
  recipientIds: string[],
): Promise<Record<string, FeedbackInsertResult>> {
  if (recipientIds.length === 0) return {};
  const rows = recipientIds.map((rid) => ({
    sender_id: payload.senderId,
    sender_name: payload.senderName,
    recipient_id: rid,
    scene_uuid: payload.sceneUuid || null,
    scene_id: payload.sceneId,
    sheet_name: payload.sheetName,
    episode_number: payload.episodeNumber,
    from_state: payload.fromState || null,
    to_state: payload.toState,
    work_round: payload.workRound,
    feedback_round: payload.feedbackRound,
    message: payload.message ?? null,
  }));
  const { data, error } = await supabase
    .from('acting_feedback_notifications')
    .insert(rows)
    .select('id, recipient_id, created_at');
  throwIfError(error);
  const map: Record<string, FeedbackInsertResult> = {};
  for (const r of (data ?? []) as Array<{ id: string; recipient_id: string; created_at: string }>) {
    map[r.recipient_id] = { id: r.id, createdAt: r.created_at };
  }
  return map;
}

/** 로그인 catch-up — 마지막 본 시각 이후 미읽음 알림 일괄 조회.
 *  v1.25.5 코덱스 1차 P1 #2 fix: 페이지네이션용 before 파라미터 (created_at < before).
 *  렌더러가 limit 만큼 받았으면 batch[N-1].createdAt 으로 다음 페이지 fetch. */
export async function fetchMissedActingFeedbackNotifications(
  userId: string,
  since: string,
  limit = 100,
  before?: string,
): Promise<MissedFeedbackNotification[]> {
  let query = supabase
    .from('acting_feedback_notifications')
    .select('*')
    .eq('recipient_id', userId)
    .gt('created_at', since)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) {
    query = query.lt('created_at', before);
  }
  const { data, error } = await query;
  throwIfError(error);
  return ((data ?? []) as Array<{
    id: string; sender_id: string; sender_name: string;
    scene_uuid: string | null; scene_id: string; sheet_name: string;
    episode_number: number; from_state: string | null; to_state: string;
    work_round: number | null; feedback_round: number | null;
    message: string | null; created_at: string;
  }>).map((r) => ({
    id: r.id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    sceneUuid: r.scene_uuid,
    sceneId: r.scene_id,
    sheetName: r.sheet_name,
    episodeNumber: r.episode_number,
    fromState: r.from_state,
    toState: r.to_state,
    workRound: r.work_round ?? 0,
    feedbackRound: r.feedback_round ?? 0,
    message: r.message,
    createdAt: r.created_at,
  }));
}

/** 알림 읽음 처리 — read_at = now() */
export async function markActingFeedbackNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('acting_feedback_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
  throwIfError(error);
}

// ═══════════════════════════════════════════════
// v1.25.8 SCENE ASSIGNMENT NOTIFICATIONS (catch-up)
// ═══════════════════════════════════════════════
// 씬 담당자 배정 시 새 담당자에게 알림. broadcast 만 의존하던 동작에 DB 영구 저장 +
// 로그인 catch-up 추가. acting_feedback_notifications 와 동일한 패턴.

export interface SceneAssignmentPayload {
  sceneUuid: string;
  prevAssignee: string;
  newAssignee: string;
  senderId: string;
  senderName: string;
}

export interface MissedAssignmentNotification {
  id: string;
  senderId: string;
  senderName: string;
  sceneUuid: string;
  sceneId: string;
  sheetName: string;
  episodeNumber: number;
  prevAssignee: string | null;
  newAssignee: string;
  createdAt: string;
}

/** v1.25.8 코덱스 1차 P2 fix: assignee 는 콤마 구분 multi-value 일 수 있다 (AssigneeMultiSelect).
 *  공백/빈 토큰 제거 + 중복 제거. */
function parseAssigneeList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of raw.split(',')) {
    const t = tok.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export interface AssignmentInsertResult {
  recipientId: string;
  recipientName: string;
  notificationId: string;
  createdAt: string;
}

/** 알림 row INSERT — v1.25.8 코덱스 1차 P2 fix: comma-separated multi-assignee 지원.
 *  prev → new 차집합으로 *새로 추가된* 담당자만 알림 (기존 담당자는 제외).
 *  반환: 추가된 (recipientId, recipientName, notificationId) 배열. 빈 배열이면 알림 없음.
 *  씬 메타(scene_id, sheet_name, episode_number) 는 한 번만 조회해서 모든 row 에 재사용. */
export async function insertSceneAssignmentNotifications(
  payload: SceneAssignmentPayload,
): Promise<AssignmentInsertResult[]> {
  const newNames = parseAssigneeList(payload.newAssignee);
  if (newNames.length === 0) return [];
  const prevSet = new Set(parseAssigneeList(payload.prevAssignee));
  const addedNames = newNames.filter((n) => !prevSet.has(n));
  if (addedNames.length === 0) return [];

  // 1) 추가된 이름들로 user 일괄 조회 (in 쿼리)
  const { data: userRows, error: userErr } = await supabase
    .from('users')
    .select('id, name')
    .in('name', addedNames);
  if (userErr) throwIfError(userErr);
  const userMap = new Map<string, string>();
  for (const u of ((userRows ?? []) as Array<{ id: string; name: string }>)) {
    userMap.set(u.name, u.id);
  }

  // 2) 씬 메타 조회 (한 번만)
  const { data: sceneRow, error: sceneErr } = await supabase
    .from('scenes')
    .select('scene_number, parts(part_id, department, episodes(episode_number))')
    .eq('id', payload.sceneUuid)
    .maybeSingle();
  if (sceneErr) throwIfError(sceneErr);
  if (!sceneRow) return [];
  // Supabase 의 관계 join 은 결과가 array 로 옴 (1:N 추론). FK 가 unique 임을 모르므로.
  //  → 첫 요소만 사용하는 단일 객체로 평탄화.
  type PartRel = { part_id?: string; department?: string; episodes?: { episode_number?: number } | { episode_number?: number }[] | null };
  const s = sceneRow as unknown as {
    scene_number: string;
    parts?: PartRel | PartRel[] | null;
  };
  const firstPart: PartRel | null = Array.isArray(s.parts) ? (s.parts[0] ?? null) : (s.parts ?? null);
  const epRel = firstPart?.episodes;
  const firstEp: { episode_number?: number } | null = Array.isArray(epRel) ? (epRel[0] ?? null) : (epRel ?? null);
  const epNum = firstEp?.episode_number ?? 0;
  const partId = firstPart?.part_id ?? 'A';
  const dept = firstPart?.department ?? 'bg';
  const deptSuffix = dept === 'acting' ? '_ACT' : '_BG';
  const sheetName = `EP${String(epNum).padStart(2, '0')}_${partId}${deptSuffix}`;

  // 3) 추가된 이름별로 row INSERT — 자기 자신 / user 못 찾음은 skip
  const results: AssignmentInsertResult[] = [];
  for (const name of addedNames) {
    const recipientId = userMap.get(name);
    if (!recipientId) continue; // 존재하지 않는 user → skip (오타/외부 이름)
    if (recipientId === payload.senderId) continue; // 자기 자신 배정 → skip
    const { data: inserted, error: insErr } = await supabase
      .from('scene_assignment_notifications')
      .insert({
        sender_id: payload.senderId,
        sender_name: payload.senderName,
        recipient_id: recipientId,
        scene_uuid: payload.sceneUuid,
        scene_id: s.scene_number,
        sheet_name: sheetName,
        episode_number: epNum,
        prev_assignee: payload.prevAssignee || null,
        new_assignee: payload.newAssignee,
      })
      .select('id, created_at')
      .single();
    if (insErr) throwIfError(insErr);
    if (!inserted) continue;
    const row = inserted as { id: string; created_at: string };
    results.push({
      recipientId,
      recipientName: name,
      notificationId: row.id,
      createdAt: row.created_at,
    });
  }
  return results;
}

/** 로그인 catch-up — 마지막 본 시각 이후 미읽음 배정 알림 일괄 조회. */
export async function fetchMissedSceneAssignmentNotifications(
  userId: string,
  since: string,
  limit = 100,
  before?: string,
): Promise<MissedAssignmentNotification[]> {
  let query = supabase
    .from('scene_assignment_notifications')
    .select('*')
    .eq('recipient_id', userId)
    .gt('created_at', since)
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query;
  throwIfError(error);
  return ((data ?? []) as Array<{
    id: string; sender_id: string; sender_name: string;
    scene_uuid: string; scene_id: string; sheet_name: string;
    episode_number: number; prev_assignee: string | null; new_assignee: string;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    senderId: r.sender_id,
    senderName: r.sender_name,
    sceneUuid: r.scene_uuid,
    sceneId: r.scene_id,
    sheetName: r.sheet_name,
    episodeNumber: r.episode_number,
    prevAssignee: r.prev_assignee,
    newAssignee: r.new_assignee,
    createdAt: r.created_at,
  }));
}

/** 알림 읽음 처리 */
export async function markSceneAssignmentNotificationRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('scene_assignment_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
  throwIfError(error);
}

/** 대량 씬 체크박스 토글 (부분 실패 허용) — RPC 경유 */
export async function bulkUpdateSceneStages(
  updates: BulkStageUpdate[],
  updatedBy: string,
  userName?: string | null,
): Promise<BulkUpdateResult[]> {
  const { data, error } = await supabase.rpc('bulk_update_scene_stages', {
    // undefined는 key를 누락시켜 RPC가 "메타 건드리지 않음"으로 인식,
    // null/string은 key 포함해 "명시적 clear/upsert"로 인식되게 한다.
    p_updates: updates.map((u) => {
      const payload: Record<string, unknown> = {
        sceneUuid: u.sceneUuid,
        stage: u.stage,
        value: u.value,
      };
      if (u.completedBy !== undefined) payload.completedBy = u.completedBy;
      if (u.completedAt !== undefined) payload.completedAt = u.completedAt;
      return payload;
    }),
    p_updated_by: updatedBy,
    p_user_name: userName ?? null,
  });
  if (error) throw error;
  return maybeForceFail(mapRpcRows(data as RpcRow[] | null));
}

/** 대량 씬 삭제 (부분 실패 허용) — RPC 경유.
 *  bulk_delete_scenes 는 부분 성공을 허용하므로, Storage 이미지는
 *  "RPC 에서 성공적으로 DB 삭제된 씬"에 대해서만 정리해야 한다.
 *  (Codex 리뷰 #1 P1 — RPC 전에 모두 삭제하면 실패한 씬이 이미지 잃은 채 DB 에 남음.) */
export async function bulkDeleteScenes(
  sceneUuids: string[],
  deletedBy: string,
  userName?: string | null,
): Promise<BulkUpdateResult[]> {
  // 1) 씬 UUID → 이미지 URL + 활동 메타 자동 조회 (RPC 호출 전에 한 번에)
  const urlsByUuid = new Map<string, string[]>();
  const meta: Array<{
    sceneUuid: string; sceneLabel: string | null;
    episodeNumber: number | null; department: string | null;
  }> = [];
  {
    const { data: scenes } = await supabase
      .from('scenes')
      .select('id, scene_number, storyboard_url, guide_url, parts(part_id, department, episodes(episode_number))')
      .in('id', sceneUuids);
    for (const s of (scenes ?? []) as Array<{
      id: string; scene_number: string;
      storyboard_url: string | null; guide_url: string | null;
      parts?: { part_id?: string; department?: string; episodes?: { episode_number?: number } };
    }>) {
      // 이미지 URL
      const urls: string[] = [];
      if (s.storyboard_url) urls.push(s.storyboard_url);
      if (s.guide_url) urls.push(s.guide_url);
      if (urls.length > 0) urlsByUuid.set(s.id, urls);
      // 활동 메타 (RPC 도 자동 조회하지만 클라이언트 전달로 안전성 강화 — Codex P2)
      const part = s.parts;
      const epNum = part?.episodes?.episode_number ?? null;
      const partLabel = part?.part_id ?? null;
      const sceneLabel = epNum && partLabel
        ? `EP${String(epNum).padStart(2, '0')} ${partLabel} #${s.scene_number}`
        : `씬 #${s.scene_number}`;
      meta.push({
        sceneUuid: s.id,
        sceneLabel,
        episodeNumber: epNum,
        department: part?.department ?? null,
      });
    }
  }

  // 2) RPC 실행 (부분 실패 허용)
  const { data, error } = await supabase.rpc('bulk_delete_scenes', {
    p_uuids: sceneUuids,
    p_deleted_by: deletedBy,
    p_user_name: userName ?? null,
    p_meta: meta,
  });
  if (error) throw error;
  const results = maybeForceFail(mapRpcRows(data as RpcRow[] | null));

  // 3) RPC 에서 성공적으로 DB 삭제된 씬에 한해서만 Storage 이미지 정리
  const urlsToDelete: string[] = [];
  for (const r of results) {
    if (!r.success) continue;
    const urls = urlsByUuid.get(r.sceneUuid);
    if (urls) urlsToDelete.push(...urls);
  }
  if (urlsToDelete.length > 0) {
    await Promise.allSettled(urlsToDelete.map((u) => storageDeleteImage(u)));
  }

  return results;
}

/** 대량 씬 필드 업데이트 (부분 실패 허용) — RPC 경유 */
export async function bulkUpdateSceneFields(
  updates: BulkFieldUpdate[],
  updatedBy: string,
  userName?: string | null,
): Promise<BulkUpdateResult[]> {
  // 활동 기록 메타 사전 조회 (RPC 도 자동 조회 fallback 있지만 클라이언트 측 전달로 안전성 강화 — Codex P1)
  const metaByUuid = new Map<string, { sceneLabel: string; episodeNumber: number | null; department: string | null }>();
  if (userName) {
    const { data: metaRows } = await supabase
      .from('scenes')
      .select('id, scene_number, parts(part_id, department, episodes(episode_number))')
      .in('id', updates.map((u) => u.sceneUuid));
    for (const r of (metaRows ?? []) as Array<{
      id: string; scene_number: string;
      parts?: { part_id?: string; department?: string; episodes?: { episode_number?: number } };
    }>) {
      const part = r.parts;
      const epNum = part?.episodes?.episode_number ?? null;
      const partLabel = part?.part_id ?? null;
      const sceneLabel = epNum && partLabel
        ? `EP${String(epNum).padStart(2, '0')} ${partLabel} #${r.scene_number}`
        : `씬 #${r.scene_number}`;
      metaByUuid.set(r.id, { sceneLabel, episodeNumber: epNum, department: part?.department ?? null });
    }
  }

  const { data, error } = await supabase.rpc('bulk_update_scene_fields', {
    p_updates: updates.map((u) => {
      const meta = metaByUuid.get(u.sceneUuid);
      return {
        sceneUuid: u.sceneUuid,
        fields: {
          assignee: u.fields.assignee,
          memo: u.fields.memo,
          layout: u.fields.layoutId,
          storyboardUrl: u.fields.storyboardUrl,
          guideUrl: u.fields.guideUrl,
        },
        sceneLabel: meta?.sceneLabel ?? null,
        episodeNumber: meta?.episodeNumber ?? null,
        department: meta?.department ?? null,
      };
    }),
    p_updated_by: updatedBy,
    p_user_name: userName ?? null,
  });
  if (error) throw error;
  return maybeForceFail(mapRpcRows(data as RpcRow[] | null));
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
    lengthChange: 'length_change',
    // v1.30.0+: 컴포지팅 대시보드의 파트 막대 리사이즈가 씬 길이를 비례 조정할 때 사용.
    durationFrames: 'duration_frames',
  };
  const dbField = fieldMap[field] || field;
  // length_change: 빈 문자열은 NULL 로 저장 (CHECK constraint: NULL | 'LD' | 'SD' 만 허용)
  const persistedValue = dbField === 'length_change' && value === '' ? null : value;
  const update: Record<string, unknown> = { [dbField]: persistedValue, updated_at: new Date().toISOString() };
  if (senderId) update.updated_by = senderId;
  const { error } = await supabase
    .from('scenes')
    .update(update)
    .eq('id', sceneUuid);
  throwIfError(error);
  // v1.16.0 (Codex review fix): broadcast 시 normalized value 전송 — 수신부 의존 없이 모든 컨슈머가 일관 처리.
  broadcastSceneFieldUpdate(sceneUuid, field, persistedValue, senderId);
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
    // v1.18.1: 컴포지터 단일 boolean (한솔 정정 — BG/ACT 부서 구분 없음)
    isCompositor: u.is_compositor === true,
    // v1.25.0~: 액팅 검수자 (컴포지터와 독립)
    isActingSupervisor: u.is_acting_supervisor === true,
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

/** 사용자 업데이트.
 *  v1.18.1: isCompositor(boolean) 처리를 위해 value 타입을 string | boolean | null 로 확장.
 *  Postgres update 는 null 을 명시적으로 SET … = NULL 로 적용하므로 그대로 전달.
 */
export async function updateUser(
  userId: string,
  updates: Record<string, string | boolean | null>,
): Promise<void> {
  // camelCase → snake_case 변환
  const dbUpdates: Record<string, unknown> = {};
  const fieldMap: Record<string, string> = {
    name: 'name', role: 'role', password: 'password',
    slackId: 'slack_id', hireDate: 'hire_date', birthday: 'birthday',
    isInitialPassword: 'is_initial_password',
    isCompositor: 'is_compositor',
    isActingSupervisor: 'is_acting_supervisor',
  };
  for (const [k, v] of Object.entries(updates)) {
    dbUpdates[fieldMap[k] || k] = v;
  }
  const { error } = await supabase.from('users').update(dbUpdates).eq('id', userId);
  throwIfError(error);
  broadcastDataChange('users', 'UPDATE');
}

/** 사용자 삭제.
 *  퇴사자 처리와 개인 데이터 정리를 DB RPC 한 트랜잭션으로 수행한다.
 *  - scenes.assignee, comp_revisions.assignee 는 NULL 로 비움
 *  - personal_todos / task_views / memos / private_calendar_events 는 삭제
 *  - comments / activity_log 는 역사 기록으로 보존
 *  부분 실패로 개인 데이터만 사라지는 상태를 막기 위해 앱 코드에서 순차 delete 하지 않는다.
 */
export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_user_cascade', { p_user_id: userId });
  throwIfError(error);
  broadcastDataChange('users', 'DELETE');
}

// ═══════════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════════

/**
 * 한솔 결정 (v1.15.5): 로그인 catch-up — 사용자가 last seen 이후 받은 멘션 댓글을 일괄 조회.
 *
 * - mentions 배열에 userName 이 포함된 댓글
 * - created_at > since
 * - 본인이 작성한 댓글 제외
 * - 최대 limit 개 (기본 50). 새로운 것부터.
 */
export async function fetchMissedMentions(
  userId: string,
  userName: string,
  since: string,
  limit = 50,
): Promise<SupabaseComment[]> {
  // 한솔 보고 (v1.15.7): .contains('mentions', [userName]) 가 mentions 컬럼 타입과 충돌
  // ("invalid input syntax for type json"). server filter 에서 mentions 빼고 client 에서 처리.
  //
  // Codex P2 fix: 단순 200 cap 으로 자르면 사용자가 busy 기간 후 복귀 시 200개 안에 멘션이 없는
  // 케이스에서 누락. limit (50개 매치) 찾을 때까지 또는 데이터 끝까지 페이지네이션.
  const PAGE_SIZE = 200;
  const MAX_PAGES = 10;  // 안전 cap — 최대 2000개까지 스캔
  const matched: SupabaseComment[] = [];
  let pageOffset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from('comments')
      .select('*')
      .gt('created_at', since)
      .neq('user_id', userId)
      .is('character_id', null)  // 캐릭터 댓글은 씬 멘션 catch-up 에서 제외(씬 네비게이션이 없어 깨진 알림 방지).
      .order('created_at', { ascending: false })
      .range(pageOffset, pageOffset + PAGE_SIZE - 1);
    if (error) throw new Error(`fetchMissedMentions failed: ${error.message}`);

    const rows = data || [];
    if (rows.length === 0) break;

    for (const c of rows) {
      if (!Array.isArray(c.mentions) || !c.mentions.includes(userName)) continue;
      matched.push({
        id: c.id,
        partId: c.part_id,
        sceneId: c.scene_id,
        sceneUuid: c.scene_uuid ?? null,  // v1.15.9: 정확 씬 매칭용
        userId: c.user_id,
        userName: c.user_name,
        text: c.text,
        mentions: c.mentions || [],
        images: c.images || [],            // v1.15.12: 이미지 첨부
        createdAt: c.created_at,
        editedAt: c.edited_at,
        revisionId: c.revision_id ?? null, // v1.18.0: 리비전 맥락 댓글 표시용
      });
      if (matched.length >= limit) return matched;
    }

    if (rows.length < PAGE_SIZE) break;  // 더 이상 데이터 없음
    pageOffset += PAGE_SIZE;
  }

  return matched;
}

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
    images: c.images || [],
    createdAt: c.created_at,
    editedAt: c.edited_at,
    // v1.18.0: 리비전 ↔ 씬 댓글 단일 흐름 — revision_id 가 NULL 이면 일반 씬 댓글, 값 있으면 리비전 맥락 댓글.
    revisionId: c.revision_id ?? null,
    // v1.24.0: 1단계 대댓글 부모 참조. NULL 이면 일반 댓글.
    parentCommentId: c.parent_comment_id ?? null,
  }));
}

/**
 * 캐릭터별 댓글 읽기 (캐릭터 현황판 상세 스레드용).
 * readCommentsForPart 미러 — 같은 comments 테이블, character_id 로 필터. part_id/scene_id 는 NULL.
 */
export async function readCommentsForCharacter(characterId: string): Promise<SupabaseComment[]> {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('character_id', characterId)
    .order('created_at');
  throwIfError(error);
  return (data || []).map((c) => ({
    id: c.id,
    partId: c.part_id,
    sceneId: c.scene_id,
    characterId: c.character_id ?? null,
    costumeId: c.costume_id ?? null,
    userId: c.user_id,
    userName: c.user_name,
    text: c.text,
    mentions: c.mentions || [],
    images: c.images || [],
    createdAt: c.created_at,
    editedAt: c.edited_at,
    revisionId: c.revision_id ?? null,
    parentCommentId: c.parent_comment_id ?? null,
  }));
}

export async function readCommentReadStates(userId: string): Promise<CommentReadStateRow[]> {
  const safeUserId = userId.trim();
  if (!safeUserId) return [];

  const { data, error } = await supabase
    .from('comment_read_states')
    .select('user_id, scene_thread_key, last_read_at, updated_at')
    .eq('user_id', safeUserId)
    .order('updated_at', { ascending: false });

  throwIfError(error);

  return (data ?? []).map((row: any) => ({
    userId: String(row.user_id ?? ''),
    sceneThreadKey: String(row.scene_thread_key ?? ''),
    lastReadAt: String(row.last_read_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  })).filter((row) => row.userId && row.sceneThreadKey && row.lastReadAt);
}

export async function upsertCommentReadState(
  userId: string,
  sceneThreadKey: string,
  lastReadAt: string,
): Promise<void> {
  const safeUserId = userId.trim();
  const safeSceneThreadKey = sceneThreadKey.trim();
  const readMs = Date.parse(lastReadAt);

  if (!safeUserId || !safeSceneThreadKey || !Number.isFinite(readMs)) {
    throw new Error('invalid comment read state input');
  }

  const normalizedLastReadAt = new Date(readMs).toISOString();
  const { error } = await supabase.rpc('upsert_comment_read_state', {
    p_user_id: safeUserId,
    p_scene_thread_key: safeSceneThreadKey,
    p_last_read_at: normalizedLastReadAt,
  });

  if (!error) return;
  if (!isMissingCommentReadStateRpcError(error)) {
    throwIfError(error);
    return;
  }

  await upsertCommentReadStateViaTable(safeUserId, safeSceneThreadKey, normalizedLastReadAt);
}

async function upsertCommentReadStateViaTable(
  userId: string,
  sceneThreadKey: string,
  lastReadAt: string,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const { error: insertError } = await supabase
    .from('comment_read_states')
    .insert({
      user_id: userId,
      scene_thread_key: sceneThreadKey,
      last_read_at: lastReadAt,
      updated_at: updatedAt,
    });

  if (!insertError) return;
  if (!isDuplicateKeyError(insertError)) {
    throwIfError(insertError);
    return;
  }

  const { error: updateError } = await supabase
    .from('comment_read_states')
    .update({
      last_read_at: lastReadAt,
      updated_at: updatedAt,
    })
    .eq('user_id', userId)
    .eq('scene_thread_key', sceneThreadKey)
    .lt('last_read_at', lastReadAt);

  throwIfError(updateError);
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
  images: string[] = [],
  /** v1.18.0: 리비전 맥락 댓글이면 해당 리비전 id, 일반 씬 댓글이면 null. */
  revisionId: string | null = null,
  /** v1.24.0: 1단계 대댓글이면 부모 댓글 id, 일반 댓글이면 null. */
  parentCommentId: string | null = null,
  /** 캐릭터 현황판 댓글이면 캐릭터 id. 값이 있으면 part_id/scene_id 대신 character_id 로 저장한다. */
  characterId: string | null = null,
  /** 캐릭터 댓글의 복장 맥락(선택). 이번 스레드 분기엔 미사용. */
  costumeId: string | null = null,
): Promise<void> {
  // v1.24.0 P1 #9 / P1 #7: parent_comment_id / revision_id 가 null 이면 payload 에서 키 자체 제거.
  //   self-reference 차단 — 같은 id 가 부모로 들어오면 null 처리.
  const safeParent = parentCommentId && parentCommentId !== commentId ? parentCommentId : null;

  // 캐릭터 댓글 경로 — part_id/scene_id 없이 character_id 로 저장. 씬 UUID 해석/씬 broadcast 모두 스킵.
  if (characterId) {
    const characterPayload: Record<string, unknown> = {
      id: commentId,
      character_id: characterId,
      user_id: userId,
      user_name: userName,
      text,
      mentions,
      images,
      created_at: createdAt,
    };
    if (costumeId) characterPayload.costume_id = costumeId;
    if (revisionId) characterPayload.revision_id = revisionId;
    if (safeParent) characterPayload.parent_comment_id = safeParent;
    const { error: charError } = await supabase.from('comments').insert(characterPayload);
    throwIfError(charError);
    // 캐릭터 댓글도 다른 창이 즉시 반응하도록 broadcast — sceneId 자리에 char:{id} 식별자 전달.
    broadcastCommentAdded(`char:${characterId}`, userName, userId, text, mentions, commentId, safeParent, undefined, revisionId);
    return;
  }

  // 이슈 F(2026-04-23) + Codex P1(2차): 댓글 경로의 sceneId는 scene.no (=sort_order).
  // sort_order 정확 매칭으로 scene_number 표기 규칙과 무관하게 정확히 식별.
  // 씬을 못 찾으면 댓글 저장 자체를 거부(앞으로 고아 댓글 신규 생성 차단).
  const sortOrder = Number(String(sceneId).trim());
  const sceneUuid = Number.isFinite(sortOrder)
    ? await resolveSceneUuidBySortOrderWithRetry(partUuid, sortOrder)
    : null;
  if (!sceneUuid) {
    throw new Error(`댓글 저장 실패: 씬을 찾을 수 없음 (partUuid=${partUuid}, sceneId=${sceneId})`);
  }

  const insertPayload: Record<string, unknown> = {
    id: commentId,
    part_id: partUuid,
    scene_id: sceneId,
    scene_uuid: sceneUuid,
    user_id: userId,
    user_name: userName,
    text,
    mentions,
    images,
    created_at: createdAt,
  };
  if (revisionId) insertPayload.revision_id = revisionId;
  if (safeParent) insertPayload.parent_comment_id = safeParent;
  const { error } = await supabase.from('comments').insert(insertPayload);
  throwIfError(error);
  // v1.24.0 P0 #1: broadcast 페이로드에 commentId/parentCommentId/partId 추가 →
  //   렌더러가 realtime/broadcast 어느 쪽에서 먼저 도착하든 같은 알림 분기 호출 가능.
  broadcastCommentAdded(sceneId, userName, userId, text, mentions, commentId, safeParent, partUuid, revisionId);
}

/** 댓글 수정.
 *  Codex P1(2026-04-29): images 가 undefined 면 update payload 에서 빼서 기존 값 보존.
 *  Sheets fallback 으로 attachment 정보를 모르는 댓글을 수정할 때 실 이미지 URL 들을 silently 덮어쓰지 않도록.
 */
export async function editComment(
  commentId: string,
  text: string,
  mentions: string[],
  images?: string[],
): Promise<void> {
  const updates: Record<string, unknown> = {
    text, mentions, edited_at: new Date().toISOString(),
  };
  if (images !== undefined) updates.images = images;
  const { error } = await supabase
    .from('comments')
    .update(updates)
    .eq('id', commentId);
  throwIfError(error);
  broadcastDataChange('comments', 'UPDATE');
}

/** 댓글 삭제.
 *  Codex P2 10차(2026-04-30): comment row 삭제 시 images JSONB 에 저장된 storage 객체들도 함께 정리 →
 *  댓글 삭제 후 storage 에 영구 orphan 파일이 쌓이는 문제 방지.
 */
export async function deleteComment(commentId: string): Promise<void> {
  // 1) 행 삭제 전에 attached image URL 조회.
  // Codex P2 12차(2026-04-30): maybeSingle 의 error 도 명시 체크 — 일시적 네트워크/PostgREST 에러로
  // images 가 [] 로 silent fallback 되면 storage 객체가 정리되지 않은 채 row 만 삭제되어 orphan.
  const { data: row, error: fetchErr } = await supabase
    .from('comments')
    .select('images')
    .eq('id', commentId)
    .maybeSingle();
  if (fetchErr) {
    console.warn('[deleteComment] images 조회 실패 — storage 정리 누락 가능:', fetchErr);
  }
  const images = (row?.images ?? []) as unknown[];

  // 2) 댓글 row 삭제
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  throwIfError(error);

  // 3) storage 객체 정리 (fire-and-forget — 실패해도 row 삭제 자체는 이미 성공)
  const STORAGE_BUCKET = 'scene-images';
  const paths = images
    .filter((u): u is string => typeof u === 'string')
    .map((url) => {
      const m = url.match(/\/storage\/v1\/object\/public\/scene-images\/(.+)$/);
      return m ? m[1] : null;
    })
    .filter((p): p is string => !!p);
  if (paths.length > 0) {
    // Codex P2 11차(2026-04-30): supabase.storage.remove() 는 API 실패 시 throw 대신 { data, error } 를 반환.
    // try/catch 만으로는 잡지 못하므로 error 객체를 명시적으로 확인.
    try {
      const { error: storageErr } = await supabase.storage.from(STORAGE_BUCKET).remove(paths);
      if (storageErr) {
        console.warn('[deleteComment] storage 이미지 정리 실패 (orphan 가능):', storageErr);
      }
    } catch (err) {
      console.warn('[deleteComment] storage 이미지 정리 예외:', err);
    }
  }

  // v1.29.0: 이모지 반응·반응 알림·반응 활동 로그 cleanup (best-effort 순차 — 단일 트랜잭션 미지원).
  //   실패 한 단계가 다음을 막지 않음. orphan 데이터는 추후 cleanup job 으로 처리.
  try {
    // 코덱스 9차 P2: supabase-js mutation 은 error 를 throw 하지 않고 객체로 반환 →
    //   try/catch 만으로는 부분 실패를 잡지 못해 orphan reaction row 남을 수 있음.
    const { error: rxnDelErr } = await supabase.from('comment_reactions').delete().eq('comment_id', commentId);
    if (rxnDelErr) {
      console.warn('[deleteComment] comment_reactions cleanup 에러:', rxnDelErr.message);
    }
  } catch (e) {
    console.warn('[deleteComment] comment_reactions cleanup 예외:', e);
  }
  try {
    // 코덱스 1차 P1: 영향 받은 알림 행 id 들을 먼저 SELECT → DELETE → 각 행마다
    //   broadcastCommentReactionNotificationRemoved 발화. 미발화 시 수신자 클라이언트의 store/disk 에
    //   stale 알림이 남고, catch-up 머지 로직(appendCatchupCommentReactions)은 prepend-only 라
    //   사라진 행을 자동 정리하지 않음.
    const { data: affectedNotifs } = await supabase
      .from('comment_reaction_notifications')
      .select('id, recipient_id, actor_id')
      .eq('comment_id', commentId);
    if (affectedNotifs?.length) {
      // 코덱스 3차 P2: DELETE 결과를 RETURNING 으로 확인 후에만 broadcast 발화.
      //   supabase-js mutation 은 error 를 throw 하지 않고 객체로 반환 — 실패 시에도 broadcast
      //   를 보내면 client store 에선 제거되지만 DB row 가 남아 catch-up 에서 재출현하는 문제.
      const targetIds = affectedNotifs.map((r) => r.id);
      const { data: deletedRows, error: delErr } = await supabase
        .from('comment_reaction_notifications')
        .delete()
        .in('id', targetIds)
        .select('id');
      if (delErr) {
        console.warn('[deleteComment] comment_reaction_notifications DELETE 에러:', delErr.message);
      } else if (deletedRows?.length) {
        const deletedIdSet = new Set(deletedRows.map((r) => r.id));
        for (const row of affectedNotifs) {
          if (!deletedIdSet.has(row.id)) continue;
          broadcastCommentReactionNotificationRemoved({
            recipientId: row.recipient_id,
            notificationId: row.id,
            deleted: true,
            emoji: '',
            commentId,
            actorId: row.actor_id,
          });
        }
      }
    }
  } catch (e) {
    console.warn('[deleteComment] comment_reaction_notifications cleanup 실패:', e);
  }
  try {
    // 코덱스 10차 P1: activities 가 아니라 activity_log 테이블에서 cleanup.
    const { data: affectedActs } = await supabase
      .from('activity_log')
      .select('id')
      .eq('action_type', 'comment_reaction')
      .filter('detail->>commentId', 'eq', commentId);
    if (affectedActs?.length) {
      const { data: deletedActs, error: delErr } = await supabase
        .from('activity_log')
        .delete()
        .in('id', affectedActs.map((r) => r.id))
        .select('id');
      if (delErr) {
        console.warn('[deleteComment] activity_log DELETE 에러:', delErr.message);
      } else if (deletedActs?.length) {
        for (const r of deletedActs) {
          broadcastActivityRemoved({ activityId: r.id });
        }
      }
    }
  } catch (e) {
    console.warn('[deleteComment] activity_log cleanup 예외:', e);
  }

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

/** 리비전 삭제 — 권한 검증(요청자 본인 또는 admin) 후 Storage 이미지 정리 + DB row 삭제.
 *  Codex 리뷰 #5 P2: UI 의 canDelete 체크만으로는 다른 renderer 호출이 bypass 가능 →
 *  main 프로세스에서 반드시 권한 검증 수행. */
export async function deleteRevision(id: string, requesterUserId: string): Promise<void> {
  // 1) 리비전 + 요청자 정보 + 권한자 role 조회
  const { data: rev } = await supabase
    .from('comp_revisions')
    .select('image_url, requester_id')
    .eq('id', id)
    .maybeSingle();

  if (!rev) return; // 이미 없으면 no-op

  const isOwner = rev.requester_id === requesterUserId;
  let isAdmin = false;
  if (!isOwner) {
    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('id', requesterUserId)
      .maybeSingle();
    isAdmin = (user as { role?: string } | null)?.role === 'admin';
  }
  if (!isOwner && !isAdmin) {
    throw new Error('리비전 삭제 권한이 없습니다. (요청자 본인 또는 관리자만)');
  }

  // 2) Storage 이미지 삭제 (실패해도 DB 삭제 계속)
  const imageUrl = (rev as { image_url?: string }).image_url;
  if (imageUrl) {
    await storageDeleteImage(imageUrl).catch((err) =>
      console.warn('[Storage] revision 이미지 삭제 실패:', err));
  }

  // 3) DB row 삭제
  const { error } = await supabase.from('comp_revisions').delete().eq('id', id);
  throwIfError(error);
  broadcastDataChange('comp_revisions', 'DELETE');
}

/** 모든 리비전 읽기 */
export async function readAllRevisions(): Promise<(SupabaseRevision & { sceneKey: string; notifyUserIds: string[] })[]> {
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
  lookupDepartment: string,
  requesterId: string,
  requesterName: string,
  assignee: string,
  createdAt: string,
  notifyUserIdsJson?: string,
  assigneeIdsJson?: string,
  setId?: string,
): Promise<void> {
  // 전반(리테이크 허브 '전반' 항목): sceneId 비어있으면 씬 UUID 해석을 건너뛴다(part/scene/scene_uuid = null).
  const isGeneral = !sceneId || !sceneId.trim();
  let resolvedPartUuid: string | null = partUuid || null;
  let sceneUuid: string | null = null;

  if (!isGeneral) {
    // partUuid가 비어있으면 sceneId(=sceneKey)에서 역조회
    if (!resolvedPartUuid) {
      resolvedPartUuid = await resolvePartUuid(sceneId, lookupDepartment || department);
    }

    // 이슈 F(2026-04-23): scene_uuid 저장 — 씬 삭제 시 CASCADE 자동 정리.
    // sceneId가 리비전 sceneKey(예: "EP02:A:35" 또는 "EP02:A:raw-sc001") 형식일 수 있어 마지막 segment 추출.
    // Codex P2(2026-04-23): alias-collision 케이스에서 segment가 `raw-${encodeURIComponent(rawSceneId)}`
    // 형태로 들어올 수 있으므로 반드시 decode해야 실제 scene_number와 매칭된다.
    const rawSegment = sceneId.includes(':') ? sceneId.split(':').pop() || sceneId : sceneId;
    const lowerSegment = rawSegment.trim().toLowerCase();
    let sceneIdForResolve = rawSegment;
    if (lowerSegment.startsWith('raw-')) {
      try {
        sceneIdForResolve = decodeURIComponent(lowerSegment.slice(4));
      } catch {
        sceneIdForResolve = lowerSegment.slice(4);
      }
    }
    // Codex P1 2차(2026-04-23): 리비전 sceneKey 숫자는 normalizeSceneIdKey 결과(예: "a035"→"35")로
    // scene_number 파생 값이다. sort_order 와 일치가 보장되지 않으므로 반드시 scene_number 매칭 경로로.
    sceneUuid = await resolveSceneUuidByNumberWithRetry(resolvedPartUuid, sceneIdForResolve);

    // Codex P2 5차(2026-04-23): unified 뷰의 dup/disambiguated 씬은 실제 scenes.scene_number 가 아닌
    // synthetic ID (예: "merged-${encodeURIComponent(mergedKey)}", "dup:..." in mergedSceneHelpers.ts)
    // 로 sceneKey 를 생성한다. 이 경우 scene_uuid 매칭이 본질적으로 불가능하므로 저장 자체를 막으면
    // 해당 데이터 형태의 사용자는 리비전을 아예 기록할 수 없다. scene_uuid 컬럼은 nullable 이므로
    // synthetic 으로 확인된 경우에만 null 저장을 허용한다 (CASCADE 는 포기하되 저장 가능성 보장).
    const lowerResolve = sceneIdForResolve.toLowerCase();
    const isSyntheticMergedId = lowerResolve.startsWith('merged-') || lowerResolve.startsWith('dup:');
    if (!sceneUuid && !isSyntheticMergedId) {
      throw new Error(`리비전 저장 실패: 씬을 찾을 수 없음 (partUuid=${resolvedPartUuid}, sceneId=${sceneId})`);
    }
  }

  // v1.18.0: notify_user_ids — JSON 문자열로 전달받아 파싱.
  // 잘못된 JSON 이면 빈 배열로 fallback (실패해도 알림만 못 받지 등록 자체는 성공).
  let notifyUserIds: string[] = [];
  if (notifyUserIdsJson) {
    try {
      const parsed = JSON.parse(notifyUserIdsJson);
      if (Array.isArray(parsed)) notifyUserIds = parsed.filter((x) => typeof x === 'string');
    } catch {
      console.warn('[addRevision] notifyUserIdsJson 파싱 실패:', notifyUserIdsJson);
    }
  }

  // 리테이크 허브: 담당자 user.id 배열 + 초기 상태 맵.
  let assigneeIds: string[] = [];
  if (assigneeIdsJson) {
    try {
      const parsed = JSON.parse(assigneeIdsJson);
      if (Array.isArray(parsed)) assigneeIds = parsed.filter((x) => typeof x === 'string');
    } catch {
      console.warn('[addRevision] assigneeIdsJson 파싱 실패:', assigneeIdsJson);
    }
  }
  // 불변식: 담당자는 알림 대상에 포함
  const notifySet = new Set(notifyUserIds);
  assigneeIds = assigneeIds.filter((id) => notifySet.has(id));
  const assigneeStates: Record<string, { state: string }> = {};
  for (const id of assigneeIds) assigneeStates[id] = { state: 'pending' };

  const { error } = await supabase.from('comp_revisions').insert({
    id,
    part_id: resolvedPartUuid,             // 전반이면 null
    scene_id: isGeneral ? null : sceneId,  // 전반이면 null (빈문자열 아님)
    scene_uuid: sceneUuid,                 // 전반/synthetic 이면 null
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
    notify_user_ids: notifyUserIds,
    assignee_ids: assigneeIds,
    assignee_states: assigneeStates,
    set_id: setId ?? null,                 // 리테이크 세트 소속(허브 항목)
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
    assigneeIds: 'assignee_ids',
    assigneeStates: 'assignee_states',
    setId: 'set_id',
    finalResolvedBy: 'final_resolved_by',
    finalResolvedAt: 'final_resolved_at',
  };
  // JSONB 컬럼은 문자열로 전달받아 파싱해서 저장 (실패 시 원본 문자열 fallback)
  const jsonFields = new Set(['assigneeIds', 'assigneeStates']);
  // TIMESTAMPTZ/UUID/TEXT 컬럼은 빈 문자열 대신 null 저장 (PostgreSQL 타입 에러 방지)
  const nullableWhenEmpty = new Set(['finalResolvedAt', 'setId', 'resolvedAt', 'finalResolvedBy']);
  for (const [k, v] of Object.entries(updates)) {
    const col = fieldMap[k];
    if (!col) { console.warn('[updateRevision] 허용되지 않은 필드 무시:', k); continue; }
    if (jsonFields.has(k)) {
      try { dbUpdates[col] = JSON.parse(v); } catch { dbUpdates[col] = v; }
    } else if (nullableWhenEmpty.has(k) && v === '') {
      dbUpdates[col] = null;
    } else {
      dbUpdates[col] = v;
    }
  }
  const { error } = await supabase.from('comp_revisions').update(dbUpdates).eq('id', id);
  throwIfError(error);
  broadcastDataChange('comp_revisions', 'UPDATE');
}

function mapRevision(r: Record<string, unknown>): SupabaseRevision & { sceneKey: string; notifyUserIds: string[] } {
  const rawNotify = r.notify_user_ids;
  const notifyUserIds: string[] = Array.isArray(rawNotify)
    ? (rawNotify.filter((x) => typeof x === 'string') as string[])
    : [];

  const rawAssigneeIds = r.assignee_ids;
  const assigneeIds: string[] = Array.isArray(rawAssigneeIds)
    ? (rawAssigneeIds.filter((x) => typeof x === 'string') as string[])
    : [];
  const assigneeStates = (r.assignee_states && typeof r.assignee_states === 'object' && !Array.isArray(r.assignee_states))
    ? (r.assignee_states as Record<string, { state: string; note?: string; startedAt?: string; doneAt?: string }>)
    : {};
  const finalResolvedAt = (r.final_resolved_at as string) || undefined;

  // 불변식 복원: assignee_ids ⊆ notify_user_ids
  const allowed = new Set(notifyUserIds);
  const cleanAssigneeIds = assigneeIds.filter((id) => allowed.has(id));

  // assigneeStates도 cleanAssigneeIds 기준으로 정제 (ghost state 제거, 누락 항목은 pending으로 채움)
  const cleanAssigneeStates: Record<string, { state: string; note?: string; startedAt?: string; doneAt?: string }> = {};
  for (const id of cleanAssigneeIds) {
    cleanAssigneeStates[id] = assigneeStates[id] ?? { state: 'pending' };
  }

  // 파생 status (권위) — 저장된 status는 캐시로 보고 재계산값으로 덮어씀.
  // 단 담당자 0명(legacy/단순 흐름) 항목은 updateStatus 가 status 컬럼을 직접 관리하므로 stored status 가 권위다.
  // (Codex P1: 담당 0명을 항상 open 으로 파생하면 legacy in_progress/resolved 가 reload 시 open 으로 다운그레이드되고,
  //  백필된 resolved 행은 final_resolved_at 때문에 되돌리기가 막힌다. 담당 0명은 담당 워크플로우/final_resolved_at 무시.)
  const storedStatus = (r.status as string) || 'open';
  let derivedStatus: 'open' | 'in_progress' | 'assignee_done' | 'resolved';
  if (cleanAssigneeIds.length === 0) {
    // assignee_done 은 담당 0명에 성립 불가 → open 으로 정규화. 그 외 stored status 유지.
    derivedStatus = storedStatus === 'in_progress' ? 'in_progress'
      : storedStatus === 'resolved' ? 'resolved'
      : 'open';
  } else if (finalResolvedAt) {
    derivedStatus = 'resolved';
  } else {
    const states = cleanAssigneeIds.map((id) => cleanAssigneeStates[id]?.state ?? 'pending');
    if (states.every((s) => s === 'pending')) derivedStatus = 'open';
    else if (states.every((s) => s === 'done')) derivedStatus = 'assignee_done';
    else derivedStatus = 'in_progress';
  }

  return {
    id: r.id as string,
    partId: r.part_id as string,
    sceneId: r.scene_id as string,
    sceneKey: (r.scene_id as string) || '',  // scene_id에 sceneKey 저장 (호환용)
    revisionNo: r.revision_no as number,
    status: derivedStatus,
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
    notifyUserIds,
    assigneeIds: cleanAssigneeIds,
    assigneeStates: cleanAssigneeStates,
    setId: (r.set_id as string | null) ?? null,
    // 담당자 0명(legacy) 행은 final 필드를 renderer 로 노출하지 않는다 (Codex P2).
    // 백필된 stale final_resolved_at 이 reassign/담당지정 시 deriveRevisionStatus 로 흘러가
    // 새 담당 워크플로우를 즉시 resolved 로 만들어 start/complete 를 막던 문제 방지.
    finalResolvedBy: cleanAssigneeIds.length === 0 ? '' : ((r.final_resolved_by as string) || ''),
    finalResolvedAt: cleanAssigneeIds.length === 0 ? undefined : finalResolvedAt,
  };
}

// ═══════════════════════════════════════════════
// COMP_REVISION_SETS (리테이크 세트)
// ═══════════════════════════════════════════════

/** 리테이크 세트 (renderer CompRevisionSet 와 동형). */
export interface SupabaseRevisionSet {
  id: string;
  title: string;
  episodeNumber: number | null;
  department: 'bg' | 'acting' | null;
  aggregatorId: string | null;
  status: 'open' | 'done';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 세트 추가 입력 — id/status/타임스탬프는 DB default 가 채운다. */
export interface AddRevisionSetInput {
  title: string;
  episodeNumber?: number | null;
  department?: 'bg' | 'acting' | null;
  aggregatorId?: string | null;
  createdBy?: string | null;
}

/** 세트 업데이트 입력 — 화이트리스트 필드만 (updated_at 은 트리거 자동). */
export interface UpdateRevisionSetInput {
  title?: string;
  episodeNumber?: number | null;
  department?: 'bg' | 'acting' | null;
  aggregatorId?: string | null;
  status?: 'open' | 'done';
}

function mapRevisionSet(r: Record<string, unknown>): SupabaseRevisionSet {
  const rawEp = r.episode_number;
  const episodeNumber = typeof rawEp === 'number' ? rawEp : null;
  const rawDept = r.department;
  const department = (rawDept === 'bg' || rawDept === 'acting') ? rawDept : null;
  const storedStatus = r.status === 'done' ? 'done' : 'open';
  return {
    id: r.id as string,
    title: (r.title as string) || '',
    episodeNumber,
    department,
    aggregatorId: (r.aggregator_id as string | null) ?? null,
    status: storedStatus,
    createdBy: (r.created_by as string) || '',
    createdAt: (r.created_at as string) || '',
    updatedAt: (r.updated_at as string) || '',
  };
}

/** 모든 리테이크 세트 읽기 */
export async function readAllRevisionSets(): Promise<SupabaseRevisionSet[]> {
  const { data, error } = await supabase
    .from('comp_revision_sets')
    .select('*')
    .order('created_at');
  throwIfError(error);
  return (data || []).map(mapRevisionSet);
}

/** 리테이크 세트 추가 — id 는 DB default(gen_random_uuid), 저장 후 단건 조회해 map. */
export async function addRevisionSet(input: AddRevisionSetInput): Promise<SupabaseRevisionSet> {
  const { data, error } = await supabase
    .from('comp_revision_sets')
    .insert({
      title: input.title,
      episode_number: input.episodeNumber ?? null,
      department: input.department ?? null,
      aggregator_id: input.aggregatorId ?? null,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single();
  throwIfError(error);
  broadcastDataChange('comp_revision_sets', 'INSERT');
  return mapRevisionSet(data as Record<string, unknown>);
}

/** 리테이크 세트 업데이트 — 화이트리스트 필드만 snake_case 매핑 (updated_at 은 트리거 자동). */
export async function updateRevisionSet(
  id: string,
  fields: UpdateRevisionSetInput,
): Promise<SupabaseRevisionSet> {
  const dbUpdates: Record<string, unknown> = {};
  if (fields.title !== undefined) dbUpdates.title = fields.title;
  if (fields.episodeNumber !== undefined) dbUpdates.episode_number = fields.episodeNumber;
  if (fields.department !== undefined) dbUpdates.department = fields.department;
  if (fields.aggregatorId !== undefined) dbUpdates.aggregator_id = fields.aggregatorId;
  if (fields.status !== undefined) dbUpdates.status = fields.status;

  const { data, error } = await supabase
    .from('comp_revision_sets')
    .update(dbUpdates)
    .eq('id', id)
    .select('*')
    .single();
  throwIfError(error);
  broadcastDataChange('comp_revision_sets', 'UPDATE');
  return mapRevisionSet(data as Record<string, unknown>);
}

/** 리테이크 세트 삭제 — 하위 리비전의 set_id 는 FK ON DELETE SET NULL 로 자동 해제. */
export async function deleteRevisionSet(id: string): Promise<void> {
  const { error } = await supabase.from('comp_revision_sets').delete().eq('id', id);
  throwIfError(error);
  broadcastDataChange('comp_revision_sets', 'DELETE');
}

// ═══════════════════════════════════════════════
// SCENE WORK LINKS
// ═══════════════════════════════════════════════

const SCENE_WORK_LINK_SELECT =
  'id, scene_uuid, department, link_kind, path, label, sort_order, created_by, created_at, updated_by, updated_at';
const SCENE_WORK_LINK_UUID_QUERY_CHUNK_SIZE = 80;
const SCENE_WORK_LINK_QUERY_PAGE_SIZE = 1000;

function mapSceneWorkLinkRow(row: Record<string, unknown>): SupabaseSceneWorkLink {
  const department = row.department === 'acting' ? 'acting' : 'bg';
  const rawKind = row.link_kind;
  const linkKind: SceneWorkLinkKind =
    rawKind === 'primary_file' ? 'primary_file' : rawKind === 'extra_file' ? 'extra_file' : 'folder';
  return {
    id: String(row.id ?? ''),
    sceneUuid: String(row.scene_uuid ?? ''),
    department,
    linkKind,
    path: String(row.path ?? ''),
    label: typeof row.label === 'string' ? row.label : null,
    sortOrder: Number(row.sort_order ?? 0) || 0,
    createdBy: typeof row.created_by === 'string' ? row.created_by : null,
    createdAt: String(row.created_at ?? ''),
    updatedBy: typeof row.updated_by === 'string' ? row.updated_by : null,
    updatedAt: String(row.updated_at ?? ''),
  };
}

export async function readSceneWorkLinks(sceneUuids?: string[]): Promise<SupabaseSceneWorkLink[]> {
  const uniqueSceneUuids = sceneUuids ? Array.from(new Set(sceneUuids.filter(Boolean))) : null;
  if (sceneUuids && uniqueSceneUuids?.length === 0) return [];

  const chunks = uniqueSceneUuids && uniqueSceneUuids.length > 0
    ? Array.from(
      { length: Math.ceil(uniqueSceneUuids.length / SCENE_WORK_LINK_UUID_QUERY_CHUNK_SIZE) },
      (_, index) => uniqueSceneUuids.slice(
        index * SCENE_WORK_LINK_UUID_QUERY_CHUNK_SIZE,
        (index + 1) * SCENE_WORK_LINK_UUID_QUERY_CHUNK_SIZE,
      ),
    )
    : [null];

  const rows: SupabaseSceneWorkLink[] = [];
  for (const chunk of chunks) {
    rows.push(...await readSceneWorkLinkChunk(chunk));
  }
  return rows;
}

async function readSceneWorkLinkChunk(sceneUuidChunk: string[] | null): Promise<SupabaseSceneWorkLink[]> {
  const rows: SupabaseSceneWorkLink[] = [];
  for (let offset = 0; ; offset += SCENE_WORK_LINK_QUERY_PAGE_SIZE) {
    const page = await readSceneWorkLinkPage(sceneUuidChunk, offset);
    rows.push(...page);
    if (page.length < SCENE_WORK_LINK_QUERY_PAGE_SIZE) break;
  }
  return rows;
}

async function readSceneWorkLinkPage(
  sceneUuidChunk: string[] | null,
  offset: number,
): Promise<SupabaseSceneWorkLink[]> {
  let query = supabase
    .from('scene_work_links')
    .select(SCENE_WORK_LINK_SELECT)
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false })
    .range(offset, offset + SCENE_WORK_LINK_QUERY_PAGE_SIZE - 1);

  if (sceneUuidChunk && sceneUuidChunk.length > 0) {
    query = query.in('scene_uuid', sceneUuidChunk);
  }

  const { data, error } = await query;
  throwIfError(error);
  return (data || []).map((row) => mapSceneWorkLinkRow(row as Record<string, unknown>));
}

async function findSceneWorkLinkSlot(input: SceneWorkLinkInput): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('scene_work_links')
    .select('id')
    .eq('scene_uuid', input.sceneUuid)
    .eq('department', input.department)
    .eq('link_kind', input.linkKind)
    .limit(1)
    .maybeSingle();
  throwIfError(error);
  return data ? { id: String(data.id) } : null;
}

async function updateSceneWorkLinkSlot(id: string, input: SceneWorkLinkInput): Promise<SupabaseSceneWorkLink> {
  const { data, error } = await supabase
    .from('scene_work_links')
    .update({
      path: input.path.trim(),
      label: input.label ?? null,
      sort_order: input.sortOrder ?? 0,
      updated_by: input.userId ?? null,
    })
    .eq('id', id)
    .select(SCENE_WORK_LINK_SELECT)
    .single();
  throwIfError(error);
  return mapSceneWorkLinkRow(data as Record<string, unknown>);
}

export async function upsertSceneWorkLink(input: SceneWorkLinkInput): Promise<SupabaseSceneWorkLink> {
  if (!input.sceneUuid) throw new Error('sceneUuid is required');
  if (!input.path.trim()) throw new Error('path is required');

  if (input.linkKind !== 'extra_file') {
    const existing = await findSceneWorkLinkSlot(input);
    if (existing?.id) {
      const updated = await updateSceneWorkLinkSlot(existing.id, input);
      return updated;
    }
  }

  const { data, error } = await supabase
    .from('scene_work_links')
    .insert({
      scene_uuid: input.sceneUuid,
      department: input.department,
      link_kind: input.linkKind,
      path: input.path.trim(),
      label: input.label ?? null,
      sort_order: input.sortOrder ?? 0,
      created_by: input.userId ?? null,
      updated_by: input.userId ?? null,
    })
    .select(SCENE_WORK_LINK_SELECT)
    .single();

  if (error && input.linkKind !== 'extra_file' && isDuplicateKeyError(error)) {
    const existing = await findSceneWorkLinkSlot(input);
    if (existing?.id) {
      const updated = await updateSceneWorkLinkSlot(existing.id, input);
      return updated;
    }
  }

  throwIfError(error);
  return mapSceneWorkLinkRow(data as Record<string, unknown>);
}

export async function deleteSceneWorkLink(
  sceneUuid: string,
  department: SceneWorkLinkDepartment,
  linkKind: 'folder' | 'primary_file',
): Promise<void> {
  const { error } = await supabase
    .from('scene_work_links')
    .delete()
    .eq('scene_uuid', sceneUuid)
    .eq('department', department)
    .eq('link_kind', linkKind);
  throwIfError(error);
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
 * scene UUID 조회 경로가 두 갈래로 나뉜다 (Codex P1 2차, 2026-04-23):
 *
 *   A) 댓글 경로: `sceneKey = sheetName:scene.no` 이고 `scene.no === scenes.sort_order`.
 *      → `resolveSceneUuidBySortOrder` 사용. sort_order 정확 매칭이 항상 올바름.
 *
 *   B) 리비전 경로: `sceneKey = EP:partLetter:normalizedNumberOrRaw`.
 *      숫자 segment("35")는 `normalizeSceneIdKey("a035", "A")` 결과의 숫자부이므로
 *      sort_order 와 일치 보장 없음 (삭제·재배치로 어긋날 수 있음).
 *      `raw-...` alias segment는 decode 후 custom scene_number 가 됨.
 *      → `resolveSceneUuidByNumber` 사용. scene_number 정규화 매칭이 정답.
 *
 * 두 함수는 호출자가 의도를 명확히 표현하도록 분리되었다. 공유 매칭을 피해
 * "어쩌다 sort_order 와 숫자부가 같아서 올바른 씬이 잡히는" 우연을 제거한다.
 */

/** 댓글 경로 전용 — scene.no(=sort_order) 정확 매칭. */
export async function resolveSceneUuidBySortOrder(
  partUuid: string,
  sortOrder: number,
): Promise<string | null> {
  if (!partUuid || !Number.isFinite(sortOrder)) return null;
  const { data } = await supabase
    .from('scenes')
    .select('id')
    .eq('part_id', partUuid)
    .eq('sort_order', sortOrder)
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

/**
 * `src/utils/sceneIdKey.ts#normalizeSceneIdKey` 와 동일한 규칙을 electron 쪽에서도 사용하기 위한
 * 로컬 복제. 두 코드는 서로 다른 번들에 속하므로 런타임 import 대신 로직을 복제한다.
 * 동일 규칙 유지를 위해 sceneIdKey.ts 를 수정할 때는 이 함수도 함께 갱신해야 한다.
 */
function normalizeSceneIdKeyLocal(sceneNumber: string, partLetter: string): string {
  const raw = String(sceneNumber || '').trim().toLowerCase();
  if (!raw) return '';
  if (/^\d+$/.test(raw)) return String(Number(raw));
  if (partLetter && new RegExp(`^${partLetter}[a-z]*\\d+$`).test(raw)) {
    const trailing = raw.match(/\d+$/)?.[0];
    return trailing ? String(Number(trailing)) : raw;
  }
  return raw;
}

/** 리비전 경로 전용 — scene_number 기반 매칭.
 *  숫자는 part_letter + LPAD(3) 로 정규화, 그 외 custom prefix("sc001")는 lowercase 원본으로.
 *  alias-prefixed 씬(예: "ac001") 대응을 위해 정규화 키 기반 fallback 추가. */
export async function resolveSceneUuidByNumber(
  partUuid: string,
  sceneNumberLike: string,
): Promise<string | null> {
  if (!partUuid || !sceneNumberLike) return null;
  const trimmed = String(sceneNumberLike).trim();
  const lower = trimmed.toLowerCase();

  const { data: part } = await supabase
    .from('parts')
    .select('part_id')
    .eq('id', partUuid)
    .single();
  if (!part) return null;

  const partLetter = String(part.part_id || '').trim().slice(0, 1).toLowerCase();
  const normalized = /^\d+$/.test(lower) && partLetter
    ? `${partLetter}${lower.padStart(3, '0')}`
    : lower;

  // 1차: part_letter + LPAD(3) canonical 매칭 (대부분 케이스)
  const { data: byNumber } = await supabase
    .from('scenes')
    .select('id')
    .eq('part_id', partUuid)
    .eq('scene_number', normalized)
    .limit(1)
    .maybeSingle();
  if (byNumber?.id) return byNumber.id;

  // 2차: custom prefix (예: "sc001", "v2a001") — 원본 lowercase 그대로 한 번 더
  if (normalized !== lower) {
    const { data: byRaw } = await supabase
      .from('scenes')
      .select('id')
      .eq('part_id', partUuid)
      .eq('scene_number', lower)
      .limit(1)
      .maybeSingle();
    if (byRaw?.id) return byRaw.id;
  }

  // 3차(Codex P1 4차, 2026-04-23): alias-prefixed 씬 대응.
  // 예를 들어 part A 에 "ac001" 만 있고 "a001" 이 없는 프로젝트에서 sceneKey 숫자 "1" 이 전달되면
  // 1·2차 모두 실패한다. 이때 파트의 모든 씬을 가져와 normalizeSceneIdKey 규칙으로 같은 정규화 키를
  // 가진 씬을 찾는다. 유일하면 매칭, collision 이면 안전하게 null.
  const targetKey = normalizeSceneIdKeyLocal(lower, partLetter);
  if (targetKey) {
    const { data: allScenes } = await supabase
      .from('scenes')
      .select('id, scene_number')
      .eq('part_id', partUuid);
    if (allScenes && allScenes.length > 0) {
      const matches = allScenes.filter(
        (s) => normalizeSceneIdKeyLocal(String(s.scene_number || ''), partLetter) === targetKey,
      );
      if (matches.length === 1) return matches[0].id as string;
    }
  }

  return null;
}

/**
 * 후방 호환용 — 과거에 이 이름을 참조하던 외부 경로가 남아 있을 경우를 위한 얇은 래퍼.
 * 새 코드는 반드시 resolveSceneUuidBySortOrder 또는 resolveSceneUuidByNumber 중 의도에
 * 맞는 함수를 직접 사용할 것.
 */
export async function resolveSceneUuid(
  partUuid: string,
  sceneId: string,
): Promise<string | null> {
  return resolveSceneUuidByNumber(partUuid, sceneId);
}

/** 낙관적 UI ↔ DB 저장 레이스 완화용 재시도 래퍼. 0→500→1000ms 백오프. */
async function withRetry<T>(fn: () => Promise<T | null>): Promise<T | null> {
  const delays = [0, 500, 1000];
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const result = await fn();
    if (result) return result;
  }
  return null;
}

async function resolveSceneUuidBySortOrderWithRetry(partUuid: string, sortOrder: number): Promise<string | null> {
  return withRetry(() => resolveSceneUuidBySortOrder(partUuid, sortOrder));
}

async function resolveSceneUuidByNumberWithRetry(partUuid: string, sceneNumberLike: string): Promise<string | null> {
  return withRetry(() => resolveSceneUuidByNumber(partUuid, sceneNumberLike));
}

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

// ============================================================
// 최근 작업 위젯 — activity_log
// spec: docs/superpowers/specs/2026-04-27-recent-activity-widget-design.md
// 주의: 기존 activityLogger.ts 의 recordActivity (IPC 메모리 추적) 와 다름.
//        본 함수는 activity_log DB 테이블에 INSERT 하므로 recordActivityLog 로 명명.
// ============================================================

export type ActionGroup = 'progress' | 'memo' | 'scene' | 'etc';
export type ActionType =
  | 'stage_lo' | 'stage_done' | 'stage_review' | 'stage_png'
  | 'memo_update' | 'comment_add'
  | 'revision_add' | 'revision_in_progress' | 'revision_resolve' | 'revision_delete'
  // 리테이크 허브 1단계: 담당자 본인 완료 / 최종 완료 / 재배정
  | 'revision_assignee_done' | 'revision_final_resolve' | 'revision_reassign'
  // v1.18.0: 리비전 맥락 댓글
  | 'revision_comment'
  | 'scene_add' | 'scene_delete'
  | 'assignee_change' | 'layout_change'
  | 'image_upload_storyboard' | 'image_upload_guide'
  | 'image_annotate_storyboard' | 'image_annotate_guide'
  // v1.29.0: 댓글 이모지 반응
  | 'comment_reaction'
  // 캐릭터 현황판: 복장 디자인/리깅 단계 변경 + 리깅 완성 강조
  | 'character_design_stage' | 'character_rigging_stage' | 'character_rigging_done';

export interface ActivityRow {
  id: string;
  user_id: string;
  user_name: string;
  action_type: ActionType;
  action_group: ActionGroup;
  scene_id: string | null;
  scene_label: string | null;
  episode_number: number | null;
  department: 'bg' | 'acting' | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface RecordActivityLogInput {
  userId: string;
  userName: string;
  actionType: ActionType;
  actionGroup: ActionGroup;
  sceneId?: string | null;
  sceneLabel?: string | null;
  episodeNumber?: number | null;
  department?: 'bg' | 'acting' | null;
  detail?: Record<string, unknown>;
}

/**
 * activity_log 테이블에 row INSERT.
 * try/catch 로 모든 에러 흡수 — 본 mutation 흐름은 절대 중단 안 됨.
 */
export async function recordActivityLog(input: RecordActivityLogInput): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('record_activity', {
      p_user_id: input.userId,
      p_user_name: input.userName,
      p_action_type: input.actionType,
      p_action_group: input.actionGroup,
      p_scene_id: input.sceneId ?? null,
      p_scene_label: input.sceneLabel ?? null,
      p_episode_number: input.episodeNumber ?? null,
      p_department: input.department ?? null,
      p_detail: input.detail ?? {},
    });
    if (error) {
      console.warn('[activity-log] record failed:', error.message);
      return null;
    }
    return data as string;
  } catch (err) {
    console.warn('[activity-log] record exception:', err);
    return null;
  }
}

export async function listActivities(opts: {
  /** 페이지 cursor — 형식: "<createdAt>|<id>" (timestamp tie-breaker 보장).
   *  단순 timestamp 만 쓰면 같은 ms 에 쓰인 row 들이 페이지 경계에서 사라질 수 있음 (Codex P1).
   */
  before?: string;
  limit?: number;
  /** v1: 항상 미전달 — group 필터는 client-side 에서 적용 (hidden group 활동 보존, Codex P1) */
  groups?: ActionGroup[];
  department?: 'bg' | 'acting' | null;
  /** 특정 씬(들) 의 activity 만 조회 — idx_activity_log_scene 인덱스 활용. 2026-05-02 추가. */
  sceneIds?: string[];
  /** v1.23.0: 시간 단위 탐색 시 해당 range 만 조회 (Codex 8차 P1) */
  rangeStart?: string;
  rangeEnd?: string;
}): Promise<ActivityRow[]> {
  let q = supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })   // tie-breaker — 같은 timestamp 안에서 안정적 cursor
    .limit(opts.limit ?? 100);

  if (opts.before) {
    const sep = opts.before.indexOf('|');
    if (sep > 0) {
      const beforeCreatedAt = opts.before.slice(0, sep);
      const beforeId = opts.before.slice(sep + 1);
      // (created_at, id) < (a, b) 조건: created_at < a OR (created_at == a AND id < b)
      q = q.or(`created_at.lt.${beforeCreatedAt},and(created_at.eq.${beforeCreatedAt},id.lt.${beforeId})`);
    } else {
      // backward-compat — opts.before 가 순수 timestamp 만이면 기존 방식
      q = q.lt('created_at', opts.before);
    }
  }
  if (opts.groups && opts.groups.length > 0) q = q.in('action_group', opts.groups);
  if (opts.department) q = q.eq('department', opts.department);
  if (opts.sceneIds && opts.sceneIds.length > 0) q = q.in('scene_id', opts.sceneIds);
  if (opts.rangeStart) q = q.gte('created_at', opts.rangeStart);
  if (opts.rangeEnd) q = q.lt('created_at', opts.rangeEnd);

  const { data, error } = await q;
  if (error) throw new Error(`listActivities failed: ${error.message}`);
  return (data ?? []) as ActivityRow[];
}

export interface ActivityStatBucket {
  day_of_week: number;
  hour: number;
  count: number;
  count_progress: number;
  count_memo: number;
  count_scene: number;
  count_etc: number;
}

export async function getActivityStats(opts: {
  days?: number;
  groups?: ActionGroup[];
  department?: 'bg' | 'acting' | null;
}): Promise<ActivityStatBucket[]> {
  const since = new Date(Date.now() - (opts.days ?? 7) * 86400000).toISOString();
  const { data, error } = await supabase.rpc('activity_log_stats', {
    p_since: since,
    p_groups: opts.groups ?? null,
    p_department: opts.department ?? null,
  });
  if (error) throw new Error(`getActivityStats failed: ${error.message}`);
  return (data ?? []) as ActivityStatBucket[];
}

// ============================================================
// v1.23.0: get_activity_stats_v2 (시간 단위 확장)
// granularity: 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals'
// 응답: { bucket1, bucket2, total, count_progress/memo/scene/etc }
// ============================================================

export interface ActivityStatBucketV2 {
  bucket1: number;
  bucket2: number;
  total: number;
  count_progress: number;
  count_memo: number;
  count_scene: number;
  count_etc: number;
}

export async function getActivityStatsV2(opts: {
  rangeStart: string;
  rangeEnd: string;
  granularity: 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals';
  department?: 'bg' | 'acting' | null;
  groups?: ActionGroup[];
}): Promise<ActivityStatBucketV2[]> {
  const { data, error } = await supabase.rpc('get_activity_stats_v2', {
    p_range_start: opts.rangeStart,
    p_range_end: opts.rangeEnd,
    p_granularity: opts.granularity,
    p_department: opts.department ?? null,
    p_groups: opts.groups ?? null,
  });
  if (error) throw new Error(`getActivityStatsV2 failed: ${error.message}`);
  return (data ?? []) as ActivityStatBucketV2[];
}

// ============================================================
// v1.23.0: get_activity_insights (분석 모달 7카드 raw data)
// ============================================================

export interface ActivityInsightsRawServer {
  monthDowGrid: Array<{ month: number; dow: number; count: number }>;
  userBreakdown: Array<{ userId: string; userName: string; count: number }>;
  userBreakdownTotal: number;
  stageBreakdown: { lo: number; done: number; review: number; png: number };
  topScenes: Array<{
    sceneId: string;
    sceneLabel: string | null;
    episodeNumber: number | null;
    total: number;
    revCount: number;
    memoCount: number;
    stageCount: number;
  }>;
  weeklyCompleted: Array<{ weekStart: string; completedSceneCount: number }>;
  sceneFlow: Record<string, never>;
  episodeProgress: unknown[];
}

export async function getActivityInsights(opts: {
  rangeStart: string;
  rangeEnd: string;
  department?: 'bg' | 'acting' | null;
}): Promise<ActivityInsightsRawServer> {
  const { data, error } = await supabase.rpc('get_activity_insights', {
    p_range_start: opts.rangeStart,
    p_range_end: opts.rangeEnd,
    p_department: opts.department ?? null,
  });
  if (error) throw new Error(`getActivityInsights failed: ${error.message}`);
  return data as ActivityInsightsRawServer;
}

export async function backfillActivities(since: string, limit = 200): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`backfillActivities failed: ${error.message}`);
  return (data ?? []) as ActivityRow[];
}

/** 설정 화면 모니터링용 — 활동 기록 row 수 + 추정 크기. */
export async function getActivityStorageInfo(): Promise<{ count: number; sizeMB: number }> {
  const { count, error: countErr } = await supabase
    .from('activity_log')
    .select('*', { count: 'exact', head: true });
  if (countErr) throw new Error(`activity count failed: ${countErr.message}`);
  const sizeMB = ((count ?? 0) * 400) / (1024 * 1024);
  return { count: count ?? 0, sizeMB };
}

// ═══════════════════════════════════════════════════════
// v1.26.0 — 댓글 이모지 리액션
// ═══════════════════════════════════════════════════════

export interface CommentReactionRow {
  id: string;
  commentId: string;
  userId: string;
  userName: string;
  emoji: string;
  createdAt: string;
}

// v1.29.0: 이모지 반응 알림 행 표시용 직렬화 (Realtime payload + IPC 응답 공용).
//   table column → camelCase + scenes 점프 정보까지 평탄화.
interface CommentReactionNotificationRow {
  id: string;
  recipient_id: string;
  comment_id: string;
  actor_id: string;
  actor_name: string;
  scene_id: string | null;
  episode_number: number | null;
  part_id: string | null;
  dept: string | null;
  emojis: string[] | null;
  reaction_count: number;
  last_action_at: string;
  created_at: string;
  read_at: string | null;
}

/** v1.29.0: 댓글 이모지 반응 알림 — 렌더러 store 형식(`AppNotification`) 으로 직렬화.
 *  metadata.reactionEmojis / commentId / sceneId 등은 NotificationPanel·점프 헬퍼가 직접 읽음. */
function serializeReactionNotification(row: CommentReactionNotificationRow): {
  id: string;
  type: 'comment_reaction';
  title: string;
  body?: string;
  metadata: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
} {
  const emojis = Array.isArray(row.emojis) ? (row.emojis as string[]) : [];
  // 5개 초과면 첫 5 + "+N" 으로 truncate (UI 가독성).
  const emojiText = emojis.length === 0
    ? ''
    : emojis.length <= 5
      ? emojis.join('')
      : emojis.slice(0, 5).join('') + `+${emojis.length - 5}`;
  return {
    id: row.id,
    type: 'comment_reaction',
    // title 에 emojis 결합 — 알림 패널 한 줄에 누가 어떤 이모지를 남겼는지 한눈에 보임.
    title: emojiText
      ? `${row.actor_name}가 회원님 댓글에 ${emojiText} 반응을 남겼어요`
      : `${row.actor_name}가 회원님 댓글에 반응을 남겼어요`,
    metadata: {
      reactionNotificationId: row.id,
      reactionEmojis: emojis,
      reactionActorId: row.actor_id,
      commentId: row.comment_id,
      commentSceneId: row.scene_id ?? undefined,
      commentPartId: row.part_id ?? undefined,
    },
    isRead: row.read_at !== null,
    createdAt: row.last_action_at,  // 정렬 기준은 마지막 반응 시각
  };
}

/** v1.29.0: 댓글 context 조회 (단일 `comments` 테이블, revision_id 컬럼으로 일반/리비전 구분).
 *  scene episode·dept 는 별도 parts/episodes JOIN — 인접 함수(listEpisodes)의 조회 패턴 따름. */
async function fetchCommentContext(commentId: string): Promise<{
  authorId: string;
  authorName: string;
  sceneId?: string;
  sceneUuid?: string;
  partId?: string;
  episodeNumber?: number;
  dept?: string;
  commentPreview?: string;
  characterId?: string;
} | null> {
  const { data: comment, error } = await supabase
    .from('comments')
    .select('user_id, user_name, scene_id, scene_uuid, part_id, text, revision_id, character_id')
    .eq('id', commentId)
    .maybeSingle();
  if (error || !comment) return null;

  let episodeNumber: number | undefined;
  let dept: string | undefined;
  if (comment.part_id) {
    const { data: part } = await supabase
      .from('parts')
      .select('episode_id, department')
      .eq('id', comment.part_id)
      .maybeSingle();
    dept = part?.department;
    if (part?.episode_id) {
      const { data: ep } = await supabase
        .from('episodes')
        .select('episode_number')
        .eq('id', part.episode_id)
        .maybeSingle();
      episodeNumber = ep?.episode_number;
    }
  }

  return {
    authorId: comment.user_id,
    authorName: comment.user_name,
    sceneId: comment.scene_id ?? undefined,
    sceneUuid: comment.scene_uuid ?? undefined,
    partId: comment.part_id ?? undefined,
    episodeNumber,
    dept,
    commentPreview: (comment.text ?? '').slice(0, 30),
    characterId: comment.character_id ?? undefined,
  };
}

export async function addCommentReaction(
  commentId: string,
  emoji: string,
  userId: string,
  userName: string,
): Promise<void> {
  // 1) 기존: comment_reactions INSERT
  const inserted = await supabase
    .from('comment_reactions')
    .insert({ comment_id: commentId, user_id: userId, user_name: userName, emoji })
    .select()
    .maybeSingle();
  if (inserted.error && !/duplicate key|unique/i.test(inserted.error.message)) {
    throw new Error(`addCommentReaction failed: ${inserted.error.message}`);
  }
  // 코덱스 2차 P1: 다른 클라이언트에 broadcast — 이모지 칩 자체 fetch 트리거.
  broadcastCommentReactionChanged(commentId, 'add', emoji, userId);

  // UNIQUE 충돌(중복 토글)이면 알림·활동 흐름 건너뜀.
  if (!inserted.data) return;

  // 2) v1.29.0: 댓글 context 조회 — 알림 행 + activities 저장에 필요한 scene 정보.
  const ctx = await fetchCommentContext(commentId);
  if (!ctx) {
    console.warn('[addCommentReaction] 고아 reaction 감지 — comment 조회 실패:', commentId);
    return;
  }

  // 캐릭터 댓글 반응은 씬 기반 활동/알림(씬 네비게이션) 경로가 없으므로 스킵 — 이모지 칩만 반영.
  if (ctx.characterId) return;

  // 3) 활동 로그 INSERT — 자기 자신이어도 다른 사용자가 보는 최근 작업 위젯에 표시되도록.
  //   코덱스 10차 P1: activities 가 아니라 activity_log 테이블 + record_activity RPC 사용.
  //   코덱스 13차 P1: 활동 로그 실패가 후속 알림 흐름을 중단시키지 않도록 명시적 try/catch.
  //     recordActivityLog 는 내부에서 throw 를 흡수하지만 방어적으로 한 번 더 wrap —
  //     RPC 가 throw 하더라도 reaction 자체는 이미 INSERT·broadcast 됐으므로 알림 분기는 진행.
  try {
    await recordActivityLog({
      userId,
      userName,
      actionType: 'comment_reaction',
      actionGroup: 'memo',
      sceneId: ctx.sceneUuid ?? null,
      sceneLabel: null,
      episodeNumber: ctx.episodeNumber ?? null,
      department: (ctx.dept === 'bg' || ctx.dept === 'acting') ? ctx.dept : null,
      detail: {
        commentId,
        emoji,
        commentAuthorId: ctx.authorId,
        commentPreview: ctx.commentPreview,
      },
    });
  } catch (e) {
    console.warn('[addCommentReaction] recordActivityLog 실패 — 알림 흐름은 계속 진행:', e);
  }

  // 4) 자기 자신 분기 — 알림은 생성하지 않음.
  if (ctx.authorId === userId) return;

  // 5) comment_reaction_notifications UPSERT — 코덱스 4차 P1: RPC 로 원자화 (race-free).
  //   기존 SELECT → INSERT/UPDATE 시퀀스는 같은 (recipient, comment, actor) 동시 호출 시
  //   둘 다 같은 snapshot 을 읽고 서로의 write 를 덮어써 emoji 손실. PL/pgSQL 함수가
  //   INSERT ... ON CONFLICT DO UPDATE 단일 expression 으로 처리.
  try {
    const { data: notifData, error: rpcErr } = await supabase.rpc(
      'upsert_comment_reaction_notification',
      {
        p_recipient: ctx.authorId,
        p_comment: commentId,
        p_actor: userId,
        p_actor_name: userName,
        p_scene: ctx.sceneId ?? null,
        p_episode: ctx.episodeNumber ?? null,
        p_part: ctx.partId ?? null,
        p_dept: ctx.dept ?? null,
        p_emoji: emoji,
      },
    );
    if (rpcErr) throw rpcErr;
    const notifRow = notifData as CommentReactionNotificationRow | null;

    if (notifRow) {
      const serialized = serializeReactionNotification(notifRow);
      broadcastCommentReactionNotification({
        notification: {
          id: serialized.id,
          recipientId: notifRow.recipient_id,
          actorId: notifRow.actor_id,
          actorName: notifRow.actor_name,
          commentId: notifRow.comment_id,
          emojis: (notifRow.emojis ?? []) as string[],
          reactionCount: notifRow.reaction_count,
          sceneId: notifRow.scene_id ?? undefined,
          episodeNumber: notifRow.episode_number ?? undefined,
          partId: notifRow.part_id ?? undefined,
          dept: notifRow.dept ?? undefined,
          lastActionAt: notifRow.last_action_at,
          createdAt: notifRow.created_at,
          readAt: notifRow.read_at,
        },
      });
    }
  } catch (e) {
    console.warn('[addCommentReaction] notification UPSERT 실패:', e);
  }
}

export async function removeCommentReaction(
  commentId: string,
  emoji: string,
  userId: string,
): Promise<void> {
  // 1) 기존: comment_reactions DELETE — RETURNING 으로 실제 영향 받은 행 확인.
  const deleted = await supabase
    .from('comment_reactions')
    .delete()
    .match({ comment_id: commentId, user_id: userId, emoji })
    .select()
    .maybeSingle();
  if (deleted.error) throw new Error(`removeCommentReaction failed: ${deleted.error.message}`);
  broadcastCommentReactionChanged(commentId, 'remove', emoji, userId);
  if (!deleted.data) return;  // 행 없음 → 알림·활동 정리 건너뜀

  // 2) 댓글 context 조회 (자기 자신 여부 확인 + scene 정보)
  const ctx = await fetchCommentContext(commentId);

  // 3) 활동 로그 — 가장 최근 매칭 1행 DELETE (자기 자신이어도 수행).
  //   코덱스 10차 P1: activity_log 테이블 (activities 가 아님) 에서 삭제.
  try {
    const { data: target } = await supabase
      .from('activity_log')
      .select('id')
      .eq('user_id', userId)
      .eq('action_type', 'comment_reaction')
      .filter('detail->>commentId', 'eq', commentId)
      .filter('detail->>emoji', 'eq', emoji)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (target?.id) {
      const { data: del, error: delErr } = await supabase
        .from('activity_log')
        .delete()
        .eq('id', target.id)
        .select('id')
        .maybeSingle();
      if (delErr) {
        console.warn('[removeCommentReaction] activity_log DELETE 에러:', delErr.message);
      } else if (del?.id) {
        broadcastActivityRemoved({ activityId: del.id });
      }
    }
  } catch (e) {
    console.warn('[removeCommentReaction] activity_log DELETE 예외:', e);
  }

  // 4) 알림 행 업데이트/삭제 (자기 자신이면 알림 행 없음 → 건너뜀)
  //   코덱스 4차 P1/P2: RPC 로 원자화 — 행 잠금 + emojis 배열에서 last-occurrence 제거 +
  //   빈 배열이면 DELETE 한 트랜잭션에서 처리. RPC 결과(deleted, notification_id) 검증 후에만
  //   broadcast 발화 → 실패 시 client store 와 DB 의 분기·재출현 방지.
  if (!ctx || ctx.authorId === userId) return;

  try {
    const { data: rpcRows, error: rpcErr } = await supabase.rpc(
      'remove_emoji_from_reaction_notification',
      {
        p_recipient: ctx.authorId,
        p_comment: commentId,
        p_actor: userId,
        p_emoji: emoji,
      },
    );
    if (rpcErr) {
      console.warn('[removeCommentReaction] RPC 실패:', rpcErr.message);
      return;
    }
    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!row || !row.notification_id) return;  // 행 없음 → no-op
    broadcastCommentReactionNotificationRemoved({
      recipientId: ctx.authorId,
      notificationId: row.notification_id as string,
      deleted: row.deleted === true,
      emoji,
      commentId,
      actorId: userId,
    });
  } catch (e) {
    console.warn('[removeCommentReaction] notification RPC 예외:', e);
  }
}

// v1.29.0: 댓글 이모지 반응 알림 — Catch-up / refetch 용 fetch.
export interface FetchCommentReactionsArgs {
  recipientId: string;
  since?: string;       // last_action_at > since (오래된 한계)
  /** cursor — 형식: "<last_action_at>|<id>". 같은 timestamp 행의 page 경계 누락 방지 (코덱스 14차 P2). */
  before?: string;
  limit?: number;
  ids?: string[];       // 단일/일부 refetch
}
export async function fetchCommentReactionNotifications(
  args: FetchCommentReactionsArgs,
): Promise<{ data: ReturnType<typeof serializeReactionNotification>[] }> {
  const limit = Math.max(1, Math.min(args.limit ?? 100, 500));
  let query = supabase
    .from('comment_reaction_notifications')
    .select('*')
    .eq('recipient_id', args.recipientId)
    .order('last_action_at', { ascending: false })
    .order('id', { ascending: false })  // tie-breaker: 같은 last_action_at 행도 결정적 정렬
    .limit(limit);

  if (args.ids?.length) {
    query = query.in('id', args.ids);
  } else {
    if (args.since) {
      // 코덱스 15차 P2: since 도 composite cursor "<lastAt>|<id>" 지원.
      //   gt(last_action_at) 단일 필터는 같은 last_action_at 의 다른 row 를 영구 제외 →
      //   data loss. before 와 동일하게 tuple 비교 (lastAction, id) > (T, I).
      //   단순 ISO timestamp 만 들어오면 폴백 (구버전 lastSeen).
      const [sAt, sId] = args.since.split('|');
      if (sAt && sId) {
        query = query.or(`last_action_at.gt.${sAt},and(last_action_at.eq.${sAt},id.gt.${sId})`);
      } else if (sAt) {
        query = query.gt('last_action_at', sAt);
      }
    }
    if (args.before) {
      // 코덱스 14차 P2: timestamp-only cursor 는 같은 last_action_at 의 행을 page 경계에서 누락 가능.
      //   "<last_action_at>|<id>" composite cursor 로 (lastAction < T) OR (lastAction = T AND id < I).
      const [bAt, bId] = args.before.split('|');
      if (bAt && bId) {
        query = query.or(`last_action_at.lt.${bAt},and(last_action_at.eq.${bAt},id.lt.${bId})`);
      } else if (bAt) {
        // 폴백 (구버전 호출처) — 단일 timestamp cursor
        query = query.lt('last_action_at', bAt);
      }
    }
  }

  const { data, error } = await query;
  if (error) {
    // 코덱스 13차 P1: 실패를 빈 결과로 swallow 하면 caller(catch-up) 가
    //   "no new notifications" 로 오해해 lastSeen 을 now 로 갱신 → 영구 데이터 손실.
    //   feedback/assignment fetch 와 동일하게 throw.
    throw new Error(`fetchCommentReactionNotifications failed: ${error.message}`);
  }
  return { data: (data ?? []).map((row) => serializeReactionNotification(row as CommentReactionNotificationRow)) };
}

export async function markCommentReactionRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('comment_reaction_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  if (error) console.warn('[markCommentReactionRead] failed:', error.message);
}

export async function markAllCommentReactionsRead(recipientId: string): Promise<void> {
  const { error } = await supabase
    .from('comment_reaction_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', recipientId)
    .is('read_at', null);
  if (error) console.warn('[markAllCommentReactionsRead] failed:', error.message);
}

export async function getCommentReactionsBulk(
  commentIds: string[],
): Promise<Record<string, CommentReactionRow[]>> {
  if (commentIds.length === 0) return {};
  const { data, error } = await supabase
    .from('comment_reactions')
    .select('id, comment_id, user_id, user_name, emoji, created_at')
    .in('comment_id', commentIds)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getCommentReactionsBulk failed: ${error.message}`);
  const grouped: Record<string, CommentReactionRow[]> = {};
  for (const row of data ?? []) {
    const cid = row.comment_id as string;
    if (!grouped[cid]) grouped[cid] = [];
    grouped[cid].push({
      id: row.id as string,
      commentId: cid,
      userId: row.user_id as string,
      userName: row.user_name as string,
      emoji: row.emoji as string,
      createdAt: row.created_at as string,
    });
  }
  return grouped;
}

// ═══════════════════════════════════════════════════════
// v1.26.0 — 이미지 버전 관리
// ═══════════════════════════════════════════════════════

export interface ImageVersionRow {
  id: string;
  sceneId: string;
  imageType: 'storyboard' | 'guide';
  versionNo: number;
  url: string;
  kind: 'replace' | 'annotate';
  baseVersionNo: number | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  description?: string | null;
}

async function mapVersionRows(rows: Record<string, unknown>[]): Promise<ImageVersionRow[]> {
  if (rows.length === 0) return [];
  // 작성자 이름 join — PostgREST embed 대신 별도 fetch (FK 임베드 명세가 자주 깨짐)
  const userIds = Array.from(new Set(rows.map((r) => r.created_by as string)));
  const { data: users } = await supabase.from('users').select('id, name').in('id', userIds);
  const nameById = new Map<string, string>();
  for (const u of users ?? []) nameById.set(u.id as string, u.name as string);
  return rows.map((r) => ({
    id: r.id as string,
    sceneId: r.scene_id as string,
    imageType: r.image_type as 'storyboard' | 'guide',
    versionNo: r.version_no as number,
    url: r.url as string,
    kind: r.kind as 'replace' | 'annotate',
    baseVersionNo: (r.base_version_no as number | null) ?? null,
    createdBy: r.created_by as string,
    createdByName: nameById.get(r.created_by as string) ?? '?',
    createdAt: r.created_at as string,
    description: (r.description as string | null) ?? null,
  }));
}

export async function listImageVersions(
  sceneId: string,
  imageType: 'storyboard' | 'guide',
): Promise<ImageVersionRow[]> {
  const { data, error } = await supabase
    .from('scene_image_versions')
    .select('id, scene_id, image_type, version_no, url, kind, base_version_no, created_by, created_at, description')
    .eq('scene_id', sceneId)
    .eq('image_type', imageType)
    .order('version_no', { ascending: true });
  if (error) throw new Error(`listImageVersions failed: ${error.message}`);
  return mapVersionRows((data ?? []) as Record<string, unknown>[]);
}

export async function addImageVersion(params: {
  sceneId: string;
  imageType: 'storyboard' | 'guide';
  kind: 'replace' | 'annotate';
  url: string;
  baseVersionNo?: number;
  createdBy: string;
  description?: string | null;
}): Promise<ImageVersionRow> {
  // 다음 version_no = max + 1.
  // 코덱스 1차 P1: max + 1 read 와 insert 사이에 다른 사용자가 같은 version_no 로 insert 하면
  //   UNIQUE 제약 위반으로 한쪽 요청이 실패. 동시 업로드 (협업 케이스) 에서 간헐적 실패.
  //   해결: UNIQUE 충돌 (Postgres 23505) 발생 시 max 를 다시 읽어 재시도. 최대 5회.
  const MAX_RETRIES = 5;
  let lastErrMsg = '';
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const { data: existing, error: listErr } = await supabase
      .from('scene_image_versions')
      .select('version_no')
      .eq('scene_id', params.sceneId)
      .eq('image_type', params.imageType)
      .order('version_no', { ascending: false })
      .limit(1);
    if (listErr) throw new Error(`addImageVersion (next no lookup) failed: ${listErr.message}`);
    const versionNo = existing && existing.length > 0 ? (existing[0].version_no as number) + 1 : 1;

    const { data, error } = await supabase
      .from('scene_image_versions')
      .insert({
        scene_id: params.sceneId,
        image_type: params.imageType,
        version_no: versionNo,
        url: params.url,
        kind: params.kind,
        base_version_no: params.baseVersionNo ?? null,
        created_by: params.createdBy,
        description: params.description ?? null,
      })
      .select()
      .single();
    if (!error) {
      return await finalizeAddImageVersion(params, data as Record<string, unknown>);
    }
    lastErrMsg = error.message;
    // UNIQUE 위반 (Postgres SQLSTATE 23505 또는 메시지 키워드) → 재시도.
    const isUniqueViolation =
      (error as { code?: string }).code === '23505' ||
      /duplicate key|unique constraint|already exists/i.test(error.message);
    if (!isUniqueViolation) {
      throw new Error(`addImageVersion (insert) failed: ${error.message}`);
    }
    // 짧은 지터 후 재시도 (동시 충돌 → 분산)
    await new Promise((res) => setTimeout(res, 30 + Math.floor(Math.random() * 60)));
  }
  throw new Error(`addImageVersion (insert) failed after ${MAX_RETRIES} retries: ${lastErrMsg}`);
}

async function finalizeAddImageVersion(
  params: {
    sceneId: string;
    imageType: 'storyboard' | 'guide';
    url: string;
  },
  data: Record<string, unknown>,
): Promise<ImageVersionRow> {

  // scenes.{type}_url 갱신 — 외부 표시는 항상 최신 버전
  const column = params.imageType === 'storyboard' ? 'storyboard_url' : 'guide_url';
  const { error: updErr } = await supabase
    .from('scenes')
    .update({ [column]: params.url, updated_at: new Date().toISOString() })
    .eq('id', params.sceneId);
  if (updErr) console.warn('[addImageVersion] scenes 갱신 실패 (버전은 추가됨):', updErr.message);

  const rows = await mapVersionRows([data as Record<string, unknown>]);
  return rows[0];
}

export async function deleteImageVersion(versionId: string): Promise<void> {
  // 마지막 1개 가드 (서버 측)
  const { data: ver, error: e1 } = await supabase
    .from('scene_image_versions')
    .select('scene_id, image_type, version_no, url')
    .eq('id', versionId)
    .single();
  if (e1 || !ver) throw new Error(`버전 조회 실패: ${e1?.message ?? 'not found'}`);

  const { data: all } = await supabase
    .from('scene_image_versions')
    .select('id, version_no, url')
    .eq('scene_id', ver.scene_id as string)
    .eq('image_type', ver.image_type as string);
  if (!all || all.length <= 1) throw new Error('마지막 버전은 삭제할 수 없습니다');

  const { error: delErr } = await supabase
    .from('scene_image_versions')
    .delete()
    .eq('id', versionId);
  if (delErr) throw new Error(`deleteImageVersion failed: ${delErr.message}`);

  // scenes.{type}_url 재계산 — 남은 것 중 최대 version_no
  const remaining = all.filter((v) => v.id !== versionId);
  const latest = remaining.reduce((m, v) =>
    (v.version_no as number) > (m.version_no as number) ? v : m,
  );
  const column = ver.image_type === 'storyboard' ? 'storyboard_url' : 'guide_url';
  await supabase
    .from('scenes')
    .update({ [column]: latest.url as string, updated_at: new Date().toISOString() })
    .eq('id', ver.scene_id as string);
}

// ─── v1.30.0: 컴포지팅 단계 상태 ────────────────────────────────
// spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
// 한 row = (에피소드, sceneId) 단위. BG/ACT 시트 무관. 권한 분기는 앱 레벨.

export type CompositingStatusValue =
  'batch' | 'combine' | 'aggregated' | 'adjust' | 'error' | 'done';

export type CompositingErrorKindValue =
  'missing_file' | 'fix_blemish' | 'retake' | 'canceled_scene' | 'other';

export interface CompositingStateRow {
  id: string;
  episode_number: number;
  scene_id: string;
  part_id: string;
  status: CompositingStatusValue;
  error_kind: CompositingErrorKindValue | null;
  error_note: string | null;
  progress_percent: number;
  updated_at: string;
  updated_by: string | null;
}

/** 한 에피소드의 모든 컴포지팅 상태 row */
export async function loadCompositingStates(
  episodeNumber: number,
): Promise<CompositingStateRow[]> {
  const { data, error } = await supabase
    .from('compositing_states')
    .select('*')
    .eq('episode_number', episodeNumber)
    .order('scene_id', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CompositingStateRow[];
}

/** UPSERT — (episode_number, scene_id) 유니크. INSERT or UPDATE 한 번에. */
export async function setCompositingState(input: {
  episodeNumber: number;
  sceneId: string;
  partId: string;
  status: CompositingStatusValue;
  errorKind?: CompositingErrorKindValue | null;
  errorNote?: string | null;
  progressPercent?: number;
  updatedBy: string;
}): Promise<CompositingStateRow> {
  const payload: Partial<CompositingStateRow> = {
    episode_number: input.episodeNumber,
    scene_id: input.sceneId,
    part_id: input.partId,
    status: input.status,
    error_kind: input.errorKind ?? null,
    error_note: input.errorNote ?? null,
    progress_percent: input.progressPercent ?? 0,
    updated_by: input.updatedBy,
    // updated_at 은 트리거가 자동 갱신
  };
  const { data, error } = await supabase
    .from('compositing_states')
    .upsert(payload as CompositingStateRow, {
      onConflict: 'episode_number,scene_id',
    })
    .select('*')
    .single();
  if (error) throw error;
  // 활동 로그 (recordActivityLog) wire 는 PR 3 이후 별도 작업.
  // 이번 PR 1 은 데이터 인프라만.
  return data as CompositingStateRow;
}

/**
 * Realtime 구독 setup — 메인 프로세스에서 한 번 호출.
 * 변경 발생 시 모든 렌더러 창에 'compositing-states:realtime' 채널로 push.
 *
 * cleanup 함수 반환 (메인 프로세스 셧다운 시 호출).
 */
export function startCompositingStatesRealtime(
  broadcast: (payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    row: CompositingStateRow | null;
    old: CompositingStateRow | null;
  }) => void,
): () => void {
  const channel = supabase
    .channel('public:compositing_states')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'compositing_states' },
      (payload) => {
        broadcast({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          row: (payload.new ?? null) as CompositingStateRow | null,
          old: (payload.old ?? null) as CompositingStateRow | null,
        });
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ─── 캐릭터 현황판 (캐릭터 / 복장 / 에피소드 매핑) ──────────────────
// 컴포지팅 대시보드(v1.30.0) 의 load/upsert/realtime 3 종 패턴을 그대로 미러링.
//   - characters: 전역 캐릭터 (BG/ACT 무관)
//   - character_costumes: 캐릭터 1:N 복장 (버전·진행 단위)
//   - episode_character_mapping: 캐릭터 N:M 에피소드

export type CostumeDesignStageValue = 'waiting' | 'in_progress' | 'feedback' | 'done';
export type CostumeRiggingStageValue = 'waiting' | 'vectorized' | 'rigging' | 'feedback' | 'done';

export interface CharacterRow {
  id: string;
  name: string;
  status: 'active' | 'archived';
  memo: string | null;
  work_folder_path: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface CharacterCostumeRow {
  id: string;
  character_id: string;
  name: string;
  version_no: number;
  design_stage: CostumeDesignStageValue;
  rigging_stage: CostumeRiggingStageValue;
  featured_image_url: string | null;
  work_file_path: string | null;
  image_background: 'transparent' | 'black' | 'white' | 'checker';
  image_fit: { scale: number; scaleX?: number; scaleY?: number; x: number; y: number; lockAspect: boolean };
  structure_tags: string[];
  asset_tags: string[];
  design_assignee: string | null;
  rigging_assignee: string | null;
  assignee: string | null;
  memo: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/** 캐릭터-에피소드 매핑 row. episode_number 는 episodes 조인으로 채워 렌더러가 매핑하기 쉽게 함. */
export interface EpisodeCharacterMapRow {
  id: string;
  episode_id: string;
  character_id: string;
  episode_number: number | null;
  /** 이 편에서의 주의점 메모 (episode_character_mapping.memo). */
  memo: string | null;
  /** 이 편에서 사용하는 복장 (episode_character_mapping.costume_id, FK character_costumes ON DELETE SET NULL). */
  costume_id: string | null;
  created_at: string;
}

/** PostgREST 1000 행 제한 회피 — .range() 페이지네이션 반복 로드 (project_postgrest_1000_row_cap). */
async function loadAllRows<T>(
  table: string,
  select: string,
  order: { column: string; ascending: boolean },
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(order.column, { ascending: order.ascending })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/** 모든 캐릭터 (active + archived). 페이지네이션 반복. */
export async function loadCharacters(): Promise<CharacterRow[]> {
  return loadAllRows<CharacterRow>('characters', '*', { column: 'sort_order', ascending: true });
}

/** 모든 복장. 페이지네이션 반복. */
export async function loadCharacterCostumes(): Promise<CharacterCostumeRow[]> {
  return loadAllRows<CharacterCostumeRow>(
    'character_costumes',
    '*',
    { column: 'sort_order', ascending: true },
  );
}

/** 모든 캐릭터-에피소드 매핑 (episode_number 조인). 페이지네이션 반복. */
export async function loadEpisodeCharacterMap(): Promise<EpisodeCharacterMapRow[]> {
  const rows = await loadAllRows<{
    id: string;
    episode_id: string;
    character_id: string;
    memo: string | null;
    costume_id: string | null;
    created_at: string;
    episodes: { episode_number: number } | null;
  }>(
    'episode_character_mapping',
    'id, episode_id, character_id, memo, costume_id, created_at, episodes(episode_number)',
    { column: 'created_at', ascending: true },
  );
  return rows.map((r) => ({
    id: r.id,
    episode_id: r.episode_id,
    character_id: r.character_id,
    episode_number: r.episodes?.episode_number ?? null,
    memo: r.memo ?? null,
    costume_id: r.costume_id ?? null,
    created_at: r.created_at,
  }));
}

/** 캐릭터 추가 (INSERT). sort_order 는 현재 최대값 +1. */
export async function addCharacter(input: {
  name: string;
  memo?: string | null;
  createdBy?: string | null;
}): Promise<CharacterRow> {
  const { data: maxRow } = await supabase
    .from('characters')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;
  const { data, error } = await supabase
    .from('characters')
    .insert({
      name: input.name,
      memo: input.memo ?? null,
      sort_order: nextOrder,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as CharacterRow;
}

/** 캐릭터 수정 (단일 update 쿼리 — 여러 컬럼 한 번에). */
export async function updateCharacter(
  id: string,
  updates: Record<string, unknown>,
): Promise<CharacterRow> {
  const { data, error } = await supabase
    .from('characters')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as CharacterRow;
}

/** 에피소드 릴 파일 경로 수정. 실제 파일은 건드리지 않고 경로만 저장한다. */
export async function updateEpisodeReelPath(
  episodeNumber: number,
  reelFilePath: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('episodes')
    .update({ reel_file_path: reelFilePath, updated_at: new Date().toISOString() })
    .eq('episode_number', episodeNumber);
  if (error) throw error;
  broadcastDataChange('episodes', 'UPDATE');
}

/** public URL 들에서 scene-images 스토리지 경로를 뽑아 일괄 삭제. legacy/비-Supabase URL 은 무시. 실패해도 삭제 흐름은 진행. */
async function removeCharacterStorageByUrl(urls: (string | null | undefined)[]): Promise<void> {
  const paths = urls
    .map((u) => (typeof u === 'string' ? u.match(/\/storage\/v1\/object\/public\/scene-images\/(.+)$/)?.[1] : undefined))
    .filter((p): p is string => !!p);
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from('scene-images').remove(paths);
  if (error) console.warn('[character-board] 스토리지 자산 정리 실패(무시하고 진행):', error.message);
}

/** 캐릭터 삭제. 복장/매핑/댓글은 FK cascade 로 자동 삭제 — cascade 전에 스토리지 자산을 먼저 정리한다. */
export async function deleteCharacter(id: string): Promise<void> {
  // 복장 대표 이미지 + 캐릭터 댓글 첨부 이미지를 cascade 전에 수집해 삭제(고아 파일 방지).
  const [{ data: costumeRows }, { data: commentRows }] = await Promise.all([
    supabase.from('character_costumes').select('featured_image_url').eq('character_id', id),
    supabase.from('comments').select('images').eq('character_id', id),
  ]);
  const urls: (string | null | undefined)[] = [];
  for (const r of costumeRows ?? []) urls.push((r as { featured_image_url?: string | null }).featured_image_url);
  for (const r of commentRows ?? []) {
    const imgs = (r as { images?: unknown }).images;
    if (Array.isArray(imgs)) for (const u of imgs) if (typeof u === 'string') urls.push(u);
  }
  // DB row 삭제(cascade) 먼저 — 실패 시 throw 하고 스토리지는 건드리지 않아, 롤백된 row 가 깨진 URL 을 가리키지 않게 한다.
  const { error } = await supabase.from('characters').delete().eq('id', id);
  if (error) throw error;
  // 삭제 성공 후에만 스토리지 자산 정리.
  await removeCharacterStorageByUrl(urls);
}

/** 복장 추가 (INSERT). sort_order 는 해당 캐릭터 내 최대값 +1. */
export async function addCharacterCostume(input: {
  characterId: string;
  name: string;
  createdBy?: string | null;
}): Promise<CharacterCostumeRow> {
  const { data: maxRow } = await supabase
    .from('character_costumes')
    .select('sort_order')
    .eq('character_id', input.characterId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;
  const { data, error } = await supabase
    .from('character_costumes')
    .insert({
      character_id: input.characterId,
      name: input.name,
      sort_order: nextOrder,
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as CharacterCostumeRow;
}

/** 복장 수정 (단일 update 쿼리 — design_stage/rigging_stage/version_no 등 여러 컬럼 한 번에). */
export async function updateCharacterCostume(
  id: string,
  updates: Record<string, unknown>,
): Promise<CharacterCostumeRow> {
  // featured_image_url 교체 시 이전 객체를 정리하려고 기존 값을 먼저 읽어둔다(이미지 변경일 때만).
  let prevImageUrl: string | null = null;
  if ('featured_image_url' in updates) {
    const { data: cur } = await supabase
      .from('character_costumes')
      .select('featured_image_url')
      .eq('id', id)
      .maybeSingle();
    prevImageUrl = (cur as { featured_image_url?: string | null } | null)?.featured_image_url ?? null;
  }
  const { data, error } = await supabase
    .from('character_costumes')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  // DB 업데이트 성공 후에만 이전 대표 이미지 정리(롤백 시 깨진 URL 방지). 실제로 바뀐 경우만.
  const newImageUrl = (updates as { featured_image_url?: string | null }).featured_image_url ?? null;
  if (prevImageUrl && prevImageUrl !== newImageUrl) {
    await removeCharacterStorageByUrl([prevImageUrl]);
  }
  return data as CharacterCostumeRow;
}

/** 복장 삭제. 삭제 전 대표 이미지 스토리지 객체를 정리해 고아 파일을 방지한다. */
export async function deleteCharacterCostume(id: string): Promise<void> {
  const { data: row } = await supabase
    .from('character_costumes')
    .select('featured_image_url')
    .eq('id', id)
    .maybeSingle();
  const { error } = await supabase.from('character_costumes').delete().eq('id', id);
  if (error) throw error;
  // 삭제 성공 후에만 대표 이미지 객체 정리.
  await removeCharacterStorageByUrl([(row as { featured_image_url?: string | null } | null)?.featured_image_url]);
}

/** 캐릭터-에피소드 연결 (UPSERT, onConflict 'episode_id,character_id'). episodeNumber → episode_id 해석. */
export async function linkCharacterEpisode(
  episodeNumber: number,
  characterId: string,
  createdBy?: string | null,
): Promise<EpisodeCharacterMapRow> {
  const { data: ep, error: epErr } = await supabase
    .from('episodes')
    .select('id, episode_number')
    .eq('episode_number', episodeNumber)
    .maybeSingle();
  if (epErr) throw epErr;
  if (!ep) throw new Error(`에피소드 ${episodeNumber} 를 찾을 수 없습니다`);
  const { data, error } = await supabase
    .from('episode_character_mapping')
    .upsert(
      { episode_id: ep.id as string, character_id: characterId, created_by: createdBy ?? null },
      { onConflict: 'episode_id,character_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return {
    id: data.id as string,
    episode_id: data.episode_id as string,
    character_id: data.character_id as string,
    episode_number: ep.episode_number as number,
    memo: (data.memo ?? null) as string | null,
    costume_id: (data.costume_id ?? null) as string | null,
    created_at: data.created_at as string,
  };
}

/** 캐릭터-에피소드 연결 해제. episodeNumber → episode_id 해석 후 삭제. */
export async function unlinkCharacterEpisode(
  episodeNumber: number,
  characterId: string,
): Promise<void> {
  const { data: ep, error: epErr } = await supabase
    .from('episodes')
    .select('id')
    .eq('episode_number', episodeNumber)
    .maybeSingle();
  if (epErr) throw epErr;
  if (!ep) return;
  const { error } = await supabase
    .from('episode_character_mapping')
    .delete()
    .eq('episode_id', ep.id as string)
    .eq('character_id', characterId);
  if (error) throw error;
}

/**
 * 캐릭터-에피소드 매핑의 이 편 전용 필드 수정 (memo / costume_id).
 * (episode_number → episode_id 해석 후 episode_id & character_id 조건으로 update.)
 * memo / costumeId 둘 중 전달된 것만 update. costumeId === null 이면 복장 선택 해제.
 */
export async function updateEpisodeCharacterMapping(
  episodeNumber: number,
  characterId: string,
  updates: { memo?: string | null; costumeId?: string | null },
): Promise<void> {
  const { data: ep, error: epErr } = await supabase
    .from('episodes')
    .select('id')
    .eq('episode_number', episodeNumber)
    .maybeSingle();
  if (epErr) throw epErr;
  if (!ep) throw new Error(`에피소드 ${episodeNumber} 를 찾을 수 없습니다`);
  const patch: Record<string, unknown> = {};
  if (updates.memo !== undefined) patch.memo = updates.memo;
  if (updates.costumeId !== undefined) patch.costume_id = updates.costumeId;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from('episode_character_mapping')
    .update(patch)
    .eq('episode_id', ep.id as string)
    .eq('character_id', characterId);
  if (error) throw error;
}

/**
 * 캐릭터 현황판 Realtime 구독 — 메인 프로세스에서 한 번 호출.
 * 한 채널 'public:character_board' 에서 세 테이블 postgres_changes 구독.
 * payload 에 table 판별자 포함 → 렌더러가 어느 엔티티 변경인지 구분.
 *
 * cleanup 함수 반환.
 */
export function startCharacterBoardRealtime(
  broadcast: (payload: {
    table: 'characters' | 'character_costumes' | 'episode_character_mapping';
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    row: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
  }) => void,
  /** 채널 구독 상태 통지 — 렌더러가 SUBSCRIBED(재합류) 시 catch-up 로드를 트리거하는 데 사용. */
  onStatus?: (status: string) => void,
): () => void {
  const tables = ['characters', 'character_costumes', 'episode_character_mapping'] as const;
  const retry = createRetryManager('CharacterBoardRealtime');
  const episodeNumberCache = new Map<string, number>();
  // 이벤트마다 독립 async 로 enrich 하면 완료 순서가 도착 순서와 어긋날 수 있어(늦은 select 가
  // 나중 이벤트를 추월) 채널 단위 promise 체인으로 직렬화 — 도착 순서 = 브로드캐스트 순서 보장.
  let broadcastQueue: Promise<void> = Promise.resolve();
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let stopped = false;

  const buildChannel = () => {
    let ch = supabase.channel('public:character_board');
    for (const table of tables) {
      ch = ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          const row = (payload.new ?? null) as Record<string, unknown> | null;
          const old = (payload.old ?? null) as Record<string, unknown> | null;
          const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
          broadcastQueue = broadcastQueue.then(async () => {
            try {
              const enriched = await enrichEpisodeCharacterMappingPayload(table, row, old, episodeNumberCache);
              broadcast({ table, eventType, row: enriched.row, old: enriched.old });
            } catch (err) {
              console.warn('[character-board] realtime payload enrich 실패:', err);
              broadcast({ table, eventType, row, old });
            }
          });
        },
      );
    }
    return ch;
  };

  const connect = () => {
    if (stopped) return;
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
    const newChannel = buildChannel();
    channel = newChannel;
    newChannel.subscribe((status) => {
      if (stopped || channel !== newChannel) return;
      onStatus?.(status);
      if (status === 'SUBSCRIBED') {
        retry.reset();
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        // 채널 단독 장애도 지수 백오프로 재구독 (bflow-realtime 채널과 동일 패턴).
        const scheduled = retry.schedule(connect);
        if (!scheduled) console.warn('[character-board] realtime 재시도 한도 초과 — 구독 중단');
      }
    });
  };

  connect();
  return () => {
    stopped = true;
    retry.clear();
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  };
}

async function enrichEpisodeCharacterMappingPayload(
  table: 'characters' | 'character_costumes' | 'episode_character_mapping',
  row: Record<string, unknown> | null,
  old: Record<string, unknown> | null,
  episodeNumberCache?: Map<string, number>,
): Promise<{ row: Record<string, unknown> | null; old: Record<string, unknown> | null }> {
  if (table !== 'episode_character_mapping') return { row, old };
  const episodeId = (row?.episode_id ?? old?.episode_id) as string | undefined;
  if (!episodeId) return { row, old };

  let episodeNumber = episodeNumberCache?.get(episodeId);
  if (typeof episodeNumber !== 'number') {
    const { data, error } = await supabase
      .from('episodes')
      .select('episode_number')
      .eq('id', episodeId)
      .maybeSingle();
    if (error || typeof data?.episode_number !== 'number') return { row, old };
    episodeNumber = data.episode_number;
    episodeNumberCache?.set(episodeId, episodeNumber);
  }

  const attach = (value: Record<string, unknown> | null) => (
    value ? { ...value, episode_number: episodeNumber as number } : value
  );
  return { row: attach(row), old: attach(old) };
}
