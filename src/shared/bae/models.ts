/**
 * BAE경 모델 파일 목록 (계획 14 9장). 메인의 모델 보관함(electron/bae/model/modelStore.ts)이 이 목록대로
 * 이 PC(%LOCALAPPDATA%\Bflow-BGonly\models\)에 모으고, 확인값(SHA-256)이 맞을 때만 쓴다.
 *   받는 순서: 이 PC → G 공유 드라이브 모델 창고(배포 폴더 옆 models\) → Hugging Face 의 고정된 판(url 이 있는 것만).
 *   경로(path)는 보관함 · 창고 안의 자리. 창고에도 같은 자리에 둔다 (예: 창고\sam\vision_encoder_fp16.onnx).
 * 확인값 · 크기는 2026-11-16 이 PC 사본에서 잰 값이고, Hugging Face 에 있는 것은 그 판의 파일 정보(lfs sha256)와 같음을 확인했다.
 * url 이 null 인 파일은 HTML 안에 들어 있던 우리 변환본이라(SAM 디코더 그래프 · 4K 모델) Hugging Face 에 같은 파일이 없다 → 창고 전용.
 * electron 도 브라우저도 import 하지 않는다 (메인 · 화면 · 시험이 같이 쓴다).
 */

export type BaeModelId = 'sam' | 'birefnet' | 'depth' | 'up-a' | 'up-b';
/** 계산하는 곳: 모델 일꾼 프로세스(onnxruntime-node + DirectML) 또는 화면(onnxruntime-web WebGPU). */
export type BaeModelEngine = 'worker' | 'renderer';

export interface BaeModelFile {
  /** 보관함 · 창고 안의 자리 ('/' 로 나눔). */
  path: string;
  size: number;
  sha256: string;
  /** Hugging Face 의 고정된 판 (커밋 번호가 든 주소). 없으면 창고에서만 받는다. */
  url: string | null;
}

export interface BaeModelSpec {
  id: BaeModelId;
  /** 화면에 보이는 이름 */
  label: string;
  /** 무엇에 쓰나 (화면 · 이 PC 점검) */
  use: string;
  engine: BaeModelEngine;
  files: BaeModelFile[];
  /** 출처와 판, 사용권 (안내용) */
  source: string;
}

const SAM_BASE = 'https://huggingface.co/onnx-community/sam2.1-hiera-base-plus-ONNX/resolve/bab18593f44e652f04cf18b60b3690f60e8996b0/onnx/';

