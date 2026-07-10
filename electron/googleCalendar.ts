/**
 * Google Calendar API 연동 모듈
 * - OAuth2 인증 (loopback redirect)
 * - 이벤트 CRUD
 * - syncToken 기반 incremental sync
 * - Watch 채널 관리
 */

import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import http from 'http';
import { URL } from 'url';
import { shell, app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ─── 설정 ──────────────────────────────

// 팀 공용 OAuth 클라이언트 (내부 툴 전용 — 팀원이 별도 설정 없이 바로 연결하도록 하드코딩).
// 각 사용자의 토큰(google-tokens.json)은 여전히 로컬 AppData 에 암호화 저장되므로 개인 Google 계정은 분리된다.
const DEFAULT_CLIENT_ID = '117212248614-7lb5o1n41chsr4hst6eejq0ijhvj6hh2.apps.googleusercontent.com';
const DEFAULT_CLIENT_SECRET = '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';

// 사용자가 커스텀 자격증명을 쓰고 싶을 때만 gcal-credentials.json 에서 덮어쓴다.
// 없으면 위 DEFAULT_* 가 사용된다.
let _cachedCreds: { clientId: string; clientSecret: string } | null = null;

function getCredentials(): { clientId: string; clientSecret: string } {
  if (_cachedCreds && _cachedCreds.clientId && _cachedCreds.clientSecret) {
    return _cachedCreds;
  }
  const credPath = path.join(getDataPath(), 'gcal-credentials.json');
  try {
    const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
    const next = {
      clientId: creds.clientId || DEFAULT_CLIENT_ID,
      clientSecret: creds.clientSecret || DEFAULT_CLIENT_SECRET,
    };
    if (next.clientId && next.clientSecret) {
      _cachedCreds = next;
    }
    return next;
  } catch {
    // 파일 없음 — 하드코딩된 기본값 사용
    const next = { clientId: DEFAULT_CLIENT_ID, clientSecret: DEFAULT_CLIENT_SECRET };
    _cachedCreds = next;
    return next;
  }
}

// lazy getter (실제 사용 시점에 로드)
function getClientId(): string { return getCredentials().clientId; }
function getClientSecret(): string { return getCredentials().clientSecret; }

/** 자격 증명을 gcal-credentials.json에 저장. 호출 후 캐시 무효화해 재로드됨 */
export function saveCredentials(clientId: string, clientSecret: string): void {
  const trimmedId = (clientId || '').trim();
  const trimmedSecret = (clientSecret || '').trim();
  if (!trimmedId || !trimmedSecret) {
    throw new Error('clientId 와 clientSecret 을 모두 입력해 주세요.');
  }
  const credPath = path.join(getDataPath(), 'gcal-credentials.json');
  fs.writeFileSync(
    credPath,
    JSON.stringify({ clientId: trimmedId, clientSecret: trimmedSecret }, null, 2),
    'utf-8',
  );
  // 캐시 무효화 + OAuth2 클라이언트 재생성 유도
  _cachedCreds = null;
  oauth2Client = null;
  calendarApi = null;
}

/** 자격 증명 존재 여부만 반환 (실제 값 노출 금지) */
export function hasCredentialsSet(): boolean {
  const c = getCredentials();
  return !!(c.clientId && c.clientSecret);
}
const LOOPBACK_PORT = 8089;
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/oauth2callback`;
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const TOKENS_FILE = 'google-tokens.json';
const SYNC_STATE_FILE = 'gcal-sync-state.json';
const WATCH_STATE_FILE = 'gcal-watch-state.json';

// ─── Edge Function webhook URL ──────────────────────────────
// TODO: Supabase 프로젝트 배포 후 실제 URL로 교체
const WEBHOOK_URL = 'https://mpqifkpxalwxgcrddchv.supabase.co/functions/v1/gcal-webhook';
// TODO: 프로덕션 배포 시 Supabase GCAL_WEBHOOK_TOKEN secret과 동기화 필요
const WEBHOOK_TOKEN = 'bflow-gcal-wh-f9a3c7e1d2b4';

function getDataPath(): string {
  return app.getPath('userData');
}

function readJsonFile<T>(fileName: string): T | null {
  try {
    const filePath = path.join(getDataPath(), fileName);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJsonFile(fileName: string, data: unknown): void {
  const filePath = path.join(getDataPath(), fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/** 암호화 파일 쓰기 (민감 데이터용) */
function writeEncryptedFile(fileName: string, data: unknown): void {
  const filePath = path.join(getDataPath(), fileName);
  const json = JSON.stringify(data);
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json);
    fs.writeFileSync(filePath, encrypted);
  } else {
    // Fallback: 암호화 불가 시 평문 저장
    fs.writeFileSync(filePath, json, 'utf-8');
  }
}

/** 암호화 파일 읽기 (민감 데이터용) */
function readEncryptedFile<T>(fileName: string): T | null {
  try {
    const filePath = path.join(getDataPath(), fileName);
    const raw = fs.readFileSync(filePath);
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(raw);
      return JSON.parse(decrypted);
    }
    return JSON.parse(raw.toString('utf-8'));
  } catch {
    return null;
  }
}

// ─── OAuth2 클라이언트 ──────────────────────────────

let oauth2Client: OAuth2Client | null = null;
let calendarApi: calendar_v3.Calendar | null = null;
let _clientIdUsed = '';
let _clientSecretUsed = '';

function getOAuth2Client(): OAuth2Client {
  const currentId = getClientId();
  const currentSecret = getClientSecret();
  // 자격증명이 바뀌었으면 클라이언트 재생성 (빈 값 → 유효한 값 전환 등)
  if (!oauth2Client || _clientIdUsed !== currentId || _clientSecretUsed !== currentSecret) {
    oauth2Client = new google.auth.OAuth2(currentId, currentSecret, REDIRECT_URI);
    oauth2Client.on('tokens', (tokens) => {
      const saved = readEncryptedFile<Record<string, unknown>>(TOKENS_FILE) || {};
      writeEncryptedFile(TOKENS_FILE, { ...saved, ...tokens });
    });
    _clientIdUsed = currentId;
    _clientSecretUsed = currentSecret;
    calendarApi = null; // 캘린더 API도 재생성 강제
  }
  return oauth2Client;
}

function getCalendarApi(): calendar_v3.Calendar {
  if (!calendarApi) {
    calendarApi = google.calendar({ version: 'v3', auth: getOAuth2Client() });
  }
  return calendarApi;
}

/** 저장된 토큰 복원. 성공 시 true */
export function restoreTokens(): boolean {
  // 암호화 파일 먼저 시도, 실패 시 평문 JSON fallback (구 버전 호환)
  let tokens = readEncryptedFile<Record<string, unknown>>(TOKENS_FILE);
  if (!tokens) {
    tokens = readJsonFile<Record<string, unknown>>(TOKENS_FILE);
  }
  if (tokens) {
    getOAuth2Client().setCredentials(tokens);
    return true;
  }
  return false;
}

/** OAuth2 인증 여부 */
export function isAuthenticated(): boolean {
  const client = getOAuth2Client();
  return !!client.credentials?.access_token || !!client.credentials?.refresh_token;
}

/** OAuth2 인증 시작 (시스템 브라우저 열기) */
export function startAuth(): Promise<void> {
  if (!getClientId() || !getClientSecret()) {
    return Promise.reject(new Error(
      'Google Calendar 자격 증명이 설정되지 않았습니다.\n' +
      `${getDataPath()}/gcal-credentials.json 파일에 clientId, clientSecret을 설정해 주세요.`
    ));
  }
  const client = getOAuth2Client();
  const authorizeUrl = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, `http://127.0.0.1:${LOOPBACK_PORT}`);
        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code');
          if (!code) throw new Error('No authorization code');

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>B flow 인증 완료! 이 창을 닫아도 됩니다.</h1>');
          server.close();

          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);
          writeEncryptedFile(TOKENS_FILE, tokens);
          calendarApi = null; // 재생성 강제

          resolve();
        }
      } catch (err) {
        res.writeHead(500);
        res.end('Authentication failed');
        server.close();
        reject(err);
      }
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`포트 ${LOOPBACK_PORT}이(가) 이미 사용 중입니다. 다른 앱을 확인해 주세요.`));
      } else {
        reject(err);
      }
    });

    server.listen(LOOPBACK_PORT, '127.0.0.1', () => {
      shell.openExternal(authorizeUrl);
    });

    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out (120s)'));
    }, 120_000);
  });
}

