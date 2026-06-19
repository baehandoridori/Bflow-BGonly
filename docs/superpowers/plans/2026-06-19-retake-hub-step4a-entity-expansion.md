# 리테이크 허브 4단계(4a) — 엔티티 감지 확장(리테이크 입력·완료멘트·씬/컷) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3단계의 엔티티 감지 부품(`useMentionAutocomplete`/`EntityText`/`MentionDropdown`)을 공통 입력 컴포넌트 `EntityAwareInput`으로 묶고, 리테이크 생성 입력 3곳 + 완료멘트에 적용한다. 씬·컷 번호(`컷N`/`cutN`) 감지·칩 표시·클릭 점프(씬 컨텍스트 있는 곳)를 신규 추가한다.

**Architecture:** 순수 로직(cut 토큰화·씬 lookup)을 `src/utils`에 두고 `node:test` TDD. 입력은 `EntityAwareInput`(input/textarea 겸용, 멘션 자동완성 내장), 표시는 `EntityText`(경로/멘션/컷 칩), 점프는 `cutNumberNavigation`. 완료멘트 빈칸 허용(한솔 확정). CommentPanel·RevisionCommentThread는 특수성 커서 추출 제외(3단계 직접 조립 유지, 표시 onCutClick만 배선).

**Tech Stack:** React 18 + TS, Zustand, lucide-react, node:test, Tailwind 토큰.

---

## 설계 결정 (스펙 §10 + 매핑 스웜 + 한솔 확정 2026-06-19)

| 결정 | 내용 | 근거 |
|------|------|------|
| 이번 범위(4a) | 리테이크 생성 3곳(RevisionPanel 폼/AddRevisionForm/NewRevisionModal) + 완료멘트(CompletionNoteInput) + 씬·컷 감지·표시·점프 | 한솔: 메모류(씬/일정/작업)는 4b 다음 차례 |
| 씬·컷 점프 | 방안 A — 씬 컨텍스트(episodeNumber+partId) 있는 곳만 클릭 이동, 메모 등 고아는 색 표시만 | 한솔 확정. 번호만으론 EP/파트 특정 불가 |
| 컷 정규식 | `/(?:컷|cut)\s*\d+/gi` (씬/scene 제외) | `씬N`은 sceneId(예 '5A')와 혼동 위험. 컷만 수치 |
| EntityAwareInput | input/textarea 겸용 공통 컴포넌트 신규(`src/components/common/`). 멘션 자동완성 내장 | 6곳+ 반복 → DRY. CommentPanel/RevisionCommentThread는 특수성 커서 제외(유지) |
| extractMentions 단일화 | **4a 보류**(주석 동기화 유지) | 동작 변화(path 안 @) 리스크 + cut과 무관. 별도 처리 |
| 완료멘트 | 빈칸 허용 | 한솔 확정 |
| 메모류 표시 morph | 4b | 한솔 범위 결정 |

---

## File Structure

**신규 (순수 로직 — TDD):**
- `src/utils/cutScene.ts` — `resolveCutScene(episodes, episodeNumber, partId, cutNumber)` → scene | null. 순수.
- `tests/cutScene.test.ts`

**수정 (순수 로직 — TDD):**
- `src/utils/entityTokens.ts` — `cut` 토큰 타입 + `CUT_REGEX` 추가, `tokenizeTextSegment`에 멘션+컷 위치순 병합.
- `tests/entityTokens.test.ts` — cut 케이스 추가.

**신규 (UI/유틸):**
- `src/utils/cutNumberNavigation.ts` — `navigateToCutNumber(cutNumber, ctx)` → resolveCutScene + navigateToSceneView + 실패 toast. (store/네비 의존)
- `src/components/common/EntityAwareInput.tsx` — input/textarea 겸용 멘션 입력.

