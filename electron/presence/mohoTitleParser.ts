// electron/presence/mohoTitleParser.ts
const MOHO_EXT = /\.(moho|mohoproj|anime)$/i;
const APP_SUFFIX = /\s*[-–—]\s*Moho(\s+(Pro|Debut|Anime\s*Studio))?\s*$/i;

/** 창 제목 한 줄 → 정규화 basename(소문자, 확장자 포함). 실패 시 null. */
export function normalizeMohoTitle(rawLine: string): string | null {
  let s = (rawLine ?? '').trim();
  if (!s) return null;
  const m = APP_SUFFIX.exec(s);
  if (m) s = s.slice(0, m.index);
  s = s.trim().replace(/\*+$/, '').trim();
  if (!s || !MOHO_EXT.test(s)) return null;
  return s.toLowerCase();
}

/** 여러 창 제목 줄 → 정규화 basename 배열(중복 제거, 입력 순서 유지). */
export function parseMohoTitles(rawLines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of rawLines ?? []) {
    const name = normalizeMohoTitle(line);
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  }
  return out;
}
