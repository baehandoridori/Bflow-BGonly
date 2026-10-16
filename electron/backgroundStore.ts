/** Main-only transport: server-issued sessions are the only identity accepted by SQL. */
import { validateBackgroundRequest } from '../src/features/backgrounds/domain';
import type { BackgroundRequest, BackgroundSnapshot } from '../src/features/backgrounds/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface BackgroundRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}
export interface BackgroundSessionResolver { tokenFor(actorId: string): string }

function parseSnapshot(data: unknown): BackgroundSnapshot {
  const value = data as BackgroundSnapshot | null;
  if (!value || typeof value !== 'object' || typeof value.canManage !== 'boolean'
    || !['places', 'maps', 'views', 'groups', 'usages'].every(key => Array.isArray(value[key as keyof BackgroundSnapshot]))) {
    throw new Error('배경 저장소가 올바른 결과를 반환하지 않았습니다.');
  }
  return value;
}

/** The editor list of the background library (2026-10-16): the ids of the users an admin picked, as the server has them. */
export function parseEditorIds(data: unknown): string[] {
  if (!Array.isArray(data) || data.length > 1000 || !data.every(item => typeof item === 'string' && item.length > 0 && item.length <= 200)) {
    throw new Error('배경 편집자 명단이 올바르지 않습니다.');
  }
  return data as string[];
}

export function createBackgroundStore(client: BackgroundRpcClient, sessions: BackgroundSessionResolver) {
  async function call<T = BackgroundSnapshot>(actorId: string, name: string, args: Record<string, unknown> = {}, parse: (data: unknown) => T = parseSnapshot as (data: unknown) => T): Promise<T> {
    const token = sessions.tokenFor(actorId);
    if (typeof token !== 'string' || !token.trim()) throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.');
    const { data, error } = await client.rpc(name, { p_session_token: token, ...args });
    if (error) {
      if (['42P01', 'PGRST205', '42883', 'PGRST202'].includes(error.code ?? '')) {
        throw new Error('배경 저장소 준비가 필요합니다. 배경 라이브러리 데이터베이스 업데이트를 적용해 주세요.');
      }
      throw Object.assign(new Error(error.message || '배경 저장 중 오류가 발생했습니다.'), { code: error.code });
    }
    return parse(data);
  }
  return {
    read: (actorId: string): Promise<BackgroundSnapshot> => call(actorId, 'background_library_read'),
    execute: async (actorId: string, request: BackgroundRequest): Promise<BackgroundSnapshot> => {
      validateBackgroundRequest(request);
      return call(actorId, 'background_library_execute', { p_request_id: request.requestId, p_command: request.command });
    },
    /** Admins only: the server refuses everyone else (42501). */
    listEditors: (actorId: string): Promise<string[]> => call(actorId, 'background_editors_session_list', {}, parseEditorIds),
    setEditor: async (actorId: string, userId: string, editor: boolean): Promise<string[]> => {
      if (typeof userId !== 'string' || !userId || userId.length > 200 || typeof editor !== 'boolean') throw new Error('배경 편집자로 정할 사용자가 올바르지 않습니다.');
      return call(actorId, 'background_editors_session_set', { p_user_id: userId, p_editor: editor }, parseEditorIds);
    },
  };
}

/** Broadcast contains only an invalidation signal. Every receiver rereads through its session. */
export function startBackgroundRealtime(client: Pick<SupabaseClient, 'channel' | 'removeChannel'>, onChanged: () => void): () => void {
  const channel = client.channel('background-library').on('broadcast', { event: 'changed' }, () => onChanged())
    .subscribe(status => { if (status === 'SUBSCRIBED') onChanged(); });
  return () => { void client.removeChannel(channel); };
}
