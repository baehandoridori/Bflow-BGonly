/**
 * 캐릭터 현황판 접근 권한 게이팅.
 *
 * metadata (type='feature-access', key='character-board') 의 value(JSON 문자열)를 읽어
 *   { userIds: string[], allowAdmin: boolean } 으로 파싱.
 * 현재 유저가 userIds 에 포함되거나 (allowAdmin && role==='admin') 이면 true.
 *
 * 보안 게이트라 fail-closed: 서버 확인 전(로딩 중)과 조회 실패 시 모두 false(차단).
 *   캐시로 미리 true 를 주면 권한이 회수된 사용자가 첫 렌더에 보드를 보거나, 서버 조회가 실패했을 때
 *   stale 한 grant 가 남는 보안 구멍이 생기므로 캐시하지 않는다. (메뉴가 잠깐 늦게 뜨는 깜빡임은 감수.)
 * 사이드바 메뉴 노출 + 뷰 렌더(App.tsx) 양쪽이 이 플래그로 분기.
 */

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { readMetadataFromSupabase } from '@/services/supabaseService';

interface FeatureAccessConfig {
  userIds: string[];
  allowAdmin: boolean;
}

function parseConfig(raw: unknown): FeatureAccessConfig {
  // metadata row 는 { type, key, value } 형태이거나 value 문자열 자체일 수 있음.
  let value: unknown = raw;
  if (raw && typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    value = (raw as Record<string, unknown>).value;
  }
  if (typeof value !== 'string') return { userIds: [], allowAdmin: false };
  try {
    const parsed = JSON.parse(value) as Partial<FeatureAccessConfig>;
    return {
      userIds: Array.isArray(parsed.userIds) ? parsed.userIds : [],
      allowAdmin: parsed.allowAdmin === true,
    };
  } catch {
    return { userIds: [], allowAdmin: false };
  }
}

export function useCharacterBoardAccess(): boolean {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [config, setConfig] = useState<FeatureAccessConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    readMetadataFromSupabase('feature-access', 'character-board')
      .then((row) => { if (!cancelled) setConfig(parseConfig(row)); })
      .catch(() => { if (!cancelled) setConfig({ userIds: [], allowAdmin: false }); }); // 실패 시 차단(fail-closed).
    return () => { cancelled = true; };
  }, []);

  // 서버 확인 전(config === null) 에는 차단 — stale grant 노출 방지.
  if (!currentUser || !config) return false;
  if (config.userIds.includes(currentUser.id)) return true;
  if (config.allowAdmin && currentUser.role === 'admin') return true;
  return false;
}
