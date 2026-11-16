/**
 * '이 PC 점검' 화면의 글자 (팀원 카드 · 관리자 표). 계산만 — node --test 가 바로 읽는다 ('@/' 별칭 없음).
 * 줄 · 한 줄 정리 자체는 src/shared/bae/pcCheck.ts 의 buildBaePcCheck 가 만든다 (화면 · 서버 표가 같은 모양).
 */
import type { BaePcCheckRow, BaePcLevel } from '../../../shared/bae/pcCheck';

export const PC_LEVEL_LABEL: Record<BaePcLevel, string> = { ok: '좋음', warn: '주의', bad: '문제' };

export type PcCan = 'yes' | 'slow' | 'no' | 'unknown';
export const PC_CAN_LABEL: Record<PcCan, string> = { yes: '돼요', slow: '느려요', no: '안 돼요', unknown: '모름' };

/** 관리자 표 한 줄: 4K · 레이어 · 각도가 되는지 (그래픽카드가 없으면 '느려요'), 그래픽카드 이름. */
export function pcTeamCells(row: BaePcCheckRow): { upscale: PcCan; layers: PcCan; angle: PcCan; gpu: string; gpuOk: boolean | null } {
  const r = row.result;
  if (!r || !r.can) return { upscale: 'unknown', layers: 'unknown', angle: 'unknown', gpu: '', gpuOk: null };
  const fast = !!r.dml?.ok;
  const can = (b: boolean): PcCan => (!b ? 'no' : fast ? 'yes' : 'slow');
  const name = r.gpu?.name ? r.gpu.name.replace(/\(R\)|\(TM\)/g, '').replace(/\s+/g, ' ').trim() : '';
  return { upscale: can(!!r.can.upscale), layers: can(!!r.can.layers), angle: can(!!r.can.angle), gpu: fast ? (name || '그래픽카드') : `CPU만${name ? ` (${name})` : ''}`, gpuOk: fast };
}

/** 표 위 한 줄: 'N명 · PC N대 · 4K 되는 PC N대 · 레이어 N대 · 각도 N대'. */
export function pcTeamSummary(rows: BaePcCheckRow[]): string {
  if (!rows.length) return '아직 올라온 점검이 없어요';
  const people = new Set(rows.map((r) => r.userId)).size;
  const count = (k: 'upscale' | 'layers' | 'angle') => rows.filter((r) => { const c = pcTeamCells(r)[k]; return c === 'yes' || c === 'slow'; }).length;
  return `${people}명 · PC ${rows.length}대 · 4K 되는 PC ${count('upscale')}대 · 레이어 ${count('layers')}대 · 각도 ${count('angle')}대`;
}

/** 받은 내 줄을 표에 끼운다 (같은 사람 · 같은 PC 는 바꾸고, 최근 것부터 — 서버 pc_check_list 와 같은 순서). */
export function mergePcCheckRow(rows: BaePcCheckRow[], row: BaePcCheckRow): BaePcCheckRow[] {
  return [row, ...rows.filter((r) => !(r.userId === row.userId && r.pcId === row.pcId))]
    .sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : a.checkedAt > b.checkedAt ? -1 : 0));
}

/** 올리기 상태 한 줄 (서버 표). 실패는 조용히 — 점검 결과는 화면에 그대로 있다. */
export function pcUploadText(upload: 'idle' | 'sending' | 'ok' | 'failed', error: string | null): string {
  if (upload === 'sending') return '관리자 표에 올리는 중…';
  if (upload === 'ok') return '관리자 표에 올렸어요.';
  if (upload === 'failed') return `관리자 표에는 올리지 못했어요. 점검 결과는 여기서 그대로 볼 수 있어요.${error ? ` (${error.slice(0, 160)})` : ''}`;
  return '';
}
