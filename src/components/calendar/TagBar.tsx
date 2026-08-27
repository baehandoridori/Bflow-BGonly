import { motion } from 'framer-motion';
import { Settings } from 'lucide-react';
import { useMemo } from 'react';
import { useMotionPref } from '@/hooks/useMotionPref';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { hexToRgba } from '@/utils/calendarDate';
import { VACATION_CHIP_ID } from '@/utils/calendarEventFilter';

interface TagBarProps {
  vacationConnected: boolean;
  onOpenTagManager: (anchorRect: DOMRect) => void;
}

interface TagChipProps {
  name: string;
  color: string;
  enabled: boolean;
  reduce: boolean;
  onClick: () => void;
}

// 켜고 끌 때 색만 바뀌면 눌렸는지 확신이 안 선다. 짧은 오버슈트로 반응을 준다.
const TAG_CHIP_POP = { duration: 0.35, ease: [0.16, 1, 0.3, 1] } as const;

function TagChip({ name, color, enabled, reduce, onClick }: TagChipProps) {
  return (
    <motion.button
      type="button"
      aria-label={`${name} 태그`}
      aria-pressed={enabled}
      onClick={onClick}
      animate={reduce ? undefined : { scale: enabled ? [1, 1.12, 1] : [1, 0.92, 1] }}
      transition={reduce ? { duration: 0 } : TAG_CHIP_POP}
      className="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer"
      style={enabled
        ? { backgroundColor: hexToRgba(color, 0.22), borderColor: hexToRgba(color, 0.45), color }
        : { backgroundColor: 'transparent', borderColor: 'rgba(139, 141, 163, 0.35)', color: '#8B8DA3' }}
    >
      {name}
    </motion.button>
  );
}

export function TagBar({ vacationConnected, onOpenTagManager }: TagBarProps) {
  const tags = useCalendarStore((state) => state.tags);
  const enabledTagIds = useCalendarStore((state) => state.enabledTagIds);
  const toggleTag = useCalendarStore((state) => state.toggleTag);
  const resetTagsAllOn = useCalendarStore((state) => state.resetTagsAllOn);
  const { reduce } = useMotionPref();
  const orderedTags = useMemo(() => [...tags].sort((a, b) => a.sortOrder - b.sortOrder), [tags]);
  const allEnabled = orderedTags.every((tag) => enabledTagIds[tag.id] !== false)
    && (!vacationConnected || enabledTagIds[VACATION_CHIP_ID] !== false);

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3" aria-label="태그 필터">
      <span className="mr-1 text-xs font-medium text-text-secondary">태그</span>
      <button
        type="button"
        aria-label="전체 태그 켜기"
        aria-pressed={allEnabled}
        onClick={resetTagsAllOn}
        className={allEnabled
          ? 'rounded-full border border-accent/40 bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent transition-colors cursor-pointer'
          : 'rounded-full border border-text-secondary/30 px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary cursor-pointer'}
      >
        전체
      </button>
      {orderedTags.map((tag) => (
        <TagChip
          key={tag.id}
          name={tag.name}
          color={tag.color}
          enabled={enabledTagIds[tag.id] !== false}
          reduce={reduce}
          onClick={() => toggleTag(tag.id)}
        />
      ))}
      {vacationConnected && (
        <TagChip
          name="휴가"
          color="#00B894"
          enabled={enabledTagIds[VACATION_CHIP_ID] !== false}
          reduce={reduce}
          onClick={() => toggleTag(VACATION_CHIP_ID)}
        />
      )}
      <button
        type="button"
        aria-label="태그 관리"
        onClick={(event) => onOpenTagManager(event.currentTarget.getBoundingClientRect())}
        className="ml-1 flex items-center gap-1 rounded-full px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-border/50 hover:text-text-primary cursor-pointer"
      >
        <Settings size={12} /> 태그 관리
      </button>
    </div>
  );
}
