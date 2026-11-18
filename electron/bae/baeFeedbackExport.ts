/**
 * BAE경 '피드백 내보내기' 통로 (HTML v0.4.11 exportFeedback): 검수한 그림을 설명과 함께 zip 하나로.
 * - 화면은 고른 방식과 기록 id 만 보낸다. 글은 메인이 서버에서 내 세션으로 다시 읽고(남의 기록 · 숨긴 기록은 뺀다),
 *   그림은 이 PC 작업 폴더에서 읽는다. 이 PC 에 없으면 서버의 작은 미리보기(이 기록의 정해 둔 자리만)를 받고, 그것도 없으면 feedback.md 에 적는다.
 * - 저장 자리는 사용자가 저장 창에서 고른다 (처음 이름 'BAE경_피드백_YYYYMMDD_HHMM.zip'). 임시 파일에 쓴 뒤 이름을 바꾼다.
 * - 돈이 드는 호출은 없다. electron 을 import 하지 않는다 (저장 창은 baeMain 이 넣어 준다 — node 시험이 그대로 읽는다).
 */
import { randomBytes } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import {
  baeFeedbackCandidates, baeFeedbackDoneText, baeFeedbackHead, baeFeedbackItem, baeFeedbackJson, baeFeedbackKey, baeFeedbackMarkdown,
  baeFeedbackRequestProblem, baeFeedbackWants, baeFeedbackZipName, baeFeedbackZipPath,
  type BaeFeedbackGot, type BaeFeedbackItem, type BaeFeedbackMiss, type BaeFeedbackRequest, type BaeFeedbackResult,
} from '../../src/shared/bae/feedbackExport';
import { createStoredZip } from '../../src/shared/bae/storedZip';
import { BAE_PREVIEW_NAMES, baePreviewPath, type BaeJob } from '../../src/shared/bae/jobs';
import { maskSecrets } from '../../src/shared/bae/secrets';
import type { BaeLocalStore } from './localStore';

export const BAE_FEEDBACK_CHANNEL = 'bae:feedback-export';

/** zip 을 쓸 곳: 조각을 차례로 쓰고, 끝나면 commit, 실패하면 abort (반쯤 쓴 파일을 남기지 않는다). */
export interface BaeZipSink { write(chunk: Uint8Array): Promise<void>; commit(): Promise<void>; abort(): Promise<void> }

export interface BaeFeedbackExportDeps {
  ipc: { handle(channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>): void };
  getSessionOriginOrThrow(): { userId: string; epoch: number };
  canUse(actorId: string): Promise<boolean>;
  /** 기록 한 건 (PD 글 포함) — 내 세션으로 (baeStore.jobGet) */
  jobGet(actorId: string, jobId: string): Promise<BaeJob>;
  /** 지금 설정의 판 번호 (본문은 넣지 않는다) */
  versions(actorId: string): Promise<{ manual: string | null; fixed: string | null; guidance: string | null }>;
  local: Pick<BaeLocalStore, 'readJobFile' | 'readJobMeta'>;
  /** 저장소 경로 → 공개 주소 (미리보기 주소가 이 기록의 정해 둔 자리인지 맞춰 본다) */
  publicUrl(path: string): string;
  /** 저장 창: 고른 자리, 그만두면 null. event 는 부른 창을 찾는 데 쓴다. */
  pickZipPath(event: unknown, defaultName: string): Promise<string | null>;
  appVersion: string;
  fetch?: typeof fetch;
  openZip?: (target: string) => Promise<BaeZipSink>;
  now?: () => Date;
}

const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 20_000;
const READ_AT_ONCE = 4;

/** 고른 자리 옆 임시 파일에 쓰고, 다 쓰면 그 자리로 이름을 바꾼다. */
export async function openZipFile(target: string): Promise<BaeZipSink> {
  const tmp = `${target}.${randomBytes(4).toString('hex')}.part`;
  const fh = await open(tmp, 'wx');
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await fh.close(); } };
  return {
    async write(chunk) {
      let at = 0;
      while (at < chunk.byteLength) { const { bytesWritten } = await fh.write(chunk, at, chunk.byteLength - at); if (bytesWritten <= 0) throw new Error('파일에 쓰지 못했어요.'); at += bytesWritten; }
    },
    async commit() { await close(); await rename(tmp, target); },
    async abort() { try { await close(); } catch { /* 이미 닫힘 */ } await rm(tmp, { force: true }).catch(() => {}); },
  };
}

