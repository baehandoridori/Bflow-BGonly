# 리테이크 허브 4단계(4b) — 메모 엔티티 입력/표시 확장 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4a에서 만든 공통 부품(`EntityAwareInput`/`EntityText`/`EntityHighlightOverlay`)을 씬·일정·작업 **메모**에 적용한다 — 댓글·리테이크와 동일하게 @멘션 자동완성 + 인-인풋 파란 강조 + 경로/컷 칩. 씬 메모는 컷 클릭 점프 ON(씬 컨텍스트 보유), 일정·작업 메모는 색 표시만(방안 A).

**Architecture:** 신규 순수 로직은 사실상 없음 — 이미 `node:test`로 검증된 `entityTokens`/`cutScene`/`navigateToCutNumber`/`parseCommentSceneContext`를 재사용한다. 두 부품만 소폭 확장한다: (1) `EntityText`에 `renderTextSegment?` 콜백 추가(보드 카드·시트뷰 메모의 검색어 하이라이트 보존 — 핵심 회귀 방지), (2) `EntityAwareInput`에 `onBlur?` 추가(인라인 메모칸의 blur 저장 패턴 지원). 나머지는 입력 textarea/input → `EntityAwareInput`, 표시 `PathLinkifiedText`/평문 → `EntityText` 배선이다.

**Tech Stack:** React 18 + TS, Zustand, lucide-react, node:test, Tailwind 토큰. 부품 재사용(4a).

---

## 설계 결정 (매핑 스웜 + 부품 직독 + 한솔 확정 2026-06-20)

| 결정 | 내용 | 근거 |
|------|------|------|
| 범위(4b) | 씬·일정·작업 메모의 입력(5곳) + 표시. `#`씬·파트·화 태그/참조패널은 4c | 한솔: 메모 토대 먼저 → 4c |
| 씬 메모 컷 점프 | **ON** — 상세창·카드·시트뷰 씬 메모. `parseCommentSceneContext(sheetName)`로 EP·partId·dept 추출 → `navigateToCutNumber` | 한솔 확정. 씬 메모는 컨텍스트 보유 |
| 일정·작업 메모 컷 | **색 표시만**(onCutClick 생략) | 한솔 확정(방안 A). 컨텍스트 없음 |
| 표시 범위 | 상세창 + 보드 카드 + 시트뷰 전부 | 한솔 확정. 일관성 |
| 검색 하이라이트 | `EntityText`에 `renderTextSegment` 추가로 카드/시트뷰 검색강조 보존 | 회귀 방지(현재 `PathLinkifiedText.renderTextSegment` 사용) |
| 입력 대상 | 메모/내용 자유텍스트 필드만 — 제목·날짜·담당 등 제외 | 멘션은 메모 본문에만 의미 |
| extractMentions 단일화 | **보류**(주석 동기화만) | 직교 계약(알림추출 vs 표시토큰). 동작 변화 리스크 |
| onBlur 저장 충돌 | 없음 — `MentionDropdown`이 `onMouseDown`+`preventDefault`라 멘션 선택 시 입력칸 blur 안 됨 | 직독 확인(MentionDropdown.tsx:37) |

---

## 부품 API (직독 — 변경 없이 사용, Chunk 1만 확장)

- `EntityAwareInput`(src/components/common/EntityAwareInput.tsx): `value/onChange/users:readonly{id,name}[]/multiline/placeholder/className/rows/autoFocus/dropdownPositionClassName/submitOn:'enter'|'ctrl-enter'|'none'/onSubmit/onCancel/onPaste/'aria-label'`. **EntityHighlightOverlay+MentionDropdown 내장.** className은 overlay와 공유(bg는 내부서 transparent 강제). → **Chunk 1에서 `onBlur` 추가.**
- `EntityText`(src/components/common/EntityText.tsx): `text/userNames:string[]/onMentionClick/onCutClick`. → **Chunk 1에서 `renderTextSegment` 추가.**
- `useAuthStore().users` = `{id,name}[]`. 모범 적용례 = `src/components/scenes/revision/CompletionNoteInput.tsx`.
- 재사용 유틸: `tokenizeEntities`(entityTokens.ts), `navigateToCutNumber`(cutNumberNavigation.ts), `parseCommentSceneContext`(revisionSceneContext.ts — sheetName만 넘겨도 동작).

