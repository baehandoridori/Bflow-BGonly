import type { ReactNode } from 'react';

import { PlaygroundHeader, type PlaygroundHeaderProps } from './PlaygroundHeader';
import './playground.css';

export interface PlaygroundShellProps {
  header: PlaygroundHeaderProps;
  surfaceKey: string;
  children: ReactNode;
}

export function PlaygroundShell({ header, surfaceKey, children }: PlaygroundShellProps) {
  return (
    <section className="playground-shell" data-pg-shell aria-labelledby={header.titleId}>
      <PlaygroundHeader {...header} />
      <div key={surfaceKey} className="pg-surface pg-surface-enter" data-pg-surface>
        {children}
      </div>
    </section>
  );
}
