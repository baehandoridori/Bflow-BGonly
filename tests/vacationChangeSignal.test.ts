/**
 * 휴가 변경 신호 배선 테스트
 *
 * 문제: 휴가 데이터는 화면을 열 때 한 번만 읽었다(휴가 탭 5분 캐시, 메인 캘린더는 앱 시작 시 한 번).
 * B flow 안에서 등록한 건 스스로 새로고침하지만, 슬랙(워크플로·/휴가)이나 다른 사람이 등록한 건
 * 따라오지 않았다. 휴가 시스템이 즉시 처리하게 되면서(2026-09 이관) 이 지연이 눈에 띄었다.
 *
 * 해결: 팀 할 일·간트와 같은 패턴. 휴가 시스템 DB 트리거가 bflow-realtime 채널로 내용 없는
 * 'vacation-changed' 신호를 보내고(휴가 시스템 레포 C27), main 이 모든 창에 퍼뜨리면
 * 휴가를 보여주는 화면이 휴가 API 로 다시 읽는다.
 *
 * 한 곳만 빠져도 그 화면만 조용히 옛 데이터로 남는다 — 그래서 사슬의 고리마다 고정한다.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

let nonce = 0;
const read = (p: string) => readFileSync(p, 'utf8');

// ── ① realtime: 신호 수신 + 재연결 따라잡기 ──────────────────────────
test('realtime: vacation-changed 신호를 onVacationChange 로 넘기고, 재연결 첫 join 에서도 한 번 부른다', async () => {
  const statusCallbacks: Array<(status: string) => void> = [];
  const broadcastHandlers = new Map<string, () => void>();
  const key = `__vacationRealtime${nonce++}`;
  (globalThis as Record<string, unknown>)[key] = {
    channel: () => ({
      on(type: string, filter: { event?: string }, handler: () => void) {
        if (type === 'broadcast' && filter.event) broadcastHandlers.set(filter.event, handler);
        return this;
      },
      subscribe(callback?: (status: string) => void) { if (callback) statusCallbacks.push(callback); return this; },
      presenceState: () => ({}),
      track: async () => 'ok',
    }),
    removeChannel: () => {},
  };
  try {
    const result = await build({
      stdin: { contents: "export * from './electron/realtime.ts';", resolveDir: process.cwd() },
      bundle: true, format: 'esm', platform: 'node', write: false,
      plugins: [{ name: 'realtime-stubs', setup(builder) {
        builder.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'db', namespace: 'rt-stub' }));
        builder.onResolve({ filter: /^\.\/retry-utils$/ }, () => ({ path: 'retry', namespace: 'rt-stub' }));
        builder.onLoad({ filter: /./, namespace: 'rt-stub' }, ({ path }) => ({ contents: path === 'db'
          ? `export const supabase = globalThis.${key};`
          : 'export const createRetryManager = () => ({ schedule: () => true, reset() {}, clear() {} });' }));
      } }],
    });
    const mod = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${nonce++}`);
    const events: string[] = [];
    const noOp = () => {};
    const cleanup = mod.setupRealtimeSubscription({
      onSceneChange: noOp, onCommentChange: noOp, onRevisionChange: noOp, onEpisodeChange: noOp, onPartChange: noOp,
      onCalendarChange: noOp, onActivityInsert: noOp,
      onStatusChange: (status: string, metadata: { reconnected: boolean }) => { events.push(`${status}:${metadata.reconnected}`); },
      onVacationChange: () => { events.push('vacation'); },
    });
    const status = statusCallbacks[0];
    status('SUBSCRIBED');
    assert.deepEqual(events, ['SUBSCRIBED:false'], '첫 연결에서는 보내지 않는다 (화면이 마운트 때 이미 읽는다)');
    status('CHANNEL_ERROR');
    status('SUBSCRIBED');
    assert.deepEqual(events.slice(1), ['CHANNEL_ERROR:false', 'SUBSCRIBED:true', 'vacation'],
      '끊겼다 다시 붙은 첫 join 에서 한 번 — 끊긴 동안 온 신호는 다시 오지 않는다');

    const handler = broadcastHandlers.get('vacation-changed');
    assert.ok(handler, "'vacation-changed' broadcast 를 구독한다 (휴가 시스템 DB 트리거와 같은 이벤트 이름)");
    handler!();
    assert.equal(events.at(-1), 'vacation', 'DB 트리거 신호가 onVacationChange 로 간다');
    cleanup();
  } finally {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

// ── ② main → 모든 창 ─────────────────────────────────────────────────
test('main: 신호를 모든 창에 vacation:changed 로 퍼뜨린다 (위젯 팝업 창 포함)', () => {
  assert.match(read('electron/main.ts'),
    /onVacationChange: \(\) => broadcastToAllWindows\('vacation:changed', \{\}\),/);
});

// ── ③ preload · 타입 · 미리보기 모의 ─────────────────────────────────
test('preload·타입·미리보기: onVacationChanged 구독과 해제가 짝으로 있다', () => {
  const preload = read('electron/preload.ts');
  assert.match(preload, /onVacationChanged: \(callback: \(\) => void\) => \{/);
  assert.match(preload, /ipcRenderer\.on\('vacation:changed', listener\)/);
  assert.match(preload, /ipcRenderer\.removeListener\('vacation:changed', listener\)/);
  assert.match(read('src/types/index.ts'), /onVacationChanged: \(callback: \(\) => void\) => \(\) => void;/);
  assert.match(read('src/mocks/devElectronAPI.ts'), /onVacationChanged: /);
});

// ── ④ 훅 ─────────────────────────────────────────────────────────────
test('훅: 300ms 디바운스로 몰아서 한 번만 부르고, 언마운트 때 타이머와 구독을 둘 다 푼다', () => {
  const hook = read('src/hooks/useOnVacationChange.ts');
  assert.match(hook, /export const VACATION_SIGNAL_DEBOUNCE_MS = 300;/);
  assert.match(hook, /window\.electronAPI\?\.onVacationChanged/);
  assert.match(hook, /if \(timer\) clearTimeout\(timer\);\s*unsubscribe\(\);/);
});

// ── ⑤ 휴가를 보여주는 모든 화면 ──────────────────────────────────────
const CONSUMERS = [
  'src/views/VacationView.tsx',
  'src/views/CalendarView.tsx',
  'src/views/ScheduleView.tsx',
  'src/components/widgets/CalendarWidget.tsx',
  'src/components/widgets/VacationWidget.tsx',
  'src/components/settings/ProfileSection.tsx',
];

for (const file of CONSUMERS) {
  test(`화면: ${file} 가 휴가 변경 신호에 반응한다`, () => {
    const src = read(file);
    assert.match(src, /import \{ useOnVacationChange \} from '@\/hooks\/useOnVacationChange';/);
    assert.match(src, /useOnVacationChange\(/);
  });
}

test('화면: 휴가 데이터를 읽는 파일은 전부 위 목록에 있다 (새 화면이 신호를 빠뜨리지 않게)', () => {
  const readers: string[] = [];
  for (const rel of readdirSync('src', { recursive: true }) as string[]) {
    const path = join('src', rel).replaceAll('\\', '/');
    if (!/\.(ts|tsx)$/.test(path)) continue;
    if (path === 'src/services/vacationService.ts' || path.startsWith('src/mocks/')) continue;
    if (/\b(fetchAllVacationEvents|fetchVacationStatus|fetchVacationLog)\(/.test(read(path))) readers.push(path);
  }
  assert.deepEqual(readers.sort(), [...CONSUMERS].sort(),
    '휴가를 읽는 화면이 늘었으면 useOnVacationChange 를 붙이고 이 목록에 추가할 것');
});
