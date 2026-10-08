# 평면/3D 공동 도면 — Opus 5.5 구현 인수인계

작성일: 2026-10-07 (Asia/Seoul)
상태: **구현 및 로컬 검증 완료 (2026-10-07, 미커밋·미배포)** — 결과는 §13. 아래 §1~§12는 구현 전에 쓴 요구사항·제안이며 그대로 보존한다.

이 문서는 사용자가 지정한 Opus 5.5가 배경 라이브러리 후속 기능을 구현할 때 읽는 인수인계다. 이번 요청은 문서 작성까지만이다. 구현·의존성 설치·DB 적용·버전 변경·커밋·PR·배포를 실행하지 않았다. 아래 예제와 체크리스트는 실행 결과가 아니다. 다음 구현 대화에서 사용자의 실행 요청을 받고 진행한다.

- 워크트리: `C:/Bflow-BGonly/.worktrees/background-library`
- 브랜치: `codex/background-library`
- 작성 시 HEAD: `e6c7e0e4a53855d8d75d5d71908681e04f7e3de8`
- 패키지: 1.126.0, 기존 배경 구현은 미커밋·미배포.
- 기존 상태: [2026-10-06 인수인계](background-library-handoff-2026-10-06.md)
- 실행 순서: [평면/3D 구현 계획](../docs/superpowers/plans/2026-10-07-background-3d-editor.md)
- 상위 checkout과 이 워크트리의 미추적 파일을 보존한다. `git clean/reset --hard`나 일괄 원상복구를 하지 않는다.

## 1. 사용자 확정 요구

| ID | 확정 내용 |
|---|---|
| R1 | **평면 / 3D 전환**을 붙이고, 두 모드에서 같은 배치를 보고 편집한다. |
| R2 | 월드에 네모난 박스로 구역을 배치하고 회전·이동·확대해서 본다. |
| R3 | 사물·카메라를 클릭해 선택한 뒤 **기즈모로 이동·회전**한다. 기존 크기 편집도 유지한다. |
| R4 | 위에서 아래, 아래에서 위를 보는 구도가 있으므로 카메라 **높이와 상하 방향**을 조절한다. |
| R5 | 3D에서 카메라 방향을 정하는 동안 **2D 도면에서도 동시에 확인**한다. 전환 버튼만 있으면 미충족이다. |
| R6 | 새 카메라는 **정해진 기본 위치에서 생성**한다. 클릭 지점·선택 사물·화면 중심에 따라 달라지지 않는다. |
| R7 | 구현 담당은 사용자 지정 **Opus 5.5**이며 이번 요청은 인수인계 문서 작성이다. |

R6 확인 기록: “새 카메라를 만들 때마다 도면의 정해진 기본 위치에서 시작한다는 뜻인가요?” → 사용자 답변 **“정해진 기본 위치에서 생성”**.

이하의 구체적인 기본 좌표·높이·축 제한·파일 분리·단축키·성능 목표는 작성자의 권장 구현안이다. 사용자 확정 요구와 구분한다. 구현자가 다른 방법을 선택해도 R1~R6과 기존 데이터 보존은 충족해야 한다.

## 2. 기대 사용 흐름

1. 기존 교실 도면을 열고 `3D`를 누르면 같은 도면 ID·공간·사물·카메라가 입체로 보인다. 별도 복사본을 만들지 않는다.
2. 월드를 돌려 살펴본다. 화면 보기만 바뀌고 배치의 저장 상태는 바뀌지 않는다.
3. `도면 편집` 상태에서 `카메라 추가`를 누르면 정해진 기본점에 새 카메라가 생기고 선택된다.
4. 기즈모로 카메라 위치와 높이를 바꾼 뒤 아래를 보도록 회전한다.
5. 보조 평면도에서 같은 카메라의 위치·수평 방향과 `아래 35° · 높이 120` 안내가 저장 전부터 함께 움직인다.
6. `평면`으로 돌아와 위치를 수정해도 높이·상하 방향은 유지된다.
7. undo/redo, 저장, 재조회 후 두 모드에서 같은 배치와 연결 이미지를 확인한다.

## 3. 범위와 기존 기능 보존

반드시 포함: 현재 도면 하나의 두 표시 모드, 공유 선택/초안/잠금/undo/redo, 박스 공간과 기존 5종 사물 기호의 간단한 입체 표시, 카메라 상하 방향과 2D 동시 확인.

- 기존 타원·다각형 공간도 외곽을 보존해 입체화한다. 다각형 points는 공간 내부 0~1 정규화 좌표다.
- 문·의자·테이블·침대·기타 사물의 5종 팔레트를 유지한다. 구형 책상/소파 등은 기존 호환 표시를 따른다.
- 도면 트리, 공간 더블클릭 상세 이동, 밑그림, 하단 이미지 그리드, 도면 높이 조절, 파일 연결, 시점 묶음, 에피소드별 배경은 유지한다.
- 같은 배경/변형/에피소드 ID를 사용한다. 카메라를 돌렸다고 `visiblePlaceIds`나 연결 배경을 자동 변경하지 않는다.
- 여러 도면을 물리적으로 이어진 건물 전체로 합치는 것은 이번 범위에 자동 추가하지 않는다. 부모/자식 도면에는 층 높이·건물 간 거리 정보가 없다.
- 사실적 모델링, 외부 모델 가져오기, 물리/보행 게임, 이미지를 자동 3D 변환, 파일 감시/폴더 스캔, 운영 배포는 포함하지 않는다.

