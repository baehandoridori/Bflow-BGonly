# 리테이크 허브 4단계(4c) — #씬·파트·화 태그 + 참조 패널 + 우클릭 메뉴 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재의 "컷5" 텍스트 자동인식을 제거하고, `#`를 누르면 @멘션처럼 자동완성 드롭다운이 떠 씬·파트·화를 골라 태그하는 시스템으로 전환한다. 태그 칩은 좌클릭 시 옆에 참조 패널로 그 씬을 띄우고, 우클릭 시 이동·옆에띄우기·수정 메뉴를 연다. 댓글·메모·상세 모달 전부 적용.

**Architecture:** 순수 로직(토큰 파싱·자동완성 후보·직렬화)을 `src/utils`에 두고 `node:test` TDD. 저장은 **마크다운 링크식 인라인 토큰** `[#라벨](bscene:EP:part:sceneId)` / `[#라벨](bpart:EP:part)` / `[#라벨](bepisode:EP)` — 표시는 칩(라벨만), 점프는 타깃으로 정확(화 간 sceneId 중복 해결). 입력은 4a의 `useMentionAutocomplete` 패턴을 `#` 용으로 확장(`useHashtagAutocomplete`), 표시는 `EntityText` 확장, 참조 패널은 `CommentPanelResizable` 사이드 패널 패턴, 우클릭은 `SceneContextMenu` 패턴 재사용.

**Tech Stack:** React 18 + TS, Zustand, lucide-react, node:test, framer-motion, Tailwind 토큰.

---

## 설계 결정 (현황 스캔 + 한솔 확정 2026-06-20)

| 결정 | 내용 | 근거 |
|------|------|------|
| 컷 텍스트 인식 | **제거** — `entityTokens` CUT_REGEX·cut 토큰, `navigateToCutNumber` 텍스트 점프, EntityText 컷 칩 삭제 | 한솔: `#`태그로 전환 |
| `#` 태그 대상 | 씬(sceneId) / 파트(partId) / 화(에피소드) | 한솔: `#친모2`·`#A파트`·`#a001` |
| 저장 형식 | 마크다운 링크식 `[#라벨](bscene:EP:part:sceneId \| bpart:EP:part \| bepisode:EP)` | 칩 짧게 + 속 정확(한솔 1번 안). 평문 완결(DB 변경 0) |
| 자동완성 | `#` 트리거 → 활성 에피소드의 씬/파트/화 후보, `EP01 A · a001`로 중복 구분, **아카이브 제외** | 한솔: @멘션과 동일 느낌, 아카이브 안 된 것만 |
| 좌클릭 | 옆에 참조 패널(요약 + 전체 열기, 좌우 이동) | 한솔 확정 |
| 우클릭 | 이동 / 옆에 띄우기 / 수정 메뉴 | 한솔 확정 |
| 부서 점프 | 통합 모달(핫픽스 v1.41.1과 동일 — `forceDeptFilter='all'`, uuid 없으면 부서 폴백) | 핫픽스 일관 |
| 적용처 | 댓글(CommentPanel/RevisionCommentThread) + 메모(씬/일정/작업) + 상세 모달 | 한솔 |

> **에피소드 제목**: `episodeTitles` 맵(`useDataStore`)에 EP번호별 커스텀 제목("친모2"). `Episode.title`은 'EP.01' 기본. **씬 sceneId는 화 간 중복** → 후보·저장에 (episodeNumber, partId, sceneId) 조합 사용.

---

## File Structure