**수정 (UI):**
- `src/components/common/EntityText.tsx` — cut 칩 + `onCutClick` prop.
- `src/components/scenes/RevisionPanel.tsx` — 생성 폼 textarea → EntityAwareInput, 카드 표시 PathLinkifiedText → EntityText(+onCutClick).
- `src/views/compositing/AddRevisionForm.tsx` — textarea → EntityAwareInput.
- `src/views/compositing/NewRevisionModal.tsx` — textarea → EntityAwareInput.
- `src/components/scenes/revision/CompletionNoteInput.tsx` — textarea → EntityAwareInput, onConfirm 유지.
- `src/components/scenes/RevisionCommentThread.tsx`, `src/components/scenes/CommentPanel.tsx` — 표시 EntityText에 `onCutClick` 배선(씬 컨텍스트 전달).
- `package.json` — `test:entity`에 cutScene 테스트 추가.

> **구현 전 필수:** 큰 파일은 작성 시점 라인 기준이다. 각 Task 시작 전 `Grep`으로 대상 심볼 위치를 재확인하라. `navigateToSceneView`(src/utils/sceneNavigationAction.ts) 시그니처: `{ episodeNumber?, partId?, department?, highlightSceneId?, modalRequest?, resetFilters?, toastMessage? }`.

---

## Chunk 1: 순수 로직 — 씬·컷 토큰화 (TDD)

### Task 1: `entityTokens`에 cut 토큰 추가

**Files:**
- Modify: `src/utils/entityTokens.ts`
- Modify: `tests/entityTokens.test.ts`

- [ ] **Step 1: 실패 테스트 추가** — `tests/entityTokens.test.ts` 끝에

```ts
test('컷 번호 감지(컷N/cutN), 숫자 파싱', () => {
  assert.deepEqual(tokenizeEntities('컷5 확인 cut12', USERS), [
    { type: 'cut', content: '컷5', number: 5 },
    { type: 'text', content: ' 확인 ' },
    { type: 'cut', content: 'cut12', number: 12 },
  ]);
});
test('cut 사이 공백 허용', () => {
  assert.deepEqual(tokenizeEntities('Cut 7', USERS), [{ type: 'cut', content: 'Cut 7', number: 7 }]);
});
test('uncut3 단어 내부는 컷 아님', () => {
  assert.deepEqual(tokenizeEntities('uncut3', USERS), [{ type: 'text', content: 'uncut3' }]);
});
test('씬N 은 감지 안 함(컷만)', () => {
  assert.deepEqual(tokenizeEntities('씬5', USERS), [{ type: 'text', content: '씬5' }]);
});
test('멘션+컷 혼합 위치순', () => {
  assert.deepEqual(tokenizeEntities('@홍길동 컷3', USERS), [
    { type: 'mention', content: '@홍길동', name: '홍길동' },
    { type: 'text', content: ' ' },
    { type: 'cut', content: '컷3', number: 3 },
  ]);
});
```

- [ ] **Step 2: 실패 확인** — `node --test ./tests/entityTokens.test.ts` → FAIL

- [ ] **Step 3: 구현** — `src/utils/entityTokens.ts`

타입에 cut 추가:
```ts
export type EntityToken =
  | { type: 'text'; content: string }
  | { type: 'path'; content: string }
  | { type: 'mention'; content: string; name: string }
  | { type: 'cut'; content: string; number: number };
```
정규식 + 병합 (기존 `tokenizeTextSegment`를 멘션·컷 위치순 병합으로 교체):
```ts
const MENTION_REGEX = /@(\S+)/g;
// 앞이 영숫자가 아닐 때만(uncut3 단어 내부 방지). '컷'|'cut' + 선택 공백 + 숫자.
const CUT_REGEX = /(?<![A-Za-z0-9])(?:컷|cut)\s*(\d+)/gi;

function tokenizeTextSegment(text: string, userNames: string[]): EntityToken[] {
  const matches: { start: number; end: number; token: EntityToken }[] = [];
  for (const m of text.matchAll(MENTION_REGEX)) {
    if (m.index === undefined || !userNames.includes(m[1])) continue;
    matches.push({ start: m.index, end: m.index + m[0].length, token: { type: 'mention', content: m[0], name: m[1] } });
  }
  for (const m of text.matchAll(CUT_REGEX)) {
    if (m.index === undefined) continue;
    matches.push({ start: m.index, end: m.index + m[0].length, token: { type: 'cut', content: m[0], number: parseInt(m[1], 10) } });
  }
  matches.sort((a, b) => a.start - b.start);
  const out: EntityToken[] = [];
  let last = 0;
  for (const mt of matches) {
    if (mt.start < last) continue; // 겹침은 앞선 토큰 우선
    if (mt.start > last) out.push({ type: 'text', content: text.slice(last, mt.start) });
    out.push(mt.token);
    last = mt.end;
  }
  if (last < text.length) out.push({ type: 'text', content: text.slice(last) });
  return out;
}
```
헤더 주석에서 "씬·컷은 4단계 추가" 줄을 "씬은 sceneId 혼동으로 제외, 컷만 감지(4a)"로 갱신.

