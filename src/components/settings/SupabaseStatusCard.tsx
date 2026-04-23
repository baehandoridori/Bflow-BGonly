import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Copy, Check, Table2, MessageSquare, History, Users, FileText } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import {
  onSupabaseStatusChange,
  testSupabaseConnection,
  getSupabaseActivity,
  getSupabaseRealtimeStatus,
} from '@/services/supabaseService';
import { SUPABASE_URL } from '@/config';
import { Sparkline } from './Sparkline';

type RangeId = '7D' | '24H' | '1H';

interface RangeSpec {
  id: RangeId;
  label: string;
  rangeMs: number;
  buckets: number;
}

const RANGES: RangeSpec[] = [
  { id: '7D',  label: '7D',  rangeMs: 7 * 24 * 60 * 60 * 1000, buckets: 7  }, // 일 단위
  { id: '24H', label: '24H', rangeMs: 24 * 60 * 60 * 1000,     buckets: 24 }, // 시간 단위
  { id: '1H',  label: '1H',  rangeMs: 60 * 60 * 1000,          buckets: 12 }, // 5분 단위
];

interface TableRow {
  name: string;          // 실제 Supabase 테이블명
  icon: React.ReactNode;
  rows: number | null;   // 메모리 기반 count. 집계 불가 시 null → '—'
}

const TABLES: Omit<TableRow, 'rows'>[] = [
  { name: 'scenes',         icon: <Table2 size={14} /> },
  { name: 'comments',       icon: <MessageSquare size={14} /> },
  { name: 'comp_revisions', icon: <History size={14} /> },
  { name: 'users',          icon: <Users size={14} /> },
  { name: 'metadata',       icon: <FileText size={14} /> },
];

const REALTIME_CHANNELS = ['scenes', 'comments', 'comp_revisions'] as const;

function formatNumber(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString();
}