## 4. 화면과 기즈모

### 배치와 선택

- 기존 도면 도구 옆에 `평면 | 3D` 전환을 둔다. 선택과 현재 도면 ID는 공유하고, 각 모드의 확대·보기 위치는 UI 상태로 분리한다.
- 3D는 기존 점 그리드를 되살리지 않고 바닥·외곽선·옅은 공간 면으로 읽기 쉽게 구성한다. 천장을 열거나 단면 표시로 내부 사물을 볼 수 있게 한다.
- 불투명 구역 박스가 내부 사물의 클릭을 모두 가로채지 않도록 실제 선택 동작을 확인한다.
- 단일 클릭은 선택만 한다. 기존 `도면 편집` 진입 후 기즈모를 제공한다. 일반 사용자·잠긴 노드·저장 중에는 변형 금지.
- 권장 조작: 왼쪽 클릭 선택/기즈모, 오른쪽 드래그 월드 회전, 가운데 드래그 화면 이동, 휠 확대. 기즈모 조작 중 Orbit 조작을 중단하고 종료/취소 후 복원한다.
- 이동/회전/크기 버튼과 숫자 입력을 제공한다. 단축키만으로 기능을 숨기지 않고 입력창 작성 중에는 도면 단축키를 실행하지 않는다.
- 권장 축 정책: 구역 공간은 수직을 유지하며 위치·바닥 크기·입체 높이·수평 회전을 편집한다. 사물은 3축 이동/회전 및 크기, 카메라는 3축 이동/회전을 지원한다. 카메라 몸체 크기로 화각을 변경하지 않는다.
- 여러 카메라가 같은 기본점에 겹치므로 새 카메라 자동 선택과 오브젝트 목록으로 각각 고를 수 있게 한다. 겹침 해소를 이유로 자동 위치 오프셋을 넣지 않는다.

### 두 종류의 카메라

- **월드를 보는 편집 화면용 카메라**는 로컬 UI 상태다. Orbit/확대는 배치 수정·undo·서버 저장을 발생시키지 않는다.
- **도면 안의 배경 구도용 카메라**는 저장 노드다. 클릭 선택만으로 편집 화면을 그 시점으로 점프시키지 않는다.
- `이 카메라로 보기`는 선택적 부가 기능이다. 넣는다면 명시적인 버튼과 복귀를 제공하고, 배치한 박스/사물의 구도 미리보기임을 유지한다.

## 5. 카메라 생성과 동시 2D 확인

### 기본 생성점

현재 기본 SVG 범위 1000×680을 고려한 초기 제안이다. 도면 단위이며 실제 미터가 아니다.

```ts
export const DEFAULT_MAP_CAMERA_POSE = {
  x: 500, y: 340, elevation: 120,
  angle: 0, pitch: 0, roll: 0, fov: 60, aspect: 16 / 9,
} as const;
```

- 같은 도면에서 여러 번 생성하면 위치가 같다. 2D/3D, 줌/패닝, 현재 선택에 영향을 받지 않는다.
- 현재 구현은 카메라 도구를 선택한 뒤 SVG 클릭 지점에 생성한다. 이번 기본안은 `카메라 추가` 버튼 한 번으로 생성하며 후속 클릭을 요구하지 않는다.
- 새 ID와 식별 가능한 이름을 부여하고 즉시 선택한다. 기존 저장 카메라를 기본점으로 옮기지 않는다.
- 기본점이 화면 밖이면 오브젝트 위치 대신 보기 화면을 새 카메라로 맞춘다.
- 생성점에 공간이 하나 있으면 기존 방식으로 소속을 정할 수 있다. 여러 공간이 겹치면 임의 선택하지 않고 공간 미지정으로 두어 속성에서 연결한다.

### 동시 평면도

- 3D에서 카메라 선택 시 작은 평면도를 표시한다. 카메라 편집 중에는 이 화면을 쉽게 볼 수 있어야 한다.
- 같은 도면 외곽, 선택 카메라 위치, 수평 방향, 위/아래 각도, 높이, 선택 강조를 표시한다.
- 좁은 창에서는 상하 배치를 허용한다. 3D와 2D를 동시에 볼 수 있어야 하고 아래 이미지 그리드를 없애지 않는다.
- 드래그 중인 동일한 임시 배치를 읽는다. 저장 버튼을 눌러야 동기화되는 방식은 불가.
- 보조 평면도는 첫 버전에 선택/확인 중심으로 구현해도 된다. 메인 평면 모드의 기존 편집은 유지한다.
- 권장 표시: 수평 투영 화살표와 `위 30°`, `아래 45°`, `수직 위`, `수직 아래` 안내, 작은 옆모습 방향 표시.
- **정확히 수직일 때** 수평 방향 벡터 길이는 0이다. 임의의 긴 수평 화살표 대신 수직 아이콘과 각도를 표시하고, 편집 연속성을 위해 저장된 yaw는 보존한다.
- 3D에 방향선과 시야 테두리를 표시한다. 2D의 시야 표시가 실제 바닥 교차 영역인지 방향 참고인지 구분한다. 수평 부채꼴을 실제 바닥 가시 영역인 것처럼 표시하지 않는다.

