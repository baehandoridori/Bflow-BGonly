# Auto-Update System Implementation Plan (v1.21.0)

> **역사 기록 주의:** 이 계획서는 v1.21.0 초기 directory swap 구현 계획이다. v1.22.14 이후 실제 운영 기준은 `DEVLOG/AUTO_UPDATE_OPERATIONS.md`의 `BFLOW-Setup.exe` 기반 installer helper 방식이다. 새 작업에서 이 계획서의 `pending/` mirror, `app/` swap 절차를 그대로 구현하지 말 것.

> **For agentic workers:** Use superpowers:executing-plans (subagent-driven-development는 상태 공유가 많은 main.ts 통합 작업이라 단일 세션이 안전). Steps use checkbox (`- [ ]`) syntax.

**Goal:** B flow를 G드라이브 직접 실행에서 → 로컬 PC 실행으로 옮긴다. 매 실행 13초+(Defender 캐시 무력) → **재실행 1~2초**. 새 빌드는 G드라이브에서 백그라운드로 받아 종료 시 swap.

**Architecture:** 빌드 산출물에 `manifest.json` 추가 → 로컬 본체가 G드라이브 manifest를 모니터링 → 새 버전이면 `pending/`으로 복사 → 종료 시 `app/` ↔ `pending/` swap. 첫 실행은 portable BFLOW.exe가 self-installer로 동작해 `%LOCALAPPDATA%\Bflow-BGonly\app\`에 자기 자신을 복사.

**Tech Stack:** Electron 33 + Node fs/path/child_process. 새 의존성 0 (네이티브 모듈만 사용). 자동 테스트 인프라 X — 우리 프로젝트 표준대로 `tsc --noEmit` + `vite build` + 수동 시나리오 검증.

**Spec reference:** [`docs/superpowers/specs/2026-05-01-auto-update-design.md`](../specs/2026-05-01-auto-update-design.md)

**Pre-existing changes in this worktree (이 plan 시작 전 이미 적용된 변경 — 별도 chunk 아님)**
- `electron/main.ts`: splash를 gotTheLock 직후로 앞당기고 `cleanupImageCache`를 메인 창 로드 후 5초 백그라운드로 미룸 (gifted-darwin-99908d 964241d 포트)
- `src/components/widgets/OverallProgressWidget.tsx`: RANDOM_MESSAGES 명언 2개 제거
- `CLAUDE.md`: 참조 섹션에 DEPLOYMENT.md 추가
- `DEVLOG/DEPLOYMENT.md`: 배포 가이드 신규
- `docs/superpowers/specs/2026-05-01-auto-update-design.md`: 자동 업데이트 시스템 디자인

이 plan은 그 위에 자동 업데이트 시스템을 더해서 **하나의 PR로** 머지한다.

---

## File Structure

### 신규 파일

| 파일 | 책임 |
|---|---|
| `electron/autoUpdate/paths.ts` | 모든 경로 상수 + G드라이브 폴더 추정. **순수 함수만** — 다른 모듈이 import해 사용. |
| `electron/autoUpdate/manifest.ts` | manifest.json 읽기/쓰기 헬퍼 + 버전 비교. 단일 책임. |
| `electron/autoUpdate/installer.ts` | 첫 실행 감지(`process.execPath`가 G드라이브) + self-installer dialog + `app/`로 복사 + 바로가기 + Defender 등록. |
| `electron/autoUpdate/checker.ts` | 메인 창 로드 후 백그라운드: G드라이브 manifest 읽기 → 자기 버전과 비교 → `pending/`으로 변경분 복사 + `.ready` 마커. |
| `electron/autoUpdate/swapper.ts` | `before-quit` hook: `pending/.ready`가 있으면 `app/` → `backup/`, `pending/` → `app/` 으로 swap. |
| `electron/autoUpdate/index.ts` | 위 모듈을 묶는 단일 진입점 (`runFirstInstallIfNeeded`, `scheduleUpdateCheck`, `swapIfPending`). main.ts는 이 한 파일만 import. |
| `scripts/generate-manifest.js` | `npm run build` 마지막 단계. `dist/manifest.json` = `{ version, buildAt }` 작성. |

### 변경 파일

| 파일 | 변경 |
|---|---|
| `package.json` | `scripts.build` 끝에 `&& node scripts/generate-manifest.js` 추가. 의존성 변경 0. |
| `electron/main.ts` | `app.whenReady()` 시작에 `runFirstInstallIfNeeded` → 이미 설치돼있고 자기가 G드라이브에서 실행됐으면 즉시 종료(로컬 BFLOW를 spawn). 이후 `did-finish-load`에서 5초 후 `scheduleUpdateCheck`. `app.on('before-quit')`에서 `swapIfPending`. |
| `electron/preload.ts` | (변경 없음 — autoUpdate는 메인 프로세스 전용) |

---

## Chunk 1: 경로/매니페스트 기반 (paths.ts + manifest.ts + manifest 생성기)

이 chunk는 **순수 데이터** 계층. 다른 chunk가 import만 함. 사이드 이펙트 없음.

### Task 1.1: `electron/autoUpdate/paths.ts`

**Files:**
- Create: `electron/autoUpdate/paths.ts`

- [ ] **Step 1: 파일 작성** — 전체 코드:

```ts
/**
 * v1.21.0 자동 업데이트 — 모든 경로 상수 + G드라이브 폴더 추정.
 * 순수 함수만. fs 사이드 이펙트 X (existsSync 같은 lookup만).
 */
import { app } from 'electron';
import { existsSync, statSync } from 'fs';
import path from 'path';

