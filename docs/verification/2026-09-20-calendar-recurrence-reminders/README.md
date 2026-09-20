# v1.125.0 반복 일정·알림 배포 검증

- 기능 PR: #296, 최소화 알림 보완: #297. 모두 main 병합 완료.
- 정식 설치 파일 코드 SHA: `91201a13672efb63930fbb9c6c582253dd5fc416`.
- `npm run build:vite`, `npm run build` 모두 성공. 각 실행에서 typecheck 및 2,831개 테스트 통과, 실패/건너뛰기 0.
- 배한솔 preview 로그인 후 월·수 4회 반복 생성, 이번 회차만 제목 변경, 캘린더 전체 간트 연결 및 해당 회차의 장소·회의 주소·알림 상세 확인.
- 알림 transport는 메인 30초 타이머, 세션 설정 등록 전 차단, 같은 사용자 재로그인, 조회 중 알림 끄기, 중복 방지, 종료 중 요청, 재시도를 검증했다.
- Supabase migration `20260920062722_calendar_recurrence` 적용. 권한·수정 범위·revision·구독 데이터 테스트는 임시 데이터 트랜잭션 후 롤백했으며 실제 사용자 데이터 개수는 보존했다.
- `calendar-feed` v2 ACTIVE, 원격 4개 파일 내용 일치. 잘못된 토큰 응답 404 및 no-store 확인.
- 기존 v1.124.0 배포본 8,007개 파일 백업 및 해시 검증 완료.
- 새 배포본은 payload 먼저, manifest 마지막으로 반영. 총 **7,337개 파일 / 923,586,154바이트**, SHA-256 불일치 **0**. 원격의 별도 기존 파일은 보존했다.

| 파일 | SHA-256 |
| --- | --- |
| BFLOW-Setup.exe | `80f8240eeb623769178e5618a12ff898891b489d0380d0de3b92fd707687f7c8` |
| latest.yml | `6cf9a7367c20d8f8be413499c98a2b1f72ced0a9ab5f07d3f61d58d075904f8c` |
| manifest.json | `393edf00602b1ac2353d3059f37e0e4b2107b1bca08fd62d977f41c4b5003dbb` |

설치 파일은 201,438,153바이트이며 실제 패키지의 main/preload/renderer가 빌드 결과와 일치한다. 독립 검토에서도 메인 알림 타이머와 필수 파일 포함을 확인했다.

로컬 상세 근거: `C:\Bflow-BGonly\output\release-audits\2026-09-20-v1.125.0\`의 `release-build-result.json`, `build-verified.json`, `deploy-final.json`, `server-smoke-proof.json`, `edge-verified.json`.

## 검증 경계

현재 설치 앱 종료·재시작·설정 삭제는 하지 않았다. Windows 실제 알림 배너와 iPhone/Mac 실제 기기의 구독·알림 수신은 확인하지 않았다. 앱 실행 중에 알림을 보내며, 완전히 종료한 동안 놓친 알림은 재실행 시 최근 30분 범위에서 확인한다. 종일 일정 알림은 한국 시간 오전 9시 기준이다. 외부 캘린더 앱의 갱신 주기와 알림은 해당 앱 설정에 따른다.
