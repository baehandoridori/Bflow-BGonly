# Calendar recurrence and reminders implementation plan

**Goal:** 반복 일정과 개별 예외, 장소/회의 URL/시작 알림을 캘린더·간트·외부 구독에 일관되게 제공하고 배포한다.
**Architecture:** UUID series + date-keyed exceptions, revision CAS, canonical session RPC, shared windowed recurrence engine, native reminder delivery ledger.
**Stack:** React/TypeScript/Electron/Supabase/PostgreSQL/iCalendar.
**Spec:** ../specs/2026-09-20-calendar-recurrence-reminders.md
**Constraints:** 기존 dirty 루트 보존, 별도 작업 브랜치, 낙관적 변경 후 실패 롤백, 테스트 모드 동등성, 실제 앱 재시작 금지, manifest 마지막 배포.

- [x] 공용 반복 엔진·타입·ICS 출력 및 경계 테스트 (calendar_tag_ui)
- [x] DB 원본/예외·권한·revision·범위 변경 RPC·구독 데이터 및 DB 테스트 (calendar_data)
- [x] 세 일정 폼의 반복·세부정보·범위 선택 UI와 회귀 테스트 (calendar_sharing)
- [x] IPC/서비스/preview 연결, 날짜 구간 조회 및 간트 연결 (root)
- [x] canonical 사용자 기준 알림 스케줄과 중복방지·놓친 알림 테스트 (root)
- [x] typecheck, 관련 테스트, build:vite 및 로그인 후 실제 UI 확인
- [x] 변경 검토, DB/Edge 배포, 버전·업데이트 문서, PR/merge (#296, #297)
- [x] 정확한 merge SHA 정식 build, 기존 배포 백업, manifest 마지막 반영, 전체 파일 해시 검증 (91201a13, 7,337 files 일치)

일정 변경은 원본 UUID와 occurrenceDate, scope, expectedRevision, snake_case patch로 저장한다. 읽기는 예외를 포함한 원본 목록을 유지하고 각 소비자가 필요한 구간만 펼친다. 이후 범위 변경은 한 트랜잭션에서 원본을 종료하고 새 원본을 만든다.
