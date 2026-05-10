# 2026-05-10 — 댓글·알림 시스템 리뉴얼

> **세션 의의**: B flow의 협업 핵심 축인 *댓글*과 *알림*을 통합 정비. Slack 수준의 자연스러운 스레드 흐름과 즉시 인지 가능한 알림 신호를 갖춘다.
> **브랜치**: `claude/hardcore-bardeen-8d3837`
> **시안**: [docs/mockups/2026-05-10-comments-notifications-mockup.html](../docs/mockups/2026-05-10-comments-notifications-mockup.html)
> **스펙**: [docs/superpowers/specs/2026-05-10-comments-notifications-revamp-design.md](../docs/superpowers/specs/2026-05-10-comments-notifications-revamp-design.md)

---

## 시작 배경

v1.18.0~v1.23.x 동안 댓글·리비전·알림 기능은 한 토막씩 점진 추가되어 왔다. 그 결과 다음 통증이 한솔(PO)에게서 동시에 보고됐다.

1. **댓글이 길어지면 누가 누구에게 한 말인지 추적이 어렵다.** 1단계 대댓글이 없어 모든 토론이 선형으로 쌓임.
2. **활동 로그에 "리비전 등록"이라고만 표기**되어, 같은 씬의 여러 리비전 중 어떤 건지 알 길이 없음.
3. **댓글 스레드가 같은 사람이 연속 5번 쓴 경우에도 매번 이름·시간이 반복**되어 시각적 노이즈가 큼.
4. **"안 본 알림 X개"가 차분한 톤이라 새 알림이 와도 인지가 늦다.** 멘션과 일반 댓글 알림이 시각 차이 없음.
5. **씬에 댓글이 달려도 BG/ACT 담당자가 알 길이 없다** (현재는 `@멘션`된 사람만 알림). 협업 누락 발생.
6. **최근 활동 위젯에서 댓글을 클릭해도 아무 동작 안 함** — 모달로 점프 못 함.
7. **최근 작업 위젯에서 씬 클릭 시 부서 토글이 어디 상태든 그대로**라, BG 모드에서 ACT 활동을 클릭하면 ACT 변경이 안 보이는 사각지대.
8. **"최근 작업"이 기본 위젯 레이아웃에 없어** 신규 사용자가 매번 수동 추가해야 함. 발견 가능성 낮음.

8개의 통증이 모두 *댓글–알림–활동–위젯*이라는 동일 루프 위에 있어, 한 번에 묶어 해결하기로 함.

---

## 의도

| 의도 | 측정 가능한 결과 |
|------|-----------------|
| **추적 가능한 토론** | 모든 댓글에 1단계 대댓글이 가능 → "이건 누구의 답인가" 0초 안에 식별 |
| **즉시 인지 가능한 신호** | 멘션 알림은 헤더 벨 강한 펄스+그라데이션, 자동 알림은 차분한 글로우. 미읽음 0개 ↔ 1개 ↔ 멘션 포함 3상태 시각 분리 |
| **노이즈 감소** | 같은 사용자 연속 댓글은 Slack 식 묶음 → 평균 댓글 카드 면적 ~40% 감소 추정 |
| **사각지대 제거** | 씬 댓글이 달리면 BG·ACT 담당자 + 스레드 참여자에게 자동 알림 → 멘션 누락으로 인한 정보 사일로 차단 |
| **연결성** | 최근 활동 댓글 클릭 → 모달 + 해당 댓글 자동 스크롤 + 펄스. 최근 작업 씬 클릭 → 통합 모달 (부서 무관 일관성) |
| **발견 가능성** | "최근 작업" 위젯이 모든 신규 사용자 기본 레이아웃에 노출 |

---

## 필요한 것들

### 데이터 모델
- `SceneComment.parentCommentId?: string | null` — 1단계 대댓글 부모 참조 (Supabase 컬럼 추가)
- `NotificationType`에 `mention` 신규 추가 (기존 `comment`는 자동 알림 전용으로 의미 변경)
- `AppNotification.metadata.parentCommentId` — 점프 시 부모 컨텍스트 복원용
- `AppNotification.metadata.commentId` — 댓글로 점프 시 사용 (이미 일부 있음, 일관화)

### Supabase 마이그레이션
- `scene_comments` 테이블에 `parent_comment_id uuid null` 컬럼 추가
- 외래키는 self-reference (`scene_comments.id`), `on delete cascade`는 안 걸음 — 부모 삭제 시 답글 고아화 허용 (Slack과 동일)

