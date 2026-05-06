# Auto-Update System Design — B flow

> 작성: 2026-05-01
> 상태: 디자인 (한솔 review 대기)
> 관련 문서: [DEVLOG/DEPLOYMENT.md](../../../DEVLOG/DEPLOYMENT.md)

---

## 1. 목적

현재 G드라이브에서 직접 BFLOW.exe 를 실행하는 방식은, G드라이브 동기화가 BFLOW.exe 의 mtime 을 갱신해 Windows Defender 캐시를 무력화함에 따라 매 실행마다 13초+ 의 cold start 비용을 부담한다.

**측정 결과 (한솔 PC, 2026-05-01)**:

| 실행 환경 | 1차 | 2차 (재실행) |
|---|---|---|
| G드라이브 직접 | 17.3초 | 14.6초 (캐시 거의 없음) |
| 로컬 디스크 | 14.7초 | **1.6초** ⚡ |

**처방**: 사용자 PC 에 BFLOW 본체를 한 번 복사해 두고 *로컬에서 실행*. 새 빌드는 G드라이브에서 *백그라운드로 받아 swap*. Defender 가 같은 파일 (mtime 안정) 을 캐시 효과적으로 인식 → 재실행 1~2초.

부수 목표:
- 한솔 워크플로우 변경 0 (지금처럼 빌드 + G드라이브 robocopy)
- 신규 팀원도 추가 액션 거의 0 (G드라이브 BFLOW 한 번 더블클릭이 그대로 self-installer)
- Windows Defender 제외 등록 자동 안내로 *첫 실행 cold start* 도 단축

---

## 2. 결정사항 (한솔과 정렬 완료)

| 항목 | 결정 |
|---|---|
| UX 패턴 | A. 조용히 알아서, 다음 재시작 시 적용 |
| 다운로드 위치 | G드라이브 그대로 (한솔 워크플로우 변경 0) |
| 전달 방식 | PC의 G드라이브 동기화에 맡김 (앱이 PC의 G드라이브 폴더 모니터링) |
| 첫 설치 | 첫 실행 시 PC에 자동 설치 (self-installer 패턴) |
| 체크 시점 | 앱 켤 때만 (단순) |
| 사용자 알림 | 무알림 (G드라이브 패턴과 체감 동일) |
| Defender | 첫 설치 시 제외 등록 dialog 한 번 (옵션) |

---

## 3. 컴포넌트 구성

```
┌────────────────────────────────────────────────────────────┐
│                       팀원 PC 측                            │
│                                                             │
│  ┌──────────────────────┐    ┌──────────────────────────┐  │
│  │  G드라이브 폴더      │    │  로컬 BFLOW 본체         │  │
│  │  (Drive sync 결과)   │    │  %LOCALAPPDATA%\         │  │
│  │                      │    │   Bflow-BGonly\app\      │  │
│  │  win-unpacked/       │    │   ↑                      │  │
│  │  ├ BFLOW.exe         │───→│  팀원이 실행하는 본체    │  │
│  │  └ manifest.json     │    │                          │  │
│  └──────────────────────┘    │  pending\                │  │
│           ↑ 모니터링            (다음 시작 시 swap)     │  │
│                              └──────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
                                     ↑
                         바탕화면 바로가기 (.lnk)
                       자동 생성, 로컬 본체 가리킴
```

### 디렉토리 레이아웃

| 경로 | 역할 |
|---|---|
| `%LOCALAPPDATA%\Bflow-BGonly\app\` | 현재 사용 중인 BFLOW 본체 (win-unpacked 통째로) |
| `%LOCALAPPDATA%\Bflow-BGonly\pending\` | 백그라운드로 받은 새 버전 (종료 시 swap 대기) |
| `%LOCALAPPDATA%\Bflow-BGonly\backup\` | 이전 버전 1개 보관 (긴급 롤백용) |
| `%APPDATA%\Bflow-BGonly\` | 사용자 데이터 (기존 — 변경 없음) |

`%LOCALAPPDATA%` 와 `%APPDATA%` 분리 이유: 본체는 *로컬* 이라 sync 안 됨 (LocalAppData), 사용자 설정은 그대로 유지 (Roaming AppData).

### 빌드 산출물 (한솔 PC)

기존 산출물에 manifest 만 추가:

```
dist/
├── BFLOW.exe                  ← 변경 없음 (portable)
├── win-unpacked/              ← 변경 없음
└── manifest.json              ← 추가. {"version": "1.15.14", "buildAt": "..."}
```

`npm run build` 의 마지막 step 으로 `scripts/generate-manifest.js` 가 자동 실행 → `dist/manifest.json` 생성. 한솔 손 거치지 않음.

---

## 4. 데이터 흐름

### 4.1 한솔 빌드 (변경 0)

```
npm run build
 ├ tsc --noEmit
 ├ vite build
 ├ vite build (electron main)
 ├ vite build (electron preload)
 ├ electron-builder (portable + win-unpacked)
 └ scripts/generate-manifest.js  ← 추가
                                   dist/manifest.json 생성

