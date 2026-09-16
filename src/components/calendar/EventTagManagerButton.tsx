import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { TagManagerPopover } from './TagManagerPopover';

/** The manager is a body portal, separate from the event editor's controls. */
export function EventTagManagerButton({ disabled = false }: { disabled?: boolean }) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  if (currentUser?.role !== 'admin') return null;
  return <>
    <button type="button" disabled={disabled} aria-label="일정 태그 추가 및 삭제" onClick={(event) => { event.stopPropagation(); setAnchor(event.currentTarget.getBoundingClientRect()); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-40 cursor-pointer">
      <Settings2 size={12} /> 추가·삭제
    </button>
    {anchor && <TagManagerPopover anchorRect={anchor} onClose={() => setAnchor(null)} />}
  </>;
}
