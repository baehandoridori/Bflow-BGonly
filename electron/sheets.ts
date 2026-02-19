/**
 * Google Sheets API 래퍼 — Electron 메인 프로세스에서 실행
 *
 * 시트 구조:
 *   A: No | B: 씬번호 | C: 메모 | D: 스토리보드URL | E: 가이드URL
 *   F: 담당자 | G: LO | H: 완료 | I: 검수 | J: PNG | K: 진행률(수식)
 *
 * 시트 탭 이름: EP01_A, EP01_B, EP02_A, ... (자동 감지)
 */

import { google, type sheets_v4 } from 'googleapis';
import fs from 'fs';

let sheetsClient: sheets_v4.Sheets | null = null;

// ─── 인증 ─────────────────────────────────────────────────────

export async function initSheets(credentialsPath: string): Promise<boolean> {
  try {
    const content = fs.readFileSync(credentialsPath, { encoding: 'utf-8' });
    const credentials = JSON.parse(content);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('[Sheets] 인증 성공');
    return true;
  } catch (err) {
    console.error('[Sheets] 인증 실패:', err);
    sheetsClient = null;
    return false;
  }
}

export function isConnected(): boolean {
  return sheetsClient !== null;
}

// ─── 시트 탭 목록 (EP 자동 감지) ──────────────────────────────

interface SheetTab {
  title: string;
  episodeNumber: number;
  partId: string;
}

const EP_PATTERN = /^EP(\d+)_([A-Z])$/;

export async function getEpisodeTabs(spreadsheetId: string): Promise<SheetTab[]> {
  if (!sheetsClient) throw new Error('Sheets 미연결');

  const res = await sheetsClient.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  });

  const tabs: SheetTab[] = [];
  for (const sheet of res.data.sheets ?? []) {
    const title = sheet.properties?.title ?? '';
    const match = title.match(EP_PATTERN);
    if (match) {
      tabs.push({
        title,
        episodeNumber: parseInt(match[1], 10),
        partId: match[2],
      });
    }
  }

  return tabs.sort((a, b) =>
    a.episodeNumber !== b.episodeNumber
      ? a.episodeNumber - b.episodeNumber
      : a.partId.localeCompare(b.partId)
  );
}

// ─── 시트 데이터 읽기 ─────────────────────────────────────────

interface RawScene {
  no: number;
  sceneId: string;
  memo: string;
  storyboardUrl: string;
  guideUrl: string;
  assignee: string;
  lo: boolean;
  done: boolean;
  review: boolean;
  png: boolean;
}

function parseBoolean(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const v = val.trim().toUpperCase();
    return v === 'TRUE' || v === '1' || v === 'O' || v === '○';
  }
  return false;
}

export async function readSheetData(
  spreadsheetId: string,
  sheetName: string
): Promise<RawScene[]> {
  if (!sheetsClient) throw new Error('Sheets 미연결');

  const res = await sheetsClient.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:J`,
  });

  const rows = res.data.values ?? [];
  const scenes: RawScene[] = [];

  // 첫 번째 행은 헤더 → 스킵
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue; // 빈 행 스킵

    scenes.push({
      no: parseInt(row[0], 10) || i,
      sceneId: String(row[1] ?? ''),
      memo: String(row[2] ?? ''),
      storyboardUrl: String(row[3] ?? ''),
      guideUrl: String(row[4] ?? ''),
      assignee: String(row[5] ?? ''),
      lo: parseBoolean(row[6]),
      done: parseBoolean(row[7]),
      review: parseBoolean(row[8]),
      png: parseBoolean(row[9]),
    });
  }

  return scenes;
}

// ─── 전체 에피소드 데이터 읽기 ────────────────────────────────

export interface EpisodeData {
  episodeNumber: number;
  title: string;
  parts: {
    partId: string;
    sheetName: string;
    scenes: RawScene[];
  }[];
}

export async function readAllEpisodes(spreadsheetId: string): Promise<EpisodeData[]> {
  const tabs = await getEpisodeTabs(spreadsheetId);

  // 에피소드별로 그룹핑
  const epMap = new Map<number, EpisodeData>();

  for (const tab of tabs) {
    if (!epMap.has(tab.episodeNumber)) {
      epMap.set(tab.episodeNumber, {
        episodeNumber: tab.episodeNumber,
        title: `EP.${String(tab.episodeNumber).padStart(2, '0')}`,
        parts: [],
      });
    }

    const scenes = await readSheetData(spreadsheetId, tab.title);
    epMap.get(tab.episodeNumber)!.parts.push({
      partId: tab.partId,
      sheetName: tab.title,
      scenes,
    });
  }

  return Array.from(epMap.values()).sort((a, b) => a.episodeNumber - b.episodeNumber);
}

// ─── 셀 업데이트 (체크박스 토글) ──────────────────────────────

const STAGE_COLUMNS: Record<string, string> = {
  lo: 'G',
  done: 'H',
  review: 'I',
  png: 'J',
};

export async function updateSceneStage(
  spreadsheetId: string,
  sheetName: string,
  rowIndex: number, // 0-based (씬 배열 인덱스)
  stage: string,
  value: boolean
): Promise<void> {
  if (!sheetsClient) throw new Error('Sheets 미연결');

  const column = STAGE_COLUMNS[stage];
  if (!column) throw new Error(`잘못된 단계: ${stage}`);

  // +2: 헤더(1행) + 0-based → 1-based
  const cellRange = `${sheetName}!${column}${rowIndex + 2}`;

  await sheetsClient.spreadsheets.values.update({
    spreadsheetId,
    range: cellRange,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[value]],
    },
  });
}
