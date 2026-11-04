import type { DataSource } from '@/stores/useAppStore';

export interface HeaderConnectionBadge {
  tone: 'ok' | 'offline' | 'blocked';
  /** 상단에 글자로 보이는 짧은 말. 연결됐을 땐 아이콘만 둔다. */
  label: string | null;
  /** 마우스를 올리면 보이는 설명. */
  title: string;
}

/**
 * 상단 연결 표시. 서버에 닿지 못하면 아이콘만이 아니라 글자로 알린다 —
 * 2026-10-21 사용량 한도 차단 때 상단에 'sheets' 만 떠서 팀원들이 원인을 몰랐다.
 */
export function resolveHeaderConnectionBadge(source: DataSource): HeaderConnectionBadge | null {
  switch (source) {
    case 'supabase':
      return { tone: 'ok', label: null, title: 'B flow 서버에 연결돼 있어요' };
    case 'offline':
      return {
        tone: 'offline',
        label: '서버 연결 안 됨',
        title: 'B flow 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요. 지금 보이는 것은 마지막으로 받은 내용이고, 연결되면 저절로 다시 받아 와요.',
      };
    case 'quota-blocked':
      return {
        tone: 'blocked',
        label: '서버 사용량 한도로 막힘',
        title: 'B flow 서버가 사용량 한도에 걸려 잠시 막혀 있어요. 인터넷 문제가 아니니 관리자에게 알려 주세요. 지금 보이는 것은 마지막으로 받은 내용이고, 풀리면 저절로 다시 받아 와요.',
      };
    default:
      return null;
  }
}
