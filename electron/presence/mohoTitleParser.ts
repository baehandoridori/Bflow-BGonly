// electron/presence/mohoTitleParser.ts
import path from 'path';

const MOHO_EXT = /\.(moho|mohoproj|anime)$/i;
const APP_SUFFIX = /\s*[-–—]\s*Moho(\s+(Pro|Debut|Anime\s*Studio))?\s*$/i;

/**
 * 창 제목 한 줄 → 정규화 basename(소문자, 확장자 포함). 실패 시 null.
 * 앱 접미사(` -Moho`)와 미저장 표시(`*`)를 떼고, 제목에 경로가 들어 있어도
 * basename만 취해 sceneLinkIndex(동일하게 path.win32.basename 사용)와 계약을 맞춘다.
 *
 * 미저장 표시 별표는 Moho 버전/OS에 따라 제목 앞("* b030.moho")에도, 뒤("b030.moho*")에도
 * 붙는다. 편집 중(미저장)일 때가 정작 감지가 가장 필요한 순간이므로, 앞/뒤 어느 쪽의
 * 별표든 반드시 떼어내야 한다. Windows 파일명에는 '*'가 올 수 없어 앞뒤 별표/공백 제거는 안전.
 */
export function normalizeMohoTitle(rawLine: string): string | null {
  let s = (rawLine ?? '').trim();
  if (!s) return null;
  // 앞쪽 미저장 별표를 먼저 떼어 접미사 탐지/basename 계산에 영향 주지 않게 한다.
  s = s.replace(/^[\s*]+/, '');
  const m = APP_SUFFIX.exec(s);
  if (m) s = s.slice(0, m.index);
  // 접미사 제거 후 남은 앞/뒤 별표·공백까지 정리("b030.moho*", "* b030.moho" 모두 대응).
  s = s.replace(/^[\s*]+/, '').replace(/[\s*]+$/, '');
  if (!s) return null;
  s = path.win32.basename(s);
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
