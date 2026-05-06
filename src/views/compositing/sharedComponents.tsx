// ─── 공유 컴포넌트 ─────────────────────────────

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Clock, Circle, Check } from 'lucide-react';
import { getUserColor } from '@/components/common/AssigneeSelect';
import { PRIORITY_CONFIG, STATUS_CONFIG } from '@/constants/revision';
import { floatingGlassStyle } from '@/utils/glassStyles';
import type { CompRevision, RevisionStatus, RevisionPriority } from '@/types';
import { getInitials } from './utils';

// ─── 아바타 ─────────────────────────────────

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  const color = getUserColor(name);
  const initials = getInitials(name);
  return (
    <div
      className="shrink-0 rounded-full flex items-center justify-center font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        backgroundColor: color,
      }}
      title={name}
    >
      {initials}
    </div>
  );
}

export function AvatarStack({ names, max = 4, size = 24 }: { names: string[]; max?: number; size?: number }) {
  const visible = names.slice(0, max);
  const overflow = names.length - max;
  return (
    <div className="flex items-center" style={{ marginLeft: size * 0.2 }}>
      {visible.map((name, i) => (
        <div
          key={name}
          className="relative rounded-full border-2 border-bg-card"
          style={{ marginLeft: i === 0 ? 0 : -(size * 0.3), zIndex: visible.length - i }}
        >
          <Avatar name={name} size={size} />
        </div>
      ))}
      {overflow > 0 && (
        <span className="ml-1 text-[10px] text-text-secondary">+{overflow}</span>
      )}
    </div>
  );
}

// ─── 상태 도트 ──────────────────────────────

export function StatusDots({ revisions }: { revisions: CompRevision[] }) {
  const sorted = [...revisions]
    .filter(r => r.status !== 'resolved')
    .sort((a, b) => {
      const order: Record<RevisionPriority, number> = { urgent: 0, high: 1, normal: 2 };
      return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
    });

  if (sorted.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5">
      {sorted.slice(0, 5).map((r) => (
        <div
          key={r.id}
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: PRIORITY_CONFIG[r.priority]?.color ?? '#74B9FF' }}
          title={`${PRIORITY_CONFIG[r.priority]?.label ?? '보통'}: ${r.description.slice(0, 30)}`}
        />
      ))}
      {sorted.length > 5 && (
        <span className="text-[9px] text-text-secondary ml-0.5">+{sorted.length - 5}</span>
      )}
    </div>
  );
}

// ─── 우선순위 뱃지 ───────────────────────────

export function PriorityBadge({ priority }: { priority: RevisionPriority }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span
      className="inline-flex items-center text-[11px] font-medium rounded px-1.5 py-0.5"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      {cfg.label}
    </span>
  );
}

// ─── 상태 드롭다운 ──────────────────────────

export function StatusDropdown({
  currentStatus,
  onSelect,
}: {
  currentStatus: RevisionStatus;
  onSelect: (status: RevisionStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const options: RevisionStatus[] = ['open', 'in_progress', 'resolved'];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
      >
        <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        상태
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1 z-20 rounded-lg overflow-hidden border border-bg-border shadow-xl"
            style={floatingGlassStyle}
          >
            {options.filter(s => s !== currentStatus).map((s) => {
              const cfg = STATUS_CONFIG[s];
              return (
                <button
                  key={s}
                  onClick={(e) => { e.stopPropagation(); onSelect(s); setOpen(false); }}
                  className="flex items-center gap-2 px-3 py-1.5 text-[11px] w-full hover:bg-bg-border/20 transition-colors cursor-pointer whitespace-nowrap"
                  style={{ color: cfg.color }}
                >
                  {s === 'open' && <Circle size={10} fill="currentColor" />}
                  {s === 'in_progress' && <Clock size={10} />}
                  {s === 'resolved' && <Check size={10} />}
                  {cfg.label}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
