import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

// BAE경 메인 → OpenAI 통신 (electron/bae/openaiClient.ts). 가짜 OpenAI 를 이 시험 안에서 127.0.0.1 에만 띄운다.
let nonce = 0;
async function load(entry: string) {
  const result = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}#${nonce++}`);
}
const C = await load('electron/bae/openaiClient.ts');
const FAKE_KEY = 'sk-test-local-only-0123456789abcdef';
const KEY_TAIL = '0123456789abcdef';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = () => new Promise((r) => setImmediate(r));

type Call = { path: string; auth: string; body: Buffer; contentType: string };
type Handler = (req: http.IncomingMessage, res: http.ServerResponse, n: number, call: Call) => void | Promise<void>;

async function fakeOpenAi(handler: Handler) {
  const calls: Call[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
    const call = { path: req.url ?? '', auth: String(req.headers.authorization ?? ''), body: Buffer.concat(chunks), contentType: String(req.headers['content-type'] ?? '') };
    calls.push(call);
    try { await handler(req, res, calls.length, call); } catch { res.destroy(); }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}/v1`, calls,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body));
};
/** 오류에 가짜 키 글자가 한 글자도 없는지 (글 · raw · 직렬화 · 스택). */
function noKey(e: unknown) {
  const err = e as Error & { raw?: string };
  for (const s of [err.message, err.raw ?? '', JSON.stringify(err), String(err.stack ?? '')]) assert.ok(!s.includes(KEY_TAIL), `key leaked: ${s}`);
}
async function timed<T>(p: Promise<T>) { const t0 = Date.now(); try { return { value: await p, ms: Date.now() - t0, error: null as unknown }; } catch (error) { return { value: null, ms: Date.now() - t0, error }; } }

const ORDER = { output: [{ type: 'message', content: [{ type: 'output_text', text: '{"prompt":"a street","summary_ko":"길"}' }] }], usage: { input_tokens: 1000, output_tokens: 300 } };
const BODY = { model: 'gpt-6.1-sol', input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }], store: false };

// ---------------------------------------------------------------- 주문서

test('PD: a normal answer gives the json, the text, the usage and the request id; the key rides only in the header', async () => {
  const s = await fakeOpenAi((_req, res) => json(res, 200, ORDER, { 'x-request-id': 'req_abc123' }));
  try {
    const r = await C.postResponses({ apiBase: s.base + '/', key: FAKE_KEY, body: BODY });
    assert.equal(r.outputText, '{"prompt":"a street","summary_ko":"길"}');
    assert.deepEqual(r.usage, { input_tokens: 1000, output_tokens: 300 });
    assert.equal(r.requestId, 'req_abc123');
    assert.deepEqual(r.json, ORDER);
    assert.equal(s.calls[0].path, '/v1/responses');
    assert.equal(s.calls[0].auth, 'Bearer ' + FAKE_KEY);
    assert.deepEqual(JSON.parse(s.calls[0].body.toString('utf8')), BODY);
    assert.ok(!s.calls[0].body.toString('utf8').includes(KEY_TAIL), 'the key is not in the body');
  } finally { await s.close(); }
});

test('PD: 401 · 429 · 503 become the HTML sentences, a key echoed by the server is masked, and nothing is sent twice', async () => {
  const s = await fakeOpenAi((req, res) => {
    const st = Number(new URL(req.url ?? '', 'http://x').searchParams.get('st') ?? 0);
    if (st === 401) return json(res, 401, { error: { message: `Incorrect API key provided: ${String(req.headers.authorization).slice(7)}. Bearer ${FAKE_KEY}` } });
    if (st === 429) return json(res, 429, { error: { message: 'Rate limit reached' } });
    return json(res, 503, { error: { message: 'The server is overloaded' } });
  });
  try {
    await assert.rejects(C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: BODY, fetch: (u: string, i: RequestInit) => fetch(u + '?st=401', i) }), (e: Error & { status: number; code: string }) => {
      assert.equal(e.status, 401); assert.equal(e.code, 'BAE_HTTP');
      assert.match(e.message, /^API 키가 맞지 않아요\. 설정에서 키를 다시 확인해 주세요\.\n\(401\) Incorrect API key provided/);
      noKey(e); return true;
    });
    await assert.rejects(C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: BODY, fetch: (u: string, i: RequestInit) => fetch(u + '?st=429', i) }), (e: Error & { status: number }) => {
      assert.equal(e.status, 429); assert.match(e.message, /^사용 한도에 걸렸거나 요청이 너무 많아요/); assert.match(e.message, /\(429\) Rate limit reached$/); return true;
    });
    const before = s.calls.length;
    await assert.rejects(C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: BODY, fetch: (u: string, i: RequestInit) => fetch(u + '?st=503', i) }), (e: Error & { status: number }) => {
      assert.equal(e.status, 503); assert.match(e.message, /^OpenAI 쪽 문제예요\. 잠시 후 다시 해보세요\./); return true;
    });
    await sleep(100);
    assert.equal(s.calls.length - before, 1, '503 is not sent again (HTML does not either)');
  } finally { await s.close(); }
});

test('PD: a refused connection and a cut answer each give their own sentence; the browser line of NET_ERR is gone', async () => {
  const s = await fakeOpenAi((req, res, n) => {
    if (n === 1) { req.socket.destroy(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"output":[{"type":"mess');
    setTimeout(() => res.destroy(), 30);
  });
  try {
    await assert.rejects(C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: BODY }), (e: Error & { code: string }) => {
      assert.equal(e.code, 'BAE_NET'); assert.equal(e.message, 'OpenAI에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
      assert.ok(!e.message.includes('브라우저')); noKey(e); return true;
    });
    await assert.rejects(C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: BODY }), (e: Error & { code: string }) => {
      assert.equal(e.code, 'BAE_DROP'); assert.equal(e.message, C.BAE_DROP_ERR); noKey(e); return true;
    });
    // nothing listens here at all
    const dead = await fakeOpenAi(() => undefined); const deadBase = dead.base; await dead.close();
    await assert.rejects(C.postResponses({ apiBase: deadBase, key: FAKE_KEY, body: BODY }), (e: Error & { code: string }) => { assert.equal(e.code, 'BAE_NET'); return true; });
  } finally { await s.close(); }
});

test('PD: headers then silence, or no headers at all, stop on time instead of hanging', async () => {
  const s = await fakeOpenAi((req, res) => {
    if ((req.url ?? '').includes('nohead')) return; // 아무것도 보내지 않음
    res.writeHead(200, { 'Content-Type': 'application/json', 'x-request-id': 'req_stall' }); res.flushHeaders(); // 머리글만
  });
  try {
    const a = await timed(C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: BODY, idleMs: 300 }));
    assert.equal((a.error as { code: string }).code, 'BAE_STALL');
    assert.equal((a.error as Error).message, '응답이 한동안 오지 않아서 멈췄어요. 다시 시도해 주세요.');
    assert.equal((a.error as { requestId: string }).requestId, 'req_stall', 'the request id survives, for the ledger');
    assert.ok(a.ms >= 250 && a.ms < 3000, `stopped after ${a.ms}ms`);
    const b = await timed(C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: BODY, firstByteMs: 300, fetch: (u: string, i: RequestInit) => fetch(u + '?nohead', i) }));
    assert.equal((b.error as { code: string }).code, 'BAE_STALL');
    assert.ok(b.ms < 3000, `stopped after ${b.ms}ms`);
    noKey(a.error); noKey(b.error);
  } finally { await s.close(); }
});

test('PD: stopping (AbortController) ends at once with an AbortError; an already stopped call sends nothing', async () => {
  const s = await fakeOpenAi((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders(); });
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 100);
    const r = await timed(C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: BODY, signal: ctl.signal }));
    assert.equal((r.error as Error).name, 'AbortError'); assert.ok(r.ms < 2000, `${r.ms}ms`);
    const ctl2 = new AbortController(); ctl2.abort();
    const before = s.calls.length;
    await assert.rejects(C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: BODY, signal: ctl2.signal }), { name: 'AbortError' });
    // a stop while waiting for the first byte
    const s2 = await fakeOpenAi(() => undefined);
    const ctl3 = new AbortController(); setTimeout(() => ctl3.abort(), 80);
    const r3 = await timed(C.postResponses({ apiBase: s2.base, key: FAKE_KEY, body: BODY, signal: ctl3.signal }));
    assert.equal((r3.error as Error).name, 'AbortError'); assert.ok(r3.ms < 2000);
    await s2.close();
    assert.equal(s.calls.length, before);
  } finally { await s.close(); }
});

test('PD: a model that does not take developer messages gets the fallback body once (HTML callPD)', async () => {
  const s = await fakeOpenAi((_req, res, n) => {
    if (n === 1) return json(res, 400, { error: { message: "Unsupported value: 'developer' role is not supported with this model." } });
    return json(res, 200, ORDER);
  });
  try {
    const fallback = { ...BODY, input: [{ role: 'user', content: [{ type: 'input_text', text: 'notes first' }] }] };
    const r = await C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: BODY, fallbackBody: fallback });
    assert.equal(s.calls.length, 2);
    assert.deepEqual(JSON.parse(s.calls[1].body.toString('utf8')), fallback);
    assert.ok(r.outputText);
  } finally { await s.close(); }
  // without a fallback body the 400 goes straight back
  const s2 = await fakeOpenAi((_req, res) => json(res, 400, { error: { message: "Unsupported value: 'developer' role" } }));
  try {
    await assert.rejects(C.postResponses({ apiBase: s2.base, key: FAKE_KEY, body: BODY }), (e: Error & { status: number }) => e.status === 400);
    assert.equal(s2.calls.length, 1);
  } finally { await s2.close(); }
});

test('PD: a refusal and an empty answer use the HTML sentences', () => {
  assert.throws(() => C.responseOutputText({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }), /^Error: PD가 이 요청을 거절했어요: no$|PD가 이 요청을 거절했어요: no/);
  assert.throws(() => C.responseOutputText({ output: [] }), /주문서 응답이 비어 있어요\. 다시 시도해 주세요\./);
  assert.equal(C.responseOutputText({ output_text: 'x' }), 'x');
});

test('PD: a streamed answer (if the body asks for one) is read the same way, event by event', async () => {
  const s = await fakeOpenAi(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const evs = [{ type: 'response.created' }, { type: 'response.output_text.delta', delta: '{"prompt"' }, { type: 'response.completed', response: { ...ORDER, status: 'completed' } }];
    const text = evs.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
    for (let i = 0; i < text.length; i += 7) { res.write(text.slice(i, i + 7)); await tick(); }
    res.end();
  });
  try {
    const seen: string[] = [];
    const r = await C.postResponses({ apiBase: s.base, key: FAKE_KEY, body: { ...BODY, stream: true }, onEvent: (ev: { type: string }) => seen.push(ev.type) });
    assert.deepEqual(seen, ['response.created', 'response.output_text.delta', 'response.completed']);
    assert.deepEqual(r.usage, ORDER.usage); assert.ok(r.outputText);
  } finally { await s.close(); }
});

test('the key goes only to https or to this PC, and a key that cannot be a header is refused before anything is sent', async () => {
  let sent = 0; const f = async () => { sent++; return new Response('{}'); };
  for (const apiBase of ['http://example.com/v1', 'ftp://127.0.0.1/v1', 'https://user:pw@api.openai.com/v1', 'not a url', 'https://api.openai.com/v1?x=1']) {
    await assert.rejects(C.postResponses({ apiBase, key: FAKE_KEY, body: BODY, fetch: f }), (e: Error & { code: string }) => { assert.equal(e.code, 'BAE_INPUT'); assert.equal(e.message, 'API 주소는 https:// 로 시작하는 주소예요.'); return true; });
  }
  for (const key of ['', 'sk-test-local-only\r\nX-Evil: 1' + KEY_TAIL, null]) {
    await assert.rejects(C.postImageEdit({ apiBase: 'https://api.openai.com/v1', key, fields: [], fetch: f }), (e: Error) => { noKey(e); assert.match(e.message, /OpenAI 키가 없어요/); return true; });
  }
  assert.equal(sent, 0);
  assert.equal(C.baeEndpoint('https://api.openai.com/v1/', '/responses'), 'https://api.openai.com/v1/responses');
});

// ---------------------------------------------------------------- 그림

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const FIELDS = [
  { name: 'model', value: 'gpt-image-2.5-sunburst' }, { name: 'prompt', value: 'a street' }, { name: 'size', value: '2048x1152' },
  { name: 'quality', value: 'high' }, { name: 'n', value: '1' }, { name: 'output_format', value: 'png' },
  { name: 'image[]', file: { bytes: PNG, filename: 'image1.png', type: 'image/png' } },
  { name: 'image[]', file: { bytes: PNG, filename: 'image2.png', type: 'image/png' } },
];
const names = (body: Buffer) => [...body.toString('latin1').matchAll(/form-data; name="([^"]+)"/g)].map((m) => m[1]);
const IMG = [randomBytes(150_000).toString('base64'), randomBytes(150_000).toString('base64'), randomBytes(200_000).toString('base64')];
const USAGE = { input_tokens: 1234, input_tokens_details: { text_tokens: 456, image_tokens: 778 }, output_tokens: 1631 };
const sse = (obj: Record<string, unknown>, nl = '\n') => `event: ${obj.type}${nl}data: ${JSON.stringify(obj)}${nl}${nl}`;

function imageServer(opts: { chunk?: number; nl?: string; fault?: (n: number) => string | null } = {}) {
  return fakeOpenAi(async (_req, res, n, call) => {
    const fault = opts.fault?.(n) ?? null;
    if (fault === '503') return json(res, 503, { error: { message: 'The server is overloaded (fake 503)' } });
    if (fault?.startsWith('400:')) return json(res, 400, { error: { message: fault.slice(4) } });
    const stream = names(call.body).includes('stream');
    if (!stream) return json(res, 200, { data: [{ b64_json: IMG[2] }], usage: USAGE }, { 'x-request-id': 'req_plain' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'x-request-id': 'req_img' });
    const chunk = opts.chunk ?? 16384;
    const write = async (text: string) => { for (let i = 0; i < text.length; i += chunk) { if (res.destroyed) return; res.write(text.slice(i, i + chunk)); await tick(); } };
    for (let i = 0; i < 2; i++) {
      if (fault === 'drop' && i === 1) { await sleep(20); res.destroy(); return; }
      if (fault === 'stall' && i === 1) return; // 조용히
      if (fault === 'error' && i === 1) { await write(sse({ type: 'error', error: { message: 'boom from the stream' } }, opts.nl)); res.end(); return; }
      await write(sse({ type: 'image_edit.partial_image', partial_image_index: i, b64_json: IMG[i] }, opts.nl));
    }
    if (fault === 'nofinal') { res.end(); return; }
    await write(sse({ type: 'image_edit.completed', b64_json: IMG[2], usage: USAGE }, opts.nl));
    res.end();
  });
}

for (const chunk of [1024, 16384, 262144]) {
  test(`image: two partials then the picture, in order, when the stream comes in ${chunk / 1024}KB pieces`, async () => {
    const s = await imageServer({ chunk, nl: chunk === 1024 ? '\r\n' : '\n' });
    try {
      const got: Array<[number, number]> = [];
      const r = await C.postImageEdit({ apiBase: s.base, key: FAKE_KEY, fields: FIELDS, onPartial: (b64: string, i: number) => got.push([i, b64.length]) });
      assert.deepEqual(got, [[0, IMG[0].length], [1, IMG[1].length]]);
      assert.equal(r.b64, IMG[2]); assert.deepEqual(r.usage, USAGE); assert.equal(r.requestId, 'req_img');
      assert.equal(r.imageField, 'image[]'); assert.equal(r.stream, true);
      assert.deepEqual(names(s.calls[0].body), ['model', 'prompt', 'size', 'quality', 'n', 'output_format', 'stream', 'partial_images', 'image[]', 'image[]']);
      assert.match(s.calls[0].body.toString('latin1'), /name="partial_images"\r\n\r\n2\r\n/);
      assert.match(s.calls[0].body.toString('latin1'), /filename="image2\.png"\r\nContent-Type: image\/png/);
      assert.equal(s.calls[0].auth, 'Bearer ' + FAKE_KEY);
    } finally { await s.close(); }
  });
}

test('image: a cut stream, a 503, a stall and a stop each end on time with their sentence, and 503 is not resent', async () => {
  const s = await imageServer({ fault: () => 'drop' });
  try {
    const got: number[] = [];
    await assert.rejects(C.postImageEdit({ apiBase: s.base, key: FAKE_KEY, fields: FIELDS, onPartial: (_b: string, i: number) => got.push(i) }), (e: Error & { code: string; requestId: string }) => {
      assert.equal(e.code, 'BAE_DROP'); assert.equal(e.requestId, 'req_img'); noKey(e); return true;
    });
    assert.deepEqual(got, [0]);
  } finally { await s.close(); }
  const s503 = await imageServer({ fault: () => '503' });
  try {
    await assert.rejects(C.postImageEdit({ apiBase: s503.base, key: FAKE_KEY, fields: FIELDS }), (e: Error & { status: number }) => { assert.equal(e.status, 503); assert.match(e.message, /^OpenAI 쪽 문제예요/); return true; });
    await sleep(100); assert.equal(s503.calls.length, 1);
  } finally { await s503.close(); }
  const stall = await imageServer({ fault: () => 'stall' });
  try {
    const r = await timed(C.postImageEdit({ apiBase: stall.base, key: FAKE_KEY, fields: FIELDS, idleMs: 300 }));
    assert.equal((r.error as { code: string }).code, 'BAE_STALL'); assert.ok(r.ms < 3000, `${r.ms}ms`);
    const ctl = new AbortController(); const parts: number[] = [];
    const a = await timed(C.postImageEdit({ apiBase: stall.base, key: FAKE_KEY, fields: FIELDS, signal: ctl.signal, onPartial: (_b: string, i: number) => { parts.push(i); setTimeout(() => ctl.abort(), 30); } }));
    assert.equal((a.error as Error).name, 'AbortError'); assert.ok(a.ms < 2000); assert.deepEqual(parts, [0]);
    assert.equal(stall.calls.length, 2, 'neither the stall nor the stop is resent');
  } finally { await stall.close(); }
});

test('image: an error event in the stream, a stream without a picture, and other 400s are not resent', async () => {
  const s = await imageServer({ fault: (n) => (n === 1 ? 'error' : n === 2 ? 'nofinal' : '400:Invalid size 9999x9999') });
  try {
    await assert.rejects(C.postImageEdit({ apiBase: s.base, key: FAKE_KEY, fields: FIELDS }), (e: Error & { code: string }) => { assert.equal(e.code, 'BAE_STREAM'); assert.match(e.message, /\(400\) boom from the stream/); return true; });
    await assert.rejects(C.postImageEdit({ apiBase: s.base, key: FAKE_KEY, fields: FIELDS }), (e: Error & { code: string }) => { assert.equal(e.code, 'BAE_EMPTY'); assert.equal(e.message, '그림 응답이 비어 있어요. 다시 시도해 주세요.'); return true; });
    await assert.rejects(C.postImageEdit({ apiBase: s.base, key: FAKE_KEY, fields: FIELDS }), (e: Error) => { assert.match(e.message, /^이 크기를 모델이 받지 않았어요/); return true; });
    assert.equal(s.calls.length, 3);
  } finally { await s.close(); }
});

test('image: if image[] is not taken, the same request goes again as image (once), and the caller learns it (HTML LS imageField)', async () => {
  const s = await imageServer({ fault: (n) => (n === 1 ? "400:Unknown parameter: 'image[]'." : null) });
  try {
    const learned: unknown[] = [];
    const r = await C.postImageEdit({ apiBase: s.base, key: FAKE_KEY, fields: FIELDS, onFieldChange: (p: unknown) => learned.push(p) });
    assert.equal(s.calls.length, 2);
    assert.deepEqual(names(s.calls[1].body).slice(-2), ['image', 'image']);
    assert.deepEqual(learned, [{ imageField: 'image', stream: true }]);
    assert.equal(r.imageField, 'image'); assert.equal(r.b64, IMG[2]);
  } finally { await s.close(); }
  // flipping happens once: a second image complaint is thrown
  const s2 = await imageServer({ fault: () => "400:Invalid image file" });
  try {
    await assert.rejects(C.postImageEdit({ apiBase: s2.base, key: FAKE_KEY, fields: FIELDS, imageField: 'image' }), (e: Error & { status: number }) => e.status === 400);
    assert.equal(s2.calls.length, 2); assert.deepEqual(names(s2.calls[1].body).slice(-1), ['image[]']);
  } finally { await s2.close(); }
});

test('image: if stream is not taken, it goes again without stream fields and reads the plain answer (HTML noStream)', async () => {
  const s = await imageServer({ fault: (n) => (n === 1 ? "400:Unknown parameter: 'partial_images'." : null) });
  try {
    const learned: unknown[] = [];
    const given = [...FIELDS.slice(0, 6), { name: 'stream', value: 'true' }, { name: 'partial_images', value: '3' }, ...FIELDS.slice(6)];
    const r = await C.postImageEdit({ apiBase: s.base, key: FAKE_KEY, fields: given, onFieldChange: (p: unknown) => learned.push(p) });
    assert.deepEqual(names(s.calls[0].body), ['model', 'prompt', 'size', 'quality', 'n', 'output_format', 'stream', 'partial_images', 'image[]', 'image[]'], 'given stream fields are put back in the HTML place');
    assert.match(s.calls[0].body.toString('latin1'), /name="partial_images"\r\n\r\n2\r\n/);
    assert.ok(!names(s.calls[1].body).includes('stream') && !names(s.calls[1].body).includes('partial_images'));
    assert.deepEqual(learned, [{ imageField: 'image[]', stream: false }]);
    assert.equal(r.stream, false); assert.equal(r.b64, IMG[2]); assert.equal(r.requestId, 'req_plain');
  } finally { await s.close(); }
});

test('the SSE splitter gives the same blocks however the text is cut', () => {
  const text = sse({ type: 'a', b64_json: 'QUJD' }) + sse({ type: 'b' }, '\r\n') + 'data: {"type":"c"}';
  const whole: string[] = []; const w = C.createSseSplitter((b: string) => whole.push(b)); w.push(text); w.end();
  for (let size = 1; size <= 9; size++) {
    const got: string[] = []; const sp = C.createSseSplitter((b: string) => got.push(b));
    for (let i = 0; i < text.length; i += size) sp.push(text.slice(i, i + size));
    sp.end();
    assert.deepEqual(got, whole, `pieces of ${size}`);
  }
  assert.equal(whole.length, 3);
  assert.equal(C.sseData(whole[1]), '{"type":"b"}');
});
