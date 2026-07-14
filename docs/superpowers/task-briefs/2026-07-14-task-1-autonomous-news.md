# Task 1 brief — 자동 뉴스 공통 가격 경로

작업 트리: `C:\Users\user\.codex\worktrees\market-news-chart`
브랜치: `codex/증권-자동뉴스-차트수정`

계획 문서의 Task 1만 수행한다. 다른 Task, 버전, DEVLOG, 문서, `.superpowers/sdd/progress.md`는 수정하거나 stage하지 않는다.

필수 순서:
1. `tests/playgroundMarketAutonomousNews.test.ts`를 먼저 작성하고 `node --test tests/playgroundMarketAutonomousNews.test.ts`가 새 API 부재로 실패하는 것을 확인한다.
2. `shared/playgroundMarketAutoNews.mjs`, `shared/playgroundMarketModel.mjs`, `shared/playgroundMarketPrice.mjs`, `shared/playgroundMarketPrice.d.mts`만 필요한 범위로 수정한다.
3. 자동 뉴스는 KST 매일 1건, id `auto:<date>:<stock>`, deterministic, `automatic: true`, 장중 시작/종료를 가진다.
4. 자동 이벤트는 종료 뒤 제한된 시간에 0까지 감쇠하며, 수동 이벤트의 기존 동작은 보존한다. price wrapper가 manual event를 보존하며 auto event를 id 중복 없이 합쳐야 한다.
5. 새 테스트와 `npm run typecheck`를 통과시킨다.
6. 지정 파일만 stage하여 `모의주식 자동 뉴스 가격 모델 추가`로 커밋한다.
7. `.superpowers/sdd/reports/task-1-implementer.md`에 RED/Green 명령과 결과, 변경 파일, commit SHA, 남은 위험을 기록한다. report는 커밋하지 않는다.

