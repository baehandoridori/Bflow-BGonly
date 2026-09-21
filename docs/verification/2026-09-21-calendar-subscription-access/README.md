# v1.126.0 검증 기록

## 사용자 동작
- localhost:5195 실제 renderer + 더미 데이터로 배한솔 로그인 후 태그 전체 off/on 확인(18→8→18개). 태그 없는 일정은 기존 필터 정책대로 유지.
- 소유자 구독 발급→닫기→다시 열기에서 같은 주소 확인.
- 더미 허혜원으로 전환 후 EP 마일스톤 읽기 전용 설정에서 같은 구독 주소 확인. 저장/교체 버튼 0개. 복사 완료 UI 확인(브라우저 도구 clipboard 읽기는 OS clipboard와 달라 내용 검증 증거로 사용하지 않음).
- 통합 씬 카드 a001 클릭→a002 Ctrl클릭 2개 선택→a002 Ctrl클릭 1개 선택 확인.
- 실제 lasso hook와 두 카드 handler 회귀에서 Ctrl/Meta+9px 이동 오류를 수정 전 재현, 수정 후 통과.

## 서버
- Supabase 프로젝트 mpqifkpxalwxgcrddchv에 calendar_feed_shared_links 적용.
- 실제 Vault에서 server-smoke.sql의 발급/읽기/ACL/CAS/교체/중지/소유권 이전/비공개 권한 assertions 실행. migration transaction 내부 SAVEPOINT 후 fixture ROLLBACK, 성공 후 migration COMMIT.
- 기존 feed 1개 및 enabled 1개 유지. 기존 token/revision 집계 fingerprint fea4df972935e0004e824065bd4173a0 동일.
- 기존 URL hash와 별칭 URL hash의 feed 응답 동일. 별칭 1개, 합성 사용자 잔여 0개.
- 로컬 PGlite Vault fixture는 pgcrypto API 모사이며 실제 Vault 검증과 구분.

## 리뷰·배포
- 별도 작업자의 UI/서버/씬 선택 독립 리뷰 완료. SQL ACL snapshot 및 preview visibility 재조회 지적 수정 후 재검토 통과.
- 최종 빌드/배포 감사: C:/Bflow-BGonly/output/release-audits/2026-09-21-v1.126.0/
- 설치된 앱 종료/재시작 및 사용자 PC 자동 업데이트 실증은 수행하지 않음. Slack 게시 없음.
## 안내 문구 확인
- Google 공식 URL 추가 안내: https://support.google.com/calendar/answer/37100?hl=ko
- Naver 공식 외부 URL 가져오기 안내: https://help.naver.com/service/5620/contents/18399?lang=ko&osType=PC
- 네이버 안내는 가져오기이며 자동 갱신 보장을 하지 않는 문구로 구분.

## 배포 완료
- PR #300 merged: 6a79527abbb42f0fe225056c90a94318907124ed. 이 정확한 SHA에서 npm run build 성공.
- typecheck 및 전체 2,855개 테스트 통과, fail 0 / skip 0.
- Windows installer 201,438,696 bytes. SHA256 f45b9c957192f3a588615af7735dbd6ed495c26b105a92fa18d15a0ff5aff1a3.
- 이전 배포 전체 백업 8,231개 파일 / 986,040,598 bytes, mismatch 0. 원격에 보존하던 추가 파일도 함께 백업.
- payload 선복사/검증 후 manifest 마지막 게시. 최종 7,337개 파일 / 923,594,236 bytes SHA256 mismatch 0. 원격 추가 파일 보존.
- manifest/latest/설치 패키지 모두 1.126.0. 독립 artifact 리뷰도 통과.
- 배포 완료 2026-09-21 12:58 KST. 설치된 사용자 앱은 그대로 두었음.
