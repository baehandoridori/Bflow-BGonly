/**
 * Google Sheets 프록시 — Apps Script 웹 앱을 통한 연동
 *
 * 서비스 계정 키 없이 Apps Script 웹 앱 URL만으로 시트 데이터를 읽고 쓴다.
 * Google Apps Script가 스프레드시트에 바인딩되어 있으므로 spreadsheetId 불필요.
 *
 * 시트 구조:
 *   A: No | B: 씬번호 | C: 메모 | D: 스토리보드URL | E: 가이드URL
 *   F: 담당자 | G: LO | H: 완료 | I: 검수 | J: PNG | K: 레이아웃
 *
 * 시트 탭 이름:
 *   기존(BG): EP01_A, EP01_B, EP02_A, ... (department 없으면 'bg' 기본)
 *   신규:     EP01_A_BG, EP01_A_ACT, ... (_BG | _ACT 접미사로 부서 구분)
 */

let webAppUrl: string | null = null;

// ─── Google Apps Script fetch 헬퍼 ──────────────────────────
// GAS 웹 앱은 302 리다이렉트로 응답을 전달한다.
// POST 요청: script.google.com에서 doPost 실행 → 302 → 응답 URL (GET으로 조회)
// GET 요청: script.google.com에서 doGet 실행 → 302 → 응답 URL (GET으로 조회)

async function gasFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let targetUrl = url;
  let currentOptions = { ...options };

  for (let i = 0; i < 5; i++) {
    const res = await fetch(targetUrl, {
      ...currentOptions,
      redirect: 'manual',
    });

    // 리다이렉트 → 다음 URL로 이동
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error('리다이렉트 location 헤더 없음');
      targetUrl = location;

      // 301/302/303: POST→GET 변환 (RFC 7231, GAS 응답 리다이렉트는 GET으로 조회)
      // 307/308: 메서드 유지
      if ([301, 302, 303].includes(res.status) && currentOptions.method === 'POST') {
        const { method: _, body: __, ...rest } = currentOptions;
        currentOptions = { ...rest, method: 'GET' };
      }

      continue;
    }

    return res;
  }

  throw new Error('리다이렉트 횟수 초과');
}

// ─── 연결 ─────────────────────────────────────────────────────

export async function initSheets(url: string): Promise<boolean> {
  try {
    const res = await gasFetch(`${url}?action=ping`);
    if (!res.ok) {
      console.error('[Sheets] 핑 실패:', res.status);
      return false;
    }

    const json = await res.json();
    if (!json.ok) {
      console.error('[Sheets] 핑 응답 오류:', json.error);
      return false;
    }

    webAppUrl = url;
    console.log('[Sheets] 연결 성공');
    return true;
  } catch (err) {
    console.error('[Sheets] 연결 실패:', err);
    webAppUrl = null;
    return false;
  }
}

export function isConnected(): boolean {
  return webAppUrl !== null;
}

// ─── 데이터 타입 ──────────────────────────────────────────────

export type Department = 'bg' | 'acting';

export interface EpisodeData {
  episodeNumber: number;
  title: string;
  parts: {
    partId: string;
    department: Department;
    sheetName: string;
    scenes: {
      no: number;
      sceneId: string;
      memo: string;
      storyboardUrl: string;
      guideUrl: string;
      assignee: string;
      layoutId: string;
      lo: boolean;
      done: boolean;
      review: boolean;
      png: boolean;
    }[];
  }[];
}

// ─── 이미지 URL 검증 & Google Drive 프록시 변환 ──────────────
// 1. CellImage 쓰레기 값 필터링
// 2. Google Drive uc?export=view URL → drive-img:// 프록시로 변환 (403 방지)

function sanitizeImageUrl(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (!trimmed) return '';

  // Google Drive URL → drive-img:// 프로토콜로 변환 (렌더러에서 403 차단 우회)
  const driveMatch = trimmed.match(
    /drive\.google\.com\/uc\?export=view&id=([a-zA-Z0-9_-]+)/
  );
  if (driveMatch) {
    return `drive-img://file/${driveMatch[1]}`;
  }

  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('bflow-img://') ||
    trimmed.startsWith('drive-img://')
  ) {
    return trimmed;
  }
  return '';
}

// ─── 시트 이름에서 department 추출 ───────────────────────────────
// EP01_A_BG → 'bg', EP01_A_ACT → 'acting', EP01_A (레거시) → 'bg'