- [ ] **Step 4: 통과 확인** — `node --test ./tests/entityTokens.test.ts` → PASS (기존 + 신규)

- [ ] **Step 5: 커밋** — `리테이크 4a Chunk1: 엔티티 토큰에 컷 번호 추가`

### Task 2: `resolveCutScene` 순수 함수

**Files:**
- Create: `src/utils/cutScene.ts`
- Test: `tests/cutScene.test.ts`
- 참조: `src/types/index.ts`(Episode/Part/Scene 구조 — 구현 전 확인. Scene.no 타입 확인 후 `Number()` 변환)

- [ ] **Step 1: 실패 테스트** — `tests/cutScene.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCutScene } from '../src/utils/cutScene.ts';

const EPISODES = [
  { episodeNumber: 1, parts: [
    { partId: 'A', scenes: [{ no: 5, sceneId: '5' }, { no: 12, sceneId: '12' }] },
    { partId: 'B', scenes: [{ no: 5, sceneId: '5B' }] },
  ] },
];

test('같은 EP·파트에서 cut 번호로 씬 찾기', () => {
  assert.deepEqual(resolveCutScene(EPISODES, 1, 'A', 5), { no: 5, sceneId: '5' });
});
test('파트로 BG/ACT 동일 번호 구분', () => {
  assert.deepEqual(resolveCutScene(EPISODES, 1, 'B', 5), { no: 5, sceneId: '5B' });
});
test('없는 컷이면 null', () => {
  assert.equal(resolveCutScene(EPISODES, 1, 'A', 99), null);
});
test('없는 에피소드/파트면 null', () => {
  assert.equal(resolveCutScene(EPISODES, 9, 'A', 5), null);
  assert.equal(resolveCutScene(EPISODES, 1, 'Z', 5), null);
});
```

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: 구현** — `src/utils/cutScene.ts`

```ts
/**
 * 같은 에피소드·파트 안에서 컷(=Scene.no) 번호로 씬을 찾는다(스펙 §10.2 4a).
 * 번호만으론 EP/파트 특정 불가하므로 호출 측이 episodeNumber+partId 컨텍스트를 준다.
 * 순수 함수 — node:test 검증. (Scene.no 가 문자열일 수 있어 Number() 비교)
 */
interface SceneLike { no: number | string; sceneId: string }
interface PartLike { partId: string; scenes: SceneLike[] }
interface EpisodeLike { episodeNumber: number; parts: PartLike[] }

export function resolveCutScene(
  episodes: readonly EpisodeLike[],
  episodeNumber: number,
  partId: string,
  cutNumber: number,
): SceneLike | null {
  const ep = episodes.find((e) => e.episodeNumber === episodeNumber);
  const part = ep?.parts.find((p) => p.partId === partId);
  return part?.scenes.find((s) => Number(s.no) === cutNumber) ?? null;
}
```

- [ ] **Step 4: 통과 확인** — `node --test ./tests/cutScene.test.ts`

- [ ] **Step 5: 커밋** — `리테이크 4a Chunk1: resolveCutScene 순수 함수 + 테스트`

---

## Chunk 2: 씬·컷 네비게이션 유틸

### Task 3: `navigateToCutNumber`

**Files:**
- Create: `src/utils/cutNumberNavigation.ts`
- 참조: `src/stores/useDataStore.ts`(episodes), `src/utils/sceneNavigationAction.ts`(navigateToSceneView), toast 패턴(`sonner` 또는 app.setToast)

- [ ] **Step 1: 구현** — `src/utils/cutNumberNavigation.ts`

