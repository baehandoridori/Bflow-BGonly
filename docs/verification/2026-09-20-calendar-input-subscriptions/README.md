# v1.124.0 날짜·시간 입력 및 외부 구독 검증

- 격리 작업 경로: `C:\Bflow-BGonly\.worktrees\calendar-input-subscriptions`. 기존 개발 폴더의 작업은 보존했다.
- `npm run typecheck`, `npm run build:vite`, 정식 `npm run build`: 성공. 각 전체 빌드 필수 테스트 2,751개 통과, 실패·제외 0개. 마지막 팝업 보완을 포함한 입력·구독 UI 34개도 별도로 통과했다.
- 입력: 직접 입력·blur·실제 저장, 잘못된 초안 저장 차단, 윤년·연도 경계·자정, 외부 정본 갱신, 간트 마일스톤과 편집 권한을 테스트했다.
- 구독: 소유자·다른 관리자·편집자 권한, 세션 변경, 오래된 revision, 해시만 저장, 원본 삭제·소유권 이전, 선택 캘린더의 간트 projection 범위를 실제 PGlite DB에서 확인했다.
- 별도 검토에서 RFC 구독에 불필요한 METHOD 선언, 동일 계정 세션 재조회, 화면 중앙에서 팝업이 줄어드는 문제를 수정했다.

## 운영 서버

- DB migration: `20260919171243_calendar_external_feed` (로컬 원본 `DEVLOG/migrations/20260919170351_calendar_external_feed.sql`).
- Edge Function `calendar-feed`: version 1, ACTIVE. verify_jwt=false는 256비트 URL 토큰을 자체 인증하기 때문이며 다른 함수 설정은 바꾸지 않았다.
- 합성 캘린더 1개·일정 1개로 실제 HTTPS GET 200 / text-calendar / private no-store / 서울 09:30 → UTC 00:30을 확인했다.
- 해시 교체 후 이전 주소 404, 새 주소 200. 중지 후 HEAD 404.
- 시험 캘린더·일정·구독은 삭제했다. 최종 구독 행 0개. 기존 사용자 캘린더는 공개하지 않았다.
- anon은 피드 테이블 조회·feed_read RPC 실행 불가, service_role만 feed_read 실행 가능함을 확인했다.

## 브라우저

- 로컬 테스트 모드에 배한솔/1234 로그인 후 일정 생성·시간 930 정규화·2시간 길이 선택·15분 목록·날짜 팝업을 확인했다.
- 다크·라이트 모드에서 빠른 날짜 선택까지 팝업 안에 보임을 확인했다. 같은 폴더의 `date-picker-dark.png`, `date-picker-light.png`, `time-picker-dark.png`, `subscription-preview.png`를 증거로 보관한다.
- 캘린더 설정에서 구독 발급·복사·중지를 확인했다. 프리뷰는 외부에서 열리지 않는 `.invalid` 주소임을 명시한다.
- 실제 아이폰·맥 기기에서의 앱 구독 동작은 직접 확인하지 않았다. 표준 파일 파싱·실제 HTTPS 응답과 [Apple 공식 안내](https://support.apple.com/ko-kr/102301)를 기준으로 구현했다.

## 사용 안내

캘린더 메뉴 → 설정 열기 → 아이폰·맥에서 구독 → 구독 주소 발급 → 주소 복사.

아이폰에서는 캘린더 → 캘린더 추가 → 구독 캘린더 추가에 붙여넣는다. 맥에서는 파일 → 새로운 캘린더 구독에 붙여넣고 위치를 iCloud로 선택한다. 같은 Apple 계정의 기기에서 구독을 확인할 수 있다. 외부 앱의 갱신 주기를 따르는 읽기 전용 연동이며, 주소를 가진 사람은 일정 제목·시간·태그·메모를 볼 수 있다.

정식 설치 파일과 배포 해시는 `C:\Bflow-BGonly\output\release-audits\2026-09-20-v1.124.0`에 기록한다. 설치된 사용자 앱을 강제로 종료하거나 재시작하지 않는다.

## 정식 빌드

- 기능 PR [#294](https://github.com/baehandoridori/Bflow-BGonly/pull/294), 머지 커밋 `17a72862e50b655cf1a41287ca1c3b13da03435c`에서 빌드했다. 별도 에이전트가 입력·UI 세션·서버 권한·ICS 표준을 교차 검토했고 지적 사항을 반영했다. GitHub 자동 리뷰 봇은 실행하지 않았다.
- 설치 파일 `BFLOW-Setup.exe`: 201,424,969 bytes, SHA256 `7b936045eb4323d019a03fbc38dc894a676a605c258ff36709fc74adad27bf6d`.
- 패키지 main/preload 및 renderer JS 63개가 빌드 원본과 일치한다. 구독 RPC·IPC·세션 검사·새 입력 UI·구독 UI·휴가 API 설정 포함 여부를 확인했다. 업데이트 기록 195개를 유지했다.
- Edge Function 3개 배포 파일과 머지 소스 SHA256도 모두 일치한다 (`edge-source-audit.json`).
- 이전 v1.123.0 원격 파일 7,889개 / 961,753,710 bytes를 보관했고 SHA256 불일치 0개를 확인했다 (`backup-verified.json`).

## 배포 완료

- 2026-09-20 02:26 KST, 공유 드라이브 배포 완료. manifest를 제외한 7,336개 파일을 먼저 복사·검증하고 manifest를 마지막에 갱신했다.
- 최종 7,337개 파일 / 923,485,793 bytes, SHA256 불일치 0개 (`deploy-final.json`). 원격에 남아 있는 이전 번들은 삭제하지 않았다.
- 원격 manifest·latest.yml·앱 package 버전 모두 1.124.0이다. `latest.yml`의 설치 파일 SHA512와 manifest 크기도 일치한다.
- `latest.yml` SHA256: `937bb822aab9ff4e2667966fcf8a65f3f9782e3cbfb5efe2d4e6a7c037745d0a`.
- `manifest.json` SHA256: `7633a7b31dee83b8ccbf301df3841a5a082df3e77e6b5b31436bc7f29eb82cfa`.
- 사용자 PC의 실제 적용은 앱의 업데이트 안내 또는 정상 종료 후 다음 실행으로 이루어진다. 배포 검증을 설치 완료로 대신하지 않았다.
