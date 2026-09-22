# v1.127.2 씬 Shift 선택 검증

- 2026-09-21 착수, 2026-09-22 최신 main(PR303) 통합 후 재검증.
- 실제 부모 JSX → 부모 selection handler → 카드 click handler 회귀 21개 통과. 정방향/역방향/반복Shift 앵커 유지, Ctrl union, 필터/정렬/그룹 간 범위, 앵커 없음/숨김, 한쪽 부서만 존재하는 씬, 이전Ctrl 미세이동과 더블클릭 검증 포함.
- localhost:5195 실제 renderer 더미 계정에서 통합 a001→Shift a005 5개, Ctrl a003 해제4개, BG a005→Shift a002 4개, BG 레이아웃 a001→Shift a004 4개, ACT a002→Shift a006 5개 선택 확인.
- 초기 독립 리뷰에서 존재하지 않는 부서 selection ID 포함 문제를 발견. 세션 중단 후 메인이 수정하고 추가 회귀21개와 실제 UI를 확인. 최종 독립 리뷰는 이용 제한으로 미완료이며 메인 검토/테스트로 구분한다.
- 릴리스 감사: C:/Bflow-BGonly/output/release-audits/2026-09-22-v1.127.2/. 설치 앱 재시작·Slack 게시 없음.
