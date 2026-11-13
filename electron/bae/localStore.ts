/**
 * BAE경 이 PC 보관함. 뿌리(root)는 주입받는다 (실제로는 %LOCALAPPDATA%\Bflow-BGonly\bae\).
 *   jobs\{연-월}\{작업 id}\   원본 PNG · GPT 가 준 그대로 · 보낸 재료 그림 · job.json
 *   draft\                    초안 하나 (a · b 두 칸을 번갈아 쓰고 current.json 이 지금 칸을 가리킨다)
 *   cache\{그림 해시}\         뒤 단계용 GPT 답 자리 (지금은 읽기 · 쓰기만)
 *   outbox\                   못 보낸 것 줄 (outbox.ts)
 * - 경로에 사용자가 쓴 글자를 넣지 않는다: 작업 id 는 uuid, 파일 이름은 정해 둔 목록, 해시는 16진수만. 어긋나면 거절.
 * - 쓰기는 임시 파일 → 이름 바꾸기 (반쯤 쓴 파일이 남지 않는다).
 * - 지우는 함수는 없다 (내 PC 원본 지우기는 나중 단계에서 따로).
 * electron 을 import 하지 않는다.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isTempName, writeFileAtomic } from './atomicFile';

export const BAE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BAE_HASH_RE = /^[0-9a-f]{16,128}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const range = (stem: string, n: number) => Array.from({ length: n }, (_, i) => `${stem}_${i + 1}`);
const withExt = (stems: string[]) => stems.flatMap((s) => [`${s}.png`, `${s}.jpg`]);

/**
 * 작업 폴더에 둘 수 있는 그림 이름.
 * result=원본(마무리한 그림) · gpt=GPT 가 준 그대로 · alt=색 맞춤 전/후 다른 판 · input_N=그림 모델에 보낸 재료 순서대로 ·
 * rough · rough_level(수평 맞춘 러프) · rough_notes(빨간 메모) · ref_N · base_N · sheet · style(기본 스타일 띠) · pick_N(고른 팀 배경) · review(검수 표시)
 */
export const BAE_JOB_FILE_NAMES: readonly string[] = Object.freeze(withExt([
  'result', 'gpt', 'alt', 'rough', 'rough_level', 'rough_notes', 'sheet', 'style', 'review',
  ...range('input', 16), ...range('ref', 4), ...range('base', 3), ...range('pick', 4),
]));
/** 초안에 둘 수 있는 그림 이름 (그림판 층 · 재료). */
export const BAE_DRAFT_FILE_NAMES: readonly string[] = Object.freeze(withExt([
  'board_bg', 'board_paint', 'board_notes', 'board_preview', 'rough', 'rough_notes', 'sheet', 'style',
  ...range('ref', 4), ...range('base', 3),
]));
/** 캐시 칸에 둘 수 있는 이름. */
export const BAE_CACHE_FILE_NAMES: readonly string[] = Object.freeze(['answer.json', 'meta.json', 'image.png']);

const JOB_META = 'job.json';
const DRAFT_POINTER = 'current.json';
const DRAFT_DATA = 'draft.json';
const MAX_FILE_BYTES = 256 * 1024 * 1024;

export class BaeLocalPathError extends Error {
  constructor(message: string) { super(message); this.name = 'BaeLocalPathError'; }
}

function checkJobId(jobId: unknown): string {
  if (typeof jobId !== 'string' || !BAE_UUID_RE.test(jobId)) throw new BaeLocalPathError('작업 번호가 올바르지 않아요.');
  return jobId.toLowerCase();
}
function checkName(name: unknown, allowed: readonly string[]): string {
  if (typeof name !== 'string' || !allowed.includes(name)) throw new BaeLocalPathError('보관할 수 없는 파일 이름이에요.');
  return name;
}
function checkHash(hash: unknown): string {
  if (typeof hash !== 'string' || !BAE_HASH_RE.test(hash)) throw new BaeLocalPathError('그림 해시가 올바르지 않아요.');
  return hash;
}
function checkBytes(bytes: unknown): Uint8Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE_BYTES) throw new BaeLocalPathError('보관할 내용이 올바르지 않아요.');
  return bytes;
}
/** 만든 때 → 'YYYY-MM' (UTC 기준: PC 시간대와 상관없이 같은 폴더). */
export function baeMonthOf(createdAtISO: unknown): string {
  const t = typeof createdAtISO === 'string' && createdAtISO.length <= 40 ? Date.parse(createdAtISO) : NaN;
  if (!Number.isFinite(t)) throw new BaeLocalPathError('작업을 만든 때가 올바르지 않아요.');
  const month = new Date(t).toISOString().slice(0, 7);
  if (!MONTH_RE.test(month) || month < '2000-01' || month > '2199-12') throw new BaeLocalPathError('작업을 만든 때가 올바르지 않아요.');
  return month;
}