```ts
import { useDataStore } from '@/stores/useDataStore';
import { navigateToSceneView } from '@/utils/sceneNavigationAction';
import { resolveCutScene } from '@/utils/cutScene';

export interface CutContext {
  episodeNumber: number;
  partId: string;
}

/** 컷 번호 칩 클릭 → 같은 EP·파트의 씬으로 이동. 못 찾으면 toast 후 false. */
export function navigateToCutNumber(cutNumber: number, ctx: CutContext): boolean {
  const episodes = useDataStore.getState().episodes;
  const scene = resolveCutScene(episodes, ctx.episodeNumber, ctx.partId, cutNumber);
  if (!scene) {
    navigateToSceneView({ toastMessage: `컷${cutNumber}을(를) 찾을 수 없습니다.`, resetFilters: false });
    return false;
  }
  navigateToSceneView({
    episodeNumber: ctx.episodeNumber,
    partId: ctx.partId,
    highlightSceneId: scene.sceneId,
  });
  return true;
}
```
> `navigateToSceneView` 의 실제 시그니처/`toastMessage` 동작·`useDataStore.episodes` 구조를 구현 시 확인. 실패 시 toast만 띄우고 화면 전환은 하지 않도록 조정 가능.

- [ ] **Step 2: 타입체크 + 커밋** — `리테이크 4a Chunk2: 컷 번호 씬 점프 유틸`

---

## Chunk 3: EntityText 컷 칩 + onCutClick

### Task 4: `EntityText`에 cut 칩

**Files:**
- Modify: `src/components/common/EntityText.tsx`

- [ ] **Step 1: 구현** — `onCutClick` prop + cut 토큰 렌더 추가

```tsx
import { Scissors } from 'lucide-react';
// Props 에 추가: onCutClick?: (cutNumber: number) => void;
// tokens.map 안에 cut 분기 추가:
if (tok.type === 'cut') {
  return (
    <span
      key={`c${i}`}
      className={`inline-flex items-center gap-0.5 align-baseline text-[#74B9FF] bg-[#74B9FF]/10 rounded px-1 font-semibold transition-colors ${
        onCutClick ? 'cursor-pointer hover:bg-[#74B9FF]/20' : ''
      }`}
      onClick={onCutClick ? () => onCutClick(tok.number) : undefined}
      title={onCutClick ? `컷${tok.number}(으)로 이동` : '씬·컷 표시'}
    >
      <Scissors size={9} className="shrink-0" />
      {tok.content}
    </span>
  );
}
```

- [ ] **Step 2: 타입체크 + 커밋** — `리테이크 4a Chunk3: EntityText 컷 칩(onCutClick)`

---

## Chunk 4: EntityAwareInput 공통 컴포넌트

### Task 5: `EntityAwareInput`

**Files:**
- Create: `src/components/common/EntityAwareInput.tsx`
- 참조: 3단계 조립 패턴(`RevisionCommentThread.tsx` input + MentionDropdown), `useMentionAutocomplete`, `MentionDropdown`

- [ ] **Step 1: 구현** — `src/components/common/EntityAwareInput.tsx`

