/**
 * BAE경 '이 PC 점검' 결과를 서버 표에 올리고 읽는 통로 (메인 전용).
 * 신원은 세션 토큰으로만 — 누구의 줄인지는 서버가 정한다 (DEVLOG/migrations/2026-11-16-bae-gyeong-pc-check.sql).
 * PC 번호는 이 PC 에 한 번 만들어 두는 무작위 번호 (%LOCALAPPDATA%\Bflow-BGonly\bae\pc-id) — 계정과 무관.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BaeRpcClient, BaeSessionResolver } from '../baeStore';
import { maskSecrets } from '../../../src/shared/bae/secrets';
import { baePcCheckPayload, parseBaePcCheckRows, type BaePcCheck, type BaePcCheckRow } from '../../../src/shared/bae/pcCheck';
import { writeFileAtomic } from '../atomicFile';

const NOT_READY = ['42P01', 'PGRST205', '42883', 'PGRST202'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 이 PC 의 번호 (없으면 만든다). 같은 파일을 여러 번 불러도 같은 값. */
export async function baePcId(file: string): Promise<string> {
  try { const v = (await readFile(file, 'utf8')).trim(); if (UUID.test(v)) return v; } catch { /* 처음 */ }
  const id = randomUUID();
  await writeFileAtomic(file, id);
  return id;
}

export function createBaePcCheckStore(client: BaeRpcClient, sessions: BaeSessionResolver) {
  async function call<T>(actorId: string, name: string, args: Record<string, unknown>, parse: (d: unknown) => T): Promise<T> {
    const token = sessions.tokenFor(actorId);
    if (typeof token !== 'string' || !token.trim()) throw new Error('로그인 세션이 필요합니다. 다시 로그인해 주세요.');
    const { data, error } = await client.rpc(name, { p_session_token: token, ...args });
    if (error) {
      if (NOT_READY.includes(error.code ?? '')) throw Object.assign(new Error('BAE경 서버 준비가 필요해요. 관리자에게 BAE경 데이터베이스 업데이트(이 PC 점검)를 부탁해 주세요.'), { code: 'BAE_NOT_READY' });
      throw Object.assign(new Error(maskSecrets(error.message || 'BAE경 서버 오류가 났어요.')), { code: error.code });
    }
    return parse(data);
  }
  return {
    /** 내 이 PC 의 점검 결과를 올린다 (같은 사람 · 같은 PC 는 한 줄로 바뀐다). */
    put: (actorId: string, pcId: string, check: BaePcCheck): Promise<BaePcCheckRow> =>
      call(actorId, 'bae_gyeong_session_pc_check_put', { p_check: baePcCheckPayload(pcId, check) }, (d) => parseBaePcCheckRows([d])[0]),
    /** 관리자 · 검수자: 모든 사람의 PC 점검 표 (최근 것부터). */
    list: (actorId: string): Promise<BaePcCheckRow[]> => call(actorId, 'bae_gyeong_session_pc_check_list', {}, parseBaePcCheckRows),
  };
}
export type BaePcCheckStore = ReturnType<typeof createBaePcCheckStore>;