> **구현 전 필수:** 큰 파일 라인 번호는 작성 시점 기준이다. 각 Task 시작 전 `Grep`으로 대상 심볼 위치를 재확인하라. 입력 교체 시 기존 `className`/저장 트리거/`autoFocus`/이미지 paste 동작을 보존하라.

---

## File Structure

**수정 (부품 — Chunk 1):**
- `src/components/common/EntityText.tsx` — `renderTextSegment?: (segment: string, idx: number) => ReactNode` 추가, text 토큰에만 적용.
- `src/components/common/EntityAwareInput.tsx` — `onBlur?: (e: FocusEvent<...>) => void` 추가, shared에 배선.

**수정 (씬 메모 — Chunk 2·3):**
- `src/components/scenes/UnifiedSceneDetailModal.tsx` — `InlineTextareaRow`(입력+표시), 씬 컨텍스트 prop.
- `src/components/scenes/SceneDetailModal.tsx` — `PropertyRow`(메모 행만 entityAware), 표시.
- `src/components/scenes/UnifiedSceneCard.tsx` — bg/act 메모 표시(검색강조+컷점프).
- `src/components/scenes/UnifiedSceneSheetView.tsx` — 메모 셀 표시(검색강조+컷점프).

**수정 (일정 메모 — Chunk 4):**
- `src/components/calendar/EventQuickEdit.tsx`, `src/components/calendar/EventSidePanel.tsx`.

**수정 (작업 메모 — Chunk 5):**
- `src/components/widgets/MyTasksWidget.tsx`.

**수정 (테스트/빌드 — Chunk 1·6):**
- `tests/revisionSceneContext.test.ts` — sheetName-only 입력 계약 테스트 추가.

---

## Chunk 1: 부품 확장 (EntityText.renderTextSegment + EntityAwareInput.onBlur)

### Task 1: `parseCommentSceneContext` sheetName-only 계약 못박기 (TDD)

씬 메모는 `sheetName`(예 `EP01_A_BG`)만 있고 `:sceneNo`가 없다. 현재 구현은 `split(':')[0]`이라 동작하지만, 4b가 이 동작에 의존하므로 테스트로 계약을 고정한다.

**Files:** Modify `tests/revisionSceneContext.test.ts`

- [ ] **Step 1: 실패 가능 테스트 추가** — 파일 끝에

```ts
test('parseCommentSceneContext: sheetName 만(:sceneNo 없음)도 컨텍스트 추출 — 4b 씬 메모', () => {
  assert.deepEqual(parseCommentSceneContext('EP01_A_BG'), { episodeNumber: 1, partId: 'A', department: 'bg' });
  assert.deepEqual(parseCommentSceneContext('EP12_C_ACT'), { episodeNumber: 12, partId: 'C', department: 'acting' });
  assert.deepEqual(parseCommentSceneContext('EP02_A'), { episodeNumber: 2, partId: 'A', department: 'bg' });
});
```

- [ ] **Step 2: 실행** — `node --test ./tests/revisionSceneContext.test.ts` → 현재 구현으로 PASS 예상(계약 고정). FAIL이면 `parseCommentSceneContext`가 sheetName-only를 거부하는 것이므로 STOP·보고(설계 전제 붕괴).

- [ ] **Step 3: 커밋** — `git add tests/revisionSceneContext.test.ts && git commit -m "리테이크 4b Chunk1: 씬 메모 sheetName 컨텍스트 계약 테스트"`

### Task 2: `EntityText`에 `renderTextSegment` 추가

**Files:** Modify `src/components/common/EntityText.tsx`

- [ ] **Step 1: Props + text 토큰 분기 수정**

```tsx
import { Fragment, type ReactNode } from 'react';
// Props 에 추가:
//   /** path/멘션/컷 외 평문 세그먼트 추가 변환(예: 검색어 하이라이트). 미지정 시 그대로. */
//   renderTextSegment?: (segment: string, idx: number) => ReactNode;
```

`EntityText` 시그니처에 `renderTextSegment` 추가하고, 마지막 text 분기를 교체:

```tsx
return <Fragment key={`t${i}`}>{renderTextSegment ? renderTextSegment(tok.content, i) : tok.content}</Fragment>;
```

> `PathLinkifiedText`와 동일 계약(평문 토큰에만 적용). path/멘션/컷 토큰은 칩 그대로 — 검색강조는 평문 위에만 얹힌다.

