// electron/presence/mohoWindowPoller.ts
import { spawn } from 'child_process';
import { parseMohoTitles } from './mohoTitleParser';
import { createDedupGate } from './dedupGate';

/**
 * 모든 Moho 인스턴스의 MainWindowTitle을 한 줄씩 출력하는 PS 명령 인자.
 * `[Console]::OutputEncoding`을 UTF-8로 강제 — PowerShell 5.1의 기본 출력 인코딩은
 * OEM 코드페이지(한국어 Windows=cp949)라, 강제하지 않으면 한글 파일명(예: b030-피드백.moho)이
 * 깨져서 basename 매칭이 조용히 실패한다.
 */
export const MOHO_PS_ARGS = [
  '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process -Name *moho* -ErrorAction SilentlyContinue | ForEach-Object { $_.MainWindowTitle }",
];

/** 1회 폴링: 실행 중 Moho 창 제목 → 정규화 basename 배열. 실패/비win32/행 → []. */
export function pollMohoActiveBasenames(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    let watchdog: NodeJS.Timeout | null = null;
    const done = (lines: string[]) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      resolve(lines);
    };
    try {
      const ps = spawn('powershell.exe', MOHO_PS_ARGS, { windowsHide: true });
      // 폴링 주기(기본 4s)보다 짧은 워치독으로 PS 행(hang) 시 tick이 영구 대기하는 것 방지
      watchdog = setTimeout(() => { try { ps.kill(); } catch { /* noop */ } done([]); }, 3000);
      ps.stdout.setEncoding('utf8');
      ps.stdout.on('data', (d) => { out += d; });
      ps.stderr?.on('data', () => { /* drain: 파이프 채움 방지 */ });
      ps.on('error', () => done([]));
      ps.on('close', () => done(parseMohoTitles(out.split(/\r?\n/))));
    } catch { done([]); }
  });
}

export interface MohoTitlePolling {
  /** 폴링 중단. */
  stop: () => void;
  /** dedup 기억 리셋 + 즉시 재폴링 — 파일 집합이 동일해도 다음 tick에서 onChange 재발생. */
  reset: () => void;
}

/** 주기 폴링 시작. basename 집합이 달라질 때만 onChange. reset()으로 재방송 강제. */
export function startMohoTitlePolling(opts: {
  intervalMs?: number;
  onChange: (basenames: string[]) => void;
}): MohoTitlePolling {
  const intervalMs = opts.intervalMs ?? 4000;
  const gate = createDedupGate();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    const basenames = await pollMohoActiveBasenames();
    if (stopped) return;
    const key = [...basenames].sort().join('|');
    if (gate.shouldEmit(key)) opts.onChange(basenames);
  };
  if (process.platform === 'win32') {
    void tick();
    timer = setInterval(() => { void tick(); }, intervalMs);
  }
  return {
    stop: () => { stopped = true; if (timer) clearInterval(timer); },
    reset: () => { gate.reset(); if (!stopped && process.platform === 'win32') void tick(); },
  };
}
