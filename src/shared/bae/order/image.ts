// 그림 요청(/images/edits multipart)의 필드 만들기와 비용 (HTML callImage 1760~1800줄). fetch 와 스트림 읽기는 메인이 한다.
import { withRatio, effRatio } from './sizes';
import type { RatioId, TierId } from './constants';

export type ImageField =
  | { name: string; value: string }
  | { name: 'image[]' | 'image'; file: number; filename: string; type: 'image/png' };

export interface ImageRequestInput {
  /** 설정 책장 models.imageModel */
  model: string;
  prompt: string;
  /** drawSizes(...).gen */
  size: [number, number];
  /** 설정 책장 models.imageQuality */
  quality: string;
  stream: boolean;
  /** 그림 수 (finalList 순서 그대로, 모두 PNG). */
  imageCount: number;
}

/** HTML callImage 의 once(field, stream): 필드 이름 · 순서 · 값. 그림은 file = finalList 의 몇 번째인지. */
export function imageFields(q: ImageRequestInput, field: 'image[]' | 'image'): ImageField[] {
  const f: ImageField[] = [
    { name: 'model', value: q.model }, { name: 'prompt', value: q.prompt }, { name: 'size', value: q.size[0] + 'x' + q.size[1] },
    { name: 'quality', value: q.quality }, { name: 'n', value: '1' }, { name: 'output_format', value: 'png' },
  ];
  if (q.stream) f.push({ name: 'stream', value: 'true' }, { name: 'partial_images', value: '2' });
  for (let i = 0; i < q.imageCount; i++) f.push({ name: field, file: i, filename: 'image' + (i + 1) + '.png', type: 'image/png' });
  return f;
}

/**
 * multipart 로 나갈 때의 글 값: FormData 는 글 값의 줄바꿈을 모두 CRLF 로 바꿔 보낸다(브라우저 · Node 의 FormData 둘 다).
 * HTML 이 실제로 보낸 prompt 는 이 모양이다. 메인이 FormData 를 쓰면 저절로 같고, 손으로 짜면 이것을 써야 한다.
 */
export const multipartTextValue = (v: string) => String(v).replace(/\r?\n|\r/g, '\r\n');

/** 필드 목록 두 벌: 처음엔 'image[]', 모델이 그림 필드를 거절하면 'image' 로. */
export function imageFieldSets(q: ImageRequestInput): { 'image[]': ImageField[]; image: ImageField[] } {
  return { 'image[]': imageFields(q, 'image[]'), image: imageFields(q, 'image') };
}

export interface ImageAttemptState { stream: boolean; field: 'image[]' | 'image'; flipped: boolean }

/** HTML callImage 의 처음 상태: stream = 설정의 스트림 켬 && 이 PC 가 '스트림 안 됨'을 기억하지 않음. field = 기억해 둔 필드(처음은 'image[]'). */
export const firstImageAttempt = (streamOn: boolean, noStream: boolean, field: 'image[]' | 'image' = 'image[]'): ImageAttemptState => ({ stream: !!streamOn && !noStream, field, flipped: false });

/**
 * HTML callImage 의 다시 보내기 규칙 (최대 3번). 400 이 아니면 그대로 실패.
 * 스트림을 거절하면 스트림 없이(기억: noStream), 그림 필드를 거절하면 한 번만 필드를 바꿔서(기억: imageField).
 * 다시 보낼 게 없으면 null.
 */
export function nextImageAttempt(s: ImageAttemptState, err: { status?: number; raw?: string }): { next: ImageAttemptState; remember: { noStream?: true; imageField?: 'image[]' | 'image' } } | null {
  if (err.status !== 400) return null;
  if (s.stream && /stream|partial/i.test(err.raw || '')) return { next: { ...s, stream: false }, remember: { noStream: true } };
  if (!s.flipped && /image/i.test(err.raw || '')) { const field = s.field === 'image[]' ? 'image' : 'image[]'; return { next: { ...s, field, flipped: true }, remember: { imageField: field } }; }
  return null;
}
export const IMAGE_MAX_ATTEMPTS = 3;

/** HTML 그림 버튼: 화면의 영어 주문서를 다듬고 비율 문장을 지금 크기로. 빈 주문서면 ''. */
export function drawPrompt(promptText: string, ratio: RatioId, tier: TierId, tilt: number): string {
  const p = String(promptText || '').trim(); if (!p) return '';
  return withRatio(p, effRatio(ratio, tier, tilt));
}

/** HTML callImage 끝: 그림 비용 (달러). prices = 설정 책장 prices.image (백만 토큰당). */
export function imageCost(usage: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number | null } } | null | undefined, prices: { text: number; image: number; out: number }): number | null {
  const u = usage; if (!u) return null;
  const d = u.input_tokens_details || {}; const tt = d.text_tokens || 0; const it = d.image_tokens != null ? d.image_tokens : Math.max(0, (u.input_tokens || 0) - tt);
  return tt / 1e6 * prices.text + it / 1e6 * prices.image + (u.output_tokens || 0) / 1e6 * prices.out;
}
