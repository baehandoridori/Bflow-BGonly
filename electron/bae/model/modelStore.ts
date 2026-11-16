/**
 * BAE경 모델 보관함 (메인 전용, 계획 14 9-2). 모델 파일을 이 PC 의 %LOCALAPPDATA%\Bflow-BGonly\models\ 에 모으고,
 * 확인값(SHA-256, src/shared/bae/models.ts)이 맞을 때만 쓴다.
 *   1) 이 PC 에 있고 확인한 적이 있으면(크기 · 고친 시각이 확인 기록과 같으면) 그대로 쓴다. 기록이 없으면 다시 잰다.
 *   2) 없거나 틀리면 G 공유 드라이브 모델 창고에서 복사하면서 잰다 (창고는 읽기만 한다).
 *   3) 창고에 없거나 틀리면 Hugging Face 의 고정된 판에서 받으면서 잰다 (주소가 있는 파일만).
 * 틀린 파일은 쓰지 않고 보관함의 .rejected\ 로 옮겨 둔다 (조용히 쓰지 않는다 · 지우지도 않는다 — 파일마다 마지막 한 벌).
 * 받는 중에는 같은 폴더의 점으로 시작하는 임시 파일에 쓰고, 다 맞으면 이름을 바꾼다 (반쯤 받은 파일이 모델 자리에 남지 않는다).
 * electron 을 import 하지 않는다 (창고 자리 · 보관함 뿌리는 부르는 쪽이 넣는다 → 시험은 PC 폴더와 127.0.0.1 로).
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  BAE_MODELS, isSafeModelPath,
  type BaeModelFile, type BaeModelId, type BaeModelProgress, type BaeModelSpec, type BaeModelState,
} from '../../../src/shared/bae/models';
import { writeFileAtomic } from '../atomicFile';

export interface BaeModelStoreOptions {
  /** 보관함 뿌리 (%LOCALAPPDATA%\Bflow-BGonly\models). */
  root: string;
  /** 모델 창고 폴더 (배포 폴더 옆 models). 찾지 못하면 null. */
  warehouse: () => string | null | Promise<string | null>;
  /** 시험: 작은 가짜 모델 목록 */
  models?: Record<string, BaeModelSpec>;
  fetch?: typeof fetch;
  /** 시험: Hugging Face 주소를 127.0.0.1 로 바꿔 끼운다 */
  urlFor?: (file: BaeModelFile) => string | null;
  /** 바이트가 이만큼 오지 않으면 받기를 멈춘다 (기본 60초) */
  stallMs?: number;
  log?: (line: string) => void;
}

export interface BaeModelReady {
  id: BaeModelId;
  dir: string;
  /** 보관함 안의 자리 → 이 PC 의 전체 경로 */
  files: Record<string, string>;
  /** 이번에 파일마다 어디서 왔나 */
  sources: Record<string, 'local' | 'warehouse' | 'internet'>;
}

type Stamp = { size: number; mtimeMs: number; sha256: string };
type Source = 'local' | 'warehouse' | 'internet';

export class BaeModelError extends Error {
  constructor(message: string, readonly code: 'MODEL_UNKNOWN' | 'MODEL_UNAVAILABLE' | 'MODEL_BAD_FILE' | 'MODEL_NETWORK' | 'MODEL_DISK') { super(message); }   // name 은 'Error' 그대로: 통로를 건너면 'Error: 글' 이 되어 cleanIpcErrorMessage 가 벗긴다
}

const CHUNK_REPORT_BYTES = 1 << 20;