```tsx
import { useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { MentionDropdown } from './MentionDropdown';

interface MentionUser { id: string; name: string }

interface Props {
  value: string;
  onChange: (v: string) => void;
  users: readonly MentionUser[];
  multiline?: boolean;            // true=textarea, false=input
  placeholder?: string;
  className?: string;
  rows?: number;
  autoFocus?: boolean;
  dropdownPositionClassName?: string;
  submitOn?: 'enter' | 'ctrl-enter' | 'none';  // 기본 'none'
  onSubmit?: () => void;
  onCancel?: () => void;          // Escape (멘션 비활성 시)
  onPaste?: (e: ClipboardEvent) => void;
  'aria-label'?: string;
}

/**
 * 멘션 자동완성(@) 내장 공통 입력. 입력 중엔 평문, 표시(칩)는 EntityText 별도(스펙 §10.3).
 * useMentionAutocomplete + MentionDropdown 조립을 한 컴포넌트로(4단계 6곳+ 반복 제거).
 * 자동 자라기가 필요한 곳은 className 의 resize-y / min-h 로 처리(특수 autoGrow 는 호출측 유지).
 */
export function EntityAwareInput({
  value, onChange, users, multiline, placeholder, className, rows, autoFocus,
  dropdownPositionClassName, submitOn = 'none', onSubmit, onCancel, onPaste,
  'aria-label': ariaLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const mention = useMentionAutocomplete({ onChange, users, inputRef });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (mention.onKeyDown(e)) return;
    if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); return; }
    if (onSubmit && e.key === 'Enter') {
      if (submitOn === 'enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
      else if (submitOn === 'ctrl-enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
    }
  };

  const common = {
    ref: inputRef as never,
    value,
    onChange: (e: { target: { value: string } }) => { onChange(e.target.value); mention.refresh(); },
    onClick: mention.refresh,
    onSelect: mention.refresh,
    onKeyDown: handleKeyDown,
    onPaste,
    placeholder,
    className,
    autoFocus,
    'aria-label': ariaLabel,
  };

  return (
    <div className="relative">
      {mention.active && (
        <MentionDropdown
          items={mention.items}
          index={mention.index}
          onPick={mention.select}
          positionClassName={dropdownPositionClassName}
        />
      )}
      {multiline
        ? <textarea {...common} rows={rows} />
        : <input type="text" {...common} />}
    </div>
  );
}
```
> 주의: `onKeyUp` 미사용(3단계 코덱스 P2 — Arrow/Escape 후 refresh 가 index 리셋·재오픈하는 문제). caret 이동은 onSelect/onClick 으로만.

- [ ] **Step 2: 타입체크 + 커밋** — `리테이크 4a Chunk4: EntityAwareInput 공통 입력 컴포넌트`

---

## Chunk 5: 리테이크 생성 3곳 적용

### Task 6: RevisionPanel / AddRevisionForm / NewRevisionModal 입력 교체 + 카드 표시

**Files:**
- Modify: `src/components/scenes/RevisionPanel.tsx`, `src/views/compositing/AddRevisionForm.tsx`, `src/views/compositing/NewRevisionModal.tsx`

각 폼의 `<textarea value={description} onChange={...} onPaste={handlePaste} onKeyDown={...} className=... />` 를 `EntityAwareInput` 으로 교체. `users`는 `useAuthStore`의 `allUsers`(이미 있음). submit 매핑:
- RevisionPanel: `submitOn="ctrl-enter"` `onSubmit={handleSubmit}`
- AddRevisionForm: `submitOn="enter"` `onSubmit={handleSubmit}` `onCancel={onClose}`
- NewRevisionModal: `submitOn="none"`(버튼 제출 유지)

- [ ] **Step 1: RevisionPanel 폼 교체** (textarea 723-736 → EntityAwareInput, multiline, className 보존, `users={allUsers}`)
- [ ] **Step 2: RevisionPanel 카드 표시** — description 표시에 쓰는 `PathLinkifiedText`(약 267행)를 `EntityText`로 교체 + `onMentionClick`/`onCutClick`(씬 컨텍스트=해당 리테이크의 episodeNumber/partId) 배선. 씬 컨텍스트가 없으면 onCutClick 생략(색 표시만).
- [ ] **Step 3: AddRevisionForm 교체** (textarea 109-121, `multiline rows={2}`, `submitOn="enter"`, `onCancel={onClose}`)
- [ ] **Step 4: NewRevisionModal 교체** (textarea 570-577, `multiline`, `dropdownPositionClassName="left-2 right-2"` — 600px 모달 오버플로우 방지)
- [ ] **Step 5: 타입체크 + 빌드** — `npm run typecheck && npm run build:vite`
- [ ] **Step 6: 커밋** — `리테이크 4a Chunk5: 리테이크 생성 3곳 엔티티 입력/표시 적용`

---

## Chunk 6: 완료멘트 적용

### Task 7: CompletionNoteInput 교체

**Files:**
- Modify: `src/components/scenes/revision/CompletionNoteInput.tsx`
- 참조: 완료멘트 표시처(`src/components/scenes/revision/` 또는 RevisionPanel) — EntityText 전환

