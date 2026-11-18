/**
 * 메인이 PD · 그림 모델을 부를 때 쓰는 '지금 설정'. 서버 설정 책장의 줄 + 없으면 처음 값(매뉴얼 v1.7 · 고정 문장 v1 은 메인에만).
 * 'settings' 신호가 오면 버리고 다음 호출 때 다시 읽는다 (고정 간격으로 읽지 않는다). 본문은 메인 밖으로 나가지 않는다.
 */
import { BAE_SETTING_DEFAULTS, textVersion, type BaeModelsSetting, type BaePricesSetting, type BaeSettingRow, type BaeTimesSetting } from '../../src/shared/bae/settings';
import { BAE_DEFAULT_FIXED, BAE_DEFAULT_MANUAL } from './defaultTexts';

export interface BaeEffectiveSettings {
  manualText: string; fixedText: string; guidanceText: string;
  versions: { manual: string | null; fixed: string | null; guidance: string | null };
  revisions: Record<string, number>;
  models: BaeModelsSetting; prices: BaePricesSetting; apiBase: string; calib: number; times: BaeTimesSetting;
  libraryOff: string[];
}

const textOf = (row: BaeSettingRow | undefined): string | null => {
  const v = row?.value as { text?: unknown } | null | undefined;
  return v && typeof v.text === 'string' ? v.text : null;
};

export function effectiveBaeSettings(rows: BaeSettingRow[]): BaeEffectiveSettings {
  const by = new Map(rows.map((r) => [r.key, r] as const));
  const val = <T>(key: string, fallback: T): T => (by.get(key as BaeSettingRow['key'])?.value as T | undefined) ?? fallback;
  const manualText = textOf(by.get('manual')) ?? BAE_DEFAULT_MANUAL;
  const fixedText = textOf(by.get('fixed')) ?? BAE_DEFAULT_FIXED;
  const guidanceText = textOf(by.get('guidance')) ?? '';
  const horizon = val('horizon', BAE_SETTING_DEFAULTS.horizon);
  const library = val('library', BAE_SETTING_DEFAULTS.library);
  return {
    manualText, fixedText, guidanceText,
    versions: { manual: textVersion(manualText), fixed: textVersion(fixedText), guidance: guidanceText ? String(by.get('guidance')?.revision ?? '') : null },
    revisions: Object.fromEntries(rows.map((r) => [r.key, r.revision])),
    models: { ...BAE_SETTING_DEFAULTS.models, ...val('models', BAE_SETTING_DEFAULTS.models) },
    prices: { ...BAE_SETTING_DEFAULTS.prices, ...val('prices', BAE_SETTING_DEFAULTS.prices) },
    apiBase: val('api_base', BAE_SETTING_DEFAULTS.api_base),
    calib: Number(horizon?.calib) || 0,
    times: val('times', BAE_SETTING_DEFAULTS.times),
    libraryOff: Array.isArray(library?.off) ? library.off.filter((x): x is string => typeof x === 'string') : [],
  };
}

export function createBaeSettingsCache(read: (actorId: string) => Promise<BaeSettingRow[]>) {
  let cached: { actorId: string; at: number; value: BaeEffectiveSettings } | null = null;
  let pending: { actorId: string; promise: Promise<BaeEffectiveSettings> } | null = null;
  let generation = 0;
  return {
    async get(actorId: string): Promise<BaeEffectiveSettings> {
      if (cached && cached.actorId === actorId) return cached.value;
      if (pending && pending.actorId === actorId) return pending.promise;
      const my = generation;
      const promise = read(actorId).then((rows) => {
        const value = effectiveBaeSettings(rows);
        if (my === generation) cached = { actorId, at: Date.now(), value };
        return value;
      }).finally(() => { if (pending?.promise === promise) pending = null; });
      pending = { actorId, promise };
      return promise;
    },
    forget() { generation++; cached = null; pending = null; },
  };
}
export type BaeSettingsCache = ReturnType<typeof createBaeSettingsCache>;
