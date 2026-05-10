# 2026-05-10 — 댓글·알림 리뉴얼 spec

세션 배경/의도는 [DEVLOG/2026-05-10-comments-notifications-revamp.md](../../../DEVLOG/2026-05-10-comments-notifications-revamp.md) 참조.
인터랙티브 시안은 [docs/mockups/2026-05-10-comments-notifications-mockup.html](../../mockups/2026-05-10-comments-notifications-mockup.html).

---

## 결정사항 (확정)

| 항목 | 결정 |
|---|---|
| 대댓글 깊이 | 1단계만 (slack-식) |
| 대댓글 시각 표현 | **A안 — 인라인 들여쓰기 + 좌측 라인** + 접기/펼치기 토글 (기본 펼침) |
| 대댓글 알림 대상 | 원댓글 작성자 + @멘션된 사람만 |
| 리비전 댓글 대댓글 | 적용 (일반 댓글과 동일) |
| 씬 댓글 자동 알림 대상 | BG 담당자 + ACT 담당자 + 스레드 참여자 (작성자·이미 멘션된 사람 제외) |
| 멘션 vs 자동 시각차 | 멘션: 액센트 좌측 바 + `@` 배지 / 자동: 회색 좌측 바 + 텍스트만 |
| 댓글 묶음 | 같은 사용자 연속이면 무제한 묶음. 다른 사용자/시스템 활동 끼어들면 끊김 |
| 안 본 알림 강조 | 헤더 벨 글로우(자동) + 멘션 시 강한 펄스. 미읽 카운트 배지: 그라데이션, 멘션 포함 시 빨강→보라 |
| 리비전 표기 | `re#N` 차수 배지 + 메모 앞 30자 (모든 위치 동일 패턴) |
| 활동 피드 댓글 클릭 | 모달 열기 + 해당 댓글 자동 스크롤 + `targetPulse` 1.6s 강조 |
| 최근 작업 → 씬 이동 | `dashboardDeptFilter='all'` 강제 후 통합 모달 진입 |
| 최근 작업 위젯 기본 추가 | ALL/DEPT/EP 모두, 하단 12 col × h=20. 신규 사용자만 자동 적용 |

---

## 데이터 모델

### `SceneComment` (TypeScript)
```ts
export interface SceneComment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  mentions: string[];
  images?: string[];
  createdAt: string;
  editedAt?: string;
  revisionId?: string | null;
  /** v1.24.0 신규 — 1단계 대댓글이면 부모 댓글 id, 없으면 null */
  parentCommentId?: string | null;
}
```

### `AppNotification.NotificationType`
```ts
// 기존: 'scene_change' | 'comment' | 'milestone' | 'system' | 'revision'
// 변경 후: 위 + 'mention' 신규 추가
// 'comment' 는 자동 알림(씬 작업자), 'mention' 은 명시적 멘션 (대댓글 자동 멘션 포함)
```

### `AppNotification.metadata`
```ts
metadata?: {
  // 기존 필드 유지...
  commentId?: string;          // 점프 대상 댓글
  parentCommentId?: string;    // 신규 — 답글 알림이면 부모 댓글 id
  mentionedBy?: string;        // 신규 — 멘션 발신자 이름 (자동 멘션 식별용)
};
```

### Supabase `scene_comments` 컬럼 추가
```sql
ALTER TABLE scene_comments
ADD COLUMN IF NOT EXISTS parent_comment_id uuid NULL
REFERENCES scene_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scene_comments_parent ON scene_comments(parent_comment_id);
```

---

## UX 플로우

### 대댓글 작성
1. 댓글 호버 시 우측에 `답글` 버튼 노출
2. 클릭 → 입력 카드 상단에 답글 컨텍스트 헤더 표시 (원댓글 작성자 + 텍스트 truncate + X 취소)
3. 입력창에 `@<원댓글 작성자> ` 자동 프리셋 (커서는 그 뒤)
4. 전송 시 `parentCommentId` 채워서 저장
5. 알림 생성:
   - 원댓글 작성자에게 `mention` (자동 멘션)
   - 텍스트 내 `@멘션`된 사람들에게 `mention`
   - 씬의 BG/ACT 담당자에게 `comment` (위 멘션 받은 사람·작성자 본인 제외)

