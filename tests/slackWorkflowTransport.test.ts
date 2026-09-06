import assert from 'node:assert/strict';
import test from 'node:test';
import { SlackWorkflowCancelledError, SlackWorkflowTransport } from '../electron/slackWorkflowTransport.ts';

const URL_A = 'https://example.invalid/workflow-a';
const URL_B = 'https://example.invalid/workflow-b';

function clock(start = 0) {
  let now = start;
  const waits: Array<{ until: number; resolve: () => void }> = [];
  return {
    now: () => now,
    sleep: (milliseconds: number) => new Promise<void>((resolve) => { waits.push({ until: now + milliseconds, resolve }); }),
    advance(milliseconds: number) {
      now += milliseconds;
      for (let i = waits.length - 1; i >= 0; --i) {
        if (waits[i].until <= now) waits.splice(i, 1)[0].resolve();
      }
    },
    waits,
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const ok = () => new Response('ok', { status: 200 });

test('same URL requests are serial and start at least 1100ms apart', async () => {
  const time = clock();
  const calls: Array<{ at: number; body: string }> = [];
  let finishFirst!: () => void;
  const transport = new SlackWorkflowTransport({ ...time, fetch: async (_url, init) => {
    calls.push({ at: time.now(), body: String(init.body) });
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.method, 'POST');
    if (calls.length === 1) await new Promise<void>((resolve) => { finishFirst = resolve; });
    return ok();
  } });
  const firstPayload = { text: 'first' };
  const all = Promise.all([transport.send(URL_A, firstPayload), transport.send(URL_A, { text: 'second' }), transport.send(URL_A, { text: 'third' })]);
  firstPayload.text = 'changed after enqueue';
  await flush();
  time.advance(500);
  await flush();
  assert.equal(calls.length, 1, 'the next request cannot overlap an unfinished fetch');
  finishFirst();
  await flush();
  time.advance(599);
  await flush();
  assert.equal(calls.length, 1);
  time.advance(1);
  await flush();
  time.advance(1100);
  await all;
  assert.deepEqual(calls.map((call) => call.at), [0, 1100, 2200]);
  assert.equal(calls[0].body, '{"text":"first"}', 'queued payload is captured at send time');
});

test('different URLs can send independently', async () => {
  const time = clock();
  const starts: Array<[string, number]> = [];
  const transport = new SlackWorkflowTransport({ ...time, fetch: async (url) => { starts.push([url, time.now()]); return ok(); } });
  const all = Promise.all([transport.send(URL_A, {}), transport.send(URL_A, {}), transport.send(URL_B, {})]);
  await flush();
  assert.deepEqual(starts, [[URL_A, 0], [URL_B, 0]]);
  time.advance(1100);
  await all;
  assert.deepEqual(starts.at(-1), [URL_A, 1100]);
});

test('429 Retry-After seconds delay is respected before retrying', async () => {
  const time = clock();
  const starts: number[] = [];
  const transport = new SlackWorkflowTransport({ ...time, fetch: async () => {
    starts.push(time.now());
    return starts.length === 1 ? new Response('limited', { status: 429, headers: { 'Retry-After': '2' } }) : ok();
  } });
  const sent = transport.send(URL_A, {});
  await flush();
  time.advance(1999);
  await flush();
  assert.equal(starts.length, 1);
  time.advance(1);
  assert.deepEqual(await sent, { ok: true });
  assert.deepEqual(starts, [0, 2000]);
});

test('429 Retry-After HTTP-date is respected', async () => {
  const start = Date.parse('2026-09-07T00:00:00Z');
  const time = clock(start);
  const starts: number[] = [];
  const transport = new SlackWorkflowTransport({ ...time, fetch: async () => {
    starts.push(time.now());
    return starts.length === 1 ? new Response('limited', { status: 429, headers: { 'Retry-After': new Date(start + 5000).toUTCString() } }) : ok();
  } });
  const sent = transport.send(URL_A, {});
  await flush();
  time.advance(5000);
  await sent;
  assert.deepEqual(starts, [start, start + 5000]);
});

test('429 without Retry-After retries at most twice and preserves the URL interval', async () => {
  const time = clock();
  const starts: number[] = [];
  const transport = new SlackWorkflowTransport({ ...time, fetch: async () => {
    starts.push(time.now());
    return new Response('limited', { status: 429 });
  } });
  const rejected = assert.rejects(transport.send(URL_A, {}), /429.*retry limit/);
  await flush();
  time.advance(1100);
  await flush();
  time.advance(1100);
  await rejected;
  assert.deepEqual(starts, [0, 1100, 2200]);
});

test('Retry-After over 30 seconds fails without an unbounded wait or early next send', async () => {
  const time = clock();
  let fetches = 0;
  const transport = new SlackWorkflowTransport({ ...time, fetch: async () => {
    ++fetches;
    return new Response('limited', { status: 429, headers: { 'Retry-After': '31' } });
  } });
  await assert.rejects(transport.send(URL_A, {}), /delay exceeds 30000ms/);
  await assert.rejects(transport.send(URL_A, {}), /delay exceeds 30000ms/);
  assert.equal(time.waits.length, 0);
  assert.equal(fetches, 1);
});

test('HTTP and network failures are not retried and do not poison the queue', async () => {
  for (const failure of ['http', 'network']) {
    const time = clock();
    let fetches = 0;
    const transport = new SlackWorkflowTransport({ ...time, fetch: async () => {
      ++fetches;
      if (fetches === 1) {
        if (failure === 'network') throw new Error('network failure');
        return new Response('failed', { status: 500 });
      }
      return ok();
    } });
    const failed = assert.rejects(transport.send(URL_A, {}), failure === 'network' ? /network failure/ : /500/);
    const next = transport.send(URL_A, {});
    await failed;
    await flush();
    time.advance(1100);
    assert.deepEqual(await next, { ok: true });
    assert.equal(fetches, 2);
  }
});

test('a session change while queued cancels only that request before fetch', async () => {
  const time = clock();
  let current = true;
  const bodies: string[] = [];
  let finishFirst!: () => void;
  const transport = new SlackWorkflowTransport({ ...time, fetch: async (_url, init) => {
    bodies.push(String(init.body));
    if (bodies.length === 1) await new Promise<void>((resolve) => { finishFirst = resolve; });
    return ok();
  } });
  const first = transport.send(URL_A, { text: 'first' });
  const cancelled = assert.rejects(transport.send(URL_A, { text: 'cancelled' }, { isCurrent: () => current }), SlackWorkflowCancelledError);
  const next = transport.send(URL_A, { text: 'next' });
  await flush();
  current = false;
  finishFirst();
  await first;
  await cancelled;
  await flush();
  time.advance(1100);
  await next;
  assert.deepEqual(bodies, ['{"text":"first"}', '{"text":"next"}']);
});

test('a session change during 429 delay prevents the retry', async () => {
  const time = clock();
  let current = true;
  let fetches = 0;
  const transport = new SlackWorkflowTransport({ ...time, fetch: async () => {
    ++fetches;
    return new Response('limited', { status: 429, headers: { 'Retry-After': '2' } });
  } });
  const cancelled = assert.rejects(transport.send(URL_A, {}, { isCurrent: () => current }), SlackWorkflowCancelledError);
  await flush();
  current = false;
  time.advance(2000);
  await cancelled;
  assert.equal(fetches, 1);
});

test('network timeout aborts the fetch without retrying', async () => {
  let fetches = 0;
  const transport = new SlackWorkflowTransport({ fetch: async (_url, init) => {
    ++fetches;
    return new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    });
  } });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(transport.send(URL_A, {}, { timeoutMs: 5 }), { name: 'TimeoutError' });
    assert.equal(fetches, 1);
  } finally { clearTimeout(keepAlive); }
});