- [ ] **Step 1: 입력 교체** — 내부 textarea(30-46)를 `EntityAwareInput`(multiline, `submitOn="ctrl-enter"`, `onSubmit={() => onConfirm(value.trim())}`, `onCancel`)으로. `users`는 `useAuthStore().users` 추가. `onConfirm(note)` 시그니처 유지(빈칸 허용 — trim 후 그대로). placeholder는 기존 유지.
- [ ] **Step 2: 표시 전환** — 완료멘트를 보여주는 곳에서 평문/PathLinkifiedText → `EntityText`(`userNames`, `onMentionClick`, 씬 컨텍스트 있으면 `onCutClick`).
- [ ] **Step 3: 타입체크 + 커밋** — `리테이크 4a Chunk6: 완료멘트 엔티티 입력/표시 적용`

---

## Chunk 7: 댓글류 표시 컷 점프 배선

### Task 8: RevisionCommentThread / CommentPanel 표시에 onCutClick

**Files:**
- Modify: `src/components/scenes/RevisionCommentThread.tsx`, `src/components/scenes/CommentPanel.tsx`

3단계에서 댓글 본문은 이미 `EntityText` 로 표시된다(컷 칩은 Chunk3 으로 자동 표시됨). 여기서는 **점프**만 배선: 각 컴포넌트가 가진 씬 컨텍스트(sceneKey/episodeNumber/partId)로 `onCutClick={(n) => navigateToCutNumber(n, ctx)}` 추가. 씬 컨텍스트를 안전히 구할 수 없으면 onCutClick 생략(색 표시만 — 회귀 없음).

- [ ] **Step 1: 씬 컨텍스트 확보 경로 확인** — 두 컴포넌트의 sceneKey(commentService형 `sheetName:sceneNo`)에서 episodeNumber/partId 추출 가능 여부(`sheetName` 파싱 또는 props). 불가하면 이 Chunk는 "색 표시만"으로 축소하고 4b로 점프 이관(계획 이탈 시 STOP·보고).
- [ ] **Step 2: 가능하면 onCutClick 배선** — `EntityText`에 onCutClick 추가.
- [ ] **Step 3: 타입체크 + 빌드 + 댓글 회귀 테스트** — `npm run typecheck && npm run build:vite` + `node --test ./tests/devPreviewComments.test.ts ./tests/commentReadStateUiWiring.test.ts`
- [ ] **Step 4: 커밋** — `리테이크 4a Chunk7: 댓글 컷 번호 점프 배선`

---

## Chunk 8: 빌드 체인 + 통합 검증

### Task 9: 테스트 편입 + 전체 검증

**Files:**
- Modify: `package.json` (`test:entity`에 `./tests/cutScene.test.ts` 추가)

- [ ] **Step 1: package.json** — `"test:entity": "node --test ./tests/mentionQuery.test.ts ./tests/entityTokens.test.ts ./tests/cutScene.test.ts"`
- [ ] **Step 2: 전체 검증** — `npm run typecheck` / `node --test ./tests/mentionQuery.test.ts ./tests/entityTokens.test.ts ./tests/cutScene.test.ts` / `npm run build:vite`
- [ ] **Step 3: 커밋** — `리테이크 4a Chunk8: 컷 토큰 테스트 빌드 체인 편입`

### Task 10: 회귀 체크리스트 (정적+리뷰, preview 불가 환경)

- [ ] 리테이크 생성 3곳: @멘션 자동완성(중간/한글 붙은), 경로/컷 입력, submit(Ctrl+Enter/Enter/버튼) 정상, 이미지 첨부·Escape 닫기 무회귀
- [ ] 완료멘트: 멘션 자동완성, 빈칸 저장 허용, Ctrl+Enter 저장·Escape 취소, onConfirm 시그니처 유지
- [ ] 표시: 댓글/리테이크 본문에서 컷 칩 표시, 씬 컨텍스트 있는 곳 클릭→이동, 없는 곳 색 표시만
- [ ] 컷 점프: 존재하는 컷→해당 씬 이동·하이라이트, 없는 컷→toast
- [ ] NewRevisionModal 드롭다운이 600px 모달 밖으로 안 넘침
- [ ] 3단계 댓글 멘션/경로 무회귀

---

## 4a 보강 (계획 리뷰 반영 + 한솔 추가 요구)

