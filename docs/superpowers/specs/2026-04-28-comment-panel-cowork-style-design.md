# 댓글 패널 cowork 스타일 + 이미지 첨부 — 디자인 문서

**작성일**: 2026-04-28
**대상 브랜치**: `claude/naughty-antonelli-ff9d16`
**대상 버전**: v1.15.12 (예정)
**작성자**: 한솔 × Claude

---

## 배경

씬 디테일 모달의 댓글 입력창이 작고 단순해서 긴 피드백 작성/이미지 첨부가 불편했다. 클로드 데스크탑 cowork 입력창처럼 **카드로 떠있는 입력창** + **부드러운 자라기** + **이미지 첨부 (클립보드/드래그/버튼)** 를 한 묶음으로 도입한다. 같은 `CommentPanel.tsx` 가 [SceneDetailModal](../../../src/components/scenes/SceneDetailModal.tsx) 과 [UnifiedSceneDetailModal](../../../src/components/scenes/UnifiedSceneDetailModal.tsx) 두 곳에서 쓰이므로 **컴포넌트 한 곳만 고치면 양쪽 다 자동 적용**.

---

## 결정사항 요약 (브레인스토밍 결과)

| # | 항목 | 한솔 결정 |
|---|---|---|
| 🅐 | 입력창 자라는 동작 | **A** — 패널 전체 높이는 고정, 입력창이 자라면 위 댓글 목록만 줄어듦 |
| 🅑 | 시각적 분리 스타일 | **떠있는 카드** (cowork 스타일) — 입력창에 그림자 + 미세 보더로 떠있는 느낌, 위 목록과 12~16px 간격 |
| 🅒 | 이미지 체판 동작 | **표준 채팅앱 스타일** — Ctrl+V / 드래그 / 📎 버튼 모두 지원, 한 댓글에 텍스트+이미지 여러 장 |
| 🅓 | 입력 카드 최대 높이 | **35% 고정** (예: 패널 620px → 217px). 그 이상 텍스트는 입력창 안에서 스크롤 |
| 🅔 | Focus 시 시각 신호 | **펄스 빛** — 액센트 보라 ring, 1px ↔ 6px, 2.4초 주기, 강도 0.16~0.28 |
| 🅕 | 자라는 애니메이션 | **부드러운 transition** — `height 220ms cubic-bezier(0.16, 1, 0.3, 1)` (앱 표준 이징) |
| 🅖 | 드래그 인식 영역 | **댓글 패널 전체** (입력 카드만 X) — 사용자가 어디로 떨어뜨려도 OK |
| 🅗 | 드래그 오버레이 | 패널 전체에 보라 16% 반투명 + 2px 점선 + 🖼️ 큰 아이콘(통통 애니메이션) + "이미지를 여기에 놓으세요" 안내 |

---

## 시각적 변화 (요약)

```
┌─ 변경 전 ────────────────┐    ┌─ 변경 후 ────────────────┐
│ 댓글 및 활동              │    │ 댓글 및 활동              │
│                          │    │                          │
│ 한솔  안녕하세요           │    │ 한솔  안녕하세요           │
│ 민지  네 안녕하세요         │    │ 민지  네 안녕하세요         │
│ 동수  회의 언제죠?         │    │ 동수  회의 언제죠?         │
│ ...                      │    │ ...                      │
│                          │    │                          │
│ ─────────── 분리선 ──     │    │ ┌─ 떠있는 카드 ────┐     │
│ [한 줄 입력...]   [전송]  │    │ │ [🖼️][🖼️] (썸네일) │     │
└──────────────────────────┘    │ │ 입력...    📎 ↑  │     │
                                │ └──────────────────┘     │
                                └──────────────────────────┘
```

- 입력 카드: 약간 진한 배경(`--bg-card-elev`) + 그림자 + 보더, focus 시 보라 펄스 ring
- 이미지 썸네일: 64x64, 가로 스크롤 줄, 호버 시 빨간 X 제거 버튼
- 드래그 시: 패널 전체에 보라 반투명 오버레이, 큰 🖼️ 아이콘 통통 애니메이션
- 좌측 변경 전: 단순 분리선 + textarea + 초록 전송 버튼
- 우측 변경 후: 떠있는 카드 + 보라 ↑ 화살표 전송 버튼 + 📎 첨부 버튼

---

