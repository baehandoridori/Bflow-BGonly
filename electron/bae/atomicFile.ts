/**
 * 반쯤 쓴 파일이 남지 않게 쓰기: 같은 폴더의 임시 파일에 다 쓰고 → 디스크에 내리고 → 이름 바꾸기.
 * BAE경 이 PC 보관함(localStore)과 못 보낸 것 줄(outbox)이 같이 쓴다. electron 을 import 하지 않는다.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 임시 파일 이름은 점으로 시작한다 (목록을 훑을 때 건너뛴다). */
export const isTempName = (name: string) => name.startsWith('.');

/** 윈도우에서 백신 · 색인기가 잠깐 쥐고 있으면 이름 바꾸기가 실패한다: 조금 기다렸다가 몇 번 더. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await sleep(15 * (attempt + 1));
    }
  }
}

export async function writeFileAtomic(file: string, data: Uint8Array | string): Promise<void> {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(file)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
  try {
    const fh = await open(tmp, 'w');
    try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
    await renameWithRetry(tmp, file);
  } catch (error) {
    // 방금 이 함수가 만든 임시 파일만 치운다 (다른 파일은 건드리지 않는다).
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}
