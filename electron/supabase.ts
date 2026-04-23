import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { broadcastSceneUpdate, broadcastSceneFieldUpdate, broadcastDataChange, broadcastCommentAdded, broadcastCalendarChanged } from './broadcast';
import { deleteImage as storageDeleteImage } from './storage';

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

/** 대량 씬 체크박스 토글 (부분 실패 허용) — RPC 경유 */
export async function bulkUpdateSceneStages(
  updates: BulkStageUpdate[],
  updatedBy: string,
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
): Promise<BulkUpdateResult[]> {
  // 1) 씬 UUID → 이미지 URL 목록 맵을 먼저 확보 (RPC 가 실제로 삭제한 씬만 이미지 정리하기 위함)
  const urlsByUuid = new Map<string, string[]>();
  {
    const { data: scenes } = await supabase
      .from('scenes')
      .select('id, storyboard_url, guide_url')
      .in('id', sceneUuids);
    for (const s of scenes ?? []) {
      const urls: string[] = [];
      if (s.storyboard_url) urls.push(s.storyboard_url as string);
      if (s.guide_url) urls.push(s.guide_url as string);
      if (urls.length > 0) urlsByUuid.set(s.id as string, urls);
    }
  }

  // 2) RPC 실행 (부분 실패 허용)
  const { data, error } = await supabase.rpc('bulk_delete_scenes', {
    p_uuids: sceneUuids,
    p_deleted_by: deletedBy,
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
): Promise<BulkUpdateResult[]> {
  const { data, error } = await supabase.rpc('bulk_update_scene_fields', {
    p_updates: updates.map((u) => ({
      sceneUuid: u.sceneUuid,
      fields: {
        assignee: u.fields.assignee,
        memo: u.fields.memo,
        layout: u.fields.layoutId,
        storyboardUrl: u.fields.storyboardUrl,
        guideUrl: u.fields.guideUrl,
      },
    })),
    p_updated_by: updatedBy,
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

  const { error } = await supabase.from('comments').insert({
    id: commentId,
    part_id: partUuid,
    scene_id: sceneId,
    scene_uuid: sceneUuid,
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
  lookupDepartment: string,
  requesterId: string,
  requesterName: string,
  assignee: string,
  createdAt: string,
): Promise<void> {
  // partUuid가 비어있으면 sceneId(=sceneKey)에서 역조회
  let resolvedPartUuid = partUuid;
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
  const sceneUuid = await resolveSceneUuidByNumberWithRetry(resolvedPartUuid, sceneIdForResolve);

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

  const { error } = await supabase.from('comp_revisions').insert({
    id,
    part_id: resolvedPartUuid,
    scene_id: sceneId,
    scene_uuid: sceneUuid, // null 가능 — synthetic merged ID 의 경우
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
