# 리테이크 허브 '항목 추가'(씬 지정 + 전반) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리테이크 허브 세트 상세에서 새 리비전 항목(씬 지정 또는 전반=scene_id 없음)을 직접 생성하는 모달을 추가한다.

**Architecture:** 기존 씬-바운드 생성 경로(`addRevision`/`createRevision`)를 깨지 않고 `setId`를 모든 시그니처의 **마지막 인자**로 더한다(미전달=null=현행). 씬 없는 '전반'은 electron `addRevision`에서 씬 UUID 해석을 **early-skip**하고 `scene_id=null`로 INSERT. '전반' 판정은 `partOf(sceneKey)==null` 단일 헬퍼로 service·store·table·test가 공유한다(낙관 `''` ↔ 재로드 `'::'` 정규화 흔들림을 흡수).

**Tech Stack:** Electron + React 18 + TypeScript + Zustand + Supabase(@supabase/supabase-js). 테스트: `node:test`(순수 유틸, `@/` 미해석 → 구조적 타입/상대경로). 검증: `npm run build:vite`.

**Spec:** `docs/superpowers/specs/2026-06-22-retake-hub-add-item-design.md`

---

## File Structure

| 파일 | 책임 | 종류 |
|---|---|---|
| `src/utils/revisionGeneral.ts` | 전반 판정(`revisionPartOf`/`isGeneralRevisionSceneKey`) + `nextGeneralRevisionNo` 순수 로직 | Create |
| `tests/revisionGeneral.test.ts` | 위 유틸 TDD | Create |
| `src/views/retake-hub/RetakeHubItemTable.tsx` | 로컬 `partOf`/`isGeneralItem` → 공유 유틸로 교체(DRY) | Modify |
| `electron/supabase.ts` | `addRevision` setId 인자 + 전반 early 분기 + INSERT set_id | Modify |
| `electron/preload.ts` | `supabase:add-revision` invoke에 setId | Modify |
| `electron/main.ts` | `ipcMain.handle` 시그니처 + `sbAddRevision(...)` 전달 setId | Modify |
| `src/types/index.ts` | `ElectronAPI.supabaseAddRevision` 시그니처 setId | Modify |
| `src/mocks/devElectronAPI.ts` | mock setId 인자 + 값 사용 | Modify |
| `src/services/revisionService.ts` | 입력 optional sceneKey + setId, 전반 분기, 생성 setId 채움 | Modify |
| `src/stores/useRevisionStore.ts` | `CreateRevisionInput` 확장 + 생성 후 `syncSetForRevision` | Modify |
| `src/views/retake-hub/RevisionAddModal.tsx` | 항목 추가 모달(씬 지정/전반, 이미지, 담당 picker) | Create |
| `src/views/RetakeHubView.tsx` | 헤더 `+ 항목 추가` 버튼 + 모달 배선 | Modify |
| `DEVLOG/update-notes.json` | 비개발자 톤 릴리스 노트 | Modify |

---

## Chunk 1: 공유 '전반' 판정 유틸 (TDD) + 테이블 DRY

전반 항목 sceneKey는 낙관 추가 시 `''`, 재로드 후 `'::'`로 정규화된다. 두 표현 모두 전반으로 잡는 단일 판정(`partOf==null`)을 만들고, service·store·test·table이 공유한다. (메모리 `project_scene_case_sensitivity_bug` 교훈 — reader/writer/UI키 동반.)

**Files:**
- Create: `src/utils/revisionGeneral.ts`
- Test: `tests/revisionGeneral.test.ts`
- Modify: `src/views/retake-hub/RetakeHubItemTable.tsx:35-46`
- Modify: `package.json:10` (test:entity 스크립트에 테스트 추가)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/revisionGeneral.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  revisionPartOf,
  isGeneralRevisionSceneKey,
  nextGeneralRevisionNo,
} from '../src/utils/revisionGeneral.ts';

test('revisionPartOf — EP:PART:scene 에서 대문자 파트', () => {
  assert.equal(revisionPartOf('EP01:A:1'), 'A');
  assert.equal(revisionPartOf('EP02:b:raw-x'), 'B');
});

test('revisionPartOf — 전반 표현은 null', () => {
  assert.equal(revisionPartOf(''), null);     // 낙관 추가 표현
  assert.equal(revisionPartOf('::'), null);   // 재로드 정규화 표현
  assert.equal(revisionPartOf('single'), null);
});

test('isGeneralRevisionSceneKey — 빈/콜론만/형식밖은 전반', () => {
  assert.equal(isGeneralRevisionSceneKey(''), true);
  assert.equal(isGeneralRevisionSceneKey('::'), true);
  assert.equal(isGeneralRevisionSceneKey('EP01:A:1'), false);
});

test('nextGeneralRevisionNo — 빈 세트는 1', () => {
  assert.equal(nextGeneralRevisionNo([], 'set-1'), 1);
});

