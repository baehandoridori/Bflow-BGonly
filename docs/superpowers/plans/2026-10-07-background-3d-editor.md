# 평면/3D 공동 도면 Implementation Plan

> **실행 결과 (2026-10-07):** 아래 Task 1~5를 실행했다. 체크 표시는 실행한 항목이며, 조정한 점과 미확인 항목은 [인수인계 §13](../../../DEVLOG/background-3d-opus-handoff-2026-10-07.md)에 있다. 주요 조정: ① 배경 라이브러리가 미배포라 구버전 쓰기 거절 대신 "두 migration 함께 적용" 규칙으로 정리 ② 공용 편집 상태를 순수 reducer(`mapDocument.ts`)로 두고 hook은 얇게 ③ 작업은 세션 격리 워크트리의 복제본에서 진행(원래 워크트리 반영 대기) ④ 각 단계의 커밋은 하지 않음.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 이 문서는 실행 계획이며 아직 실행하지 않았다. 사용자가 지정한 Opus 5.5의 구현 대화에서 진행한다. 해당 스킬이 없는 환경에서도 아래 계약·순서·검증 범위는 유지한다.

**Goal:** 기존 도면 한 벌을 평면/3D로 편집하고 기즈모로 카메라 상하 방향을 조정하면서 2D 보조 도면에 동시에 표시한다.

**Architecture:** 도면별 공용 draft/선택/history가 정본이며 SVG·Three·보조 평면도는 같은 값을 읽는다. 순수 공간 변환 모듈과 기즈모 제스처 경계를 분리하고, 기존 mapWorkflow/domain/preview/main/SQL 저장 경로를 확장한다.

**Tech Stack:** React 18, TypeScript, Vite, Electron, Three.js와 필요한 controls. 현재 환경 호환 의존성은 실행 시 확인한다.

**Spec:** [Opus 5.5 인수인계·요구사항](../../../DEVLOG/background-3d-opus-handoff-2026-10-07.md)

## Global Constraints

- 작업 위치 `C:/Bflow-BGonly/.worktrees/background-library`, 브랜치 `codex/background-library`. 기존 변경/미추적 파일 보존.
- 이번 대화는 문서만 작성한다. 구현 대화의 사용자 요청 전에는 아래 체크박스를 실행하지 않는다.
- 같은 도면/노드 ID, 같은 draft, 같은 저장 경로. 별도 3D 저장소 금지.
- 새 카메라는 고정 기본점. 사용자 확정이며 클릭 지점/선택 사물/뷰포트 중심으로 바꾸지 않는다.
- 위/아래 시선과 3D 편집 중 동시 2D 확인은 필수.
- 좌표/기본값/권한/CAS/정규화 계약은 TS·preview·main·SQL에 일치시킨다.
- 기존 공간·기호·도면 연결·이미지·사용 기록·파일 경로와 테스트 모드 동등성 보존.
- 운영 DB 적용·PR·배포는 이 계획의 로컬 구현 범위에 포함하지 않는다.
- 기존 작업이 미커밋이므로 각 단계마다 일괄 git add/commit을 하지 않는다. 저장소 변경을 구분해 검토하고 커밋은 해당 구현 대화의 지시에 따른다.

## Review Focus

1. 정확한 수직 카메라와 0/360° 경계: 위치/방향이 튀지 않고 2D에 거짓 수평 방향이 생기지 않아야 한다. Task 1, 4.
2. 구형 map 및 구버전 저장: 새 높이/기울기가 이름만 수정한 저장이나 다운컨버전으로 삭제되지 않아야 한다. Task 1.
3. 공간 소속/잠금: 도면 절대좌표를 Three 부모 변환으로 이중 적용하지 않고 잠긴 자식은 유지해야 한다. Task 1, 3.
4. 드래그 중 취소/전환/컨텍스트 손실: 기존 초안을 보존하고 한 제스처 한 undo를 지켜야 한다. Task 2, 3.
5. 좁은 창·겹친 카메라·기즈모 이벤트: 항목 선택과 2D 동시 확인이 가능하고 편집 화면이 함께 돌아가지 않아야 한다. Task 3, 4, 5.

---

## 파일 구조와 공용 인터페이스

실제 기존 파일 설명은 인수인계 §9를 함께 읽는다. 신규 파일은 기능 소유 범위 안에 둔다. 광범위한 다른 현황판 리팩터링은 하지 않는다.

