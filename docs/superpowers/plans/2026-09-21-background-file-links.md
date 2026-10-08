# Background work and image file links

**Goal:** 배경 상세에서 캐릭터 현황판과 같은 경로 지정/열기/해제를 제공하고 작업파일과 이미지파일을 구분한다.
**Architecture:** 기존 배경 revision/CAS/관리자 계약을 유지한다. 변형의 선택적 workFilePath와 수정본의 선택적 sourceImagePath를 추가하며, 기존 revision.filePath는 이전 작업파일 연결로 읽는다. 업로드한 imageUrl은 팀 공용 미리보기, sourceImagePath는 원본 열기와 수동 갱신용이다. 자동 감시/폴더 일괄 스캔은 범위에 포함하지 않는다.
**Tech Stack:** React/TypeScript/Electron, 기존 background RPC/preview gateway.

## Constraints

- 기존 worktree와 미커밋 구현을 유지한다. 운영 DB/PR/배포를 수행하지 않는다.
- UI의 관리 권한과 서버 session epoch 검증을 함께 유지한다. 이미지 읽기는 선택 경로의 PNG/JPG/WebP만 허용하며 20MB 원본/2MB 미리보기 제한을 적용한다.
- 원본 파일은 수정하거나 삭제하지 않는다. 연결 해제 시 기존 미리보기와 이력을 유지한다.
- 브라우저 업로드에서 실제 절대 경로를 얻을 수 없으면 임의 추정하지 않는다. 필요하면 사용자가 경로를 직접 지정한다.

## Tasks

- [x] 저장 계약: BackgroundVariant.workFilePath?, BackgroundImageRevision.sourceImagePath?; 기존 데이터 허용, 잘못된 타입/길이 거부, SQL 동일 검증. domain/PGlite/preview 저장과 실패 롤백 검증.
- [x] 파일 접근: 공용 getPathForFile(File) preload 별칭. backgroundReadImageFile(path) → 세션/admin 검증 → 제한된 이미지 읽기/디코드/축소 → data URL 반환. 파일 누락/확장자/용량/이미지 손상/세션 변경 테스트. preview는 명시된 예제 이미지 경로를 제공한다.
- [x] UI: 상세의 작업파일/이미지파일 연결 행, 경로 지정/수정/열기/해제. 이미지 선택과 드롭은 미리보기/경로를 같이 등록하고, 원본 갱신은 새 revision을 만든다. 작업파일 연결은 수정본을 바꿔도 유지하며, 변형별 비동기 결과가 다른 변형에 섞이지 않도록 한다.
- [x] 호환: 기존 revision.filePath 작업파일을 표시하고 명시 해제는 구형 경로를 되살리지 않는다. 저장 실패 시 편집 내용을 유지한다.
- [x] 검증: 관련 테스트, npm run typecheck, npm run build:vite, preview 로그인 후 경로 연결/해제/새로고침 보존과 이미지 연결/갱신 확인. 실제 OS 앱 실행과 업로드 검증 여부를 분리 기록.