### 리뷰 반영 (위 Chunk에 적용)
- **[P1] EntityAwareInput ref 타입(Chunk4)**: `useRef<HTMLInputElement | HTMLTextAreaElement>(null)`은 훅 param(union of RefObjects)과 불일치해 typecheck가 깨진다. 훅 호출 시 캐스트한다: `useMentionAutocomplete({ onChange, users, inputRef: inputRef as React.RefObject<HTMLTextAreaElement | null> })`. (또는 `useMentionAutocomplete`의 `Params.inputRef`를 `RefObject<HTMLInputElement | HTMLTextAreaElement | null>` 단일 타입으로 widen — 이 경우 기존 3단계 두 호출처도 typecheck 재확인.) 구현 후 `npm run typecheck` 필수.
- **[P2] 컷 점프 씬 컨텍스트(Chunk5/6)**: `CompRevision`엔 `episodeNumber`/`partId` 분리 필드가 없고 `sceneKey='EP01:A:1'` 한 필드뿐이다. `src/services/revisionService.ts`의 `parseRevisionSceneKey`(episode를 `'EP01'` 문자열로 반환, 비export)를 참고해 **숫자 변환 포함 헬퍼** `parseRevisionSceneContext(sceneKey): { episodeNumber: number; partId: string } | null`을 만들어(revisionService에 추가·export, 또는 `src/utils/`) `':'` split → `'EP01'`에서 `parseInt(seg.replace(/\D/g,''),10)` → number. 변환 실패 시 `onCutClick` 생략(색 표시만). 댓글류 sceneKey는 commentService형 `'sheetName:sceneNo'`(예 `'EP01_A_BG:3'`)라 별도 파싱 — 안 되면 Chunk7은 색 표시만으로 축소(계획대로 STOP·보고).
- **[P3] 컷 칩 색(Chunk3)**: `#74B9FF`는 스펙 §8.1 '진행중' 상태색 + PathBadge(경로) 색과 겹친다. 컷 칩은 **중립색**으로: `text-text-secondary bg-text-secondary/15` + 가위 아이콘, `onCutClick` 있을 때만 `hover:bg-accent/15 hover:text-accent-sub cursor-pointer`. 주석에 "색은 6단계 폴리싱서 재검토".
- **[P3] cut 경계 테스트(Chunk1)**: `tests/entityTokens.test.ts`에 한글 앞 경계 케이스 추가 — `'추가 컷3'` → cut 토큰(공백 뒤), `'한컷3'` → **현재 lookbehind(`(?<![A-Za-z0-9])`)는 한글 앞을 막지 않아 cut으로 잡힘**을 테스트로 못박는다(의도: 한글 뒤도 허용). `'uncut3'`(영문 뒤) 제외는 유지.
- **[P3] CompletionNoteInput users·주석(Chunk6)**: `users`는 prop 추가 대신 컴포넌트 내부에서 `useAuthStore().users` 직접 읽는다(AddRevisionForm/NewRevisionModal 패턴). 헤더 주석의 "엔티티 감지는 3단계 — 여기는 평문만. morph 도입 금지"를 "4a에서 멘션 자동완성·하이라이트 적용"으로 갱신.

### 추가 요구: 인-인풋 멘션 하이라이트 (한솔 확정 — mirror overlay 색강조)

댓글 등 입력칸에서 `@이름`이 완성되면 **입력창 안에서 파란 배경으로 강조**(슬랙 인라인 느낌). 방식: `<textarea>`/`<input>`은 그대로 두고(한글 IME·caret 100% 안정), 뒤에 동일 정렬 mirror 레이어를 겹쳐 토큰 배경만 칠한다. `contentEditable` 미사용(한솔 거부).

> **시각 검증 주의:** mirror 정렬(폰트/패딩/line-height 1px 오차도 어긋남)은 preview 불가 환경에서 정적으로 잡기 어렵다. 정적 구현 + 스웜/코덱스 리뷰 후 **배포해서 한솔이 실제 확인**하는 단계를 검증에 포함한다.

#### Chunk 4.5 / Task: `EntityHighlightOverlay` + 입력칸 적용

**Files:** Create `src/components/common/EntityHighlightOverlay.tsx`; Modify `EntityAwareInput.tsx`, `RevisionCommentThread.tsx`, `CommentPanel.tsx`.

- [ ] **Step 1: EntityHighlightOverlay 구현**

