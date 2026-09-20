# 반복 일정과 시작 전 알림 — 승인된 설계

사용자는 반복 일정, 장소·회의 링크, 시작 전 알림까지 구현·배포를 승인했다. 매월 존재하지 않는 날짜는 건너뛴다.

- 매일/평일/매주/매월/매년, 간격, 요일 복수 선택, 매월 날짜/몇 번째 요일/마지막 날, 종료 날짜·횟수·없음을 지원한다.
- 수정·삭제 범위는 이번 일정/이후 일정/전체다. 날짜·반복 규칙을 바꾸면 해당 범위의 개별 예외는 초기화하며 UI에서 설명한다. 일반 내용 변경은 예외를 보존한다.
- UUID 원본과 원래 발생 날짜로 개별 예외를 저장한다. 화면의 occurrence ID는 UUID RPC나 알림 외래키로 보내지 않는다. 무한 반복을 DB 행으로 미리 생성하지 않는다.
- 순수 공용 엔진으로 조회 구간에서만 펼친다. 캘린더, 간트 연결, 미리보기 및 알림은 같은 계산을 사용한다. 표준 구독은 RRULE/EXDATE/RECURRENCE-ID와 Asia/Seoul 시간대를 사용한다.
- 세션 기반 권한과 revision 검증으로 저장한다. 기존 클라이언트의 반복 원본 변경은 차단한다. 미공유 캘린더를 관리자가 볼 수 있다는 사실만으로 편집이나 알림 수신 대상이 되지 않는다.
- 장소와 http/https 회의 주소, 알림 없음/시작 시/선택한 시간 전을 지원한다. 종일 일정의 알림 기준은 한국 시간 오전 9시다.
- B flow 실행 중 Windows 알림을 표시한다. 재실행 시 최근 놓친 알림을 제한된 기간 내에서 처리하고 사용자별 전달 기록으로 중복을 막는다. 앱이 꺼진 동안의 Windows 알림은 제공하지 않는다. 구독 앱의 알림은 해당 앱 정책에 따른다.
- 테스트 모드도 같은 반복·권한·충돌·롤백 동작을 제공한다. 운영 사용자 데이터는 검증용으로 수정하지 않는다.

## 공용 계약

CalendarRecurrenceRule: frequency(daily/weekly/monthly/yearly), interval(1..99), weekdays(0=일요일), monthlyMode(date/weekday/lastDay), monthDay, ordinal(1..5 또는 -1), weekday, until(날짜), count(1..1000).

CalendarEvent에는 recurrenceRule, recurrenceRevision, recurrenceSeriesId, recurrenceDate, recurrenceExceptions, location, meetingUrl, reminderMinutes를 추가한다. 예외는 occurrenceDate/cancelled/patch이고 화면 ID는 recurrence:<UUID>:<원래 날짜>다.