## 데이터 모델 변경

### comments 테이블 — `images JSONB` 컬럼 추가

**현재 스키마** ([DEVLOG/supabase-init.sql:62-73](../../../DEVLOG/supabase-init.sql)):
```sql
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  part_id UUID NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  scene_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  text TEXT NOT NULL,
  mentions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  edited_at TIMESTAMPTZ
);
```

**변경**: `mentions` 패턴과 동일한 `JSONB` 컬럼 추가
```sql
ALTER TABLE comments ADD COLUMN images JSONB DEFAULT '[]'::jsonb;
```

**저장 형식**: 이미지 URL 배열 (Supabase Storage 의 CDN URL)
```jsonb
["https://...storage.../scene-images/EP01_A_BG/3/comment-abc.jpg", "..."]
```

**호환성**: default `'[]'::jsonb` 라 기존 댓글에 영향 없음. 신규 버전 클라이언트만 images 필드 사용.

### TypeScript 타입 변경

`SceneComment` 인터페이스 ([commentService.ts:16](../../../src/services/commentService.ts)):
```ts
export interface SceneComment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  images?: string[];        // ← 추가 (선택, 기본 빈 배열)
  mentions: string[];
  createdAt: string;
  editedAt?: string;
}
```

`text` 는 빈 문자열 허용 (이미지만 보내는 댓글 가능). UI 검증: `text.trim() === '' && images.length === 0` 일 때만 전송 버튼 disabled.

---

## 영향 범위 (구현 위치)

| Layer | 파일 | 변경 |
|---|---|---|
| DB | Supabase `comments` 테이블 | `images JSONB` 컬럼 추가 (마이그레이션) |
| Electron preload | [electron/preload.ts:110-113](../../../electron/preload.ts) | `supabaseAddComment`, `supabaseEditComment` 시그니처에 `images: string[]` 파라미터 추가 |
| Electron main | [electron/main.ts](../../../electron/main.ts) (해당 IPC 핸들러) | images 파라미터 받아 supabase insert/update |
| Service | [src/services/supabaseService.ts:137,141](../../../src/services/supabaseService.ts) | wrapper 시그니처 업데이트 |
| Service | [src/services/commentService.ts](../../../src/services/commentService.ts) | `addComment`/`updateComment` 시그니처에 images 추가, SceneComment 인터페이스 갱신 |
| Types | [src/types/index.ts:499-500](../../../src/types/index.ts) | electronAPI 타입 시그니처 업데이트 |
| Mock | [src/mocks/devElectronAPI.ts:118-119](../../../src/mocks/devElectronAPI.ts) | dev mock 시그니처 맞춤 |
| Component | [src/components/scenes/CommentPanel.tsx](../../../src/components/scenes/CommentPanel.tsx) | **메인 작업** — 입력 카드 분리, 부드러운 자라기, 펄스, 드래그 오버레이, 이미지 업로드 |
| 이미지 업로드 | [src/services/storageService.ts](../../../src/services/storageService.ts) | **재사용** — 기존 `uploadImage()` 그대로. 이미지 ID/scene/comment 포맷만 추가 정의 |

---

## 애니메이션/디자인 토큰 디테일

### CSS 토큰
```css
--shadow-base: 0 4px 16px rgba(0,0,0,0.25);  /* light 모드 별도 */
--pulse-rgb: 108, 92, 231;                    /* 액센트 보라 RGB */
```

### 핵심 클래스
```css
/* 부드러운 자라기 */
.comment-input-textarea {
  transition: height 220ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* 떠있는 입력 카드 */
.comment-input-card {
  background: var(--bg-card-elev);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-card);
  transition: border-color 200ms ease, box-shadow 250ms cubic-bezier(0.16, 1, 0.3, 1);
}
.comment-input-card.focused {
  animation: comment-input-pulse 2.4s ease-in-out infinite;
  border-color: var(--accent-light);
}
@keyframes comment-input-pulse {
  0%, 100% { box-shadow: var(--shadow-base), 0 0 0 1px rgba(var(--pulse-rgb), 0.28); }
  50%      { box-shadow: var(--shadow-base), 0 0 0 6px rgba(var(--pulse-rgb), 0.16); }
}
.comment-input-card.dragover {
  animation: none !important;
  box-shadow: var(--shadow-base), 0 0 0 2px rgba(var(--pulse-rgb), 0.55) !important;
}

/* 드래그 오버레이 (패널 전체) */
.comment-drop-overlay {
  position: absolute; inset: 0; border-radius: inherit;
  background: rgba(var(--pulse-rgb), 0.16);
  backdrop-filter: blur(2px);
  border: 2px dashed rgba(var(--pulse-rgb), 0.7);
  z-index: 20; pointer-events: none;
  animation: drop-overlay-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.comment-drop-icon {
  animation: drop-icon-bounce 1.2s ease-in-out infinite;
}
```

