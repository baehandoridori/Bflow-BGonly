# 자동 업데이트 E2E 테스트 시나리오

> 기준 버전: `v1.22.19`
> 목적: 토스트 감지뿐 아니라 실제 installer helper 적용, 재실행, 업데이트 내역 표시까지 검증한다. `v1.22.10 → v1.22.13` directory swap 실패 찌꺼기가 남은 PC도 복구 경로에 포함한다.
> 운영 권한: 현재 한솔이 자동 업데이트 작업을 요청한 경우 PR/머지/정식 빌드/G드라이브 배포/실제 업데이트 모니터링까지 Codex가 진행할 수 있다. DB/슬랙/팀 공지는 별도 지시를 받는다.

---

## 0. 테스트 전 준비

- 테스트 PC에는 현재 배포된 구버전 앱이 설치되어 있어야 한다.
- `%LOCALAPPDATA%\Bflow-BGonly\swap.log`가 있으면 백업하거나 삭제해 이번 테스트 로그를 구분한다.
- 실패 복구 테스트에서는 `%LOCALAPPDATA%\Programs\BFLOW-pending`, `%LOCALAPPDATA%\Bflow-BGonly\installer-pending`, `%LOCALAPPDATA%\Bflow-BGonly\.installer-attempted`, `%LOCALAPPDATA%\Bflow-BGonly\.swap-attempted`, `%LOCALAPPDATA%\Bflow-BGonly\.swap-suppressed` 상태를 먼저 기록한다.
- 배포 시 `manifest.json`은 항상 마지막에 갱신한다.
- 배포용 `manifest.json`에는 `installer.fileName = BFLOW-Setup.exe`와 `installer.sizeBytes`가 있어야 한다.
- 성공 판정은 토스트가 아니라 다음 실행 버전과 `swap.log`의 `[installer-main]`/`[installer]` 로그로 한다.

---

## 1. 시작 시 업데이트 테스트

목표: 구버전 앱을 새로 켰을 때 스플래시에서 최신 버전을 준비하고, 10초 안에 준비되면 새 버전으로 다시 열린다.

절차:

1. 테스트할 패치 버전을 준비한다. 예: 현재 설치 `v1.22.18`, 배포 예정 `v1.22.19`.
2. 변경을 PR/머지한다.
3. 한솔 PC에서 정식 배포 빌드를 만든다.
4. G드라이브 dist에 배포하되 `manifest.json`을 마지막에 올린다.
5. 테스트 PC에서 기존 구버전 앱을 완전히 종료한다.
6. 앱을 다시 실행한다.

기대 결과:

- 스플래시에 업데이트 확인/준비 문구가 보인다.
- 10초 안에 준비되면 installer helper 진행 창이 보이고, 설치 후 최신 앱이 다시 열린다.
- 좌하단 버전이 배포 예정 버전으로 보인다.
- `%LOCALAPPDATA%\Bflow-BGonly\swap.log`에 `[installer-main]`, `[installer] installer apply OK`가 남는다.

---

## 2. 앱 실행 중 업데이트 테스트

목표: 앱을 켜둔 상태에서 한솔이 새 빌드를 올렸을 때 5분 주기 체크가 감지하고 토스트/버전 버튼/모달이 표시된다.

절차:

1. 현재 배포 앱을 켜둔 상태로 둔다.
2. 테스트용 패치 버전을 하나 올린다.
3. `DEVLOG/update-notes.json` 맨 위에 새 버전 항목을 추가한다. 기존 항목은 삭제하지 않는다.
4. PR/머지/정식 배포 빌드/G드라이브 배포를 진행한다.
5. 앱을 그대로 켜둔 상태에서 최대 5분 기다리거나, 좌하단 버전 모달의 `새로고침`을 눌러 즉시 확인한다.

기대 결과:

- 지속 토스트가 뜬다.
- 좌하단 버전 버튼에 배지가 표시된다.
- 버전 버튼 클릭 시 업데이트 모달이 열린다.
- 모달에서 현재 버전과 최신 버전이 구분된다.
- 최신 버전 카드가 테마 액센트 색상으로 펄스 글로우된다.
- `즉시 적용 가능` 버튼 hover 시 `즉시 업데이트`로 자연스럽게 전환된다.
- 준비 중에는 설치 파일 다운로드 진행률이 보인다.
- `이전 업데이트 내역 N개 보기`를 누르면 최신 3개보다 오래된 내역도 보인다.
- `새로고침`을 눌러도 모달 카드/내역 영역이 순간적으로 깨지거나 접히지 않는다.

---

## 3. 즉시 업데이트 적용 테스트

목표: 토스트/모달에서 즉시 업데이트를 눌렀을 때 저장 대기 후 installer helper로 새 버전이 열린다.

절차:

1. 2번 테스트에서 업데이트 준비 완료 상태를 만든다.
2. 토스트 또는 모달의 `지금 업데이트`를 누른다.
3. 앱이 종료/재실행될 때까지 기다린다.

기대 결과:

- 저장 중인 작업이 있으면 먼저 저장 대기 안내가 나온다.
- 앱이 닫힌 뒤 별도 업데이트 적용 진행 창이 표시된다.
- 진행 창은 BFLOW 프로세스가 종료된 뒤 installer를 실행한다. `swap.log`에 `waiting for parent`, `BFLOW processes all exited`, `installer started` 순서가 남아야 한다.
- installer helper 후 앱이 재실행된다.
- 좌하단 버전이 배포 예정 버전으로 바뀐다.
- `swap.log`에 `[installer-main]`, `[installer]`, `installer apply OK`, `BFLOW relaunched`가 남는다.

---

## 4. 실패/지연 폴백 테스트

목표: G드라이브 동기화가 늦거나 파일이 아직 덜 올라온 상태에서 앱이 막히지 않는다.

절차:

1. `manifest.json` 갱신 전 또는 G드라이브 동기화 중간 상태에서 앱을 실행한다.
2. 스플래시에서 최대 10초까지만 기다리는지 확인한다.

기대 결과:

- 업데이트 준비가 늦으면 현재 버전으로 먼저 열린다.
- 앱 안에서 업데이트 상태가 계속 표시되거나 다음 주기에서 다시 시도한다.
- 기본 Windows 알림창이 아니라 스플래시/앱 UI로 안내된다.

---

## 5. 통과 기준

- `npm run typecheck` 통과
- `npm run test:auto-update` 통과
- `npm run build:vite` 또는 정식 배포 시 `npm run build` 통과
- manifest에 `releaseNotes` 전체 이력 포함
- 시작 시 업데이트 성공
- 앱 실행 중 업데이트 감지 성공
- `지금 업데이트` 또는 앱 종료 후 실제 버전 상승
- `swap.log`에 `[installer-main]`/`[installer]` 로그가 남음
- `%LOCALAPPDATA%\Bflow-BGonly\installer-pending`이 성공 후 정리됨

---

## 6. v1.22.10~v1.22.13 directory swap 실패 찌꺼기 복구 테스트

목표: 예전 실패로 남은 `BFLOW-pending`, `.swap-attempted`, `.swap-suppressed`가 현재 installer 방식 감지를 막지 않는다.

절차:

1. 수동 설치 전 현재 상태를 기록한다: 설치 버전, pending 버전, `.ready`, `.swap-attempted`, `.swap-suppressed`.
2. 최신 `BFLOW-Setup.exe`를 실행해 수동 설치한다.
3. 첫 실행 후 pending 버전이 현재 버전 이하이면 앱이 조용히 pending과 `.swap-attempted`를 정리하는지 확인한다.
4. `.swap-suppressed`가 `1.22.12`로 새로 생기지 않아야 한다.
5. 이어서 `v1.22.15`를 배포하고, 앱 실행 중 업데이트 감지/적용 테스트를 진행한다.

성공 기준:

- 수동 설치 직후 좌하단 버전이 `v1.22.14`다.
- 오래된 `BFLOW-pending`과 `.swap-attempted`가 정리된다.
- `.swap-suppressed`가 없거나 현재 버전과 다른 오래된 값이면 자동 정리된다.
- `v1.22.15` 배포 후 토스트/모달이 뜨고, `지금 업데이트` 후 앱이 `v1.22.15`로 재실행된다.