- [ ] **Step 2: 타입체크** — `npm run typecheck` → PASS

- [ ] **Step 3: 커밋** — `git add src/components/common/EntityText.tsx && git commit -m "리테이크 4b Chunk1: EntityText renderTextSegment(검색강조 보존)"`

### Task 3: `EntityAwareInput`에 `onBlur` 추가

**Files:** Modify `src/components/common/EntityAwareInput.tsx`

- [ ] **Step 1: Props + shared 배선**

```tsx
import type { ChangeEvent, ClipboardEvent, FocusEvent, KeyboardEvent, RefObject, UIEvent } from 'react';
// Props 에 추가:
//   /** 포커스 떠날 때(인라인 메모 blur 저장). 멘션 드롭다운 클릭은 preventDefault라 여기로 안 옴. */
//   onBlur?: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
```

함수 구조분해에 `onBlur` 추가하고, `shared` 객체에 `onBlur,` 한 줄 추가(다른 핸들러와 동일 위치). textarea/input 둘 다 `{...shared}`로 전달되므로 추가 작업 없음.

> 멘션 선택 시: `MentionDropdown`의 `onMouseDown`+`preventDefault`가 입력칸 포커스를 유지시켜 `onBlur`가 발생하지 않는다(MentionDropdown.tsx:37). 따라서 멘션 클릭으로 blur 저장이 조기 트리거되지 않는다.

- [ ] **Step 2: 타입체크** — `npm run typecheck` → PASS

- [ ] **Step 3: 커밋** — `git add src/components/common/EntityAwareInput.tsx && git commit -m "리테이크 4b Chunk1: EntityAwareInput onBlur(인라인 저장)"`

---

## Chunk 2: 씬 메모 — 상세 모달 2곳 (입력 + 표시 + 컷 점프)

### Task 4: `UnifiedSceneDetailModal` InlineTextareaRow

**Files:** Modify `src/components/scenes/UnifiedSceneDetailModal.tsx`

`InlineTextareaRow`(현재 ~1372)는 `draft` state + textarea(`onBlur=commit`, `Escape=revert`)다. 씬 컨텍스트(sheetName)는 호출부(~1310, `onFieldUpdate(sheetName, ...)` 가 있는 곳)에서 prop으로 내린다.

- [ ] **Step 1: import** — 파일 상단에 `EntityAwareInput`, `EntityText`, `navigateToCutNumber`, `parseCommentSceneContext`, `useAuthStore` 추가(기존 import 확인 후 없는 것만).

- [ ] **Step 2: 호출부에서 sheetName 전달** — `<InlineTextareaRow ... />`(~1310)에 `sheetName={sheetName}` prop 추가. `InlineTextareaRow` 시그니처에 `sheetName?: string` 추가.

- [ ] **Step 3: 입력 교체** — `editing` 분기의 `<textarea ... />`(~1411)를 `EntityAwareInput`으로:

```tsx
<EntityAwareInput
  multiline
  value={draft}
  onChange={setDraft}
  users={useAuthStore.getState().users}   /* 또는 컴포넌트 상단 const { users } = useAuthStore() */
  onBlur={commit}
  onCancel={() => { setDraft(value); setEditing(false); }}
  autoFocus
  className="w-full min-h-[64px] bg-bg-primary border border-accent/50 rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-accent resize-y"
/>
```

> `ref`로 직접 focus하던 `useEffect(()=>{if(editing)ref.current?.focus()})`는 `autoFocus`로 대체되므로 제거(또는 ref 유지하되 EntityAwareInput은 내부 ref라 외부 ref 불가 — `autoFocus` 사용). `spellCheck` 등은 EntityAwareInput이 미지원이면 생략(회귀 영향 없음).

- [ ] **Step 4: 표시 교체** — 비편집 분기의 `<PathLinkifiedText text={value} />`(~1429)를 `EntityText`로:

```tsx
const cutCtx = sheetName ? parseCommentSceneContext(sheetName) : null;
// ...
<EntityText
  text={value}
  userNames={useAuthStore.getState().users.map((u) => u.name)}
  onCutClick={cutCtx ? (n) => navigateToCutNumber(n, { episodeNumber: cutCtx.episodeNumber, partId: cutCtx.partId }) : undefined}
/>
```

