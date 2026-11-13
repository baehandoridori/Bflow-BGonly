/**
 * BAE경 설정 책장(서버 `bae_gyeong_settings`)의 열쇠와 값 모양 — 화면 · 메인 · 테스트가 함께 쓴다.
 * 이 파일은 node --test 가 바로 읽으므로 '@/' 별칭을 쓰지 않는다.
 *
 * - 열쇠는 닫힌 목록이다. SQL(`DEVLOG/migrations/2026-11-13-bae-gyeong-base.sql`)의 CHECK 목록과 같아야 한다(테스트가 견준다).
 * - 매뉴얼 · 고정 문장 · 덧붙일 지침의 본문은 메인과 관리자 화면에만 간다(`BAE_BODY_KEYS`). 팀원 화면에는 판 번호만.
 * - 그림 모델과 품질은 팀원이 고르지 않는다(14e 2장). 값은 이 책장의 `models` 하나에 있고, 화면은 이름표 글자만 받는다.
 */

export const BAE_SETTING_KEYS = ['manual', 'fixed', 'guidance', 'times', 'horizon', 'models', 'prices', 'api_base', 'library', 'access'] as const;
export type BaeSettingKey = (typeof BAE_SETTING_KEYS)[number];

/** 본문이 팀원 화면에 가지 않는 열쇠. */
export const BAE_BODY_KEYS: readonly BaeSettingKey[] = ['manual', 'fixed', 'guidance'];

export interface BaeTextSetting { text: string }
export interface BaeModelsSetting { pdModel: string; imageModel: string; imageQuality: string; imageLabel: string }
export interface BaePricesSetting { pd: Record<string, [number, number]>; image: { text: number; image: number; out: number }; krwPerUsd: number }
export interface BaeTimesSetting { user: Array<{ id: string; label: string; pd: string }> }
export interface BaeHorizonSetting { calib: number }
export interface BaeAccessSetting { open: boolean }
export interface BaeLibrarySetting { off: string[]; user: unknown[]; style: string | null }

export interface BaeSettingValues {
  manual: BaeTextSetting; fixed: BaeTextSetting; guidance: BaeTextSetting; times: BaeTimesSetting; horizon: BaeHorizonSetting;
  models: BaeModelsSetting; prices: BaePricesSetting; api_base: string; library: BaeLibrarySetting; access: BaeAccessSetting;
}

/** 서버에 줄이 없을 때 쓰는 값 (HTML v0.4.11 의 처음 값). 매뉴얼 · 고정 문장의 기본 본문은 메인에만 있다(`electron/bae/defaultTexts.ts`). */
export const BAE_SETTING_DEFAULTS: Omit<BaeSettingValues, 'manual' | 'fixed'> = {
  guidance: { text: '' },
  times: { user: [] },
  horizon: { calib: 0 },
  models: { pdModel: 'gpt-6.1-sol', imageModel: 'gpt-image-2.5-sunburst', imageQuality: 'high', imageLabel: '2.5 Sunburst (정교함)' },
  prices: { pd: { 'gpt-6.1-sol': [2, 10], 'gpt-6-astra': [10, 50], 'gpt-6-luna': [0.1, 0.5] }, image: { text: 5, image: 8, out: 30 }, krwPerUsd: 1400 },
  api_base: 'https://api.openai.com/v1',
  library: { off: [], user: [], style: null },
  access: { open: false },
};

/** 서버가 돌려주는 한 줄 (본문이 빠진 줄은 value 가 null 이고 bodyHidden 이 참). */
export interface BaeSettingRow {
  key: BaeSettingKey;
  value: unknown;
  revision: number;
  version: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  bodyHidden?: boolean;
}

export function isBaeSettingKey(value: unknown): value is BaeSettingKey {
  return typeof value === 'string' && (BAE_SETTING_KEYS as readonly string[]).includes(value);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const shortText = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;

/** 저장하려는 값의 문제(없으면 null). 서버도 같은 범위를 본다. */
export function baeSettingProblem(key: BaeSettingKey, value: unknown): string | null {
  switch (key) {
    case 'manual': case 'fixed': case 'guidance':
      if (!isObj(value) || typeof value.text !== 'string') return '글이 올바르지 않아요.';
      if (value.text.length > 200_000) return '글이 너무 길어요 (20만 자까지).';
      if (key !== 'guidance' && !value.text.trim()) return '빈 글은 저장할 수 없어요.';
      return null;
    case 'times':
      if (!isObj(value) || !Array.isArray(value.user) || value.user.length > 40) return '시간대 목록이 올바르지 않아요.';
      return value.user.every((t) => isObj(t) && shortText(t.id, 40) && shortText(t.label, 40) && shortText(t.pd, 400)) ? null : '시간대 항목이 올바르지 않아요.';
    case 'horizon':
      return isObj(value) && finite(value.calib, -50, 50) ? null : '지평선 보정은 -50~50 사이 숫자예요.';
    case 'models':
      if (!isObj(value)) return '모델 설정이 올바르지 않아요.';
      return ['pdModel', 'imageModel', 'imageQuality', 'imageLabel'].every((k) => typeof value[k] === 'string' && (value[k] as string).trim() && (value[k] as string).length <= 120)
        ? null : '모델 이름이 올바르지 않아요.';
    case 'prices': {
      if (!isObj(value) || !isObj(value.pd) || !isObj(value.image)) return '가격표가 올바르지 않아요.';
      const pdOk = Object.values(value.pd).every((p) => Array.isArray(p) && p.length === 2 && finite(p[0], 0, 1000) && finite(p[1], 0, 1000));
      const im = value.image as Record<string, unknown>;
      return pdOk && finite(im.text, 0, 1000) && finite(im.image, 0, 1000) && finite(im.out, 0, 1000) && finite(value.krwPerUsd, 1, 100000) ? null : '가격표의 숫자가 올바르지 않아요.';
    }
    case 'api_base':
      return typeof value === 'string' && /^https:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/.test(value) && value.length <= 300 ? null : 'API 주소는 https:// 로 시작하는 주소예요.';
    case 'library':
      return isObj(value) && Array.isArray(value.off) && Array.isArray(value.user) && (value.style === null || typeof value.style === 'string') ? null : '스타일 라이브러리 값이 올바르지 않아요.';
    case 'access':
      return isObj(value) && typeof value.open === 'boolean' ? null : '열기 스위치 값이 올바르지 않아요.';
    default:
      return '알 수 없는 설정이에요.';
  }
}

/** 매뉴얼 · 고정 문장 글의 첫 줄에 적힌 판 (`# BAE PD manual v1.7` → 'v1.7'). */
export function textVersion(text: string): string | null {
  const m = /v\d+(?:\.\d+)*/.exec(String(text || '').split('\n')[0] ?? '');
  return m ? m[0] : null;
}