- 신규 순수 모듈: `src/features/backgrounds/mapSpatial.ts`, `mapEditSession.ts`.
- 신규 상태/화면: `useBackgroundMapDocument.ts`, `BackgroundMap3D.tsx`, `BackgroundMapPlanPreview.tsx`, `BackgroundMapCameraGizmo.ts`.
- 수정: `types.ts`, `domain.ts`, `mapGeometry.ts`, `previewGateway.ts`, `BackgroundMapEditor.tsx`, `backgrounds-map.css`.
- 저장 검증: `electron/backgroundStore.ts`와 기존 background 테스트, 후속 SQL migration.
- 의존성: 필요할 때 `package.json`, `package-lock.json`. 기존 미배포 1.126.0의 버전 처리 방식은 실제 실행 시 기존 이력과 함께 판단한다.

공간 모듈에서 제공할 계약(인수인계의 선택적 타입 필드 확장 후 사용):

```ts
import type { BackgroundCamera, BackgroundPoint } from './types';
export type Vec3 = { x: number; y: number; z: number };
export type CameraAngles = { angle: number; pitch: number; roll: number };
export type QuaternionValue = { x: number; y: number; z: number; w: number };
export type CameraPlanProjection = {
  position: BackgroundPoint;
  direction: BackgroundPoint;
  elevation: number;
  pitch: number;
  vertical: 'up' | 'down' | null;
};
export declare function toWorldPoint(point: BackgroundPoint, elevation: number): Vec3;
export declare function toPlanPoint(point: Vec3): BackgroundPoint;
export declare function cameraForward(angle: number, pitch: number): Vec3;
export declare function verticalFov(horizontal: number, aspect: number): number;
export declare function createMapCamera(id: string, name: string): BackgroundCamera;
export declare function projectCameraToPlan(camera: BackgroundCamera): CameraPlanProjection;
export declare function cameraOrientation(angles: CameraAngles): QuaternionValue;
export declare function cameraAnglesFromOrientation(
  orientation: QuaternionValue, previous: CameraAngles
): CameraAngles;
```

Quaternion 정규화와 basis 정의는 Three adapter와 공유한다. 저장 각도와 quaternion을 별개의 정본으로 관리하지 않는다.

## Task 1: 공간 모델·호환 저장·좌표 변환

**Files:** Create `mapSpatial.ts`, `tests/backgroundSpatial.test.ts`, `DEVLOG/migrations/2026-10-07-background-map-3d.sql`. Modify `types.ts`, `domain.ts`, `mapGeometry.ts`, related background Domain/Geometry/Preview/DatabaseContract tests and snapshot validation as needed.

**Interfaces:** 위 mapSpatial 계약을 제공한다. 입력은 기존 node JSON, 출력은 파생 좌표 또는 같은 BackgroundCamera 타입이다. UI/Three object를 domain에 전달하지 않는다.