/** 로컬 본체 루트 — `%LOCALAPPDATA%\Bflow-BGonly\` */
export function localRoot(): string {
  // app.getPath('userData') = %APPDATA%\Bflow-BGonly (Roaming) — 사용자 데이터용
  // 우리는 LocalAppData를 별도로 — sync 안 됨 + Roaming보다 디스크 빠름
  const localAppData = process.env.LOCALAPPDATA
    || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  return path.join(localAppData, 'Bflow-BGonly');
}

export const APP_DIR_NAME = 'app';
export const PENDING_DIR_NAME = 'pending';
export const BACKUP_DIR_NAME = 'backup';
export const READY_MARKER = '.ready';

export function localAppDir(): string { return path.join(localRoot(), APP_DIR_NAME); }
export function localPendingDir(): string { return path.join(localRoot(), PENDING_DIR_NAME); }
export function localBackupDir(): string { return path.join(localRoot(), BACKUP_DIR_NAME); }
export function localReadyMarker(): string { return path.join(localPendingDir(), READY_MARKER); }

/** `app/BFLOW.exe` */
export function localBflowExe(): string {
  return path.join(localAppDir(), 'BFLOW.exe');
}

/**
 * 현재 실행 파일이 G드라이브 경로 하위에 있는지 추정.
 * 한글 경로 안전성 — path 모듈만 사용 (정규식 직접 비교 X).
 */
export function isRunningFromGoogleDrive(): boolean {
  const exe = process.execPath;
  const candidates = guessGoogleDriveRoots();
  for (const root of candidates) {
    if (exe.toLowerCase().startsWith(root.toLowerCase())) return true;
  }
  return false;
}

/**
 * G드라이브 desktop 동기화 루트 후보. Drive desktop 의 standard mount letter 후보들 +
 * 사용자 홈의 'Google Drive' 폴더(레거시). 존재하지 않는 후보는 자동 skip.
 */
export function guessGoogleDriveRoots(): string[] {
  const candidates: string[] = [];
  // Drive desktop의 가상 마운트 (보통 G:, 일부 사용자는 H: 또는 다른 letter)
  for (const letter of ['G', 'H', 'I', 'J']) {
    candidates.push(`${letter}:\\`);
  }
  // 레거시 데스크톱 sync 폴더 (~\Google Drive)
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'Google Drive'));
    candidates.push(path.join(process.env.USERPROFILE, 'GoogleDrive'));
  }
  return candidates.filter((c) => {
    try { return existsSync(c) && statSync(c).isDirectory(); } catch { return false; }
  });
}

/**
 * 우리 dist 가 들어있는 G드라이브 경로 추정. 후보를 스캔해 manifest.json + BFLOW.exe 가
 * 같이 있는 폴더를 찾아 그 폴더 경로 반환. 없으면 null.
 */
export function findRemoteDistRoot(): string | null {
  const drives = guessGoogleDriveRoots();
  // Studio JBBJ 표준 경로 (DEVLOG/DEPLOYMENT.md §2)
  const SUFFIX = path.join('공유 드라이브', 'JBBJ 자료실', '한솔이의 두근두근 실험실', 'Bflow-BGonly', 'dist');
  for (const drive of drives) {
    const candidate = path.join(drive, SUFFIX);
    if (existsSync(path.join(candidate, 'manifest.json')) && existsSync(path.join(candidate, 'win-unpacked', 'BFLOW.exe'))) {
      return candidate;
    }
  }
  // Drive desktop 마운트가 다르면 사용자 홈/GoogleDrive 안에서도 한 번 scan
  for (const drive of drives) {
    if (drive.endsWith(':\\')) continue;
    // 단순 추정 — 깊은 scan은 비용 ↑, 표준 suffix만 시도
    const candidate = path.join(drive, SUFFIX);
    if (existsSync(path.join(candidate, 'manifest.json'))) return candidate;
  }
  return null;
}

/** G드라이브 dist의 win-unpacked 경로 (없으면 null) */
export function findRemoteWinUnpacked(): string | null {
  const root = findRemoteDistRoot();
  return root ? path.join(root, 'win-unpacked') : null;
}

/** G드라이브 manifest.json 경로 (없으면 null) */
export function findRemoteManifest(): string | null {
  const root = findRemoteDistRoot();
  if (!root) return null;
  const m = path.join(root, 'manifest.json');
  return existsSync(m) ? m : null;
}

/** 현재 실행 중인 BFLOW의 self version (package.json) */
export function getOwnVersion(): string {
  return app.getVersion();
}
```

- [ ] **Step 2: tsc 타입 체크**

```bash
npx tsc --noEmit
```
Expected: PASS (새 파일이라 import 없음 — 단순 통과).

- [ ] **Step 3: 커밋**

```bash
git add electron/autoUpdate/paths.ts
git commit -m "feat(autoUpdate): 경로 추정 + 로컬/원격 경로 상수 (paths.ts)"
```

---

### Task 1.2: `electron/autoUpdate/manifest.ts`

**Files:**
- Create: `electron/autoUpdate/manifest.ts`

- [ ] **Step 1: 파일 작성**

```ts
/**
 * manifest.json 읽기/쓰기 + 버전 비교.
 * spec §3 빌드 산출물 형식: { version: "1.21.0", buildAt: "2026-05-07T...Z" }
 */
import { promises as fsp } from 'fs';

export interface Manifest {
  version: string;       // semver string
  buildAt: string;       // ISO 8601
}

/** 안전 read — 파일 없으면 null. JSON 깨졌으면 null + console.warn. */
export async function readManifest(filePath: string): Promise<Manifest | null> {
  try {
    const text = await fsp.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(text);
    if (typeof parsed?.version !== 'string') return null;
    return { version: parsed.version, buildAt: typeof parsed.buildAt === 'string' ? parsed.buildAt : '' };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    console.warn('[autoUpdate] manifest 읽기 실패:', filePath, err);
    return null;
  }
}

