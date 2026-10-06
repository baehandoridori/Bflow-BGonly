/**
 * 설치 파일에 빌드 산출물이 다시 들어가지 않는지 지키는 테스트
 *
 * 문제: 화면 묶음 폴더(vite)와 electron-builder 출력 폴더가 둘 다 `dist` 다. 화면 묶음을 앱에 담으려고
 * package.json build.files 에 "dist 아래 전부"를 넣어 두었는데, electron-builder 는 런타임을 먼저
 * dist/win-unpacked 에 풀고 그 다음에 앱 파일을 모은다. 그래서 방금 푼 런타임 한 벌(71개, 268MB)이
 * 앱 안(resources/app/dist/win-unpacked)으로 한 번 더 복사됐다 — v1.128.1 설치 파일 192MB 중 77MB.
 * vite 정리 없이 패키징만 다시 돌리면 이전 설치 파일·latest.yml·manifest.json 까지 같이 들어갔다.
 *
 * electron-builder 에는 이 상황을 위한 자동 제외(`!dist/*-unpacked`)가 있지만, 24.13.3 에서는 files 를
 * 문자열 목록으로 쓰면 그 규칙이 버려지는 쪽에 붙어 적용되지 않는다. 그래서 build.files 에 직접 적었다.
 *
 * 지키는 방법 두 가지:
 *   1) build.files — electron-builder 가 빌드 때 쓰는 코드 그대로 "이 파일이 앱에 담기는가"를 물어본다.
 *   2) generate-manifest.js — 실제 결과물의 화면 폴더에 다른 것이 섞였으면 배포 신호(manifest.json)를 쓰지 않는다.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

// ── 1) build.files 가 무엇을 담는지 ───────────────────────────────────
/**
 * electron-builder 가 빌드 때 거치는 순서(설정 읽기 → files 정리 → 기본 규칙 끼우기 → 판정)를 그대로 밟아
 * "프로젝트의 이 파일이 앱 폴더로 복사되는가"를 답하는 함수를 만든다.
 *
 * 규칙 글자만 보고 따로 흉내 내면 틀린다 — 설정을 읽는 단계에서 files 의 모양이 바뀌고, 그 때문에
 * electron-builder 의 자동 제외가 빠진다(위 머리말). 그래서 electron-builder 의 내부 코드를 직접 부른다.
 */
type PackagedCheck = (relativePath: string) => boolean;
let packagedCheck: Promise<PackagedCheck> | undefined;
function loadPackagedCheck(): Promise<PackagedCheck> {
  packagedCheck ??= buildPackagedCheck();
  return packagedCheck;
}

async function buildPackagedCheck(): Promise<PackagedCheck> {
  let getConfig: (projectDir: string, configPath: null, configFromOptions: null) => Promise<any>;
  let getMainFileMatchers: (...args: unknown[]) => Array<{ createFilter(): (file: string, stat: unknown) => boolean }>;
  try {
    ({ getConfig } = require('app-builder-lib/out/util/config'));
    ({ getMainFileMatchers } = require('app-builder-lib/out/fileMatcher'));
  } catch (error) {
    throw new Error(
      'electron-builder 내부 코드를 불러오지 못했습니다. electron-builder 를 올렸다면 npm run build 로 '
      + 'dist/win-unpacked/resources/app/dist 안에 index.html·assets·splash 만 있는지 직접 확인하고 이 테스트를 맞춰 주세요.',
      { cause: error },
    );
  }

  const config = await getConfig(repoRoot, null, null);
  const outDir = path.resolve(repoRoot, config.directories.output);
  const matchers = getMainFileMatchers(
    repoRoot,
    path.join(outDir, 'win-unpacked', 'resources', 'app'),
    (pattern: string) => pattern,
    config.win ?? {},
    {
      info: {
        projectDir: repoRoot,
        buildResourcesDir: config.directories.buildResources,
        config,
        isPrepackedAppAsar: false,
        debugLogger: { isEnabled: false, add() {} },
      },
    },
    outDir,
    false,
  );
  // build.files 가 문자열 목록이면 묶음은 하나다. { from, to } 묶음을 더했다면 그 묶음이 담는 것도 여기서 봐야 한다.
  assert.equal(matchers.length, 1, 'build.files 에 묶음이 늘었습니다 — 이 테스트가 모든 묶음을 보도록 맞춰 주세요.');
  const filter = matchers[0].createFilter();
  const stat = (isDirectory: boolean) => ({ isDirectory: () => isDirectory, isFile: () => !isDirectory });

  return (relativePath) => {
    const parts = relativePath.split('/');
    // 폴더가 걸러지면 electron-builder 는 그 안으로 들어가지 않는다 — 윗폴더부터 차례로 물어본다
    for (let depth = 1; depth < parts.length; depth++) {
      if (!filter(path.join(repoRoot, ...parts.slice(0, depth)), stat(true))) return false;
    }
    return filter(path.join(repoRoot, ...parts), stat(false));
  };
}