## 6. 좌표·각도·저장 데이터 제안

현재 근거: `src/features/backgrounds/types.ts`, `mapGeometry.ts`, `BackgroundMapEditor.tsx`.

| 현재 값 | 의미 / 변환 |
|---|---|
| 카메라 x/y | 직접 위치점. world X/Z로 매핑 |
| 공간·기호 x/y | 회전 전 사각 범위 좌상단. mesh 중심 X/Z는 x+width/2, y+height/2 |
| width/height | 바닥의 두 길이. **height를 3D 수직 높이로 재사용 금지** |
| rotation/angle | 도 단위. 0°=오른쪽, +90°=아래. 이 방향을 유지 |
| 새 elevation | world Y. 공간/기호는 바닥면 높이, 카메라는 렌즈 높이 |
| 새 volumeHeight | 공간/기호 입체 높이. mesh 중심 Y=elevation+volumeHeight/2 |

- 기존 x/y/width/height/rotation/angle을 정본으로 유지하고 공통 `elevation?`, 공간/기호 `volumeHeight?`, 카메라/기호 `pitch?`·`roll?`, 카메라 `aspect?`를 추가하는 안을 권장한다.
- 구형 기본값 제안: 공간/기호 elevation=0, 공간 volumeHeight=180, 기호 volumeHeight=80, 카메라 elevation=120, pitch/roll=0, aspect=16/9. 기호별 높이를 조정할 경우 공용 상수 한 곳에서 정의한다.
- 사물의 width/height는 기울기 전 로컬 크기다. 기울어진 사물의 평면 외곽은 3D 꼭짓점을 투영한다. 투영된 축 정렬 박스 크기를 원래 width/height에 덮어쓰지 않는다.
- 제안 범위: elevation -100000~100000, volumeHeight 1~100000, pitch -90~90°, roll -180~180°, aspect 0.1~10. 기존 검증 범위도 유지한다.
- Three Mesh/Vector/Quaternion/Object3D 자체를 저장하지 않는다. JSON 값만 저장하고 renderer 표현은 순수 adapter에서 만든다.
- 별도 3D nodes 배열이나 별도 localStorage 정본을 만들지 않는다.

카메라 시선 기준은 다음과 같다. +pitch는 위, -pitch는 아래다.

```ts
export type Vec3 = { x: number; y: number; z: number };
export function cameraForward(angle: number, pitch: number): Vec3 {
  const yaw = angle * Math.PI / 180;
  const tilt = pitch * Math.PI / 180;
  return {
    x: Math.cos(tilt) * Math.cos(yaw),
    y: Math.sin(tilt),
    z: Math.cos(tilt) * Math.sin(yaw),
  };
}
export function verticalFov(horizontal: number, aspect: number): number {
  return 2 * Math.atan(Math.tan(horizontal * Math.PI / 360) / aspect)
    * 180 / Math.PI;
}
```

- 예: angle=90, pitch=-30 → X≈0, Y=-0.5, Z≈0.866. roll은 시선 축 주위 기울기로 방향 자체를 바꾸지 않는다.
- Three 카메라 기본 -Z와 현재 angle=0의 +X는 다르다. basis/quaternion 변환 및 역변환을 한 곳에서 처리한다.
- 수직 방향의 역변환에서는 이전 yaw를 기준으로 roll을 구해 각도가 튀지 않게 한다. ±90°·±89.999°와 0/360° 경계를 검증한다.
- +Y 축 양의 회전과 SVG 시계방향을 그대로 동일시하면 좌우가 뒤집힐 수 있다. 네 방향 fixture로 확인한다.
- 기존 fov는 평면의 수평 화각으로 해석한다. PerspectiveCamera의 수직 fov와 aspect를 변환하며 두 화면의 시야가 일치하도록 한다.
- 구형 값의 기본값은 가능하면 읽기 파생값으로 두고 보기만으로 데이터를 쓰지 않는다. 저장 정규화가 필요하면 renderer/domain/preview/DB가 동일한 정규화 결과를 사용해야 한다.

## 7. 공유 편집 상태와 저장 경계

- 현재 Editor에 도면별 `{value, baseRevision, past, future}` 초안과 선택 상태가 있다. 이를 공용 controller로 분리해 기존 SVG·3D·보조 평면도가 같은 current를 읽게 한다.
- 제스처 시작 → 초기 map 보관 → 임시 map 갱신 → 종료 시 history 한 번. Escape/포인터 취소/캡처 상실은 초기 map으로 복귀.
- 저장은 기존 명시적 저장 버튼과 `mapWorkflow.ts`를 사용한다. 프레임마다 서버에 저장하거나 별도의 3D 저장 API를 만들지 않는다.
- 전환 중 제스처는 취소하고, 이전에 완료한 편집 초안은 유지한다. GPU renderer 수명과 문서 초안 수명을 분리한다.
- **spaceId는 로컬좌표 부모가 아니라 소속 관계다.** 모든 노드는 도면 절대좌표이며 `transformMapSpace`가 이미 소속 노드를 이동시킨다. Three 부모 transform으로 또 이동시키지 않는다.
- 공간의 바닥 이동·회전·가로세로 크기 변경은 기존 소속 노드 동반 변형을 유지한다. elevation 변경은 잠기지 않은 소속 노드에 같은 높이 차이를 적용하는 기본안을 권장한다.
- volumeHeight만 바꾸면 소속 카메라 높이/기울기를 자동 비례 변경하지 않는다.
- 잠긴 자식은 부모 공간 변형에도 제자리에 남는다. 공간 삭제 시 자식은 남기고 spaceId만 해제한다.
- 사물을 다른 공간으로 드래그했다고 소속을 자동 변경하지 않는다. 기존 명시 연결을 유지한다.
- parentId/childMapId는 탐색 관계이며 기하학적 부모 transform이 아니다.
- 실패·충돌 시 초안을 보존한다. 관리자·canonical 세션·epoch·CAS·requestId 멱등·삭제 ID 보호는 기존 계약을 유지한다.

