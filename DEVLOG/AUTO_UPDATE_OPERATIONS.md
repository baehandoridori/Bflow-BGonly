# B flow 자동 업데이트 운영 기준

> 마지막 갱신: 2026-05-08
> 현재 기준: v1.22.19
> 이 문서가 자동 업데이트/배포 판단의 1차 기준이다. 옛 설계 문서와 충돌하면 이 문서를 우선한다.

---

## 1. 목표

팀원은 로컬 PC에 설치된 `BFLOW.exe`를 빠르게 실행한다. G드라이브는 실행 위치가 아니라 새 빌드를 배포하는 창고로만 쓴다.

이 구조로 바꾼 이유:

- G드라이브의 실행 파일을 직접 열면 Google Drive 동기화와 Windows Defender 검사 때문에 매번 시작이 느려졌다.
- 로컬 설치본은 Defender 캐시가 유지되어 재실행 속도가 훨씬 안정적이다.
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

---

## 3. 동작 흐름

### 앱 시작 시

1. 로컬 `B flow` 바로가기로 `BFLOW.exe` 실행.
2. 스플래시 표시.
3. G드라이브 `manifest.json`을 읽고 현재 버전과 비교.
4. 새 버전이 있으면 최대 10초 동안 `BFLOW-Setup.exe`를 `%LOCALAPPDATA%\Bflow-BGonly\installer-pending`에 준비.
5. 10초 안에 준비되면 installer helper를 띄우고 앱을 닫는다.
6. helper는 BFLOW 프로세스가 완전히 종료된 뒤 `BFLOW-Setup.exe /S`를 실행한다.
7. 설치가 끝나면 새 `BFLOW.exe`를 다시 연다.
8. 10초를 넘기거나 준비 실패 시 현재 버전으로 먼저 진입하고, 앱 안에서 계속 상태를 표시한다.

### 앱 사용 중

1. 메인 창 로드 후 업데이트 상태를 공유한다.
2. 5분 주기로 G드라이브 manifest를 다시 확인한다.
3. 새 버전이 있으면 installer를 백그라운드로 준비한다.
4. 준비 완료 시 지속 토스트, 좌하단 버전 버튼 배지, 업데이트 모달에 표시한다.
5. 사용자가 `지금 업데이트`를 누르거나 앱을 종료하면 installer helper가 적용한다.

### 버전 모달 UX

- 좌하단 버전 버튼은 업데이트 유무와 관계없이 항상 열린다.
- 모달은 열자마자 자동 확인하지 않는다.
- `새로고침` 버튼을 눌렀을 때만 `update:check-now`로 배포 상태를 확인한다.
- 새로고침 중에는 기존 표시 내용을 고정해 모달 레이아웃이 흔들리지 않게 한다.
- 최신 3개 업데이트 내역은 기본 표시하고, 이전 내역은 `이전 업데이트 내역 N개 보기`로 펼친다.
- `DEVLOG/update-notes.json`의 과거 항목은 사용자에게 보이는 기록이므로 삭제하지 않는다.

---

## 4. 절대 하지 말 것

- 실행 중 앱 폴더를 직접 rename/copy해서 업데이트하지 말 것.
- `helperSwap.ts`/`swapper.ts` 기반의 directory swap 방식을 되살리지 말 것.
- 토스트가 떴다는 이유만으로 업데이트 성공이라고 판단하지 말 것.
- `manifest.json`을 다른 파일보다 먼저 G드라이브에 올리지 말 것.
- `build:vite`의 `--allow-missing-installer` 결과를 정식 배포로 쓰지 말 것.
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
8. `npm run build`로 정식 설치 파일을 만든다.
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
| `electron/autoUpdate/installerApply.ts` | 앱 종료 후 installer helper 실행, 진행 창, 재실행 |
| `electron/autoUpdate/installer.ts` | G드라이브 직접 실행/레거시 self-installer fallback |
| `electron/autoUpdate/manifest.ts` | manifest 파싱, 버전 비교, release note 정규화 |
| `electron/main.ts` | 시작 10초 gate, IPC, 종료 시 installer 적용 |
| `src/components/update/UpdateCenterModal.tsx` | 버전 모달, 수동 새로고침, 이전 내역 펼치기 |
| `src/components/layout/Sidebar.tsx` | 좌하단 버전 버튼/배지 |
| `src/App.tsx` | 업데이트 상태 구독, 지속 토스트, 즉시 업데이트 버튼 |
| `scripts/generate-manifest.js` | build 후 manifest 생성, installer/releaseNotes 포함 |
| `tests/autoUpdate*.test.ts` | 자동 업데이트 회귀 테스트 |
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
| 앱만 꺼지고 다시 안 켜짐 | `swap.log`의 `[installer-main]`, `[installer]`, `.installer-attempted` | helper 시작 실패 또는 installer 재실행 실패 |
| 설치가 오래 걸림 | `BFLOW-Setup.exe` 프로세스, Defender, `swap.log`의 `installer started` 이후 시간 | installer 실행 중이면 기다리고, 2분 이상 정지면 로그 분석 |
| 모달이 계속 새로고침됨 | `UpdateCenterModal.tsx`에 open 시 자동 `handleRefresh()`가 있는지 확인 | 현재 정책은 버튼 클릭 때만 확인 |
| 이전 업데이트 내역이 안 보임 | `manifest.json.releaseNotes` 길이 확인 | `generate-manifest.js`가 내역을 자르지 않아야 함 |
| G드라이브 배포 직후 감지 실패 | 원격 `manifest.json`, `BFLOW-Setup.exe` 해시/크기 확인 | manifest가 마지막에 올라갔는지 확인 |

---

## 9. 다음 AI 작업 체크리스트

자동 업데이트를 건드릴 때는 아래를 끝까지 확인한다.

- [ ] 현재 기준 문서가 `DEVLOG/AUTO_UPDATE_OPERATIONS.md`임을 확인했다.
- [ ] directory swap 방식으로 되돌리지 않았다.
- [ ] `BFLOW-Setup.exe` 기반 installer helper 흐름을 유지했다.
- [ ] `manifest.json` 마지막 배포 규칙을 지켰다.
- [ ] `DEVLOG/update-notes.json`에 새 버전 항목을 추가했고 과거 항목을 삭제하지 않았다.
- [ ] `npm run test:auto-update`를 통과했다.
- [ ] 실제 업데이트 테스트에서 설치 버전, 재실행, `installer-pending` 정리, `swap.log`를 확인했다.
