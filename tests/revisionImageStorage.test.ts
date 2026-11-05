import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// 리테이크 첨부 그림은 저장소에 올리고 줄에는 주소만 담는다(v1.149.2).
// 예전에는 등록 창의 data URL 을 image_url 에 그대로 넣어, 리테이크 목록을 받을 때마다 그림까지 받았다.

function compile(source: string) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
}

function loadFunctions(file: string, names: string[], bindings: Record<string, unknown>) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const nodes = ast.statements.filter((item) => ts.isFunctionDeclaration(item) && names.includes(item.name?.text ?? ''));
  assert.equal(nodes.length, names.length);
  const context = vm.createContext({ exports: {}, Buffer, ...bindings });
  vm.runInContext(compile(nodes.map(node => node.getText(ast)).join('\n')
    + `\nglobalThis.loaded = { ${names.join(', ')} };`), context);
  return context.loaded as Record<string, (...args: any[]) => any>;
}

const DATA_URL = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`;
const STORED = 'https://example.supabase.co/storage/v1/object/public/scene-images/revisions/rev-1/1_abc.jpg';

function addHarness(options: { uploadFails?: boolean; insertFails?: boolean } = {}) {
  const events: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const warnings: unknown[][] = [];
  const fns = loadFunctions('../electron/supabase.ts', ['prepareRevisionImage', 'addRevision'], {
    console: { warn: (...args: unknown[]) => { warnings.push(args); } },
    throwIfError: (error: unknown) => { if (error) throw error; },
    broadcastDataChange: (table: string, op: string) => { events.push(`broadcast:${table}:${op}`); },
    resolvePartUuid: async () => { throw new Error('general revisions must not resolve parts'); },
    resolveSceneUuidByNumberWithRetry: async () => { throw new Error('general revisions must not resolve scenes'); },
    storageUploadRevisionImage: async (id: string, dataUrl: string) => {
      events.push(`upload:${id}`);
      assert.equal(dataUrl, DATA_URL);
      if (options.uploadFails) throw new Error('storage unavailable');
      return STORED;
    },
    storageDeleteImage: async (url: string) => { events.push(`delete-file:${url}`); },
    supabase: { from: (table: string) => {
      assert.equal(table, 'comp_revisions');
      return { insert: async (row: Record<string, unknown>) => {
        events.push('insert'); inserted.push(row);
        return { error: options.insertFails ? new Error('insert rejected') : null };
      } };
    } },
  });
  const add = (imageUrl: string) => fns.addRevision(
    'rev-1', '', '', 1, 'open', 'normal', '설명', '', imageUrl, 'bg', 'bg',
    'user-1', '요청자', '', '2026-11-05T00:00:00.000Z', '[]', '[]', undefined,
  );
  return { add, events, inserted, warnings };
}

test('a pasted retake picture is uploaded first and only its address goes into the row', async () => {
  const h = addHarness();
  await h.add(DATA_URL);
  assert.deepEqual(h.events, ['upload:rev-1', 'insert', 'broadcast:comp_revisions:INSERT']);
  assert.equal(h.inserted[0].image_url, STORED);
});

test('an address or an empty picture is stored as is without touching storage', async () => {
  for (const value of ['', STORED]) {
    const h = addHarness();
    await h.add(value);
    assert.deepEqual(h.events, ['insert', 'broadcast:comp_revisions:INSERT']);
    assert.equal(h.inserted[0].image_url, value);
  }
});

test('when storage is down the retake is still saved, with the picture kept in the row', async () => {
  const h = addHarness({ uploadFails: true });
  await h.add(DATA_URL);
  assert.deepEqual(h.events, ['upload:rev-1', 'insert', 'broadcast:comp_revisions:INSERT']);
  assert.equal(h.inserted[0].image_url, DATA_URL);
  assert.equal(h.warnings.length, 1);
});

test('when the row is rejected the just-uploaded picture is removed and the error still surfaces', async () => {
  const h = addHarness({ insertFails: true });
  await assert.rejects(h.add(DATA_URL), /insert rejected/);
  assert.deepEqual(h.events, ['upload:rev-1', 'insert', `delete-file:${STORED}`]);
});

test('deleting a retake removes the row before the file (storage keeps files the database still points at)', async () => {
  const events: string[] = [];
  const fns = loadFunctions('../electron/supabase.ts', ['deleteRevision'], {
    console: { warn: () => {} },
    throwIfError: (error: unknown) => { if (error) throw error; },
    broadcastDataChange: (table: string, op: string) => { events.push(`broadcast:${table}:${op}`); },
    storageDeleteImage: async (url: string) => { events.push(`delete-file:${url}`); },
    supabase: { from: (table: string) => {
      assert.equal(table, 'comp_revisions');
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { image_url: STORED, requester_id: 'user-1' } }) }) }),
        delete: () => ({ eq: async () => { events.push('delete-row'); return { error: null }; } }),
      };
    } },
  });
  await fns.deleteRevision('rev-1', 'user-1');
  assert.deepEqual(events, ['delete-row', 'broadcast:comp_revisions:DELETE', `delete-file:${STORED}`]);
});

test('the upload puts the picture under revisions/{id} with its own type and rejects odd ids', async () => {
  const uploads: Array<{ path: string; contentType: string }> = [];
  const fns = loadFunctions('../electron/storage.ts', ['toBuffer', 'uploadRevisionImage'], {
    BUCKET: 'scene-images',
    SAFE_SIZE_BYTES: 500 * 1024,
    nativeImage: { createFromBuffer: () => { throw new Error('small pictures are not re-encoded'); } },
    supabase: { storage: { from: (bucket: string) => {
      assert.equal(bucket, 'scene-images');
      return {
        upload: async (path: string, _body: Buffer, opts: { contentType: string; upsert: boolean }) => {
          assert.equal(opts.upsert, false);
          uploads.push({ path, contentType: opts.contentType });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example/${path}` } }),
      };
    } } },
  });
  const url = await fns.uploadRevisionImage('rev-1', DATA_URL);
  assert.match(uploads[0].path, /^revisions\/rev-1\/\d+_[a-z0-9]+\.jpg$/);
  assert.equal(uploads[0].contentType, 'image/jpeg');
  assert.equal(url, `https://example/${uploads[0].path}`);
  const png = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
  await fns.uploadRevisionImage('rev-2', png);
  assert.match(uploads[1].path, /^revisions\/rev-2\/.+\.png$/);
  assert.equal(uploads[1].contentType, 'image/png');
  await assert.rejects(fns.uploadRevisionImage('../escape', DATA_URL), /ID가 올바르지/);
  assert.equal(uploads.length, 2);
});

test('every retake form still hands its picture to the main process, which is where the upload happens', () => {
  const service = fs.readFileSync(new URL('../src/services/revisionService.ts', import.meta.url), 'utf8');
  assert.match(service, /supabaseAddRevision\([\s\S]*?input\.imageUrl \|\| ''/);
  const main = fs.readFileSync(new URL('../electron/supabase.ts', import.meta.url), 'utf8');
  assert.match(main, /const image = await prepareRevisionImage\(id, imageUrl\);/);
  assert.match(main, /image_url: image\.url,/);
});
