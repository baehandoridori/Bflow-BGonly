/**
 * 씬 그림(스토리보드·가이드·댓글 그림) 저장소 경로 (v1.150.2, 2026-11-12).
 * 씬 번호에 한글이 있으면 그림 올리기가 늘 실패하던 문제.
 *   - Supabase Storage 는 경로에 영문·숫자와 몇몇 기호만 받는다. 그 밖의 글자가 있으면 400 "Invalid key".
 *   - 씬 번호 '쿠키001' 이 경로에 그대로 들어가 `EP08/E/BG/쿠키001/guide_….png` 가 거절됐다
 *     (운영 DB 의 한글 씬 28개는 그때까지 스토리보드·가이드가 하나도 없었다).
 *   - 순수 규칙은 literal 로, main 의 올리기 흐름은 서버와 같은 경로 규칙을 쓰는 가짜 저장소에 붙여 동작으로 검사한다.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { buildSceneImageStoragePath, sceneImageStorageFolder } from '../src/shared/sceneImageStoragePath.ts';

// supabase/storage 의 src/storage/limits.ts VALID_OBJECT_KEY 원문(2026-11-12 확인). 이 밖의 글자가 있으면 "Invalid key".
const SERVER_VALID_KEY = /^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/;
const UNIQ = '1794450375881_xtn2vvzb';

test('한글 씬 번호도 저장소가 받는 경로가 된다', () => {
  const key = buildSceneImageStoragePath('EP08_E_BG', '쿠키001', 'guide', 'png', UNIQ);
  assert.equal(key, 'EP08/E/BG/.ecbfa0ed82a4.001/guide_1794450375881_xtn2vvzb.png');
  assert.ok(SERVER_VALID_KEY.test(key), key);
});

test('영문·숫자·-·_ 로 된 씬 번호의 경로는 예전과 같다', () => {
  assert.equal(
    buildSceneImageStoragePath('EP12_A_BG', 'a008', 'storyboard', 'jpg', '1794450378375_olj19j8k'),
    'EP12/A/BG/a008/storyboard_1794450378375_olj19j8k.jpg',
  );
  assert.equal(sceneImageStorageFolder('C-12_b'), 'C-12_b');
});

test('그 밖의 글자는 바꿔 적고, 다른 씬 번호끼리 같은 폴더가 되지 않는다', () => {
  const cases: Array<[string, string]> = [
    ['m012,m029', 'm012.2c.m029'],
    ['a,b', 'a.2c.b'],
    // 점을 그대로 두면 'a,b' 와 같은 폴더가 된다
    ['a.2c.b', 'a.2e.2c.2e.b'],
    // 폴더가 한 칸 더 생기거나, 주소에서 ? 뒤가 잘리지 않게
    ['a/b?', 'a.2f.b.3f.'],
    ['쿠키 1', '.ecbfa0ed82a420.1'],
  ];
  for (const [sceneId, folder] of cases) {
    assert.equal(sceneImageStorageFolder(sceneId), folder, sceneId);
    assert.ok(SERVER_VALID_KEY.test(folder), folder);
    // 공개 주소(encodeURI)에서도 글자가 그대로라야 지울 때 주소에서 같은 경로를 되찾는다
    assert.equal(encodeURI(folder), folder);
  }
  assert.notEqual(sceneImageStorageFolder('a,b'), sceneImageStorageFolder('a.2c.b'));
});

test('캐릭터 댓글 그림 경로와 시트 이름 검사는 그대로다', () => {
  assert.equal(
    buildSceneImageStoragePath('char', '0b7c1c1e-5d1a-4f8e-9a51-2b0c6f3d9e10', 'comment', 'jpg', UNIQ),
    'characters/0b7c1c1e-5d1a-4f8e-9a51-2b0c6f3d9e10/comments/comment_1794450375881_xtn2vvzb.jpg',
  );
  assert.throws(() => buildSceneImageStoragePath('EP08-E-BG', 'a008', 'guide', 'png', UNIQ), /Invalid sheetName/);
});

// ─── main 의 올리기 흐름 (electron/storage.ts) ───────────────────────────
// storage.ts 는 electron·supabase 를 import 해서 바로 부를 수 없다 — 함수 선언만 꺼내 가짜 저장소와 함께 돌린다.

const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PUBLIC_BASE = 'https://example.supabase.co/storage/v1/object/public/scene-images/';

function loadStorageFunctions(bindings: Record<string, unknown>) {
  const file = '../electron/storage.ts';
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter(ts.isFunctionDeclaration);
  const names = functions.map((node) => node.name?.text).filter((name): name is string => !!name);
  assert.ok(names.includes('uploadImage') && names.includes('extractPathFromPublicUrl'));
  const output = ts.transpileModule(
    functions.map((node) => node.getText(ast)).join('\n') + `\nglobalThis.loaded = { ${names.join(', ')} };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const context = vm.createContext({ exports: {}, Buffer, ...bindings });
  vm.runInContext(output, context);
  return context.loaded as Record<string, (...args: any[]) => any>;
}

/** 서버처럼 경로 규칙을 검사하는 scene-images 버킷. 공개 주소는 supabase-js 처럼 encodeURI 로 만든다. */
function fakeSceneImagesBucket() {
  const stored = new Map<string, string>();
  const supabase = {
    storage: {
      from(bucket: string) {
        assert.equal(bucket, 'scene-images');
        return {
          async upload(path: string, _body: Buffer, options: { contentType: string; upsert: boolean }) {
            if (!(path.length > 0 && SERVER_VALID_KEY.test(path))) {
              return { data: null, error: Object.assign(new Error(`Invalid key: ${path}`), { name: 'StorageApiError', status: 400 }) };
            }
            stored.set(path, options.contentType);
            return { data: { path }, error: null };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: encodeURI(`${PUBLIC_BASE}${path}`) } };
          },
        };
      },
    },
  };
  return { stored, supabase };
}

test('main 올리기: 한글 씬 번호의 가이드 그림이 올라가고, 받은 주소로 같은 파일을 되찾는다', async () => {
  const bucket = fakeSceneImagesBucket();
  const errors: unknown[][] = [];
  const fns = loadStorageFunctions({
    supabase: bucket.supabase,
    nativeImage: {},
    console: { error: (...args: unknown[]) => { errors.push(args); }, warn: () => {} },
    BUCKET: 'scene-images',
    MAX_PX: 800,
    JPEG_QUALITY: 80,
    SAFE_SIZE_BYTES: 500 * 1024,
    buildSceneImageStoragePath,
  });

  const result = await fns.uploadImage('EP08_E_BG', '쿠키001', 'guide', TINY_PNG);

  assert.deepEqual(errors, []);
  assert.equal(result.ok, true);
  const keys = [...bucket.stored.keys()];
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^EP08\/E\/BG\/\.ecbfa0ed82a4\.001\/guide_\d+_[a-z0-9]+\.png$/);
  assert.equal(bucket.stored.get(keys[0]), 'image/png');
  // 씬 삭제·그림 교체 때 지우는 길은 공개 주소에서 경로를 뽑는다 — 같은 파일을 가리켜야 한다
  assert.equal(fns.extractPathFromPublicUrl(result.url), keys[0]);
});