async function readOrNull(file: string): Promise<Buffer | null> {
  try { return await readFile(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function listDir(dir: string): Promise<Array<{ name: string; isDir: boolean; isFile: boolean }>> {
  try { return (await readdir(dir, { withFileTypes: true })).map((d) => ({ name: d.name, isDir: d.isDirectory(), isFile: d.isFile() })); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
async function readJson(file: string): Promise<unknown> {
  const buf = await readOrNull(file);
  if (!buf) return null;
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

export interface BaeLocalJob { jobId: string; month: string; createdAt: string | null; files: string[]; bytes: number }
export interface BaeDraft { data: unknown; images: Record<string, Uint8Array>; savedAt: string; missing: string[] }

export function createBaeLocalStore(opts: { root: string; now?: () => number }) {
  if (typeof opts.root !== 'string' || !isAbsolute(opts.root)) throw new BaeLocalPathError('보관함 위치가 올바르지 않아요.');
  const root = resolve(opts.root);
  const now = opts.now ?? Date.now;
  const jobsDir = join(root, 'jobs');
  const draftDir = join(root, 'draft');
  const cacheDir = join(root, 'cache');
  const outboxDir = join(root, 'outbox');
  /** 작업 id → 연-월 (한 번 찾은 것). */
  const known = new Map<string, string>();
  let draftChain: Promise<unknown> = Promise.resolve();

  /** 마지막 지킴: 만든 경로가 뿌리 밖이면 거절. */
  function inside(p: string): string {
    const r = relative(root, resolve(p));
    if (!r || r.startsWith('..') || isAbsolute(r) || r.split(sep).includes('..')) throw new BaeLocalPathError('보관함 밖의 경로예요.');
    return p;
  }
  /** 작업 폴더: 이미 있으면 그 자리, 없으면 만든 때로 정해지는 자리 (만든 때도 없으면 null). 폴더를 만들지는 않는다. */
  async function jobDir(jobId: string, createdAtISO?: string): Promise<string | null> {
    const found = await locate(jobId);
    if (found) return found;
    return createdAtISO === undefined ? null : inside(join(jobsDir, baeMonthOf(createdAtISO), checkJobId(jobId)));
  }
  async function locate(jobId: string): Promise<string | null> {
    const id = checkJobId(jobId);
    const hit = known.get(id);
    if (hit) return inside(join(jobsDir, hit, id));
    for (const m of await listDir(jobsDir)) {
      if (!m.isDir || !MONTH_RE.test(m.name)) continue;
      if ((await listDir(join(jobsDir, m.name))).some((d) => d.isDir && d.name.toLowerCase() === id)) {
        known.set(id, m.name);
        return inside(join(jobsDir, m.name, id));
      }
    }
    return null;
  }
  /** 이미 있는 작업은 그 자리, 없으면 만든 때의 연-월에 새로 (job.json 도 함께). */
  async function ensureJob(jobId: string, createdAtISO: string): Promise<string> {
    const id = checkJobId(jobId); const month = baeMonthOf(createdAtISO);
    const found = await locate(id);
    if (found) return found;
    const dir = inside(join(jobsDir, month, id));
    await mkdir(dir, { recursive: true });
    // 처음 job.json 은 없을 때만 ('wx'): 같은 때 writeJobMeta 가 먼저 쓴 meta 를 덮지 않는다.
    const stub = JSON.stringify({ v: 1, jobId: id, createdAt: new Date(Date.parse(createdAtISO)).toISOString(), savedAt: new Date(now()).toISOString(), meta: null });
    try { await writeFile(join(dir, JOB_META), stub, { flag: 'wx' }); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    known.set(id, month);
    return dir;
  }

  return {
    root, jobsDir, draftDir, cacheDir, outboxDir,
    jobDir,
    /** 작업 폴더에 그림 하나. 이름은 BAE_JOB_FILE_NAMES 중 하나. */
    async saveJobFile(jobId: string, createdAtISO: string, name: string, bytes: Uint8Array): Promise<{ path: string; bytes: number }> {
      const n = checkName(name, BAE_JOB_FILE_NAMES); const b = checkBytes(bytes);
      const dir = await ensureJob(jobId, createdAtISO);
      const file = inside(join(dir, n));
      await writeFileAtomic(file, b);
      return { path: file, bytes: b.byteLength };
    },
    async readJobFile(jobId: string, name: string): Promise<Uint8Array | null> {
      const n = checkName(name, BAE_JOB_FILE_NAMES);
      const dir = await locate(jobId);
      return dir ? readOrNull(inside(join(dir, n))) : null;
    },
    /** job.json 의 meta 를 바꾼다 (만든 때는 처음 것을 둔다). */
    async writeJobMeta(jobId: string, createdAtISO: string, meta: unknown): Promise<void> {
      const dir = await ensureJob(jobId, createdAtISO);
      const file = inside(join(dir, JOB_META));
      const prev = (await readJson(file)) as { createdAt?: unknown } | null;
      const createdAt = prev && typeof prev.createdAt === 'string' ? prev.createdAt : new Date(Date.parse(createdAtISO)).toISOString();
      await writeFileAtomic(file, JSON.stringify({ v: 1, jobId: checkJobId(jobId), createdAt, savedAt: new Date(now()).toISOString(), meta: meta ?? null }));
    },
    async readJobMeta(jobId: string): Promise<unknown | null> {
      const dir = await locate(jobId);
      if (!dir) return null;
      const v = (await readJson(inside(join(dir, JOB_META)))) as { meta?: unknown } | null;
      return v && typeof v === 'object' ? v.meta ?? null : null;
    },
    /** 연-월 폴더를 훑어 작업 목록 (최근 것 먼저). */
    async listLocalJobs(): Promise<BaeLocalJob[]> {
      const out: BaeLocalJob[] = [];
      for (const m of await listDir(jobsDir)) {
        if (!m.isDir || !MONTH_RE.test(m.name)) continue;
        for (const j of await listDir(join(jobsDir, m.name))) {
          if (!j.isDir || !BAE_UUID_RE.test(j.name)) continue;
          const dir = join(jobsDir, m.name, j.name); const id = j.name.toLowerCase();
          known.set(id, m.name);
          const files: string[] = []; let bytes = 0;
          for (const f of await listDir(dir)) {
            if (!f.isFile || isTempName(f.name)) continue;
            bytes += (await stat(join(dir, f.name))).size;
            if (BAE_JOB_FILE_NAMES.includes(f.name)) files.push(f.name);
          }
          const meta = (await readJson(join(dir, JOB_META))) as { createdAt?: unknown } | null;
          out.push({ jobId: id, month: m.name, createdAt: meta && typeof meta.createdAt === 'string' ? meta.createdAt : null, files: files.sort(), bytes });
        }
      }
      return out.sort((a, b) => (b.createdAt ?? b.month).localeCompare(a.createdAt ?? a.month));
    },
    /** 작업 폴더들(원본)이 차지한 바이트. */
    async usageBytes(): Promise<number> {
      let total = 0;
      for (const m of await listDir(jobsDir)) {
        if (!m.isDir || !MONTH_RE.test(m.name)) continue;
        for (const j of await listDir(join(jobsDir, m.name))) {
          if (!j.isDir) continue;
          for (const f of await listDir(join(jobsDir, m.name, j.name))) if (f.isFile) total += (await stat(join(jobsDir, m.name, j.name, f.name))).size;
        }
      }
      return total;
    },
    /**
     * 초안 하나 저장: 지금 칸이 아닌 칸에 그림들 → draft.json 을 쓰고, 마지막에 current.json 을 바꾼다.
     * 쓰다 꺼져도 앞 초안이 그대로 남는다. 그림 이름은 BAE_DRAFT_FILE_NAMES 중 하나.
     */
    saveDraft(draft: { data: unknown; images?: Record<string, Uint8Array> }): Promise<void> {
      let images: Array<readonly [string, Uint8Array]>; let dataText: string | undefined;
      try {
        images = Object.entries(draft?.images ?? {}).map(([name, bytes]) => [checkName(name, BAE_DRAFT_FILE_NAMES), checkBytes(bytes)] as const);
        try { dataText = JSON.stringify(draft?.data ?? null); } catch { dataText = undefined; }
        if (dataText === undefined) throw new BaeLocalPathError('초안을 저장할 수 없어요.');
      } catch (error) { return Promise.reject(error); }
      const run = draftChain.then(async () => {
        const pointer = (await readJson(join(draftDir, DRAFT_POINTER))) as { slot?: unknown } | null;
        const slot = pointer && pointer.slot === 'a' ? 'b' : 'a';
        const dir = inside(join(draftDir, slot));
        for (const [name, bytes] of images) await writeFileAtomic(join(dir, name), bytes);
        const savedAt = new Date(now()).toISOString();
        await writeFileAtomic(join(dir, DRAFT_DATA), `{"v":1,"savedAt":${JSON.stringify(savedAt)},"images":${JSON.stringify(images.map(([n]) => n))},"data":${dataText}}`);
        await writeFileAtomic(join(draftDir, DRAFT_POINTER), JSON.stringify({ v: 1, slot, savedAt }));
      });
      draftChain = run.catch(() => undefined);
      return run;
    },
    /** 저장한 초안 (없으면 null). 없어진 그림이 있으면 missing 에. */
    async loadDraft(): Promise<BaeDraft | null> {
      await draftChain;
      const pointer = (await readJson(join(draftDir, DRAFT_POINTER))) as { slot?: unknown } | null;
      if (!pointer || (pointer.slot !== 'a' && pointer.slot !== 'b')) return null;
      const dir = inside(join(draftDir, pointer.slot));
      const v = (await readJson(join(dir, DRAFT_DATA))) as { v?: unknown; savedAt?: unknown; images?: unknown; data?: unknown } | null;
      if (!v || v.v !== 1) return null;
      const images: Record<string, Uint8Array> = {}; const missing: string[] = [];
      for (const name of Array.isArray(v.images) ? v.images : []) {
        if (typeof name !== 'string' || !BAE_DRAFT_FILE_NAMES.includes(name)) continue;
        const buf = await readOrNull(join(dir, name));
        if (buf) images[name] = buf; else missing.push(name);
      }
      return { data: v.data ?? null, images, savedAt: typeof v.savedAt === 'string' ? v.savedAt : '', missing };
    },
    /** 초안 비우기: 가리키는 칸을 없앤다 (파일은 지우지 않는다 — 다음 저장이 덮어쓴다). */
    clearDraft(): Promise<void> {
      const run = draftChain.then(() => writeFileAtomic(join(draftDir, DRAFT_POINTER), JSON.stringify({ v: 1, slot: null, savedAt: new Date(now()).toISOString() })));
      draftChain = run.catch(() => undefined);
      return run;
    },
    async cacheGet(hash: string, name: string): Promise<Uint8Array | null> {
      return readOrNull(inside(join(cacheDir, checkHash(hash), checkName(name, BAE_CACHE_FILE_NAMES))));
    },
    async cachePut(hash: string, name: string, bytes: Uint8Array): Promise<void> {
      await writeFileAtomic(inside(join(cacheDir, checkHash(hash), checkName(name, BAE_CACHE_FILE_NAMES))), checkBytes(bytes));
    },
  };
}
export type BaeLocalStore = ReturnType<typeof createBaeLocalStore>;