/**
 * semver 문자열 비교. major.minor.patch만 — pre-release 태그 무시.
 * a > b면 1, a == b면 0, a < b면 -1.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}
```

- [ ] **Step 2: tsc 타입 체크 + 커밋**

```bash
npx tsc --noEmit
git add electron/autoUpdate/manifest.ts
git commit -m "feat(autoUpdate): manifest 읽기 + 버전 비교 (manifest.ts)"
```

---

### Task 1.3: `scripts/generate-manifest.js`

**Files:**
- Create: `scripts/generate-manifest.js`

- [ ] **Step 1: 파일 작성**

```js
#!/usr/bin/env node
/**
 * v1.21.0 자동 업데이트 — 빌드 후 dist/manifest.json 생성.
 * `npm run build` 마지막 step. 한솔 손 거치지 않음.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

const distDir = path.join(root, 'dist');
if (!fs.existsSync(distDir)) {
  console.error('[generate-manifest] dist/ 가 없음. vite build 먼저 실행하세요.');
  process.exit(1);
}

const manifest = {
  version: pkg.version,
  buildAt: new Date().toISOString(),
};

const out = path.join(distDir, 'manifest.json');
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`[generate-manifest] ${out} 생성 — v${manifest.version} @ ${manifest.buildAt}`);
```

- [ ] **Step 2: 실행 권한 (Windows는 무관, Linux/Mac CI 호환)**

스크립트 자체는 node로 실행되므로 chmod 불필요. node 명령어로 호출.

- [ ] **Step 3: package.json build script 수정**

`package.json`의 `"scripts"` 안:

```diff
-    "build": "tsc && vite build && electron-builder",
-    "build:vite": "tsc && vite build",
+    "build": "tsc && vite build && electron-builder && node scripts/generate-manifest.js",
+    "build:vite": "tsc && vite build && node scripts/generate-manifest.js",
```

`build:vite`는 자동 업데이트 코드 검증용 — vite + manifest까지만 (electron-builder 생략).

- [ ] **Step 4: 빌드 검증**

```bash
npm run build:vite
ls dist/manifest.json
```
Expected: `dist/manifest.json` 생성됨. 내용에 `"version": "1.20.0"` (현재 버전, bump 전).

- [ ] **Step 5: 커밋**

```bash
git add scripts/generate-manifest.js package.json
git commit -m "feat(autoUpdate): 빌드 후 manifest.json 자동 생성"
```

---

## Chunk 2: Self-Installer (첫 실행 진입점)

### Task 2.1: `electron/autoUpdate/installer.ts`

**Files:**
- Create: `electron/autoUpdate/installer.ts`

- [ ] **Step 1: 파일 작성**

```ts
/**
 * v1.21.0 self-installer — 첫 실행 시 G드라이브 BFLOW.exe가 자기 자신을
 * `%LOCALAPPDATA%\Bflow-BGonly\app\` 로 복사하고 바로가기 생성 + Defender 옵션.
 *
 * spec §4.3, §4.4 참조.
 */
