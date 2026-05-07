# B flow — 배포 가이드

> 다른 Claude 세션 또는 신규 합류자가 이 프로젝트의 배포 구조를 빠르게 이해하기 위한 문서.
> 마지막 갱신: 2026-05-08

---

## 1. 배포 목적

Studio JBBJ 팀(~20명)이 *동일한 빌드*를 *항상 최신 상태로* 사용하게 하기 위해.

- **자주 업데이트**: 한솔이 매일 여러 번 hotfix/기능 push 하는 워크플로우
- **단일 진실 공급원(SSOT)**: 팀원 모두가 같은 버전을 쓰지 않으면 협업 데이터(Supabase)와 불일치
- **수동 설치 비용 0**: 한솔이 매번 빌드 → 팀원 자동 반영 (각자 installer 돌리는 워크플로우는 거부)

→ **G드라이브 공유 폴더**가 배포 채널의 핵심. 모든 팀원이 G드라이브 동기화를 사용 중이라 자연스러운 채널이 됨.

---

## 2. 배포 경로 (절대 경로)

| 구분 | 경로 |
|------|------|
| **개발 (한솔 PC)** | `C:\Bflow-BGonly\` |
| **빌드 결과물 (로컬)** | `C:\Bflow-BGonly\dist\` |
| **배포 채널 (G드라이브)** | `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist\` |
| **사용자 데이터 (팀원 PC)** | `%APPDATA%\Bflow-BGonly\` (`layout.json`, `preferences.json`, `notification-state.json` 등) |
| **로컬 캐시 이미지 (팀원 PC)** | `%APPDATA%\Bflow-BGonly\images\` |

> 한글 경로 주의: 배포 경로에 한글이 포함되어 있어 Node.js `path` 모듈을 반드시 사용. 경로 하드코딩 금지.

---

## 3. 빌드 산출물 구조

`npm run build` (= `tsc + vite build + electron-builder`) 결과:

```
dist/
├── BFLOW.exe              ← portable 단일 exe (157MB, 임시 폴더에 압축 풀어 실행)
├── builder-debug.yml
├── index.html             ← Vite renderer 진입점
├── assets/                ← Vite 빌드 청크 (~30개 .js)
├── splash/                ← 스플래시 HTML + opening_image_cropped.png
└── win-unpacked/          ← 풀린 형태 (188MB)
    ├── BFLOW.exe          ← ★ 팀원이 실제 실행하는 exe
    ├── chrome_*.pak       ← electron 33의 chromium 리소스
    ├── locales/           ← 다국어 리소스
    ├── resources/app/     ← 앱 코드(dist + dist-electron) + node_modules
    └── *.dll              ← electron 의존 dll들