> `users`를 매 렌더 `.map` 하지 않도록 컴포넌트 상단에서 `const { users } = useAuthStore()` 후 `userNames = useMemo(() => users.map(u=>u.name), [users])` 권장.

- [ ] **Step 5: 타입체크 + 빌드** — `npm run typecheck && npm run build:vite`
- [ ] **Step 6: 커밋** — `리테이크 4b Chunk2: UnifiedSceneDetailModal 메모 엔티티 입력/표시+컷점프`

### Task 5: `SceneDetailModal` PropertyRow (메모 행만)

**Files:** Modify `src/components/scenes/SceneDetailModal.tsx`

`PropertyRow`(현재 ~97)는 메모 외 여러 속성에 재사용된다. 메모 행만 엔티티 입력/표시가 되도록 옵트인 prop을 추가한다.

- [ ] **Step 1: 구현 전 확인** — `Grep`으로 `<PropertyRow` 사용처를 모두 찾아 어느 호출이 "메모"인지 확인(label/placeholder). 메모 행만 아래 prop을 켠다.

- [ ] **Step 2: PropertyRow 시그니처에 옵트인 추가** — `entityAware?: boolean; sheetName?: string;`. `users`는 컴포넌트 내부 `useAuthStore`로(부서 토글이 이미 store 사용).

- [ ] **Step 3: 입력 분기** — `editing && entityAware`면 `EntityAwareInput`(single-line: `multiline` 생략), 아니면 기존 `<input>` 유지:

```tsx
{editing ? (
  entityAware ? (
    <EntityAwareInput
      value={draft} onChange={setDraft}
      users={useAuthStore.getState().users}
      onBlur={commit} submitOn="enter" onSubmit={commit}
      onCancel={() => { setDraft(value); setEditing(false); }}
      autoFocus
      className="w-full bg-bg-primary border border-accent/50 rounded-md px-2.5 py-1 text-sm text-text-primary outline-none focus:border-accent"
    />
  ) : (
    <input ref={inputRef} ... />  /* 기존 그대로 */
  )
) : ( /* 표시 */ )}
```

- [ ] **Step 4: 표시 분기** — `entityAware && value`면 `PathLinkifiedText` 대신 `EntityText`(컷점프 ctx = `parseCommentSceneContext(sheetName)`), 아니면 기존.

- [ ] **Step 5: 메모 호출부 갱신** — 메모 PropertyRow 호출에 `entityAware sheetName={sheetName}` 추가.

- [ ] **Step 6: 타입체크 + 빌드** — `npm run typecheck && npm run build:vite`
- [ ] **Step 7: 커밋** — `리테이크 4b Chunk2: SceneDetailModal 메모 행 엔티티 입력/표시+컷점프`

---

## Chunk 3: 씬 메모 표시 — 카드/시트뷰 (검색강조 보존 + 컷 점프)

### Task 6: `UnifiedSceneCard` bg/act 메모 표시

**Files:** Modify `src/components/scenes/UnifiedSceneCard.tsx`

현재 메모 표시(~354 bg, ~365 act)는 `PathLinkifiedText` + `renderTextSegment`(HighlightText 검색강조). `EntityText`로 바꾸되 `renderTextSegment`를 그대로 넘겨 검색강조를 보존하고, sheetName으로 컷 점프를 배선한다.

- [ ] **Step 1: 구현 전 확인** — `Grep`으로 카드의 `bgSheetName`/`actSheetName` 출처 확인(~191 `onOpenDetail(bgSheetName, ...)` 부근). 없으면 `merged`/props에서 sheetName 확보 경로를 찾는다. 확보 불가하면 컷점프 생략(색 표시만)하고 노트.

- [ ] **Step 2: 교체(bg)** — `~354`:

```tsx
const bgCutCtx = bgSheetName ? parseCommentSceneContext(bgSheetName) : null;
// ...
<EntityText
  text={bgScene.memo}
  userNames={userNames}
  onCutClick={bgCutCtx ? (n) => navigateToCutNumber(n, { episodeNumber: bgCutCtx.episodeNumber, partId: bgCutCtx.partId }) : undefined}
  renderTextSegment={(seg, idx) => <HighlightText key={idx} text={seg} query={searchQuery} />}
/>
```

