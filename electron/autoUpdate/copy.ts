/**
 * v1.21.0 자동 업데이트 — 디렉토리 mirror.
 * robocopy 패턴(변경된 파일만 복사 + 사라진 파일 제거)을 Node fs로 직접 구현.
 * 외부 robocopy.exe 의존성 X — CI/Mac 호환.
 *
 * 우리 win-unpacked는 ~188MB이라 메모리·시간 OK. 변경분만 복사라 일상 update에서는 보통
 * 0~수 MB만 실제 I/O.
 */
import { promises as fsp, existsSync, statSync } from 'fs';
import path from 'path';

/**
 * src의 모든 파일을 dst로 복사. dst에만 있는 파일은 제거 (mirror).
 * 같은 size + (mtime 차이 < 2초)면 skip — 빠른 변경분-only 복사.
 *
 * @param onProgress 옵션 — 진행률 콜백 (relPath, copiedSoFar, total)
 * @throws src 없으면 Error.
 */
export async function copyDirMirror(
  src: string,
  dst: string,
  onProgress?: (relPath: string, copied: number, total: number) => void,
): Promise<void> {
  if (!existsSync(src)) throw new Error(`source 없음: ${src}`);
  await fsp.mkdir(dst, { recursive: true });

  const allFiles = await collectFiles(src);
  let copied = 0;
  for (const rel of allFiles) {
    const srcFile = path.join(src, rel);
    const dstFile = path.join(dst, rel);
    await fsp.mkdir(path.dirname(dstFile), { recursive: true });

    let needCopy = true;
    if (existsSync(dstFile)) {
      try {
        const ss = statSync(srcFile);
        const ds = statSync(dstFile);
        if (ss.size === ds.size && Math.abs(ss.mtimeMs - ds.mtimeMs) < 2000) {
          needCopy = false;
        }
      } catch { /* stat 실패면 그냥 복사 */ }
    }
    if (needCopy) {
      await fsp.copyFile(srcFile, dstFile);
    }
    copied++;
    onProgress?.(rel, copied, allFiles.length);
  }

  // dst 청소: src에 없는 파일 제거 (mirror)
  await pruneOrphans(src, dst);
}

async function collectFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await fsp.readdir(path.join(root, prefix), { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const rel = path.join(prefix, e.name);
    if (e.isDirectory()) {
      out.push(...await collectFiles(root, rel));
    } else if (e.isFile()) {
      out.push(rel);
    }
    // symlink/그 외는 skip — Electron 본체엔 없음
  }
  return out;
}

async function pruneOrphans(src: string, dst: string, prefix = ''): Promise<void> {
  const dstHere = path.join(dst, prefix);
  if (!existsSync(dstHere)) return;
  const entries = await fsp.readdir(dstHere, { withFileTypes: true });
  for (const e of entries) {
    const rel = path.join(prefix, e.name);
    const srcCounterpart = path.join(src, rel);
    if (e.isDirectory()) {
      if (!existsSync(srcCounterpart)) {
        await fsp.rm(path.join(dstHere, e.name), { recursive: true, force: true });
      } else {
        await pruneOrphans(src, dst, rel);
      }
    } else {
      if (!existsSync(srcCounterpart)) {
        // 실행 중 락 가능성 — 무시
        await fsp.unlink(path.join(dstHere, e.name)).catch(() => { /* noop */ });
      }
    }
  }
}
