import { useEffect, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import { loadPreferences, savePreferences } from '@/services/settingsService';

export type IntegrationStatus = 'connected' | 'disconnected' | 'loading' | 'error';

interface IntegrationCardProps {
  id: string;                      // preferences 접힘 상태 키
  icon: ReactNode;                 // 16x16 아이콘
  iconColor: string;               // ex. 'rgb(var(--color-accent))' | '#34D399' | '#60A5FA'
  title: string;
  subtitle?: string;
  status: IntegrationStatus;
  statusLabel?: string;            // 뱃지 텍스트 override
  defaultCollapsed?: boolean;
  children: ReactNode;
}

const STATUS_STYLE: Record<IntegrationStatus, { dot: string; bg: string; text: string; label: string }> = {
  connected:    { dot: 'rgb(74 222 128)',  bg: 'rgb(34 197 94 / 0.1)',  text: 'rgb(74 222 128)',  label: '연결됨' },
  disconnected: { dot: 'rgb(107 114 128)', bg: 'rgb(45 48 65 / 0.4)',   text: 'rgb(139 141 163)', label: '미연결' },
  loading:      { dot: 'rgb(251 191 36)',  bg: 'rgb(245 158 11 / 0.1)', text: 'rgb(251 191 36)',  label: '확인 중' },
  error:        { dot: 'rgb(248 113 113)', bg: 'rgb(239 68 68 / 0.1)',  text: 'rgb(248 113 113)', label: '에러' },
};

export function IntegrationCard({
  id, icon, iconColor, title, subtitle, status, statusLabel, defaultCollapsed = false, children,
}: IntegrationCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPreferences().then((prefs) => {
      if (cancelled) return;
      const list = prefs?.settingsIntegrationCollapsed;
      if (Array.isArray(list)) setCollapsed(list.includes(id));
      setHydrated(true);
    });
    return () => { cancelled = true; };
  }, [id]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (!hydrated) return;
    loadPreferences().then((prefs) => {
      const cur = new Set(prefs?.settingsIntegrationCollapsed ?? []);
      if (next) cur.add(id);
      else cur.delete(id);
      savePreferences({ ...(prefs ?? {}), settingsIntegrationCollapsed: [...cur] });
    });
  };

  const s = STATUS_STYLE[status];
  const label = statusLabel ?? s.label;

  return (
    <div className="bg-bg-card border border-bg-border/60 rounded-lg overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-border/10 transition-colors cursor-pointer text-left"
      >
        <div
          className="w-8 h-8 flex items-center justify-center rounded-md shrink-0"
          style={{ background: `color-mix(in srgb, ${iconColor} 12%, transparent)` }}
        >
          <span style={{ color: iconColor }}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-text-primary">{title}</div>
          {subtitle && <div className="text-[11px] text-text-secondary truncate">{subtitle}</div>}
        </div>
        <span
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono"
          style={{ background: s.bg, color: s.text }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: s.dot, boxShadow: `0 0 0 2px ${s.bg}` }}
          />
          {label}
        </span>
        <span className="text-text-secondary/60 ml-1">
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className={cn('border-t border-bg-border/40', 'px-4 py-4')}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 3단계 버튼 공통 스타일 (연동 탭 전용) */
export const btnStyles = {
  primary: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent hover:bg-accent/90 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_1px_2px_rgba(0,0,0,0.3)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
  ghost:   'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-transparent hover:bg-bg-border/30 text-text-secondary hover:text-text-primary border border-bg-border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
  danger:  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-transparent hover:bg-red-500/10 text-red-400 border border-red-500/20 hover:border-red-500/40 transition-colors cursor-pointer',
} as const;
