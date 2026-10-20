// electron/presence/mohoWindowPoller.ts
import { spawn } from 'child_process';
import { parseMohoTitles } from './mohoTitleParser';
import { createDedupGate } from './dedupGate';

// Moho 창 제목 감시 — PowerShell 을 **한 번만** 띄워 두고 그 안에서 4초마다 제목을 찍게 한다.
// 예전에는 4초마다 PowerShell 을 새로 띄웠는데, 한 번 띄울 때 CPU 를 0.2~0.3초 써서 B flow 를 켜 두는 내내
// CPU 한 코어의 5~8% 를 계속 먹었다 (2026-10-20 측정). 이제 시작 비용은 한 번이고 4초마다 프로세스 목록만 읽는다.

export const MOHO_FRAME_BEGIN = '__BFLOW_MOHO_BEGIN__';
export const MOHO_FRAME_END = '__BFLOW_MOHO_END__';

/**
 * 띄워 둔 PowerShell 이 돌릴 스크립트. 한 바퀴마다 BEGIN · 창 제목 줄들 · END 를 찍는다.
 * - `[Console]::OutputEncoding` 을 UTF-8 로 강제 — PowerShell 5.1 기본(한국어 Windows=cp949)이면
 *   한글 파일명(예: b030-피드백.moho)이 깨져 basename 매칭이 조용히 실패한다.
 * - B flow 가 갑자기 꺼져도(강제 종료·충돌) 남지 않게, 바퀴마다 B flow 프로세스가 살아 있는지 보고 없으면 끝낸다.
 */
export function buildMohoWatchScript(parentPid: number, intervalMs: number): string {
  const pid = Math.trunc(parentPid);
  const sleepMs = Math.max(500, Math.trunc(intervalMs));
  const loopBody = [
    `if (-not (Get-Process -Id ${pid})) { exit }`,
    `[Console]::Out.WriteLine('${MOHO_FRAME_BEGIN}')`,
    'Get-Process -Name *moho* | ForEach-Object { [Console]::Out.WriteLine($_.MainWindowTitle) }',
    `[Console]::Out.WriteLine('${MOHO_FRAME_END}')`,
    '[Console]::Out.Flush()',
    `Start-Sleep -Milliseconds ${sleepMs}`,
  ].join('; ');
  return `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='SilentlyContinue'; while ($true) { ${loopBody} }`;
}

export function mohoWatchArgs(parentPid: number, intervalMs: number): string[] {
  return ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', buildMohoWatchScript(parentPid, intervalMs)];
}

/** 표준 출력 조각을 받아 BEGIN~END 한 바퀴가 끝날 때마다 그 사이 줄들을 넘긴다. 줄이 조각 경계에서 잘려도 된다. */
export function createMohoFrameReader(onFrame: (titleLines: string[]) => void): { push: (chunk: string) => void } {
  let pending = '';
  let frame: string[] | null = null;
  return {
    push(chunk: string) {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line === MOHO_FRAME_BEGIN) { frame = []; continue; }
        if (line === MOHO_FRAME_END) {
          if (frame) onFrame(frame);
          frame = null;
          continue;
        }
        if (frame) frame.push(line);
      }
    },
  };
}

export interface MohoTitlePolling {
  /** 감시 중단 — 띄워 둔 PowerShell 도 끝낸다. */
  stop: () => void;
  /** dedup 기억 리셋 + 마지막으로 본 창 목록을 바로 다시 알린다 — 파일 집합이 같아도 onChange 가 다시 뜬다. */
  reset: () => void;
}

interface WatchProcess {
  stdout: { setEncoding: (enc: BufferEncoding) => void; on: (event: 'data', cb: (d: string) => void) => void } | null;
  stderr?: { on: (event: 'data', cb: (d: unknown) => void) => void } | null;
  on: (event: 'error' | 'exit', cb: () => void) => void;
  kill: () => void;
}

export interface MohoTitlePollingOptions {
  intervalMs?: number;
  onChange: (basenames: string[]) => void;
  /** 테스트용 — 기본은 PowerShell 을 띄운다. */
  spawnWatcher?: (args: string[]) => WatchProcess;
  platform?: NodeJS.Platform;
  parentPid?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** 감시 시작. 창 basename 집합이 달라질 때만 onChange. 감시 프로세스가 죽거나 멈추면 잠시 뒤 다시 띄운다. */
export function startMohoTitlePolling(opts: MohoTitlePollingOptions): MohoTitlePolling {
  const intervalMs = opts.intervalMs ?? 4000;
  const platform = opts.platform ?? process.platform;
  const parentPid = opts.parentPid ?? process.pid;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as NodeJS.Timeout));
  const spawnWatcher = opts.spawnWatcher
    ?? ((args: string[]) => spawn('powershell.exe', args, { windowsHide: true }) as unknown as WatchProcess);
  // 한 바퀴가 이만큼 안 오면 멈춘 것으로 보고 다시 띄운다.
  const stallMs = Math.max(intervalMs * 3, 15_000);
  const gate = createDedupGate();
  let stopped = false;
  let child: WatchProcess | null = null;
  let watchdog: unknown = null;
  let restartTimer: unknown = null;
  let failures = 0;
  let lastBasenames: string[] | null = null;

  const emit = (basenames: string[]) => {
    const key = [...basenames].sort().join('|');
    if (gate.shouldEmit(key)) opts.onChange(basenames);
  };
  const armWatchdog = () => {
    if (watchdog !== null) clearTimer(watchdog);
    watchdog = setTimer(() => {
      watchdog = null;
      const stalled = child;
      child = null;
      try { stalled?.kill(); } catch { /* noop */ }
      scheduleRestart();
    }, stallMs);
  };
  const scheduleRestart = () => {
    if (stopped || restartTimer !== null) return;
    failures += 1;
    const delay = Math.min(60_000, 2_000 * 2 ** Math.min(failures - 1, 5));
    restartTimer = setTimer(() => { restartTimer = null; launch(); }, delay);
  };
  function launch() {
    if (stopped) return;
    let proc: WatchProcess;
    try {
      proc = spawnWatcher(mohoWatchArgs(parentPid, intervalMs));
    } catch {
      scheduleRestart();
      return;
    }
    child = proc;
    const reader = createMohoFrameReader((lines) => {
      if (stopped || child !== proc) return;
      failures = 0;
      armWatchdog();
      lastBasenames = parseMohoTitles(lines);
      emit(lastBasenames);
    });
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (d) => reader.push(String(d)));
    proc.stderr?.on('data', () => { /* drain: 파이프 채움 방지 */ });
    const onGone = () => {
      if (child !== proc) return;
      child = null;
      if (watchdog !== null) { clearTimer(watchdog); watchdog = null; }
      scheduleRestart();
    };
    proc.on('error', onGone);
    proc.on('exit', onGone);
    armWatchdog();
  }

  if (platform === 'win32') launch();

  return {
    stop: () => {
      stopped = true;
      if (watchdog !== null) { clearTimer(watchdog); watchdog = null; }
      if (restartTimer !== null) { clearTimer(restartTimer); restartTimer = null; }
      const running = child;
      child = null;
      try { running?.kill(); } catch { /* noop */ }
    },
    reset: () => {
      gate.reset();
      if (!stopped && lastBasenames) emit(lastBasenames);
    },
  };
}
