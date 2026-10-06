# B flow 자동 업데이트 운영 기준

> 마지막 갱신: 2026-05-08
> 현재 기준: v1.22.19
> 이 문서가 자동 업데이트/배포 판단의 1차 기준이다. 옛 설계 문서와 충돌하면 이 문서를 우선한다.

---

## 1. 목표

팀원은 로컬 PC에 설치된 `BFLOW.exe`를 빠르게 실행한다. G드라이브는 실행 위치가 아니라 새 빌드를 배포하는 창고로만 쓴다.

이 구조로 바꾼 이유:

- G드라이브의 실행 파일을 직접 열면 Google Drive 동기화와 Windows Defender 검사 때문에 매번 시작이 느려졌다.
- 로컬 설치본은 Defender 캐시가 유지되어 앱을 다시 여는 속도가 훨씬 안정적이다.
- 한솔은 계속 `C:\Bflow-BGonly`에서 작업하고, PR/머지 후 G드라이브 `dist`에 배포하면 팀원 앱이 업데이트를 감지한다.
- 팀원은 앱 사용 중에는 토스트/좌하단 버전 버튼/업데이트 모달로 새 버전을 보고, 새로 앱을 켤 때는 스플래시에서 최신 버전 준비 상태를 본다.

---

## 2. 현재 정답 구조

### 실행 위치

| 구분 | 경로 |
|---|---|
| 개발 워크트리 | `C:\Bflow-BGonly` |
| 로컬 빌드 결과 | `C:\Bflow-BGonly\dist` |
| 배포 채널 | `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist` |
| 팀원 설치본 | `%LOCALAPPDATA%\Programs\BFLOW\BFLOW.exe` 또는 `%LOCALAPPDATA%\Programs\bflow\BFLOW.exe` |
| 자동 업데이트 마커/로그 | `%LOCALAPPDATA%\Bflow-BGonly` |
| 사용자 설정 | `%APPDATA%\Bflow-BGonly` |

팀원이 매일 눌러야 하는 것은 바탕화면 또는 시작 메뉴의 `B flow` 바로가기다. G드라이브의 `win-unpacked\BFLOW.exe`를 매번 누르는 방식은 폐기됐다.

### 배포 산출물

`npm run build` 후 `dist`에 반드시 있어야 하는 핵심 파일:

