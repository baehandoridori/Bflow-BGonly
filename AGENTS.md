# AGENTS.md — B flow

> **프로젝트**: Studio JBBJ 프로덕션 진행 현황 대시보드 (BG + 액팅)
> **타입**: Electron + React + TypeScript 독립 앱
> **현재 상태**: Phase 0-1~0-3 완료, Phase 1~2 완료, Phase 4-1~4-3 완료, Phase 6 Step 1~4 완료, Phase 7-1~7-5 완료, Phase 8-0~8-1, 8-3~8-5 완료, Playground v3 배한솔 한정 테스트 중
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
4. **테스트 모드 동등성**: 모든 기능은 테스트 모드에서도 100% 동작해야 함
5. **자동 업데이트 배포 원칙**: G드라이브에는 빌드 파일을 먼저 모두 올리고 `manifest.json`을 마지막에 갱신할 것. 앱은 manifest를 보고 최신 버전을 감지하므로, 반쯤 올라간 빌드가 최신으로 보이면 안 됨.

---

## 프로젝트 개요

Studio JBBJ 팀(~20명)이 에피소드별 BG/액팅 씬의 진행 상황을 실시간 추적하는 Electron 앱.
Supabase(PostgreSQL + Realtime)를 단일 진실의 원천(SSOT)으로 사용. Google Sheets/Drive 계열 코드는 이미지·레거시 호환 일부에 남아 있다.

**동기화**: 체크박스 토글 → 로컬 즉시 반영(낙관적) → Supabase 저장 → 실패 시 롤백. 다른 사용자 변경은 Realtime WebSocket으로 수신.

### 배플레이그라운드 v3 데이터 경계

- **시세**: `shared/playgroundMarketModel.mjs`의 결정론 모델이 장 전체·업종·종목·이벤트 입력으로 로컬 계산한다. 실제 시장 API나 별도 시세 DB를 사용하지 않는다.
- **화면과 체결**: renderer preview는 같은 공용 모델로 시세와 주문 확인값을 보여 주고, Electron의 `MarketAccountService`가 체결 직전 canonical 가격·거래정지·revision을 다시 검증한다.
- **계좌**: 실제 앱의 예수금·보유 종목·거래 결과는 Supabase가 정본이다. 테스트 모드는 로컬 preview gateway로 같은 명령·rollback 계약을 지킨다.
- **긴 차트**: 완료된 과거 봉만 제한된 cache에 재사용하고 점진 계산한다. 현재 진행 봉은 실제 시간으로 다시 계산하며 오래된 비동기 요청은 중단한다.

---

## 경로