robocopy <local dist> <G드라이브 dist> /MIR
 → G드라이브 sync → 모든 팀원 PC 의 G드라이브 폴더에 도착
```

### 4.2 팀원 실행 (정상 동작)

```
1. 바탕화면 바로가기 더블클릭
2. → %LOCALAPPDATA%\Bflow-BGonly\app\BFLOW.exe 실행 (1~2초, Defender 캐시됨)
3. 메인 창 로드
4. [백그라운드] checkUpdate() — 5초 후 한 번 호출
   ├ G드라이브 폴더 경로 추정 (Drive desktop 표준 경로 후보)
   ├ <G드라이브 폴더>/manifest.json 읽기
   ├ 자기 버전(package.json) 과 비교
   └ 새 버전이면 → downloadUpdate()
        ├ <G드라이브 win-unpacked>/* → %LOCALAPPDATA%\...\pending\* 로 복사 (변경분만, robocopy 패턴)
        └ pending\.ready 마커 파일 생성 (swap 신호)
5. 사용자 작업 — 영향 없음
6. 종료 (트레이 종료 또는 X)
   ├ swapIfPending() — quit hook
   │   ├ pending\.ready 존재 시
   │   ├ app\ → backup\ (이전 버전 보관)
   │   └ pending\ → app\ (새 버전 활성화)
   └ 종료
7. 다음 실행 = 새 버전 (또 1~2초)
```

### 4.3 첫 실행 (self-installer)

```
1. 신규 팀원 — G드라이브의 BFLOW.exe 더블클릭 (또는 한솔이 만든 옛 바로가기)
2. process.execPath 검사 → G드라이브 경로면 self-installer 모드
3. 작은 dialog: "B flow 를 PC에 설치합니다 (한 번만, ~5초)"
4. 사용자가 OK
5. install():
    ├ %LOCALAPPDATA%\Bflow-BGonly\app\ 생성
    ├ G드라이브 win-unpacked/* → app\* 복사
    ├ 바탕화면에 "B flow.lnk" 생성 (가리키는 곳: app\BFLOW.exe)
    ├ 시작 메뉴에 "B flow.lnk" 생성
    └ Defender 제외 등록 dialog (옵션):
       ├ "Windows 보안에서 B flow 폴더를 검사 제외로 등록하면 시작이 더 빨라집니다"
       └ "허용" 클릭 시 PowerShell `Add-MpPreference -ExclusionPath` (관리자 권한 UAC 요청)
6. app\BFLOW.exe 실행 + 자기는 종료
```

### 4.4 이미 설치되어 있는데 G드라이브 BFLOW 다시 클릭

```
1. process.execPath 검사 → G드라이브 경로
2. %LOCALAPPDATA%\Bflow-BGonly\app\BFLOW.exe 존재 확인
3. 존재하면 → 작은 토스트: "이미 설치되어 있어요. 바탕화면 바로가기를 사용해주세요."
4. app\BFLOW.exe 실행 + 자기는 종료
```

→ 한솔이 사전에 만들어 둔 옛 바로가기를 누군가 다시 클릭해도 사고 없음.

---

## 5. 코드 구성

### 5.1 새 파일

| 파일 | 역할 |
|---|---|
| `electron/autoUpdate/installer.ts` | self-installer (G드라이브 → 로컬 복사, 바로가기, Defender) |
| `electron/autoUpdate/checker.ts` | 새 버전 감지 + 백그라운드 다운로드 |
| `electron/autoUpdate/swapper.ts` | quit 시 pending → app swap |
| `electron/autoUpdate/paths.ts` | G드라이브 경로 추정 + 로컬 경로 상수 |
| `scripts/generate-manifest.js` | 빌드 후 dist/manifest.json 생성 (한솔 손 안 거침) |

### 5.2 main.ts 통합 지점

```ts
// app.whenReady 안
import { runFirstInstallIfNeeded } from './autoUpdate/installer';
import { scheduleUpdateCheck } from './autoUpdate/checker';
import { swapIfPending } from './autoUpdate/swapper';

// 1. 첫 실행 감지 + self-installer (재실행 시 자기 종료)
const installResult = await runFirstInstallIfNeeded();
if (installResult.exited) return; // self-installer 가 새 위치에서 재실행하고 자기는 종료

// 2. 메인 창 띄움 (기존)
createSplashWindow();
// ...

// 3. 메인 로드 후 5초 뒤 백그라운드 업데이트 체크
mainWindow.webContents.once('did-finish-load', () => {
  setTimeout(() => scheduleUpdateCheck().catch((err) => console.warn('[autoUpdate]', err)), 5_000);
});

// 4. 종료 시 swap
app.on('before-quit', async (event) => {
  if (await hasPending()) {
    event.preventDefault();
    await swapIfPending();
    app.exit(0);
  }
});
```

---

## 6. 에러 처리 / 엣지 케이스

| 케이스 | 처리 |
|---|---|
| G드라이브 폴더 못 찾음 (사용자가 Drive 안 켰거나 경로 다름) | 그냥 자기 버전으로 실행. `console.warn` 만. 사용자 알림 X. |
| manifest.json 못 읽음 (sync 진행중, 파일 깨짐) | 같음 — fallback 으로 자기 버전 실행 |
| 다운로드 중 네트워크/Drive sync 끊김 | pending\ 에 부분 파일 남을 수 있음 → 다음 시작 시 정합성 검사 (`.ready` 마커 없으면 폐기) |
| swap 실패 (락) | app\ 그대로 두고 pending\ 도 그대로. 다음 종료 시 재시도. |
| 새 버전 깨졌음 (앱 시작 실패) | `backup\` 의 이전 버전을 자동으로 `app\` 으로 되돌리는 안전장치 (5초 안에 메인 창 못 띄우면 롤백) |
| Defender 제외 등록 거부 | 그냥 진행. 다음에 설정에서 다시 시도 가능. |
| 권한 부족 (LocalAppData 쓰기 불가, 매우 드뭄) | 사용자에게 명확한 에러 메시지 + 폴백으로 G드라이브 실행 |

---

## 7. Windows Defender 제외 등록 (옵션)

### 왜 필요한가
새 빌드를 받은 *직후* 첫 실행은 Defender 가 처음 보는 파일이라 풀 스캔 (~10초+). 제외 등록되면 즉시 캐시.

### 어떻게
PowerShell:
```powershell
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Bflow-BGonly\app"
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\Bflow-BGonly\pending"
```

이 명령은 *관리자 권한* 필요 → UAC 프롬프트 한 번. 사용자가 거부하면 그냥 진행.

### 보안 고려
- 폴더 단위 제외는 일반적이지만 사용자 동의 필수
- B flow 외 다른 exe 가 그 폴더에 들어가면 그것도 스캔 안 됨 — 폴더는 앱 전용이라 위험 낮음
- 사용자에게 이 사실을 dialog 에 명확히 표시

---

## 8. 빌드 / 배포 워크플로 변경

### 한솔 측 (`npm run build`)
기존 흐름에 1줄 step 추가:

```json
// package.json
"scripts": {
  "build": "tsc && vite build && electron-builder && node scripts/generate-manifest.js"
}
```

`generate-manifest.js`:
```js
// dist/manifest.json 자동 생성
const fs = require('fs');
const pkg = require('../package.json');
const manifest = {
  version: pkg.version,
  buildAt: new Date().toISOString(),
};
fs.writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
```

### G드라이브 동기화 (변경 0)
지금처럼 robocopy. dist/manifest.json 도 같이 sync 됨.

---

## 9. 마이그레이션 (현재 사용자 → 새 시스템)

기존에 G드라이브 BFLOW.exe 직접 실행하던 팀원들의 첫 한 번:

1. 한솔이 새 시스템 포함된 빌드 push
2. 팀원이 평소처럼 옛 바로가기 (G드라이브 가리키는 거) 더블클릭
3. → 새 코드의 self-installer 가 첫 실행 감지 → "PC 에 설치합니다" dialog
4. 설치 완료 → 바탕화면에 새 바로가기 자동 생성 → 자동 재실행
5. 이후 팀원은 *바탕화면 새 바로가기* 사용

→ 한솔이 따로 안내할 거 없음. 사용자 PC 에 폐기될 옛 바로가기는 그대로 둬도 폴백 동작 (이미 설치 감지 + 로컬 본체 실행).

---

## 10. 진단 코드 처리

현재 알림 패널에 띄우는 "🐢 시작 시간 분석" 코드 (electron/main.ts + App.tsx):
- 자동 업데이트 시스템 *적용 후* 효과 검증용으로 며칠 더 유지
- 한솔이 "1~2초로 줄었네" 확인되면 한 번에 제거 (별도 commit)

---

## 11. 테스트 시나리오

| 시나리오 | 기대 결과 |
|---|---|
| 신규 팀원 — G드라이브 BFLOW 첫 클릭 | self-installer dialog → PC 설치 → 자동 재실행 → 로그인 화면 |
| 일상 사용 — 바탕화면 바로가기 더블클릭 | 1~2초 시작 (Defender 캐시) |
| 한솔이 새 빌드 push 직후 | 백그라운드 다운로드, 사용자 작업 영향 없음. 다음 종료 시 swap. 그 다음 실행 = 새 버전 |
| G드라이브 sync 안 끝남 | 그냥 자기 버전으로 실행 (sync 끝난 다음 실행 시 받음) |
| 새 버전 깨짐 (앱 시작 실패) | `backup\` 자동 롤백, 다음 실행 = 이전 버전 |
| 옛 바로가기 (G드라이브 가리키는 거) 클릭 — 이미 설치된 경우 | 토스트 안내 + 로컬 본체 실행 |
| Defender 제외 등록 거부 | 정상 동작. 새 빌드 직후 첫 실행만 약간 느림 (~10초). 이후 정상 (1~2초) |

---

## 12. 작업 단계 (구현 plan 별도 작성 예정)

1. `scripts/generate-manifest.js` + `package.json` build script 수정
2. `electron/autoUpdate/paths.ts` (G드라이브 경로 추정)
3. `electron/autoUpdate/installer.ts` (self-installer)
4. `electron/autoUpdate/checker.ts` (백그라운드 체크 + 다운로드)
5. `electron/autoUpdate/swapper.ts` (quit hook + swap)
6. `electron/main.ts` 통합
7. 첫 실행 dialog UI (electron dialog or BrowserWindow)
8. Defender 제외 등록 (옵션 dialog + PowerShell 호출)
9. 자가 검증 (앱 시작 실패 시 backup 롤백)
10. 빌드/배포/한솔 검증

---

## 13. Protocol Handler (슬랙 딥링크 `bflow://`)

### 동작 원리
Windows registry 에 등록된 `bflow://` 핸들러 BFLOW.exe 경로가 OS 가 슬랙 딥링크 클릭 시 호출하는 대상. `electron/main.ts:2552` 의 `app.setAsDefaultProtocolClient(PROTOCOL)` 가 인자 없이 호출되면 현재 실행 중인 BFLOW.exe 의 `process.execPath` 를 자동 등록.

### 새 시스템에서의 자동 갱신
- self-installer 가 로컬 BFLOW.exe 를 실행하는 시점에 setAsDefaultProtocolClient 가 호출되어 registry 가 로컬 경로로 갱신됨 → 이후 슬랙 딥링크 클릭 시 로컬 BFLOW.exe 가 실행 (1~2초)
- 자동 업데이트 swap 은 `app\` 폴더 *안의 파일만* 갈아끼우므로 registry path 는 영원히 같음 → swap 후에도 자동으로 새 버전이 슬랙 딥링크에 반응

### 엣지 케이스
| 케이스 | 결과 |
|---|---|
| 마이그레이션 직전 — registry 에 옛 G드라이브 경로가 박혀있고 슬랙 딥링크 누름 | 옛 G드라이브 BFLOW 가 실행되지만 그 안의 self-installer 코드가 동작 → 한 번에 마이그레이션 + 딥링크 처리 |
| swap 직후 첫 실행 | 같은 경로의 새 파일이 실행 + setAsDefaultProtocolClient 재호출 (no-op, 안전) |
| 사용자가 `app\` 폴더를 수동 이동/삭제 | 다음 실행 실패 → 안전장치(`backup\` 폴백 또는 옛 G드라이브 바로가기로 self-installer 재진입) |

### 코드 변경 필요
없음. 기존 `setAsDefaultProtocolClient` 호출이 이미 process.execPath 자동 등록이라 self-installer 가 새 위치에서 재실행하는 것만으로 충분.

---

## 14. 결정 보류 / 후속 검토

- **코드 서명 인증서** (연 100$+): SmartScreen 우회로 첫 실행도 즉시 빠름. 도입 비용/필요성 검토.
- **manifest.json 형식 확장**: 변경 사항 (changelog) 등 추가 메타. 지금은 version + buildAt 만.
- **여러 환경 지원**: 한솔 PC 외에 외근 (Drive sync 안 됨) 등에서도 받게 하려면 Supabase Storage 옵션 추가 검토 (현재 scope 밖).
