/**
 * 저장소 그림 지우기 (v1.134.3).
 * 저장소는 지우지 못한 파일을 오류 없이 건너뛴다 — 읽기 정책이 없던 반년 동안 그림이 하나도 지워지지 않았는데
 * 앱은 오류가 없다는 것만 보고 성공으로 넘겼다. 지웠다고 돌아온 이름으로 판정하는지 동작으로 검사한다.
 *   - 배선·SQL 은 소스-문자열 검사 — 리팩터 시 앵커가 깨지면 함께 갱신할 것.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_REMOVE_CHUNK, removeStoragePaths, storagePathFromPublicUrl } from '../electron/storageRemove.ts';
import type { StorageRemover } from '../electron/storageRemove.ts';

const DISPLAY = 'characters/c94d920a/4eff806a/1791798435926_cj2w62qk.png';
const ORIGINAL = 'characters/c94d920a/4eff806a/1791798435926_cj2w62qk.orig';
const SCENE = 'EP01/A/BG/a001/guide_1_x.jpg';

/** 저장소 흉내 — 있는 파일만 지우고 지운 것을 돌려준다(없거나 지울 수 없는 것은 오류 없이 건너뛴다). */
function fakeBucket(removable: string[]) {
  const requests: string[][] = [];
  const remove: StorageRemover = async (paths) => {
    requests.push(paths);
    return { data: paths.filter((path) => removable.includes(path)).map((name) => ({ name })), error: null };
  };
  return { remove, requests };
}

function captureWarnings(t: { mock: { method: typeof test.mock.method } }) {
  const warn = t.mock.method(console, 'warn', () => {});
  return () => warn.mock.calls.map((call) => call.arguments);
}

test('지우기: 지웠다는 답이 온 것만 지워진 것 — 다 지워지면 조용하다', async (t) => {
  const warnings = captureWarnings(t);
  const { remove, requests } = fakeBucket([DISPLAY, ORIGINAL, SCENE]);
  assert.deepEqual(await removeStoragePaths(remove, [DISPLAY, SCENE], '[Storage]'), []);
  // 캐릭터 그림은 함께 보관한 원본도 같이 지운다.
  assert.deepEqual(requests, [[DISPLAY, ORIGINAL, SCENE]]);
  assert.deepEqual(warnings(), []);
});

test('지우기: 오류 없이 빈 목록이 오면 지우지 못한 것이다 — 성공으로 넘기지 않는다', async (t) => {
  const warnings = captureWarnings(t);
  const { remove } = fakeBucket([]);
  assert.deepEqual(await removeStoragePaths(remove, [DISPLAY, SCENE], '[Storage]'), [DISPLAY, SCENE]);
  const [message, paths] = warnings()[0];
  assert.match(message, /^\[Storage\] 저장소에서 지워지지 않은 파일 2\/2개/);
  assert.deepEqual(paths, [DISPLAY, SCENE]);
});

test('지우기: 일부만 지워지면 남은 것만 알린다', async (t) => {
  const warnings = captureWarnings(t);
  const { remove } = fakeBucket([SCENE]);
  assert.deepEqual(await removeStoragePaths(remove, [DISPLAY, SCENE], '[character-board]'), [DISPLAY]);
  assert.equal(warnings().length, 1);
  assert.match(warnings()[0][0], /^\[character-board\] 저장소에서 지워지지 않은 파일 1\/2개/);
  assert.deepEqual(warnings()[0][1], [DISPLAY]);
});

test('지우기: 원본이 없는 그림은 흔하다 — 화면용이 지워졌으면 다 지워진 것으로 본다', async (t) => {
  const warnings = captureWarnings(t);
  const { remove } = fakeBucket([DISPLAY]);
  assert.deepEqual(await removeStoragePaths(remove, [DISPLAY], '[Storage]'), []);
  assert.deepEqual(warnings(), []);
});

