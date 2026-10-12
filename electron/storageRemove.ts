// node --test 가 직접 import 하는 순수 모듈 — electron·supabase 를 import 하지 말 것 (저장소는 주입받는다).

// @ts-expect-error TS5097 — Node 내장 TS 테스트는 runtime import의 .ts 확장자가 필요하고, Electron 빌드는 Vite가 번들한다.
import { withCharacterOriginalPaths } from '../src/shared/characterImageOriginal.ts';

/**
 * 공개 주소 → 버킷 안 경로. 저장소 밖 주소(legacy drive URL 등)는 null.
 * 공개 주소는 이름의 공백을 %20 으로 적는다 — 되돌리지 않으면 저장소에 없는 이름을 지우려다 조용히 지나간다.
 */
export function storagePathFromPublicUrl(url: unknown): string | null {
  const match = typeof url === 'string' ? /\/storage\/v1\/object\/public\/scene-images\/(.+)$/.exec(url) : null;
  if (!match) return null;
  try {
    return decodeURI(match[1]);
  } catch {
    return match[1];
  }
}

/** supabase.storage.from(버킷).remove 와 같은 모양 — 실제로 지운 파일만 돌려준다. */
export type StorageRemover = (paths: string[]) => Promise<{
  data: { name?: string | null }[] | null;
  error: { message: string } | null;
}>;

/** 한 번에 보내는 경로 수 — 씬 수백 개를 한꺼번에 지울 때 요청 하나가 지나치게 커지지 않게. */
export const STORAGE_REMOVE_CHUNK = 200;

/**
 * 저장소 파일 지우기 — 지웠다고 돌아온 이름까지 맞춰 본다.
 * 저장소는 지우지 못한 파일(아직 쓰이는 그림, 이미 없는 파일, 권한 부족)을 오류 없이 건너뛰고 지운 것만 돌려준다.
 * 오류만 보면 하나도 지우지 못한 채 성공처럼 지나간다 — 읽기 정책이 없던 2026-04~10 에 실제로 그랬다.
 * 캐릭터 그림은 함께 보관한 원본(.orig)도 같이 지운다. 원본은 없는 그림이 많아 지워지지 않아도 세지 않는다.
 * 지우지 못한 경로를 돌려준다. 던지지 않는다 — 부르는 쪽의 삭제 흐름은 그대로 간다.
 */
export async function removeStoragePaths(remove: StorageRemover, paths: string[], tag: string): Promise<string[]> {
  const wanted = [...new Set(paths)];
  const removed = new Set<string>();
  let reason = '지웠다는 답이 없음(아직 쓰이는 그림이거나 이미 없는 파일, 또는 권한 문제)';
  for (let at = 0; at < wanted.length; at += STORAGE_REMOVE_CHUNK) {
    try {
      const { data, error } = await remove(withCharacterOriginalPaths(wanted.slice(at, at + STORAGE_REMOVE_CHUNK)));
      if (error) reason = error.message;
      for (const file of data ?? []) if (file.name) removed.add(file.name);
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
  }
  const left = wanted.filter((path) => !removed.has(path));
  if (left.length > 0) console.warn(`${tag} 저장소에서 지워지지 않은 파일 ${left.length}/${wanted.length}개 — ${reason}`, left);
  return left;
}
