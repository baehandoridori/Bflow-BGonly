# 리테이크 허브 3단계 — 엔티티 감지 공통 입력(댓글류) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 댓글류 입력(`RevisionCommentThread`, `CommentPanel`)의 중복된 `@멘션` 로직을 caret 기반(중간 멘션 지원) 공통 시스템으로 통일하고, 보낸 댓글 표시에서 `@멘션`·`G:\`경로를 칩으로 렌더한다.

**Architecture:** 순수 토크나이저/감지 로직을 `src/utils`에 두고 `node:test`로 TDD한다. 표시는 `EntityText`(칩 렌더), 입력 자동완성은 `useMentionAutocomplete` 훅 + `MentionDropdown` UI로 공통화한다. 입력창 본체는 기존 `<input>`/`<textarea>`를 유지(한글 IME·이미지 붙여넣기·자동 자라기·quickRevision 보존)한다.

**Tech Stack:** React 18 + TypeScript, Zustand, lucide-react, node:test(순수 로직), Tailwind 디자인 토큰.

---

## 설계 결정 (스펙 §10 + 스웜 매핑 + 계획 리뷰 + 한솔 확정 2026-06-19)

| 결정 | 내용 | 근거 |
|------|------|------|
| morph 범위 | **보낸 댓글 표시에만 칩**. 입력칸 안 blur 시 인-인풋 칩(스펙 §10.3)은 **4단계로 의도적 연기** | **한솔 확정(2026-06-19)**: 댓글은 쓰자마자 전송돼 입력칸 체류 짧음 + 한글 IME 위험. 인-인풋 칩은 체류가 긴 입력(완료멘트/메모)이 생기는 4단계에서. 스펙 §10.3 deviation을 한솔 승인 |
| 씬·컷 번호 | **3단계에서 제외, 4단계로 통째 연기**(감지·표시·점프 모두) | **한솔 확정(2026-06-19)**: 클릭 점프가 sceneKey 2형식+ambiguity로 4단계라, 점프 안 되는 칩을 미리 만들지 않음(혼란 방지). 4단계에서 표시+점프 함께 |
| 중간 멘션 | caret 기반 `detectMentionQuery` 신규 (기존 `lastIndexOf('@')` 폐기) | 스펙 §10.2 "텍스트 중간에서도 드롭다운". 신규 공통 로직이라 회귀 위험 없음 |
| 적용 범위 | 댓글류 2곳만. `CompletionNoteInput`·메모류는 **3단계 미터치(4단계)** | 스펙 §13 step3/step4 경계. `CompletionNoteInput` 주석에 이미 "morph 금지"가 있어 추가 변경 없음 |
| 추상화 수준 | `EntityAwareInput` 단일 컴포넌트 대신 `useMentionAutocomplete`+`MentionDropdown`+`EntityText` 조합 | 두 입력창의 특수성(자동 자라기·quickRevision·이미지) 보존. YAGNI |
| 입력값 stale 방지 | 훅 `refresh()`는 React state(prop)가 아니라 **DOM `el.value`/`selectionStart`를 직접 읽음** | 리뷰 P1: `onChange`의 `setDraft`는 비동기라 같은 이벤트에서 prop은 stale. DOM은 onChange 시점에 이미 최신 → 기존 `handleDraftChange(e.target.value)` 즉시 판정과 동치 |

**스펙↔구현 이름 매핑 (4단계 인계용):**
- 스펙 `useEntityDetector` → 표시는 순수 `tokenizeEntities()`, 입력 자동완성은 `useMentionAutocomplete()`로 분리 구현.
- 스펙 `EntityAwareInput` → 3단계 미생성. 4단계에서 완료멘트/메모 입력에 동일 패턴 반복 시 추출(YAGNI).
- 씬·컷 토큰 타입은 4단계에서 `tokenizeEntities`에 `cut`/`scene` 추가 + `EntityText`에 칩/점프 연결.

---

## File Structure

**신규 (순수 로직 — TDD):**
- `src/utils/mentionQuery.ts` — caret 기반 멘션 트리거 감지 + 삽입. `detectMentionQuery`, `applyMention`.
- `src/utils/entityTokens.ts` — 텍스트 → `EntityToken[]`(text/mention/path). `tokenizeEntities`. (씬·컷은 4단계 추가 지점만 주석으로 표시)
- `tests/mentionQuery.test.ts`, `tests/entityTokens.test.ts`

**신규 (UI):**
- `src/components/common/EntityText.tsx` — 표시용. `tokenizeEntities` → `PathBadge`/멘션 칩 렌더.
- `src/components/common/MentionDropdown.tsx` — 공통 멘션 자동완성 드롭다운 UI(z-40).
- `src/hooks/useMentionAutocomplete.ts` — DOM 직접 읽기 기반 멘션 드롭다운 상태/키핸들/삽입.

