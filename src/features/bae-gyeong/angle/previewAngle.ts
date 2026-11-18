/**
 * 테스트 모드(?preview=1)의 '다른 각도로' 흉내: 진짜 OpenAI 도 모델 일꾼도 없이 같은 모양으로 답한다 (Bflow 규칙: 테스트 모드 동등성).
 *   - 깊이: 그림 아래쪽으로 갈수록 가까운(바닥) 흉내 disparity 에 그림 밝기를 조금 섞는다 (방처럼 보이는 입체 판이 나온다).
 *   - 그리기: 메인과 같은 함수로 주문서를 만들고(PD메모는 흉내 PD 가 메모 목록을 영어 한 줄로), 밑그림을 그림 크기로 키운 것을 결과로 준다. 0원.
 */
import { anglePromptText, type AngleMemo } from '@/shared/bae/angle/order';
import type { BaeAngleDrawCall, BaeAngleDrawOutcome } from '@/shared/bae/angle/calls';
import type { BaeFailure } from '@/shared/bae/makeCalls';
import type { BaeAngleGateway } from './gateway';
import type { AngleDepthFn } from './depth';
import { makeCanvas } from '../make/inputs';

/** 흉내 깊이 (259 × 259). */
export const previewAngleDepth: AngleDepthFn = async (img) => {
  const N = 259, c = makeCanvas(N, N), x = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D; x.drawImage(img, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data, disp = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let i = 0; i < N; i++) { const k = (y * N + i) * 4, lum = (d[k] * 0.299 + d[k + 1] * 0.587 + d[k + 2] * 0.114) / 255; disp[y * N + i] = 0.6 + 6 * Math.pow(y / (N - 1), 2.2) + 0.25 * lum; }
  await new Promise((r) => setTimeout(r, 300));
  return { disp, dw: N, dh: N, ep: 'preview', ms: 300 };
};

export function createPreviewAngleGateway(o: { delayMs?: number; onProgress?: (p: { jobId: string; phase: 'draw'; memo?: string; partial?: { index: number | null; dataUrl: string } }) => void } = {}): BaeAngleGateway {
  const running = new Map<string, AbortController>();
  const wait = (ms: number, sig: AbortSignal) => new Promise<void>((res, rej) => { const t = setTimeout(res, ms); sig.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('그만뒀어요.', 'AbortError')); }, { once: true }); });
  return {
    async draw(q: BaeAngleDrawCall): Promise<BaeAngleDrawOutcome | BaeFailure> {
      const ctl = new AbortController(); running.set(q.jobId, ctl); const t0 = Date.now();
      try {
        let memo: AngleMemo | null = null; let record = null as BaeAngleDrawOutcome['memo'];
        if (q.memo) {
          o.onProgress?.({ jobId: q.jobId, phase: 'draw', memo: 'reading' }); await wait(o.delayMs ?? 600, ctl.signal);
          const en = 'Follow these notes in image 1: ' + q.memo.raw.join('; ') + '.';
          memo = { pd: en }; record = { n: q.memo.n, pd: en, ko: '(테스트 모드) 메모를 그대로 옮겼어요.', raw: false, err: '', cost: 0 };
        }
        const prompt = anglePromptText(q.order.kind, q.order.sentence, { n: q.order.n, notes: q.order.notes, memo, crop: q.order.crop, under: q.order.under });
        const blob = new Blob([q.images[0].slice()], { type: 'image/png' }); const bm = await createImageBitmap(blob);
        const c = makeCanvas(q.size[0], q.size[1]), x = c.getContext('2d') as CanvasRenderingContext2D; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, c.width, c.height); bm.close?.();
        o.onProgress?.({ jobId: q.jobId, phase: 'draw', partial: { index: 0, dataUrl: c.toDataURL('image/jpeg', 0.6) } });
        await wait(o.delayMs ?? 1200, ctl.signal);
        const png = new Uint8Array(await (await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('그림을 만들지 못했어요'))), 'image/png'))).arrayBuffer());
        return { ok: true, jobId: q.jobId, png, w: c.width, h: c.height, sec: Math.round((Date.now() - t0) / 1000), costUsd: 0, imageUsd: 0, memoUsd: q.memo ? 0 : null, model: 'preview', prompt, memo: record, label: q.label };
      } catch (e) {
        const aborted = !!e && (e as { name?: string }).name === 'AbortError';
        return { ok: false, aborted, message: aborted ? '그만뒀어요. 이미 보낸 요청은 비용이 들 수 있어요.' : String((e as Error)?.message || e), code: null };
      } finally { running.delete(q.jobId); }
    },
    async abort(jobId: string) { const c = running.get(jobId); if (!c) return false; c.abort(); return true; },
  };
}