export const BAE_MODELS: Record<BaeModelId, BaeModelSpec> = {
  sam: {
    id: 'sam', label: '레이어 윤곽 모델 (SAM 2.1)', use: '레이어로 나누기', engine: 'worker',
    source: 'onnx-community/sam2.1-hiera-base-plus-ONNX @bab18593 (Apache-2.0, Meta). 디코더 그래프는 HTML v0.4.4 의 모든 마스크 판',
    files: [
      { path: 'sam/vision_encoder_fp16.onnx', size: 643078, sha256: 'cb9324a431bfb78c70e4ead1ffb80766e236b50decd55c236c8eada4f0afde96', url: SAM_BASE + 'vision_encoder_fp16.onnx' },
      { path: 'sam/vision_encoder_fp16.onnx_data', size: 152780640, sha256: '78be422d399181ce3af00130409ebe32eb5b95825e7fe290440fbfaac70b99b4', url: SAM_BASE + 'vision_encoder_fp16.onnx_data' },
      { path: 'sam/prompt_encoder_mask_decoder_fp16.onnx_data', size: 10454016, sha256: '5f49783081ae45a100b62931ae02f362fd15702abf6a51e993353bc3a92618c0', url: SAM_BASE + 'prompt_encoder_mask_decoder_fp16.onnx_data' },
      // HTML 안에 든 디코더 그래프 (lym_dec, 같은 폴더의 prompt_encoder_mask_decoder_fp16.onnx_data 를 가리킨다)
      { path: 'sam/sam2_decoder_all.onnx', size: 230008, sha256: '13d3fa7a94350b80ed74d0df4a02f23390c8a249b1a7827544ec86b794ed0316', url: null },
    ],
  },
  birefnet: {
    id: 'birefnet', label: '가장자리 모델 (BiRefNet)', use: '레이어 가장자리 다듬기', engine: 'worker',
    source: 'onnx-community/BiRefNet-ONNX @534d3c82 model_fp16 (MIT)',
    files: [
      { path: 'birefnet/birefnet_full_fp16.onnx', size: 489666272, sha256: '3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09', url: 'https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67/onnx/model_fp16.onnx' },
    ],
  },
  depth: {
    id: 'depth', label: '깊이 모델 (Depth Anything V2 Small)', use: '다른 각도로', engine: 'worker',
    source: 'onnx-community/depth-anything-v2-small @4472b736 (Apache-2.0). HTML ANGD 와 같은 주소 · 확인값',
    files: [
      { path: 'depth/depth-anything-v2-small_model.onnx', size: 99060839, sha256: 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c', url: 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model.onnx' },
    ],
  },
  'up-a': {
    id: 'up-a', label: '4K 선명하게 (Real-ESRGAN animevideov3)', use: '4K로 키우기 (선명하게)', engine: 'worker',
    source: 'HTML v0.3.5 upm_av3 (그래프 그대로, 16비트 무게를 32비트로 푼 w.bin). Real-ESRGAN BSD-3-Clause (c) 2021 Xintao Wang',
    files: [
      { path: 'up-a/model.onnx', size: 9855, sha256: '1ebd169734814150bb0123aee0bd8b5168918a880eadbb4acb100ea97edff0dc', url: null },
      { path: 'up-a/w.bin', size: 2485696, sha256: 'eadc72cb74f0ca6e524206974258eed30e6fb6651ff7c85e218f89588fed5d38', url: null },
    ],
  },
  'up-b': {
    id: 'up-b', label: '4K 원본 그대로 (waifu2x swin_unet art)', use: '4K로 키우기 (원본 그대로)', engine: 'renderer',
    source: 'HTML v0.3.5 upm_swin (그래프 그대로, 16비트 무게를 32비트로 푼 w.bin). waifu2x nunif MIT (c) 2019-2023 nagadomi',
    files: [
      { path: 'up-b/model.onnx', size: 1306242, sha256: 'ff4054add1ca653b315f4f65bac087a2723b03373fe9b4e1e82b04ae06cc8844', url: null },
      { path: 'up-b/w.bin', size: 15427968, sha256: '61f0e785f005ccdba9956e171434cab49e390a5bbc6a42f5843ff8c34ae7ac1e', url: null },
    ],
  },
};

export const BAE_MODEL_IDS = Object.keys(BAE_MODELS) as BaeModelId[];

export function isBaeModelId(v: unknown): v is BaeModelId {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(BAE_MODELS, v);
}

export function baeModelBytes(spec: Pick<BaeModelSpec, 'files'>): number {
  return spec.files.reduce((n, f) => n + f.size, 0);
}

/** 보관함 자리로 쓸 수 있는 경로인가: 영문 · 숫자 · - _ . 만, '/' 로 나눈 두 칸 이하, '..' 없음. */
export function isSafeModelPath(p: unknown): p is string {
  if (typeof p !== 'string' || p.length > 120) return false;
  const parts = p.split('/');
  return parts.length >= 1 && parts.length <= 2 && parts.every((s) => /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}$/.test(s) && s !== '..' && !s.endsWith('.'));
}

/** 이 PC 에 모델이 있는지 (메인 → 화면 · 이 PC 점검). */
export interface BaeModelState {
  id: BaeModelId;
  /** 모든 파일이 이 PC 에 있고 확인값이 맞음 */
  ready: boolean;
  /** 이 PC 에 있는 파일 바이트 (확인 전 크기 기준) */
  haveBytes: number;
  totalBytes: number;
  /** 창고에 없을 때 Hugging Face 에서 받을 수 있나 (모든 파일에 주소가 있나) */
  internet: boolean;
}

/** 받는 중 알림 (메인 → 화면). 같은 id 의 알림이 순서대로 온다. */
export interface BaeModelProgress {
  id: BaeModelId;
  phase: 'check' | 'copy' | 'download' | 'verify' | 'done' | 'failed';
  file: string | null;
  source: 'local' | 'warehouse' | 'internet' | null;
  doneBytes: number;
  totalBytes: number;
  message?: string;
}
