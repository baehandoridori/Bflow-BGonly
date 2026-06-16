import { useEffect, useState } from 'react';
import { onSupabaseStatusChange, testSupabaseConnection, getSupabaseRealtimeStatus } from '@/services/supabaseService';
import { checkGasConnection } from '@/services/gasConfigService';
import { checkVacationConnection } from '@/services/vacationService';
import * as gcalService from '@/services/googleCalendarService';

interface OverviewItem {
  key: string;
  label: string;
  status: 'connected' | 'disconnected' | 'loading' | 'error';
  valueText: string;
  mono?: boolean;
  live?: boolean;
}

const DOT_STYLE: Record<OverviewItem['status'], { bg: string; ring: string }> = {
  connected:    { bg: 'rgb(74 222 128)',  ring: 'rgb(34 197 94 / 0.15)' },
  disconnected: { bg: 'rgb(107 114 128)', ring: 'transparent' },
  loading:      { bg: 'rgb(251 191 36)',  ring: 'rgb(245 158 11 / 0.15)' },
  error:        { bg: 'rgb(248 113 113)', ring: 'rgb(239 68 68 / 0.15)' },
};

export function IntegrationOverview() {
  // 각 서비스의 "실제" 연결 상태를 IPC 결과로 확인 — null 은 로딩 중
  const [supaOk, setSupaOk] = useState<boolean | null>(null);
  const [gasOk, setGasOk] = useState<boolean | null>(null);
  const [vacOk, setVacOk] = useState<boolean | null>(null);
  const [gcalOk, setGcalOk] = useState<boolean | null>(null);
  const [rtStatus, setRtStatus] = useState<string>('CONNECTING');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try { const r = await testSupabaseConnection(); if (!cancelled) setSupaOk(!!r.ok); }
      catch { if (!cancelled) setSupaOk(false); }

      try { const ok = await checkGasConnection(); if (!cancelled) setGasOk(!!ok); }
      catch { if (!cancelled) setGasOk(false); }

      try { const ok = await checkVacationConnection(); if (!cancelled) setVacOk(!!ok); }
      catch { if (!cancelled) setVacOk(false); }

      try { const authed = await gcalService.isAuthenticated(); if (!cancelled) setGcalOk(!!authed); }
      catch { if (!cancelled) setGcalOk(false); }

      // 마운트 시 현재 Realtime 상태 bootstrap — 이벤트 구독만으론 과거 상태 못 받음
      try { const cur = await getSupabaseRealtimeStatus(); if (!cancelled) setRtStatus(cur); }
      catch { /* keep CONNECTING */ }
    })();

    const cleanup = onSupabaseStatusChange((status) => setRtStatus(status));
    return () => { cancelled = true; cleanup(); };
  }, []);

  const realtimeHealthy = rtStatus === 'SUBSCRIBED';

  const toStatus = (ok: boolean | null): OverviewItem['status'] =>
    ok === null ? 'loading' : (ok ? 'connected' : 'disconnected');
  const toLabel = (ok: boolean | null, connectedText = '연결됨', disconnectedText = '미연결') =>
    ok === null ? '확인 중' : (ok ? connectedText : disconnectedText);

  const items: OverviewItem[] = [
    {
      key: 'supabase',
      label: 'Supabase',
      status: toStatus(supaOk),
      valueText: toLabel(supaOk, 'Healthy'),
    },
    {
      key: 'realtime',
      label: 'Realtime',
      status: realtimeHealthy ? 'connected' : (rtStatus === 'CHANNEL_ERROR' || rtStatus === 'TIMED_OUT' ? 'error' : 'loading'),
      valueText: rtStatus,
      mono: true,
      live: realtimeHealthy,
    },
    {
      key: 'storage',
      label: 'Storage',
      // Storage 는 Supabase 에 종속 — Supabase 연결되면 scene-images 버킷 사용 가능
      status: toStatus(supaOk),
      valueText: 'scene-images',
      mono: true,
    },
    {
      key: 'apps-script',
      label: 'Apps Script',
      status: toStatus(gasOk),
      valueText: toLabel(gasOk),
    },
    {
      key: 'vacation',
      label: 'Vacation',
      status: toStatus(vacOk),
      valueText: toLabel(vacOk),
    },
    {
      key: 'gcal',
      label: 'Google Calendar',
      status: toStatus(gcalOk),
      valueText: toLabel(gcalOk, '인증 유지'),
    },
  ];

  return (
    <div className="bg-bg-card border border-bg-border/60 rounded-lg">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-bg-border/40">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/80 flex-1">OVERVIEW</span>
      </div>
      <div className="px-4 py-4 grid grid-cols-3 gap-x-6 gap-y-4">
        {items.map((it) => {
          const s = DOT_STYLE[it.status];
          return (
            <div key={it.key} className="flex items-center gap-2.5 min-w-0">
              <span
                className="relative inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  background: s.bg,
                  boxShadow: s.ring !== 'transparent' ? `0 0 0 2px ${s.ring}` : undefined,
                }}
              >
                {it.live && (
                  <span
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: s.bg,
                      animation: 'overview-live-pulse 2s ease-out infinite',
                    }}
                  />
                )}
              </span>
              <div className="min-w-0">
                <div className="text-[10px] text-text-secondary/80 uppercase tracking-wider truncate">{it.label}</div>
                <div className={`text-[12px] text-text-primary truncate ${it.mono ? 'font-mono' : ''}`}>
                  {it.valueText}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes overview-live-pulse {
          0% { transform: scale(1); opacity: 0.35; }
          80%, 100% { transform: scale(2.4); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
