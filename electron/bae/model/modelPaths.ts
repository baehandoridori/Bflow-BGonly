/**
 * BAE경 모델 창고의 자리 (계획 14 9-2): G 공유 드라이브의 Bflow 배포 폴더(…\Bflow-BGonly\dist) 바로 옆 models 폴더.
 * 배포 폴더는 자동 업데이트가 찾는 방법 그대로 찾는다 (electron/autoUpdate/paths.ts findRemoteDistRoot — 한글 · 영어 드라이브 이름,
 * 드라이브 글자 상관없음). 경로 글자를 여기에 따로 적지 않는다.
 * 시험 · 개발: 환경 변수 BFLOW_BAE_MODEL_WAREHOUSE 에 PC 폴더를 적으면 그곳을 창고로 쓴다.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { findRemoteDistRoot } from '../../autoUpdate/paths';

let cached: { at: number; dir: string | null } | null = null;

export function baeModelWarehouseDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.BFLOW_BAE_MODEL_WAREHOUSE;
  if (override) return isDir(override) ? path.resolve(override) : null;
  // 드라이브 26개를 훑으므로 잠깐 기억한다 (1분)
  if (cached && Date.now() - cached.at < 60_000) return cached.dir;
  let dir: string | null = null;
  try {
    const dist = findRemoteDistRoot();
    const models = dist ? path.join(path.dirname(dist), 'models') : null;
    dir = models && isDir(models) ? models : null;
  } catch { dir = null; }
  cached = { at: Date.now(), dir };
  return dir;
}

function isDir(p: string): boolean {
  try { return existsSync(p) && statSync(p).isDirectory(); } catch { return false; }
}