**신규 (순수 로직 — TDD):**
- `src/utils/hashEntity.ts` — 마크다운 링크식 토큰 직렬화/역직렬화(`serializeHashTag`/`parseHashTarget`), 타입.
- `src/utils/hashtagQuery.ts` — `detectHashtagQuery`(# caret 감지), `applyHashtag`(링크 삽입).
- `src/utils/hashtagCandidates.ts` — `buildHashtagCandidates(episodes, episodeTitles, archivedSet, query)` → 후보 목록(씬/파트/화, 라벨, 타깃).
- `tests/hashEntity.test.ts`, `tests/hashtagQuery.test.ts`, `tests/hashtagCandidates.test.ts`

**수정 (순수 로직 — TDD):**
- `src/utils/entityTokens.ts` — `cut` 토큰 제거, `hash`(scene/part/episode) 토큰 추가(마크다운 링크 파싱).
- `tests/entityTokens.test.ts` — cut 케이스 제거, hash 케이스 추가.

**신규 (UI):**
- `src/hooks/useHashtagAutocomplete.ts` — `#` 자동완성 훅(`useMentionAutocomplete` 패턴).
- `src/components/common/HashtagDropdown.tsx` — 후보 드롭다운(씬/파트/화 구분 표시).
- `src/components/scenes/SceneReferencePanel.tsx` — 좌클릭 참조 패널(좌우 이동, 요약+전체열기).
- `src/components/common/EntityContextMenu.tsx` — 엔티티 우클릭 메뉴(이동/옆에띄우기/수정).

**수정 (UI):**
- `src/components/common/EntityText.tsx` — hash 칩(종류별) + `onHashClick`(좌클릭=참조)/`onHashContextMenu`(우클릭).
- `src/components/common/EntityAwareInput.tsx` — `#` 자동완성 통합(@와 공존).
- `src/components/common/EntityHighlightOverlay.tsx` — hash 토큰 칩 배경(입력 중 라벨만 보이게).
- `src/utils/cutNumberNavigation.ts` → `src/utils/hashNavigation.ts`로 일반화(scene/part/episode 점프, 통합 모달).
- `src/stores/useAppStore.ts` — 참조 패널 상태(`referenceSceneTarget`, open/close).
- `src/views/ScenesView.tsx` — 참조 패널 렌더 + 모달 옆 배치.
- 댓글/메모 적용처(CommentPanel, RevisionCommentThread, 씬/일정/작업 메모 — 4b 적용처) — onHashClick/onHashContextMenu 배선, navigateToCutNumber 호출 제거.

> **구현 전 필수:** 각 Task 시작 전 `Grep`으로 대상 심볼 위치 재확인. 큰 파일 라인은 작성 시점 기준.

---

## Chunk 1: 마크다운 링크 토큰 직렬화 + entityTokens 전환 (TDD)

### Task 1: `hashEntity` 직렬화/역직렬화

**Files:** Create `src/utils/hashEntity.ts`, `tests/hashEntity.test.ts`

토큰 형식: `[#<라벨>](b<kind>:<payload>)`. kind = `scene`|`part`|`episode`.
- scene: `bscene:1:A:a001` (episodeNumber:partId:sceneId)
- part: `bpart:1:A`
- episode: `bepisode:1`

- [ ] **Step 1: 실패 테스트** — `tests/hashEntity.test.ts`

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeHashTag, parseHashTarget } from '../src/utils/hashEntity.ts';

test('serialize scene', () => {
  assert.equal(serializeHashTag({ kind: 'scene', label: 'a001', episodeNumber: 1, partId: 'A', sceneId: 'a001' }),
    '[#a001](bscene:1:A:a001)');
});
test('serialize part / episode', () => {
  assert.equal(serializeHashTag({ kind: 'part', label: 'A파트', episodeNumber: 1, partId: 'A' }), '[#A파트](bpart:1:A)');
  assert.equal(serializeHashTag({ kind: 'episode', label: '친모2', episodeNumber: 2 }), '[#친모2](bepisode:2)');
});
test('parse scene/part/episode target', () => {
  assert.deepEqual(parseHashTarget('bscene:1:A:a001'), { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'a001' });
  assert.deepEqual(parseHashTarget('bpart:12:C'), { kind: 'part', episodeNumber: 12, partId: 'C' });
  assert.deepEqual(parseHashTarget('bepisode:2'), { kind: 'episode', episodeNumber: 2 });
});
test('parse invalid → null', () => {
  assert.equal(parseHashTarget('http://x'), null);
  assert.equal(parseHashTarget('bscene:0:A:a001'), null); // ep<=0
  assert.equal(parseHashTarget(''), null);
});
```

- [ ] **Step 2: 실패 확인** — `node --test ./tests/hashEntity.test.ts`
- [ ] **Step 3: 구현** — `src/utils/hashEntity.ts`

```ts
export type HashTarget =
  | { kind: 'scene'; episodeNumber: number; partId: string; sceneId: string }
  | { kind: 'part'; episodeNumber: number; partId: string }
  | { kind: 'episode'; episodeNumber: number };