```tsx
import { Fragment } from 'react';
import { tokenizeEntities } from '@/utils/entityTokens';

interface Props {
  text: string;
  userNames: string[];
  /** textarea/input 과 '정확히 동일한' typography+padding 클래스 (정렬 핵심) */
  className?: string;
  /** textarea 스크롤 동기화 */
  scrollTop?: number;
  scrollLeft?: number;
}

/**
 * 입력칸(textarea/input) 뒤에 겹쳐 토큰 배경만 칠하는 미러 레이어(스펙 §10.3 인-인풋 강조).
 * 텍스트는 transparent(입력칸 글자가 위에 보임), 멘션/경로/컷 토큰만 배경색.
 * 정렬: 호출 측이 입력칸과 동일한 font/padding/line-height/white-space 를 className 으로 맞춘다.
 */
export function EntityHighlightOverlay({ text, userNames, className, scrollTop = 0, scrollLeft = 0 }: Props) {
  const tokens = tokenizeEntities(text, userNames);
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent ${className ?? ''}`}
      style={{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }}
    >
      {tokens.map((t, i) => {
        if (t.type === 'mention') return <span key={i} className="rounded bg-accent/25">{t.content}</span>;
        if (t.type === 'path') return <span key={i} className="rounded bg-[#74B9FF]/20">{t.content}</span>;
        if (t.type === 'cut') return <span key={i} className="rounded bg-text-secondary/20">{t.content}</span>;
        return <Fragment key={i}>{t.content}</Fragment>;
      })}
      {/* 마지막 글자가 개행이면 caret 줄 높이 보정 */}
      {text.endsWith('\n') ? ' ' : null}
    </div>
  );
}
```

- [ ] **Step 2: EntityAwareInput 통합** — 컨테이너 `relative` 안에 overlay(뒤) + 입력칸(`bg-transparent`, `relative z-10`). `scrollTop`/`scrollLeft` state를 textarea `onScroll`로 갱신해 overlay에 전달. 입력칸 typography 클래스를 overlay `className`에 그대로 복제(또는 공통 상수). caret이 보이도록 입력칸 `caret-color`/`text` 색 유지.

- [ ] **Step 3: 댓글류 적용** — `RevisionCommentThread`(input), `CommentPanel`(textarea, 자동자라기)의 입력 엘리먼트를 `relative` wrapper로 감싸고 `EntityHighlightOverlay`를 형제로 추가, 입력칸 `bg-transparent` + `onScroll` 동기화. **기존 레이아웃(자동자라기/이미지/quickRevision)·정렬이 어긋나면 STOP·보고**(계획 이탈). CommentPanel은 `taHeight`로 높이가 동적이므로 overlay도 같은 박스를 덮는지 확인.

- [ ] **Step 4: 타입체크 + 빌드** — `npm run typecheck && npm run build:vite`

- [ ] **Step 5: 커밋** — `리테이크 4a: 입력칸 인-인풋 멘션 하이라이트(mirror overlay)`

> 우선순위: EntityAwareInput(리테이크/완료멘트) 적용을 먼저 확실히 하고, 댓글류는 레이아웃 충돌 위험이 크므로 신중히. 정렬이 끝내 불안정하면 댓글류 하이라이트만 분리해 별도 검증/배포.

## 4b 인계 노트

- 씬/일정/작업 메모(UnifiedSceneDetailModal `InlineTextareaRow`, SceneDetailModal, EventQuickEdit, EventSidePanel, MyTasksWidget)에 EntityAwareInput + EntityText 적용. 표시는 PathLinkifiedText → EntityText.
- 메모(고아)는 씬 컨텍스트 없어 컷 점프 미배선(색 표시만) — 한솔 방안 A.
- extractMentions ↔ entityTokens 단일화(3단계 인계, 동작 변화 검증 후).
- TipTap MemoEditor 엔티티(노드/마크) — 별도.
- 완료멘트 표시처가 여러 곳이면 4b에서 EntityText 통일.

## 검증 (스펙 §14)
- 단계별 typecheck + node:test(신규/확장) + build:vite.
- 엔티티: @멘션·경로·컷 입력/표시, 컷 점프(컨텍스트 있는 곳).
- 리테이크 생성/완료멘트/댓글 기존 기능 무회귀.