## 8. 저장 호환성과 migration

domain의 `onlyKeys`와 SQL `background_library_object`는 모르는 필드를 거부한다. renderer/타입만 확장하면 main/DB에서 실패한다. TS/domain/preview/main snapshot 검증/SQL 허용 키와 범위를 함께 맞춘다.

- 구버전 앱은 새 필드가 든 map 때문에 전체 라이브러리 검증이 실패할 수 있다.
- 읽을 때 새 필드만 제거하면 구버전이 map JSON 전체를 저장하며 3D 값을 삭제할 수 있다. 이런 다운컨버전만으로 호환을 해결하지 않는다.
- 기본 정책 제안: 새 앱은 구형 도면을 읽고, 3D 정보를 가진 도면은 구버전 편집을 명확히 거절한다. 최소 지원 버전/capability와 서버 거절 방법을 구현 단계에서 정하고 테스트한다. UI 버전 배지로 서버 검증을 대신하지 않는다.
- **revision은 스키마 버전이 아니다.** 도면 revision을 스키마 판별값으로 쓰지 않는다.
- `mapSaveWasApplied`는 응답 유실 복구 시 요청한 map 전체와 정확한 다음 revision을 비교한다. DB에서만 기본값을 추가하거나 각도를 정규화하면 복구 판단이 어긋난다.
- 후속 migration 제안 경로: `DEVLOG/migrations/2026-10-07-background-map-3d.sql`. 기본 migration 다음에 적용하는 로컬 계약 테스트를 준비한다.
- 운영 적용 상태는 재개 시 재확인한다. 10/06 기록은 운영 미적용이지만 영구적인 사실로 가정하지 않는다. 문서/로컬 구현만으로 운영 적용·배포까지 실행하지 않는다.

## 9. 파일 책임 제안

아래 신규 파일은 제안이며 아직 생성하지 않았다.

| 파일 | 책임 |
|---|---|
| `src/features/backgrounds/mapSpatial.ts` | 좌표·각도·fov·기본 pose·생성·투영 순수 계산 |
| `src/features/backgrounds/mapEditSession.ts` | 제스처 시작/갱신/확정/취소, history 단위 |
| `src/features/backgrounds/useBackgroundMapDocument.ts` | 기존 도면별 draft/선택/이력 공용 controller |
| `src/features/backgrounds/BackgroundMap3D.tsx` | Three scene, Orbit/기즈모, renderer 자원 수명 |
| `src/features/backgrounds/BackgroundMapPlanPreview.tsx` | 동일 초안의 평면 보조 표시와 상하 안내 |
| `src/features/backgrounds/BackgroundMapCameraGizmo.ts` | 카메라 회전 변환·축별 제어 |
| 기존 `BackgroundMapEditor.tsx` | 전환 버튼·공통 편집 도구, 기존 SVG 재사용 |
| 기존 `mapGeometry.ts` | 공간과 소속 노드 수평/높이 변형·잠금 |
| 기존 `types.ts`, `domain.ts`, `previewGateway.ts` | 직렬화·검증·저장 동등성 |
| 기존 `backgrounds-map.css` | 모드 전환·보조 평면도·작은 창 |
| 신규 `tests/backgroundSpatial.test.ts`, `backgroundMapEditSession.test.ts` | 변환·생성점·history·취소 |
| 기존 Background Domain/Preview/Geometry/DatabaseContract 테스트 | 저장·권한·충돌·구형 데이터 회귀 |

Three를 React 화면에 직접 연결하거나 React 래퍼를 사용하는 것은 구현 담당자 선택이다. React 18/Vite/Electron 호환 버전을 실제 확인해 잠그고 불필요하게 렌더러 두 종류를 도입하지 않는다.

## 10. 성능·접근성·실패 처리

- 기본 재질과 단순 도형, 그림자/후처리 기본 off. 정지 시 불필요한 렌더링 중단.
- 기즈모 중 동일 임시 상태를 rAF 단위로 두 화면에 전달한다. 전체 라이브러리 React tree와 서버를 매 프레임 갱신하지 않는다.
- 도면 변경/unmount 시 controls, observer, listener, animation loop, geometry, material, texture를 정리한다. 다른 숨겨진 탭에서 GPU를 계속 사용하지 않는다.
- WebGL 초기화 실패/context loss 때 평면 모드 복귀와 초안 보존을 제공한다.
- 키보드 선택·숫자 입력도 제공하고 상하 방향을 색만으로 구분하지 않는다.
- 성능 fixture 제안: 공간 50개 + 기호 100개 + 카메라 20개, 단순 재질. 개발 PC의 GPU/화면 크기/DPR와 frame time을 기록한다. 모든 PC에서 60fps를 보장한다고 쓰지 않는다.
- 현재 1000개 노드 계약 상한 근처에서도 열기/저장/기본 탐색 실패 여부를 별도로 확인한다.