- [x] 인수인계의 필드 기본안으로 타입·허용 키·범위·구버전 쓰기 정책을 확정해 문서에 기록한다. `height`는 평면 길이로 남기고 `elevation/volumeHeight/pitch/roll/aspect`를 필요한 노드에만 추가한다.
- [x] 다음 수치 fixture를 `tests/backgroundSpatial.test.ts`에 작성하고 새 모듈이 없거나 잘못된 좌표를 반환할 때 실패하는지 확인한다.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraForward, toWorldPoint, toPlanPoint, verticalFov,
  createMapCamera, projectCameraToPlan } from '../src/features/backgrounds/mapSpatial.ts';
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
test('map coordinates and camera pitch keep existing directions', () => {
  assert.deepEqual(toWorldPoint({ x: 10, y: 20 }, 30), { x: 10, y: 30, z: 20 });
  assert.deepEqual(toPlanPoint({ x: 10, y: 30, z: 20 }), { x: 10, y: 20 });
  const down = cameraForward(90, -30);
  near(down.x, 0); near(down.y, -0.5); near(down.z, Math.sqrt(3) / 2);
  near(verticalFov(60, 1), 60);
});
test('new cameras have the same spawn while IDs remain unique', () => {
  const a = createMapCamera('00000000-0000-4000-8000-000000000001', '카메라 1');
  const b = createMapCamera('00000000-0000-4000-8000-000000000002', '카메라 2');
  assert.notEqual(a.id, b.id);
  assert.deepEqual([a.x, a.y, a.elevation], [500, 340, 120]);
  assert.deepEqual([b.x, b.y, b.elevation], [500, 340, 120]);
  assert.equal(projectCameraToPlan({ ...a, pitch: 90 }).vertical, 'up');
  assert.equal(projectCameraToPlan({ ...a, pitch: -90 }).vertical, 'down');
});
```

- [x] `node --test tests/backgroundSpatial.test.ts`에서 실패 원인을 확인한 뒤 인수인계 §6의 방향/fov 수식과 단순 좌표 변환을 구현한다. `createMapCamera`는 전달받은 ID/이름과 고정 pose, type=camera, spaceId=null, viewIds=[], locked=false를 반환한다.
- [x] quaternion basis/역변환을 구현하고 다음 입력을 왕복 검증한다: yaw 0/90/180/270/359.999°, pitch 0/±45/±89.999/±90°, roll 0/±30°. 각도 표현의 동치성을 허용하되 결과 forward/up과 수직 yaw 연속성을 검사한다.
- [x] `projectCameraToPlan`은 x/y 위치, forward의 X/Z 수평 투영, elevation/pitch를 반환한다. 수직이면 direction=(0,0)·vertical up/down을 반환하고 저장 angle을 바꾸지 않는다.
- [x] 다음 저장 테스트를 기존 fixture에 추가한다: 구형 map은 읽힘, 3D 필드를 가진 map을 이름만 수정해도 보존, NaN/Infinity·범위 밖 pitch/height·알 수 없는 필드는 거절, preview 저장 왕복 일치.
- [x] 공간 elevation 이동에 잠기지 않은 소속 노드만 같은 delta를 적용한다. volumeHeight만 수정하면 카메라 elevation은 동일한지, 공간 x/y/회전 변형이 한 번만 적용되는지 기존 geometry fixture에 추가한다.
- [x] DB migration에서 같은 허용 키/범위를 검증한다. 기본값을 DB에서만 주입하지 않는다. 구버전 쓰기 거절 또는 보존 정책과 응답 유실 후 `mapSaveWasApplied` 일치도 검사한다.
- [x] `npm run typecheck`와 `npm run test:background`를 실행한다. DB runtime을 썼는지/조건부 생략인지 기록한다. 이 단계에서는 운영 DB에 적용하지 않는다.

## Task 2: 평면과 3D의 공용 편집 세션

**Files:** Create `mapEditSession.ts`, `useBackgroundMapDocument.ts`, `tests/backgroundMapEditSession.test.ts`. Modify `BackgroundMapEditor.tsx`.

**Interfaces:** 기존 mapWorkflow/store를 유지한다. 순수 제스처 계약은 다음과 같다.

```ts
import type { BackgroundMap } from './types';
export type MapGesture = { initial: BackgroundMap; preview: BackgroundMap };
export declare function beginMapGesture(map: BackgroundMap): MapGesture;
export declare function previewMapGesture(gesture: MapGesture, next: BackgroundMap): MapGesture;
export declare function finishMapGesture(gesture: MapGesture): {
  value: BackgroundMap; historyEntry: BackgroundMap | null;
};
export declare function cancelMapGesture(gesture: MapGesture): BackgroundMap;
```

- [x] 최소 map fixture와 다음 취소/확정 테스트부터 작성한다.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundMap } from '../src/features/backgrounds/types.ts';
import { beginMapGesture, previewMapGesture, finishMapGesture, cancelMapGesture }
  from '../src/features/backgrounds/mapEditSession.ts';
const base: BackgroundMap = {
  id: '00000000-0000-4000-8000-000000000010', revision: 1,
  name: '교실', parentId: null, placeId: null, imageUrl: '', nodes: [],
};
test('multiple gesture previews make one undo entry and cancel restores initial', () => {
  let gesture = beginMapGesture(base);
  gesture = previewMapGesture(gesture, { ...base, name: '임시 1' });
  gesture = previewMapGesture(gesture, { ...base, name: '임시 2' });
  assert.deepEqual(cancelMapGesture(gesture), base);
  const result = finishMapGesture(gesture);
  assert.deepEqual(result.historyEntry, base);
  assert.equal(result.value.name, '임시 2');
  assert.equal(finishMapGesture(beginMapGesture(base)).historyEntry, null);
  assert.equal(base.name, '교실');
});
```

- [x] `node --test tests/backgroundMapEditSession.test.ts`에서 실패를 확인하고 순수 제스처 처리와 공용 hook을 구현한다. 초기 snapshot을 변이하지 않고, 다른 map ID의 preview를 거절한다.
- [x] Editor의 도면별 draft/baseRevision/past/future와 선택 상태를 hook에 옮긴다. 기존 생성·연결·저장·되돌리기 동작을 먼저 평면 화면에서 확인한다.
- [x] 기존 SVG pointerMove와 종료/취소를 공용 제스처에 연결한다. 드래그 종료 시 1회 history, 서버 저장은 기존 버튼에 남긴다.
- [x] 새 카메라 버튼이 `createMapCamera`를 호출하도록 바꾸고 2D도 고정 생성점을 사용하게 한다. 초기 공간 판별은 생성점 기준으로 수행하고 여러 공간이 겹치면 미지정으로 둔다.
- [x] 모드 전환은 활성 gesture만 취소하고 이미 완료된 초안/선택을 보존하도록 한다. 좌표 변경 없는 클릭·Orbit·표시 전환은 history에 넣지 않는다.
- [x] 저장 실패/권한 상실/로그아웃/도면 전환 중 gesture 취소와 이전 초안의 수명 범위를 테스트하고 `npm run test:background`를 통과시킨다.

