/**
 * OpenAI 키를 화면 · 기록 · 파일에 남기지 않기 위한 도구 (계획 14의 4-2).
 * 키는 메인의 메모리에만 있고, 오류 글에 섞여 나오면 여기서 가린다. node --test 가 바로 읽는다.
 */

const KEY_RE = /sk-[A-Za-z0-9_-]{8,}/g;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi;

/** 글 안의 키 모양(`sk-…`)과 Authorization 값을 가린다. */
export function maskSecrets(text: unknown): string {
  return String(text ?? '').replace(KEY_RE, 'sk-…(가림)').replace(BEARER_RE, '$1…(가림)');
}

/** 관리자가 붙여 넣은 값이 OpenAI 키 모양인지 (앞뒤 빈칸은 잘라서 본다). */
export function baeKeyProblem(value: unknown): string | null {
  if (typeof value !== 'string') return '키가 비어 있어요.';
  const v = value.trim();
  if (!v) return '키가 비어 있어요.';
  if (v.length > 400 || /\s/.test(v)) return '키 모양이 아니에요. 한 줄로 붙여 넣어 주세요.';
  if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(v)) return "OpenAI 키는 'sk-'로 시작해요.";
  return null;
}

/** 화면에 보여도 되는 키 상태. 키 글자는 한 글자도 들어 있지 않다. */
export interface BaeKeyStatus { hasKey: boolean; updatedAt: string | null; label: string }

export function parseBaeKeyStatus(data: unknown): BaeKeyStatus {
  const v = data as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || typeof v.hasKey !== 'boolean' || typeof v.label !== 'string' || (v.updatedAt !== null && typeof v.updatedAt !== 'string')) {
    throw new Error('키 상태 응답이 올바르지 않아요.');
  }
  return { hasKey: v.hasKey, updatedAt: v.updatedAt as string | null, label: v.label };
}