## 11. 완료 판정

- [ ] R1: 모드 20회 전환 후 도면/노드 ID·연결·좌표·높이·기울기 보존. 보기 전환 자체는 dirty/저장 요청을 만들지 않음.
- [ ] R2: 기존 사각/타원/다각형과 5종 기호가 표시되고 월드 회전·확대·이동 가능.
- [ ] R3: 클릭 선택 → 기즈모 → 숫자 확인 → undo/redo 가능. 한 드래그는 undo 한 번, 월드 동반 회전 없음.
- [ ] R4: 위/아래 45° 및 정확한 ±90° 카메라 편집·저장·재조회 유지.
- [ ] R5: 3D 조작 중 2D 보조 도면의 위치·방향·상하 표시가 저장 전부터 동기화.
- [ ] R6: 서로 다른 보기/줌/선택에서 카메라 3개 생성 시 같은 기본점·서로 다른 ID·각각 선택 가능.
- [ ] 평면 위치/yaw 수정과 이름만 수정 후 저장에서도 elevation/pitch/roll 보존.
- [ ] 수직 시 거짓 수평 화살표 없음, 다시 기울일 때 방향 튐 없음.
- [ ] 공간 변형 시 소속 노드 이중 이동 없음·잠금 유지·높이 규칙 준수·삭제 시 연결만 해제.
- [ ] 제스처 취소, 저장 실패, 응답 유실, CAS 충돌, 재로그인, WebGL 실패 시 데이터/초안 보존.
- [ ] 기존 도면 연결·더블클릭·그리드·높이 조절·파일 연결·에피소드 화면 회귀 없음.
- [ ] 관리자/일반 사용자, preview/실제 앱 계약, 구형 자료 읽기·구버전 쓰기 정책 검증.
- [ ] typecheck + 관련 테스트 + build:vite 통과. 조건부 DB 생략은 통과와 구분.
- [ ] 로그인 후 프리뷰 일반/작은 창 검증. Electron GPU/파일 E2E 여부는 별도 보고.

## 12. 기존 검증과 참고 자료

[누적 검증 기록](background-library-verification-2026-09-21.md)의 2026-10-06 결과는 기존 2D 기능의 기준선이다. 새 3D 기능의 테스트 통과로 인용하지 않는다.