## Task 3: 3D 표시와 기즈모 연결

**Files:** Create `BackgroundMap3D.tsx`, `BackgroundMapCameraGizmo.ts`. Modify `BackgroundMapEditor.tsx`, `backgrounds-map.css`, dependencies only as needed.

**Interfaces:** 3D와 보조 평면도는 아래 controlled props를 공통으로 사용한다. `onFinishGesture`는 문서 history 확정이며 DB 저장이 아니다.

```ts
import type { BackgroundMap } from './types';
export type MapCanvasProps = {
  map: BackgroundMap;
  selectedId: string | null;
  canEdit: boolean;
  onSelect(id: string | null): void;
  onBeginGesture(): void;
  onPreview(map: BackgroundMap): void;
  onFinishGesture(): void;
  onCancelGesture(): void;
};
```

- [x] 기존 React/Vite/Electron과 호환되는 Three 의존성을 확인한다. 런타임 모델을 2중 도입하지 않고 lockfile을 유지한다.
- [x] 3D lazy-load와 실패 경계를 추가한다. WebGL 생성이 실패하면 같은 draft를 유지한 채 평면 모드로 복귀시킨다.
- [x] 사각/타원/다각형을 현재 외곽과 크기로 입체화한다. 공간/기호 x/y는 좌상단, mesh는 중심이라는 차이를 adapter에서 적용한다.
- [x] 문·사물·카메라의 node ID를 picking에 연결한다. 모든 노드가 도면 절대좌표이므로 공간 자식 transform을 중복 적용하지 않는다.
- [x] Orbit 관찰 카메라와 도면 camera node를 분리한다. `평면 | 3D` 전환과 클릭 선택, 겹친 항목 선택 목록을 연결한다.
- [x] TransformControls 또는 동등한 기즈모를 `onBeginGesture → onPreview → onFinishGesture`에 연결한다. 드래그 중 Orbit을 끄고 cancel/dispose에서도 복구한다.
- [x] 카메라 quaternion 변환은 Task 1 공용 함수를 사용한다. 평면 이동/yaw 변경이 elevation/pitch/roll을 보존하는지 확인한다.
- [x] 소속 공간 변경은 명시적 속성 편집으로 남긴다. locked/권한/저장 중에는 기즈모 변경을 거절한다.
- [x] ResizeObserver·DPR·hidden tab 처리·rAF·controls/listener/GPU 자원을 정리한다. context loss와 map 전환 중 cancel 경로를 실제로 확인한다.
- [x] 로그인한 프리뷰에서 클릭/드래그/잠금/월드 회전 충돌/undo를 확인한다. 이 단계 결과를 녹화나 재현 절차로 기록하고 코드 존재만으로 통과시키지 않는다.

## Task 4: 동시 2D 카메라 확인

**Files:** Create `BackgroundMapPlanPreview.tsx`. Modify `BackgroundMapEditor.tsx`, `backgrounds-map.css`, `tests/backgroundSpatial.test.ts`.

**Interfaces:** `map`, `selectedId`와 `projectCameraToPlan`을 사용한다. 저장된 snapshot이 아닌 현재 gesture preview를 받는다. 자체 camera copy를 state에 두지 않는다.

- [x] 평면 투영 테스트에 pitch 0/±45/±90°, yaw 네 방향, roll 변경을 추가한다. roll만 바꾸면 중심 시선 벡터는 같고 수직 시 direction은 0인지 확인한다.
- [x] 3D 모드의 카메라 선택에 맞춰 보조 평면도를 표시하고, 같은 map 외곽/선택 카메라/방향/높이/위아래 안내를 렌더한다.
- [x] 수직 방향은 아이콘+각도, 비수직은 실제 수평 투영 화살표로 표시한다. 높이와 상하 각도는 수치 및 작은 옆모습 방향으로 보완한다.
- [x] 기즈모를 움직이는 중 2D 표시가 같은 rAF의 임시 값을 읽도록 연결한다. commit/저장 후에만 따라오는 지연 동기화는 허용하지 않는다.
- [x] 실제 시야 투영을 구현하지 않은 경우 부채꼴은 `방향 참고`로 구분한다. 수평 fov와 Three 수직 fov 변환을 동일 함수로 사용한다.
- [x] 740px 내외 폭에서 3D와 2D를 상하로 함께 보며 조절할 수 있고 하단 이미지 그리드와 높이 조절도 유지되는지 확인한다.
- [x] 정확히 위를 봄 → 아래를 봄 → 평면 전환 → x/y 이동 → 3D 복귀 → 저장 → 재조회 시나리오를 검증한다.