export function SupabaseStatusCard() {
  const episodes = useDataStore((s) => s.episodes);
  const users = useAuthStore((s) => s.users);
  const revisions = useRevisionStore((s) => s.revisions);

  const [supaOk, setSupaOk] = useState<boolean | null>(null);
  const [rtStatus, setRtStatus] = useState<string>('CONNECTING');
  const [copied, setCopied] = useState(false);
  const [range, setRange] = useState<RangeId>('7D');
  // table → bucket counts (per current range)
  const [activity, setActivity] = useState<Record<string, number[]>>({});

  // 연결 상태
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const r = await testSupabaseConnection(); if (!cancelled) setSupaOk(!!r.ok); }
      catch { if (!cancelled) setSupaOk(false); }
      // 마운트 시 현재 Realtime 상태 bootstrap (Codex 리뷰 #7)
      try { const cur = await getSupabaseRealtimeStatus(); if (!cancelled) setRtStatus(cur); }
      catch { /* keep CONNECTING */ }
    })();
    const cleanup = onSupabaseStatusChange((status) => setRtStatus(status));
    return () => { cancelled = true; cleanup(); };
  }, []);

  // Activity 로드 (range 변경 시 리로드, 5초마다 자동 새로고침)
  const spec = useMemo(() => RANGES.find((r) => r.id === range)!, [range]);
  const loadActivity = useCallback(async () => {
    const results = await Promise.all(
      TABLES.map(async (t): Promise<[string, number[]]> => {
        try {
          const buckets = await getSupabaseActivity({
            table: t.name,
            rangeMs: spec.rangeMs,
            buckets: spec.buckets,
          });
          return [t.name, buckets.map((b) => b.count)];
        } catch {
          return [t.name, []];
        }
      }),
    );
    const next: Record<string, number[]> = {};
    for (const [name, data] of results) next[name] = data;
    setActivity(next);
  }, [spec]);
  useEffect(() => {
    loadActivity();
    const timer = setInterval(loadActivity, 5000);
    return () => clearInterval(timer);
  }, [loadActivity]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const healthy = supaOk === true;
  const rtLive = rtStatus === 'SUBSCRIBED';

  const rowsByTable = useMemo<Record<string, number | null>>(() => {
    const allScenes = episodes.flatMap((ep) => ep.parts).flatMap((p) => p.scenes);
    return {
      scenes: allScenes.length,
      comments: null,         // 메모리 집계 불가
      comp_revisions: revisions.length,
      users: users.length,
      metadata: null,         // 메모리 집계 불가
    };
  }, [episodes, users, revisions]);

  return (
    <div className="bg-bg-card border border-bg-border/60 rounded-lg overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-bg-border/40">
        <div
          className="w-8 h-8 flex items-center justify-center rounded-md shrink-0"
          style={{ background: 'rgb(var(--color-accent) / 0.12)' }}
        >
          <Database size={16} className="text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text-primary">Supabase</div>
          <div className="text-[11px] text-text-secondary font-mono truncate">
            {SUPABASE_URL.replace(/^https?:\/\//, '')}
          </div>
        </div>
        <button
          onClick={handleCopy}
          title="URL 복사"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-border/30 border border-bg-border/60 transition-colors cursor-pointer"
        >
          {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          <span>{copied ? '복사됨' : '복사'}</span>
        </button>
        <span
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono"
          style={{
            background: healthy ? 'rgb(34 197 94 / 0.1)' : 'rgb(45 48 65 / 0.4)',
            color: healthy ? 'rgb(74 222 128)' : 'rgb(139 141 163)',
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{
              background: healthy ? 'rgb(74 222 128)' : 'rgb(107 114 128)',
              boxShadow: healthy ? '0 0 0 2px rgb(34 197 94 / 0.15)' : undefined,
            }}
          />
          {healthy ? 'HEALTHY' : 'IDLE'}
        </span>
      </div>

      {/* 테이블 섹션 헤더 + 범위 셀렉터 */}
      <div className="flex items-center justify-between px-4 pt-4 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/80">TABLES</span>
        <div className="inline-flex rounded-md border border-bg-border/60 overflow-hidden bg-bg-primary/40">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={cn(
                'px-2.5 py-1 text-[11px] font-mono transition-colors cursor-pointer',
                range === r.id
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-border/30',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <table className="w-full">
        <thead>
          <tr className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/70">
            <th className="text-left px-4 py-2 border-b border-bg-border/40" style={{ width: '36%' }}>Name</th>
            <th className="text-right px-4 py-2 border-b border-bg-border/40" style={{ width: '18%' }}>Rows</th>
            <th className="text-left px-4 py-2 border-b border-bg-border/40" style={{ width: '36%' }}>Activity ({range})</th>
            <th className="text-center px-4 py-2 border-b border-bg-border/40" style={{ width: '10%' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {TABLES.map((t, i) => {
            const data = activity[t.name] ?? [];
            return (
              <tr
                key={t.name}
                className={cn(
                  'text-[13px] hover:bg-bg-border/10 transition-colors',
                  i < TABLES.length - 1 ? 'border-b border-bg-border/20' : '',
                )}
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5 text-text-primary">
                    <span className="text-text-secondary">{t.icon}</span>
                    <span className="font-mono">{t.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-text-secondary">
                  {formatNumber(rowsByTable[t.name] ?? null)}
                </td>
                <td className="px-4 py-2.5">
                  <Sparkline data={data} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{
                      background: healthy ? 'rgb(74 222 128)' : 'rgb(107 114 128)',
                      boxShadow: healthy ? '0 0 0 2px rgb(34 197 94 / 0.15)' : undefined,
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Realtime subscriptions */}
      <div className="border-t border-bg-border/40 px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/80">REALTIME SUBSCRIPTIONS</span>
          <span className="text-[11px] text-text-secondary font-mono">{rtLive ? `${REALTIME_CHANNELS.length} channels` : rtStatus}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {REALTIME_CHANNELS.map((ch) => (
            <div
              key={ch}
              className="flex items-center gap-2 px-3 py-2 rounded-md border"
              style={{
                background: rtLive ? 'rgb(var(--color-accent) / 0.06)' : 'rgb(45 48 65 / 0.2)',
                borderColor: rtLive ? 'rgb(var(--color-accent) / 0.2)' : 'rgb(45 48 65 / 0.6)',
              }}
            >
              <span
                className="relative inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  background: rtLive ? 'rgb(var(--color-accent))' : 'rgb(107 114 128)',
                  boxShadow: rtLive ? '0 0 0 2px rgb(var(--color-accent) / 0.15)' : undefined,
                }}
              >
                {rtLive && (
                  <span
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: 'rgb(var(--color-accent))',
                      animation: 'supabase-channel-pulse 2s ease-out infinite',
                    }}
                  />
                )}
              </span>
              <span className="text-[12px] font-mono text-text-primary">{ch}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes supabase-channel-pulse {
          0% { transform: scale(1); opacity: 0.35; }
          80%, 100% { transform: scale(2.4); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