### 자라는 동작 구현 패턴
```ts
// useLayoutEffect — paint 전 동기 측정/복원으로 시각적 점프 방지
useLayoutEffect(() => {
  const ta = taRef.current;
  if (!ta) return;
  const prev = ta.style.height;
  ta.style.height = 'auto';        // 측정만 잠깐
  const sh = ta.scrollHeight;
  ta.style.height = prev;          // 즉시 복원 → React가 다음 렌더에서 px → px transition
  setTaHeight(Math.min(sh, taMaxPx));
}, [text, taMaxPx]);
```
**원리**: `auto → px` 사이는 transition 안 됨, `px → px` 사이는 부드러움. 측정 시 잠깐 'auto' 갔다가 곧바로 이전 px 복원해서 시각 점프 방지.

### 드래그 카운터 패턴
```ts
const dragCounter = useRef(0);
// dragenter: counter++, counter===1 일 때만 setDraggingOver(true)
// dragleave: counter--, counter===0 일 때만 setDraggingOver(false)
// drop: counter=0, setDraggingOver(false)
```
자식 요소 위로 드래그가 옮겨갈 때 발생하는 깜빡임 방지.

---

## 이미지 업로드 흐름

1. **사용자 트리거**: Ctrl+V (paste) / 드래그 드롭 / 📎 버튼 (file picker)
2. **즉시 미리보기**: `URL.createObjectURL(file)` 로 로컬 blob URL → 썸네일 줄에 즉시 표시 (낙관적)
3. **백그라운드 업로드**: `imageUtils.resizeBlob(file, 800, 0.8)` → `storageService.uploadImage(sheetName, sceneId, 'comment', base64)` → CDN URL 반환
4. **업로드 상태 표시**: 썸네일에 회색 오버레이 + 진행 스피너 (업로드 중) → 완료 시 사라짐
5. **댓글 전송**: 모든 이미지 업로드 완료 후 `addComment(sceneKey, { text, images: [url1, url2, ...] })` 호출. 업로드 중이면 전송 버튼 비활성.
6. **렌더링**: 댓글 말풍선 안에 텍스트 위/아래로 이미지 그리드(1장=full width / 2~4장=2x2 / 5장+=가로 스크롤). 클릭 시 라이트박스 (다음 단계)

이미지 사이즈/포맷:
- 업로드 직전 800px 최장변, JPEG 80% 품질로 리사이즈 (`imageUtils.resizeBlob` 기존 패턴)
- Storage 경로: `scene-images/{sheetName}/{sceneId}/comment-{commentId}-{idx}.jpg`

엣지 케이스:
- 업로드 실패 → 썸네일에 빨간 X 아이콘 + 재시도 버튼
- 빈 텍스트 + 빈 이미지 → 전송 비활성
- 업로드 중인 이미지가 있으면 → 전송 버튼 회색 ("업로드 중..." 툴팁)

---

## 라이트박스 (이미지 클릭 확대) — 후속 검토

이번 PR 스코프엔 **포함**. 표준 패턴:
- 댓글 이미지 클릭 → 화면 전체 어두운 배경 + 이미지 원본 크기로 표시
- ESC / 배경 클릭 / 우상단 X / 좌우 화살표 키 (여러 장 시) 로 닫기/이동
- framer-motion 모달 진입 애니메이션 (앱 표준 0.2s easeOut)

기존 앱에 이미 이미지 표시 컴포넌트가 있으면 (예: `SceneImageBox`) 라이트박스 패턴 재사용 — 구현 단계에서 확인.

---

## 구현 단계 (체크리스트)