test('build.files — 앱이 실행에 쓰는 파일은 그대로 담긴다', async () => {
  const packaged = await loadPackagedCheck();
  for (const file of [
    'package.json',
    'dist/index.html',
    'dist/assets/index-abc.js',
    'dist/assets/index-abc.css',
    'dist/assets/chunks/vendor-motion-abc.js',
    'dist/splash/splash.html',
    'dist/splash/opening_video.mp4',
    'dist-electron/main.js',
    'dist-electron/preload.js',
    'public/splash/splash.html',
    'public/splash/opening_image_cropped.png',
  ]) {
    assert.equal(packaged(file), true, `${file} 이 빠지면 앱이 뜨지 않는다`);
  }
});

test('build.files — 빌드 산출물은 앱 안으로 다시 담기지 않는다', async () => {
  const packaged = await loadPackagedCheck();
  for (const [file, what] of [
    ['dist/win-unpacked/electron.exe', '방금 풀어 둔 런타임 (v1.128.1 까지 들어가던 268MB)'],
    ['dist/win-unpacked/locales/ko.pak', '런타임의 하위 폴더'],
    ['dist/win-unpacked/resources/app/dist/index.html', '이전 빌드의 앱 폴더'],
    ['dist/win-arm64-unpacked/electron.exe', '다른 아키텍처용 런타임'],
    ['dist/BFLOW-Setup.exe', '이전 설치 파일'],
    ['dist/BFLOW-Setup.exe.blockmap', '설치 파일 보조 기록'],
    ['dist/__uninstaller-nsis-bflow.exe', '설치 파일을 만드는 중에 생기는 임시 파일'],
    ['dist/bflow-1.128.2-x64.nsis.7z', '설치 파일을 만들다 멈추면 남는 묶음'],
    ['dist/latest.yml', '설치 파일 정보'],
    ['dist/builder-debug.yml', 'electron-builder 기록'],
    ['dist/builder-effective-config.yaml', '터미널에서 직접 빌드할 때만 생기는 기록'],
    ['dist/manifest.json', '배포 신호 파일'],
  ] as const) {
    assert.equal(packaged(file), false, `${file} — ${what}`);
  }
});

test('build.files — 제외 규칙은 dist 맨 위에만 걸리고, 화면 묶음 안의 같은 이름 파일은 건드리지 않는다', async () => {
  const packaged = await loadPackagedCheck();
  for (const file of [
    'dist/assets/manifest.json',
    'dist/assets/locale-ko.yml',
    'dist/assets/tool.exe',
    'dist/splash/win-unpacked/poster.png',
  ]) {
    assert.equal(packaged(file), true, file);
  }
});

// ── 2) 배포 신호 파일 (generate-manifest.js) ──────────────────────────
const TOKEN = 'tok-packaged-app-contents-test';
const tempDirs: string[] = [];
test.after(() => {
  for (const dir of tempDirs) {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('bflow-packaged-app-'));
    rmSync(dir, { recursive: true, force: true });
  }
});

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * `npm run build` 가 electron-builder 까지 끝낸 직후의 폴더 모양을 만든다.
 * leaked 는 설치 파일에 담기는 화면 폴더(win-unpacked/resources/app/dist) 안에 더 넣을 파일들.
 */