test('지우기: 저장소가 오류를 돌려주거나 요청이 끊겨도 던지지 않고 전부 남은 것으로 알린다', async (t) => {
  const warnings = captureWarnings(t);
  const refused: StorageRemover = async () => ({ data: null, error: { message: 'permission denied' } });
  assert.deepEqual(await removeStoragePaths(refused, [SCENE], '[Storage]'), [SCENE]);
  const offline: StorageRemover = async () => { throw new Error('fetch failed'); };
  assert.deepEqual(await removeStoragePaths(offline, [SCENE], '[Storage]'), [SCENE]);
  assert.match(warnings()[0][0], /1\/1개 — permission denied$/);
  assert.match(warnings()[1][0], /1\/1개 — fetch failed$/);
});

test('지우기: 지울 것이 없으면 저장소를 부르지 않고, 같은 주소는 한 번만 보낸다', async () => {
  const empty = fakeBucket([]);
  assert.deepEqual(await removeStoragePaths(empty.remove, [], '[Storage]'), []);
  assert.deepEqual(empty.requests, []);

  const twice = fakeBucket([SCENE]);
  assert.deepEqual(await removeStoragePaths(twice.remove, [SCENE, SCENE], '[Storage]'), []);
  assert.deepEqual(twice.requests, [[SCENE]]);
});

test('지우기: 많으면 나눠 보낸다 — 한 묶음이 끊겨도 나머지는 지우고, 남은 것만 알린다', async (t) => {
  const warnings = captureWarnings(t);
  const many = Array.from({ length: STORAGE_REMOVE_CHUNK * 2 + 50 }, (_, i) => `EP01/A/BG/a${i}/guide_1_x.jpg`);
  const sizes: number[] = [];
  const remove: StorageRemover = async (paths) => {
    sizes.push(paths.length);
    if (sizes.length === 2) throw new Error('fetch failed');
    return { data: paths.map((name) => ({ name })), error: null };
  };
  const left = await removeStoragePaths(remove, many, '[Storage]');
  assert.deepEqual(sizes, [STORAGE_REMOVE_CHUNK, STORAGE_REMOVE_CHUNK, 50]);
  assert.deepEqual(left, many.slice(STORAGE_REMOVE_CHUNK, STORAGE_REMOVE_CHUNK * 2));
  assert.match(warnings()[0][0], new RegExp(`${STORAGE_REMOVE_CHUNK}/${many.length}개 — fetch failed$`));
});

// ─── 배선 ───

const storage = readFileSync('electron/storage.ts', 'utf8');
const mainSupabase = readFileSync('electron/supabase.ts', 'utf8');

/** 함수 하나의 본문 — 다음 최상위 선언 전까지. */
function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `${signature} 를 찾지 못함`);
  const end = source.indexOf('\nexport ', start + signature.length);
  return source.slice(start, end < 0 ? undefined : end);
}

/** electron 아래의 모든 .ts — 저장소를 직접 부르는 곳이 새로 생겼는지 볼 때 쓴다. */
function electronSources(dir = 'electron'): { file: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return electronSources(file);
    return entry.name.endsWith('.ts') ? [{ file, text: readFileSync(file, 'utf8') }] : [];
  });
}