test('nextGeneralRevisionNo — 같은 세트 전반 항목 max+1 (\'\'·\'::\' 혼재)', () => {
  const revs = [
    { setId: 'set-1', sceneKey: '', revisionNo: 1 },
    { setId: 'set-1', sceneKey: '::', revisionNo: 2 },   // 재로드 표현도 동일 카운트
    { setId: 'set-2', sceneKey: '', revisionNo: 9 },     // 다른 세트 무시
    { setId: 'set-1', sceneKey: 'EP01:A:1', revisionNo: 7 }, // 씬 매인 무시
  ];
  assert.equal(nextGeneralRevisionNo(revs, 'set-1'), 3);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test ./tests/revisionGeneral.test.ts`
Expected: FAIL — `Cannot find module '../src/utils/revisionGeneral.ts'`

- [ ] **Step 3: 유틸 구현** — `src/utils/revisionGeneral.ts`

```ts
/**
 * 리테이크 '전반'(set_id 있고 scene_id 없는) 항목 판정 + 번호 부여 순수 로직.
 *
 * 전반 항목 sceneKey 는 낙관 추가 시 '' 이지만 재로드 후 rowToRevision 의 정규화로 '::' 가 된다.
 * 두 표현 모두 partOf==null 이므로, "전반"은 항상 partOf 기준으로 판정한다(빈문자열 비교 금지).
 * RetakeHubItemTable 의 그룹 판정과 동일 — 이 모듈을 단일 출처로 공유한다.
 * (구조적 타입 — @/ alias 없이 node:test 가능)
 */

export interface GeneralItemLike {
  setId?: string | null;
  sceneKey: string;
  revisionNo: number;
}

/** sceneKey `EP01:A:1` → 파트 letter('A'). 전반(빈/콜론만/형식밖)은 null. */
export function revisionPartOf(sceneKey: string): string | null {
  const parts = (sceneKey || '').split(':');
  if (parts.length < 2) return null;
  const p = parts[1]?.trim();
  return p ? p.toUpperCase() : null;
}

/** 전반 항목 여부 — 대상 씬에 안 매임(partOf==null). '' 와 '::' 둘 다 true. */
export function isGeneralRevisionSceneKey(sceneKey: string): boolean {
  return revisionPartOf(sceneKey) == null;
}

/** 같은 세트의 기존 전반 항목 max(revisionNo)+1. 빈 세트면 1. */
export function nextGeneralRevisionNo(
  revisions: readonly GeneralItemLike[],
  setId: string,
): number {
  let max = 0;
  for (const r of revisions) {
    if (r.setId !== setId) continue;
    if (!isGeneralRevisionSceneKey(r.sceneKey)) continue;
    if (r.revisionNo > max) max = r.revisionNo;
  }
  return max + 1;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test ./tests/revisionGeneral.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 테이블을 공유 유틸로 교체 (DRY)** — `src/views/retake-hub/RetakeHubItemTable.tsx`

`:13-17` import 블록에 추가:
```ts
import { revisionPartOf, isGeneralRevisionSceneKey } from '@/utils/revisionGeneral';
```

`:35-46`의 로컬 `partOf`/`isGeneralItem` 정의를 **삭제**하고, 사용처를 교체:
- `:69` `(isGeneralItem(r) ? general : scoped)` → `(isGeneralRevisionSceneKey(r.sceneKey) ? general : scoped)`
- `:86` `const p = partOf(r.sceneKey) ?? '?';` → `const p = revisionPartOf(r.sceneKey) ?? '?';`

(나머지 `sceneNumOf` 등 로컬 헬퍼는 유지. 동작 동일.)

- [ ] **Step 6: test:entity 스크립트에 등록** — `package.json:10`

`"test:entity"` 끝의 `./tests/revisionSet.test.ts` 뒤에 ` ./tests/revisionGeneral.test.ts` 추가.

- [ ] **Step 7: 검증**

Run: `npm run typecheck && node --test ./tests/revisionGeneral.test.ts`
Expected: typecheck PASS, 5 tests PASS

- [ ] **Step 8: 커밋**

```bash
git add src/utils/revisionGeneral.ts tests/revisionGeneral.test.ts src/views/retake-hub/RetakeHubItemTable.tsx package.json
git commit -m "리테이크 전반 판정 공유 유틸 + nextGeneralRevisionNo (TDD) + 테이블 DRY"
```

---

## Chunk 2: 백엔드/IPC `setId` 배선 + 전반 early 분기

`setId?`를 `supabaseAddRevision` 경로 전체에 마지막 인자로 추가하고, electron `addRevision`에 전반 early 분기 + INSERT `set_id`를 더한다. 시그니처 정합성은 `npm run typecheck`가 강제(서비스 호출↔ElectronAPI 타입↔mock 타입).

**Files:**
- Modify: `electron/supabase.ts:1807-1911`
- Modify: `electron/preload.ts:221-229`
- Modify: `electron/main.ts:1824-1828`
- Modify: `src/types/index.ts:1003`
- Modify: `src/mocks/devElectronAPI.ts:614-659`

- [ ] **Step 1: electron `addRevision` — 시그니처 + 전반 분기 + INSERT** — `electron/supabase.ts`

`:1824` 시그니처 마지막 인자 뒤에 추가:
```ts
  assigneeIdsJson?: string,
  setId?: string,            // ← 추가: 리테이크 세트 소속(허브 항목)
): Promise<void> {
```

`:1826-1859`의 씬 UUID 해석 블록을 **전반이면 통째로 건너뛰도록** 감싼다. `:1826` 앞에 분기 변수 도입 후 해석 블록을 `if (!isGeneral) { ... }`로 감싼다:
```ts
  // 전반(허브 '전반' 항목): sceneId 비어있으면 씬 UUID 해석을 건너뛴다(part/scene/scene_uuid = null).
  const isGeneral = !sceneId || !sceneId.trim();
  let resolvedPartUuid: string | null = partUuid || null;
  let sceneUuid: string | null = null;
  if (!isGeneral) {
    if (!resolvedPartUuid) {
      resolvedPartUuid = await resolvePartUuid(sceneId, lookupDepartment || department);
    }
    const rawSegment = sceneId.includes(':') ? sceneId.split(':').pop() || sceneId : sceneId;
    const lowerSegment = rawSegment.trim().toLowerCase();
    let sceneIdForResolve = rawSegment;
    if (lowerSegment.startsWith('raw-')) {
      try {
        sceneIdForResolve = decodeURIComponent(lowerSegment.slice(4));
      } catch {
        sceneIdForResolve = lowerSegment.slice(4);
      }
    }
    sceneUuid = await resolveSceneUuidByNumberWithRetry(resolvedPartUuid, sceneIdForResolve);
    const lowerResolve = sceneIdForResolve.toLowerCase();
    const isSyntheticMergedId = lowerResolve.startsWith('merged-') || lowerResolve.startsWith('dup:');
    if (!sceneUuid && !isSyntheticMergedId) {
      throw new Error(`리비전 저장 실패: 씬을 찾을 수 없음 (partUuid=${resolvedPartUuid}, sceneId=${sceneId})`);
    }
  }
```
> 기존 `let resolvedPartUuid = partUuid;`(:1827), `if (!resolvedPartUuid)`(:1828-1830), `:1832-1859` 의 `const rawSegment …` ~ throw 블록을 위 코드로 **대체**한다. notify/assignee 파싱 블록(:1861-1887)은 그대로 둔다.

`:1889-1908` INSERT 페이로드에서 `scene_id`/`part_id`/`scene_uuid`를 전반 안전값으로, `set_id` 추가:
```ts
  const { error } = await supabase.from('comp_revisions').insert({
    id,
    part_id: resolvedPartUuid,            // 전반이면 null
    scene_id: isGeneral ? null : sceneId, // 전반이면 null (빈문자열 아님)
    scene_uuid: sceneUuid,                // 전반/ synthetic 이면 null
    revision_no: revisionNo,
    status,
    priority,
    description,
    frame_no: frameNo,
    image_url: imageUrl,
    department,
    requester_id: requesterId,
    requester_name: requesterName,
    assignee,
    created_at: createdAt,
    notify_user_ids: notifyUserIds,
    assignee_ids: assigneeIds,
    assignee_states: assigneeStates,
    set_id: setId ?? null,                // ← 추가
  });
```

- [ ] **Step 2: preload — invoke에 setId** — `electron/preload.ts:221-229`

```ts
    supabaseAddRevision: (
      id: string, partUuid: string, sceneId: string, revisionNo: number, status: string,
      priority: string, description: string, frameNo: string, imageUrl: string,
      department: string, lookupDepartment: string, requesterId: string, requesterName: string, assignee: string, createdAt: string,
      notifyUserIdsJson: string, assigneeIdsJson?: string, setId?: string,
    ) =>
      ipcRenderer.invoke('supabase:add-revision', id, partUuid, sceneId, revisionNo, status,
        priority, description, frameNo, imageUrl, department, lookupDepartment, requesterId, requesterName, assignee, createdAt,
        notifyUserIdsJson, assigneeIdsJson, setId),
```

- [ ] **Step 3: main 핸들러 — 시그니처 + 전달** — `electron/main.ts:1824-1828`

`:1827` 핸들러 인자 끝에 `, setId?: string` 추가, `:1828` `sbAddRevision(...)` 호출 끝에 `, setId` 추가:
```ts
ipcMain.handle('supabase:add-revision', wrapIpc(async (_e: unknown, id: string, partUuid: string, sceneId: string,
    revisionNo: number, status: string, priority: string, description: string, frameNo: string,
    imageUrl: string, department: string, lookupDepartment: string, requesterId: string, requesterName: string, assignee: string, createdAt: string,
    notifyUserIdsJson?: string, assigneeIdsJson?: string, setId?: string) => {
    await sbAddRevision(id, partUuid, sceneId, revisionNo, status, priority, description, frameNo, imageUrl, department, lookupDepartment, requesterId, requesterName, assignee, createdAt, notifyUserIdsJson, assigneeIdsJson, setId);
```
> 이후 activity 로깅 블록(`:1829-1902`)은 **수정 불필요**. `parseRevisionSceneKey('')`는 throw 없이 '' 반환하고 씬 해석은 `resolvedPartUuid && sceneNumber` 가드로 skip된다(전반 항목 activity 라벨이 빈 씬번호로 남는 건 비치명, 허용).

- [ ] **Step 4: ElectronAPI 타입** — `src/types/index.ts:1003`

`supabaseAddRevision` 시그니처 끝 `assigneeIdsJson?: string` 뒤에 `, setId?: string` 추가:
```ts
  supabaseAddRevision: (id: string, partUuid: string, sceneId: string, revisionNo: number, status: string, priority: string, description: string, frameNo: string, imageUrl: string, department: string, lookupDepartment: string, requesterId: string, requesterName: string, assignee: string, createdAt: string, notifyUserIdsJson: string, assigneeIdsJson?: string, setId?: string) => Promise<void>;
```

- [ ] **Step 5: devElectronAPI mock — 인자 + 값 사용** — `src/mocks/devElectronAPI.ts:614-659`

`:631` 인자 끝에 `setId?: string` 추가, `:656` `setId: null` → `setId: setId ?? null`:
```ts
      notifyUserIdsJson?: string,
      assigneeIdsJson?: string,
      setId?: string,
    ) => {
```
```ts
        setId: setId ?? null,
```

- [ ] **Step 6: 타입 정합성 검증**

Run: `npm run typecheck`
Expected: PASS (서비스의 `supabaseAddRevision(...)` 호출은 아직 17인자라 통과 — Chunk 3에서 18번째 추가. mock/preload/main/타입이 서로 일치하는지 typecheck가 강제)

- [ ] **Step 7: 커밋**

```bash
git add electron/supabase.ts electron/preload.ts electron/main.ts src/types/index.ts src/mocks/devElectronAPI.ts
git commit -m "addRevision setId 인자 + 전반 early 분기(scene_id null) + INSERT set_id"
```

---

## Chunk 3: 서비스 + 스토어 `createRevision` 확장

`createRevision`에 optional `sceneKey` + `setId`를 추가하고, 전반 분기(씬 UUID 해석 skip, `nextGeneralRevisionNo` 번호, 빈 sceneKey + setId IPC 전달, setId 채움)를 더한다. 스토어는 생성 후 `syncSetForRevision`으로 세트 status 재평가.

**Files:**
- Modify: `src/services/revisionService.ts:425-528`
- Modify: `src/stores/useRevisionStore.ts:14-28, 163-167`

- [ ] **Step 1: 서비스 입력 타입 + import** — `src/services/revisionService.ts`

상단 import에 추가:
```ts
import { nextGeneralRevisionNo } from '@/utils/revisionGeneral';
```
`:425-436` `CreateRevisionServiceInput` 수정:
```ts
export interface CreateRevisionServiceInput {
  /** 씬 매인 항목은 필수. 허브 '전반' 항목은 미지정(빈/undefined). */
  sceneKey?: string;
  description: string;
  imageUrl?: string;
  department?: 'bg' | 'acting';
  lookupDepartment?: 'bg' | 'acting';
  requesterId: string;
  requesterName: string;
  notifyUserIds: string[];
  /** 생성 시 담당자 지정 (리테이크 허브 2단계). 항상 notifyUserIds 의 부분집합으로 보정됨. */
  assigneeIds?: string[];
  /** 리테이크 세트 소속(허브 항목 추가). 씬지정/전반 공통. */
  setId?: string | null;
}
```

- [ ] **Step 2: `createRevision` 본문 — 전반 분기** — `src/services/revisionService.ts:438-528`

`:439-440` 의 두 줄(`const lookupSceneKeys = …` / `const normalizedSceneKey = …`)**만** 아래 4줄로 교체한다. `:441` 이하(`const now`/`const id`/`priority`/`department`/`notifyUserIds`/`assigneeIds`/`initialStatus`)는 **그대로 둔다**(`now` 등 재선언 금지 — 중복 선언 컴파일 에러):
```ts
  const isGeneral = !input.sceneKey?.trim();
  const lookupSceneKeys = isGeneral ? [''] : getRevisionLookupSceneKeys(input.sceneKey as string);
  const normalizedSceneKey = isGeneral ? '' : lookupSceneKeys[0];
  const setId = input.setId ?? null;
```

sheets 분기(`:456-457`)의 revisionNo + revision 객체 setId + IPC 호출 수정:
```ts
  if (sheetsMode) {
    const store = await loadAllRevisions();
    const revisionNo = isGeneral
      ? nextGeneralRevisionNo(Object.values(store).flat(), setId ?? '')
      : nextRevisionNo(store, lookupSceneKeys);
    const revision: CompRevision = {
      // …(기존 필드 동일)…
      setId,                       // ← :476 `setId: null` 을 이 값으로
      // …
    };

    await window.electronAPI.supabaseAddRevision(
      id, '', normalizedSceneKey, revisionNo, initialStatus, priority,
      input.description, '', input.imageUrl || '', department || '', input.lookupDepartment || department || '',
      input.requesterId, input.requesterName, '', now,
      JSON.stringify(notifyUserIds),
      JSON.stringify(assigneeIds),
      setId || undefined,          // ← 18번째 인자(setId) 추가
    );

    if (!store[normalizedSceneKey]) store[normalizedSceneKey] = [];
    store[normalizedSceneKey].push(revision);
    return revision;
  }
```

로컬 분기(`:498-499`)도 동일하게:
```ts
  const all = await loadLocalAll();
  const revisionNo = isGeneral
    ? nextGeneralRevisionNo(Object.values(all).flat(), setId ?? '')
    : nextRevisionNo(all, lookupSceneKeys);
  const revision: CompRevision = {
    // …(기존 필드 동일)…
    setId,                         // ← :518 `setId: null` 을 이 값으로
    // …
  };
  if (!all[normalizedSceneKey]) all[normalizedSceneKey] = [];
  all[normalizedSceneKey].push(revision);
  await saveLocal(all);
  return revision;
```
> `:476`, `:518` 두 곳의 `setId: null` 을 `setId,` 로 바꾸는 게 핵심(스펙 §4.4 — 이 값이 있어야 store `syncSetForRevision`/허브 effect 자동완료가 `r.setId===setId`로 집계).

- [ ] **Step 3: 스토어 입력 타입 확장** — `src/stores/useRevisionStore.ts:14-28`

```ts
export interface CreateRevisionInput {
  /** 씬 매인 항목은 필수. 허브 '전반' 항목은 미지정. */
  sceneKey?: string;
  description: string;
  imageUrl?: string;
  department?: 'bg' | 'acting';
  lookupDepartment?: 'bg' | 'acting';
  requesterId: string;
  requesterName: string;
  notifyUserIds: string[];
  assigneeIds?: string[];
  /** 리테이크 세트 소속(허브 항목 추가). */
  setId?: string | null;
}
```

- [ ] **Step 4: 스토어 `createRevision` — 생성 후 세트 재평가** — `src/stores/useRevisionStore.ts:163-167`

```ts
  createRevision: async (input) => {
    const revision = await revisionService.createRevision(input);
    get().addRevisionOptimistic(revision);
    syncSetForRevision(revision.setId);   // ← 세트 status(open/done) 재평가
    return revision;
  },
```

- [ ] **Step 5: 검증**

Run: `npm run typecheck`
Expected: PASS (서비스 호출이 18인자가 되어 ElectronAPI 타입과 일치)

- [ ] **Step 6: 커밋**

```bash
git add src/services/revisionService.ts src/stores/useRevisionStore.ts
git commit -m "createRevision 전반 분기 + setId 배선 + 생성 후 세트 자동완료 재평가"
```

---

## Chunk 4: `RevisionAddModal` + 허브 헤더 배선

세트 상세 헤더에 `+ 항목 추가` 버튼(누구나) → 모달. 모달은 NewRevisionModal의 파트/씬 캐스케이드 + AddRevisionForm의 이미지/picker를 재사용하고, 에피소드는 세트에 고정(있으면)된다.

**Files:**
- Create: `src/views/retake-hub/RevisionAddModal.tsx`
- Modify: `src/views/RetakeHubView.tsx`

- [ ] **Step 1: 모달 생성** — `src/views/retake-hub/RevisionAddModal.tsx`

```tsx
/**
 * RevisionAddModal — 리테이크 허브 세트 상세 '항목 추가' 모달 (5단계 후속).
 *
 * 누구나 세트에 새 리비전 항목을 만든다. 대상 토글:
 *   - 씬 지정: 에피소드(세트 고정 또는 선택) → 파트 → 씬 → scene_id 채운 항목.
 *   - 전반: 씬 미지정 → scene_id 없는 항목(허브 '전반' 그룹에만 표시).
 * 내용 = EntityAwareInput(@멘션·#씬태그) + 이미지 첨부. 담당/알림 = RevisionRecipientPicker(담당 승격).
 * 생성 = useRevisionStore.createRevision({ sceneKey, setId, ... }) — setId = 현재 세트.
 * 부서(BG/ACT)는 노출하지 않는다. 셸은 허브 모달(RevisionSetCreateModal) 패턴(createPortal + motion).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ClipboardList, ImagePlus, X } from 'lucide-react';
import type { AppUser, CompRevisionSet, Episode, Part, Scene } from '@/types';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { buildSceneKey } from '@/services/revisionService';
import { calcDefaultRecipients } from '@/utils/revisionRecipients';
import { resizeBlob } from '@/utils/imageUtils';
import { stripEntityTokens } from '@/utils/entityTokens';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { RevisionRecipientPicker } from '@/components/scenes/RevisionRecipientPicker';
import {
  buildRevisionPartOptions,
  buildRevisionPartScenesUnion,
  formatRevisionPartId,
  getSourcePartForRevisionScene,
} from '@/views/compositing/newRevisionOptions';

interface Props {
  targetSet: CompRevisionSet;
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  allUsers: AppUser[];
  currentUser: AppUser | null;
  onClose: () => void;
}

type Mode = 'scene' | 'general';

export function RevisionAddModal({ targetSet, episodes, episodeTitles, allUsers, currentUser, onClose }: Props) {
  const createRevision = useRevisionStore((s) => s.createRevision);

  const fixedEpisodeNumber = targetSet.episodeNumber ?? null;
  const [mode, setMode] = useState<Mode>('scene');
  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState<number | null>(fixedEpisodeNumber);
  const [selectedSheetName, setSelectedSheetName] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null);
  const [description, setDescription] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [notifyIds, setNotifyIds] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedEpisode: Episode | null = useMemo(() => {
    if (selectedEpisodeNumber == null) return null;
    return episodes.find((ep) => ep.episodeNumber === selectedEpisodeNumber) ?? null;
  }, [episodes, selectedEpisodeNumber]);

  const partLabels = useMemo(() => buildRevisionPartOptions(selectedEpisode), [selectedEpisode]);

  const selectedPart: Part | null = useMemo(() => {
    if (!selectedEpisode || !selectedSheetName) return null;
    return selectedEpisode.parts.find((p) => p.sheetName === selectedSheetName) ?? null;
  }, [selectedEpisode, selectedSheetName]);

  const selectedPartLabel = selectedPart ? formatRevisionPartId(selectedPart.partId) : '';

  const partScenesUnion = useMemo(
    () => buildRevisionPartScenesUnion(selectedEpisode, selectedPart),
    [selectedEpisode, selectedPart],
  );

  const scenes = useMemo(
    () => partScenesUnion.scenes.slice().sort((a, b) => a.no - b.no),
    [partScenesUnion.scenes],
  );

  const episodeOptions = useMemo(
    () => [...episodes]
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((e) => ({
        num: e.episodeNumber,
        label: episodeTitles[e.episodeNumber] || e.title || `EP.${String(e.episodeNumber).padStart(2, '0')}`,
      })),
    [episodes, episodeTitles],
  );

  const episodeLocked = fixedEpisodeNumber != null;
  const episodeLabel = selectedEpisode
    ? (episodeTitles[selectedEpisode.episodeNumber] || selectedEpisode.title
      || `EP.${String(selectedEpisode.episodeNumber).padStart(2, '0')}`)
    : null;

  const defaultRecipients = useMemo(() => {
    if (!currentUser) return [] as string[];
    return calcDefaultRecipients(
      mode === 'scene' && selectedScene ? { assignee: selectedScene.assignee } : null,
      allUsers,
      currentUser.id,
    );
  }, [mode, selectedScene, allUsers, currentUser]);

  const canSubmit = !!currentUser && description.trim().length > 0 && !submitting
    && (mode === 'general' || !!selectedScene);

  // 에피소드 미고정 + 단일 에피소드면 자동 선택.
  useEffect(() => {
    if (episodeLocked) return;
    if (selectedEpisodeNumber == null && episodes.length === 1) {
      setSelectedEpisodeNumber(episodes[0].episodeNumber);
    }
  }, [episodeLocked, episodes, selectedEpisodeNumber]);

  // ESC → 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleImageFile = async (file: File) => {
    try { setImagePreview(await resizeBlob(file, 800, 0.8)); } catch { /* 무시 */ }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) await handleImageFile(file);
        return;
      }
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || !currentUser) return;
    setSubmitting(true);
    try {
      if (mode === 'scene') {
        if (!selectedPart || !selectedScene) { setSubmitting(false); return; }
        const sourcePart = getSourcePartForRevisionScene(
          partScenesUnion.sourceMap, selectedScene.sceneId, selectedPart,
        );
        const sceneKey = buildSceneKey(sourcePart.sheetName, selectedScene.sceneId, {
          siblingSceneIds: sourcePart.scenes.map((s) => s.sceneId),
        });
        const department = sourcePart.department === 'bg' ? 'bg' : 'acting';
        await createRevision({
          sceneKey,
          setId: targetSet.id,
          description: description.trim(),
          imageUrl: imagePreview || undefined,
          department,
          lookupDepartment: department,
          requesterId: currentUser.id,
          requesterName: currentUser.name,
          notifyUserIds: notifyIds,
          assigneeIds,
        });
      } else {
        await createRevision({
          setId: targetSet.id,
          description: description.trim(),
          imageUrl: imagePreview || undefined,
          requesterId: currentUser.id,
          requesterName: currentUser.name,
          notifyUserIds: notifyIds,
          assigneeIds,
        });
      }
      onClose();
    } catch (err) {
      console.error('[RevisionAddModal] 항목 추가 실패:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-md max-h-[86vh] flex flex-col rounded-2xl border border-bg-border bg-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border/60 shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardList size={18} className="text-accent" />
            <span className="text-[15px] font-bold text-text-primary">세트에 항목 추가</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
            title="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {/* 대상 토글 */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">대상</label>
            <div className="flex bg-bg-primary/60 border border-bg-border/60 rounded-lg p-0.5">
              {([['scene', '씬 지정'], ['general', '전반 (대상 씬 없음)']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 text-[12px] font-semibold py-1.5 rounded-md transition-colors cursor-pointer ${
                    mode === m ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === 'general' && (
              <p className="mt-1.5 text-[11px] text-text-secondary/70">
                특정 씬에 매이지 않고 허브 ‘전반’ 그룹에만 표시됩니다.
              </p>
            )}
          </div>

          {/* 씬 지정 — 에피소드/파트/씬 */}
          {mode === 'scene' && (
            <>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">에피소드</label>
                {episodeLocked ? (
                  <div className="px-3 py-2 text-[13px] bg-bg-primary/50 border border-bg-border/60 rounded-lg text-text-secondary flex items-center gap-2">
                    {episodeLabel ?? '—'}
                    <span className="text-[10px] text-text-secondary/50">세트 고정</span>
                  </div>
                ) : (
                  <select
                    value={selectedEpisodeNumber ?? ''}
                    onChange={(e) => {
                      setSelectedEpisodeNumber(e.target.value === '' ? null : Number(e.target.value));
                      setSelectedSheetName(null);
                      setSelectedScene(null);
                    }}
                    className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary focus:outline-none focus:border-accent/60 cursor-pointer"
                  >
                    <option value="">에피소드 선택</option>
                    {episodeOptions.map((o) => <option key={o.num} value={o.num}>{o.label}</option>)}
                  </select>
                )}
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">파트</label>
                <select
                  value={selectedSheetName ?? ''}
                  disabled={!selectedEpisode}
                  onChange={(e) => { setSelectedSheetName(e.target.value || null); setSelectedScene(null); }}
                  className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary focus:outline-none focus:border-accent/60 cursor-pointer disabled:opacity-40"
                >
                  <option value="">{selectedEpisode ? '파트 선택' : '먼저 에피소드 선택'}</option>
                  {partLabels.map(({ partId, part }) => <option key={partId} value={part.sheetName}>{partId}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">씬</label>
                <select
                  value={selectedScene?.sceneId ?? ''}
                  disabled={!selectedPart}
                  onChange={(e) => setSelectedScene(scenes.find((s) => s.sceneId === e.target.value) ?? null)}
                  className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary focus:outline-none focus:border-accent/60 cursor-pointer disabled:opacity-40"
                >
                  <option value="">{selectedPart ? '씬 선택' : '먼저 파트 선택'}</option>
                  {scenes.map((s) => (
                    <option key={s.sceneId || s.id || s.no} value={s.sceneId}>
                      {selectedPartLabel} {s.no}{s.memo ? ` · ${stripEntityTokens(s.memo).slice(0, 18)}` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* 내용 */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">내용</label>
            <EntityAwareInput
              multiline
              rows={3}
              value={description}
              onChange={setDescription}
              users={allUsers}
              enableHashtag
              onPaste={handlePaste}
              dropdownPositionClassName="left-2 right-2"
              placeholder="수정 내용을 적어주세요. (@이름 멘션, #씬 태그)"
              className="w-full px-3 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-lg text-text-primary placeholder:text-text-secondary/50 resize-y focus:outline-none focus:border-accent/60"
            />
            {imagePreview && (
              <div className="relative w-fit mt-2">
                <img src={imagePreview} alt="첨부 미리보기" className="rounded-lg max-h-24 border border-bg-border/40" />
                <button
                  type="button"
                  onClick={() => setImagePreview(null)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer hover:bg-red-400"
                  title="이미지 제거"
                >
                  <X size={10} />
                </button>
              </div>
            )}
            <label className="inline-flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-lg border border-bg-border/40 cursor-pointer hover:border-accent/40 text-[11px] text-text-secondary transition-colors">
              <ImagePlus size={13} /> 이미지 첨부 · 붙여넣기
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }}
              />
            </label>
          </div>

          {/* 담당·알림 */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1.5 block">담당 · 알림 지정</label>
            {currentUser ? (
              <RevisionRecipientPicker
                allUsers={allUsers}
                defaultCheckedIds={defaultRecipients}
                excludeUserId={currentUser.id}
                onChange={setNotifyIds}
                enableAssignee
                onAssigneesChange={setAssigneeIds}
              />
            ) : (
              <span className="text-[11px] text-text-secondary/50">로그인 정보를 확인할 수 없습니다.</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-bg-border/60 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-1.5 text-xs font-bold rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
          >
            {submitting ? '만드는 중…' : '만들기'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: 허브에 lazy import + 상태** — `src/views/RetakeHubView.tsx`

`:38-40` RevisionImportModal lazy 선언 아래에 추가:
```ts
const RevisionAddModal = lazy(() =>
  import('./retake-hub/RevisionAddModal').then((m) => ({ default: m.RevisionAddModal })),
);
```
`:230` `const [showImport, setShowImport] = useState(false);` 아래에:
```ts
  const [showAdd, setShowAdd] = useState(false);
```

- [ ] **Step 3: `SetDetailHeader`에 버튼 추가** — `src/views/RetakeHubView.tsx:130-175`

`SetDetailHeader` props에 `onAddItem: () => void;` 추가(`onImport: () => void;` 옆, `:144`).
`:166-175` 버튼 묶음에서 가져오기 버튼 **앞에** `+ 항목 추가`(누구나, 게이트 없음, accent 강조):
```tsx
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={onAddItem}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-accent/50 bg-accent/10 text-[11px] font-semibold text-accent hover:bg-accent/20 transition-all cursor-pointer"
            title="이 세트에 새 항목 만들기"
          >
            <Plus size={12} strokeWidth={2.6} />
            항목 추가
          </button>
          <button
            type="button"
            onClick={onImport}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-bg-border/50 text-[11px] font-semibold text-text-secondary/85 hover:text-accent hover:border-accent/40 hover:bg-accent/10 transition-all cursor-pointer"
            title="기존 리테이크를 이 세트로 가져오기"
          >
            <FolderInput size={12} />
            기존 리테이크 가져오기
          </button>
          {/* 세트 삭제 버튼(canManage) 기존 그대로 */}
```
> `Plus` 는 이미 import 됨(`:20`).

- [ ] **Step 4: 헤더 호출 + 모달 렌더** — `src/views/RetakeHubView.tsx:360-368, 417-428`

`<SetDetailHeader ... />` 호출에 `onAddItem={() => setShowAdd(true)}` 추가(`onImport` 옆).
`{showImport && selectedSet && ( … )}` 블록 아래에 추가:
```tsx
      {showAdd && selectedSet && (
        <Suspense fallback={null}>
          <RevisionAddModal
            targetSet={selectedSet}
            episodes={episodes}
            episodeTitles={episodeTitles}
            allUsers={allUsers}
            currentUser={currentUser}
            onClose={() => setShowAdd(false)}
          />
        </Suspense>
      )}
```

- [ ] **Step 5: 검증**

Run: `npm run typecheck && npm run build:vite`
Expected: PASS (typecheck + test:auto-update + test:entity[revisionGeneral 포함] + vite build)

- [ ] **Step 6: 커밋**

```bash
git add src/views/retake-hub/RevisionAddModal.tsx src/views/RetakeHubView.tsx
git commit -m "리테이크 허브 항목 추가 모달(씬 지정/전반·이미지·담당 picker) + 헤더 버튼"
```

---

## Chunk 5: 업데이트 노트 + 통합 검증

**Files:**
- Modify: `DEVLOG/update-notes.json`

- [ ] **Step 1: update-notes 항목 추가** — `DEVLOG/update-notes.json`

최신 버전 항목으로 추가(비개발자 톤 — 식별자/경로/기술용어 금지). 버전은 직전 배포 다음 마이너(예: v1.45.0). 카테고리는 `feature`. 예시 톤:
```json
{
  "version": "1.45.0",
  "date": "2026-06-__",
  "items": [
    {
      "category": "feature",
      "summary": "리테이크 허브에서 항목을 바로 만들 수 있어요",
      "description": "지금까지는 세트에 넣을 리테이크를 먼저 씬 화면에서 만든 뒤 '가져오기'로 옮겨야 했어요. 이제 허브의 세트 안에서 '항목 추가'를 눌러 바로 만들 수 있어요. 에피소드·파트·씬을 골라 그 씬의 리테이크로 만들거나, 특정 씬과 상관없는 '전반' 항목으로도 만들 수 있어요. 내용에는 사진을 붙이고, @로 사람을, #로 씬을 부를 수 있고, 담당도 그 자리에서 정할 수 있어요."
    }
  ]
}
```
> 정확한 파일 구조는 기존 `DEVLOG/update-notes.json` 최신 항목을 보고 동일 형식으로 맞춘다. 버전·날짜는 배포 시점에 확정.

- [ ] **Step 2: 전체 빌드 검증**

Run: `npm run build:vite`
Expected: PASS

- [ ] **Step 3: 커밋**

```bash
git add DEVLOG/update-notes.json
git commit -m "update-notes: 리테이크 허브 항목 추가(v1.45.0)"
```

- [ ] **Step 4: 실제 앱 수동 검증 체크리스트** (preview/Electron 환경 가능 시)

- 세트 상세 헤더 `+ 항목 추가` 노출(컴포지터 아닌 사용자도).
- 전반 항목 생성 → 허브 '전반 (대상 씬 없음)' 그룹에 즉시 표시, 진행률 분모 +1.
- 씬 지정 항목 생성 → 세트 테이블 + **그 씬 상세창 리테이크 탭** 양쪽 노출.
- done 세트에 새 항목 추가 → 세트가 open 으로 재평가(좌측 카드 색/완료뱃지 해제).
- 이미지 붙여넣기/파일 첨부 → 미리보기 → 생성 후 반영.
- 담당 왕관 지정 → 담당 워크플로우 정상(대기→진행중…).
- '다른 사람 추가' 검색으로 팀 전체에서 담당/알림 추가.

> preview MCP가 이 Electron/worktree 환경에서 서버 추적 즉시 끊기면(메모리 기록) 정적 + 코드리뷰로 대체하고, 한솔 실사용 확인을 배포 후 요청.

---

## 검증 / 리뷰 (전 청크 완료 후)

1. `npm run build:vite` 통과(typecheck + test:auto-update + test:entity).
2. **멀티에이전트 적대 코드리뷰**(핵심 생성 경로 — 5차원 find→검증) + **코덱스 리뷰 루프**(`@codex review`, "Didn't find any major issues" 까지).
3. 머지·G드라이브 배포는 **한솔 명시 후**(`bflow-release-deploy`, manifest-last). update-notes 버전/날짜 확정.

## 비목표 / 주의

- 리비전 워크플로우·상태 머신·세트 CRUD·이미지 저장 방식 변경 없음.
- `setId`는 모든 시그니처 마지막 인자(기존 호출처 미전달=null=현행).
- 전반 항목 판정은 **항상** `isGeneralRevisionSceneKey`(`partOf==null`) — `sceneKey===''` 비교 금지(재로드 후 `'::'`).