export interface HashTag extends Partial<HashTarget> { kind: HashTarget['kind']; label: string; episodeNumber: number; partId?: string; sceneId?: string; }

export function serializeHashTag(t: HashTag): string {
  const payload = t.kind === 'scene' ? `bscene:${t.episodeNumber}:${t.partId}:${t.sceneId}`
    : t.kind === 'part' ? `bpart:${t.episodeNumber}:${t.partId}`
    : `bepisode:${t.episodeNumber}`;
  return `[#${t.label}](${payload})`;
}

export function parseHashTarget(target: string): HashTarget | null {
  const seg = target.split(':');
  const ep = parseInt(seg[1], 10);
  if (seg[0] === 'bscene' && seg.length === 4 && ep > 0 && seg[2] && seg[3])
    return { kind: 'scene', episodeNumber: ep, partId: seg[2], sceneId: seg[3] };
  if (seg[0] === 'bpart' && seg.length === 3 && ep > 0 && seg[2])
    return { kind: 'part', episodeNumber: ep, partId: seg[2] };
  if (seg[0] === 'bepisode' && seg.length === 2 && ep > 0)
    return { kind: 'episode', episodeNumber: ep };
  return null;
}
```

- [ ] **Step 4: 통과 확인** — `node --test ./tests/hashEntity.test.ts`
- [ ] **Step 5: 커밋** — `리테이크 4c Chunk1: hashEntity 직렬화/역직렬화`

### Task 2: `entityTokens`에서 cut 제거 + hash 토큰 추가

**Files:** Modify `src/utils/entityTokens.ts`, `tests/entityTokens.test.ts`

- [ ] **Step 1: 테스트 수정** — cut 테스트 전부 제거. hash 케이스 추가:

```ts
test('hash scene token 파싱', () => {
  assert.deepEqual(tokenizeEntities('보세요 [#a001](bscene:1:A:a001) 참고', USERS), [
    { type: 'text', content: '보세요 ' },
    { type: 'hash', content: '[#a001](bscene:1:A:a001)', label: 'a001', target: { kind: 'scene', episodeNumber: 1, partId: 'A', sceneId: 'a001' } },
    { type: 'text', content: ' 참고' },
  ]);
});
test('hash part/episode', () => {
  const toks = tokenizeEntities('[#A파트](bpart:1:A) [#친모2](bepisode:2)', USERS);
  assert.equal(toks.filter(t => t.type === 'hash').length, 2);
});
test('컷5 텍스트는 더 이상 토큰 아님(평문)', () => {
  assert.deepEqual(tokenizeEntities('컷5 확인', USERS), [{ type: 'text', content: '컷5 확인' }]);
});
test('잘못된 링크는 평문', () => {
  assert.deepEqual(tokenizeEntities('[#x](http://y)', USERS), [{ type: 'text', content: '[#x](http://y)' }]);
});
```

- [ ] **Step 2: 구현** — `entityTokens.ts`
  - `EntityToken`에서 `cut` 제거, 추가: `| { type: 'hash'; content: string; label: string; target: HashTarget }`.
  - `CUT_REGEX` 제거. `HASH_LINK_REGEX = /\[#([^\]]+)\]\((b(?:scene|part|episode):[^)]+)\)/g` 추가.
  - `tokenizeTextSegment`에서 cut 매칭 제거, hash 매칭 추가(`parseHashTarget`로 검증, 실패 시 평문). 멘션+해시 위치순 병합(기존 정렬 로직 유지).
  - import `parseHashTarget` from `./hashEntity.ts`. 헤더 주석 갱신(컷 제거, 해시 추가).

- [ ] **Step 3: 통과 확인** — `node --test ./tests/entityTokens.test.ts`
- [ ] **Step 4: 커밋** — `리테이크 4c Chunk1: entityTokens 컷 제거 + 해시 토큰`

---

## Chunk 2: # 자동완성 순수 로직 (TDD)

### Task 3: `detectHashtagQuery` + `applyHashtag`

**Files:** Create `src/utils/hashtagQuery.ts`, `tests/hashtagQuery.test.ts`

`mentionQuery.ts` 패턴을 `#` 트리거로. detectHashtagQuery는 caret 왼쪽 스캔, `#` 발견 시 query 반환(공백 종료). applyHashtag는 `#쿼리` 토큰 범위를 `serializeHashTag(...)` + 공백으로 치환.

- [ ] **Step 1: 실패 테스트**

```ts
test('detectHashtagQuery: caret 앞 # 토큰', () => {
  assert.deepEqual(detectHashtagQuery('보세요 #a0', 9), { query: 'a0', start: 7, end: 9 });
});
test('# 앞 영숫자면 제외(이메일/해시 혼동 방지는 아니지만 단어내부 차단)', () => {
  assert.equal(detectHashtagQuery('abc#a0', 6), null);
});
test('공백 만나면 토큰 아님', () => {
  assert.equal(detectHashtagQuery('# a0', 4), null);
});
test('applyHashtag: 토큰을 마크다운 링크로 치환', () => {
  const r = applyHashtag('보세요 #a0', 7, 9, { kind:'scene', label:'a001', episodeNumber:1, partId:'A', sceneId:'a001' });
  assert.equal(r.text, '보세요 [#a001](bscene:1:A:a001) ');
});
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과** — `hashtagQuery.ts`(detectHashtagQuery는 mentionQuery 복제 후 `@`→`#`; applyHashtag는 `serializeHashTag` 사용 + trailing space)
- [ ] **Step 5: 커밋** — `리테이크 4c Chunk2: 해시 자동완성 쿼리/삽입`

### Task 4: `buildHashtagCandidates`

**Files:** Create `src/utils/hashtagCandidates.ts`, `tests/hashtagCandidates.test.ts`
- 참조: `useDataStore.episodes` 구조, `episodeTitles` 맵, 아카이브 set(활성 episodes만 들어오면 필터 불필요 — 구현 시 확인).

후보 = 활성 episodes 순회 → 씬(sceneId)/파트(partId)/화(title). query로 필터(sceneId/partId/title 부분일치). 라벨: 씬=`a001`(부제 `EP01 A`), 파트=`A파트`(부제 화제목), 화=`친모2`(부제 `EP02`). 각 후보에 `HashTag` 타깃.

- [ ] **Step 1: 실패 테스트** (EPISODES fixture로 'a0' → 씬 후보들, 'A' → 파트, '친모' → 화)
- [ ] **Step 2~4: 구현 → 통과** — sceneId 중복은 (ep,part)로 구분, 각 후보 `displayContext: 'EP01 A'`.
- [ ] **Step 5: 커밋** — `리테이크 4c Chunk2: 해시 후보 빌더`

---

## Chunk 3: 해시 점프 유틸 + EntityText 칩

### Task 5: `hashNavigation` (scene/part/episode 통합 모달 점프)

**Files:** Create `src/utils/hashNavigation.ts` (cutNumberNavigation 일반화), 기존 `cutNumberNavigation.ts`는 사용처 제거 후 삭제.

`navigateToHashTarget(target: HashTarget)`:
- scene: `resolveCutScene`(또는 sceneId 직접 매칭) → `navigateToSceneView`(통합 모달, 핫픽스 패턴: uuid 있으면 `forceDeptFilter='all'`).
- part: `navigateToSceneView({ episodeNumber, partId, department:'all' })` (모달 없이 파트 뷰).
- episode: `navigateToSceneView({ episodeNumber, department:'all' })`.

- [ ] **Step 1: 구현** — resolveCutScene은 cutNumber 기반이라, scene 타깃은 sceneId 직접 매칭 헬퍼 추가(`resolveSceneById(episodes, ep, partId, sceneId)`). 핫픽스의 uuid 폴백 로직 유지.
- [ ] **Step 2: 타입체크 + 커밋** — `리테이크 4c Chunk3: 해시 점프 유틸(통합 모달)`

### Task 6: `EntityText` 해시 칩

**Files:** Modify `src/components/common/EntityText.tsx`
- cut 칩 제거. hash 칩 추가: 종류별 아이콘(scene=photo, part=stack-2, episode=movie) + `onHashClick?(target)`(좌클릭) + `onHashContextMenu?(target, x, y)`(우클릭). 칩 클릭은 `stopPropagation`(4b 패턴).

- [ ] **Step 1: 구현** — Props에 onHashClick/onHashContextMenu, hash 분기 렌더.
- [ ] **Step 2: 타입체크 + 커밋** — `리테이크 4c Chunk3: EntityText 해시 칩`

---

## Chunk 4: # 입력 자동완성 (EntityAwareInput 통합)

### Task 7: `useHashtagAutocomplete` + `HashtagDropdown`

**Files:** Create `src/hooks/useHashtagAutocomplete.ts`, `src/components/common/HashtagDropdown.tsx`
- `useMentionAutocomplete` 패턴. refresh가 DOM value/caret 읽어 detectHashtagQuery → buildHashtagCandidates. select 시 applyHashtag. 키보드(Arrow/Enter/Tab/Esc) 동일.
- HashtagDropdown: MentionDropdown 패턴 + 씬/파트/화 구분 표시(`라벨` + `displayContext`), onMouseDown preventDefault.

- [ ] **Step 1: 구현** (episodes/episodeTitles는 useDataStore에서)
- [ ] **Step 2: 타입체크 + 커밋** — `리테이크 4c Chunk4: 해시 자동완성 훅+드롭다운`

### Task 8: `EntityAwareInput`에 # 통합

**Files:** Modify `src/components/common/EntityAwareInput.tsx`, `EntityHighlightOverlay.tsx`
- @ 멘션 + # 해시 둘 다 활성(refresh가 둘 다 감지, 활성 쪽 드롭다운). 키 핸들 합성.
- EntityHighlightOverlay: hash 토큰(마크다운 링크)을 칩 배경 + 링크 문법 부분 흐리게(라벨만 강조) — 입력 중 라벨이 보이도록.

- [ ] **Step 1: 구현** — mention/hash 훅 공존(둘 중 active 우선). overlay hash 처리.
- [ ] **Step 2: 타입체크 + 빌드 + 커밋** — `리테이크 4c Chunk4: EntityAwareInput # 통합`

---

## Chunk 5: 적용 — 댓글·메모·상세 (컷 점프 제거 → 해시 배선)

### Task 9: 댓글류 + 메모류 + 상세 모달에 해시 배선

**Files:** Modify CommentPanel, RevisionCommentThread, RevisionPanel, UnifiedSceneDetailModal, SceneDetailModal, UnifiedSceneCard, UnifiedSceneSheetView, EventQuickEdit, EventSidePanel, MyTasksWidget
- 표시: EntityText에 `onHashClick`(=참조 패널 열기, Chunk6) / `onHashContextMenu`(=우클릭 메뉴, Chunk7) 배선. 기존 `onCutClick`/navigateToCutNumber 호출 제거.
- 입력: 이미 EntityAwareInput 쓰는 곳은 # 자동완성 자동 적용(Chunk4). 댓글 직접조립(CommentPanel/RevisionCommentThread)은 useHashtagAutocomplete 추가.

- [ ] **Step 1: Grep으로 onCutClick/navigateToCutNumber/parseCommentSceneContext 사용처 전수** → 해시 배선으로 교체/제거.
- [ ] **Step 2: 타입체크 + 빌드 + 커밋** — `리테이크 4c Chunk5: 댓글·메모·상세 해시 배선`

---

## Chunk 6: 참조 패널 (좌클릭)

### Task 10: `SceneReferencePanel` + store + ScenesView 배치

**Files:** Create `src/components/scenes/SceneReferencePanel.tsx`; Modify `useAppStore.ts`, `ScenesView.tsx`
- store: `referenceTarget: HashTarget | null`, `referenceSide: 'left'|'right'`, set/clear.
- 좌클릭(onHashClick) → setReferenceTarget. SceneReferencePanel이 그 씬/파트/화 요약(썸네일/진행/담당/메모) + "전체 열기"(navigateToHashTarget) + 좌우 이동 토글 + 닫기. CommentPanelResizable의 motion.div/resize 패턴 참고.
- ScenesView: 모달 옆(좌/우)에 패널 렌더.

- [ ] **Step 1~2: 구현 + 타입체크 + 빌드**
- [ ] **Step 3: 커밋** — `리테이크 4c Chunk6: 참조 패널(좌클릭, 좌우 이동)`

---

## Chunk 7: 우클릭 메뉴

### Task 11: `EntityContextMenu`

**Files:** Create `src/components/common/EntityContextMenu.tsx`; Modify EntityText 사용처(메뉴 상태)
- SceneContextMenu 패턴(portal, 위치, esc/mousedown 닫기). 항목: 이 씬으로 이동(navigateToHashTarget) / 옆에 띄우기(참조 패널) / 수정(태그 편집 — 우선 토큰 텍스트 선택/삭제 수준, 추후 확장).
- onHashContextMenu(target, x, y) → 메뉴 표시.

- [ ] **Step 1~2: 구현 + 타입체크 + 빌드**
- [ ] **Step 3: 커밋** — `리테이크 4c Chunk7: 엔티티 우클릭 메뉴`

---

## Chunk 8: 정리 + 통합 검증

### Task 12: cut 잔재 제거 + 전체 검증
- [ ] cutNumberNavigation.ts / cutScene.ts(컷번호 전용 부분) / revisionSceneContext의 컷 관련 잔재 정리(해시로 대체된 것). 단 parseCommentSceneContext는 댓글 컨텍스트에 쓰이면 유지.
- [ ] package.json test 스크립트에 hash 테스트 3종 추가.
- [ ] `npm run typecheck` / `node --test`(mentionQuery·entityTokens·hashEntity·hashtagQuery·hashtagCandidates·revisionSceneContext) / `npm run build:vite`
- [ ] 커밋 — `리테이크 4c Chunk8: 정리 + 테스트 편입`

### Task 13: 회귀 체크리스트 (정적+리뷰, preview 불가)
- [ ] `#` 입력 → 드롭다운(씬/파트/화, EP·파트 구분), 선택 → 칩
- [ ] 칩 좌클릭 → 옆 참조 패널(좌우 이동), 우클릭 → 이동/옆에띄우기/수정
- [ ] 점프 = 통합 모달(핫픽스 일관), uuid 없으면 폴백
- [ ] 컷5 텍스트 더 이상 인식 안 됨(평문)
- [ ] 댓글·메모·상세 전부 # 동작, @멘션·경로 무회귀
- [ ] 아카이브 에피소드는 후보 제외

---

## 입력 UX 리스크 (배포 후 한솔 확인 필수)
- 마크다운 링크 토큰이 입력 중 평문에 노출되는 정도(미러 오버레이로 라벨만 보이게 처리하나 완벽한 in-input 칩은 아님). 한솔 "@멘션 느낌"과 차이 시 추후 in-input chip morph 개선.

## 검증
- 단계별 typecheck + node:test + build:vite. 멀티에이전트 적대리뷰 + 코덱스. preview 불가 → 배포 후 한솔 실제 확인.
