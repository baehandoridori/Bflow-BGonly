import { useEffect, useState } from 'react';

import { alignMarketSecond } from './marketQuote.ts';

function delayUntilNextSecond(nowMs: number): number {
  return 1000 - (nowMs % 1000);
}

export function useMarketClock(): number {
  const [nowMs, setNowMs] = useState(() => alignMarketSecond(Date.now()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (document.visibilityState !== 'visible') return;
      const current = Date.now();
      timer = setTimeout(() => {
        setNowMs(alignMarketSecond(Date.now()));
        schedule();
      }, delayUntilNextSecond(current));
    };
    const handleVisibility = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.visibilityState !== 'visible') return;
      setNowMs(alignMarketSecond(Date.now()));
      schedule();
    };

    schedule();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return nowMs;
}