### Phase 1: DB & 백엔드
- [ ] Supabase `comments` 테이블에 `images JSONB DEFAULT '[]'::jsonb` 컬럼 추가 (마이그레이션)
- [ ] `electron/preload.ts` `supabaseAddComment` / `supabaseEditComment` 시그니처에 `images: string[]` 추가
- [ ] `electron/main.ts` IPC 핸들러에서 images 파라미터를 supabase insert/update 에 전달
- [ ] `src/types/index.ts` electronAPI 타입 업데이트
- [ ] `src/mocks/devElectronAPI.ts` mock 시그니처 맞춤

### Phase 2: Service Layer
- [ ] `SceneComment` 인터페이스에 `images?: string[]` 추가
- [ ] `commentService.addComment` / `updateComment` 에 images 파라미터 (default `[]`)
- [ ] `commentService.loadPartComments` 의 raw → SceneComment 매핑에서 images 포함

### Phase 3: CommentPanel 메인 구현
- [ ] 입력 카드 분리 (떠있는 박스, CSS 클래스 `comment-input-card`)
- [ ] textarea 부드러운 자라기 (useLayoutEffect + state + transition 220ms)
- [ ] focus 펄스 애니메이션 (CSS `comment-input-pulse` 2.4s)
- [ ] 입력 카드 최대 높이 35% 고정
- [ ] 댓글 패널 전체에 onDragEnter/Over/Leave/Drop (드래그 카운터 패턴)
- [ ] 드래그 오버레이 (보라 반투명 + 🖼️ 아이콘 + 안내문구, `comment-drop-overlay`)
- [ ] 이미지 썸네일 줄 (가로 스크롤, 호버 X 버튼)
- [ ] 📎 버튼 + 파일 picker
- [ ] Ctrl+V paste 핸들러 (textarea 또는 카드 영역)
- [ ] 이미지 업로드 (storageService 재사용) + 진행 상태 표시
- [ ] 빈 텍스트 + 빈 이미지면 전송 비활성
- [ ] 보낸 후 댓글 말풍선 안에 이미지 그리드 표시
- [ ] 라이트박스 (클릭 시 확대 보기) — 가능하면 기존 패턴 재사용

### Phase 4: 검증
- [ ] `tsc --noEmit` 통과
- [ ] `vite build` 통과
- [ ] dev 서버에서 시각 확인 (preview 모드 mock 로그인 — `?preview=1`)
- [ ] 시나리오: 짧은 댓글 / 긴 댓글 (스크롤) / 이미지만 / 텍스트+이미지 여러장 / 드래그 / 클립보드 / 업로드 실패

---

## 위험/엣지 케이스

1. **DB 마이그레이션 후 구버전 클라이언트** — 구버전은 images 컬럼 모름 → 무시해도 OK (`text` 만 표시). 새 기능이라 신규 사용자만 영향. 한솔이 v1.15.12 빌드 배포하면 자동 동기화.

2. **이미지 업로드 실패 시 댓글 처리** — 업로드 실패한 이미지는 댓글에 포함 안 함. 사용자가 재시도 또는 이미지 제거 후 전송.

3. **clipboard.items 다중 이미지 동시 paste** — 한 번에 여러 이미지 paste 가능. 모두 썸네일 줄에 추가.

4. **모바일/터치** — 현재 앱은 데스크탑 전용 (Electron). 모바일 터치 첨부는 스코프 외.

5. **이미지 사이즈 한계** — Supabase Storage 무료 플랜은 50MB/파일. 800px 리사이즈 후 1MB 이하 보장. 한솔의 워크플로우에서 사실상 무관.

6. **이미지 삭제** — 댓글 삭제 시 storage 이미지도 같이 정리할지? 이번 PR 스코프엔 **미포함** (cleanup 작업은 별도). 데이터는 남지만 새 댓글 전송에는 영향 없음.

---

## 참고 자료

- 디자인 목업: `demo/comment-mockup.html` (이번 작업 중 띄움, 한솔 시각 확인 완료)
- 디자인 토큰 출처: 앱 글로벌 CSS — 보라 액센트 `#6C5CE7`, sharp easing `cubic-bezier(0.16, 1, 0.3, 1)` 250ms 표준
- 이미지 업로드 인프라: `storageService.uploadImage` (Supabase Storage `scene-images` 버킷)
- 동기 패턴 참고: 기존 `SceneDetailModal` 의 이미지 업로드 (`UnifiedSceneDetailModal.tsx:158-205`) — 같은 흐름 재사용

---

*문서 버전: 2026-04-28 작성*