function parseDepartmentFromSheetName(sheetName: string): Department {
  if (sheetName.endsWith('_ACT')) return 'acting';
  return 'bg'; // _BG 접미사 또는 접미사 없음(레거시) 모두 'bg'
}

// ─── 전체 에피소드 데이터 읽기 ────────────────────────────────

export async function readAllEpisodes(): Promise<EpisodeData[]> {
  if (!webAppUrl) throw new Error('Sheets 미연결');

  const res = await gasFetch(`${webAppUrl}?action=readAll`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? '시트 읽기 실패');

  const episodes: EpisodeData[] = json.data ?? [];

  // 후처리: department 기본값 + 이미지 URL 검증
  for (const ep of episodes) {
    for (const part of ep.parts) {
      // GAS에서 department를 내려주지 않는 레거시 대응 → 'bg' 기본
      if (!part.department) {
        part.department = parseDepartmentFromSheetName(part.sheetName);
      }
      for (const scene of part.scenes) {
        scene.storyboardUrl = sanitizeImageUrl(scene.storyboardUrl);
        scene.guideUrl = sanitizeImageUrl(scene.guideUrl);
      }
    }
  }

  return episodes;
}

// ─── GAS GET 호출 헬퍼 ────────────────────────────────────────

async function gasGet(params: Record<string, string>): Promise<void> {
  if (!webAppUrl) throw new Error('Sheets 미연결');

  const qs = new URLSearchParams(params);
  const res = await gasFetch(`${webAppUrl}?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; error?: string };
  if (!json.ok) throw new Error(json.error ?? '요청 실패');
}

// ─── 셀 업데이트 (체크박스 토글) ──────────────────────────────

export async function updateSceneStage(
  sheetName: string,
  rowIndex: number,
  stage: string,
  value: boolean
): Promise<void> {
  await gasGet({
    action: 'updateCell',
    sheetName,
    rowIndex: String(rowIndex),
    stage,
    value: String(value),
  });
}

// ─── 에피소드 추가 ────────────────────────────────────────────

export async function addEpisode(episodeNumber: number, department: Department = 'bg'): Promise<void> {
  await gasGet({ action: 'addEpisode', episodeNumber: String(episodeNumber), department });
}

// ─── 파트 추가 ────────────────────────────────────────────────

export async function addPart(episodeNumber: number, partId: string, department: Department = 'bg'): Promise<void> {
  await gasGet({ action: 'addPart', episodeNumber: String(episodeNumber), partId, department });
}

// ─── 씬 추가 ──────────────────────────────────────────────────

export async function addScene(
  sheetName: string, sceneId: string, assignee: string, memo: string
): Promise<void> {
  await gasGet({ action: 'addScene', sheetName, sceneId, assignee, memo });
}

// ─── 씬 삭제 ──────────────────────────────────────────────────

export async function deleteScene(sheetName: string, rowIndex: number): Promise<void> {
  await gasGet({ action: 'deleteScene', sheetName, rowIndex: String(rowIndex) });
}

// ─── 씬 필드 업데이트 ─────────────────────────────────────────

export async function updateSceneField(
  sheetName: string, rowIndex: number, field: string, value: string
): Promise<void> {
  await gasGet({ action: 'updateSceneField', sheetName, rowIndex: String(rowIndex), field, value });
}

// ─── 이미지 업로드 (Drive에 저장 → URL 반환) ──────────────────

export async function uploadImage(
  sheetName: string,
  sceneId: string,
  imageType: string,
  base64Data: string
): Promise<{ url: string }> {
  if (!webAppUrl) throw new Error('Sheets 미연결');

  // base64 data URL에서 순수 데이터와 MIME 타입 추출
  const match = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid base64 image data');

  const mimeType = match[1];
  const rawBase64 = match[2];

  // POST로 이미지 데이터 전송 (URL 길이 제한 회피)
  const res = await gasFetch(webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'uploadImage',
      sheetName,
      sceneId,
      imageType,
      mimeType,
      base64: rawBase64,
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; url?: string; error?: string };
  if (!json.ok) throw new Error(json.error ?? '이미지 업로드 실패');

  // Drive URL → drive-img:// 프록시로 변환하여 즉시 표시 가능하도록
  return { url: sanitizeImageUrl(json.url!) || json.url! };
}