- [ ] **Step 3: 교체(act)** — `~365` 동일 패턴(`actScene.memo`, `actSheetName`/`actCutCtx`).

- [ ] **Step 4: import + userNames** — `EntityText`/`navigateToCutNumber`/`parseCommentSceneContext`/`useAuthStore` 추가. `userNames`는 `useAuthStore` + `useMemo`.

- [ ] **Step 5: 타입체크 + 빌드** — `npm run typecheck && npm run build:vite`
- [ ] **Step 6: 커밋** — `리테이크 4b Chunk3: UnifiedSceneCard 메모 표시(검색강조+컷점프)`

### Task 7: `UnifiedSceneSheetView` 메모 셀 표시

**Files:** Modify `src/components/scenes/UnifiedSceneSheetView.tsx`

메모 셀(~300, `isMemo`)이 `PathLinkifiedText` + `renderTextSegment`(검색강조)다. 셀 컴포넌트에 sheetName/userNames를 전달해 `EntityText`로 교체.

- [ ] **Step 1: 구현 전 확인** — 메모 셀 컴포넌트(~157 `MemoCell`류)의 props로 sheetName/씬 컨텍스트가 오는지 확인(`onFieldUpdate(sheetName,...)` 가 있으므로 행에 sheetName 존재). 없으면 prop 추가.

- [ ] **Step 2: 교체** — `~301`:

```tsx
const cutCtx = sheetName ? parseCommentSceneContext(sheetName) : null;
<EntityText
  text={value || '-'}
  userNames={userNames}
  onCutClick={cutCtx ? (n) => navigateToCutNumber(n, { episodeNumber: cutCtx.episodeNumber, partId: cutCtx.partId }) : undefined}
  renderTextSegment={(seg, idx) => <HighlightText key={idx} text={seg} query={searchQuery} />}
/>
```

> `value || '-'` 의 `'-'` 플레이스홀더는 엔티티가 없으니 그대로 평문 출력된다(무해). **메모 인라인 편집 input(~262/~1093)은 4b 입력 대상에서 제외 — 표시만 교체한다**(좁은 셀+빠른편집 특성, 멘션 입력은 상세창/카드/위젯에서. 리뷰 반영·YAGNI). 입력칸은 기존 `<input>` 유지.

- [ ] **Step 3: import + userNames** — Card와 동일.
- [ ] **Step 4: 타입체크 + 빌드** — `npm run typecheck && npm run build:vite`
- [ ] **Step 5: 커밋** — `리테이크 4b Chunk3: UnifiedSceneSheetView 메모 셀 표시(검색강조+컷점프)`

---

## Chunk 4: 일정 메모 (색 표시만)

### Task 8: `EventQuickEdit` + `EventSidePanel`

**Files:** Modify `src/components/calendar/EventQuickEdit.tsx`, `src/components/calendar/EventSidePanel.tsx`

일정 메모는 씬 컨텍스트가 없어 컷 점프는 색 표시만(onCutClick 생략). 멘션·경로 칩 + 인-인풋 강조만 추가.

- [ ] **Step 1: EventQuickEdit 입력 교체** — textarea(~258)를 `EntityAwareInput`(multiline, `value={memo}` `onChange={setMemo}`, `users={useAuthStore... }`). 저장은 기존 버튼 유지(submit prop 없음). **Escape는 onCancel 주지 말 것** — 팝오버 닫기(window keydown)가 처리해야 한다(멘션 active 시엔 useMentionAutocomplete가 Escape를 stopPropagation으로 가로채 멘션만 닫음). 팝오버 폭 300px → `dropdownPositionClassName="left-2 right-2"`.

- [ ] **Step 2: EventSidePanel 입력 교체** — 편집 textarea(~363)를 `EntityAwareInput`(multiline, `value={draftMemo}` `onChange={setDraftMemo}`). 저장/취소 버튼 유지. Escape는 기존 편집 취소 리스너 유지(onCancel 주지 않음).

- [ ] **Step 3: EventSidePanel 표시 교체** — 읽기 모드 메모(~371, 평문 `whitespace-pre-wrap`)를 `EntityText`(userNames, onMentionClick 옵션, **onCutClick 없음**)로. `whitespace-pre-wrap`은 감싸는 컨테이너에 유지.

- [ ] **Step 4: import** — 두 파일에 `EntityAwareInput`/`EntityText`/`useAuthStore` 추가. EventQuickEdit는 표시처가 없으면 EntityText 생략.