/** 인증 해제 (Watch 채널도 정리) */
export async function signOut(): Promise<void> {
  // Watch 채널 먼저 중지 (토큰 삭제 전에 해야 API 호출 가능)
  try {
    await stopAllWatches();
  } catch { /* 이미 만료되었거나 인증 없을 수 있음 */ }

  const tokenPath = path.join(getDataPath(), TOKENS_FILE);
  if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
  oauth2Client = null;
  calendarApi = null;
}

// ─── 캘린더 목록 ──────────────────────────────

export async function listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
  const res = await getCalendarApi().calendarList.list();
  return (res.data.items || []).map((c) => ({
    id: c.id!,
    summary: c.summary || c.id!,
    primary: c.primary || false,
  }));
}

// ─── 이벤트 CRUD ──────────────────────────────

export interface GCalEventInput {
  id?: string;
  summary: string;
  description?: string;
  startDate: string;       // YYYY-MM-DD (종일) 또는 ISO datetime
  endDate: string;
  colorId?: string;
  extendedProperties?: Record<string, string>;
  /**
   * 이벤트 공개 범위.
   * - 'default': 캘린더 기본값 (보통 도메인 공유 캘린더면 동료에게 제목/내용 노출)
   * - 'public': 공개
   * - 'private': 비공개 — 같은 Google Workspace 도메인 사용자가 이 이벤트를 조회하더라도
   *              "비공개 일정" 으로만 표시되고 제목/메모가 숨겨짐.
   */
  visibility?: 'default' | 'public' | 'private';
}

