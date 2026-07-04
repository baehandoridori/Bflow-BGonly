// electron/presence/mohoWindowPoller.ts
import { spawn } from 'child_process';
import { parseMohoTitles } from './mohoTitleParser';

/** 모든 Moho 인스턴스의 MainWindowTitle을 한 줄씩 출력하는 PS 명령 인자 */
export const MOHO_PS_ARGS = [
  '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
  "Get-Process -Name *moho* -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle }",
];

/** 1회 폴링: 실행 중 Moho 창 제목 → 정규화 basename 배열. 실패/비win32 → []. */
export function pollMohoActiveBasenames(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (lines: string[]) => { if (!settled) { settled = true; resolve(lines); } };
    try {
      const ps = spawn('powershell.exe', MOHO_PS_ARGS, { windowsHide: true });
      ps.stdout.on('data', (d) => { out += d.toString(); });
      ps.on('error', () => done([]));
      ps.on('close', () => done(parseMohoTitles(out.split(/\r?\n/))));
    } catch { done([]); }
  });
}

/** 주기 폴링 시작. basename 집합이 달라질 때만 onChange. @returns 중단 함수 */
export function startMohoTitlePolling(opts: {
  intervalMs?: number;
  onChange: (basenames: string[]) => void;
}): () => void {
  const intervalMs = opts.intervalMs ?? 4000;
  let prevKey = '__init__';
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    const basenames = await pollMohoActiveBasenames();
    if (stopped) return;
    const key = [...basenames].sort().join('|');
    if (key !== prevKey) { prevKey = key; opts.onChange(basenames); }
  };
  if (process.platform === 'win32') {
    void tick();
    timer = setInterval(() => { void tick(); }, intervalMs);
  }
  return () => { stopped = true; if (timer) clearInterval(timer); };
}