- [ ] **Step 5: 타입체크 + 빌드** — `npm run typecheck && npm run build:vite`
- [ ] **Step 6: 커밋** — `리테이크 4b Chunk4: 일정 메모 엔티티 입력/표시(색 표시만)`

---

## Chunk 5: 작업 메모 (색 표시만)

### Task 9: `MyTasksWidget`

**Files:** Modify `src/components/widgets/MyTasksWidget.tsx`

작업 위젯 맥락이므로 메모는 전부 색 표시만(컷 점프 미배선 — 한솔: 작업 메모 색 표시만). `useAuthStore`는 이미 import(7).

- [ ] **Step 1: users 확보** — 컴포넌트(들) 상단에 `const users = useAuthStore((s) => s.users)`, `userNames = useMemo(...)` (입력/표시 컴포넌트 각각 필요한 곳).

- [ ] **Step 2: 개인할일 추가 폼 메모** — textarea(~453)를 `EntityAwareInput`(multiline, `value={todoMemo}` `onChange={setTodoMemo}` `users`). 제출은 폼 버튼/Enter(제목) 그대로 — 메모 입력엔 submit prop 없음. `rows={2}` 유지.

- [ ] **Step 3: 씬메모 인라인 편집** — `editingField==='memo'`의 input(~602)을 `EntityAwareInput`(single-line, `value={editValue}` `onChange={setEditValue}` `onBlur={commitEdit}` `submitOn="enter"` `onSubmit={commitEdit}` `onCancel={() => setEditingField(null)}`). 좁은 행 → `dropdownPositionClassName` 확인.

- [ ] **Step 4: 표시 교체** — `todo.memo`(~795)와 씬 `s.memo`(~616, `{s.memo || s.sceneId}`)의 메모 부분을 `EntityText`(userNames, onMentionClick 옵션, onCutClick 없음). `s.memo`는 값이 있을 때만 EntityText, 없으면 기존 `s.sceneId` 평문 유지(빈 메모 폴백 보존). `truncate`/`line-through` 등 컨테이너 클래스는 그대로.

- [ ] **Step 5: 타입체크 + 빌드** — `npm run typecheck && npm run build:vite`
- [ ] **Step 6: 커밋** — `리테이크 4b Chunk5: 작업 메모 엔티티 입력/표시(색 표시만)`

---

## Chunk 6: 통합 검증 + 회귀 체크리스트

### Task 10: 전체 검증

- [ ] **Step 1: 타입체크** — `npm run typecheck` → PASS
- [ ] **Step 2: 엔티티/씬컨텍스트 테스트** — `node --test ./tests/mentionQuery.test.ts ./tests/entityTokens.test.ts ./tests/cutScene.test.ts ./tests/revisionSceneContext.test.ts` → ALL PASS
- [ ] **Step 3: 댓글 회귀 테스트** — `node --test ./tests/devPreviewComments.test.ts ./tests/commentReadStateUiWiring.test.ts`(존재 시) → PASS
- [ ] **Step 4: 빌드** — `npm run build:vite` → 성공
- [ ] **Step 5: 커밋(필요 시)** — 잔여 정리 커밋

### Task 11: 회귀 체크리스트 (정적+리뷰, preview 불가 환경)

- [ ] 씬 메모(상세창·카드·시트뷰): @멘션 자동완성(중간/한글 붙은), 인-인풋 파란 강조, 경로/컷 칩 표시, 컷 클릭→해당 씬 이동·하이라이트, 없는 컷→toast
- [ ] 씬 메모 저장: blur 저장·Escape 취소·Enter(단일행)/Check 버튼 정상, 멘션 선택이 조기 저장 안 시킴
- [ ] 카드·시트뷰: **검색어 하이라이트 + 엔티티 칩 동시 정상**(renderTextSegment 보존), truncate 레이아웃 무회귀
- [ ] 일정 메모(EventQuickEdit/EventSidePanel): 멘션·경로 칩, 인-인풋 강조, **Escape가 팝오버/패널 닫기로 정상 동작**(멘션 active 시엔 멘션만 닫힘), 버튼 저장 정상, 좁은 폭 드롭다운 안 넘침
- [ ] 작업 메모(MyTasksWidget): 추가 폼 메모·씬메모 인라인 멘션, 표시 칩(색만), 제목/날짜 입력 무회귀
- [ ] 4a 무회귀: 댓글/리테이크/완료멘트 멘션·컷·경로·점프 그대로