function makeRelease(leaked: string[] = []): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bflow-packaged-app-'));
  tempDirs.push(root);
  for (const name of ['generate-manifest.js', 'vacation-token.cjs']) {
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    copyFileSync(path.join(repoRoot, 'scripts', name), path.join(root, 'scripts', name));
  }
  write(path.join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  write(path.join(root, 'public', 'splash', 'splash.html'), '<html></html>');

  const bundle = `const a="${TOKEN}";`;
  const dist = path.join(root, 'dist');
  const packagedScreen = path.join(dist, 'win-unpacked', 'resources', 'app', 'dist');
  // vite 가 만든 화면 묶음과, electron-builder 가 앱 폴더에 담은 사본
  for (const screen of [dist, packagedScreen]) {
    write(path.join(screen, 'index.html'), '<html></html>');
    write(path.join(screen, 'assets', 'index-abc.js'), bundle);
    write(path.join(screen, 'splash', 'splash.html'), '<html></html>');
  }
  write(path.join(dist, 'win-unpacked', 'BFLOW.exe'), 'runtime');
  write(path.join(dist, 'BFLOW-Setup.exe'), 'installer');
  for (const file of leaked) write(path.join(packagedScreen, ...file.split('/')), 'leaked');
  return root;
}

function generateManifest(root: string) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'generate-manifest.js')], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
    env: { ...process.env, BFLOW_VACATION_TOKEN: TOKEN },
  });
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
    manifestWritten: existsSync(path.join(root, 'dist', 'manifest.json')),
  };
}

test('generate-manifest — 화면 폴더에 vite 가 만든 것만 있으면 manifest.json 을 쓴다', () => {
  const root = makeRelease();
  const ok = generateManifest(root);
  assert.equal(ok.status, 0, ok.output);
  assert.match(ok.output, /앱 묶음 확인/);
  assert.equal(ok.manifestWritten, true);
  // public 에서 복사된 항목(splash)은 화면 묶음의 일부다
  assert.doesNotMatch(ok.output, /섞여 있습니다/);
});

test('generate-manifest — 앱 안에 런타임이 한 벌 더 들어가 있으면 막는다 (v1.128.1 까지의 모양)', () => {
  const root = makeRelease(['win-unpacked/electron.exe', 'win-unpacked/locales/ko.pak']);
  const blocked = generateManifest(root);
  assert.notEqual(blocked.status, 0, blocked.output);
  assert.equal(blocked.manifestWritten, false, 'manifest 를 쓰면 안 된다');
  assert.match(blocked.output, /빌드 산출물이 섞여 있습니다/);
  assert.match(blocked.output, /섞인 항목: win-unpacked/);
  assert.match(blocked.output, /build\.files/);
});

test('generate-manifest — 이전 설치 파일·기록 파일이 섞여도 막고, 무엇이 섞였는지 모두 알려 준다', () => {
  const leaked = ['BFLOW-Setup.exe', 'BFLOW-Setup.exe.blockmap', 'builder-debug.yml', 'latest.yml', 'manifest.json'];
  const blocked = generateManifest(makeRelease(leaked));
  assert.notEqual(blocked.status, 0, blocked.output);
  assert.equal(blocked.manifestWritten, false);
  assert.match(blocked.output, new RegExp(`섞인 항목: ${leaked.join(', ').replace(/\./g, '\\.')}`));
});

test('generate-manifest — 화면 폴더가 아예 없으면 확인했다고 말하지 않고 멈춘다', () => {
  const root = makeRelease();
  rmSync(path.join(root, 'dist', 'win-unpacked', 'resources'), { recursive: true });
  const blocked = generateManifest(root);
  assert.notEqual(blocked.status, 0, blocked.output);
  assert.equal(blocked.manifestWritten, false);
  assert.doesNotMatch(blocked.output, /앱 묶음 확인 —/, '보지 않은 것을 확인했다고 적으면 안 된다');
});

// ── 연결 ──────────────────────────────────────────────────────────────
test('package.json — 이 테스트가 배포 빌드의 테스트 묶음에 들어 있다', () => {
  const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts as Record<string, string>;
  assert.ok(scripts['test:auto-update'].includes('./tests/packagedAppContents.test.ts'));
  assert.ok(scripts.build.includes('npm run test:auto-update'));
  assert.ok(scripts['build:vite'].includes('npm run test:auto-update'));
});