**수정:**
- `src/components/scenes/RevisionCommentThread.tsx` — 멘션 자체구현 제거 → 훅+`MentionDropdown`, 표시 → `EntityText`.
- `src/components/scenes/CommentPanel.tsx` — 동일 교체. quickRevision/이모지/이미지/자동자라기/답글 보존.
- `package.json` — `test:entity` 스크립트 추가 + `build`/`build:vite` 체인 편입.

> **구현 전 필수:** CommentPanel/RevisionCommentThread는 큰 파일이라 아래 라인번호는 작성 시점 기준이다. 각 Task 시작 전 `Grep`으로 대상 심볼(예: `renderMentionInSegment`, `showMentions`, `handleDraftChange`)의 실제 위치를 재확인하고 편집하라.

---

## Chunk 1: 순수 로직 — mentionQuery + entityTokens (TDD)

### Task 1: `detectMentionQuery` / `applyMention` (caret 기반 멘션)

**Files:**
- Create: `src/utils/mentionQuery.ts`
- Test: `tests/mentionQuery.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `tests/mentionQuery.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectMentionQuery, applyMention } from '../src/utils/mentionQuery.ts';

// 끝에서 멘션 (caret 은 '홍' 글자 뒤 = 5)
test('detect: 끝에서 @ 입력', () => {
  assert.deepEqual(detectMentionQuery('안녕 @홍', 5), { query: '홍', start: 3, end: 5 });
});
// @ 바로 뒤 caret(빈 query) — 인덱스 안(0)녕(1)' '(2)@(3), caret=4
test('detect: @ 바로 뒤 caret(빈 query)', () => {
  assert.deepEqual(detectMentionQuery('안녕 @', 4), { query: '', start: 3, end: 4 });
});
// 핵심: 텍스트 '중간' caret 멘션 (기존 lastIndexOf 로는 불가). '@김 끝' 에서 '@김' 직후(2)
test('detect: 중간 caret 멘션', () => {
  assert.deepEqual(detectMentionQuery('@김 끝', 2), { query: '김', start: 0, end: 2 });
});
test('detect: 문자열 맨 앞 @', () => {
  assert.deepEqual(detectMentionQuery('@', 1), { query: '', start: 0, end: 1 });
});
test('detect: 이메일 a@b 는 멘션 아님', () => {
  assert.equal(detectMentionQuery('a@b', 3), null);
});
test('detect: query 안에 공백이면 멘션 아님(토큰 종료)', () => {
  assert.equal(detectMentionQuery('@김 철수', 5), null);
});
test('detect: 20자 이상 query 는 멘션 아님', () => {
  const long = '@' + 'a'.repeat(20);
  assert.equal(detectMentionQuery(long, long.length), null);
});
test('detect: caret 앞에 @ 없으면 null', () => {
  assert.equal(detectMentionQuery('일반 텍스트', 6), null);
});

// applyMention — end 는 detect 의 caret(=end) 계약과 동일하게 사용
test('apply: caret 토큰을 @이름 + 공백으로 치환', () => {
  // '안녕 @홍'(len5), start=3,end=5 → '안녕 @홍길동 '
  assert.deepEqual(applyMention('안녕 @홍', 3, 5, '홍길동'), { text: '안녕 @홍길동 ', caret: 8 });
});
test('apply: 중간 멘션 치환은 뒷부분 보존 + 공백 중복 안 함', () => {
  // '@김 끝' start=0,end=2 → '@김철수 끝' (end 뒤가 ' '이라 공백 추가 안 함)
  assert.deepEqual(applyMention('@김 끝', 0, 2, '김철수'), { text: '@김철수 끝', caret: 4 });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test ./tests/mentionQuery.test.ts`
Expected: FAIL (`Cannot find module '../src/utils/mentionQuery.ts'`)

- [ ] **Step 3: 최소 구현** — `src/utils/mentionQuery.ts`

```ts
/**
 * caret 위치 기반 @멘션 트리거 감지 (스펙 §10.2 — 텍스트 '중간'에서도 동작).
 *
 * 기존 댓글 입력은 text.lastIndexOf('@') 로 '마지막 @' 만 봐서 중간 멘션을 못 했다.
 * 여기서는 caret 에서 왼쪽으로 토큰 시작을 스캔하므로 어느 위치에서든 멘션이 잡힌다.
 * 순수 함수 — React/DOM 의존 없음. node:test 로 검증.
 */

const MAX_QUERY_LEN = 20;

export interface MentionQuery {
  query: string; // @ 뒤부터 caret 까지의 텍스트(공백 없음)
  start: number; // '@' 인덱스
  end: number;   // caret 인덱스 (호출부 activeRange.end 와 동일 계약)
}

/** caret 위치에서 활성 멘션 토큰을 찾는다. 없으면 null. */
export function detectMentionQuery(text: string, caret: number): MentionQuery | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '@') {
      // '@' 앞은 문자열 시작이거나 공백이어야 멘션(이메일 a@b 방지)
      const before = i === 0 ? '' : text[i - 1];
      if (i !== 0 && !/\s/.test(before)) return null;
      const query = text.slice(i + 1, caret);
      if (query.length >= MAX_QUERY_LEN) return null;
      if (/\s/.test(query)) return null;
      return { query, start: i, end: caret };
    }
    if (/\s/.test(ch)) return null; // 공백 만나면 토큰 종료 → 멘션 아님
    i -= 1;
  }
  return null;
}

