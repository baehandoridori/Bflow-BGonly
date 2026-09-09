# 새 로그인 서버 전용 판정 — 2026-09-09

## 범위와 승인

- 오프라인에서는 새 로그인을 보류하는 정책을 사용자가 승인했다.
- 새 로그인만 서버 `app_login` 결과로 판정한다. 로컬 사용자 목록은 표시·기억된 세션 복원 용도로 남긴다.
- 계정, 비밀번호, 로그인 기록 파일, 캐시, 개인 설정, 업무 데이터는 삭제·초기화하지 않는다.
- 기존 기억된 세션의 복원·만료 정책과 서버 비밀번호 오류·잠금 정책은 변경하지 않는다.

## 원인과 변경

`SessionManager.verifyCredentials`는 서버가 unavailable일 때 로컬 디렉터리로 비밀번호를 대조할 수 있었다. 따라서 PC별 목록 누락·오래된 비밀번호가 서버 연결 실패와 섞여 서로 다른 결과를 만들었다. 이 대체 인증 경로를 제거하고, 서버 거절만 계정·비밀번호 오류로 표시한다. 연결 실패·RPC 예외·provider 누락은 연결과 업데이트 확인 안내로 끝낸다. 비밀번호를 자동 재전송하지 않는다.

`userService.login`은 IPC 누락·예외를 실패 결과로 변환해 로그인 화면에서 다시 시도할 수 있게 한다. 설치 앱의 `file:` 환경에서는 preview API가 설치되지 않는다.

브라우저 preview에는 명시적인 서버 가용성 모의 훅을 추가했다. 장애 중 사용자 목록을 읽거나 기존 세션을 변경하지 않는다. raw 실패 응답도 마지막 확정 payload를 복사해 반환하며, 성공한 사용자 전환·로그아웃·기억 복원 때 snapshot을 갱신한다.

## 검증 기록

- TDD: 핵심 기존 구현에서 새 계약 테스트 6개 실패 → 수정 후 통과. 프리뷰는 5개 실패 → 수정 후 통과. 독립 리뷰의 raw payload 불일치는 추가 테스트 3개 실패 → snapshot 보완 후 통과.
- 핵심 인증 24개 + preview 8개: 독립 검토자가 재실행하여 32/32 통과.
- 인증·기억된 세션·캘린더·개인 할 일 관련 묶음 215/215 통과. preview 관련 회귀 묶음 158/158 통과. 서로 겹치는 테스트이므로 합산하지 않는다.
- 독립 최종 코드 리뷰: Critical 0 / Important 0 / Minor 0. 이전 preview payload P2 해결 확인.
- 로컬 브라우저에서 로그인 전 v1.117.4 업데이트 내역 진입과 preview 테스트 계정 로그인 후 전체 현황 대시보드 표시 확인. 최종 snapshot 수정 반영 후 다시 로그인 확인.
- 최종 `npm run build:vite` exit 0: 타입 검사와 전체 테스트 2,519개 중 2,491개 통과, 실패 0개, 기존 DB 환경 필요 28개 건너뜀. renderer/main/preload 빌드 통과.

## 릴리스 빌드