| 파일 | 역할 |
|---|---|
| `BFLOW-Setup.exe` | 자동 업데이트와 수동 복구의 실제 적용 파일 |
| `manifest.json` | 앱이 최신 버전을 감지하는 신호. 반드시 마지막에 배포 |
| `latest.yml` | NSIS/electron-builder 메타데이터 |
| `win-unpacked\` | 빌드 검증/레거시 첫 실행 fallback용 산출물 |

`manifest.json`에는 최소한 `version`, `buildAt`, `installer.fileName`, `installer.sizeBytes`, `releaseNotes`가 들어가야 한다.

### 휴가 연동 토큰 (v1.128.1~)

휴가 API(`x-bflow-token`) 토큰은 레포에 커밋하지 않고 빌드할 때 화면 묶음에 넣는다. 값은 `.env.local` 의 `BFLOW_VACATION_TOKEN` 한 줄이고, 이 파일은 gitignore 라 **메인 체크아웃(`C:\Bflow-BGonly`)에만 있다.**

- 찾는 순서(`scripts/vacation-token.cjs`): 셸 환경변수 → 빌드 폴더의 `.env*` → 워크트리라면 메인 체크아웃의 `.env*`. 그래서 워크트리에서 빌드해도 토큰이 들어간다.
- `npm run build` 는 **첫 단계**에서 토큰을 못 찾으면 멈추고, **마지막 단계**(`generate-manifest.js`)는 `dist/assets` 와 `dist/win-unpacked/resources/app/dist/assets` 에 토큰이 실제로 들어 있을 때만 `manifest.json` 을 쓴다. `manifest.json` 이 없으면 배포가 성립하지 않는다. 두 묶음은 **둘 다 있어야 한다** — 설치 파일(`BFLOW-Setup.exe`)은 속을 볼 수 없어 같은 빌드의 `win-unpacked` 사본으로 확인하므로, 사본 없이 예전 설치 파일만 남은 상태로는 통과하지 않는다.
- `.env.local` 의 토큰 줄은 `BFLOW_VACATION_TOKEN=값`(따옴표로 감싸도 됨)처럼 **값을 그대로** 적는다. 변수 확장(`${...}`)·역슬래시·여러 줄 값은 읽지 않고 오류로 멈춘다 — 풀지 않은 글자가 토큰으로 묶음에 들어가면 확인은 통과하는데 서버가 거부하는 빌드가 되기 때문이다.
- 개발용 `build:vite` 는 토큰 없이도 통과한다(다른 PC·CI). 그 결과물은 배포하지 않는다.
- 토큰 값은 로그·PR·문서·채팅 어디에도 적지 않는다. 확인은 "들어 있다/없다"와 출처로만 한다.
- 배경: v1.127.5·v1.128.0 을 `.env.local` 이 없는 워크트리에서 빌드해 토큰이 빈 채로 배포됐고, 팀 PC 의 휴가 연동이 '인증 토큰이 유효하지 않습니다'로 끊겼다. 빌드는 경고 없이 통과했다.

### 앱 안에 빌드 산출물을 다시 담지 않는다 (v1.128.2~)

화면 묶음 폴더(vite)와 electron-builder 출력 폴더가 둘 다 `dist` 다. 화면 묶음을 앱에 담으려고 `package.json` `build.files` 에 `dist/**/*` 가 있는데, electron-builder 는 런타임을 먼저 `dist/win-unpacked` 에 풀고 그 다음에 앱 파일을 모으기 때문에 **방금 푼 런타임이 앱 안(`resources/app/dist/win-unpacked`)으로 한 번 더 복사된다.** vite 정리 없이 패키징만 다시 돌리면 이전 `BFLOW-Setup.exe`·`latest.yml`·`manifest.json` 까지 같이 들어간다.

- 막는 규칙(`build.files`, `dist/**/*` **바로 뒤**): `!dist/*-unpacked{,/**/*}`, `!dist/*.{exe,blockmap,yml,yaml,7z}`, `!dist/manifest.json`. 뒤에 오는 규칙이 앞 규칙을 덮으므로 순서를 바꾸면 듣지 않는다.
- electron-builder 에도 같은 자동 제외(`!dist/*-unpacked`)가 있지만 24.13.3 에서는 `files` 를 문자열 목록으로 쓰면 적용되지 않는다(설정을 읽으며 목록이 묶음 하나로 바뀌고, 자동 제외는 버려지는 쪽에 붙는다). 그래서 직접 적는다.
- `generate-manifest.js` 는 결과물의 화면 폴더(`dist/win-unpacked/resources/app/dist`)에 vite 가 만든 것(`index.html`·`assets`·`public` 에서 복사된 항목) 말고 다른 것이 있으면 `manifest.json` 을 쓰지 않는다. `public/` 에 폴더를 더하면 자동으로 허용된다.
- 제외 규칙은 출처를 가리지 않는다. `public/` **맨 위**에 `manifest.json`, `*.exe`·`*.blockmap`·`*.yml`·`*.yaml`·`*.7z` 파일이나 `*-unpacked` 폴더를 두면 화면 묶음(`dist`)에는 복사되지만 앱에는 담기지 않는다(위 확인도 빠진 것은 보지 않는다). 그런 이름이 필요하면 하위 폴더에 둔다.
- 크기 기준(v1.128.2): `win-unpacked` 약 396MB(7,140개), `BFLOW-Setup.exe` 약 115MB. 설치 파일이 190MB 를 넘으면 이 문제가 되살아난 것이다.
- 출력 폴더(`directories.output`)는 바꾸지 않는다. 배포 절차·`generate-manifest.js`·G드라이브 탐색(`electron/autoUpdate/paths.ts`)이 모두 `dist` 를 전제로 한다.
- 배경: v1.128.1 까지 런타임 한 벌(71개, 268MB)이 앱 안에 더 들어가 `win-unpacked` 664MB, 설치 파일 192MB 였다. 설치된 앱도 그만큼 컸다.

### 의존성 목록에 프로젝트 폴더를 적지 않는다 (v1.128.3~)

electron-builder 는 `package.json` `dependencies` 에 적힌 것을 앱의 `node_modules` 로 담는다. 폴더를 가리키는 항목(`file:…`, 상대·절대 경로)이 있고 그 폴더가 실제로 있으면, 폴더 내용(소스·`.env.local`·`dist` 의 옛 런타임과 설치 파일)이 `resources/app/node_modules/<이름>` 으로 통째로 들어간다. 위의 화면 폴더 확인은 `resources/app/dist` 만 보므로 이 경로는 잡지 못한다.

- `tests/packagedAppContents.test.ts` 가 `package.json` 의 의존성이 전부 npm 저장소 표기인지, `package-lock.json` 에 폴더 연결(`link` 항목, `node_modules/` 밖의 항목)이 없는지 확인한다. 배포 빌드의 테스트 묶음(`test:auto-update`)에 들어 있어서, 걸리면 패키징 전에 멈춘다.
- 워크트리 경로를 `npm install` 에 넘기지 않는다. `npm install <폴더>` 는 그 폴더를 의존성으로 적는다.
- lock 에서 지울 때 `npm install --package-lock-only` 만으로는 끝나지 않는다. 연결 대상 항목이 `"extraneous": true` 로 남고 다시 돌려도 그대로다. 그 항목까지 직접 지운 뒤, 다시 돌려도 lock 이 한 글자도 바뀌지 않는지와 `npm ci` 통과를 확인한다.
- 배경: v1.24.1 ~ v1.128.2 의 `dependencies` 에 `"bflow": "file:.claude/worktrees/hardcore-bardeen-8d3837"` 가 들어 있었다. 그 폴더가 지워진 뒤라 끊어진 연결만 남아 결과물에는 들어가지 않았다(그 자리에 폴더를 만들어 패키징하면 들어가는 것을 확인했다). 이미 설치된 폴더들의 끊어진 `node_modules\bflow` 는 새 lock 을 받은 뒤 `npm install` 한 번이면 npm 이 지운다. 손으로 지울 때는 `cmd /c rmdir` 로 링크만 끊는다.

---

## 3. 동작 흐름

### 앱 시작 시

1. 로컬 `B flow` 바로가기로 `BFLOW.exe` 실행.
2. 스플래시 표시.
3. G드라이브 `manifest.json`을 읽고 현재 버전과 비교.
4. 새 버전이 있으면 최대 10초 동안 `BFLOW-Setup.exe`를 `%LOCALAPPDATA%\Bflow-BGonly\installer-pending`에 준비.
5. 10초 안에 준비되면 installer helper를 띄우고 앱을 닫는다.
6. helper는 BFLOW 프로세스가 완전히 종료된 뒤 `BFLOW-Setup.exe /S`를 실행한다.
7. 설치가 끝나면 최신 `BFLOW.exe`가 열린다.
8. 10초를 넘기거나 준비 실패 시 현재 버전으로 먼저 진입하고, 앱 안에서 계속 상태를 표시한다.

### 앱 사용 중

1. 메인 창 로드 후 업데이트 상태를 공유한다.
2. 5분 주기로 G드라이브 manifest를 다시 확인한다.
3. 새 버전이 있으면 installer를 백그라운드로 준비한다.
4. 준비 완료 시 지속 토스트, 좌하단 버전 버튼 배지, 업데이트 모달에 표시한다.
5. 사용자가 `지금 업데이트`를 누르면 installer helper가 즉시 적용한다.
6. 사용자가 일반 종료만 하면 준비된 installer를 유지하고, 다음 앱 실행의 startup gate가 자동 적용한다.

### 버전 모달 UX

- v1.117.4부터 새 로그인은 서버 확인이 필수다. 서버 불가 시 PC의 옛 사용자 목록·비밀번호로 인증하지 않고 연결·업데이트 안내를 표시한다. 계정·설정 파일을 지우는 복구를 안내하지 않는다. 로그인 유지 토큰의 기존 복원 정책은 별도이며 이번 변경은 전체 세션의 즉시 종료를 뜻하지 않는다.
- 구버전도 로그인 전 시작/백그라운드 업데이트를 받을 수 있지만 배포만으로 실행 중인 앱이 바뀌지는 않는다. 준비 후 트레이 메뉴 `종료` → 바로가기로 재실행한다. 창의 X는 숨기기이므로 재시작이 아니다. 자동 업데이트가 중단된 구버전에는 정식 설치 파일 수동 실행이 필요할 수 있다.

- 좌하단 버전 버튼은 업데이트 유무와 관계없이 항상 열린다.
- v1.117.1부터 로그인 화면에서도 현재 버전과 `업데이트 내역` 버튼을 제공한다. 로그인 없이 같은 모달에서 새로고침·준비된 업데이트 적용·실패 재시도를 할 수 있다. 로그인 후 스플래시에는 이 버튼을 표시하지 않는다.
- 브라우저 테스트 모드의 업데이트는 `-preview` 가상 버전으로 준비·적용·완료를 재현한다. 화면에 프리뷰 전용임을 표시하며 실제 설치 파일 다운로드·앱 종료·설치 버전 변경은 하지 않는다.
- 모달은 열자마자 자동 확인하지 않는다.
- `새로고침` 버튼을 눌렀을 때만 `update:check-now`로 배포 상태를 확인한다.
- 새로고침 중에는 기존 표시 내용을 고정해 모달 레이아웃이 흔들리지 않게 한다.
- 최신 3개 업데이트 내역은 기본 표시하고, 이전 내역은 `이전 업데이트 내역 N개 보기`로 펼친다.
- `DEVLOG/update-notes.json`의 과거 항목은 사용자에게 보이는 기록이므로 삭제하지 않는다.
- (v1.44.2) 이전 적용 실패로 `자동 중단`(suppressed) 상태가 되면 모달 푸터의 주 버튼이 `다시 시도`로 바뀐다. 누르면 `update:retry` IPC가 `.swap-suppressed`/`.installer-attempted` 표식을 지우고 즉시 재확인해 자동 업데이트를 재개시킨다. `새로고침`만으로는 같은 버전에서 suppression이 풀리지 않으므로, 사용자가 앱 안에서 빠져나오는 경로는 `다시 시도`다.

---

## 4. 절대 하지 말 것

- 실행 중 앱 폴더를 직접 rename/copy해서 업데이트하지 말 것.
- `helperSwap.ts`/`swapper.ts` 기반의 directory swap 방식을 되살리지 말 것.
- 토스트가 떴다는 이유만으로 업데이트 성공이라고 판단하지 말 것.
- `manifest.json`을 다른 파일보다 먼저 G드라이브에 올리지 말 것.
- `build:vite`의 `--allow-missing-installer` 결과를 정식 배포로 쓰지 말 것.
- 휴가 연동 토큰 확인(`npm run build` 의 첫 단계와 `generate-manifest.js` 의 묶음 확인)을 건너뛰거나 지우지 말 것. `vite build`·`electron-builder` 를 따로 돌려 만든 결과물에 손으로 `manifest.json` 을 붙여 배포하지 말 것.
- `package.json` `build.files` 의 `!dist/…` 제외 규칙 세 줄을 지우거나 `dist/**/*` 앞으로 옮기지 말 것. 앱 안에 런타임·이전 설치 파일이 한 번 더 들어가 설치 파일이 190MB 이상으로 커진다.
- `DEVLOG/update-notes.json`에서 과거 버전 기록을 정리한다며 삭제하지 말 것.
- PowerShell helper를 TypeScript 백틱 문자열 안에 쓸 때 PowerShell 변수를 `${name}`으로 쓰지 말 것. `$($name)`을 써야 한다.

---

## 5. 배포 절차

현재 운영 합의: 한솔이 자동 업데이트 작업을 요청한 경우 PR 생성, 리뷰 대응, 머지, 정식 빌드, G드라이브 배포, 실제 업데이트 모니터링까지 Codex가 진행해도 된다. 단, DB 스키마 변경, 팀 전체 공지, 슬랙 게시, 대규모 데이터 조작은 별도 지시가 필요하다.

1. `package.json` 버전을 올린다. 자동 업데이트 검증 중에는 `1.22.n` 패치 버전을 계속 사용한다.
2. `DEVLOG/update-notes.json` 맨 위에 새 버전 항목을 추가한다.
3. 변경에 맞는 테스트를 추가한다.
4. `npm run typecheck`, `npm run test:auto-update`, `npm run build:vite`로 개발 검증한다.
5. PR 생성 후 리뷰를 확인하고 필요한 수정까지 반영한다.
6. PR을 머지한다.
7. `C:\Bflow-BGonly`에서 `git pull --ff-only`.
8. `npm run build`로 정식 설치 파일을 만든다. 워크트리에서 빌드해도 된다(토큰은 메인 체크아웃 `.env.local` 에서 찾는다). 빌드 로그에 `[vacation-token] 휴가 연동 토큰 확인` 과 `[generate-manifest] 휴가 연동 토큰 확인 — 화면 묶음 2곳에 들어 있음` 두 줄이 있어야 한다. 그 아래 `[generate-manifest] 앱 묶음 확인 — 화면 폴더에 빌드 산출물이 섞이지 않음` 줄도 확인한다(v1.128.2~).
9. G드라이브에 배포하되 `manifest.json`은 마지막에 복사한다.

배포 복사 예시:

```powershell
$src='C:\Bflow-BGonly\dist'
$dst='G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist'
& robocopy $src $dst /MIR /XF manifest.json /R:3 /W:5 /NP
$code=$LASTEXITCODE
if ($code -ge 8) { throw "robocopy failed with exit code $code" }
Copy-Item -LiteralPath (Join-Path $src 'manifest.json') -Destination (Join-Path $dst 'manifest.json') -Force
```

배포 후 최소 확인:

```powershell
$src='C:\Bflow-BGonly\dist'
$dst='G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist'
'BFLOW-Setup.exe','manifest.json','latest.yml' | ForEach-Object {
  $local=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $src $_)).Hash
  $remote=(Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dst $_)).Hash
  [pscustomobject]@{ File=$_; Match=($local -eq $remote) }
}
Get-Content -LiteralPath (Join-Path $dst 'manifest.json') -Raw | ConvertFrom-Json | Select-Object version,installer,releaseNotes
```

---

## 6. 성공 판정

업데이트 성공은 아래가 모두 맞아야 한다.

- 설치된 앱의 `resources\app\package.json` 버전이 최신이다.
- 앱 프로세스가 최신 설치 경로에서 다시 실행됐다.
- `%LOCALAPPDATA%\Bflow-BGonly\installer-pending`이 정리됐다.
- `%LOCALAPPDATA%\Bflow-BGonly\swap.log`에 `[installer-main]`과 `[installer] installer apply OK`가 남았다.

모니터링 예시:

```powershell
$pkg='C:\Users\user\AppData\Local\Programs\BFLOW\resources\app\package.json'
$pending='C:\Users\user\AppData\Local\Bflow-BGonly\installer-pending'
$log='C:\Users\user\AppData\Local\Bflow-BGonly\swap.log'
$version=(Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json).version
$procs=@(Get-Process BFLOW -ErrorAction SilentlyContinue)
[pscustomobject]@{
  Version=$version
  BflowProcessCount=$procs.Count
  PendingExists=(Test-Path -LiteralPath $pending)
}
Get-Content -LiteralPath $log -Tail 40
```

---

## 7. 파일 맵

| 파일 | 역할 |
|---|---|
| `electron/autoUpdate/paths.ts` | G드라이브 dist 탐색, 로컬 marker/cache 경로 |
| `electron/autoUpdate/checker.ts` | manifest 비교, installer 다운로드, `UpdateInfo` 생성 |
| `electron/autoUpdate/installerApply.ts` | installer helper 실행, 진행 창, 최신 버전 열기 |
| `electron/autoUpdate/installer.ts` | G드라이브 직접 실행/레거시 self-installer fallback |
| `electron/autoUpdate/manifest.ts` | manifest 파싱, 버전 비교, release note 정규화 |
| `electron/main.ts` | 시작 10초 gate, IPC, 즉시 적용/다음 실행 적용 분기 |
| `src/components/update/UpdateCenterModal.tsx` | 버전 모달, 수동 새로고침, 이전 내역 펼치기 |
| `src/components/layout/Sidebar.tsx` | 좌하단 버전 버튼/배지 |
| `src/App.tsx` | 업데이트 상태 구독, 지속 토스트, 즉시 업데이트 버튼 |
| `scripts/generate-manifest.js` | build 후 manifest 생성, installer/releaseNotes 포함. 배포용은 묶음에 휴가 연동 토큰이 있고, 앱의 화면 폴더에 빌드 산출물이 섞이지 않았을 때만 생성 |
| `scripts/vacation-token.cjs` | 휴가 연동 토큰 찾기(환경변수 → 빌드 폴더 → 메인 체크아웃), 배포 빌드 첫 단계 확인, 묶음 확인 |
| `tests/autoUpdate*.test.ts` | 자동 업데이트 회귀 테스트 |
| `tests/packagedAppContents.test.ts` | `build.files` 가 앱에 담는 파일·빼는 산출물, 화면 폴더 확인, 의존성 목록에 폴더 연결이 없는지 회귀 테스트 |
| `DEVLOG/update-notes.json` | 앱 모달에 표시되는 버전별 업데이트 내역 |

레거시 파일:

- `helperSwap.ts`, `swapper.ts`, `copy.ts`는 v1.21~v1.22.13 호환/복구 흔적이 남은 코드다.
- 새 업데이트 적용 경로는 `installerApply.ts`가 기준이다.
- 레거시 파일을 고칠 때는 "현재 적용 경로가 아님"을 먼저 확인해야 한다.

---

## 8. 문제별 판단

| 증상 | 확인할 것 | 판단 |
|---|---|---|
| 토스트는 떴지만 버전이 안 바뀜 | `swap.log`, 설치 버전, `installer-pending` | 토스트는 준비 완료 신호일 뿐이다 |
| 앱만 꺼지고 최신 버전으로 열리지 않음 | `swap.log`의 `[installer-main]`, `[installer]`, `.installer-attempted` | helper 시작 실패 또는 installer 후 앱 열기 실패 |
| 설치가 오래 걸림 | `BFLOW-Setup.exe` 프로세스, Defender, `swap.log`의 `installer started` 이후 시간 | installer 실행 중이면 기다리고, 2분 이상 정지면 로그 분석 |
| 모달이 계속 새로고침됨 | `UpdateCenterModal.tsx`에 open 시 자동 `handleRefresh()`가 있는지 확인 | 현재 정책은 버튼 클릭 때만 확인 |
| 이전 업데이트 내역이 안 보임 | `manifest.json.releaseNotes` 길이 확인 | `generate-manifest.js`가 내역을 자르지 않아야 함 |
| G드라이브 배포 직후 감지 실패 | 원격 `manifest.json`, `BFLOW-Setup.exe` 해시/크기 확인 | manifest가 마지막에 올라갔는지 확인 |
| 휴가 연동이 '인증 토큰이 유효하지 않습니다'로 끊김 | 설정의 연동 화면 › 휴가 관리 API 토큰 칸이 비어 있을 때 보이는 안내 글이 '내장 토큰 사용 중'인지 '앱에 토큰이 없습니다'인지. 빌드 로그의 휴가 연동 토큰 확인 두 줄 | '앱에 토큰이 없습니다'면 토큰 없이 만든 빌드다 — 토큰을 넣어 다시 빌드·배포. 토큰 칸에 값이 저장돼 있으면 그 값이 내장 토큰보다 먼저 쓰이므로, 틀린 값이면 칸을 비우고 '설정 저장'. 둘 다 아니면 서버 쪽 토큰이 바뀐 것 |
| `npm run build` 가 `휴가 연동 토큰을 찾지 못했습니다`·`읽을 수 없습니다`로 멈춤 | 메인 체크아웃 `.env.local` 의 `BFLOW_VACATION_TOKEN` 줄 | 파일·줄이 없으면 한솔에게 토큰을 받아 넣는다. `읽을 수 없습니다`면 값을 그대로 한 줄로 다시 적는다. 확인을 끄지 않는다 |
| `BFLOW-Setup.exe` 가 갑자기 커짐(약 115MB → 190MB 이상), 또는 `npm run build` 가 `화면 폴더에 빌드 산출물이 섞여 있습니다`로 멈춤 | `dist\win-unpacked\resources\app\dist` 안에 `index.html`·`assets`·`splash` 말고 다른 것(`win-unpacked`, `*.exe`, `*.yml` 등)이 있는지. `package.json` `build.files` 의 `!dist/…` 세 줄과 순서 | 제외 규칙이 빠졌거나 순서가 바뀐 것이다 — 되돌리고 `npm run build` 를 처음부터 다시 돌린다. 확인을 끄지 않는다 |
| 앱에서만 화면이 깨지고 미리보기(Chrome)에서는 멀쩡함 | `npm run preview:electron` 으로 같은 화면을 앱 엔진에서 열어 비교 | 앱은 Electron 33(Chromium 130)이라 최신 Chrome 과 기본 레이아웃이 다를 수 있다. v1.128.0 캐릭터 카드 그림이 이 경우였다(tasks/lessons.md 2026-10-06) |
| 업데이트가 `자동 중단`(suppressed)으로 멈춤 | `%LOCALAPPDATA%\Bflow-BGonly\.swap-suppressed`(content=설치 버전) 존재 여부 | 적용 실패 후 영구 suppression. 모달 `다시 시도`(v1.44.2~) 또는 설치 파일 직접 실행으로 해제. 다른 버전 설치 시 own 버전이 바뀌면 자동 정리 |

---

## 9. 다음 AI 작업 체크리스트

자동 업데이트를 건드릴 때는 아래를 끝까지 확인한다.

- [ ] 현재 기준 문서가 `DEVLOG/AUTO_UPDATE_OPERATIONS.md`임을 확인했다.
- [ ] directory swap 방식으로 되돌리지 않았다.
- [ ] `BFLOW-Setup.exe` 기반 installer helper 흐름을 유지했다.
- [ ] `manifest.json` 마지막 배포 규칙을 지켰다.
- [ ] `DEVLOG/update-notes.json`에 새 버전 항목을 추가했고 과거 항목을 삭제하지 않았다.
- [ ] `npm run test:auto-update`를 통과했다.
- [ ] 정식 빌드 로그에서 휴가 연동 토큰 확인 두 줄(`[vacation-token]`, `[generate-manifest] … 화면 묶음 2곳`)을 봤다.
- [ ] 정식 빌드 로그에서 `[generate-manifest] 앱 묶음 확인` 줄을 봤고, `BFLOW-Setup.exe` 크기가 직전 배포와 비슷하다(v1.128.2 기준 약 115MB).
- [ ] 실제 업데이트 테스트에서 설치 버전, 최신 버전 열림, `installer-pending` 정리, `swap.log`를 확인했다.