/** 멘션 토큰(start~end)을 `@이름 ` 으로 치환하고 새 caret 위치를 돌려준다. */
export function applyMention(
  text: string,
  start: number,
  end: number,
  name: string,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const needSpace = !after.startsWith(' ');
  const insert = `@${name}${needSpace ? ' ' : ''}`;
  return { text: before + insert + after, caret: before.length + insert.length };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test ./tests/mentionQuery.test.ts`
Expected: PASS (10/10)

- [ ] **Step 5: 커밋**

```bash
git add src/utils/mentionQuery.ts tests/mentionQuery.test.ts
git commit -m "리테이크 3단계: caret 기반 멘션 감지 유틸 + 테스트"
```

### Task 2: `tokenizeEntities` (text/mention/path 토큰화)

**Files:**
- Create: `src/utils/entityTokens.ts`
- Test: `tests/entityTokens.test.ts`
- 참조: `src/utils/pathLink.ts`(`tokenizeGPaths`), `src/services/commentService.ts:451-463`(`extractMentions` — 멘션 규칙 동기화 대상)

- [ ] **Step 1: 실패 테스트 작성** — `tests/entityTokens.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeEntities } from '../src/utils/entityTokens.ts';

const USERS = ['홍길동', '김철수'];

test('순수 텍스트', () => {
  assert.deepEqual(tokenizeEntities('그냥 글', USERS), [{ type: 'text', content: '그냥 글' }]);
});
test('유효 멘션만 mention 토큰, 무효 @는 text', () => {
  assert.deepEqual(tokenizeEntities('@홍길동 @없는사람', USERS), [
    { type: 'mention', content: '@홍길동', name: '홍길동' },
    { type: 'text', content: ' @없는사람' },
  ]);
});
test('이름 뒤 조사가 붙으면 평문(extractMentions 와 동일 \\S+ 규칙)', () => {
  assert.deepEqual(tokenizeEntities('@홍길동님', USERS), [{ type: 'text', content: '@홍길동님' }]);
});
test('G:\\ 경로는 path 토큰(줄끝까지 — pathLink 규칙)', () => {
  const t = tokenizeEntities('보면 G:\\공유 드라이브\\a.png 확인', USERS);
  assert.deepEqual(t[0], { type: 'text', content: '보면 ' });
  assert.deepEqual(t[1], { type: 'path', content: 'G:\\공유 드라이브\\a.png 확인' });
});
test('멘션+경로 혼합 위치순 보존(경로 먼저 분리)', () => {
  const t = tokenizeEntities('@홍길동 G:\\a.png', USERS);
  assert.deepEqual(t, [
    { type: 'mention', content: '@홍길동', name: '홍길동' },
    { type: 'text', content: ' ' },
    { type: 'path', content: 'G:\\a.png' },
  ]);
});
test('빈 문자열', () => {
  assert.deepEqual(tokenizeEntities('', USERS), []);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test ./tests/entityTokens.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 최소 구현** — `src/utils/entityTokens.ts`

```ts
/**
 * 댓글/메모 텍스트를 엔티티 토큰으로 분해(스펙 §10.2 — 3단계: 멘션·경로).
 *  - path: G:\ 경로 (기존 pathLink.ts 규칙 재사용 — 줄끝까지)
 *  - mention: @이름 (userNames 에 정확히 매칭될 때만)
 *  - text: 그 외
 *
 * ⚠️ 멘션 규칙(MENTION_REGEX + userNames.includes)은 commentService.extractMentions 와
 *    반드시 동일하게 유지한다. 한쪽만 바꾸면 '알림은 가는데 칩은 안 뜸' 회귀가 난다.
 * ⚠️ 씬·컷 번호(컷N/cutN/씬N…)는 4단계에서 추가한다(클릭 점프와 함께). 여기엔 넣지 않는다.
 *
 * 경로를 먼저 분리한 뒤(중첩 회피) 각 text 조각에서 mention 을 분리한다
 * (PathLinkifiedText 의 renderTextSegment 철학 계승). 순수 함수 — node:test 검증.
 */
import { tokenizeGPaths } from './pathLink.ts';

export type EntityToken =
  | { type: 'text'; content: string }
  | { type: 'path'; content: string }
  | { type: 'mention'; content: string; name: string };

const MENTION_REGEX = /@(\S+)/g;

function tokenizeTextSegment(text: string, userNames: string[]): EntityToken[] {
  const out: EntityToken[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_REGEX)) {
    if (m.index === undefined) continue;
    if (!userNames.includes(m[1])) continue; // 무효 @ 는 평문으로(아래 text 흡수)
    if (m.index > last) out.push({ type: 'text', content: text.slice(last, m.index) });
    out.push({ type: 'mention', content: m[0], name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', content: text.slice(last) });
  return out;
}

export function tokenizeEntities(text: string, userNames: string[]): EntityToken[] {
  if (!text) return [];
  const out: EntityToken[] = [];
  for (const tok of tokenizeGPaths(text)) {
    if (tok.type === 'path') out.push({ type: 'path', content: tok.content });
    else out.push(...tokenizeTextSegment(tok.content, userNames));
  }
  return out;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test ./tests/entityTokens.test.ts`
Expected: PASS (7/7)

- [ ] **Step 5: 커밋**

```bash
git add src/utils/entityTokens.ts tests/entityTokens.test.ts
git commit -m "리테이크 3단계: 엔티티 토큰화 유틸(멘션·경로) + 테스트"
```

---

## Chunk 2: 표시 컴포넌트 — EntityText

### Task 3: `EntityText` (경로 칩 + 멘션 칩)

**Files:**
- Create: `src/components/common/EntityText.tsx`
- 참조: `src/components/common/PathBadge.tsx`, 기존 멘션 칩 스타일 `RevisionCommentThread.tsx:644-657`

- [ ] **Step 1: 구현** — `src/components/common/EntityText.tsx`

```tsx
import { Fragment } from 'react';
import { tokenizeEntities } from '@/utils/entityTokens';
import { PathBadge } from './PathBadge';

interface Props {
  text: string;
  userNames: string[];
  /** 멘션 칩 클릭 — 팀 뷰로 점프 등. 미지정 시 비클릭. */
  onMentionClick?: (name: string) => void;
}

/**
 * 평문 텍스트를 엔티티 칩으로 렌더(스펙 §10.3 — 보낸 댓글 표시 칩).
 *  - 경로: PathBadge(기존)  · 멘션: 보라 칩(클릭 시 onMentionClick)
 * PathLinkifiedText + renderMentionInSegment 조합을 한 컴포넌트로 통합.
 * (씬·컷 칩은 4단계 추가)
 */
export function EntityText({ text, userNames, onMentionClick }: Props) {
  const tokens = tokenizeEntities(text, userNames);
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.type === 'path') return <PathBadge key={`p${i}`} path={tok.content} />;
        if (tok.type === 'mention') {
          const name = tok.name;
          return (
            <span
              key={`m${i}`}
              className={`text-accent font-bold bg-accent/10 rounded px-0.5 transition-colors ${
                onMentionClick ? 'cursor-pointer hover:bg-accent/20' : ''
              }`}
              onClick={onMentionClick ? () => onMentionClick(name) : undefined}
              title={onMentionClick ? `${name} 팀원 보기` : undefined}
            >
              {tok.content}
            </span>
          );
        }
        return <Fragment key={`t${i}`}>{tok.content}</Fragment>;
      })}
    </>
  );
}
```

- [ ] **Step 2: 타입체크 + 커밋**

```bash
npm run typecheck
git add src/components/common/EntityText.tsx
git commit -m "리테이크 3단계: EntityText 표시 컴포넌트(경로/멘션 칩)"
```

---

## Chunk 3: 입력 공통화 — useMentionAutocomplete + MentionDropdown

### Task 4: `useMentionAutocomplete` 훅 (DOM 직접 읽기)

**Files:**
- Create: `src/hooks/useMentionAutocomplete.ts`
- 참조: `src/utils/mentionQuery.ts`, 기존 키핸들 `RevisionCommentThread.tsx:563-585`

- [ ] **Step 1: 구현** — `src/hooks/useMentionAutocomplete.ts`

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { detectMentionQuery, applyMention } from '@/utils/mentionQuery';

interface MentionUser { id: string; name: string }

interface Params {
  /** 멘션 선택 시 부모 입력 state 를 갱신하는 콜백 */
  onChange: (next: string) => void;
  users: readonly MentionUser[];
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
}

/**
 * caret 기반 @멘션 자동완성 공통 훅(스펙 §10.2 — 중간 멘션 지원).
 * 두 댓글 입력(RevisionCommentThread/CommentPanel)이 중복하던 멘션 로직을 한곳으로 통일.
 *
 * 핵심: refresh() 는 React state(prop) 가 아니라 DOM 의 el.value/selectionStart 를 직접 읽는다.
 *   onChange 의 setState 는 비동기라 같은 이벤트에서 prop 은 stale 이지만, DOM 은 이미 최신이므로
 *   기존 handleDraftChange(e.target.value) 즉시 판정과 동치가 된다(리뷰 P1).
 * 입력 엘리먼트 본체(자동 자라기·이미지 paste·quickRevision)는 호출 측이 그대로 소유한다.
 */
export function useMentionAutocomplete({ onChange, users, inputRef }: Params) {
  const [open, setOpen] = useState(false);
  const [activeRange, setActiveRange] = useState<{ start: number; end: number } | null>(null);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () => users.filter((u) => u.name.toLowerCase().includes(filter.toLowerCase())),
    [users, filter],
  );

  /** DOM 에서 현재 value/caret 를 읽어 멘션 활성 여부 갱신. 타이핑/캐럿이동 모두 이 한 경로. */
  const refresh = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const q = detectMentionQuery(el.value, el.selectionStart ?? el.value.length);
    if (q) {
      setOpen(true);
      setActiveRange({ start: q.start, end: q.end });
      setFilter(q.query);
      setIndex(0);
    } else {
      setOpen(false);
      setActiveRange(null);
    }
  }, [inputRef]);

  const close = useCallback(() => {
    setOpen(false);
    setActiveRange(null);
  }, []);

  const select = useCallback(
    (name: string) => {
      const el = inputRef.current;
      if (!activeRange || !el) return;
      const { text, caret } = applyMention(el.value, activeRange.start, activeRange.end, name);
      onChange(text);
      close();
      requestAnimationFrame(() => {
        el.focus();
        try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
      });
    },
    [activeRange, onChange, close, inputRef],
  );

  // 활성 항목 스크롤(기존 패턴)
  useEffect(() => {
    if (!open) return;
    dropdownRef.current?.querySelectorAll('button')[index]?.scrollIntoView({ block: 'nearest' });
  }, [index, open]);

  // 필터로 후보 수가 줄면 index 보정
  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [items.length, index]);

  const active = open && items.length > 0;

  /** 멘션 활성 시 키 가로채기. 처리했으면 true(호출 측은 그때 submit/줄바꿈 스킵). */
  const onKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!active) return false;
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((p) => (p + 1) % items.length); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((p) => (p - 1 + items.length) % items.length); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); select(items[index].name); return true; }
      if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
      return false;
    },
    [active, items, index, select, close],
  );

  return { active, items, index, dropdownRef, refresh, close, select, onKeyDown };
}
```

> **호출 규약(중요):** 입력 엘리먼트에 `onChange`(부모 setState 후 `mention.refresh()` 호출), `onKeyUp={mention.refresh}`, `onClick={mention.refresh}`, `onSelect={mention.refresh}` 를 단다. `onInput` refresh 는 쓰지 않는다(중복). `refresh` 는 DOM 을 직접 읽으므로 setState 순서와 무관하게 최신값을 본다.

- [ ] **Step 2: 타입체크 + 커밋**

```bash
npm run typecheck
git add src/hooks/useMentionAutocomplete.ts
git commit -m "리테이크 3단계: 멘션 자동완성 공통 훅(caret/DOM 직접 읽기)"
```

### Task 5: `MentionDropdown` 공통 UI

**Files:**
- Create: `src/components/common/MentionDropdown.tsx`
- 참조: 기존 드롭다운 `RevisionCommentThread.tsx:522-541`

- [ ] **Step 1: 구현** — `src/components/common/MentionDropdown.tsx`

```tsx
import type { RefObject } from 'react';