### UI 컴포넌트
- `CommentPanel.tsx`: 대댓글 인라인 렌더, 접기/펼치기 토글, 댓글 묶음 로직, 대댓글 입력 모드
- `NotificationPanel.tsx`: 멘션 vs 자동 시각 분리, 헤더 벨 글로우/펄스
- `Header.tsx`: NotificationBell 펄스 상태 분기 (0/N/멘션)
- `RecentActivityWidget.tsx` + `ActivityFeed`: 댓글 활동 클릭 시 모달 + 스크롤 + 펄스
- `Dashboard.tsx`: ALL/DEPT/EP 3개 기본 레이아웃에 `recent-activity` 추가

### 비즈니스 로직
- 댓글 작성 후 알림 생성 헬퍼 (`createSceneCommentNotifications`):
  - 멘션된 사용자에게 `mention` 알림
  - BG 담당자 + ACT 담당자 + 스레드 참여자에게 `comment` 알림 (멘션 받은 사람·작성자 본인은 제외해 중복 차단)
  - 답글이면 원댓글 작성자에게 `mention` 알림 추가 (자기 댓글에 답글)
- 활동 로그 `describeActivity` 갱신: 리비전 액션은 `re#N · <메모 30자>` 포맷
- 씬 점프 헬퍼: `dashboardDeptFilter='all'` 강제 + `setPendingSceneModalRequest`

### 시각/모션
- `bellGlow` (2.0s ease-out infinite): 자동 알림 N개일 때
- `mentionPing` (1.6s ease-out infinite): 멘션 포함 시
- `targetPulse` (1.6s ease-out 1회): 점프 도착 댓글 강조
- `prefers-reduced-motion: reduce` 시 모든 무한 애니메이션 OFF

---

## 영향 범위

### 변경 파일 (예상)
- `src/services/commentService.ts` — 대댓글 저장/로드, 알림 발송 헬퍼
- `src/components/scenes/CommentPanel.tsx` — 대댓글 UI/입력, 묶음 그룹핑
- `src/components/scenes/UnifiedSceneDetailModal.tsx` — `focusCommentId` prop 추가
- `src/stores/useNotificationStore.ts` — `mention` 타입, metadata 확장
- `src/components/NotificationPanel.tsx` — 시각 차별화, 점프 시 commentId 사용
- `src/components/layout/Header.tsx` — 벨 글로우/펄스 분기
- `src/components/widgets/activity/ActivityFeed.tsx` — 댓글 항목 클릭 핸들러
- `src/components/widgets/RecentActivityWidget.tsx` — 씬 점프 시 통합 모드 강제
- `src/views/Dashboard.tsx` — ALL/DEPT/EP 기본 레이아웃에 `recent-activity` 추가
- `src/utils/sceneActivityDescribe.ts` — 리비전 차수+메모 표기

### 마이그레이션
- `DEVLOG/migrations/2026-05-10-add-parent-comment-id.sql` — 컬럼 추가

### 회귀 위험 영역
- 기존 댓글 (parentCommentId=null) 로딩 정상 작동
- 기존 알림 metadata (commentId 없는 알림) — fallback navigate 유지
- 기존 사용자 widgetLayout — 자동 마이그레이션 없이 보존

---

## 작업 순서 (자율 진행)

1. spec 문서 commit
2. Supabase 마이그레이션 SQL 작성
3. 데이터 모델 확장 (commentService, useNotificationStore)
4. 알림 발송 헬퍼 구현
5. CommentPanel 대댓글 UI/입력/묶음
6. NotificationPanel 시각 차별화
7. 헤더 벨 강조
8. 활동 피드 댓글 클릭 핸들러
9. 최근 작업 씬 점프 통합 모드 강제
10. Dashboard 기본 레이아웃 갱신
11. 활동 로그 리비전 표기
12. typecheck + build:vite 검증
13. PR 작성 (`v1.24.0` 후보)
14. 코드 리뷰 루프

---

## 비-목표 (이 세션에서 다루지 않음)

- 대댓글 2단계 이상 (1단계로 충분, 향후 필요 시 별도 spec)
- 댓글 검색·필터 고급 기능 (현재 "re만"·"활동 감추기" 토글 유지만)
- 슬랙 webhook 연동 (별도 트랙)
- 활동 로그 "묶음 그룹핑" 커스텀 규칙 (현재 시간순만)

---

*작성: Claude × 한솔 (Studio JBBJ) · 2026-05-10*
