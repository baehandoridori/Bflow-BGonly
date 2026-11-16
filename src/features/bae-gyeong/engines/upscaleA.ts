/**
 * BAE경 4K로 키우기 — A '선명하게' (Real-ESRGAN animevideov3, 모델 일꾼 프로세스의 DirectML, 안 되면 CPU).
 * 화면은 그림 읽기와 마무리(목표 크기로 · PNG)만 한다 — HTML 과 같은 캔버스 다시 뽑기를 쓰려고. 2배 계산은 메인을 거쳐 모델 일꾼이.
 *
 *   const out = await baeUpscaleA(blob, (d, n) => …, { target: baeUpscaleTarget(rec.ratio, rec.w, rec.h) });
 *   → { blob (PNG), w, h, ep: 'dml' | 'cpu', ms, tiles, fellBack }
 */
import { cleanIpcErrorMessage } from '@/utils/ipcErrorMessage';
import { baeModelGateway, type BaeModelGateway } from '../modelApi';
import { baeCanvasPng, baeReadPixels, baeTicket, baeToCanvas, type BaeUpscaleOptions, type BaeUpscaleOutcome } from './upscaleCommon';

export async function baeUpscaleA(src: Blob, onProgress?: (done: number, total: number) => void, opts: BaeUpscaleOptions & { gateway?: BaeModelGateway } = {}): Promise<BaeUpscaleOutcome> {
  const t0 = performance.now();
  const gateway = opts.gateway ?? baeModelGateway();
  const img = await baeReadPixels(src);
  const ticket = baeTicket();
  const off = gateway.onUpscaleProgress((p) => { if (p.ticket === ticket) onProgress?.(p.done, p.total); });
  let r;
  try { r = await gateway.upscaleA(img.data, img.width, img.height, ticket); }
  catch (e) { throw new Error(cleanIpcErrorMessage(e, '4K로 키우지 못했어요.')); }
  finally { off(); }
  const rgba = r.rgba instanceof Uint8ClampedArray ? r.rgba : new Uint8ClampedArray(r.rgba.buffer, r.rgba.byteOffset, r.rgba.byteLength);
  const [tw, th] = opts.target ?? [r.w, r.h];
  const out = baeToCanvas({ w: r.w, h: r.h, rgba }, tw, th);
  const blob = await baeCanvasPng(out);
  return { blob, w: out.width, h: out.height, ep: r.ep, ms: Math.round(performance.now() - t0), tiles: r.tiles, fellBack: r.fellBack };
}