### 대댓글 표시
- 원댓글 아래 `ml-3.5 pl-3.5 border-l-2` 들여쓰기
- 답글 1개 이상이면 토글 버튼 `▼ 답글 N개 접기 / ▶ 답글 N개 펼치기`
- 기본은 펼친 상태. 토글 상태는 메모리만 (재오픈하면 펼침으로 복원)

### 알림 점프
- `metadata.commentId` 있으면 해당 댓글로 자동 스크롤 + `targetPulse` 1.6s
- 답글 알림이면 부모 댓글이 접혀 있어도 자동 펼친 후 스크롤

### 댓글 묶음
- 정렬된 표시 entries(댓글+inlineEvents)에서, **연속된 같은 userId 댓글**을 하나의 group으로 묶음
- 첫 댓글: 아바타 + 이름 + 시간 + 본문
- 이후 묶인 댓글: 아바타·이름 생략, 좌측 들여쓰기, 시간은 호버 시만 좌측 노출
- 끊김 조건: (a) 다른 userId, (b) 시스템 inlineEvent, (c) 다른 댓글의 답글이 사이에 끼어듦

### 헤더 벨
- `unreadCount === 0` → 일반 (애니메이션 없음)
- `unreadCount >= 1 && hasUnreadMention === false` → `bellGlow` 2.0s ease-out infinite
- `hasUnreadMention === true` → `mentionPing` 1.6s + 그라데이션 빨강→보라 배지

### 활동 피드 댓글 클릭
- ActivityFeed의 `actionType === 'comment_add'` 항목 클릭
- 이벤트: `setPendingSceneModalRequest({ sceneId, sheetName, dept: 'all', focusCommentId })`
- ScenesView가 모달 열고 CommentPanel에 `focusCommentId` prop 전달

### 최근 작업 → 씬 이동
- 클릭 시 `setDashboardDeptFilter('all')` 호출 → 통합 모달

---

## 컴포넌트 변경 요약

| 파일 | 변경 |
|---|---|
| `src/services/commentService.ts` | `parentCommentId` 필드 + `addComment` 시그니처 / `notifySceneCommentRecipients` 헬퍼 |
| `src/services/notificationService.ts` (신규) | 자동 알림 생성/발송 통합 헬퍼 |
| `src/components/scenes/CommentPanel.tsx` | 묶음 그룹핑, 대댓글 인라인 + 토글, 답글 입력 모드, focusCommentId 스크롤 |
| `src/components/scenes/UnifiedSceneDetailModal.tsx` | `focusCommentId` prop 추가 |
| `src/stores/useNotificationStore.ts` | `mention` 타입 추가, metadata 확장 |
| `src/components/NotificationPanel.tsx` | 멘션/자동 시각 분리, commentId 점프 |
| `src/components/layout/Header.tsx` | 벨 글로우/펄스 (`unreadCount`·`unreadMentionCount` 분기) |
| `src/components/widgets/activity/ActivityFeed.tsx` | 항목 클릭 → 모달 점프 (sceneId·dept='all'·focusCommentId) |
| `src/components/widgets/RecentActivityWidget.tsx` | 씬 점프 시 dashboardDeptFilter='all' |
| `src/views/Dashboard.tsx` | ALL/DEPT/EP 레이아웃에 `recent-activity` 추가 |
| `src/utils/sceneActivityDescribe.ts` (또는 inline) | 리비전 액션 → `re#N · <메모 30자>` |
| `electron/main/supabaseService.ts` + preload | `addComment` IPC `parentCommentId` 전달 |
| `DEVLOG/migrations/2026-05-10-add-parent-comment-id.sql` | 컬럼 + 인덱스 추가 |

---

## 회귀/엣지 케이스

- **기존 댓글** (`parent_comment_id IS NULL`) → 일반 댓글로 그대로 렌더
- **부모 댓글 삭제 시** → `ON DELETE SET NULL` → 답글은 일반 댓글이 되어 메인 흐름에 표시
- **Sheets fallback** → `parentCommentId` 미지원 (모두 일반 댓글로 처리)
- **기존 widgetLayout 저장된 사용자** → 자동 마이그레이션 안 함 (위젯 추가 메뉴에서 수동 추가 가능)
- **`prefers-reduced-motion`** → 모든 무한 애니메이션 OFF, `targetPulse`는 1회만 유지

---

## 버전

`v1.24.0` — minor (기능 추가)

*작성: Claude × 한솔 · 2026-05-10*