```

**핵심**: `package.json` 의 `"asar": false` 설정으로 모든 파일이 풀린 상태. 이전에 모듈 누락 이슈로 명시적으로 끈 결정 (커밋 `08656e0`).

---

## 4. 배포 방식 (기존)

### 한솔 워크플로우
```bash
npm run build                                                  # 빌드
robocopy <local dist> <G드라이브 dist> /MIR /R:1 /W:1          # G드라이브 동기화
# 또는 PowerShell wrapper로 자동 실행
```

`/MIR` = mirror. G드라이브에서 source에 없는 파일은 자동 삭제 (옛 빌드 잔재 정리). ExitCode 0~7 = 정상.

### 팀원 워크플로우 (기존)

1. 신규 팀원: G드라이브 `dist\win-unpacked\BFLOW.exe` 의 바로가기를 바탕화면에 복사 (한솔이 사전에 만들어 둔 .lnk 파일을 공유)
2. 매 사용: 바탕화면 바로가기 더블클릭 → G드라이브의 BFLOW.exe 직접 실행
3. 자동 업데이트: Google Drive 동기화가 알아서 새 빌드를 PC로 sync. 다음에 바로가기로 다시 켜면 새 버전.

### 기존 방식의 한계 (2026-05-01 측정)

| 측정 | 1차 실행 | 2차 실행 |
|---|---|---|
| G드라이브에서 직접 실행 | 17.3초 | 14.6초 (캐시 거의 없음) |
| 로컬 디스크에서 실행 | 14.7초 | **1.6초** ⚡ |

→ G드라이브 동기화가 BFLOW.exe 의 mtime 을 미세하게 갱신해 Windows Defender 캐시를 무력화. 결과적으로 매번 13초+ 의 cold start 비용을 치름. **로컬 실행으로 옮기면 재시작 1~2초로 단축됨**.

---

## 5. 새 배포 방식 — 자동 업데이트 시스템 (v1.22.10 기준)

자세한 디자인: `docs/superpowers/specs/2026-05-01-auto-update-design.md`

### 컨셉
- **G드라이브** = 한솔의 "배포 창고"
- **팀원 PC 로컬 폴더** = 실행 환경
- 앱 시작 시: 스플래시에서 업데이트 상태 안내 → 최대 10초 동안 최신 버전 준비 → 준비 완료 시 helper swap 후 최신 버전으로 재실행
- 10초 초과/실패 시: 현재 버전으로 먼저 진입 → 앱 안 좌하단 버전 버튼/업데이트 모달에서 계속 상태 표시
- 앱 사용 중: 5분 주기로 manifest 재확인 → 백그라운드로 새 버전 다운로드 → `지금 업데이트` 또는 앱 종료 시 helper swap

### 한솔 워크플로우
```powershell
npm run build
robocopy "C:\Bflow-BGonly\dist" "G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist" /MIR /R:1 /W:1 /XF manifest.json
Copy-Item "C:\Bflow-BGonly\dist\manifest.json" "G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\dist\manifest.json" -Force
```

중요: `manifest.json`은 업데이트 감지 신호다. 파일 업로드가 끝나기 전에 manifest가 먼저 바뀌면 팀원 앱이 반쯤 올라간 빌드를 최신으로 판단할 수 있다. 배포 자동화는 반드시 `win-unpacked`/설치 파일 업로드를 끝낸 뒤 `manifest.json`을 마지막에 갱신해야 한다.

### 팀원 첫 설치 (한 번만)
1. 기존 바로가기(G드라이브 가리키는 것) 또는 G드라이브의 BFLOW.exe 더블클릭
2. 앱이 "처음 실행" 감지 → 자기를 `%LOCALAPPDATA%\Bflow-BGonly\app\` 에 복사 → 바탕화면에 새 바로가기 자동 생성 → 새 위치에서 재시작
3. (옵션) Windows Defender 제외 등록 dialog 한 번 노출 → "허용" 클릭 시 새 빌드 받은 직후 첫 실행도 빠름

### 팀원 일상 사용
1. **바탕화면 새 바로가기** (자동 생성된 것, 로컬 본체 가리킴) 더블클릭 → 1~2초 시작
2. 시작 직후 스플래시에서 manifest.json 읽기 → 자기 버전과 비교 → 새 버전이면 최대 10초 동안 먼저 다운로드
3. 10초 안에 준비 완료: helper가 `app\` → `backup\`, `pending\` → `app\` swap 후 새 BFLOW.exe 재실행
4. 10초 초과/실패: 현재 버전으로 먼저 열고, 다운로드가 끝나면 좌하단 버전 버튼/토스트/업데이트 모달로 표시
5. `지금 업데이트` 클릭 또는 앱 종료: 저장 대기 후 helper swap. 다음 실행 또는 재실행 = 새 버전
6. 앱을 계속 켜둔 상태에서 한솔이 새 버전을 올리면, 앱이 5분 주기로 manifest를 다시 확인해 같은 알림 흐름으로 진입

### 옛 바로가기 (한솔이 사전에 만든 G드라이브 가리키는 .lnk)
- 폐기. 누군가 다시 눌러도 self-installer 가 "이미 설치되어 있음" 감지 → 로컬 본체 자동 실행 + 안내. 사고 없음.

---

## 6. 버전 관리 규칙

- `package.json` 의 `version` 필드가 SSOT (예: `1.15.13`)
- **기능 추가 → minor** (1.15 → 1.16)
- **버그 수정 → patch** (1.15.12 → 1.15.13)
- 커밋 메시지 첫 줄: `[v<버전>] 한 줄 설명` 또는 `fix(v<버전>): ...`
- PR 제목: `[v<버전>] 변경 요약`

---

## 7. Supabase 연결 (배포본 안)

`electron/supabase.ts:64` 의 `SUPABASE_URL = 'https://mpqifkpxalwxgcrddchv.supabase.co'` + anon key가 빌드에 박힘. 모든 팀원이 같은 Supabase 프로젝트(`mpqifkpxalwxgcrddchv`)에 접속.

DB 스키마 변경 시:
- supabase MCP `apply_migration` 으로 라이브 DB 에 적용
- 변경 내용은 `DEVLOG/migrations/YYYY-MM-DD_<name>.sql` 로 기록 (재현용)

---

## 8. 배포 시 주의사항

1. **빌드 검증**: 변경 후 반드시 `npm run typecheck` + `npm run test:auto-update` + `vite build` 통과 확인 (CLAUDE.md 규칙)
2. **G드라이브 락**: 팀원이 BFLOW.exe 켜놓은 상태면 robocopy 가 일부 `.pak` 파일에서 락 에러. 다만 chromium 33 동일이라 src/dst 내용 같아 무시 가능.
3. **node_modules in worktree**: git worktree 에는 node_modules 가 없음. `mklink /J node_modules C:\Bflow-BGonly\node_modules` (Windows junction) 으로 메인 디렉토리와 연결 후 빌드.
4. **자동 머지/배포 금지** (메모리): PR 생성/G드라이브 robocopy/슬랙 게시는 한솔이 명시적으로 요청한 경우만.
5. **업데이트 성공 판단**: 토스트 감지는 다운로드 완료 신호일 뿐이다. 실제 적용 성공은 helper swap 후 다음 실행 버전, `%LOCALAPPDATA%\Bflow-BGonly\swap.log`의 `[main]`/`[helper]` 로그, `.swap-attempted` 정리 여부로 판단한다.
6. **manifest 변경 요약**: 앱의 업데이트 모달은 `DEVLOG/update-notes.json` → `dist/manifest.json.releaseNotes`를 표시한다. 새 배포 전 이 파일의 최신 항목을 갱신한다.
7. **helper PowerShell 보간 주의**: `helperSwap.ts`의 PowerShell 스크립트는 TypeScript 백틱 문자열 안에 있다. PowerShell 변수는 `$($stepName)`처럼 쓰고 `${stepName}`을 쓰면 JavaScript 변수로 평가되어 helper가 시작되기 전에 실패한다.

---

## 9. 비상 시 롤백

라이브 DB 안 건드린 단순 코드 롤백:
1. G드라이브의 `dist.bak.YYYYMMDD_HHMMSS` 폴더 (자동 백업이 있다면) 의 내용을 `dist\` 로 복사
2. 또는 git 에서 이전 태그/커밋 checkout → `npm run build` → 다시 robocopy

DB 스키마 롤백:
- `DEVLOG/migrations/` 의 SQL 을 역순으로 작성해 적용 (DROP FUNCTION, DROP COLUMN 등)
- 사고 발생 시 supabase MCP `execute_sql` 로 즉시 응급 처리

---

## 10. 참조

- [CLAUDE.md](../CLAUDE.md) — 프로젝트 전체 규칙
- [ROADMAP.md](../ROADMAP.md) — 개발 로드맵
- [supabase-init.sql](./supabase-init.sql) — DB 초기 스키마
- [supabase-migration-plan.md](./supabase-migration-plan.md) — Supabase 마이그레이션 상세
- [auto-update-test-scenario.md](./auto-update-test-scenario.md) — 자동 업데이트 E2E 테스트 체크리스트
- `docs/superpowers/specs/2026-05-01-auto-update-design.md` — 자동 업데이트 시스템 디자인 및 v1.22.10 결정 이력