2026-10-07 확인한 공식 자료:
- [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html): 월드 회전/확대/이동과 관성.
- [TransformControls](https://threejs.org/docs/pages/TransformControls.html): 이동/회전/크기, local/world 축.
- [PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html): 수직 fov와 aspect.

### 다음 구현 대화에 전달할 문장

> Opus 5.5로 `C:/Bflow-BGonly/.worktrees/background-library`의 `DEVLOG/background-3d-opus-handoff-2026-10-07.md`와 연결된 구현 계획을 읽고 평면/3D 공동 도면을 구현해 주세요. 기존 미커밋 파일과 사용자 자료를 보존하세요. 같은 배치·선택·초안을 공유하고, 새 카메라는 정해진 같은 기본 위치에 생성하며, 사물/카메라는 클릭 후 기즈모로 이동·회전하게 해 주세요. 카메라 상하 방향을 3D에서 조정하는 동안 2D 보조 도면에서도 동시에 확인해야 합니다. 기존 저장·권한·실패 복구를 유지하고 로컬 검증까지 진행하세요. 운영 DB 적용·PR·배포는 포함하지 않습니다.

## 13. 구현 결과 (2026-10-07, Opus 5.5)

§1~§12의 체크리스트와 "미구현" 표현은 작성 당시 기준이다. 실제 구현·검증 상태는 이 절과 [누적 검증 기록](background-library-verification-2026-09-21.md)의 2026-10-07 절이 기준이다.

### 13.1 작업 위치 — 먼저 읽을 것

- 구현은 **세션 전용 격리 워크트리** `C:/Bflow-BGonly/.claude/worktrees/background-library-2d-3d-editor-a0ed8c`(브랜치 `claude/background-library-2d-3d-editor-a0ed8c`)에 있다. 이 세션은 세션 폴더 밖 파일을 편집하지 못하게 막혀 있어, 원래 워크트리(`C:/Bflow-BGonly/.worktrees/background-library`, HEAD e6c7e0e4)의 미커밋·미추적 파일 69개를 해시 일치로 복제한 뒤 그 위에서 작업했다. 브랜치도 같은 커밋(e6c7e0e4)에 맞췄다.
- 원래 워크트리의 기존 구현은 그대로다. 예외는 하나: 막히기 직전에 `three`·`@types/three` 설치가 원래 워크트리에도 들어갔다(package.json, package-lock.json, node_modules). 코드에서 쓰지 않으므로 동작 영향은 없다.
- **원래 워크트리로 옮기는 일은 아직 하지 않았다.** 옮길 대상은 13.4의 새 파일과 바뀐 파일이며 `.claude/launch.json`(프리뷰 실행 설정 한 항목 추가)은 옮기지 않아도 된다.
- 커밋·푸시·PR·운영 DB 적용·배포는 하지 않았다.

### 13.2 요구사항별 결과

| ID | 결과 |
|---|---|
| R1 | 도면 도구줄의 `평면 / 3D` 전환. 평면 SVG·3D 화면·보조 평면도가 초안 하나(`mapDocument.ts`)를 읽는다. 전환만으로는 저장소·초안이 바뀌지 않고 선택·되돌리기 기록이 유지된다. |
| R2 | three.js로 공간을 천장 없는 반투명 상자로 표시(사각·타원·다각형 외곽 유지), 5종 기호의 간단한 입체, 카메라와 시야 틀. 오른쪽 드래그 회전·가운데 드래그 이동·휠 확대, `둘러보기` 도구에서는 왼쪽 드래그 회전. |
| R3 | 클릭 선택 후 기즈모로 이동·회전·크기, 속성 패널 숫자 입력. 기즈모 조작 중 세계는 돌지 않는다. 잠금·편집 권한·되돌리기 유지, 드래그 한 번 = 되돌리기 한 단계, Esc·포인터 취소는 기록 없이 원위치. |
| R4 | `카메라 추가` 버튼은 항상 (500, 340, 높이 120)에 만든다(`addMapCamera`). 클릭 위치·선택·확대·모드와 무관. 생성 직후 선택, 화면 밖이면 보기만 옮긴다. 겹친 카메라는 오브젝트 목록과 반복 클릭으로 하나씩 고른다. 기존 카메라는 그대로. |
| R5 | 카메라 높이(`elevation`)와 위아래 각도(`pitch`, -90~90, +가 위), 기울기(`roll`), 화면 비율(`aspect`). 수평/수직 위/수직 아래 버튼. 평면에서 옮기거나 돌려도 높이·각도는 그대로다. |
| R6 | 3D 모드에서는 보조 평면도가 항상 함께 보인다. 기즈모를 끄는 도중(저장 전)에도 위치·방향·위아래 각도·높이가 같이 갱신된다. 수직일 때는 수평 화살표 대신 ⊙(위)/⊗(아래) 표시와 점선(기울일 때 방향). 좁은 창에서는 좌우 또는 위아래로 함께 보인다. |

### 13.3 확정한 결정 (§4~§10의 제안 중 채택한 것과 바꾼 것)

- **필드**: 공간 `elevation?`·`volumeHeight?`, 카메라 `elevation?`·`pitch?`·`roll?`·`aspect?`, 기호 `elevation?`·`volumeHeight?`·`pitch?`·`roll?`. 모두 선택 필드이고 `height`는 평면 세로 길이 그대로다. 공간은 수직을 유지하므로 pitch/roll이 없다.
- **기본값(읽을 때만 풀이, `mapSpatial.ts`)**: 공간 바닥 0·입체 180, 카메라 높이 120·pitch 0·roll 0·aspect 16:9, 기호 바닥 0·입체는 종류별(문 160, 의자 70, 테이블 60, 침대 45, 기타 80). 범위: elevation ±100000, volumeHeight 1~100000, pitch ±90, roll ±180, aspect 0.1~10 (`domain.ts`의 `BACKGROUND_SPATIAL_LIMITS` 한 곳).
- **최소 쓰기**: 보기·전환은 아무것도 쓰지 않는다. 기즈모·숫자 입력은 실제로 바뀐 값만 쓰고(구형 노드에 기본값을 끼워 넣지 않음), 3D 결과는 소수 3자리로 정리하며 ±90에 아주 가까운 pitch는 정확히 ±90으로 둔다. 값이 undefined인 키는 만들지 않는다.
- **좌표**: world X = 평면 x, world Y = 위, world Z = 평면 y. 평면 회전 r은 world +Y 기준 -r. 카메라·기호의 방향 변환과 역변환은 `mapSpatial.ts`에만 있고 three.js 값과 대조하는 테스트가 있다. 수직 카메라는 저장된 방향(yaw)을 유지하며, 수직 상태에서 시선 둘레로 돌리면 방향 값이 바뀐다.
- **소속 공간**: 모든 노드는 도면 절대좌표다. 3D에서도 spaceId로 객체를 중첩하지 않는다. 공간의 평면 변형은 기존 `transformMapSpace`가 한 번만 반영하고, 공간 바닥 높이를 바꾸면 잠기지 않은 소속 항목이 같은 양만큼 오르내린다. 입체 높이만 바꾸면 소속 항목은 그대로다.
- **구버전 정책(계획 조정)**: 배경 라이브러리는 한 번도 배포되지 않았다(main에 없음). 따라서 "구버전 앱 쓰기 거절" 장치는 만들지 않았고, 대신 **기본 migration과 `2026-10-07-background-map-3d.sql`을 첫 배포 전에 함께 적용**하는 것을 규칙으로 했다. 기본 migration만 있으면 3D 값이 든 저장은 서버가 거절한다(테스트 있음). 기본 migration을 다시 실행하면 좁은 검증 함수로 돌아가므로 3D SQL도 다시 실행한다(두 파일 머리말에 기록). SQL은 기본값 주입·정규화를 하지 않는다.
- **프리뷰 저장소**: 키 `bflow-background-library-preview-v1`을 그대로 쓴다. 3D 값을 저장한 브라우저 저장소를 3D 이전 코드로 열면 그 코드는 라이브러리 전체를 거절한다(§8의 "구버전 거절"과 같은 동작). 이전 코드로 프리뷰를 다시 볼 일이 있으면 주의한다.
- **3D 구현**: three 0.186.1을 직접 사용(React 래퍼 없음). `BackgroundMap3D`는 지연 로드되어 별도 묶음(약 650KB)이다. 요청이 있을 때만 그리며(상시 루프 없음), 탭이 숨겨져 크기가 0이면 그리지 않는다. 초기화 실패·컨텍스트 손실 시 평면으로 돌아가고 초안을 보존한다.
- **도구줄**: 3D에서는 도구줄이 두 화면 위의 한 줄이다(평면에서는 기존처럼 도면 위에 겹침). 3D 도구: 선택/둘러보기, 편집 중 이동/회전/크기, 카메라 추가, 기호, 되돌리기/다시 실행.
- **범위 결정**: 공간 그리기(사각형·타원·다각형)는 평면 전용이다. 기호 놓기는 3D 바닥 클릭으로도 된다. 공간 기즈모는 수직축 회전만, 카메라는 크기 기즈모가 없다. 크기 기즈모의 가운데(전체 비율) 손잡이는 뺐다.
- **추가 기능**: `이 카메라 시점으로 보기`(명시적 버튼, 복귀 시 보던 화면 복원). 3D 처음 화면과 `맞춤`은 도면 전체가 차도록 맞추고, 사용자가 화면을 움직이기 전까지는 창 모양이 바뀌면 다시 맞춘다. 기즈모 크기는 3D 창 높이에 맞춰 조정한다.
- **기즈모 모양(사용자 확인 후 요청, 2026-10-07)**: 블렌더처럼 보이게 했다. 축마다 굵은 화살표 하나(반대쪽 화살촉과 그 클릭 영역은 뺌), 굵은 회전 고리와 옅은 윤곽 원, 또렷한 가운데 점. 색은 블렌더 규칙으로 **빨강 = 평면 가로, 초록 = 평면 세로, 파랑 = 위(높이)**, 가리킨 손잡이는 노란색. three.js 기본 기즈모의 그려지는 부분만 바꾸며(`styleMapGizmo`), 조작 로직은 그대로다. 손잡이를 고를 때는 화면에 그려진 손잡이를 먼저 맞춰 본 뒤 three.js의 넓은 클릭 영역으로 넘어간다(반대쪽 클릭 영역을 뺐기 때문에, 화살표가 보는 사람에게서 멀어질 때도 그 화살표가 잡히게 하려는 것).
- **문구**: 평면 크기 라벨은 `가로 길이`/`세로 길이`, 수직 값은 `바닥 높이`/`입체 높이`/`카메라 높이`. 저장 오류 문구도 같은 이름을 쓴다.
- **버전**: package.json은 1.126.0 그대로다. 이 브랜치는 main(1.129.x)보다 오래됐으므로 통합할 때 버전과 `update-notes.json` 위치를 다시 정한다. update-notes에는 미배포 1.126.0 항목에 두 줄을 더했다.

### 13.4 파일

새 파일 18개: `src/features/backgrounds/`의 mapSpatial.ts, mapEditSession.ts, mapDocument.ts, useBackgroundMapDocument.ts, mapCanvas.ts, map3dScene.ts, BackgroundMap3D.tsx, BackgroundMapCameraGizmo.ts, BackgroundMapPlanPreview.tsx, mapPlanPreview.ts, backgrounds-map-3d.css, backgrounds-map-plan.css / `DEVLOG/migrations/2026-10-07-background-map-3d.sql` / `tests/`의 backgroundSpatial, backgroundMapEditSession, backgroundMapDocument, backgroundMap3dScene, backgroundMapPlanPreview (.test.ts).

바뀐 파일: types.ts, domain.ts, mapGeometry.ts, BackgroundMapEditor.tsx, backgrounds-map.css / `DEVLOG/migrations/2026-09-21-background-library.sql`(머리말 주의 문구만) / tests의 backgroundDomain, backgroundDatabaseContract, backgroundMapGeometry, backgroundMapWorkflow, backgroundPersistence, backgroundPreview, backgroundStore / AGENTS.md, CLAUDE.md, ROADMAP.md, DEVLOG/update-notes.json, tasks/lessons.md, 그리고 이 문서·실행 계획·검증 기록·10/06 인수인계. package.json·package-lock.json의 three 추가는 원래 워크트리에도 이미 있다.

| 파일 | 책임 |
|---|---|
| mapSpatial.ts | 좌표·각도·화각 변환, 기본값 풀이, 고정 생성 카메라, 평면 투영 (three 없음) |
| mapGeometry.ts | 공간 변형과 소속 항목 동반, `addMapCamera`, 기즈모 결과를 노드 값으로 바꾸는 `applyNodeWorldPose`, 겹침 목록 |
| mapEditSession.ts / mapDocument.ts / useBackgroundMapDocument.ts | 제스처(시작·미리보기·확정·취소), 되돌리기 기록, 도면별 초안·선택을 한 곳에서 관리 |
| mapCanvas.ts | 편집기·3D 화면·보조 평면도 사이의 props 계약 |
| BackgroundMap3D.tsx / map3dScene.ts / BackgroundMapCameraGizmo.ts | 3D 화면 수명·둘러보기·선택, 장면 구성과 클릭 판정, 기즈모와 제스처 연결 |
| BackgroundMapPlanPreview.tsx / mapPlanPreview.ts | 3D 옆 보조 평면도와 카메라 읽기 값 |

### 13.5 검증 결과

- `npm run typecheck` 통과. `npm run test:background` 232개 중 229 통과 / 0 실패 / 3 생략(DB 실행 검사, PGlite 미지정). 3D 이전 기준선은 78개 중 77 통과 / 1 생략.
- PGlite 0.5.8을 프로젝트 밖 임시 폴더에 두고 `BFLOW_PGLITE_MODULE`로 지정한 실행: `tests/backgroundDatabaseContract.test.ts` 27개 전부 통과(기준선 18). 기본 migration 2회 + 3D migration 2회 적용, 3D 값 왕복·거절·`mapSaveWasApplied` 포함. 운영 DB에는 적용하지 않았다.
- `npm run build:vite` 종료 코드 0: 전체 3,021개 중 2,986 통과 / 0 실패 / 35 조건부 생략, renderer/main/preload 빌드. `git diff --check` 통과.
- 화면 검증은 **앱과 같은 엔진(Electron 33.4.11 / Chromium 130)을 화면에 보이지 않게 띄워**, `http://127.0.0.1:5318/?preview=1`에 프리뷰 테스트 계정으로 로그인한 뒤 실제 마우스·키보드 입력과 화면 캡처로 했다. 저장소는 그 도구 전용이라 기존 브라우저 프리뷰 자료는 건드리지 않았다. 항목별 결과는 검증 기록에 있다.
- 독립 검토: 기초 단계 3관점(three.js 대조 수학, 저장 계약, 기하·제스처), 화면 단계 4관점(요구사항, 제스처·상태, three 수명, 회귀·레이아웃). 기즈모 모양 변경에는 2관점 검토를 따로 돌렸다(지적 11건 모두 반영 — 뒤쪽에서 볼 때 멀어지는 화살표가 잡히지 않던 문제는 "보이는 손잡이를 먼저 잡기"로 해결). 그 전 단계의 지적 26건 중 결함으로 확인된 것은 수정했고, 정책으로 남긴 2건(프리뷰 저장소 키 유지, 기본 migration 재실행 시 3D SQL 재실행)은 13.3에 적었다. 화면 검증에서 추가로 찾은 4건(작은 창에서 기즈모가 너무 작음, 처음 화면이 너무 멀리 잡힘, 창 모양이 바뀌면 좌우가 잘림, 손잡이를 가리킨 직후 바로 누르면 시작점이 어긋날 수 있음)도 고쳤다.

### 13.6 확인하지 못한 것

- 일반 사용자(관리자 아님) 계정으로 로그인한 화면. 편집을 시작하지 않은 상태(기즈모 없음, 선택·전환·둘러보기 가능)는 확인했고 권한 판정 코드는 기존 그대로지만, 별도 계정 로그인은 하지 않았다.
- 실제 설치 앱·installer, 운영 DB/Storage, 네이티브 파일 선택. 터치 입력. 실제 GPU 드라이버 오류(컨텍스트 손실은 확장 기능으로 재현만 했다).
- 성능 측정(공간 50/기호 100/카메라 20 fixture의 프레임 시간, 1000개 노드 상한). 검증에 쓴 도면은 노드 14개였다.
- 밑그림 이미지가 있는 도면의 3D 표시(프리뷰 자료에 밑그림이 없었다. 코드와 node 테스트만 있다).
- 사용자의 기존 브라우저에 남아 있는 프리뷰 자료를 새 코드로 여는 것(검증은 새 저장소의 기본 자료와 직접 만든 자료로 했다. 구형 노드를 읽고 저장하는 경로는 기본 자료와 테스트로 확인했다).
- 에피소드별 배경·배경 목록·시점 묶음 탭은 코드를 바꾸지 않았고 기존 테스트만 다시 통과시켰다. 화면에서 다시 눌러 보지는 않았다.

### 13.7 재개 방법

- 프리뷰: 이 워크트리에서 `npm run dev:renderer`를 `PORT=5318`로 실행한다(`.claude/launch.json`의 `bg-preview-5318`). 주소와 테스트 계정은 기존과 같다.
- 화면이 숨겨진 브라우저 창에서는 화면 갱신이 멈춰 3D가 그려지지 않는다. 보이는 창에서 확인하거나, Electron을 `offscreen` 창으로 띄우고 `webContents.sendInputEvent`·`capturePage`로 확인한다(이번 검증 방식). 그때 페이지 포커스가 없으면 숫자 칸이 갱신되지 않아 보이므로 포커스를 켠다.
- DB 실행 검사는 `BFLOW_PGLITE_MODULE`에 `@electric-sql/pglite`의 `dist/index.js` 경로를 지정한다. 지정하지 않으면 3개가 생략되며 통과와 구분해 보고한다.
