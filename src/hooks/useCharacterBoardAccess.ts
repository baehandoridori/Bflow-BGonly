/**
 * 캐릭터 현황판 접근 권한 게이팅.
 *
 * metadata (type='feature-access', key='character-board') 의 value(JSON 문자열)를 읽어
 *   { userIds: string[], allowAdmin: boolean } 으로 파싱.
 * 현재 유저가 userIds 에 포함되거나 (allowAdmin && role==='admin') 이면 true.
 *
 * 권한 없으면 사이드바 메뉴 자체가 렌더되지 않음 (Sidebar 가 이 플래그로 분기).
 * 메뉴 깜빡임 방지: 마지막으로 읽은 config 를 localStorage 에 캐시해 첫 렌더 초기값으로 쓴다.
 */

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { readMetadataFromSupabase } from '@/services/supabaseService';

interface FeatureAccessConfig {
  userIds: string[];
  allowAdmin: boolean;
}

const CACHE_KEY = 'bflow:feature-access:character-board';

function normalize(raw: unknown): FeatureAccessConfig {
  const p = (raw ?? {}) as Partial<FeatureAccessConfig>;
  return {
    userIds: Array.isArray(p.userIds) ? p.userIds : [],
    allowAdmin: p.allowAdmin === true,
  };
}

function parseConfig(raw: unknown): FeatureAccessConfig {
  // metadata row 는 { type, key, value } 형태이거나 value 문자열 자체일 수 있음.
  let value: unknown = raw;
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    value = (raw as Record<string, unknown>).value;
  }
  if (typeof value !== 'string') return { userIds: [], allowAdmin: false };
  try {
    return normalize(JSON.parse(value));
  } catch {
    return { userIds: [], allowAdmin: false };
  }
}

function readCached(): FeatureAccessConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function useCharacterBoardAccess(): boolean {
  const currentUser = useAuthStore((s) => s.currentUser);
  // 캐시된 config 로 초기화 → 권한 있는 사용자는 첫 렌더부터 메뉴 노출(깜빡임 방지).
  const [config, setConfig] = useState<FeatureAccessConfig | null>(() => readCached());

  useEffect(() => {
    let cancelled = false;
    readMetadataFromSupabase('feature-access', 'character-board')
      .then((row) => {
        if (cancelled) return;
        const next = parseConfig(row);
        setConfig(next);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      })
      .catch(() => {
        // 일시적 조회 실패 시 캐시 유지 (없으면 차단).
        if (!cancelled) setConfig((prev) => prev ?? { userIds: [], allowAdmin: false });
      });
    return () => { cancelled = true; };
  }, []);

  if (!currentUser || !config) return false;
  if (config.userIds.includes(currentUser.id)) return true;
  if (config.allowAdmin && currentUser.role === 'admin') return true;
  return false;
}
