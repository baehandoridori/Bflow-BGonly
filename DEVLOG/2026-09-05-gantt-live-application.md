# 간트 공유 툴팁 및 실제 DB 적용

사용자 요청: 공유 인원 배지에서 공유자 툴팁 표시, 실제 데이터 적용 작업 진행.
작업 위치: `codex/gantt-workspaces`, `C:/Bflow-BGonly/.worktrees/gantt-workspaces`.

## 진행 순서

- [x] 공통 툴팁 스타일과 지연 동작으로 공유 팀원 이름·권한을 표시하고 실제 사용자 목록에 연결.
- [x] 앱의 Supabase URL과 MCP의 Bflow 프로젝트 `mpqifkpxalwxgcrddchv` 일치 확인.
- [x] 운영 DB의 기존 사용자/캘린더 구조와 사용자 삭제 경로 조회. 간트 테이블·RPC 미적용 확인.
- [x] 독립 리뷰 및 로컬 SQL 실행 검사 후 간트 migration 적용.
- [x] 운영 DB에서 앱과 같은 anon 역할로 저장·공유·캘린더 연결·revision 검증. 검증용 데이터는 트랜잭션 롤백.
- [x] 기존 데이터 보존, Realtime 등록, DB 진단과 최종 타입 검사·테스트·빌드·툴팁 UI 확인.

## 범위

이번 요청은 간트 UI와 실제 DB 연결 적용이다. PR 생성·머지·설치본 배포는 포함하지 않는다.
브라우저 `?preview=1`의 예시 데이터와 운영 데이터는 별개로 유지한다.
인증은 기존 Bflow의 Electron main 세션 actor와 RPC 권한 계약을 따른다. Supabase Auth 전체 전환은 수행하지 않는다.

## 적용 전 확인

- 운영 Bflow 프로젝트: ACTIVE_HEALTHY, PostgreSQL 17.
- 사용자 17명, 캘린더 12개, 기존 캘린더 일정 5개.
- 기존 `delete_user_authorized` → `delete_user_cascade`는 캘린더를 먼저 잠그고, 공유 자산을 관리자에게 이전한 뒤 사용자를 삭제한다. 간트 migration은 기존 함수 본문을 교체하지 않고 사용자 삭제 trigger를 추가한다.
- 보안 진단 적용 전 결과를 세션에서 보관해 새 간트 항목과 기존 항목을 구분한다.

## 반영 결과

- `GanttShareTooltip.tsx`: 실제 폴더의 멤버 ID와 사용자 목록을 연결해 이름·보기/편집 권한을 표시한다. 소유자는 수와 명단에서 제외한다. 0명 안내, hover/focus, 120ms 열기/60ms 닫기, body portal, 화면 경계 보정, Escape 닫기를 지원한다. 기존 `tooltipGlassStyle`을 사용하고 전역 tooltip과 중복되는 title 속성은 사용하지 않는다.
- `electron/main.ts`: 간트 변경 시 캘린더 통지를 기존 `UPDATE` 재조회 경로에 연결했다. 메인 화면과 팝업이 이전 캘린더 캐시를 계속 표시하던 문제를 수정했다. 실제 callback과 consumer를 연결한 회귀 검사 2개를 추가했다.
- 운영 migration `gantt_workspaces`, 버전 **20260905124058**, 적용 성공. 소스 `DEVLOG/migrations/2026-09-05-gantt-workspaces.sql`의 SHA-256: `e30d90a55628e0df157767dfc6a1035238beb81152038e70f7398e49c58dd705`. 적용 시 transaction 안에서 lock_timeout 5초, statement_timeout 45초를 설정했다.
- `gantt_spaces`, `gantt_projects`, `gantt_requests` 생성과 RLS, RPC 10개를 확인했다. Realtime publication은 spaces/projects 두 테이블을 포함한다.
- `DEVLOG/verification/2026-09-05-gantt-live-smoke.sql`을 운영 DB에서 한 배치로 실행했다. anon 역할로 폴더·그룹·작업 생성/재조회, 보기와 편집 권한, 요청 멱등성·충돌 거부, 종일/시간 캘린더 projection, 일괄 완료, 삭제 후 늦은 저장 거부를 검증하고 전체 롤백했다. 반환값 `passed: true`.
- 실제 `electron/ganttStore.ts`를 사용해 Supabase anon HTTP RPC의 read/listCalendarEvents 호출도 성공했다. 앱 시작 부작용을 피하기 위해 모듈의 기본 client 초기화만 격리하고 명시적 실제 client를 주입했다. Electron 창을 실행한 검증은 아니다.
- 검증 후 간트 폴더/프로젝트/요청 이력은 모두 **0행**이다. 시안 데이터는 운영으로 복사하지 않았다.
- users의 id/name/role 및 calendars/calendar_members/calendar_events 전체 내용 지문이 적용 전후 동일하다. `delete_user_authorized`와 `delete_user_cascade` 본문도 동일하다. 보안 진단은 적용 전과 비교해 새 항목 0개를 반환했다(관측 시각 2026-09-05 12:41:28 UTC). 기존 actor 전달 구조의 인증 한계는 그대로다.

## 최종 검증과 남은 릴리스 범위

- `npm.cmd run build:vite`: **exit 0**, renderer/Electron/playground 타입 검사 및 앱 번들 생성 통과.
- 전체 **2,100 pass / 0 fail / 0 cancelled / 0 skipped**. 간트 76개, 캘린더 938개 포함. PGlite SQL 실행 검사를 포함했다. 로그: `%TEMP%/bflow-gantt-live-build.log`.
- 실제 in-app preview에서 공유 배지를 눌러 이름 3명과 보기 권한을 확인하고, 공통 툴팁 디자인·Escape 닫기·브라우저 오류 0건을 확인했다. hover 진입/이탈 지연과 명단 변경·키보드 동작은 React 이벤트 회귀 4개로 검증했다. 현재 브라우저 도구에는 실제 마우스 hover API가 없다.
- 팀원 PC용 설치본 배포와 실제 Electron 다중 계정/Realtime 인수 확인은 아직 수행하지 않았다. 운영 DB와 개발 빌드 연결은 준비됐으며, 브라우저 `?preview=1`은 계속 시안 데이터로 동작한다.