export async function insertEvent(calendarId: string, input: GCalEventInput): Promise<string> {
  const isAllDay = input.startDate.length === 10; // YYYY-MM-DD
  const res = await getCalendarApi().events.insert({
    calendarId,
    requestBody: {
      id: input.id,
      summary: input.summary,
      description: input.description,
      start: isAllDay ? { date: input.startDate } : { dateTime: input.startDate },
      end: isAllDay ? { date: input.endDate } : { dateTime: input.endDate },
      colorId: input.colorId,
      extendedProperties: input.extendedProperties
        ? { private: input.extendedProperties }
        : undefined,
      visibility: input.visibility,
    },
  });
  return res.data.id!;
}

export async function updateEvent(
  calendarId: string,
  eventId: string,
  input: Partial<GCalEventInput>,
): Promise<void> {
  const body: calendar_v3.Schema$Event = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.startDate !== undefined) {
    const isAllDay = input.startDate.length === 10;
    body.start = isAllDay ? { date: input.startDate } : { dateTime: input.startDate };
  }
  if (input.endDate !== undefined) {
    const isAllDay = input.endDate.length === 10;
    body.end = isAllDay ? { date: input.endDate } : { dateTime: input.endDate };
  }
  if (input.extendedProperties) {
    body.extendedProperties = { private: input.extendedProperties };
  }
  if (input.visibility !== undefined) {
    body.visibility = input.visibility;
  }
  await getCalendarApi().events.patch({ calendarId, eventId, requestBody: body });
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  await getCalendarApi().events.delete({ calendarId, eventId });
}

// ─── Incremental Sync ──────────────────────────────

interface SyncState {
  [calendarId: string]: string; // syncToken
}

function loadSyncState(): SyncState {
  return readJsonFile<SyncState>(SYNC_STATE_FILE) || {};
}

function saveSyncState(state: SyncState): void {
  writeJsonFile(SYNC_STATE_FILE, state);
}