import { app, dialog, shell, BrowserWindow } from 'electron';
import { promises as fsp, existsSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import {
  isRunningFromGoogleDrive,
  findRemoteWinUnpacked,
  localRoot,
  localAppDir,
  localBflowExe,
} from './paths';
import { copyDirMirror } from './copy';

export interface InstallResult {
  /** 호출자가 자기 종료해야 하는지 (self-installer가 새 위치에서 spawn 했음) */
  exited: boolean;
}

/**
 * main.ts의 app.whenReady 진입 직후 한 번 호출.
 * - G드라이브에서 실행됐고 로컬 본체 없으면 → 첫 설치 (dialog → 복사 → spawn).
 * - G드라이브에서 실행됐고 로컬 본체 있으면 → 토스트 안내 + 로컬 spawn (옛 바로가기 폴백).
 * - 로컬에서 실행됐으면 → 그냥 정상 진행 (return { exited: false }).
 */
export async function runFirstInstallIfNeeded(): Promise<InstallResult> {
  // 로컬에서 실행 중이면 자동 업데이트 흐름 — 여긴 통과
  if (!isRunningFromGoogleDrive()) {
    return { exited: false };
  }

  const localExe = localBflowExe();
  const alreadyInstalled = existsSync(localExe);

  if (alreadyInstalled) {
    // 옛 바로가기 폴백 — 로컬 본체로 spawn하고 자기는 종료
    spawnDetached(localExe);
    app.exit(0);
    return { exited: true };
  }

  // 첫 설치 dialog
  const win = BrowserWindow.getFocusedWindow() ?? undefined;
  const choice = await dialog.showMessageBox(win!, {
    type: 'info',
    title: 'B flow 첫 실행',
    message: 'B flow 를 PC에 설치합니다 (한 번만, ~5초)',
    detail:
      '실행 속도를 위해 B flow 본체를 사용자 PC 폴더로 복사합니다.\n'
      + '설치 후 자동으로 새 위치에서 실행됩니다. 다음부터는 바탕화면 바로가기를 사용해주세요.',
    buttons: ['설치', '취소'],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice.response !== 0) {
    app.exit(0);
    return { exited: true };
  }

  try {
    await install();
  } catch (err) {
    console.error('[installer] 설치 실패:', err);
    await dialog.showMessageBox(win!, {
      type: 'error',
      title: 'B flow 설치 실패',
      message: '설치 중 오류가 발생했습니다',
      detail: String((err as Error).message ?? err),
      buttons: ['확인'],
    });
    app.exit(1);
    return { exited: true };
  }

  // Defender 제외 등록 (옵션, UAC 동의)
  await offerDefenderExclusion(win);

  // 새 위치에서 spawn + 자기 종료
  spawnDetached(localExe);
  app.exit(0);
  return { exited: true };
}

async function install(): Promise<void> {
  const remote = findRemoteWinUnpacked();
  if (!remote) {
    throw new Error('G드라이브 폴더에서 B flow 빌드를 찾을 수 없습니다. Drive desktop이 켜져있는지 확인해주세요.');
  }
  await fsp.mkdir(localRoot(), { recursive: true });
  await fsp.mkdir(localAppDir(), { recursive: true });
  await copyDirMirror(remote, localAppDir());
  await createDesktopShortcut();
  await createStartMenuShortcut();
}

async function createDesktopShortcut(): Promise<void> {
  const desktop = path.join(process.env.USERPROFILE || '', 'Desktop');
  if (!existsSync(desktop)) return;
  await createShortcut(path.join(desktop, 'B flow.lnk'));
}

async function createStartMenuShortcut(): Promise<void> {
  const startMenu = path.join(
    process.env.APPDATA || '',
    'Microsoft', 'Windows', 'Start Menu', 'Programs',
  );
  if (!existsSync(startMenu)) return;
  await createShortcut(path.join(startMenu, 'B flow.lnk'));
}

/**
 * Electron의 shell.writeShortcutLink는 Windows에서만 작동. asar 안 쓰니
 * iconPath/iconIndex로 BFLOW.exe 자체 아이콘 사용.
 */
async function createShortcut(lnkPath: string): Promise<void> {
  const exe = localBflowExe();
  const ok = shell.writeShortcutLink(lnkPath, 'create', {
    target: exe,
    icon: exe,
    iconIndex: 0,
    description: 'B flow — Studio JBBJ 워크플로우 대시보드',
  });
  if (!ok) console.warn('[installer] 바로가기 생성 실패:', lnkPath);
}

async function offerDefenderExclusion(parent: BrowserWindow | undefined): Promise<void> {
  const choice = await dialog.showMessageBox(parent!, {
    type: 'question',
    title: 'B flow — 빠른 시작 옵션',
    message: 'Windows 보안에 검사 제외 등록 (선택)',
    detail:
      'B flow 폴더를 Windows Defender 검사 제외로 등록하면 새 빌드를 받은 직후 첫 실행도 빠릅니다.\n'
      + '(허용 시 관리자 권한 한 번 요청)\n'
      + '\n'
      + '제외 폴더: ' + localRoot(),
    buttons: ['허용', '나중에'],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice.response !== 0) return;
  // PowerShell Add-MpPreference (UAC 자동) — 실패 시 그냥 진행
  const ps = `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command','Add-MpPreference -ExclusionPath ''${localAppDir()}''; Add-MpPreference -ExclusionPath ''${path.join(localRoot(), 'pending')}'''`;
  try {
    spawn('powershell.exe', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore' }).unref();
  } catch (err) {
    console.warn('[installer] Defender 제외 등록 실패:', err);
  }
}

function spawnDetached(exe: string): void {
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
}
```

- [ ] **Step 2: 의존: `copy.ts` 작성** (다음 task에서 만듦) — 일단 import만 두고 다음 step.

- [ ] **Step 3: 커밋** — copy.ts 만든 후 같이.

---

### Task 2.2: `electron/autoUpdate/copy.ts` (디렉토리 mirror 헬퍼)

**Files:**
- Create: `electron/autoUpdate/copy.ts`

- [ ] **Step 1: 파일 작성**

```ts
/**
 * 디렉토리 mirror — robocopy 패턴(변경된 파일만 복사 + 사라진 파일 제거).
 * Node fs API로 직접 구현 — 외부 robocopy.exe 의존성 X (CI/Mac 호환).
 *
 * 1억 byte 미만 — 우리 win-unpacked는 ~188MB이라 충분히 메모리/시간 OK.
 */
import { promises as fsp, existsSync, statSync } from 'fs';
import path from 'path';

/**
 * src의 모든 파일을 dst로 복사. dst에만 있는 파일은 제거 (mirror).
 * 같은 size + mtime이면 skip (빠른 변경분-only 복사).
 *
 * 진행률 콜백: 옵션. 없으면 조용히 복사.
 */
export async function copyDirMirror(
  src: string,
  dst: string,
  onProgress?: (relPath: string, copied: number, total: number) => void,
): Promise<void> {
  if (!existsSync(src)) throw new Error(`source 없음: ${src}`);
  await fsp.mkdir(dst, { recursive: true });

  const allFiles = await collectFiles(src);
  let copied = 0;
  for (const rel of allFiles) {
    const srcFile = path.join(src, rel);
    const dstFile = path.join(dst, rel);
    await fsp.mkdir(path.dirname(dstFile), { recursive: true });

    if (existsSync(dstFile)) {
      const ss = statSync(srcFile);
      const ds = statSync(dstFile);
      if (ss.size === ds.size && Math.abs(ss.mtimeMs - ds.mtimeMs) < 2000) {
        copied++;
        onProgress?.(rel, copied, allFiles.length);
        continue;
      }
    }
    await fsp.copyFile(srcFile, dstFile);
    copied++;
    onProgress?.(rel, copied, allFiles.length);
  }

  // dst 청소: src에 없는 파일 제거 (mirror)
  await pruneOrphans(src, dst);
}

async function collectFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await fsp.readdir(path.join(root, prefix), { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const rel = path.join(prefix, e.name);
    if (e.isDirectory()) {
      out.push(...await collectFiles(root, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

async function pruneOrphans(src: string, dst: string, prefix = ''): Promise<void> {
  const dstHere = path.join(dst, prefix);
  if (!existsSync(dstHere)) return;
  const entries = await fsp.readdir(dstHere, { withFileTypes: true });
  for (const e of entries) {
    const rel = path.join(prefix, e.name);
    const srcCounterpart = path.join(src, rel);
    if (e.isDirectory()) {
      if (!existsSync(srcCounterpart)) {
        await fsp.rm(path.join(dstHere, e.name), { recursive: true, force: true });
      } else {
        await pruneOrphans(src, dst, rel);
      }
    } else {
      if (!existsSync(srcCounterpart)) {
        await fsp.unlink(path.join(dstHere, e.name)).catch(() => { /* 락 무시 */ });
      }
    }
  }
}
```

- [ ] **Step 2: tsc 타입 체크 + 커밋 (installer + copy 같이)**

```bash
npx tsc --noEmit
git add electron/autoUpdate/installer.ts electron/autoUpdate/copy.ts
git commit -m "feat(autoUpdate): self-installer + mirror copy 헬퍼"
```

---

## Chunk 3: 백그라운드 체크 + 다운로드

### Task 3.1: `electron/autoUpdate/checker.ts`

**Files:**
- Create: `electron/autoUpdate/checker.ts`

- [ ] **Step 1: 파일 작성**

```ts
/**
 * v1.21.0 자동 업데이트 — 메인 창 로드 후 5초 뒤 한 번 호출.
 * G드라이브 manifest와 자기 버전 비교 → 새 버전이면 pending/으로 변경분 복사
 * + .ready 마커 생성. swap은 swapper.ts가 종료 시 처리.
 */
import { promises as fsp, existsSync } from 'fs';
import {
  findRemoteWinUnpacked,
  findRemoteManifest,
  localPendingDir,
  localReadyMarker,
  getOwnVersion,
} from './paths';
import { readManifest, compareVersions } from './manifest';
import { copyDirMirror } from './copy';

/**
 * 백그라운드 체크 — 한 번만 실행. 실패는 console.warn만 (사용자 알림 X).
 * spec §4.2 일상 사용 시나리오.
 */
export async function scheduleUpdateCheck(): Promise<void> {
  try {
    const remoteManifestPath = findRemoteManifest();
    if (!remoteManifestPath) {
      console.log('[autoUpdate] G드라이브 manifest 없음 — skip');
      return;
    }
    const remote = await readManifest(remoteManifestPath);
    if (!remote) {
      console.log('[autoUpdate] G드라이브 manifest 읽기 실패 — skip');
      return;
    }
    const own = getOwnVersion();
    const cmp = compareVersions(remote.version, own);
    if (cmp <= 0) {
      console.log(`[autoUpdate] 최신 (own=${own}, remote=${remote.version})`);
      return;
    }
    console.log(`[autoUpdate] 새 버전 감지: ${own} → ${remote.version}. 백그라운드 다운로드 시작.`);
    await downloadToPending();
    console.log(`[autoUpdate] 다운로드 완료. 다음 종료 시 swap.`);
  } catch (err) {
    console.warn('[autoUpdate] 체크 실패:', err);
  }
}

async function downloadToPending(): Promise<void> {
  const remoteWinUnpacked = findRemoteWinUnpacked();
  if (!remoteWinUnpacked) throw new Error('원격 win-unpacked 없음');

  // pending이 .ready 상태(이전 다운로드 완료)인 경우는 그대로 둠 — swap만 기다림
  const ready = localReadyMarker();
  if (existsSync(ready)) {
    console.log('[autoUpdate] pending이 이미 ready 상태 — 추가 다운로드 skip');
    return;
  }

  const pending = localPendingDir();
  await fsp.mkdir(pending, { recursive: true });

  // mirror 복사 (변경된 파일만)
  await copyDirMirror(remoteWinUnpacked, pending);

  // .ready 마커 — swapper가 이걸 보고 swap 실행
  await fsp.writeFile(ready, new Date().toISOString(), 'utf-8');
}
```

- [ ] **Step 2: tsc + 커밋**

```bash
npx tsc --noEmit
git add electron/autoUpdate/checker.ts
git commit -m "feat(autoUpdate): 백그라운드 체크 + pending 다운로드"
```

---

## Chunk 4: 종료 시 swap

### Task 4.1: `electron/autoUpdate/swapper.ts`

**Files:**
- Create: `electron/autoUpdate/swapper.ts`

- [ ] **Step 1: 파일 작성**

```ts
/**
 * v1.21.0 자동 업데이트 — before-quit hook에서 호출.
 * pending/.ready 가 있으면 app/ → backup/ , pending/ → app/ 으로 swap.
 *
 * 락 안전성: app/은 현재 실행 중 BFLOW.exe라 락 걸려있으나, 우리는 종료 시점에
 * 호출. before-quit → app.exit 사이에 한순간 더 락이 풀리는 시점이 필요.
 * → before-quit에서 event.preventDefault → 약간 지연 후 swap → app.exit.
 *
 * spec §4.2 step 6, §6 swap 실패 처리.
 */
import { promises as fsp, existsSync, renameSync } from 'fs';
import path from 'path';
import {
  localAppDir, localPendingDir, localBackupDir, localReadyMarker,
} from './paths';

export async function hasPending(): Promise<boolean> {
  return existsSync(localReadyMarker());
}

/**
 * 동기로 진행 — before-quit hook 안에서 호출되니 짧고 결정론적이어야 함.
 * 실패 시 throw — 호출자가 catch.
 */
export async function swapIfPending(): Promise<{ ok: boolean; reason?: string }> {
  const ready = localReadyMarker();
  if (!existsSync(ready)) return { ok: false, reason: 'no-pending' };

  const app_ = localAppDir();
  const pending_ = localPendingDir();
  const backup_ = localBackupDir();

  // 이전 backup 정리 (이전 buggy 버전 보관 — 1개만 유지하니 통째로 지움)
  try {
    if (existsSync(backup_)) {
      await fsp.rm(backup_, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('[swapper] backup 정리 실패 (무시):', err);
  }

  // app/ → backup/
  try {
    if (existsSync(app_)) {
      renameSync(app_, backup_);
    }
  } catch (err) {
    return { ok: false, reason: `app→backup rename 실패: ${(err as Error).message}` };
  }

  // pending/ → app/
  try {
    renameSync(pending_, app_);
  } catch (err) {
    // 복구 시도: backup → app으로 되돌림
    try { renameSync(backup_, app_); } catch { /* 더 이상 할 게 없음 */ }
    return { ok: false, reason: `pending→app rename 실패: ${(err as Error).message}` };
  }

  // .ready 마커는 pending 안에 있어 자동으로 app/.ready가 됨 — 정리
  try {
    const stale = path.join(app_, '.ready');
    if (existsSync(stale)) await fsp.unlink(stale);
  } catch { /* 무시 */ }

  return { ok: true };
}
```

- [ ] **Step 2: tsc + 커밋**

```bash
npx tsc --noEmit
git add electron/autoUpdate/swapper.ts
git commit -m "feat(autoUpdate): 종료 시 pending → app swap (rollback 안전)"
```

---

## Chunk 5: 통합 모듈 + main.ts 연결

### Task 5.1: `electron/autoUpdate/index.ts` (단일 진입점)

**Files:**
- Create: `electron/autoUpdate/index.ts`

- [ ] **Step 1: 파일 작성**

```ts
/**
 * v1.21.0 자동 업데이트 — main.ts가 import하는 단일 진입점.
 * 다른 모듈은 main.ts가 직접 import하지 않음.
 */
export { runFirstInstallIfNeeded } from './installer';
export type { InstallResult } from './installer';
export { scheduleUpdateCheck } from './checker';
export { swapIfPending, hasPending } from './swapper';
```

- [ ] **Step 2: tsc + 커밋**

```bash
npx tsc --noEmit
git add electron/autoUpdate/index.ts
git commit -m "feat(autoUpdate): 단일 진입점 index.ts"
```

---

### Task 5.2: `electron/main.ts` 통합

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: import 추가** — 기존 import 블록 끝에:

```ts
import {
  runFirstInstallIfNeeded,
  scheduleUpdateCheck,
  hasPending,
  swapIfPending,
} from './autoUpdate';
```

- [ ] **Step 2: app.whenReady 진입 직후에 self-installer 진입점 추가**

기존 코드 (Pre-existing perf 변경된 상태):
```ts
app.whenReady().then(async () => {
  // 두 번째 인스턴스면 초기화하지 않고 종료
  if (!gotTheLock) return;

  // ★ v1.20.x perf: 스플래시를 가장 먼저 띄움
  createSplashWindow();
  console.time('splash-to-main');

  // 메인 창 bounds 미리 로드 …
  await preloadMainWindowBounds();
```

수정 — `gotTheLock` 체크 직후 + splash 호출 *전*에 self-installer:

```ts
app.whenReady().then(async () => {
  // 두 번째 인스턴스면 초기화하지 않고 종료
  if (!gotTheLock) return;

  // v1.21.0 자동 업데이트: G드라이브 BFLOW.exe로 첫 실행이면 로컬에 설치 후 새 위치에서 spawn.
  // 이미 로컬에서 실행 중이면 즉시 통과.
  const installResult = await runFirstInstallIfNeeded();
  if (installResult.exited) return; // 자기 종료 — 새 위치 BFLOW가 마운트됨

  // ★ v1.20.x perf: 스플래시를 가장 먼저 띄움
  createSplashWindow();
  // … 이하 기존 그대로
```

- [ ] **Step 3: did-finish-load 후 5초 백그라운드 체크**

기존 main 창 생성 코드에서 `did-finish-load` 핸들러를 찾아 안에 추가:

```ts
mainWindow.webContents.once('did-finish-load', () => {
  // … 기존 hooks (mainLoadedOk = true 등)

  // v1.21.0: 5초 후 백그라운드 업데이트 체크 (한 번만)
  setTimeout(() => {
    scheduleUpdateCheck().catch((err) => console.warn('[autoUpdate] 체크 실패:', err));
  }, 5_000);
});
```

(정확한 anchor는 `did-finish-load`의 기존 콜백. 거기 본문 끝에 setTimeout 한 줄 추가)

- [ ] **Step 4: before-quit hook 추가 (swap)**

`app.on('before-quit', ...)`이 이미 있는지 확인. 없으면 신설:

```ts
let swapInFlight = false;
app.on('before-quit', async (event) => {
  if (swapInFlight) return; // 무한 루프 방지
  if (!(await hasPending())) return;

  event.preventDefault();
  swapInFlight = true;
  try {
    const result = await swapIfPending();
    if (!result.ok) console.warn('[autoUpdate] swap 실패:', result.reason);
    else console.log('[autoUpdate] swap 완료 — 다음 실행 = 새 버전');
  } catch (err) {
    console.warn('[autoUpdate] swap 예외:', err);
  } finally {
    setImmediate(() => app.exit(0));
  }
});
```

이미 있는 경우는 기존 로직 끝에 swap 호출 추가.

- [ ] **Step 5: tsc + 빌드 검증**

```bash
npx tsc --noEmit
npm run build:vite
ls dist/manifest.json dist-electron/main.js
```
Expected: 모두 PASS.

- [ ] **Step 6: 커밋**

```bash
git add electron/main.ts
git commit -m "feat(autoUpdate): main.ts 통합 — 첫 실행 self-installer + 백그라운드 체크 + 종료 swap"
```

---

## Chunk 6: 자가 검증 + 롤백 안전장치

spec §6: "새 버전 깨졌음 (앱 시작 실패) → backup\ 의 이전 버전을 자동으로 app\ 으로 되돌리는 안전장치 (5초 안에 메인 창 못 띄우면 롤백)"

### Task 6.1: `electron/autoUpdate/healthCheck.ts`

**Files:**
- Create: `electron/autoUpdate/healthCheck.ts`

- [ ] **Step 1: 파일 작성**

```ts
/**
 * v1.21.0 자가 검증 — 앱 시작 실패 시 backup/ 자동 롤백.
 *
 * 메커니즘: 시작 시 .start-attempt 마커 작성 → 메인 창 did-finish-load 시점에
 * 마커 삭제. 다음 시작 때 마커가 남아있으면 = 이전 시작이 도중 실패 → 롤백.
 *
 * 5초 타임아웃은 main.ts의 기존 30초 timeout과 별개 — healthCheck는 더 빨리 fail.
 * 단, 우리는 메인 창 띄우기까지 기다리고 timeout 정책은 main.ts에 위임.
 *
 * spec §6 "swap 실패 / 새 버전 깨짐" 처리.
 */
import { promises as fsp, existsSync, renameSync } from 'fs';
import path from 'path';
import { localAppDir, localBackupDir, localRoot } from './paths';

const ATTEMPT_MARKER = path.join(localRoot(), '.start-attempt');

/**
 * app.whenReady 직후 — 마커 검사 + 롤백 + 새 마커 작성.
 * 호출자: runFirstInstallIfNeeded 다음, 메인 창 생성 전.
 *
 * @returns rolledBack: true면 backup → app으로 되돌렸음 (현재 실행은 옛 버전이 아니라
 *          기존 v 그대로 — 이미 main process는 옛 코드로 evaluate됨. 롤백은 *다음 실행*용).
 *          단 옛 버전이 *현재 실행 중인 코드*는 아닐 수 있음 (swap 직후 실행). 위험 있음 →
 *          현 단계에선 단순 롤백만 하고 사용자에게 dialog로 안내.
 */
export async function checkLastStartAndRollback(): Promise<{ rolledBack: boolean }> {
  const hadFailure = existsSync(ATTEMPT_MARKER);
  if (hadFailure) {
    // 이전 시작이 메인 창까지 못 갔음 → 새 빌드 깨짐 가능성
    const app_ = localAppDir();
    const backup_ = localBackupDir();
    if (existsSync(backup_)) {
      try {
        // app/ → tmp 로 옮김 (실패한 빌드는 보존, 진단용)
        const corrupt = path.join(localRoot(), '.corrupt-' + Date.now());
        if (existsSync(app_)) renameSync(app_, corrupt);
        renameSync(backup_, app_);
        await fsp.unlink(ATTEMPT_MARKER).catch(() => {});
        console.warn('[healthCheck] 이전 시작 실패 감지 → backup/ 으로 롤백 완료. 손상된 빌드는', corrupt);
        return { rolledBack: true };
      } catch (err) {
        console.error('[healthCheck] 롤백 실패:', err);
      }
    } else {
      console.warn('[healthCheck] 이전 시작 실패 감지했으나 backup 없음 — 롤백 불가');
    }
  }
  // 새 마커 작성 — did-finish-load 시 markStartSucceeded()로 삭제
  try {
    await fsp.mkdir(localRoot(), { recursive: true });
    await fsp.writeFile(ATTEMPT_MARKER, new Date().toISOString(), 'utf-8');
  } catch (err) {
    console.warn('[healthCheck] 마커 쓰기 실패:', err);
  }
  return { rolledBack: false };
}

/** 메인 창 did-finish-load 시 호출 — 정상 시작 표시. */
export async function markStartSucceeded(): Promise<void> {
  try {
    if (existsSync(ATTEMPT_MARKER)) await fsp.unlink(ATTEMPT_MARKER);
  } catch (err) {
    console.warn('[healthCheck] 마커 삭제 실패:', err);
  }
}
```

- [ ] **Step 2: index.ts에 export 추가**

```ts
export { checkLastStartAndRollback, markStartSucceeded } from './healthCheck';
```

- [ ] **Step 3: main.ts 통합**

`runFirstInstallIfNeeded` 직후에 추가:

```ts
const installResult = await runFirstInstallIfNeeded();
if (installResult.exited) return;

// v1.21.0: 이전 시작 실패 감지 + 자동 롤백
await checkLastStartAndRollback();
```

`did-finish-load` 콜백 안에:

```ts
mainWindow.webContents.once('did-finish-load', () => {
  markStartSucceeded().catch(() => {});
  // ... 기존 hooks
  setTimeout(() => scheduleUpdateCheck().catch(...), 5_000);
});
```

- [ ] **Step 4: tsc + 빌드 + 커밋**

```bash
npx tsc --noEmit
npm run build:vite
git add electron/autoUpdate/healthCheck.ts electron/autoUpdate/index.ts electron/main.ts
git commit -m "feat(autoUpdate): 자가 검증 + 시작 실패 시 backup 자동 롤백"
```

---

## Chunk 7: 빌드 + 수동 검증 + 버전 + PR

### Task 7.1: 풀 빌드 + manifest 확인

- [ ] **Step 1: 버전 bump**

`package.json` version → `1.21.0` (spec §1, §3에 명시된 형식).

- [ ] **Step 2: 풀 electron-builder 빌드**

```bash
npm run build
```
Expected:
- `dist/BFLOW.exe` (portable, 자동 self-installer 진입점)
- `dist/win-unpacked/BFLOW.exe` (로컬 본체용)
- `dist/manifest.json` (`{ "version": "1.21.0", "buildAt": "..." }`)
- `dist-electron/main.js` 등

- [ ] **Step 3: 산출물 검증**

```bash
cat dist/manifest.json
ls dist/win-unpacked/BFLOW.exe dist/BFLOW.exe
```

- [ ] **Step 4: 커밋**

```bash
git add package.json
git commit -m "chore(release): v1.21.0 — 자동 업데이트 시스템"
```

---

### Task 7.2: 수동 시나리오 테스트

**한솔 PC에서 직접 — 빌드 직후 (G드라이브 동기화 *하지 말고* 먼저 검증):**

- [ ] **시나리오 A: 첫 설치**
  - `dist/BFLOW.exe` (portable) 더블클릭 → "B flow 를 PC에 설치합니다 (한 번만, ~5초)" dialog
  - 설치 클릭 → 5~30초 후 새 위치에서 BFLOW 실행 (스플래시 → 메인 창 1~2초)
  - `%LOCALAPPDATA%\Bflow-BGonly\app\BFLOW.exe` 존재 확인
  - 바탕화면에 "B flow.lnk" 생성 확인
  - Defender 제외 dialog 등장 → "허용" 클릭 → UAC → PowerShell 백그라운드 실행

- [ ] **시나리오 B: 일상 사용**
  - 바탕화면 "B flow" 더블클릭 → 1~2초 시작 (Defender 캐시)
  - 알림 패널의 🐢 시작 시간 분석에서 측정값 확인 (이게 1~2초 나오는지)
  - 메인 창 정상 동작 확인

- [ ] **시나리오 C: 옛 바로가기 폴백 (이미 설치된 후 G드라이브 BFLOW 클릭)**
  - `dist/BFLOW.exe` 다시 더블클릭
  - 토스트 또는 즉시 종료 후 로컬 BFLOW 실행 (사고 없음)

- [ ] **시나리오 D: 백그라운드 업데이트** (G드라이브 동기화 후)
  - 한솔이 v1.21.0 빌드 + G드라이브에 robocopy
  - 로컬 BFLOW 켜진 상태에서 v1.21.1로 코드 변경 + 다시 빌드 + robocopy
  - 다음 메인 창 로드 후 5초쯤 console에 "새 버전 감지: 1.21.0 → 1.21.1" log
  - `%LOCALAPPDATA%\Bflow-BGonly\pending\.ready` 존재 확인
  - BFLOW 종료 → swap 진행 (10초 내) → app.exit
  - 다시 켜면 v1.21.1 (메인 창에 버전 표시 또는 alert로 확인)
  - `backup\` 폴더에 v1.21.0 존재 확인

- [ ] **시나리오 E: G드라이브 sync 안 끝남**
  - G드라이브에 v1.21.1 partial 상태 (manifest는 있는데 파일 일부 없음)
  - 백그라운드 다운로드 중 mirror copy 일부 실패 → console.warn만, pending/.ready 안 만들어짐
  - 종료 → swap 안 됨 → 다음 실행 = 자기 버전 그대로

- [ ] **시나리오 F: 새 버전 깨짐 (롤백)**
  - pending에 일부러 corrupt BFLOW.exe 넣고 swap → 다음 실행 메인 창 못 띄움
  - 다음 실행 (3번째) 시 .start-attempt 마커 감지 → backup → app 롤백 → corrupt 빌드는 `.corrupt-<ts>`로 보존

- [ ] **시나리오 G: Defender 제외 거부**
  - 첫 설치 시 Defender dialog "나중에" 클릭 → 정상 진행
  - 새 빌드 직후 첫 실행 약 10초 (Defender 풀 스캔), 이후 1~2초

각 시나리오 검증 결과를 PR 본문 테스트 가이드에 체크리스트로 포함.

---

### Task 7.3: 한솔 검증 + G드라이브 배포

⚠️ **한솔 명시 시에만 진행** (메모: PR 머지 자제 / G드라이브 robocopy 자제).

- [ ] **Step 1: PR 생성** (한솔 review용)

- [ ] **Step 2: 한솔이 머지 명시 시 — main에 머지**

- [ ] **Step 3: 한솔이 G드라이브 배포 명시 시 — robocopy**

```bash
robocopy <local dist> <G드라이브 dist> /MIR /R:1 /W:1
```

- [ ] **Step 4: 팀원 마이그레이션 검증** — spec §9
  - 팀원 1명에게 옛 바로가기 클릭 부탁
  - self-installer dialog → 설치 → 새 바로가기 자동 생성 확인
  - 다음 실행 1~2초 확인

---

## 완료 기준

- ✅ 모든 chunk 빌드 통과 (tsc --noEmit + vite build + electron-builder)
- ✅ 시나리오 A~F 한솔 PC에서 수동 검증 통과
- ✅ `dist/manifest.json` 자동 생성
- ✅ `%LOCALAPPDATA%\Bflow-BGonly\` 디렉토리 구조 (`app/`, `pending/`, `backup/`) 정상 동작
- ✅ 첫 실행 dialog "B flow 를 PC에 설치합니다 (한 번만, ~5초)" 그대로
- ✅ Defender 제외 등록 옵션 dialog 정상
- ✅ 백그라운드 업데이트 후 swap → 다음 실행 새 버전
- ✅ 시작 실패 시 backup 자동 롤백
- ✅ 옛 바로가기 폴백 (이미 설치된 후 G드라이브 BFLOW 클릭) 사고 없음

## 영향 받지 않는 영역 (변경 없음)

- 사용자 데이터(`%APPDATA%\Bflow-BGonly\`) — 설정/이미지 그대로
- Supabase 통신
- 빌드 워크플로우 (`npm run build`만 실행 step 1줄 추가)
- G드라이브 robocopy 흐름

## 진단 코드 처리 (이 plan에서는 X — 별도 commit/PR)

spec §10대로, 자동 업데이트로 1~2초 검증 후 한솔이 직접 명시할 때 진단 코드(electron/main.ts의 `__t_*` 변수, preload.ts의 `onStartupPerf`, types/index.ts, App.tsx의 useEffect) 별도 commit으로 제거.

---

*Plan 끝. 실행은 위에서 아래로 순차. chunk별로 빌드 검증 + 커밋. 한솔 review 후 구현 시작.*