---

## 4b 계획 리뷰 반영 (3관점 적대리뷰 2026-06-20)

> 리뷰어 다수가 "계획이 명시한 변경이 현재 코드에 아직 없다"를 P1으로 보고했으나 이는 프레이밍 오해(계획=구현 전 문서)로 무효. 아래는 실질 유효 항목만.

- **[P1] 빈 메모 폴백:** 메모가 빈 값일 때 `EntityText('')`는 아무것도 렌더하지 않아 기존 폴백(sceneId/placeholder/'-')이 사라진다. 표시 교체는 **반드시 `value ? <EntityText.../> : <기존 폴백>`** 조건부로. 적용: SceneDetailModal(placeholder 분기 유지), UnifiedSceneSheetView(`value||'-'`는 항상 비지 않아 안전), MyTasksWidget(`s.memo ? <EntityText.../> : <span>{s.sceneId}</span>`).
- **[결정] 시트뷰 인라인 편집칸 입력 = 4b 제외(표시만):** UnifiedSceneSheetView 메모 셀 편집(~262/~1093)은 좁은 셀+빠른편집 특성상 멘션 입력 UX가 약하다 → 표시만 EntityText, 입력은 기존 input 유지.
- **[수용] 검색강조 한계:** `renderTextSegment`는 평문 토큰에만 적용 — 검색어가 경로/멘션/컷 칩 안에 걸치면 강조 안 됨. **기존 PathLinkifiedText(path 칩 내부 강조 제외)와 동일 철학**이라 회귀 아님.
- **[확인] Escape 충돌 없음:** EntityAwareInput.handleKeyDown은 `mention.onKeyDown(e)`을 먼저 호출 — 멘션 active 시 Escape를 처리+`stopPropagation`(useMentionAutocomplete.ts:87)하여 window 리스너로 새지 않음. 비활성 시 통과 → EventQuickEdit window keydown이 팝오버 닫음(정상). **onCancel 미전달 유지**.
- **[확인] SceneDetailModal sheetName:** 모달 스코프에 `sheetName` 존재(RevisionPanel/CommentPanelResizable에 이미 전달 중) → PropertyRow에 prop으로 내리면 됨.
- **[P3] 성능:** 표시 EntityText는 기존 PathLinkifiedText와 유사 토큰화 비용(회귀 미미). EntityAwareInput은 편집 중 1개만 존재. 카드/시트뷰 `userNames`는 useMemo(계획대로).
- **[확인] IME 한글 멘션:** 4a에서 검증·한솔 확인 완료(동일 부품) — 회귀 아님.
- **[정확화] 라인:** MyTasksWidget 추가폼 메모 textarea 453~459 / 씬메모 인라인 input 601~610 / 씬 표시 616 / todo.memo 표시 794~796. (각 Task 시작 전 Grep 재확인)

## 4c 인계 노트 (다음 단계)

- `#`씬·파트·화 태그(자동완성·칩·점프) + 참조 패널 도크(시안 안 A: 좁은 패널, 요약+전체열기, **좌우 위치 이동**, 여러 핀, 미래 슬랙 스레드 통합). 적용: 댓글·메모·상세모달.
- `#`자동완성 데이터소스: 씬 sceneId / 파트 partId / **화 제목 데이터 존재 여부 코드 확인 필요**. 점프는 `navigateToSceneView`(episodeNumber/partId/highlightSceneId/department/modalRequest) 재사용.
- 4b의 `EntityAwareInput` 입력칸이 4c `#`태그의 토대. entityTokens에 `#`/scene·part·episode 토큰 추가가 4c 시작점.
- "전체 열기" 동작(모달 전환 vs 겹침 vs 새 모달), 여러 핀 UX, 좌우 이동 토글(개인설정 저장?)은 4c spec서 한솔 확정.

## 검증 (스펙 §14)
- 단계별 typecheck + node:test(기존 재사용) + build:vite.
- 엔티티: @멘션·경로·컷 입력/표시, 씬 메모 컷 점프, 카드/시트뷰 검색강조 보존.
- 메모(씬/일정/작업) 기존 저장·편집·검색 기능 무회귀.