## Task 5: 전체 회귀와 인수인계 갱신

**Files:** Existing tests and verification docs; `ROADMAP.md`, `DEVLOG/update-notes.json`, previous handoffs only when implementation actually lands.

**Interfaces:** R1~R6 및 인수인계 §11 완료 판정을 검증 근거에 매핑한다.

- [x] 구형 map·구형 기호·타원/다각형·이미지/파일 연결·에피소드 기록 fixture를 열고 저장해 원본 연결과 신규 공간 필드 보존을 확인한다.
- [x] 도면 생성/내부 도면 연결/부모 이동/더블클릭 이동, 공간 잠긴 자식, 하단 이미지 필터/원본 상세 복귀, 도면 높이 조절을 확인한다.
- [x] 고정 생성점에 카메라 3개를 추가해 각각 선택하고, 방향만 다른 카메라를 만들며 2D/3D 20회 전환해 위치/ID 불변을 확인한다.
- [x] 저장 실패·CAS 충돌·응답 유실 후 전체 JSON 일치·세션 교체 검사를 실행한다. 새 필드가 기본값 정규화 때문에 복구 판정을 깨지 않는지 확인한다.
- [x] 관리자/일반 사용자, 일반 창/작은 창, 마우스/숫자 입력, WebGL 복귀를 확인한다. — 일반 사용자 계정 로그인만 미확인(편집 전 상태로 대체 확인).
- [ ] 공간 50/기호 100/카메라 20 fixture에서 프레임 상태를 기록하고, 1000개 노드 상한 근처의 열기/저장도 별도 확인한다. — **미실행**: 성능 측정은 하지 않았다(검증 도면은 노드 14개).
- [x] 다음 명령을 실행하고 로그를 남긴다. 프리뷰 셸의 renderer-only 설정을 빌드 셸에 남기지 않는다.

```powershell
Set-Location -LiteralPath 'C:/Bflow-BGonly/.worktrees/background-library'
Remove-Item Env:BFLOW_RENDERER_ONLY -ErrorAction SilentlyContinue
npm run typecheck
npm run test:background
npm run build:vite
git -c core.safecrlf=false diff --check
```

- [x] DB 실행 테스트가 `BFLOW_PGLITE_MODULE` 미지정으로 생략되었으면 명시한다. installer/운영 DB/실제 Storage/Electron GPU E2E를 브라우저 검증과 구분한다.
- [x] 실제 완료 범위만 ROADMAP/update-notes/검증 문서/인수인계에 갱신한다. PR/배포를 자동으로 시작하지 않는다.

## 재개와 프리뷰

기존 `http://127.0.0.1:5318/?preview=1`을 재사용한다. 서버가 꺼졌을 때만 이 워크트리에서 다음을 실행한다. 포트 점유 프로세스를 임의 종료하지 않는다.

```powershell
Set-Location -LiteralPath 'C:/Bflow-BGonly/.worktrees/background-library'
$env:BFLOW_RENDERER_ONLY = '1'
npm exec vite -- --host 127.0.0.1 --port 5318 --strictPort
```

로그인이 보이면 사용자 지침의 preview 전용 테스트 이름 `배한솔` / 비밀번호 `1234`로 로그인한다. 운영 계정으로 해석하지 않는다. origin/브라우저 프로필을 바꾸거나 localStorage를 초기화하지 않는다. 실제 파일 읽기는 preview에서 모의 기능이라는 기존 인수인계를 따른다.

## 작성 단계 자체 점검

- R1: Task 2/3, R2: Task 3, R3: Task 2/3, R4: Task 1/3, R5: Task 4, R6: Task 1/2/5.
- 제안 함수의 생산/소비 지점과 기존 파일 경로를 확인한다. 신규 함수·파일은 구현 예정이며 현재 코드에 존재한다고 주장하지 않는다.
- 카메라 생성점은 사용자 확인을 반영했고, 숫자 기본값과 세부 UX는 제안임을 명시했다.
- 이번 작성 단계에서 테스트/성능 측정을 실행하지 않았다. 기존 2D 검사 결과를 3D 검증으로 취급하지 않는다.