interface MentionUser { id: string; name: string }

interface Props {
  items: readonly MentionUser[];
  index: number;
  onPick: (name: string) => void;
  dropdownRef: RefObject<HTMLDivElement | null>;
  /** 컨테이너 좌우 위치 클래스 — 입력창마다 offset 이 달라 호출 측이 지정 */
  positionClassName?: string;
}

/**
 * @멘션 자동완성 드롭다운(공통). 위치는 호출 측이 positionClassName 으로 제어.
 * z-40: 기존 z-20(RevisionCommentThread)/z-30(CommentPanel quickRevision 프리뷰) 위에 확실히 표시(리뷰 P1).
 */
export function MentionDropdown({ items, index, onPick, dropdownRef, positionClassName }: Props) {
  return (
    <div
      ref={dropdownRef}
      className={`absolute bottom-full mb-1 max-h-32 overflow-y-auto rounded-lg border border-bg-border bg-bg-card shadow-lg z-40 ${
        positionClassName ?? 'left-0 right-0'
      }`}
    >
      {items.map((user, i) => (
        <button
          key={user.id}
          type="button"
          // onMouseDown + preventDefault: input blur 전에 실행돼 caret/포커스 race 방지(리뷰 검증)
          onMouseDown={(e) => { e.preventDefault(); onPick(user.name); }}
          className={`w-full text-left px-3 py-1.5 text-xs text-text-primary transition-colors flex items-center gap-2 cursor-pointer ${
            i === index ? 'bg-accent/15' : 'hover:bg-accent/10'
          }`}
        >
          <span className="text-accent text-[11px]">@</span>
          <span>{user.name}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크 + 커밋**

```bash
npm run typecheck
git add src/components/common/MentionDropdown.tsx
git commit -m "리테이크 3단계: 멘션 드롭다운 공통 UI(z-40)"
```

---

## Chunk 4: RevisionCommentThread 교체

### Task 6: 멘션 자체구현 → 훅/드롭다운, 표시 → EntityText

**Files:**
- Modify: `src/components/scenes/RevisionCommentThread.tsx`

**제거 대상(작성 시점 라인 — 구현 전 Grep 으로 재확인):** `showMentions`/`mentionFilter`/`mentionIndex` state(95-97), 활성항목 스크롤 effect(113-119), `handleDraftChange`(313-326), `filteredUsers`(328-331), `insertMention`(333-341), 드롭다운 JSX(522-541), onKeyDown 멘션 분기(563-585), `mentionDropdownRef`(101), `CommentBubble.renderMentionInSegment`(638-659)와 `PathLinkifiedText` 사용(688) + import(33).

- [ ] **Step 1: import 교체**

`PathLinkifiedText` import 제거. 추가:
```ts
import { EntityText } from '@/components/common/EntityText';
import { MentionDropdown } from '@/components/common/MentionDropdown';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
```

- [ ] **Step 2: 멘션 state/핸들러를 훅으로 대체**

state 3개·스크롤 effect·`handleDraftChange`·`filteredUsers`·`insertMention`·`mentionDropdownRef` 삭제 후 본문에 추가:
```ts
const mention = useMentionAutocomplete({
  onChange: (next) => { setDraft(next); draftRef.current = next; },
  users,
  inputRef,
});
```
`<input>`(기존 559-593) 핸들러 교체:
```tsx
onChange={(e) => { setDraft(e.target.value); draftRef.current = e.target.value; mention.refresh(); }}
onKeyUp={mention.refresh}
onClick={mention.refresh}
onSelect={mention.refresh}
```
> 일반 onChange 에서도 `draftRef.current` 를 즉시 동기화한다(리뷰 P2: 전송 실패 롤백이 draftRef 를 동기 판독).

- [ ] **Step 3: onKeyDown 통합**

기존 onKeyDown(563-590)을 교체:
```tsx
onKeyDown={(e) => {
  if (mention.onKeyDown(e)) return;        // 멘션 활성 시 가로챔
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}}
```

- [ ] **Step 4: 드롭다운 JSX 교체** (기존 522-541, 좌우 offset `left-10 right-24` 보존)

```tsx
{mention.active && (
  <MentionDropdown
    items={mention.items}
    index={mention.index}
    onPick={mention.select}
    dropdownRef={mention.dropdownRef}
    positionClassName="left-10 right-24"
  />
)}
```

- [ ] **Step 5: 전송 후 드롭다운 닫기**

`send()` 성공/초기화 경로의 `setShowMentions(false)`(기존 374) → `mention.close()` 로 대체.

- [ ] **Step 6: 표시 → EntityText**

`CommentBubble`의 `renderMentionInSegment`(638-659) 삭제. 본문 렌더(686-690)를 교체:
```tsx
{comment.text && (
  <div className="text-[12px] text-text-primary whitespace-pre-wrap leading-relaxed">
    <EntityText
      text={comment.text}
      userNames={users.map((u) => u.name)}
      onMentionClick={onMentionClick}
    />
  </div>
)}
```
`CommentBubble` props의 `users`/`onMentionClick`은 유지(이미 존재). `userNames` 변환은 `users.map(u=>u.name)`.

- [ ] **Step 7: 타입체크 + 빌드**

Run: `npm run typecheck && npm run build:vite`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add src/components/scenes/RevisionCommentThread.tsx
git commit -m "리테이크 3단계: 댓글 스레드 입력/표시를 엔티티 감지로 교체"
```

---

## Chunk 5: CommentPanel 교체

### Task 7: 멘션 자체구현 → 훅/드롭다운, 표시 → EntityText (quickRevision/이모지/이미지/답글 보존)

**Files:**
- Modify: `src/components/scenes/CommentPanel.tsx`

**보존 필수:** 자동 자라기(`taHeight`/useLayoutEffect), quickRevision 슬래시(`parseRevisionSlashCommand`), 이미지 paste/drag, 이모지 리액션, 답글(`replyTarget`)·답글 프리셋. **멘션 로직만 교체.** 댓글 '수정' textarea(editText)는 기존에도 멘션 없음 → 손대지 않음.

**제거/교체 대상(작성 시점 라인 — 구현 전 Grep 재확인):** `showMentions`/`mentionFilter`/`mentionIndex` state(255-257), `mentionDropdownRef`(359), 멘션 스크롤 effect(691-697), `handleInputChange` 멘션 분기(1158-1171 — `setInput(text)`만 남김), `insertMention`(1173-1179), `filteredUsers`(1181-1183), `renderMentionInSegment`(1307-1329)+`renderText`(1331-1333), `PathLinkifiedText` import(27), 드롭다운 JSX(1853-1868), onKeyDown 멘션 분기(2029-2050).

- [ ] **Step 1: import 추가** (EntityText/MentionDropdown/useMentionAutocomplete), `PathLinkifiedText` import 제거.

- [ ] **Step 2: 훅 배선 + 입력 핸들러**
```ts
const mention = useMentionAutocomplete({
  onChange: (next) => { setInput(next); inputValueRef.current = next; },
  users,
  inputRef,
});
```
`handleInputChange`(1157~)의 멘션 트리거 블록 제거, `setInput(text)`만 유지(자동 자라기 useLayoutEffect 는 input 변경으로 동작). textarea(2017-2026)에 핸들러 추가:
```tsx
onChange={(e) => { handleInputChange(e.target.value); mention.refresh(); }}
onKeyUp={mention.refresh}
onClick={mention.refresh}
onSelect={mention.refresh}
```

- [ ] **Step 3: onKeyDown 통합** — 멘션 키 분기(2029-2050) 제거, onKeyDown 맨 앞에 `if (mention.onKeyDown(e)) return;`. 기존 Enter(전송)/Shift+Enter(줄바꿈)·quickRevision 분기는 그대로 뒤에.

- [ ] **Step 4: 드롭다운 교체**(1853-1868) → `MentionDropdown` `positionClassName="left-3 right-3"`. (z-40 으로 quickRevision 프리뷰 위 표시)

- [ ] **Step 5: 답글 프리셋/전송 시 드롭다운 닫기** — `replyTarget` 설정 effect(665-688)와 전송 성공 경로의 `setShowMentions(false)`(910, 1023) → `mention.close()` 로 대체. 답글 프리셋 effect 끝에 `mention.close()` 추가(리뷰 P1: stale 드롭다운 방지).

- [ ] **Step 6: 표시 → EntityText** — `renderMentionInSegment`(1307-1329) 삭제, `renderText`(1331-1333)를 `EntityText` 래퍼로 교체:
```tsx
const renderText = (text: string) => (
  <EntityText text={text} userNames={userNames} onMentionClick={handleMentionClick} />
);
```
> `renderText` 사용처(부모 댓글 ~1593, 답글 ~1764) 두 곳이 한 번에 교체된다. `handleMentionClick`(1302-1305: `setHighlightUserName`+`setView('team')`) 그대로 연결. `userNames`는 기존 메모(231) 재사용.

- [ ] **Step 7: 타입체크 + 빌드 + 댓글 회귀 테스트**

Run: `npm run typecheck && npm run build:vite`
Run: `node --test ./tests/devPreviewComments.test.ts ./tests/commentReadStateUiWiring.test.ts`
Expected: 모두 PASS

- [ ] **Step 8: 커밋**

```bash
git add src/components/scenes/CommentPanel.tsx
git commit -m "리테이크 3단계: 댓글 패널 입력/표시를 엔티티 감지로 교체(quickRevision 보존)"
```

---

## Chunk 6: 빌드 체인 편입 + 통합 검증

### Task 8: 신규 테스트를 빌드 체인에 편입

**Files:**
- Modify: `package.json:9-11`

- [ ] **Step 1: `test:entity` 추가 + 체인 편입**

```json
"test:auto-update": "node --test ./tests/autoUpdateHelperSwap.test.ts ./tests/autoUpdateManifest.test.ts ./tests/autoUpdateFailurePolicy.test.ts ./tests/autoUpdateInstallerFlow.test.ts",
"test:entity": "node --test ./tests/mentionQuery.test.ts ./tests/entityTokens.test.ts",
"build": "npm run typecheck && npm run test:auto-update && npm run test:entity && vite build && electron-builder && node scripts/generate-manifest.js",
"build:vite": "npm run typecheck && npm run test:auto-update && npm run test:entity && vite build && node scripts/generate-manifest.js --allow-missing-installer",
```

- [ ] **Step 2: 전체 검증**

Run: `npm run typecheck`
Run: `node --test ./tests/mentionQuery.test.ts ./tests/entityTokens.test.ts`
Run: `npm run build:vite`
Expected: 모두 PASS

- [ ] **Step 3: 커밋**

```bash
git add package.json
git commit -m "리테이크 3단계: 엔티티 감지 테스트 빌드 체인 편입"
```

### Task 9: 회귀 체크리스트 (수동 — preview 불가 환경이라 정적+리뷰 대체)

- [ ] 멘션: 끝/중간 caret 모두 드롭다운, ArrowUp/Down/Enter/Tab/Escape, 선택 후 caret 이 삽입 멘션 뒤로, 한글 IME 조합 중 오작동 없음
- [ ] 멘션 알림: 선택→전송 시 `extractMentions` 결과·슬랙 웹훅 트리거 유지(두 컴포넌트)
- [ ] 마우스 클릭 선택: 항목 클릭 후 **입력창 포커스 테두리 유지**(CommentPanel `focused` 의존 보더) + caret 복원
- [ ] CommentPanel: 자동 자라기·Shift+Enter·`/re` quickRevision·이미지 paste/drag·이모지·답글 멘션 프리셋 무회귀
- [ ] quickRevision 프리뷰가 떠 있는 상태에서 @멘션 드롭다운이 그 **위에** 보임(z-40)
- [ ] RevisionCommentThread: 드롭다운 z-20→z-40 변경으로 인한 가림 회귀 없음
- [ ] 표시: 기존 댓글의 `@이름`/`G:\경로` 칩 렌더, 무효 `@`는 평문, 멘션 클릭→팀뷰 점프(두 컴포넌트)
- [ ] 전송/답글 후 드롭다운 잔존 없음

---

## 4단계 인계 노트

- `EntityAwareInput` 미생성. 4단계(완료멘트 `CompletionNoteInput`·리테이크 생성 폼·씬/일정/작업 메모)에서 `useMentionAutocomplete`+`MentionDropdown`+`EntityText` 동일 패턴 적용, 반복 3회+면 `EntityAwareInput` 추출.
- **씬·컷 번호(감지+표시+점프) 전체가 4단계 신규.** `entityTokens.ts`에 `cut`/`scene` 토큰 타입 추가(정규식 예: `/(?<![A-Za-z0-9])(?:씬|scene|컷|cut)\s?\d+/gi`), `EntityText`에 칩+`onCutClick`. 점프는 commentService형 `sceneKey`(`sheetName:sceneNo`)→EP/파트 lookup 후 `setPendingSceneModalRequest`(스웜 scene-cut-jump 권고 경로).
- **인-인풋 칩 morph**(입력칸 blur 시 칩)도 4단계 — 체류가 긴 완료멘트/메모에서 가치. 한솔이 3단계에선 "보낸 댓글에만 칩" 확정.
- 멘션 규칙 단일화: 현재 `entityTokens.MENTION_REGEX` ↔ `commentService.extractMentions` 동기화는 주석 고정. 4단계에서 단일 출처로 통합 검토.
- `PathLinkifiedText`는 7개 사용처가 있어 잔존. 4단계에서 `EntityText`로 점진 대체 후 제거 검토.

**코드리뷰 잔여(기존 동작 — 3단계 회귀 아님, 4단계/폴리싱 처리):**
- (P3) 같은 줄 `G:\경로 @멘션`: `G_PATH_REGEX_GLOBAL`이 줄끝까지 탐욕 매칭이라 `@멘션`이 경로 토큰에 흡수돼 칩은 안 뜨지만, `send`/`handleSubmit`의 `extractMentions`(경로 무관)는 그 이름을 잡아 슬랙 알림을 쏜다('알림 가는데 칩 없음'). 3단계 이전부터 동일했고 `pathLink.ts` 헤더가 "경로 뒤 텍스트는 줄 분리" 규약을 문서화. → 4단계 멘션 단일화 때 `send`의 `mentions`를 `tokenizeEntities` mention-token에서 유도해 해소.
- (P3) CommentPanel 멘션 드롭다운 위치: `bottom-full`이 입력 wrapper(`px-3 pb-3 pt-3 relative`)에 앵커돼, quickRevision 프리뷰·답글 헤더·이미지 썸네일이 열리면 드롭다운이 caret(textarea)에서 멀어진다(기존 동작). → 폴리싱 시 카드/입력행을 anchor로(`relative`를 입력행에만).

## 검증 (스펙 §14 해당분)

- 단계별 `npm run typecheck` + `node --test`(신규 2종) + `npm run build:vite`.
- 엔티티 감지: `@`(중간 포함)/`G:\`경로 표시 및 멘션 알림.
- 댓글류 기존 기능(이미지/이모지/답글/quickRevision) 무회귀.