/** 서버 미리보기 주소가 이 기록의 정해 둔 자리(bae/{작업 id}/{정해 둔 이름})인지. 아니면 받지 않는다. */
export function baeFeedbackPreviewOk(url: string, jobId: string, publicUrl: (path: string) => string): boolean {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false;
  const bare = url.split(/[?#]/)[0];
  return BAE_PREVIEW_NAMES.some((n) => { try { return publicUrl(baePreviewPath(jobId, n)) === bare; } catch { return false; } });
}

async function download(f: typeof fetch, url: string): Promise<Uint8Array | null> {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), PREVIEW_TIMEOUT_MS);
  try {
    const r = await f(url, { signal: ctl.signal });
    if (!r.ok) return null;
    const len = Number(r.headers.get('content-length'));
    if (Number.isFinite(len) && len > MAX_PREVIEW_BYTES) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    return b.byteLength > 0 && b.byteLength <= MAX_PREVIEW_BYTES ? b : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

export function registerBaeFeedbackExportIpc(deps: BaeFeedbackExportDeps): void {
  const fetchFn = deps.fetch ?? fetch;
  const openZip = deps.openZip ?? openZipFile;
  function originFor(requestEpoch: unknown) {
    const origin = { ...deps.getSessionOriginOrThrow() };
    if (!Number.isSafeInteger(requestEpoch) || requestEpoch !== origin.epoch) throw new Error('로그인 세션이 바뀌었어요. 화면을 다시 열어 주세요.');
    return origin;
  }
  function current(origin: { userId: string; epoch: number }) {
    const now = deps.getSessionOriginOrThrow();
    if (origin.userId !== now.userId || origin.epoch !== now.epoch) throw new Error('로그인 세션이 바뀌어 피드백 내보내기를 그만뒀어요.');
  }

  deps.ipc.handle(BAE_FEEDBACK_CHANNEL, async (event, request, epoch): Promise<BaeFeedbackResult> => {
    const origin = originFor(epoch);
    const problem = baeFeedbackRequestProblem(request); if (problem) throw new Error(problem);
    if (!(await deps.canUse(origin.userId))) throw new Error('BAE경을 쓸 권한이 없습니다. 관리자에게 BAE경 사용자로 지정해 달라고 요청해 주세요.');
    const { mode, ids } = request as BaeFeedbackRequest;
    const now = deps.now?.() ?? new Date();
    const blank = { mode, count: 0, images: 0, previews: 0, missing: 0, skipped: 0, bytes: 0 };

    const target = await deps.pickZipPath(event, baeFeedbackZipName(now));
    if (!target) return { ...blank, status: 'canceled', path: null, message: '' };
    current(origin);

    // 기록은 서버에서 내 세션으로 다시 읽는다: 내 것 · 다 그린 것 · 숨기지 않은 것만 (화면이 보낸 글은 쓰지 않는다)
    const read: BaeJob[] = [];
    for (let i = 0; i < ids.length; i += READ_AT_ONCE) {
      const got = await Promise.all(ids.slice(i, i + READ_AT_ONCE).map((id) => deps.jobGet(origin.userId, id).catch(() => null)));
      for (const j of got) if (j && j.userId === origin.userId) read.push(j);
    }
    current(origin);
    const jobs = baeFeedbackCandidates(read);
    const skipped = ids.length - jobs.length;
    if (!jobs.length) return { ...blank, skipped, status: 'empty', path: null, message: '내보낼 그림을 서버에서 찾지 못했어요. 잠시 뒤 다시 해 주세요.' };
    const versions = await deps.versions(origin.userId).catch(() => null);

    const sink = await openZip(target);
    const zip = createStoredZip(now);
    let images = 0; let previews = 0; let missing = 0;
    try {
      const items: BaeFeedbackItem[] = [];
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i]; const key = baeFeedbackKey(i, j.id);
        // 이 PC 의 job.json 에 다른 계정이 적혀 있으면 그 폴더는 읽지 않는다
        const meta = (await deps.local.readJobMeta(j.id).catch(() => null)) as { ownerId?: unknown; requestPrompt?: unknown } | null;
        const localOk = !meta || meta.ownerId === undefined || meta.ownerId === origin.userId;
        const got: BaeFeedbackGot[] = []; const missed: BaeFeedbackMiss[] = [];
        for (const w of baeFeedbackWants(j, key)) {
          let bytes: Uint8Array | null = null; let path = ''; let preview = false;
          if (localOk) {
            for (const name of w.local) {
              const b = await deps.local.readJobFile(j.id, name).catch(() => null);
              if (b && b.byteLength) { bytes = b; path = baeFeedbackZipPath(w, name); break; }
            }
          }
          if (!bytes && w.url && baeFeedbackPreviewOk(w.url, j.id, deps.publicUrl)) {
            bytes = await download(fetchFn, w.url);
            if (bytes) { path = baeFeedbackZipPath(w, null); preview = true; }
          }
          if (!bytes || !zip.fits(path, bytes.byteLength)) { if (w.required || bytes) missed.push({ slot: w.slot, n: w.n, label: w.label }); continue; }
          for (const part of zip.entry(path, bytes)) await sink.write(part);
          got.push({ slot: w.slot, n: w.n, path, preview }); images++; if (preview) previews++;
        }
        missing += missed.length;
        items.push(baeFeedbackItem(j, key, got, missed, localOk && typeof meta?.requestPrompt === 'string' ? meta.requestPrompt : ''));
      }
      const head = baeFeedbackHead({ app: `BAE경 (B flow ${deps.appVersion})`, now, versions, mode, count: items.length, skipped });
      const enc = new TextEncoder();
      for (const part of zip.entry('feedback.json', enc.encode(baeFeedbackJson(head, items)))) await sink.write(part);
      for (const part of zip.entry('feedback.md', enc.encode(baeFeedbackMarkdown(head, items)))) await sink.write(part);
      const end = zip.end(['feedback.json', 'feedback.md']);
      await sink.write(end);
      await sink.commit();
      return { status: 'saved', path: target, mode, count: items.length, images, previews, missing, skipped, bytes: zip.offset + end.byteLength, message: baeFeedbackDoneText(mode, items.length, missing) };
    } catch (e) {
      await sink.abort();
      throw new Error(`묶지 못했어요: ${maskSecrets(e instanceof Error ? e.message : String(e))}`);
    }
  });
}