| 구분 | 경로 |
|------|------|
| 개발 | `C:\Bflow-BGonly` |
| 배포 | `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\` |
| 개인 설정 | `%APPDATA%\Bflow-BGonly\` (layout.json, preferences.json) |

**데이터**: 씬/에피소드/체크박스/메모/개인일정 → Supabase, 위젯 레이아웃/개인 설정 → %APPDATA% 로컬 파일

### 제약 사항

- **한글 경로 인코딩**: 배포 경로에 한글 포함 → Node.js `path` 모듈 사용, 경로 하드코딩 금지
- **동시 편집 충돌**: Last-Write-Wins 전략 (Google Sheets 기본 동작). 폴링 주기로 충돌 창 최소화

---

## 기술 스택

Electron + React 18 + TypeScript + Tailwind CSS + Zustand + react-grid-layout + Lightweight Charts 5.2.0 + googleapis

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
4. **완료 전 검증**: 작동 증명 없이 완료 표시 금지. tsc + 빌드 + 동작 확인.
5. **자율 버그 수정**: 버그 리포트 받으면 지시 없이 바로 수정. 로그/오류 직접 추적.
6. **단순함 우선**: 최소한의 코드 영향. 과잉 설계 금지. 근본 원인 해결.
7. **프리뷰 로그인 필수**: 로컬 preview/mockup/브라우저 검증에서 로그인 화면이 보이면 이름 `배한솔`, 비밀번호 `1234`로 반드시 로그인한 뒤 화면을 확인한다. 로그인 전 화면만 보고 검증 완료로 판단하지 말 것. 이 값은 preview 확인용 테스트 데이터로만 사용한다.

---

## 자동 업데이트 원칙

- 팀원은 로컬 PC에 설치된 BFLOW 본체를 실행한다. G드라이브는 배포 파일을 받아오는 창고 역할만 한다.
- 앱 시작 시 스플래시에서 업데이트 상태를 안내하고, 최신 버전 준비는 최대 10초까지만 기다린다. 준비 완료 시 installer helper가 로컬 `BFLOW-Setup.exe`를 실행해 최신 버전으로 갱신하고, 10초 초과/실패 시 현재 버전으로 먼저 연다.
- 앱 사용 중에는 5분 주기로 manifest를 다시 확인해 새 버전을 백그라운드로 받아두고, 토스트 + 좌하단 버전 버튼 + 업데이트 모달로 계속 표시한다. 모달에는 현재 버전과 최신 버전을 명확히 강조한다.
- 실제 적용은 `지금 업데이트` 클릭 시 즉시 수행하거나, 일반 종료 후 다음 앱 실행의 startup gate에서 자동 수행된다. 앱 폴더를 직접 rename/copy하지 말 것. 토스트가 떴다는 것만으로 성공 판단 금지. 다음 실행 버전과 `%LOCALAPPDATA%\Bflow-BGonly\swap.log`의 `[installer-main]`/`[installer]` 로그를 확인한다.
- installer helper는 현재 BFLOW 프로세스가 완전히 종료된 뒤 `BFLOW-Setup.exe /S`를 실행해야 한다. 앱이 살아있는 동안 installer를 시작하면 Windows 파일 잠금으로 실패할 수 있다.
- 앱 시작 자동 적용은 `.installer-attempted` 시작 확인 마커가 생긴 뒤에만 종료해야 한다. helper 시작 확인 없이 앱을 닫으면 사용자가 바로가기를 눌러도 앱이 계속 안 뜨는 루프가 생긴다.
- 좌하단 버전 버튼은 업데이트 유무와 무관하게 항상 업데이트 내역 모달을 열어야 한다. 모달은 열자마자 자동 확인하지 않고, 사용자가 `새로고침`을 눌렀을 때만 `update:check-now`로 배포 상태를 다시 확인한다. 새로고침 중에는 기존 표시 내용을 유지해 중간 상태 때문에 레이아웃이 흔들리지 않게 한다.
- 업데이트 내역 모달은 최신 몇 개 내역을 기본 표시하고, 과거 release note는 사용자가 펼쳐 볼 수 있어야 한다. `DEVLOG/update-notes.json` 항목을 누락하지 말 것.
- 배포용 `manifest.json`은 `BFLOW-Setup.exe`가 있을 때만 생성한다. `--allow-missing-installer`는 개발용 `build:vite`에서만 사용한다.
- 설치/적용 중에는 사용자가 상황을 알 수 있어야 한다. renderer는 `applying` 상태를 표시하고, 앱 종료 후 helper는 별도 진행 창을 띄운다.
- PowerShell helper를 TypeScript 백틱 문자열 안에 넣을 때 PowerShell 변수는 `$($name)` 형태로 쓴다. `${name}`은 JavaScript 보간으로 실행되어 helper 시작 전 `ReferenceError`를 만들 수 있다.

---

## Git 규칙

- **커밋 메시지**: 한글로 작성, 변경 내용 명확히 설명
- **Bflow 원본 레포**: **절대 수정 금지** (참고 전용)

---

## 참조 문서

- **`CONTEXT.md`** — 세션 컨텍스트 가이드 (아키텍처, 파일 맵, 알려진 이슈, 스킬 활용법)
- **`ROADMAP.md`** — 전체 개발 로드맵 (Phase 0~7, 기능별 상세 스펙)
- **`DEVLOG/AUTO_UPDATE_OPERATIONS.md`** — 자동 업데이트 운영 기준 (최신 배포 방식의 1차 기준)
- **`DEVLOG/auto-update-test-scenario.md`** — 자동 업데이트 E2E 테스트 체크리스트
- `tasks/lessons.md` — 과거 실수/패턴 기록 (세션 시작 시 검토)
- `BG_DASHBOARD_PLAN.md` — 초기 구현 계획서
- Bflow 원본 (`/home/user/Bflow`) — 패턴 참고만 (읽기 전용, 수정 금지)

---

## 문서 갱신 규칙

1. **ROADMAP.md**: 항목 착수/완료 시 상태 갱신
2. **AGENTS.md**: 아키텍처 변경 시 업데이트
3. **package.json**: 기능 추가 → 마이너 버전, 버그 수정 → 패치 버전

---

*문서 버전: 2026-07-13*
*작성: Codex × 한솔 (Studio JBBJ)*
