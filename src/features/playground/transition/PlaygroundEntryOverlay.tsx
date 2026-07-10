import { useRef } from 'react';

import { useAppStore } from '@/stores/useAppStore';
import { DotWipeTransition } from './DotWipeTransition';
import { usePlaygroundEntryStore } from './usePlaygroundEntryStore';

export function PlaygroundEntryOverlay() {
  const active = usePlaygroundEntryStore((state) => state.active);
  const finish = usePlaygroundEntryStore((state) => state.finish);
  const committedId = useRef<number | null>(null);

  if (!active) return null;

  return (
    <DotWipeTransition
      request={active}
      label="지금은 쉬는 시간!"
      onCovered={() => {
        if (committedId.current === active.id) return;
        committedId.current = active.id;
        useAppStore.getState().setView('playground');
      }}
      onFinished={() => {
        finish(active.id);
        requestAnimationFrame(() => document.getElementById('playground-title')?.focus());
      }}
    />
  );
}