test('배선: 저장소 지우기는 한 곳을 지난다 — 지웠다는 답까지 확인하는 길', () => {
  assert.match(storage, /const removeFromBucket: StorageRemover = \(paths\) => supabase\.storage\.from\(BUCKET\)\.remove\(paths\);/);
  assert.match(storage, /const paths = urls\.map\(storagePathFromPublicUrl\)\.filter\(\(path\): path is string => !!path\);\s+await removeStoragePaths\(removeFromBucket, paths, tag\);/);
  // 저장소를 직접 부르는 곳이 한 곳이라도 더 있으면 그곳만 조용히 실패한다 — main 전체에서 이 한 줄뿐이어야 한다.
  const direct = electronSources().filter(({ text }) => /\.from\([^)]*\)\s*\.remove\(/.test(text)).map(({ file }) => file);
  assert.deepEqual(direct, ['electron/storage.ts']);
  assert.equal(storage.match(/\.remove\(/g)?.length, 1);
  assert.match(mainSupabase, /await storageDeleteImages\(urls, '\[character-board\]'\);/);
  assert.match(bodyOf(mainSupabase, 'export async function deleteComment('), /await storageDeleteImages\(images, '\[deleteComment\]'\);/);
});

test('배선: 그림 파일은 그 그림을 가리키던 기록을 지운 뒤에 지운다', () => {
  // 서버는 아직 쓰이는 그림의 삭제를 거절한다 — 기록보다 먼저 지우려 하면 파일이 주인 없이 남는다.
  // 순서가 반대면 기록 삭제가 실패했을 때 살아 있는 씬·리테이크가 없는 그림을 가리키게 된다.
  const order: [signature: string, record: string, files: string][] = [
    ['export async function deleteScene(', ".from('scenes').delete()", 'await storageDeleteImages('],
    ['export async function bulkDeleteScenes(', "supabase.rpc('bulk_delete_scenes'", 'await storageDeleteImages(urlsToDelete)'],
    ['export async function deleteComment(', ".from('comments').delete()", 'await storageDeleteImages('],
    ['export async function deleteRevision(', ".from('comp_revisions').delete()", 'await storageDeleteImages('],
    ['export async function deleteCharacter(', ".from('characters').delete()", 'await removeCharacterStorageByUrl('],
    ['export async function updateCharacterCostume(', ".from('character_costumes')\n    .update(", 'await removeCharacterStorageByUrl('],
    ['export async function deleteCharacterCostume(', ".from('character_costumes').delete()", 'await removeCharacterStorageByUrl('],
    ['export async function deleteCostumeImage(', ".from('character_costume_images').delete()", 'await removeCharacterStorageByUrl('],
  ];
  for (const [signature, record, files] of order) {
    const body = bodyOf(mainSupabase.replace(/\r\n/g, '\n'), signature);
    assert.ok(body.indexOf(record) > 0, `${signature} 기록 지우기`);
    assert.ok(body.indexOf(files) > body.indexOf(record), `${signature} 순서`);
    // 지우는 호출은 하나뿐 — 기록보다 앞에 하나 더 끼면 위 검사로는 보이지 않는다.
    assert.equal(body.split(files).length - 1, 1, `${signature} 파일 지우기는 한 번`);
  }
  // 기록을 지우지 못했으면(throw) 파일은 건드리지 않는다.
  const scene = bodyOf(mainSupabase, 'export async function deleteScene(');
  assert.match(scene, /throwIfError\(error\);\s+broadcastDataChange\('scenes', 'DELETE'\);\s+\/\/[^\n]*\s+await storageDeleteImages\(\[scene\?\.storyboard_url, scene\?\.guide_url\]\);/);
  const revision = bodyOf(mainSupabase, 'export async function deleteRevision(');
  assert.match(revision, /throwIfError\(error\);\s+broadcastDataChange\('comp_revisions', 'DELETE'\);\s+\/\/[^\n]*\s+await storageDeleteImages\(/);
});

// ─── 주소 → 경로 ───

test('경로: 공개 주소에서 버킷 안 경로를 뽑는다 — 주소에 %20 으로 적힌 공백을 되돌린다', () => {
  const base = 'https://example.supabase.co/storage/v1/object/public/scene-images/';
  assert.equal(storagePathFromPublicUrl(base + SCENE), SCENE);
  assert.equal(storagePathFromPublicUrl(`${base}EP01/A/BG/m012,%20m029/guide_1_x.jpg`), 'EP01/A/BG/m012, m029/guide_1_x.jpg');
  // 되돌릴 수 없는 % 는 그대로 둔다(던지지 않는다).
  assert.equal(storagePathFromPublicUrl(`${base}EP01/A/BG/a%zz/guide_1_x.jpg`), 'EP01/A/BG/a%zz/guide_1_x.jpg');
  // 저장소 밖 주소·주소가 아닌 값은 지울 것이 없다.
  for (const value of ['https://drive.google.com/uc?id=abc', 'mock://image', '', null, undefined, 42]) {
    assert.equal(storagePathFromPublicUrl(value), null);
  }
});

// ─── 서버 정책 ───

const migration = readFileSync('DEVLOG/migrations/2026-10-12-scene-images-delete-policy.sql', 'utf8');
const sql = migration.replace(/--.*$/gm, '');

test('정책: 읽기는 지우는 작업에만 열린다 — 파일 이름 나열은 계속 막힌다', () => {
  assert.match(sql, /CREATE POLICY scene_images_anon_select_for_delete ON storage\.objects\s+FOR SELECT TO anon\s+USING \(\s+bucket_id = 'scene-images'\s+AND \(SELECT storage\.allow_any_operation\(ARRAY\['object\.delete', 'object\.delete_many'\]\)\)\s+\);/);
  // 작업 종류를 가리지 않는 읽기 정책이 끼면 anon 이 버킷 전체를 나열할 수 있다.
  assert.equal(sql.match(/FOR SELECT/g)?.length, 1);
});

test('정책: 아직 쓰이는 그림은 지워지지 않는다 — 주소를 적는 곳을 빠짐없이 본다', () => {
  // 제한(RESTRICTIVE) 정책으로 건다 — 허용 정책에 붙인 조건은 삭제 허용 정책이 하나 더 생기면 OR 로 풀린다.
  assert.match(sql, /CREATE POLICY scene_images_delete_only_unreferenced ON storage\.objects\s+AS RESTRICTIVE\s+FOR DELETE TO anon, authenticated\s+USING \(bucket_id <> 'scene-images' OR NOT storage_private\.scene_image_is_referenced\(name\)\);/);
  // 있던 정책은 건드리지 않는다(되돌리기는 더한 것을 빼는 것으로 끝난다).
  assert.doesNotMatch(sql, /ALTER POLICY|scene_images_anon_insert|POLICY (?:IF EXISTS )?scene_images_anon_delete/);
  const body = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION storage_private.scene_image_is_referenced('), sql.indexOf('$function$;'));
  assert.match(body, /RETURNS boolean\s+LANGUAGE sql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = ''/);
  // 찾는 글자: 파일 이름 그대로 + 공백을 %20 으로 적은 모양. 이 줄이 빠지면 원본(.orig)이 아닌 모든 파일이 '안 쓰임'이 된다.
  assert.match(body, /WITH names\(name\) AS \(\s+SELECT p_name\s+UNION ALL/);
  assert.match(body, /needles\(needle\) AS \(\s+SELECT '\/scene-images\/' \|\| name FROM names\s+UNION\s+SELECT '\/scene-images\/' \|\| replace\(name, ' ', '%20'\) FROM names\s+\)/);
  assert.match(body, /SELECT EXISTS \(\s+SELECT 1 FROM needles n\s+WHERE EXISTS/);
  // 그림 주소가 적히는 열 — 새로 생기면 여기와 함수에 함께 넣는다(빠진 열의 그림은 '주인 없음'으로 보여 지워질 수 있다).
  for (const column of [
    'public.scenes s WHERE strpos(s.storyboard_url, n.needle) > 0 OR strpos(s.guide_url, n.needle) > 0',
    'public.scene_image_versions v WHERE strpos(v.url, n.needle) > 0',
    'public.comments c WHERE strpos(c.images::text, n.needle) > 0',
    'public.comp_revisions r WHERE strpos(r.image_url, n.needle) > 0',
    'public.comp_revisions_archive a WHERE strpos(a.image_url, n.needle) > 0',
    'public.character_costume_images i WHERE strpos(i.url, n.needle) > 0',
    'public.character_costumes k WHERE strpos(k.featured_image_url, n.needle) > 0',
    // anon 이 읽지 못하는 표는 이름이 끝까지 맞을 때만 — '포함'이면 이름을 늘려 가며 떠볼 수 있다.
    `public.background_library_entities b WHERE strpos(b.value::text, n.needle || '"') > 0 OR strpos(b.value::text, n.needle || '?') > 0`,
  ]) {
    assert.ok(body.includes(`EXISTS (SELECT 1 FROM ${column})`), column);
  }
  assert.equal(body.match(/EXISTS \(SELECT 1 FROM public\./g)?.length, 8);
  // 캐릭터 그림의 원본(.orig)은 주소가 DB 에 없다 — 화면용 그림이 쓰이면 원본도 쓰이는 것으로 본다.
  assert.match(body, /SELECT m\.parts\[1\] \|\| ext\s+FROM regexp_match\(p_name, '\^\(characters\/\[\^\/\]\+\/\[\^\/\]\+\/\[\^\/\.\]\+\)\\\.orig\$'\) AS m\(parts\), unnest\(ARRAY\['\.png', '\.jpg'\]\) AS ext\s+WHERE m\.parts IS NOT NULL/);
  // 잠가 둔 표까지 읽는 함수라 API 로 내놓는 스키마(public)에 두지 않는다 — 정책이 부를 수 있을 만큼만 연다.
  assert.doesNotMatch(sql, /FUNCTION public\./);
  assert.match(sql, /REVOKE ALL ON SCHEMA storage_private FROM PUBLIC;\s+GRANT USAGE ON SCHEMA storage_private TO anon, authenticated;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION storage_private\.scene_image_is_referenced\(text\) FROM PUBLIC;\s+GRANT EXECUTE ON FUNCTION storage_private\.scene_image_is_referenced\(text\) TO anon, authenticated;/);
  assert.match(sql, /^BEGIN;\r?\nSET LOCAL lock_timeout = '5s';\r?\nSET LOCAL statement_timeout = '45s';/m);
  assert.match(sql, /^COMMIT;\s*$/m);
});

// ─── 서버 정책: 실제 PostgreSQL 에서 (BFLOW_PGLITE_MODULE 을 지정했을 때만) ───

const runtime = process.env.BFLOW_PGLITE_MODULE;
const URL_BASE = 'https://example.supabase.co/storage/v1/object/public/scene-images/';

/** 운영의 저장소 표·작업 이름 함수·처음 정책(2026-04-17)과, 그림 주소를 적는 표들의 꼭 필요한 열만. */
const PRODUCTION_BEFORE = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon;
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON storage.objects TO anon;
CREATE FUNCTION storage.operation() RETURNS text LANGUAGE plpgsql STABLE AS $$ BEGIN RETURN current_setting('storage.operation', true); END; $$;
CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH current_operation AS (SELECT storage.operation() AS raw_operation),
  normalized AS (SELECT CASE WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9) ELSE raw_operation END AS current_operation FROM current_operation)
  SELECT EXISTS (
    SELECT 1 FROM normalized n CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL AND expected_operation <> ''
      AND n.current_operation = CASE WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9) ELSE expected_operation END
  );
$$;
CREATE POLICY scene_images_anon_insert ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = 'scene-images');
CREATE POLICY scene_images_anon_delete ON storage.objects FOR DELETE TO anon USING (bucket_id = 'scene-images');
CREATE TABLE public.scenes (id int PRIMARY KEY, storyboard_url text, guide_url text);
CREATE TABLE public.scene_image_versions (url text);
CREATE TABLE public.comments (images jsonb);
CREATE TABLE public.comp_revisions (image_url text);
CREATE TABLE public.comp_revisions_archive (image_url text);
CREATE TABLE public.character_costume_images (url text);
CREATE TABLE public.character_costumes (featured_image_url text);
CREATE TABLE public.background_library_entities (value jsonb);
`;

const USED = {
  storyboard: 'EP01/A/BG/a001/storyboard_1_a.jpg',
  guideWithTail: 'EP01/A/BG/a001/guide_1_b.jpg',
  pastVersion: 'EP01/A/BG/a001/storyboard_0_old.jpg',
  comment: 'EP01/A/BG/a001/comment_1_c.png',
  revision: 'EP01/A/BG/a001/comment_2_r.png',
  archivedRevision: 'EP02/A/BG/a001/comment_3_ra.png',
  costumeImage: 'characters/c1/k1/1_g.png',
  costumeImageOriginal: 'characters/c1/k1/1_g.orig',
  featured: 'characters/c1/k1/2_h.jpg',
  featuredOriginal: 'characters/c1/k1/2_h.orig',
  background: 'backgrounds/3f0c.png',
  // 이름에 공백이 있으면 주소에는 %20 으로 적힌다.
  spaced: 'EP01/A/BG/m012, m029/guide_1_s.jpg',
};
const UNUSED = ['EP01/A/BG/a001/guide_9_gone.jpg', 'characters/c1/k1/3_gone.orig', 'characters/c1/k1/3_gone.png'];

async function openProduction() {
  const { PGlite } = await import(pathToFileURL(runtime!).href);
  const db = new PGlite();
  await db.exec(PRODUCTION_BEFORE);
  for (const name of [...Object.values(USED), ...UNUSED]) await db.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('scene-images', $1)`, [name]);
  await db.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('other-bucket', $1)`, [UNUSED[0]]);
  await db.query(`INSERT INTO public.scenes VALUES (1, $1, $2)`, [URL_BASE + USED.storyboard, `${URL_BASE}${USED.guideWithTail}?v=2`]);
  await db.query(`INSERT INTO public.scenes VALUES (2, NULL, $1)`, [URL_BASE + encodeURI(USED.spaced)]);
  await db.query(`INSERT INTO public.scene_image_versions VALUES ($1)`, [URL_BASE + USED.pastVersion]);
  await db.query(`INSERT INTO public.comments VALUES ($1)`, [JSON.stringify(['https://elsewhere.example/x.png', URL_BASE + USED.comment])]);
  await db.query(`INSERT INTO public.comp_revisions VALUES ($1)`, [URL_BASE + USED.revision]);
  await db.query(`INSERT INTO public.comp_revisions_archive VALUES ($1)`, [URL_BASE + USED.archivedRevision]);
  await db.query(`INSERT INTO public.character_costume_images VALUES ($1)`, [URL_BASE + USED.costumeImage]);
  await db.query(`INSERT INTO public.character_costumes VALUES ($1)`, [URL_BASE + USED.featured]);
  await db.query(`INSERT INTO public.background_library_entities VALUES ($1)`, [JSON.stringify({ variants: [{ revisions: [{ imageUrl: URL_BASE + USED.background }] }] })]);
  return db;
}

/** Storage 서버가 하는 대로 — anon 으로 바꾸고 작업 이름을 정한 뒤 한 문장을 실행한다. 돌아온 이름을 정렬해 준다. */
async function asAnon(db: any, operation: string, statement: string, params: unknown[] = []): Promise<string[]> {
  return db.transaction(async (tx: any) => {
    await tx.exec('SET LOCAL ROLE anon');
    await tx.query(`SELECT set_config('storage.operation', $1, true)`, [operation]);
    const { rows } = await tx.query(statement, params);
    return rows.map((row: { name: string }) => row.name).sort();
  });
}
const REMOVE = `DELETE FROM storage.objects WHERE bucket_id = 'scene-images' AND name = ANY($1) RETURNING name`;
const LIST = `SELECT name FROM storage.objects WHERE bucket_id = 'scene-images'`;
const everything = [...Object.values(USED), ...UNUSED];

test('정책(실행): 고치기 전에는 지우는 요청이 오류 없이 아무것도 지우지 못한다', { skip: !runtime }, async () => {
  const db = await openProduction();
  assert.deepEqual(await asAnon(db, 'storage.object.delete_many', REMOVE, [everything]), []);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'scene-images'`)).rows[0].n, everything.length);
});

