import { useEffect } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { KEPT_DOT_TEXT, keptMapEditCount, primeKeptMapEdits, releaseKeptMapEdits, useKeptMapEdits } from './mapKeptSignal';

/**
 * The dot of the 배경 menu item: map edits of this account are not saved, kept on this PC or open in this run. Drawn only
 * inside the item the gate lets through, so the list is read for that account alone. Static: no number, no motion.
 */
export function BackgroundKeptDot({ userId }: { userId: string | null }) {
  const shown = useKeptMapEdits(state => !!userId && state.userId === userId && keptMapEditCount(state) > 0);
  useEffect(() => {
    if (!userId) return;
    primeKeptMapEdits(userId);
    // The list goes with the login, not with this dot: drawn anew for the same account, the marks the session keeps in the signal stay.
    return () => { if (useAuthStore.getState().currentUser?.id !== userId) releaseKeptMapEdits(userId); };
  }, [userId]);
  if (!shown) return null;
  return <span className="absolute -top-0.5 right-1.5 h-2.5 w-2.5 rounded-full border border-bg-card bg-accent shadow-[0_0_0_1px_rgb(var(--color-text-secondary))]" title={KEPT_DOT_TEXT}><span className="sr-only">{KEPT_DOT_TEXT}</span></span>;
}
