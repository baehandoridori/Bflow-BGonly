# CLAUDE.md — B flow

> **프로젝트**: Studio JBBJ 프로덕션 진행 현황 대시보드 (BG + 액팅)
> **타입**: Electron + React + TypeScript 독립 앱
> **현재 상태**: Phase 0-1~0-3 완료, Phase 1~2 완료, Phase 4-1~4-3 완료, Phase 6 Step 1~4 완료, Phase 7-1~7-5 완료, Phase 8-0~8-1, 8-3~8-5 완료, Phase 9 M-0~M-5 완료, M-6 준비 완료 (빌드/배포만 남음)
> **로드맵**: `ROADMAP.md` 참조 | **세션 가이드**: `CONTEXT.md` 참조
>
> **이력**: 원래 BG(배경) 전용 현황판(`Bflow-BGonly`)으로 시작했으나, 액팅까지 포함한 통합 앱이 되면서 정식 명칭 **B flow**로 전환됨. 레포 이름(`Bflow-BGonly`)과 `app.name`은 기존 사용자 데이터 경로(`%APPDATA%\Bflow-BGonly\`) 호환을 위해 유지.

---

## ⚠️ 필수 규칙

1. **Bflow 레포 (`/home/user/Bflow`)는 참고 전용이다. 절대 직접 수정하지 말 것.**
   - 코드 구조, 패턴 참고만 가능
   - 파일 수정, 커밋, 푸시 일절 금지
   - 모든 개발은 반드시 `Bflow-BGonly` 레포에서만 진행
2. **빌드 검증**: 코드 변경 후 반드시 `npm run typecheck` + 관련 테스트 + `npm run build:vite` 통과 확인. 정식 배포는 `npm run build`까지 확인
3. **낙관적 업데이트 패턴**: 모든 데이터 변경은 즉시 UI 반영 → Supabase 동기화 → 실패 시 롤백
4. **Supabase 단일 경로**: 새 기능은 `supabaseService` 경유로만 구현 (Sheets 분기 추가 금지)
5. **IPC 구조 유지**: 렌더러에서 직접 Supabase 호출 금지, 반드시 IPC → 메인 → Supabase
6. **자동 업데이트 배포 원칙**: G드라이브에는 빌드 파일을 먼저 모두 올리고 `manifest.json`을 마지막에 갱신한다. 앱은 manifest를 보고 업데이트를 감지하므로, 반쯤 올라간 빌드가 최신으로 보이면 안 된다.
7. **호출자 검증은 서버 세션 토큰으로**: 개인·공유 권한이 있는 데이터(간트 등)의 RPC 는 호출자가 보내는 `p_actor_id` 같은 신원 주장을 믿지 않고, `app_login` 이 발급한 세션 토큰(`gantt_session_*` 래퍼 패턴)으로 신원을 확정한다. 새 테이블은 anon 직접 권한 없이 SECURITY DEFINER 래퍼로만 열고, 토큰은 main 프로세스 밖(renderer payload)으로 내보내지 않는다. `users` 조회는 명시 컬럼만 쓴다(`select *` 금지 — 비밀번호 컬럼 권한이 회수되면 통째로 실패). 설계: `docs/superpowers/specs/2026-09-05-gantt-session-auth-design.md`.

---

## 프로젝트 개요

Studio JBBJ 팀(~20명)이 에피소드별 BG/액팅 씬의 진행 상황을 실시간 추적하는 Electron 앱.
Supabase(PostgreSQL + Realtime)를 SSOT로 사용 (Google Sheets에서 전환 중). 여러 사용자가 동시에 앱을 열어두고 협업.

**동기화**: 체크박스 토글 → 로컬 즉시 반영(낙관적) → Supabase 저장 → 실패 시 롤백. 다른 사용자 변경은 Realtime WebSocket으로 즉시 수신 (~100ms).

---

## 경로

| 구분 | 경로 |
|------|------|
| 개발 | `C:\Bflow-BGonly` |
| 배포 | `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\` |
| 개인 설정 | `%APPDATA%\Bflow-BGonly\` (layout.json, preferences.json) |

**데이터**: 씬/에피소드/체크박스/메모/캘린더(공유·개인 일정/태그/알림) → Supabase (PostgreSQL, 캘린더는 렌더러 → IPC → 메인에서 권한 강제), 이미지 → Supabase Storage (`scene-images` 버킷, 800px/JPEG 80% 리사이즈), 레거시 Drive 이미지는 `drive-img://` 프로토콜로 표시만 유지, 위젯 레이아웃/개인 설정 → %APPDATA% 로컬 파일

### 제약 사항

- **한글 경로 인코딩**: 배포 경로에 한글 포함 → Node.js `path` 모듈 사용, 경로 하드코딩 금지
- **동시 편집 충돌**: Last-Write-Wins 전략. Realtime으로 충돌 창 최소화 (~100ms 전파)

---

## 기술 스택

Electron + React 18 + TypeScript + Tailwind CSS + Zustand + react-grid-layout + @supabase/supabase-js + googleapis (이미지 전용)

### 디자인 토큰

```
배경: #0F1117 | 카드: #1A1D27 | 보더: #2D3041
텍스트: #E8E8EE | 텍스트 약: #8B8DA3 | 액센트: #6C5CE7

단계: LO=#74B9FF  완료=#A29BFE  검수=#FDCB6E  PNG=#00B894
```

---

## 위젯 목록

| 위젯 ID | 이름 | 설명 |
|---------|------|------|
| overall-progress | 전체 진행률 | 원형 멀티컬러 진행률 |
| stage-bars | 단계별 진행률 | LO/완료/검수/PNG 바 차트 |
| assignee-cards | 담당자별 현황 | 담당자 카드 목록 |
| episode-summary | 에피소드 요약 | EP별 × 파트별 현황 |
| dept-comparison | 부서별 비교 | BG vs 액팅 비교 (통합 모드) |

---

## 워크플로우 규칙

1. **플랜 우선**: 비자명한 작업(3단계+)은 플랜 모드 진입. 틀어지면 STOP 후 재계획.
2. **서브에이전트 활용**: 리서치/탐색/병렬 분석은 서브에이전트에 위임. 메인 컨텍스트 깨끗하게 유지.
3. **자기개선**: 수정 받으면 `tasks/lessons.md`에 패턴 기록. 동일 실수 반복 방지.
4. **완료 전 검증**: 작동 증명 없이 완료 표시 금지. typecheck + 관련 테스트 + 빌드 + 동작 확인.
5. **자율 버그 수정**: 버그 리포트 받으면 지시 없이 바로 수정. 로그/오류 직접 추적.
6. **단순함 우선**: 최소한의 코드 영향. 과잉 설계 금지. 근본 원인 해결.

---

## Git 규칙

- **커밋 메시지**: 한글로 작성, 변경 내용 명확히 설명
- **Bflow 원본 레포**: **절대 수정 금지** (참고 전용)

---

## 자동 업데이트 원칙

- 팀원은 로컬 PC에 설치된 BFLOW 본체를 실행한다. G드라이브는 배포 창고 역할만 한다.
- 앱 시작 시 스플래시에서 업데이트 상태를 안내하고, 새 버전 준비는 최대 10초까지만 기다린다. 10초 안에 준비되지 않으면 현재 버전으로 먼저 진입한다.
- 앱 사용 중에는 5분 주기로 manifest를 다시 확인해 새 버전을 백그라운드로 받아두고, 좌하단 버전 버튼과 업데이트 모달에서 계속 표시한다.
- 실제 교체는 `지금 업데이트`를 누르거나 앱 종료 시 installer helper로 수행한다. 앱 폴더를 직접 rename/copy하지 말고, 로컬 `installer-pending\BFLOW-Setup.exe`를 실행해 갱신한다.
- installer helper는 현재 BFLOW 프로세스가 완전히 종료된 뒤 `BFLOW-Setup.exe /S`를 실행해야 한다. 앱이 살아있는 동안 installer를 시작하면 Windows 파일 잠금으로 실패할 수 있다.
- 앱 시작 자동 적용은 `.installer-attempted` 시작 확인 마커가 생긴 뒤에만 종료한다. helper 시작 확인 없이 앱을 닫으면 바로가기 실행이 계속 실패하는 루프가 생긴다.
- 좌하단 버전 버튼은 업데이트 유무와 무관하게 항상 업데이트 내역 모달을 연다. 모달은 열자마자 자동 확인하지 않고, 사용자가 `새로고침`을 눌렀을 때만 `update:check-now` IPC로 배포 manifest를 다시 확인한다. 새로고침 중에는 기존 표시 내용을 유지해 중간 상태 때문에 레이아웃이 흔들리지 않게 한다.
- 업데이트 내역 모달은 최신 몇 개 내역을 기본 표시하고, 과거 release note는 사용자가 펼쳐 볼 수 있어야 한다. `DEVLOG/update-notes.json` 항목을 누락하지 말 것.
- **update-notes.json 작성 톤 (한솔 결정)**: B flow 의 사용자는 비개발자 팀원이다. `summary` 와 `description` 둘 다 다음 룰을 따른다:
  - 기술 스택 용어 금지: `PostgREST`, `broadcast`, `Tailwind 토큰`, `dual-write`, `IPC`, `supabase-js`, `cache reload`, `state machine` 같은 단어는 절대 쓰지 않는다.
  - 비개발자가 "아 이게 이래서 이렇게 된거구나" 정도로 알 수 있게 **상황 + 영향 + 결과**를 풀어 쓴다. 예: "잠깐 인터넷이 불안한 사이 변경이 화면에 안 비치던 문제를 잡았어요" (X "PostgREST schema cache stale 대응").
  - 파일명·함수명·컬럼명·IPC 채널명·타입명 같은 식별자 노출 금지. 컴포넌트 이름조차 풀어 설명한다. 예: "확인 창" (O), "FeedbackRequestModal" (X).
  - 컴포넌트/모듈 경로 (`src/...`) 도 노출하지 않는다.
  - 시나리오로 설명한다: "X 상황이었는데 → Y 가 일어났고 → 이제 Z 로 동작해요". 1~3문장 안에 결말까지.
  - `tldr_for_users.md` 처럼 슬랙에 그대로 공유해도 어색하지 않은 톤이 기준. 한솔이 직접 팀에 안내할 때 그대로 쓸 수 있어야 한다.
  - 같은 룰을 PR 본문의 `📋 업데이트 요약` 섹션에도 적용한다 (상세 기술 설명 섹션은 개발자 톤 OK).
- 배포용 `manifest.json`은 `BFLOW-Setup.exe`가 있을 때만 생성한다. `--allow-missing-installer`는 개발용 `build:vite`에서만 사용한다.
- 토스트가 떴다는 것만으로 업데이트 성공으로 판단하지 말고, 다음 실행 버전과 `swap.log`의 `[installer-main]`/`[installer]` 로그, `installer-pending` 정리 여부를 확인한다.
- 설치/적용 중에는 사용자가 상황을 알 수 있어야 한다. renderer는 `applying` 상태를 표시하고, 앱 종료 후 helper는 별도 진행 창을 띄운다.
- PowerShell helper를 TypeScript 백틱 문자열 안에 넣을 때 PowerShell 변수는 `$($name)` 형태로 쓴다. `${name}`은 JavaScript 보간으로 실행되어 helper 시작 전 `ReferenceError`를 만들 수 있다.

---

## 참조 문서

- **`CONTEXT.md`** — 세션 컨텍스트 가이드 (아키텍처, 파일 맵, 알려진 이슈, 스킬 활용법)
- **`ROADMAP.md`** — 전체 개발 로드맵 (Phase 0~9, 기능별 상세 스펙)
- **`DEVLOG/AUTO_UPDATE_OPERATIONS.md`** — 자동 업데이트 운영 기준 (현재 구현/배포 방식의 1차 기준)
- **`DEVLOG/DEPLOYMENT.md`** — 배포 가이드 (배포 목적/경로/방식, 한솔 워크플로우, 자동 업데이트 시스템)
- **`DEVLOG/auto-update-test-scenario.md`** — 자동 업데이트 E2E 테스트 체크리스트
- `tasks/lessons.md` — 과거 실수/패턴 기록 (세션 시작 시 검토)
- `DEVLOG/supabase-migration-plan.md` — Supabase 마이그레이션 상세 계획서
- `DEVLOG/supabase-init.sql` — Supabase DB 스키마 초기화 SQL
- `DEVLOG/migrations/` — 라이브 DB 적용된 SQL 마이그레이션 기록
- `BG_DASHBOARD_PLAN.md` — 초기 구현 계획서
- Bflow 원본 (`/home/user/Bflow`) — 패턴 참고만 (읽기 전용, 수정 금지)

---

## 문서 갱신 규칙

1. **ROADMAP.md**: 항목 착수/완료 시 상태 갱신
2. **CLAUDE.md**: 아키텍처 변경 시 업데이트
3. **package.json**: 기능 추가 → 마이너 버전, 버그 수정 → 패치 버전

---

*문서 버전: 2026-05-08*
*작성: Claude × 한솔 (Studio JBBJ)*
