/**
 * BAE경 서버 통로 (메인 전용). 신원은 서버가 발급한 세션 토큰으로만 정한다 — 화면이 보낸 사용자 id 를 믿지 않는다
 * (Bflow CLAUDE.md 필수 규칙 7). 토큰과 키는 이 모듈 밖으로 나가지 않는다.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseBaeAccess, parseBaeMembers, type BaeAccess, type BaeMember, type BaeMemberRole } from '../../src/shared/bae/access';
import { isBaeSettingKey, type BaeSettingKey, type BaeSettingRow } from '../../src/shared/bae/settings';
import { maskSecrets, parseBaeKeyStatus, type BaeKeyStatus } from '../../src/shared/bae/secrets';

export interface BaeRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}
export interface BaeSessionResolver { tokenFor(actorId: string): string }

/** DB 업데이트가 아직 없을 때의 코드 (표 · 함수 없음). */
const NOT_READY = ['42P01', 'PGRST205', '42883', 'PGRST202'];

export function parseSettingRows(data: unknown): BaeSettingRow[] {
  if (!Array.isArray(data) || data.length > 50) throw new Error('BAE경 설정 응답이 올바르지 않아요.');
  return data.map((item) => {
    const r = item as Record<string, unknown> | null;
    if (!r || !isBaeSettingKey(r.key) || typeof r.revision !== 'number' || !Number.isSafeInteger(r.revision) || r.revision < 1) throw new Error('BAE경 설정 줄이 올바르지 않아요.');
    return { key: r.key, value: r.value, revision: r.revision, version: null, updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null, updatedBy: typeof r.updatedBy === 'string' ? r.updatedBy : null };
  });
}

export function createBaeStore(client: BaeRpcClient, sessions: BaeSessionResolver) {
  async function call<T>(actorId: string, name: string, args: Record<string, unknown>, parse: (data: unknown) => T): Promise<T> {
    const token = sessions.tokenFor(actorId);
    if (typeof token !== 'string' || !token.trim()) throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.');
    const { data, error } = await client.rpc(name, { p_session_token: token, ...args });
    if (error) {
      if (NOT_READY.includes(error.code ?? '')) throw Object.assign(new Error('BAE경 서버 준비가 필요해요. 관리자에게 BAE경 데이터베이스 업데이트를 부탁해 주세요.'), { code: 'BAE_NOT_READY' });
      // 서버 오류 글에 무엇이 섞여 와도 키 모양은 가린다.
      throw Object.assign(new Error(maskSecrets(error.message || 'BAE경 서버 오류가 났어요.')), { code: error.code });
    }
    return parse(data);
  }
  return {
    access: (actorId: string): Promise<BaeAccess> => call(actorId, 'bae_gyeong_session_access', {}, parseBaeAccess),
    settingsGet: (actorId: string): Promise<BaeSettingRow[]> => call(actorId, 'bae_gyeong_session_settings_get', {}, parseSettingRows),
    settingsSave: (actorId: string, key: BaeSettingKey, value: unknown, expectedRevision: number): Promise<BaeSettingRow> =>
      call(actorId, 'bae_gyeong_session_settings_save', { p_key: key, p_value: value, p_expected_revision: expectedRevision }, (d) => parseSettingRows([d])[0]),
    settingsHistory: (actorId: string, key: BaeSettingKey): Promise<BaeSettingRow[]> =>
      call(actorId, 'bae_gyeong_session_settings_history', { p_key: key }, parseSettingRows),
    keyStatus: (actorId: string): Promise<BaeKeyStatus> => call(actorId, 'bae_gyeong_session_key_status', {}, parseBaeKeyStatus),
    setKey: (actorId: string, key: string): Promise<BaeKeyStatus> => call(actorId, 'bae_gyeong_session_set_key', { p_key: key }, parseBaeKeyStatus),
    /** 메인 전용: 이 사람의 호출에 쓸 키. 화면으로 보내는 통로는 없다. */
    getKey: (actorId: string): Promise<{ key: string; label: string }> => call(actorId, 'bae_gyeong_session_get_key', {}, (d) => {
      const v = d as Record<string, unknown> | null;
      if (!v || typeof v.key !== 'string' || !v.key || typeof v.label !== 'string') throw new Error('BAE경 키 응답이 올바르지 않아요.');
      return { key: v.key, label: v.label };
    }),
    membersList: (actorId: string): Promise<BaeMember[]> => call(actorId, 'bae_gyeong_session_members_list', {}, parseBaeMembers),
    membersSet: (actorId: string, userId: string, role: BaeMemberRole | null): Promise<BaeMember[]> =>
      call(actorId, 'bae_gyeong_session_members_set', { p_user_id: userId, p_role: role }, parseBaeMembers),
  };
}
export type BaeStore = ReturnType<typeof createBaeStore>;

/** 내용 없는 신호만 받는다. 받은 쪽은 자기 세션으로 다시 읽는다. */
export function startBaeRealtime(client: Pick<SupabaseClient, 'channel' | 'removeChannel'>, onSignal: (what: 'settings' | 'members' | 'jobs') => void): () => void {
  const channel = client.channel('bae-gyeong')
    .on('broadcast', { event: 'settings-changed' }, () => onSignal('settings'))
    .on('broadcast', { event: 'members-changed' }, () => onSignal('members'))
    .on('broadcast', { event: 'jobs-changed' }, () => onSignal('jobs'))
    .subscribe((status) => { if (status === 'SUBSCRIBED') { onSignal('settings'); onSignal('members'); onSignal('jobs'); } });
  return () => { void client.removeChannel(channel); };
}