- 구현 PR: [#281](https://github.com/baehandoridori/Bflow-BGonly/pull/281), 2026-09-09 병합 완료.
- GitHub Codex가 검토 커밋 `4a05c2514e86b1c6cec6ed9b85732e4d964676d9`에 `Didn't find any major issues`를 명시했다. issue comments, line comments, reviews, trigger reactions 네 곳을 확인했고 미해결 지적은 없었다.
- 정식 빌드 커밋: `0eb57259e00e3f877cf4a34fb8ea37ba37519f69`. 검토한 커밋과 파일 내용이 동일하며, 원래 dirty 개발 폴더는 보존하고 별도 clean checkout에서 빌드했다.
- `npm run build` exit 0. 타입 검사·전체 테스트 2,491 통과 / 0 실패 / 기존 DB 28 건너뜀을 다시 확인했다.
- 버전: package / manifest / latest 모두 `1.117.4`. `BFLOW-Setup.exe`는 201,397,341 bytes. manifest 생성 시각은 `2026-09-09T13:57:01.844Z`.
- manifest의 win-unpacked 기록: 7,203 files / 695,425,729 bytes. 업데이트 내역 188개를 보존했다.
- 독립 설치 산출물 검증: Critical 0 / Important 0 / Minor 0. installer의 latest SHA-512 두 항목이 실측과 일치했다. renderer·main·preload·splash 127개 파일의 빌드 결과와 패키지 내부 SHA-256 불일치 0, 패키지 내부 최신 로그인 코드 포함을 확인했다. 설치 파일 자체를 실행한 PC E2E는 아니다.

| 필수 배포 파일 | 빌드 SHA-256 |
|---|---|
| BFLOW-Setup.exe | `9812101740447ac75b635820a70d5b246c09650ae81041b2ce32ba61f66dca47` |
| latest.yml | `3b2ecf3061056c947eaccc198b2371fbad20c99690b9670db9f84192b9961b3b` |
| manifest.json | `1706705e784283447c261502088e57a1f5dd72660e1aeae92c3ca185c760ccd7` |

## 공유 드라이브 백업 지연과 복구 검증

- 최초 G드라이브 내부 전체 백업에서 일부 `lucide-react` 파일 복사가 `ERROR 121 / semaphore timeout`으로 지연됐다. 해당 배포 작업을 중단했으며, 이 시점에는 live payload 복사와 manifest 갱신을 시작하지 않았다.
- 중간 백업 폴더는 삭제하지 않았다. 이 미완료 폴더를 완전한 백업이라고 표시하지 않는다.
- 현재 공개된 v1.117.3의 installer·latest·manifest SHA-256이 로컬 이전 정식 빌드와 모두 같음을 재확인했다. 그 공식 배포본 전체를 단일 TAR로 묶었다.
- TAR를 새 로컬 폴더에 실제 추출한 뒤 원본 7,333개 / 923,259,444 bytes 전체를 다시 해시 대조했다. 불일치 0. TAR는 929,496,064 bytes이며 SHA-256은 `f93298f4632e926a7865cb85ff245015df95176873098621eaa9881da8cd4b07`이다.
- 이 TAR는 이전 **공식 배포 payload**의 검증된 복구본이다. 공유 드라이브에 남아 있는 오래된 여분 파일까지 동일 시점으로 복제한 스냅샷은 아니다. 여분 파일은 배포 중 삭제하지 않고 live에 보존한다.

## 실제 공유 드라이브 게시

- 게시·핵심 재검증 완료: **2026-09-09 23:35:56 KST**, v1.117.4. 설치 파일·manifest·latest·패키지 내부 버전 모두 일치한다.
- 위 표의 필수 3파일 SHA-256은 G드라이브에서도 각각 일치했다. `manifest.json`은 설치 파일·변경 파일 해시와 전체 목록·크기를 검증한 뒤 마지막에 게시했다. 전체 원격 파일의 내용 검증 완료는 아래의 추가 감사·보완 이후다.
- 독립 원격 재검증: `2026-09-09T14:37:37Z`, 핵심 설치 배포 범위 Critical 0 / Important 0 / Minor 0. 필수 3파일 SHA-256, installer SHA-512·크기, manifest/latest/패키지 버전, 패키지 main/preload/index.html SHA-256을 직접 재확인했다.
- 검증 방식은 **정식 installer 전체 + 모든 변경 파일 내용 + 전체 파일 목록·크기**다. 대상은 7,333파일 / 923,262,063 bytes. 이전 공식 빌드와 내용이 다른 payload 121개 및 마지막 manifest를 합한 122개 파일의 원격 SHA-256이 일치했다.
- 최초 게시 시 미변경 7,211개 파일은 이전 공식 로컬 빌드와 현재 로컬 빌드의 SHA-256이 같고 G드라이브에 같은 크기로 존재함을 확인했다. 이 시점에는 원격 전체 SHA-256 검사가 진행 중이었으므로 핵심 설치 배포 검증만 완료로 보고했다. 설치형 자동 업데이트는 전체 해시가 일치한 `BFLOW-Setup.exe`를 사용한다.
- 파일 내용이 같아도 새 빌드의 수정시각 차이 때문에 대량 재복사가 일어났다. 실제 예로 `align-justify.js.map`의 이전/현재 로컬 SHA-256은 같지만 수정시각은 달랐다. 재복사를 중단하고 내용 기준으로 검사한 뒤, 중단 시 미완료된 `panel-left-open` / `panel-left-inactive`의 JS와 map 4개만 보완해 각 해시를 재확인했다.
- 추가 전수 감사가 23:39 KST에 종료되면서 8개 불일치를 보고했다. 4개는 앞서 보완하기 전에 검사된 크기 불일치이고, 나머지 `panel-left-close` / `panel-left-dashed`의 JS와 map 4개는 크기는 같지만 내용이 달랐다. 지목된 8개 모두를 정상 빌드에서 재복사하고 각각 해시를 확인했다. installer·manifest·latest는 변경하지 않았다.
- **최종 전체 검증 완료: 2026-09-09 23:40:59 KST.** 보완 후 전수 검증 명령을 새로 실행해 7,333파일 / 923,262,063 bytes 전체 원격 SHA-256 불일치 0을 확인했다. 기존 여분 파일 218개는 보존했다. 최초 핵심 게시 시점과 전체 보조파일 보완·전수 완료 시점은 구분한다.
- 로컬 증거: `output/deploy-delta-pre-manifest.json`, `output/deploy-final.json` (최초 핵심 게시), `output/deploy-pre-manifest.json` (중간 감사), **`output/deploy-full-final.json` (최종 전수 결과)**, `output/recovery-archive-verification.json`, `output/recovery-archive-remote.json` (작업 폴더의 생성 보고서, Git 미포함).
- 원격 복구 TAR: `release-backups/v1.117.3-verified-payload-before-v1.117.4-20260909.tar`. 원격 SHA-256도 위 복구 검증값과 일치했다. 부분 백업과 기존 여분 파일은 삭제하지 않았다.

## 배포와 실제 PC 확인의 경계

이 변경은 적용된 앱에서 같은 유형의 로컬 정보 오판을 방지한다. 원격 PC의 실제 실행 버전과 로그가 없으므로 개별 장애 원인을 확정하거나 이미 해결됐다고 단정하지 않는다.

기존 앱도 로그인 전에 시작 업데이트를 확인하지만, X 버튼은 창 숨김이다. 트레이의 **종료** 후 다시 실행해야 시작 업데이트 적용 기회가 생긴다. 오래된 앱의 자동 업데이트가 억제된 상태라면 공식 설치 파일로 업데이트가 필요할 수 있다. 계정이나 `%APPDATA%` 데이터를 지우는 절차는 사용하지 않는다.

이번 배포는 병합 커밋 설치 빌드 → 이전 공식 payload 복구 TAR의 추출·원격 해시 검증 → 전체 목록·크기 및 모든 변경 파일 내용 대조 → manifest 마지막 게시 → 필수 배포 파일 재대조 → 추가 보조파일 보완·전체 원격 SHA-256 전수 재검증 순서로 완료했다. 오래된 여분 파일은 보존했다. 문제 PC의 실제 업데이트·로그인은 여전히 별도 미확인 항목이다.
