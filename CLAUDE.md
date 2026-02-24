# CLAUDE.md — B flow

> **프로젝트**: Studio JBBJ 프로덕션 진행 현황 대시보드 (BG + 액팅)
> **타입**: Electron + React + TypeScript 독립 앱
> **현재 상태**: Phase 1~2 완료, Phase 6 Step 1~4 완료, Phase 7-1~7-5 완료, **Phase 0 긴급 안정화 착수**
> **로드맵**: `ROADMAP.md` 참조 | **세션 가이드**: `CONTEXT.md` 참조
>
> **이력**: 원래 BG(배경) 전용 현황판(`Bflow-BGonly`)으로 시작했으나, 액팅까지 포함한 통합 앱이 되면서 정식 명칭 **B flow**로 전환됨. 레포 이름(`Bflow-BGonly`)과 `app.name`은 기존 사용자 데이터 경로(`%APPDATA%\Bflow-BGonly\`) 호환을 위해 유지.

---

## ⚠️ 필수 규칙

1. **Bflow 레포 (`/home/user/Bflow`)는 참고 전용이다. 절대 직접 수정하지 말 것.**
   - 코드 구조, 패턴 참고만 가능
   - 파일 수정, 커밋, 푸시 일절 금지
   - 모든 개발은 반드시 `Bflow-BGonly` 레포에서만 진행
2. **빌드 검증**: 코드 변경 후 반드시 `tsc --noEmit` + `vite build` 통과 확인
3. **낙관적 업데이트 패턴**: 모든 데이터 변경은 즉시 UI 반영 → 백그라운드 동기화
4. **테스트 모드 동등성**: 모든 기능은 테스트 모드에서도 100% 동작해야 함

---

## 프로젝트 개요

Studio JBBJ 팀(~20명)이 에피소드별 BG/액팅 씬의 진행 상황을 실시간 추적하는 Electron 앱.
Google Sheets를 단일 진실의 원천(SSOT)으로 사용. 여러 사용자가 동시에 앱을 열어두고 협업.

**동기화**: 체크박스 토글 → 로컬 즉시 반영(낙관적) → Google Sheets 저장 → 실패 시 롤백 + 재시도. 다른 사용자 변경은 주기적 폴링으로 감지.

---

## 경로

| 구분 | 경로 |
|------|------|
| 개발 | `C:\Bflow-BGonly` |
| 배포 | `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly\` |
| 개인 설정 | `%APPDATA%\Bflow-BGonly\` (layout.json, preferences.json) |

**데이터**: 씬/에피소드/체크박스 → Google Sheets, 위젯 레이아웃/개인 설정 → %APPDATA% 로컬 파일

### 제약 사항

- **한글 경로 인코딩**: 배포 경로에 한글 포함 → Node.js `path` 모듈 사용, 경로 하드코딩 금지
- **동시 편집 충돌**: Last-Write-Wins 전략 (Google Sheets 기본 동작). 폴링 주기로 충돌 창 최소화

---

## 기술 스택

Electron + React 18 + TypeScript + Tailwind CSS + Zustand + react-grid-layout + googleapis

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

---

## Git 규칙

- **커밋 메시지**: 한글로 작성, 변경 내용 명확히 설명
- **Bflow 원본 레포**: **절대 수정 금지** (참고 전용)

---

## 참조 문서

- **`CONTEXT.md`** — 세션 컨텍스트 가이드 (아키텍처, 파일 맵, 알려진 이슈, 스킬 활용법)
- **`ROADMAP.md`** — 전체 개발 로드맵 (Phase 0~7, 기능별 상세 스펙)
- `tasks/lessons.md` — 과거 실수/패턴 기록 (세션 시작 시 검토)
- `BG_DASHBOARD_PLAN.md` — 초기 구현 계획서
- Bflow 원본 (`/home/user/Bflow`) — 패턴 참고만 (읽기 전용, 수정 금지)

---

## 문서 갱신 규칙

1. **ROADMAP.md**: 항목 착수/완료 시 상태 갱신
2. **CLAUDE.md**: 아키텍처 변경 시 업데이트
3. **package.json**: 기능 추가 → 마이너 버전, 버그 수정 → 패치 버전

---

*문서 버전: 2026-02-21*
*작성: Claude × 한솔 (Studio JBBJ)*