test('정책(실행): 고친 뒤에는 주인 없는 파일만 지워지고, 쓰이는 그림과 나열은 그대로 막힌다', { skip: !runtime }, async () => {
  const db = await openProduction();
  // 다시 돌려도 같은 상태가 된다.
  await db.exec(migration);
  await db.exec(migration);

  // 나열·내려받기 같은 다른 작업, 작업 이름이 없는 접근에서는 아무것도 보이지 않는다.
  for (const operation of ['storage.object.list', 'storage.object.list_v2', 'storage.object.get_authenticated', 'storage.object.info_authenticated', '']) {
    assert.deepEqual(await asAnon(db, operation, LIST), [], operation);
    assert.deepEqual(await asAnon(db, operation, REMOVE, [everything]), [], operation);
  }

  // 지우는 작업: 주인 없는 것만 지워진다 — 화면용 그림이 없어진 원본(.orig)도 주인 없는 것이다.
  assert.deepEqual(await asAnon(db, 'storage.object.delete_many', REMOVE, [everything]), [...UNUSED].sort());
  const left = (await db.query(`SELECT name FROM storage.objects WHERE bucket_id = 'scene-images' ORDER BY name`)).rows.map((row: { name: string }) => row.name);
  assert.deepEqual(left, Object.values(USED).sort());
  // 다른 버킷의 같은 이름은 건드리지 않는다.
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id = 'other-bucket'`)).rows[0].n, 1);

  // 삭제 허용 정책이 하나 더 생겨도(대시보드 템플릿, 예전 SQL 다시 실행) 쓰이는 그림은 지워지지 않는다.
  await db.exec(`CREATE POLICY another_delete ON storage.objects FOR DELETE TO anon USING (true)`);
  assert.deepEqual(await asAnon(db, 'storage.object.delete_many', REMOVE, [everything]), []);
  await db.exec(`DROP POLICY another_delete ON storage.objects`);

  // 가리키던 기록이 사라지면 그때는 지워진다 — 낱개 삭제와 접두어 없는 작업 이름도 같다.
  await db.exec(`DELETE FROM public.scenes; DELETE FROM public.character_costume_images;`);
  assert.deepEqual(await asAnon(db, 'storage.object.delete', REMOVE, [[USED.storyboard]]), [USED.storyboard]);
  assert.deepEqual(
    await asAnon(db, 'object.delete_many', REMOVE, [everything]),
    [USED.guideWithTail, USED.spaced, USED.costumeImage, USED.costumeImageOriginal].sort(),
  );
});

test('정책(실행): 이름의 앞부분만 같은 파일 — 읽을 수 있는 표는 넉넉하게 막고, 잠긴 표는 떠볼 수 없게 한다', { skip: !runtime }, async () => {
  const db = await openProduction();
  await db.exec(migration);
  const upload = (name: string) => db.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('scene-images', $1)`, [name]);
  // anon 이 직접 읽을 수 있는 표: 쓰이는 주소의 앞부분과 같은 이름도 쓰이는 것으로 본다(틀려도 지우지 않는 쪽).
  const scenePrefix = USED.storyboard.slice(0, -4);
  // anon 이 읽지 못하는 표: 앞부분이 같다는 것만으로 거절하면, 이름을 한 글자씩 늘려 올리고 지워 보는 것으로 주소가 샌다.
  const lockedPrefixes = ['backgrounds/3', 'backgrounds/3f0c', 'backgrounds/3f0c.pn'];
  for (const name of [scenePrefix, ...lockedPrefixes]) await upload(name);
  assert.deepEqual(await asAnon(db, 'storage.object.delete_many', REMOVE, [[scenePrefix, ...lockedPrefixes, USED.background]]), [...lockedPrefixes].sort());
  // 꼬리표가 붙은 주소로 적혀 있어도 그 그림은 쓰이는 것이다.
  await db.exec(`UPDATE public.background_library_entities SET value = replace(value::text, '.png"', '.png?v=3"')::jsonb`);
  assert.deepEqual(await asAnon(db, 'storage.object.delete_many', REMOVE, [[USED.background]]), []);
});

test('정책(실행): 쓰이는지 묻는 함수는 정책이 부를 수 있을 만큼만 열려 있고, anon 이 못 읽는 표도 판정한다', { skip: !runtime }, async () => {
  const db = await openProduction();
  await db.exec(migration);
  const granted = await db.query(`
    SELECT has_schema_privilege('anon', 'storage_private', 'USAGE') AS usage,
           has_schema_privilege('anon', 'storage_private', 'CREATE') AS can_create,
           has_function_privilege('anon', 'storage_private.scene_image_is_referenced(text)', 'EXECUTE') AS execute,
           has_function_privilege('public', 'storage_private.scene_image_is_referenced(text)', 'EXECUTE') AS everyone`);
  assert.deepEqual(granted.rows[0], { usage: true, can_create: false, execute: true, everyone: false });
  // anon 은 잠긴 표를 직접 읽지 못해도(권한 없음) 정책은 판정할 수 있어야 한다.
  await assert.rejects(asAnon(db, 'storage.object.delete_many', `SELECT value::text AS name FROM public.background_library_entities`), /permission denied/);
});