/** 전체 동기화 (최초 또는 syncToken 만료 시) */
export async function fullSync(calendarId: string): Promise<calendar_v3.Schema$Event[]> {
  const cal = getCalendarApi();
  let pageToken: string | undefined;
  const allEvents: calendar_v3.Schema$Event[] = [];
  let syncToken: string | undefined;

  do {
    const res = await cal.events.list({
      calendarId,
      maxResults: 250,
      singleEvents: true,
      pageToken,
    });
    allEvents.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken || undefined;
    syncToken = res.data.nextSyncToken || undefined;
  } while (pageToken);

  if (syncToken) {
    const state = loadSyncState();
    state[calendarId] = syncToken;
    saveSyncState(state);
  }

  return allEvents;
}

/** Incremental 동기화 (변경분만). isFullSync=true면 fullSync 폴백 발생 — 캐시 교체 필요 */
export async function incrementalSync(
  calendarId: string,
): Promise<{ updated: calendar_v3.Schema$Event[]; deleted: string[]; isFullSync: boolean }> {
  const state = loadSyncState();
  const syncToken = state[calendarId];

  if (!syncToken) {
    const events = await fullSync(calendarId);
    return { updated: events, deleted: [], isFullSync: true };
  }

  try {
    const cal = getCalendarApi();
    let pageToken: string | undefined;
    const changes: calendar_v3.Schema$Event[] = [];
    let newSyncToken: string | undefined;

    do {
      const res = await cal.events.list({ calendarId, syncToken, pageToken, singleEvents: true, maxResults: 250 });
      changes.push(...(res.data.items || []));
      pageToken = res.data.nextPageToken || undefined;
      newSyncToken = res.data.nextSyncToken || undefined;
    } while (pageToken);

    if (newSyncToken) {
      state[calendarId] = newSyncToken;
      saveSyncState(state);
    }

    const deleted = changes.filter((e) => e.status === 'cancelled').map((e) => e.id!);
    const updated = changes.filter((e) => e.status !== 'cancelled');

    return { updated, deleted, isFullSync: false };
  } catch (err: any) {
    if (err?.code === 410) {
      // syncToken 만료 → full sync
      const events = await fullSync(calendarId);
      return { updated: events, deleted: [], isFullSync: true };
    }
    throw err;
  }
}

// ─── Watch 채널 관리 ──────────────────────────────

interface WatchState {
  [calendarId: string]: {
    channelId: string;
    resourceId: string;
    expiration: number; // ms timestamp
  };
}

function loadWatchState(): WatchState {
  return readJsonFile<WatchState>(WATCH_STATE_FILE) || {};
}

function saveWatchState(state: WatchState): void {
  writeJsonFile(WATCH_STATE_FILE, state);
}

/** Watch 채널 등록/갱신 */
export async function ensureWatch(calendarId: string, userId: string): Promise<void> {
  const state = loadWatchState();
  const existing = state[calendarId];

  // 만료 3시간 전까지는 스킵
  if (existing && existing.expiration > Date.now() + 3 * 60 * 60 * 1000) {
    return;
  }

  // 기존 채널 중지 (있으면)
  if (existing) {
    try {
      await getCalendarApi().channels.stop({
        requestBody: { id: existing.channelId, resourceId: existing.resourceId },
      });
    } catch { /* 이미 만료되었을 수 있음 */ }
  }

  const channelId = crypto.randomUUID();
  const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7일

  const res = await getCalendarApi().events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: WEBHOOK_URL,
      token: `${WEBHOOK_TOKEN}:${userId}`,
      expiration: String(expiration),
    },
  });

  state[calendarId] = {
    channelId,
    resourceId: res.data.resourceId!,
    expiration: Number(res.data.expiration!),
  };
  saveWatchState(state);
}

/** 모든 Watch 채널 중지 */
export async function stopAllWatches(): Promise<void> {
  const state = loadWatchState();
  for (const [, watch] of Object.entries(state)) {
    try {
      await getCalendarApi().channels.stop({
        requestBody: { id: watch.channelId, resourceId: watch.resourceId },
      });
    } catch { /* ignore */ }
  }
  writeJsonFile(WATCH_STATE_FILE, {});
}
