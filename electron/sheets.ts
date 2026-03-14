/**
 * Google Sheets 프록시 — Apps Script 웹 앱 연동 (최소 잔존)
 *
 * Supabase 마이그레이션 후 남은 기능:
 * - GAS 연결/핑 (이미지 업로드 URL 설정용)
 * - 메타데이터 읽기 (Sheets fallback)
 * - 댓글 읽기 (Sheets fallback)
 * - 리비전 읽기 (Sheets fallback)
 * - 재시도 알림 콜백 + 종료 시 큐 보장
 */

import { gasFetchWithRetry, gasFetch, setRetryNotifyCallback as _setRetryNotifyCallback } from './gas-fetch';

let webAppUrl: string | null = null;

// ─── 재시도 알림 콜백 (gas-fetch.ts로 위임) ────────
export function setRetryNotifyCallback(cb: (message: string) => void): void {
  _setRetryNotifyCallback(cb);
}

// ─── 진행 중 작업 추적 (Phase 0-5: 종료 시 큐 보장) ─────────
let pendingOps = 0;
let pendingResolvers: (() => void)[] = [];

export function getPendingOpsCount(): number {
  return pendingOps;
}

/** 모든 진행 중 쓰기 작업이 완료될 때까지 대기 (최대 timeoutMs) */
export function waitForAllPendingOps(timeoutMs = 15000): Promise<boolean> {
  if (pendingOps <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    pendingResolvers.push(() => { clearTimeout(timer); resolve(true); });
  });
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

// ─── 메타데이터 읽기 (Sheets fallback) ─────────────────────────

export async function readAllMetadata(): Promise<{ type: string; key: string; value: string; updatedAt: string }[]> {
  if (!webAppUrl) throw new Error('Sheets 미연결');

  const qs = new URLSearchParams({ action: 'readAllMetadata' });
  const res = await gasFetchWithRetry(`${webAppUrl}?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { ok: boolean; data?: { type: string; key: string; value: string; updatedAt: string }[]; error?: string };
  if (!json.ok) throw new Error(json.error ?? '메타데이터 일괄 읽기 실패');
  return json.data ?? [];
}

// ─── 댓글 읽기 (Sheets fallback) ──────────────────────────────

export interface SheetComment {
  commentId: string;
  sheetName: string;
  sceneId: string;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];
  createdAt: string;
  editedAt: string;
}

export async function readCommentsForPart(sheetName: string): Promise<SheetComment[]> {
  if (!webAppUrl) throw new Error('Sheets 미연결');
  const res = await gasFetchWithRetry(`${webAppUrl}?action=readComments&sheetName=${encodeURIComponent(sheetName)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { ok: boolean; data?: SheetComment[]; error?: string };
  if (!json.ok) throw new Error(json.error ?? '댓글 읽기 실패');
  return json.data ?? [];
}

// ─── 리비전 읽기 (Sheets fallback) ────────────────────────────

export interface SheetRevision {
  id: string;
  sceneKey: string;
  revisionNo: number;
  status: string;
  description: string;
  imageUrl: string;
  department: string;
  requesterId: string;
  requesterName: string;
  assignee: string;
  resolvedBy: string;
  resolvedNote: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string;
}

export async function readRevisionsFromSheets(): Promise<SheetRevision[]> {
  if (!webAppUrl) throw new Error('Sheets 미연결');
  const res = await gasFetchWithRetry(`${webAppUrl}?action=readRevisions`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json() as { ok: boolean; data?: SheetRevision[]; error?: string };
  if (!json.ok) throw new Error(json.error ?? '리비전 읽기 실패');
  return json.data ?? [];
}
