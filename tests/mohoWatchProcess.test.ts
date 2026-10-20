import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

// mohoWindowPoller 는 확장자 없는 상대 import 를 써서 esbuild 로 묶어 불러온다.
const require = createRequire(import.meta.url);
const bundle = build({
  entryPoints: ['electron/presence/mohoWindowPoller.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['child_process'],
});
async function load() {
  const module = { exports: {} as Record<string, any> };
  new Function('require', 'module', 'exports', (await bundle).outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}

function fakeWatcher() {
  const handlers: Record<string, Array<(d?: unknown) => void>> = {};
  let killed = false;
  return {
    proc: {
      stdout: { setEncoding() {}, on: (_e: 'data', cb: (d: string) => void) => { (handlers.data ??= []).push(cb as never); } },
      stderr: { on() {} },
      on: (event: 'error' | 'exit', cb: () => void) => { (handlers[event] ??= []).push(cb); },
      kill: () => { killed = true; },
    },
    write: (text: string) => handlers.data?.forEach((cb) => cb(text)),
    exit: () => handlers.exit?.forEach((cb) => cb()),
    killed: () => killed,
  };
}

function timers() {
  let now = 0;
  const list = new Map<number, { at: number; fn: () => void }>();
  let id = 1;
  return {
    setTimer: (fn: () => void, ms: number) => { const k = id++; list.set(k, { at: now + ms, fn }); return k; },
    clearTimer: (k: unknown) => { list.delete(k as number); },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...list.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        list.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}

test('감시 스크립트는 한 번 띄워 두고 바퀴마다 표시를 찍으며, B flow 가 없으면 스스로 끝난다', async () => {
  const m = await load();
  const script = m.buildMohoWatchScript(4321, 4000);
  assert.match(script, /^\[Console\]::OutputEncoding=\[Text\.Encoding\]::UTF8; /, '한글 파일명이 깨지지 않게 UTF-8 로 찍는다');
  assert.match(script, /while \(\$true\) \{ /, '한 프로세스 안에서 돈다');
  assert.match(script, /if \(-not \(Get-Process -Id 4321\)\) \{ exit \}/, 'B flow 가 사라지면 끝난다');
  assert.match(script, /Start-Sleep -Milliseconds 4000/);
  assert.ok(script.includes(m.MOHO_FRAME_BEGIN) && script.includes(m.MOHO_FRAME_END));
  assert.doesNotMatch(script, /"/, '명령줄로 넘길 때 따옴표가 깨지지 않게 큰따옴표를 쓰지 않는다');
});

test('출력 조각이 줄 중간에서 잘려도 한 바퀴씩 묶어 읽는다', async () => {
  const m = await load();
  const frames: string[][] = [];
  const reader = m.createMohoFrameReader((lines: string[]) => frames.push(lines));
  reader.push(`${m.MOHO_FRAME_BEGIN}\r\nb030.moho - Mo`);
  reader.push(`ho Pro\r\n${m.MOHO_FRAME_END}\r\n${m.MOHO_FRAME_BEGIN}\r\n`);
  reader.push(`${m.MOHO_FRAME_END}\r\n`);
  assert.deepEqual(frames, [['b030.moho - Moho Pro'], []]);
});

test('PowerShell 은 한 번만 띄우고, 창 목록이 바뀔 때만 알린다', async () => {
  const m = await load();
  const t = timers();
  const spawned: ReturnType<typeof fakeWatcher>[] = [];
  const seen: string[][] = [];
  const polling = m.startMohoTitlePolling({
    onChange: (names: string[]) => seen.push(names),
    spawnWatcher: () => { const w = fakeWatcher(); spawned.push(w); return w.proc; },
    platform: 'win32', parentPid: 1, setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  const frame = (titles: string[]) => spawned[0].write(`${m.MOHO_FRAME_BEGIN}\n${titles.map((x) => `${x}\n`).join('')}${m.MOHO_FRAME_END}\n`);
  frame([]);
  frame([]);
  for (let i = 0; i < 15; i++) {
    t.advance(4_000);
    frame(['b030.moho - Moho Pro']);
  }
  assert.equal(spawned.length, 1, '1분 동안 바퀴마다 새로 띄우지 않는다');
  assert.deepEqual(seen, [[], ['b030.moho']]);
  polling.reset();
  assert.deepEqual(seen.at(-1), ['b030.moho'], 'reset 은 마지막으로 본 목록을 바로 다시 알린다');
  polling.stop();
  assert.equal(spawned[0].killed(), true, '멈추면 띄워 둔 PowerShell 도 끝낸다');
});

test('감시 프로세스가 죽거나 멈추면 잠시 뒤 다시 띄우고, 멈춘 뒤에는 다시 띄우지 않는다', async () => {
  const m = await load();
  const t = timers();
  const spawned: ReturnType<typeof fakeWatcher>[] = [];
  const polling = m.startMohoTitlePolling({
    onChange: () => {},
    spawnWatcher: () => { const w = fakeWatcher(); spawned.push(w); return w.proc; },
    platform: 'win32', parentPid: 1, setTimer: t.setTimer, clearTimer: t.clearTimer,
  });
  spawned[0].exit();
  t.advance(2_000);
  assert.equal(spawned.length, 2, '죽으면 2초 뒤 다시 띄운다');
  t.advance(15_000);
  assert.equal(spawned[1].killed(), true, '한 바퀴도 안 오면 멈춘 것으로 보고 끝낸다');
  t.advance(4_000);
  assert.equal(spawned.length, 3, '연달아 실패하면 기다림을 늘려 다시 띄운다');
  polling.stop();
  spawned[2].exit();
  t.advance(120_000);
  assert.equal(spawned.length, 3);
});

test('Windows 가 아니면 아무것도 띄우지 않는다', async () => {
  const m = await load();
  let count = 0;
  const polling = m.startMohoTitlePolling({ onChange: () => {}, spawnWatcher: () => { count += 1; return fakeWatcher().proc; }, platform: 'darwin' });
  polling.reset();
  polling.stop();
  assert.equal(count, 0);
});