export function createBaeModelStore(opts: BaeModelStoreOptions) {
  const models = (opts.models ?? BAE_MODELS) as Record<string, BaeModelSpec>;
  for (const spec of Object.values(models)) for (const f of spec.files) {
    if (!isSafeModelPath(f.path) || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size <= 0) throw new Error(`모델 목록이 올바르지 않아요: ${spec.id} ${f.path}`);
  }
  const root = path.resolve(opts.root);
  const stampFile = path.join(root, '.verified.json');
  const rejectedDir = path.join(root, '.rejected');
  const doFetch = opts.fetch ?? fetch;
  const stallMs = opts.stallMs ?? 60_000;
  const log = (line: string) => { try { opts.log?.(line); } catch { /* 기록 실패는 무시 */ } };

  let stamps: Record<string, Stamp> | null = null;
  let stampWrite: Promise<void> = Promise.resolve();
  const inflight = new Map<string, { promise: Promise<BaeModelReady>; listeners: Set<(p: BaeModelProgress) => void> }>();

  function spec(id: string): BaeModelSpec {
    if (!Object.prototype.hasOwnProperty.call(models, id)) throw new BaeModelError('알 수 없는 모델이에요.', 'MODEL_UNKNOWN');
    return models[id];
  }
  const local = (rel: string) => path.join(root, ...rel.split('/'));
  const flat = (rel: string) => rel.replace(/\//g, '__');

  async function loadStamps(): Promise<Record<string, Stamp>> {
    if (stamps) return stamps;
    try {
      const v = JSON.parse(await readFile(stampFile, 'utf8')) as Record<string, Stamp>;
      stamps = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { stamps = {}; }
    return stamps;
  }
  function saveStamp(rel: string, s: Stamp | null): Promise<void> {
    stampWrite = stampWrite.then(async () => {
      const all = await loadStamps();
      if (s) all[rel] = s; else delete all[rel];
      try { await writeFileAtomic(stampFile, JSON.stringify(all, null, 1)); } catch (e) { log(`확인 기록을 쓰지 못함: ${String(e)}`); }
    });
    return stampWrite;
  }

  /** 틀린 파일을 옆으로 (보관함의 .rejected\, 파일마다 마지막 한 벌). 창고의 파일은 건드리지 않는다. */
  async function moveAside(file: string, rel: string, from: Source): Promise<string | null> {
    const to = path.join(rejectedDir, `${flat(rel)}.${from}`);
    try { await mkdir(rejectedDir, { recursive: true }); await rename(file, to); log(`틀린 파일을 옮김: ${rel} (${from}) → ${to}`); return to; }
    catch (e) { log(`틀린 파일을 옮기지 못함: ${rel} ${String(e)}`); await rm(file, { force: true }).catch(() => undefined); return null; }
  }

  async function hashFile(file: string, onBytes?: (n: number) => void): Promise<string> {
    const h = createHash('sha256');
    for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 })) { h.update(chunk as Buffer); onBytes?.((chunk as Buffer).length); }
    return h.digest('hex');
  }

  /** 이 PC 의 파일이 맞나. 확인 기록이 같으면 다시 재지 않는다. */
  async function localOk(f: BaeModelFile, rehash: boolean, onBytes?: (n: number) => void): Promise<'ok' | 'missing' | 'bad'> {
    const file = local(f.path);
    let st; try { st = await stat(file); } catch { return 'missing'; }
    if (!st.isFile() || st.size !== f.size) return 'bad';
    const s = (await loadStamps())[f.path];
    if (!rehash && s && s.size === st.size && s.mtimeMs === st.mtimeMs && s.sha256 === f.sha256) return 'ok';
    const sha = await hashFile(file, onBytes);
    if (sha !== f.sha256) return 'bad';
    await saveStamp(f.path, { size: st.size, mtimeMs: st.mtimeMs, sha256: sha });
    return 'ok';
  }

  /** 바이트 흐름을 임시 파일에 쓰면서 잰다. 맞으면 제자리로, 틀리면 옆으로. */
  async function writeVerified(f: BaeModelFile, from: Source, chunks: AsyncIterable<Uint8Array>, onBytes: (n: number) => void): Promise<'ok' | 'bad'> {
    const dest = local(f.path);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.${randomUUID().slice(0, 8)}.part`);
    const h = createHash('sha256'); let n = 0;
    try {
      const fh = await open(tmp, 'w');
      try {
        for await (const chunk of chunks) {
          n += chunk.length;
          if (n > f.size) throw new BaeModelError(`${f.path} 이(가) 정해진 크기보다 커요.`, 'MODEL_BAD_FILE');
          h.update(chunk); await fh.write(chunk); onBytes(chunk.length);
        }
        await fh.sync();
      } finally { await fh.close(); }
    } catch (e) {
      // 크기를 넘은 것은 틀린 파일이고, 그 밖(끊김 · 디스크)은 반쯤 받은 것이라 내가 만든 임시 파일만 치운다.
      if (e instanceof BaeModelError && e.code === 'MODEL_BAD_FILE') { await moveAside(tmp, f.path, from); return 'bad'; }
      await rm(tmp, { force: true }).catch(() => undefined);
      if ((e as NodeJS.ErrnoException).code === 'ENOSPC') throw new BaeModelError('디스크 공간이 모자라 모델을 받지 못했어요. 공간을 비우고 다시 해 주세요.', 'MODEL_DISK');
      throw e;
    }
    const sha = h.digest('hex');
    if (n !== f.size || sha !== f.sha256) {
      log(`확인값이 다름: ${f.path} (${from}) 크기 ${n}/${f.size} sha ${sha.slice(0, 12)}…`);
      await moveAside(tmp, f.path, from);
      return 'bad';
    }
    try { await rename(tmp, dest); }
    catch {
      // 같은 자리에 틀린 파일이 남아 있으면(윈도우가 잠깐 쥔 경우 포함) 옆으로 옮기고 한 번 더.
      await moveAside(dest, f.path, 'local');
      try { await rename(tmp, dest); } catch (e2) { await rm(tmp, { force: true }).catch(() => undefined); throw e2; }
    }
    const st = await stat(dest);
    await saveStamp(f.path, { size: st.size, mtimeMs: st.mtimeMs, sha256: sha });
    return 'ok';
  }

  async function* readChunks(file: string): AsyncIterable<Uint8Array> {
    for await (const chunk of createReadStream(file, { highWaterMark: 1 << 20 })) yield chunk as Buffer;
  }

  async function* fetchChunks(url: string): AsyncIterable<Uint8Array> {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => ac.abort(), stallMs); };
    arm();
    try {
      let res: Response;
      try { res = await doFetch(url, { signal: ac.signal, redirect: 'follow' }); }
      catch (e) { throw new BaeModelError(`인터넷에서 받지 못했어요 (${ac.signal.aborted ? '응답이 없어요' : String((e as Error).message || e)}).`, 'MODEL_NETWORK'); }
      if (!res.ok || !res.body) throw new BaeModelError(`인터넷에서 받지 못했어요 (응답 ${res.status}).`, 'MODEL_NETWORK');
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) { arm(); yield chunk; }
      } catch (e) {
        if (e instanceof BaeModelError) throw e;
        throw new BaeModelError(`받는 중에 끊겼어요 (${ac.signal.aborted ? '오래 응답이 없어요' : String((e as Error).message || e)}).`, 'MODEL_NETWORK');
      }
    } finally { if (timer) clearTimeout(timer); }
  }

  async function warehouseDir(): Promise<string | null> {
    try { const w = await opts.warehouse(); return w && typeof w === 'string' ? w : null; } catch { return null; }
  }

  async function ensureNow(id: string, emit: (p: BaeModelProgress) => void): Promise<BaeModelReady> {
    const s = spec(id);
    const total = s.files.reduce((n, f) => n + f.size, 0);
    let done = 0; let lastReport = 0;
    const tick = (phase: BaeModelProgress['phase'], file: string | null, source: BaeModelProgress['source'], force = false) => {
      if (!force && done - lastReport < CHUNK_REPORT_BYTES) return;
      lastReport = done; emit({ id: s.id, phase, file, source, doneBytes: Math.min(done, total), totalBytes: total });
    };
    const result: BaeModelReady = { id: s.id, dir: path.dirname(local(s.files[0].path)), files: {}, sources: {} };
    for (const f of s.files) {
      const startDone = done;
      tick('check', f.path, 'local', true);
      // 1) 이 PC
      const have = await localOk(f, false);
      if (have === 'ok') { done = startDone + f.size; result.files[f.path] = local(f.path); result.sources[f.path] = 'local'; tick('check', f.path, 'local', true); continue; }
      if (have === 'bad') await moveAside(local(f.path), f.path, 'local');
      // 2) 창고
      const wh = await warehouseDir();
      let got: 'ok' | 'bad' | 'none' = 'none';
      if (wh) {
        const src = path.join(wh, ...f.path.split('/'));
        let st = null; try { st = await stat(src); } catch { /* 창고에 없음 */ }
        if (st && st.isFile() && st.size === f.size) {
          log(`창고에서 복사: ${f.path} ← ${src}`);
          try {
            got = await writeVerified(f, 'warehouse', readChunks(src), (n) => { done += n; tick('copy', f.path, 'warehouse'); });
          } catch (e) {
            if (e instanceof BaeModelError && e.code === 'MODEL_DISK') throw e;
            log(`창고에서 읽지 못함: ${f.path} ${String(e)}`); got = 'none';
          }
          if (got === 'bad') log(`창고의 파일이 틀려서 쓰지 않음: ${f.path}`);
        } else if (st) { log(`창고의 파일 크기가 다름: ${f.path} ${st.size}/${f.size}`); got = 'bad'; }
      }
      if (got === 'ok') { done = startDone + f.size; result.files[f.path] = local(f.path); result.sources[f.path] = 'warehouse'; tick('copy', f.path, 'warehouse', true); continue; }
      // 3) Hugging Face
      done = startDone;
      const url = opts.urlFor ? opts.urlFor(f) : f.url;
      if (!url) {
        const why = !wh ? 'G 드라이브 모델 창고를 찾지 못했어요' : got === 'bad' ? '모델 창고의 파일이 맞지 않아요' : '모델 창고에 파일이 없어요';
        throw new BaeModelError(`${s.label}을(를) 받을 수 없어요: ${why}. 이 모델은 창고에서만 받아요 — 관리자에게 알려 주세요.`, 'MODEL_UNAVAILABLE');
      }
      log(`인터넷에서 받기: ${f.path} ← ${url}`);
      const r = await writeVerified(f, 'internet', fetchChunks(url), (n) => { done += n; tick('download', f.path, 'internet'); });
      if (r === 'bad') throw new BaeModelError(`인터넷에서 받은 ${s.label}의 확인값이 달라서 쓰지 않았어요. 잠시 뒤에 다시 해 주세요.`, 'MODEL_BAD_FILE');
      done = startDone + f.size; result.files[f.path] = local(f.path); result.sources[f.path] = 'internet'; tick('download', f.path, 'internet', true);
    }
    emit({ id: s.id, phase: 'done', file: null, source: null, doneBytes: total, totalBytes: total });
    return result;
  }

  /** 받아 두었나 (빠름: 크기와 확인 기록만 본다, 다시 재지 않음). */
  async function state(id: BaeModelId): Promise<BaeModelState> {
    const s = spec(id); const recs = await loadStamps();
    let ready = true, have = 0;
    for (const f of s.files) {
      let st = null; try { st = await stat(local(f.path)); } catch { /* 없음 */ }
      if (st && st.isFile()) have += Math.min(st.size, f.size);
      const r = recs[f.path];
      if (!st || st.size !== f.size || !r || r.size !== st.size || r.mtimeMs !== st.mtimeMs || r.sha256 !== f.sha256) ready = false;
    }
    return { id: s.id, ready, haveBytes: have, totalBytes: s.files.reduce((n, f) => n + f.size, 0), internet: s.files.every((f) => !!(opts.urlFor ? opts.urlFor(f) : f.url)) };
  }

  return {
    root,
    /** 모델 파일 하나의 이 PC 경로 (있는지는 보지 않는다). */
    filePath(id: BaeModelId, rel: string): string {
      const s = spec(id);
      if (!s.files.some((f) => f.path === rel)) throw new BaeModelError('모델 파일 이름이 올바르지 않아요.', 'MODEL_UNKNOWN');
      return local(rel);
    },
    state,
    async states(): Promise<BaeModelState[]> {
      const out: BaeModelState[] = [];
      for (const id of Object.keys(models)) out.push(await state(id as BaeModelId));
      return out;
    },
    /** 이 PC 의 파일을 처음부터 다시 잰다 (점검 · 시험). 틀린 것은 옆으로. */
    async verify(id: BaeModelId): Promise<boolean> {
      const s = spec(id); let ok = true;
      for (const f of s.files) {
        const r = await localOk(f, true);
        if (r === 'bad') { await moveAside(local(f.path), f.path, 'local'); await saveStamp(f.path, null); }
        if (r !== 'ok') ok = false;
      }
      return ok;
    },
    /**
     * 모델을 쓸 수 있게: 모든 파일이 이 PC 에 있고 확인값이 맞으면 그 경로들. 같은 모델을 동시에 부르면 한 번만 받는다.
     * 실패하면 BaeModelError (화면에 그대로 보여 줄 수 있는 글).
     */
    ensure(id: BaeModelId, onProgress?: (p: BaeModelProgress) => void): Promise<BaeModelReady> {
      try { spec(id); } catch (e) { return Promise.reject(e); }
      let job = inflight.get(id);
      if (!job) {
        const listeners = new Set<(p: BaeModelProgress) => void>();
        const emit = (p: BaeModelProgress) => { for (const l of listeners) { try { l(p); } catch { /* 듣는 쪽 오류는 무시 */ } } };
        const promise = ensureNow(id, emit)
          .catch((e) => {
            const err = e instanceof BaeModelError ? e : new BaeModelError(`모델을 준비하지 못했어요: ${String((e as Error)?.message || e)}`, 'MODEL_UNAVAILABLE');
            emit({ id, phase: 'failed', file: null, source: null, doneBytes: 0, totalBytes: 0, message: err.message });
            log(`모델 준비 실패: ${id} ${err.message}`);
            throw err;
          })
          .finally(() => { inflight.delete(id); });
        job = { promise, listeners };
        inflight.set(id, job);
      }
      if (onProgress) job.listeners.add(onProgress);
      return job.promise;
    },
  };
}
export type BaeModelStore = ReturnType<typeof createBaeModelStore>;
