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

> 2026-10-08 갱신: 아래 네 줄은 구현 당시 기록이다. 지금은 main에 통합되어 있으며 현재 상태는 §14가 기준이다.

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
- **구버전 정책(계획 조정)**: 배경 라이브러리는 한 번도 배포되지 않았다(main에 없음). 따라서 "구버전 앱 쓰기 거절" 장치는 만들지 않았고, 대신 **기본 migration과 `2026-10-07-background-map-3d.sql`을 첫 배포 전에 함께 적용**하는 것을 규칙으로 했다. 기본 migration만 있으면 3D 값이 든 저장은 서버가 거절한다(테스트 있음). 기본 migration을 다시 실행하면 좁은 검증 함수로 돌아가므로 3D SQL도 다시 실행한다(두 파일 머리말에 기록). **v1.133.0부터 사슬은 셋이다: 기본 → 3D → `2026-10-09-background-map-elements.sql`. 앞 파일을 다시 실행하면 그 뒤 파일을 모두 순서대로 다시 실행한다(§17.3).** SQL은 기본값 주입·정규화를 하지 않는다.
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
- 독립 검토: 기초 단계 3관점(three.js 대조 수학, 저장 계약, 기하·제스처), 화면 단계 4관점(요구사항, 제스처·상태, three 수명, 회귀·레이아웃). 기즈모 모양 변경에는 2관점 검토를 따로 돌렸다(지적 11건 모두 반영 — 뒤쪽에서 볼 때 멀어지는 화살표가 잡히지 않던 문제는 "보이는 손잡이를 먼저 잡기"로 해결). 그 전 단계의 지적 26건 중 결함으로 확인된 것은 수정했고, 정책으로 남긴 2건(프리뷰 저장소 키 유지, 기본 migration 재실행 시 3D SQL 재실행 — v1.133.0부터 사슬은 셋이다: 기본 → 3D → `2026-10-09-background-map-elements.sql`, §13.3·§17.3)은 13.3에 적었다. 화면 검증에서 추가로 찾은 4건(작은 창에서 기즈모가 너무 작음, 처음 화면이 너무 멀리 잡힘, 창 모양이 바뀌면 좌우가 잘림, 손잡이를 가리킨 직후 바로 누르면 시작점이 어긋날 수 있음)도 고쳤다.

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

## 14. main 통합과 시험 공개 (2026-10-08, v1.130.0)

사용자가 프리뷰를 직접 확인한 뒤 "테스트 버전이지만 배포해 보자"고 요청했고, 노출 범위는 **배한솔 계정만**, 진행 범위는 통합 → PR → 머지 → 운영 DB → 빌드 → 배포 전체로 정했다(코덱스 리뷰 생략).

### 14.1 통합

- 세션 워크트리의 작업을 한 커밋(ab050bd3)으로 묶고 `origin/main`(d0ef2cb3, v1.129.2)을 병합했다. 충돌 6개(package.json, package-lock.json, src/App.tsx, Sidebar.tsx, update-notes.json, tasks/lessons.md)를 풀었고 main의 화면 지연 로드 구조(`src/views/viewLoaders.ts`)에 배경 화면을 맞췄다.
- 버전은 1.130.0. `test:background`를 `build`·`build:vite` 순서에 넣었다(위치는 `test:gantt` 뒤 — `tests/motion/motionScaffold.test.ts`가 `test:vacation && test:motion && vite build` 순서를 고정한다).
- three.js는 3D 화면 묶음에만 들어가므로 설치본에 패키지 폴더를 다시 담지 않게 `build.files`에 `!node_modules/three/**`를 더했다.
- 원래 워크트리(`C:/Bflow-BGonly/.worktrees/background-library`)는 손대지 않았다. 내용은 모두 main에 들어갔으므로 그 워크트리의 미커밋 파일은 이제 사본이다.

### 14.2 노출 범위 (시험 공개)

- `canAccessBackgroundLibrary`(`src/features/playground/featureFlag.ts`)가 배플레이그라운드와 같은 계정 판정을 쓴다. 사이드바 메뉴 필터와 `resolveAllowedView`(화면 진입)가 모두 이 함수를 거친다. `tests/backgroundAccess.test.ts`가 둘 다 고정한다.
- 화면 노출만 막는 장치다. 메인 프로세스의 배경 IPC와 서버 함수는 계정을 가리지 않는다(읽기는 로그인 사용자, 자산 편집은 관리자, 에피소드별 사용 기록은 팀원도 가능 — 기존 설계 그대로).
- 검토에서 확인한 진입 경로: 사이드바(접힘·펼침 공통 목록), 단축키, 검색, 새 창 목록, 딥링크, 시작 화면 설정, 뒤로 가기, 화면 미리 받기. 배경으로 들어가는 길은 사이드바와 화면 전환 한 곳뿐이다.
- 알고 넘어간 것: 한솔 계정이 배경 화면을 본 뒤 **같은 실행 중인 앱에서** 다른 계정으로 바꿔 로그인하면 머리줄의 뒤로 가기 버튼에 "배경 라이브러리" 이름이 남을 수 있다. 눌러도 대시보드로 간다(뒤로 가기 기록이 계정 전환 때 비워지지 않는 기존 동작).
- 공개 범위를 넓힐 때: 이 함수만 바꾸고, update-notes에 팀 공개 항목을 새로 쓴다. 그 전에 §13.6의 미확인 항목(관리자 아닌 계정 화면, 큰 도면 성능)을 확인한다.

### 14.3 운영 DB

- 2026-10-08 적용: `2026-09-21-background-library.sql`(기록 이름 `background_library`, 20261008035103) → `2026-10-07-background-map-3d.sql`(`background_map_3d`, 20261008035155). 프로젝트 `mpqifkpxalwxgcrddchv`.
- 적용 전 읽기 전용 확인: 같은 이름의 기존 객체 0개, `users.id`(text, PK)·`users.role`·`episodes.episode_number`·`app_session_user_id(text)`·`realtime.send`·`scene-images` 버킷과 업로드 정책, 역할 값이 비어 있는 계정 0명, 한솔 계정은 관리자.
- 적용 후 확인: 함수 13개의 본문 md5가 저장소 파일과 모두 일치(검증 함수는 3D 파일 본문), 실행 권한은 `background_library_read`·`background_library_execute` 두 개만 anon/authenticated에 있고 PUBLIC에는 없음, 두 표는 RLS 켜짐·정책 0·직접 권한 없음·행 0개·실시간 publication 없음. anon으로 잘못된 토큰 읽기는 42501, 표 직접 읽기는 42501.
- 적용 직전에 고친 SQL 두 곳(통합 검토 지적): 역할 값이 NULL인 계정을 일반 팀원으로 처리(`COALESCE(role='admin',false)`), 변경 신호 전송 실패가 저장을 되돌리지 않게 예외 블록으로 감쌈(기존 간트·팀 할 일 신호와 같은 방식).
- 실제 저장(쓰기) 호출은 운영에서 실행해 보지 않았다. 운영 세션을 만들지 않기 위해서이며, 첫 저장은 배포된 앱에서 한솔 계정으로 확인한다.

### 14.4 통합 뒤 검증

- `npm run typecheck` 통과. `npm run build:vite` 종료 코드 0. 수치는 [누적 검증 기록](background-library-verification-2026-09-21.md)의 2026-10-08 절.
- 앱 엔진(Electron 33.4.11)을 보이지 않게 띄워 실제 입력으로 다시 확인: 일반 팀원 시험 계정에는 배경 메뉴가 없음, 한솔 시험 계정에는 메뉴가 있고 도면 열기 → 3D 전환 → 카메라 추가(500, 340, 높이 120) → 화살표로 가로만 이동 → 되돌리기/다시 실행 → 높이 화살표 → 회전 고리 → 저장 → 새로 고침 뒤 값 유지, 740×900 창에서 3D와 보조 평면도 동시 표시.
- 독립 검토 4갈래(병합 결과, 노출 범위, 운영 DB 변경, 전체 사용자 영향)와 갈래별 반증 검증. 배포를 막는 문제 없음, 확정 5건(커밋 누락 위험, 문서, 역할 NULL, 설치 용량, WebP 경로 안내)을 모두 반영했다.

### 14.5 확인하지 못한 것 (§13.6에 더해)

- 설치된 앱에서의 실제 저장·이미지 업로드·실시간 신호(운영 DB/Storage). 배포 뒤 한솔 계정 실기 확인 대상이다.
- 팀원 PC에서 메뉴가 보이지 않는지(코드와 미리보기 시험 계정으로만 확인).

## 15. ① 평면 편집 기본기 (v1.131.0)

v1.130.0 시험 공개 뒤 한솔이 보낸 도면 피드백 2차의 첫 묶음이다(라운드 계획 `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`의 B1, 2026-10-08 설계 승인). 평면 도면에 휠 확대·축소와 전체 맞춤, 그리자마자 이름 짓기, 가까운 도형에 붙는 스냅, 다각형 점 편집을 더했다. 저장 자료·운영 DB·3D 화면은 바꾸지 않았고 배경 메뉴는 계속 배한솔 계정에만 보인다. 브랜치는 `claude/bg-map-editing-basics`(main v1.130.0, d8325afb에서 갈라짐)이다.

### 15.1 문서 위치

- 설계(계약): `docs/superpowers/specs/2026-10-08-background-map-editing-basics-design.md`. 거기 적힌 동작이 승인된 범위의 전부다. 하지 않는 것은 1.2절, 앱 엔진에서 확인할 것과 한솔에게 알릴 것은 16절에 있다.
- 구현 계획: `docs/superpowers/plans/2026-10-08-background-map-editing-basics.md`. Task 1~13이 설계 15절의 일곱 단계이며, 둘로 나눈 곳은 "순수 모듈 + 테스트" 커밋과 "편집기 배선" 커밋의 경계다.
- 수동 검증(설계 13절)의 결과와 자동 검사 수치는 [누적 검증 기록](background-library-verification-2026-09-21.md)의 `2026-10-08 ① 평면 편집 기본기 (v1.131.0)` 절에 적는다. 그 절은 13절 전체를 확인한 뒤에 쓴다 — 절이 아직 없으면 수동 검증이 끝나지 않은 것이다.

### 15.2 파일

새 파일 9개: `src/features/backgrounds/`의 mapSnap.ts, mapPlanGesture.ts, mapPlanEdit.ts, BackgroundMapNameBox.tsx, BackgroundMapPlanOverlays.tsx / `tests/`의 backgroundMapSnap, backgroundMapPlanGesture, backgroundMapPlanEdit, backgroundMapEditorWiring (.test.ts).

바뀐 파일: mapDocument.ts, mapGeometry.ts, BackgroundMapEditor.tsx, backgrounds-map.css / tests의 backgroundMapDocument, backgroundMapGeometry / package.json, package-lock.json, DEVLOG/update-notes.json, AGENTS.md, ROADMAP.md, 이 문서, 라운드 계획. 3D 파일(BackgroundMap3D.tsx, map3dScene.ts, BackgroundMapCameraGizmo.ts)과 types.ts, domain.ts, mapSpatial.ts, mapEditSession.ts, useBackgroundMapDocument.ts, mapWorkflow.ts, mapCanvas.ts, 보조 평면도, electron 쪽, SQL은 건드리지 않았다.

| 파일 | 책임 |
|---|---|
| mapSnap.ts | 스냅 대상 모으기, 가까이 있는 것만 거르기(닿는 거리), 옮기기·크기·점·회전의 붙이기와 정수 맞춤, 안내선 값 (순수, three.js·DOM 없음) |
| mapPlanGesture.ts | 평면 제스처 한 번의 미리보기: (시작 도면, 누른 점, 지금 점, 스냅) → (도면, 안내선) (순수) |
| mapPlanEdit.ts | 화면 크기 상수, 손잡이·점 손잡이 배치, 더블클릭 대상, 스냅 설정 읽기/쓰기 |
| BackgroundMapNameBox.tsx | 캔버스 위 이름 입력 칸(위치·포커스·Enter/Esc/blur) |
| BackgroundMapPlanOverlays.tsx | 안내선, 회전·크기 손잡이, 점 손잡이를 그리는 SVG 조각(받은 값만 그린다) |
| mapDocument.ts | `MAP_ZOOM_LIMITS.min` 0.1, `MAP_LABEL_SCALE_LIMITS`, `mapScreenScale`, `zoomMapViewportAt`, `wheelZoomFactor`, `MAP_FIT_MARGIN`, `fitMapViewport`. 리듀서·상태 모양은 그대로다 |
| mapGeometry.ts | `nodeLocalPoint`·`resizeSpaceTo`(기존 `resizeSpace`를 둘로), `nodeResizeCorner`, `placeMapNode`, `replaceMapNode`(공개·전 종류), `renameMapNode`, `nodeNameAnchor`, 다각형 점 함수 다섯 개(`polygonFromWorldPoints`, `movePolygonVertex`, `insertPolygonVertex`, `removePolygonVertex`, `rectToPolygon`) |
| BackgroundMapEditor.tsx | 휠 효과·맞춤·키, 세션 필드와 누름 기록, 창 단위 처리기 둘(캔버스 밖 누름 / 끌기에 쓴 Alt), `pointerMove`는 `previewPlanGesture` 호출, 넘기기는 `click`, 더블클릭은 SVG 한 곳, 이름 칸·안내선·점 손잡이 배선, 스냅 버튼, 모양 줄, 문구 |
| tests/backgroundMapEditorWiring.test.ts | 편집기 배선의 소스 앵커 18개(설계 12.7). 아래 15.3의 규칙 대부분을 글자로 고정한다 |

모듈 의존은 `mapPlanGesture.ts` → `mapSnap.ts` → `mapGeometry.ts` → `mapSpatial.ts`, `mapPlanEdit.ts` → `mapSpatial.ts` 한 방향이다. 3D 파일은 새 모듈을 import하지 않는다.

### 15.3 뒤 묶음이 지켜야 할 것

- **화면 배율값 하나**: 편집기는 렌더마다 `screenScale = mapScreenScale(view.zoom, canvasSize)` 하나를 구하고 손잡이 크기, 스냅 허용 거리와 닿는 거리, 안내선 여유, 점 손잡이가 모두 이 값만 쓴다. 다음 묶음의 선택 상자 여유와 주석 핀도 이 값을 쓴다(배율 계산을 따로 만들지 않는다).
- **`snapMove`의 id 집합과 닿는 거리**: `snapMove`는 처음부터 움직이는 id 집합과 기준 노드를 받고 `delta`를 돌려준다. 묶음 이동은 같은 `delta`를 나머지에 더하면 된다. 닿는 거리(`MAP_SNAP.reachPx`, 화면 48px)는 합친 상자에서 재므로 묶음에도 그대로 쓴다. 닿는 거리를 없애 선을 끝없이 늘이면 도면의 모든 것이 후보가 되어 늘 붙는다.
- **넘기기는 `click`에서**: 겹친 카메라·기호 묶음의 "다시 누르면 다음 것으로"는 `pointerUp`이 `pendingCycle`에 적어 두기만 하고 SVG의 `onClick`이 넘긴다. `pointerUp`에서 바로 고르던 꼴로 되돌리면 더블클릭의 둘째 누름이 선택을 넘겨 버린다.
- **더블클릭은 SVG에서 누름 기록으로**: 편집 중의 누름은 포인터를 캡처하므로 `click`·`dblclick`이 노드 `<g>`에 닿지 않는다. 더블클릭은 SVG의 `onDoubleClick={canvasDoubleClick}` 하나가 받고, 무엇을 눌렀는지는 `pointerDown`이 적어 둔 최근 두 번의 누름(`pressLog`)으로 판정한다. 노드 `<g>`에 `onDoubleClick`을 달지 않는다. **캔버스가 받지 않은 누름은 기록을 비운다** — SVG 밖의 누름은 창 단위 `pointerdown` 캡처 처리기가, SVG 안이지만 편집기가 받지 않은 누름(저장 중, 오른쪽 버튼 등)은 `pointerDown`의 가드가 비운다. 캔버스 위에 뜨는 버튼이나 창을 새로 더해도 이 규칙이 그 아래 노드의 이름 칸이 열리거나 상세 도면으로 들어가는 것을 막는다. 시간·거리 상수로 막지 않는다.
- **②가 정해야 하는 넘기기 조건(설계 11절)**: 지금의 조건 `event.detail >= 2 && canEdit`은 "묶음에는 카메라·기호만 있고, 보기 모드의 더블클릭은 그것들에 아무 일도 하지 않는다"에 기댄 임시 조건이다. 공간이 묶음에 들어오면 깨진다 — 연결된 공간의 더블클릭은 보기 모드에서도 그 도면으로 들어가므로, 조건을 그대로 두면 보기 모드에서 두 번 넘긴 뒤 들어가게 된다. ②의 규칙은 "더블클릭이 첫 누름의 대상에 작용하는 경우(이름 고치기, 연결된 공간으로 들어가기)에는 보기 모드에서도 둘째 클릭이 넘기지 않는다"로 잡는다. 편집 중에 겹친 공간을 빠르게 두 번 누르면 '아래 공간으로'가 아니라 이름 고치기나 들어가기가 된다는 점도 ② 설계에서 한솔에게 보여 준다. `doubleClickNodeId`는 묶음 목록을 받으므로 묶음에 공간을 넣어 같은 길을 쓸 수 있다.
- 그 밖에 설계 11절 '다음 묶음 ②를 막지 않는 점'에 적힌 것: 손잡이·점 손잡이는 "선택된 것 하나"일 때만 그린다(지금의 `selectedId`). 여러 개 선택이 들어오면 그 조건만 바꾼다.

## 16. ② 선택 도구 개편 (v1.132.0)

도면 피드백 2차의 둘째 묶음이다(라운드 계획 `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`의 B2, 2026-10-09 설계 승인). 평면의 '선택' 도구를 고르고 옮기는 도구로 바꿨다: 빈 곳을 끌어 상자로 여러 개 고르기와 Shift+클릭, 함께 옮기기(스냅 포함)·지우기·잠그기, '화면 이동' 도구와 스페이스·휠 버튼, 겹친 공간에서 작은 방이 먼저 잡히고 같은 자리를 천천히 다시 누르면 아래 공간으로 넘어가기(평면·보조 평면도·3D). 저장 자료·운영 DB는 바꾸지 않았고 배경 메뉴는 계속 배한솔 계정에만 보인다. 브랜치는 `claude/bg-map-selection-tools`(main v1.131.0, a2cc1d38에서 갈라짐)이다. 2026-10-09에 구현을 마쳤고, 수동 검증(설계 13절)과 배포는 그 뒤의 일이다.

### 16.1 문서 위치

- 설계(계약): `docs/superpowers/specs/2026-10-09-background-map-selection-tools-design.md`. 거기 적힌 동작이 승인된 범위의 전부다. 하지 않는 것은 1.2절, 앱 엔진에서 확인할 것과 한솔에게 알릴 것은 16절에 있다. 승인 문구가 한 가지로 정하지 않던 한 곳(Q1: 상자는 공간의 벽에 닿아야 그 공간을 고른다)은 2026-10-09에 한솔이 설계의 답 그대로 확인했다(1.1의 표).
- 구현 계획: `docs/superpowers/plans/2026-10-09-background-map-selection-tools.md`. Task 1~16이 설계 15절의 여덟 단계이며, 나눈 곳은 "순수 모듈 + 테스트" 커밋과 "배선" 커밋의 경계다.
- 수동 검증(설계 13절)의 결과와 자동 검사 수치는 [누적 검증 기록](background-library-verification-2026-09-21.md)의 `## 2026-10-09 ② 선택 도구 개편 (v1.132.0)` 절에 적는다. 그 절은 13절 전체를 확인한 뒤에 쓴다 — 절이 아직 없으면 수동 검증이 끝나지 않은 것이다.

### 16.2 파일

새 파일 5개: `src/features/backgrounds/`의 mapStack.ts, mapPlanSelect.ts, BackgroundMapSelectionSummary.tsx / `tests/`의 backgroundMapStack, backgroundMapPlanSelect (.test.ts).

바뀐 파일: mapDocument.ts, useBackgroundMapDocument.ts, mapGeometry.ts, mapPlanGesture.ts, mapPlanEdit.ts, mapPlanPreview.ts, BackgroundMapPlanPreview.tsx, BackgroundMapPlanOverlays.tsx, map3dScene.ts, BackgroundMap3D.tsx, BackgroundMapEditor.tsx, backgrounds-map.css / tests의 backgroundMapDocument, backgroundMapGeometry, backgroundMapPlanGesture, backgroundMapPlanEdit, backgroundMapPlanPreview, backgroundMap3dScene, backgroundMapEditorWiring / package.json, package-lock.json, DEVLOG/update-notes.json, AGENTS.md, ROADMAP.md, 이 문서, 라운드 계획. ①에서는 손대지 않던 보조 평면도(mapPlanPreview.ts, BackgroundMapPlanPreview.tsx)와 3D 파일 둘(map3dScene.ts, BackgroundMap3D.tsx), useBackgroundMapDocument.ts와 3D 테스트는 이번에 의도적으로 고쳤다. types.ts, domain.ts, mapSpatial.ts, mapEditSession.ts, mapSnap.ts, mapWorkflow.ts, mapCanvas.ts, mapGallery.ts, BackgroundMapGallery.tsx, BackgroundMapNameBox.tsx, BackgroundMapCameraGizmo.ts, BackgroundMapPanels.tsx, electron 쪽, SQL, `src/features/playground/featureFlag.ts`는 건드리지 않았다.

| 파일 | 책임 |
|---|---|
| mapStack.ts | 겹친 공간의 쌓임 순서 하나: 넓이(`spacePlanArea`), 아래→위 목록(`stackedSpaces`), 번호표(`spaceStackRanks`), 한 점을 품은 공간들(`spacesAt`) (순수, three.js·DOM 없음. 평면과 3D가 함께 쓴다) |
| mapPlanSelect.ts | '선택' 도구의 누름 판정(`resolvePlanPress`)과 같은 자리 판정(`PlanSpot`·`sameSpotAgain`), 상자(`planRect`·`planRectTouches`·`planMarqueeIds`), 카메라·기호의 "포인터 아래"(`planMarkCovers`) (순수) |
| BackgroundMapSelectionSummary.tsx | 여러 개 선택의 속성 칸 요약(개수·구성·묶음 동작 버튼. 받은 값만 그린다) |
| mapDocument.ts | `MapViewport.selectedIds`와 `selectedId`의 새 뜻(3D의 하나), 액션 `select-many`·`pick-one`, `select`의 규칙, 읽는 함수 `mapSelection`·`singleViewId`·`pickAction`. 문서 키는 그대로다 |
| useBackgroundMapDocument.ts | `selectMany` |
| mapGeometry.ts | `moveMapNodes`·`removeMapNodes`·`lockMapNodes` |
| mapPlanGesture.ts | `PlanGesture`의 `move-group`, 그 미리보기와 스냅 후보 |
| mapPlanEdit.ts | `planDoubleClickAction` |
| mapPlanPreview.ts | `planPileAt`, `nextPlanSelection`의 여섯째~여덟째 인자(`point`, `again`, `repeat`) |
| BackgroundMapPlanPreview.tsx | 공간을 쌓임 순서로 그리기, 클릭 점·`again`·연속 클릭 넘기기(`turn`, `Activate`의 넷째 인자), 밖의 누름과 클릭이 되지 못한 누름에 `turn` 지우기(`svgRef`, 창 캡처 `pointerdown`·`pointerup`·`pointercancel`) |
| BackgroundMapPlanOverlays.tsx | `MapMarquee` |
| map3dScene.ts | `pickMapFloor`의 순서, `mapFloorPile`·`mapClickAim`, `resolveMapClick`의 공간 더미와 `again`·`repeat` |
| BackgroundMap3D.tsx | `Press.repeat`, `turn`·`aimed`, `click`·`clickHandle`을 `pick` 하나로, `opens`·`doubleClickNode`, `turn`을 끝내는 줄들과 창 캡처 `pointerdown`(`onPressElsewhere`) |
| BackgroundMapEditor.tsx | 선택을 읽는 값(`selection`·`singleId`·`selected`), 포인터 흐름(`resolvePlanPress` 배선, 상자, 묶음 이동, Shift, `lastSpot`), 스페이스(`onSpaceKey`), 도구줄·힌트 문구, 넘기기와 `doubleClickIntent`·`openSpace`, `select`의 3D 규칙(`pickAction`), 묶음 삭제·잠금·Delete와 그 뒤의 포커스, Esc의 상자 취소, 속성 칸 분기, `ObjectList` props, 쌓임 순서로 그리기, 새 기호의 소속. 판정은 순수 모듈에, 요약은 새 컴포넌트에 있고 편집기에는 배선만 늘었다 |
| backgrounds-map.css | `.bmap-marquee`, 커서 규칙 셋 |
| tests/backgroundMapEditorWiring.test.ts | 소스 앵커 39개: ①의 20개(5·6은 이번에 고쳐 썼고, 10은 3D 파일이 import하지 않는 목록에 `mapPlanSelect`를 더했다), 설계 12.8의 15개(21~35), 구현 중 리뷰에서 더한 넷(36~39). 아래 16.3의 규칙 대부분을 글자로 고정한다 |

모듈 의존은 `mapStack.ts` → `mapGeometry.ts` → `mapSpatial.ts`, `mapPlanPreview.ts` → `mapStack.ts`, `mapPlanSelect.ts` → `mapPlanEdit.ts`·`mapPlanPreview.ts`·`mapSpatial.ts`(`mapDocument.ts`에서는 타입만), `map3dScene.ts` → `mapStack.ts` 한 방향이다. `mapGeometry.ts`·`mapDocument.ts`는 새 모듈을 import하지 않고, 3D 파일(BackgroundMap3D.tsx, map3dScene.ts, BackgroundMapCameraGizmo.ts)은 `mapPlanSelect`·`mapPlanEdit`·`mapPlanGesture`·`mapSnap`을 import하지 않는다.

설계의 글자와 다르게 지은 곳(구현 중 리뷰에서 고쳤고 테스트로 고정했다):

- 상자는 `rect`가 아니라 `path`로 그린다. 너비나 높이가 0인 `rect`는 선도 그려지지 않아, 정확히 가로나 세로로만 끈 상자가 보이지 않았다(앵커 37).
- 열린 창(`dialog`) 안에서 누른 Delete는 배치를 지우려 하지 않는다 — 하나든 묶음이든(앵커 38).
- 보조 평면도 위에서 누른 뒤 밖에서 떼거나 취소되어 클릭이 되지 못한 누름도 자리 기억을 끝낸다(창 캡처 `pointerup`·`pointercancel`, 앵커 39).
- 3D의 연속 클릭은 선택된 공간과 그 클릭이 고르는 것이 모두 포인터 아래 바닥 더미에 있을 때만 선택을 그대로 둔다. 위에 카메라·기호가 있거나 선택된 공간이 벽으로만 맞았으면 고른 것 그대로다(`mapClickStep`, `tests/backgroundMap3dScene.test.ts`).
- 함께 옮길 때의 기준 노드(`groupAnchorId`)는 누른 것이 움직이지 않아 첫 움직이는 노드로 넘어갈 때도, 그 노드가 움직이는 공간에 실려 가는 항목이면 그 공간이다. 설계 6.3은 그때 `moving[0]` 그대로였다. 도면 순서에서 의자가 제 방보다 앞에 있으면 의자가 기준이 되어, 스냅으로 붙은 방의 가장자리가 소수 끝자리에서 어긋났다(`tests/backgroundMapPlanGesture.test.ts`).

### 16.3 뒤 차례가 지켜야 할 것

- **쌓임 순서는 `mapStack.ts` 한 곳**: 겹친 공간의 위아래(작은 넓이가 위, 같으면 배열 순서)는 이 모듈만 정하고, 평면 그리기·같은 자리를 다시 누를 때 넘어가는 목록(`planPileAt`)·보조 평면도·3D `pickMapFloor`·새 기호의 소속이 모두 읽는다. 배열(`nodes`)은 다시 정렬하지 않는다. ③의 도로(다른 공간 **아래**에 그린다)는 비교 함수의 **맨 앞 항 하나**(층: 도로 0, 그 밖 1)로 들어간다 — 읽는 곳들은 고칠 것이 없다(설계 7.6). 새 카메라의 "정확히 하나" 셈에서 도로를 빼는 것은 ③의 일이다.
- **선택은 날것으로 두고 읽을 때 거른다. 선택 액션은 바꿔 넣기뿐이다**: 문서는 `selectedIds`를 그대로 들고(되돌리기·초안 버리기에서 건드리지 않는다) `mapSelection`이 읽을 때 사라진 노드를 거른다. `select`·`select-many`는 목록을 통째로 바꿔 넣는다. 날것 목록에 더하거나 빼는 액션을 만들면 사라진 노드가 묶음에 끼어든다 — 더하고 빼는 일(Shift+클릭)은 편집기가 살아 있는 선택에서 새 목록을 만들어 `selectMany`로 보낸다.
- **`selected`의 뜻**: 편집기의 `selected`는 "하나를 다루는 도구가 붙는 노드"이며 평면의 여러 개 선택에서는 비어 있다. 여러 개를 다루는 코드는 `selection`(`ids`·`primaryId`)과 `groupNodes`를 읽는다.
- **전환은 선택을 건드리지 않는다. `selectedId`는 선택이 아니라 3D의 하나다**: `switchMode`·`leave3D`·`navigate`는 선택 액션을 부르지 않는다. 3D·보조 평면도는 `singleViewId`로 읽은 하나(`singleId`)만 받고 `mapCanvas.ts`의 계약은 그대로다. 3D 모드의 고르기는 편집기의 `select` → `pickAction` 한 곳을 지나 묶음(`selectedIds`)을 건드리지 않는다(`pick-one`). 3D 모드에 고르는 길을 더할 때 `doc.select`를 직접 부르지 않는다. 묶음 동작과 묶음을 푸는 일은 평면에서만 한다.
- **누름 판정은 `resolvePlanPress`에만**: '선택' 도구의 누름이 하는 일(누를 때 고르기, 끌면 옮기기·묶음 이동·상자·화면 이동, 떼면 고르기·더하고 빼기·넘기기)은 이 순수 함수가 정하고 편집기는 실행만 한다. 공간의 더미에서 아래 것이 대상이 되는 것은 `again`(같은 자리를 다시 누름)일 때뿐이다 — 이 조건을 빼면 큰 공간이 선택된 동안 안쪽 방의 누름·끌기·더블클릭이 모두 큰 공간에 작용한다.
- **자리 기억이 끝나는 때는 평면·3D·보조 평면도가 같다**(설계 7.3 끝의 표): 고르는 누름이 아닌 캔버스 누름(화면만 옮기는 누름, 왼쪽 주 버튼이 아닌 누름, 취소된 끌기)과 캔버스 밖의 누름 뒤에는 그 자리를 다시 눌러도 처음 누름이다. 장치는 화면마다 다르다: 평면은 누름마다 `lastSpot`을 비우고, 눌린 노드를 고르거나 옮긴 누름이 뗄 때 새로 적는다. 3D와 보조 평면도는 고르는 클릭이 `turn`을 적고 그 밖의 누름이 지운다. 누름을 받는 길을 더할 때는 그 표에 맞춘다.
- **공간의 더미는 연속 클릭에 넘어가지 않는다(세 화면 모두)**: 넘기는 것은 새 클릭 묶음을 시작하는 클릭뿐이다 — 그 더블클릭이 할 일이 있든 없든(평면: SVG `click`의 `cycle.spaces`, 3D: `resolveMapClick`의 `repeat`, 보조 평면도: `nextPlanSelection`의 `repeat`). 카메라·기호 더미만 "연속 클릭이고 그 더블클릭이 무언가를 할 때" 건너뛰며, 그 넘기기와 더블클릭은 `doubleClickIntent` 하나를 함께 쓴다(15.3에서 ②가 정하기로 한 넘기기 조건은 이 둘로 정해졌다).
- **스페이스는 추적과 삼키기가 따로다**: 추적(누르고 있음을 적기)은 평면 모드이고 편집기가 보이면 포커스가 어디에 있든 한다 — 스페이스가 글자이거나 열린 창의 것일 때(`spaceEntry`)만 뺀다. 삼키기(기본 동작 막기)는 편집기 안의 빈 곳과 `body`에서만 한다. 추적 조건에 포커스 자리를 넣으면 밖의 버튼이나 잠금 체크 칸을 누른 직후의 스페이스+끌기가 방을 옮긴다.
- **④에서 편집 권한이 넓어져도 묶음 동작은 `canEdit` 하나를 본다**: 상자·묶음 이동·함께 지우기·잠그기는 `canEdit`일 때만 된다. 권한 판정을 따로 더하지 않는다.

### 16.4 뒤 차례가 정할 것

- ⑤의 주석 핀이 상자에 잡히는지는 ⑤가 정한다. 이번 차례의 상자(`planRectTouches`·`planMarqueeIds`)·더미(`planPileAt`)·쌓임 순서(`mapStack.ts`) 코드는 공간·기호·카메라 세 종류만 읽고 주석 핀에 기대지 않는다.

## 17. ③ 새 도면 요소 (v1.133.0)

도면 피드백 2차의 셋째 묶음이다(라운드 계획 `docs/superpowers/plans/2026-10-08-background-map-feedback-round2.md`의 B3, 2026-10-09 설계 승인). 도면에 그릴 수 있는 것을 셋 늘렸다: 기호 '계단'(평면은 디딤판 줄무늬와 올라가는 방향 화살표, 3D는 층층이 오르는 단), '도로'(공간의 한 종류 — 회색 바닥과 가운데 점선, 3D는 벽 없는 납작한 바닥, 크기와 무관하게 늘 방 아래), 카메라 색(색 동그라미 여섯 개와 '기본 색으로'). **①·②와 달리 저장 모양이 늘었다**(기호 종류 `stairs`, 공간의 선택 키 `surface: 'road'`, 카메라의 선택 키 `color`). 그래서 서버 검증 함수를 넓히는 세 번째 migration 파일을 더했고, 앱이 모르는 종류가 저장돼 있으면 오류 대신 "업데이트가 필요해요" 안내를 띄우는 읽기 장치를 넣었다. 배경 메뉴는 계속 배한솔 계정에만 보인다. 브랜치는 `claude/bg-map-new-elements`이다(main v1.132.0, a0ca0542에서 갈라졌고, 그 뒤 main이 캐릭터 카드만 바꾼 v1.132.1, b3ca096e가 되어 그 위로 옮겼다). 2026-10-10에 구현을 마쳤고, 최종 수동 검증(설계 11절)·운영 DB 적용·배포는 그 뒤의 일이다.

구현 도중 오케스트레이터가 앱 엔진(Electron 33)에서 관문 넷(A 업데이트 안내 · B 계단 · C 도로 · D 카메라 색)을 보았고 모두 통과했다. **설계 14.2의 대체안은 하나도 쓰지 않았다** — 앵커가 읽는 글자, CSS, 계단의 디딤판 그림, 3D 바닥의 그리는 순서(`renderOrder`), 점선 값이 모두 설계에 적힌 그대로다. 관문에서 알게 된 것은 둘이다. (R13) 이름 붙은 그리기 도구가 넷이 되어, 편집 중 평면의 도구줄이 창 폭 약 1231~1310px에서 새로 두 줄이 된다(예전에는 약 1230px 이하에서만 두 줄이었다). 도구줄이 도면 영역 밖으로 넘치지는 않으며 설계대로 받아들였다 — 거슬리면 14.2의 대체안(그리기 도구 넷의 이름을 한 단계 일찍 감춘다)이 있다. (C1) 색을 고르지 않은 카메라가 v1.132.0과 똑같이 보이는지는, v1.132.0을 다른 포트에 띄워 견주는 대신 같은 검사 창에서 카메라 색 작업이 들어가기 전과 뒤의 계산된 스타일과 화면 픽셀을 견줘 확인했다 — 모두 같았다.

### 17.1 문서 위치

- 설계(계약): `docs/superpowers/specs/2026-10-09-background-map-new-elements-design.md`. 거기 적힌 동작이 승인된 범위의 전부다. 하지 않는 것은 1.2절, 승인 문구가 한 가지로 정하지 않아 설계가 답을 정한 여섯 곳(I1~I6)과 다른 답이 왔을 때 고칠 곳은 1.1 끝의 표, 운영 적용 절차는 4.5, 배포 순서는 5.4, 앱 엔진에서 확인할 것과 그 대체안은 14.2, 한솔에게 알릴 것은 14.3에 있다.
- 구현 계획: `docs/superpowers/plans/2026-10-09-background-map-new-elements.md`. Task 1~19가 설계 13절의 일곱 단계이며(1단계 = Task 1~4, 2 = 5~6, 3 = 7, 4 = 8~10, 5 = 11~14, 6 = 15~17, 7 = 18~19), 나눈 곳은 "순수 모듈 + 테스트" 커밋과 "배선" 커밋의 경계다.
- 수동 검증(설계 11절)의 결과와 자동 검사 수치는 [누적 검증 기록](background-library-verification-2026-09-21.md)의 `## 2026-10-09 ③ 새 도면 요소 (v1.133.0)` 절에 적는다(검증한 날이 다르면 절 이름의 날짜가 그 날이다 — 관문은 2026-10-10에 보았다). 운영 DB 적용 결과도 그 절과 아래 17.3에 적는다. 그 절은 11절 전체를 확인한 뒤에 쓴다 — 절이 아직 없으면 수동 검증이 끝나지 않은 것이다.

### 17.2 파일

새 파일 4개: `DEVLOG/migrations/2026-10-09-background-map-elements.sql` / `src/features/backgrounds/`의 mapCameraColor.ts, BackgroundMapCameraColor.tsx / `tests/backgroundMapElements.test.ts`.

바뀐 파일: types.ts, domain.ts, mapSpatial.ts, mapStack.ts, mapGeometry.ts, symbolCatalog.ts, BackgroundSymbolGlyph.tsx, mapPlanPreview.ts, BackgroundMapPlanPreview.tsx, BackgroundMapPlanOverlays.tsx, map3dScene.ts, BackgroundMap3D.tsx, BackgroundMapCameraGizmo.ts, BackgroundMapEditor.tsx, useBackgroundStore.ts, BackgroundLibraryView.tsx, backgrounds-map.css, backgrounds-map-plan.css / `DEVLOG/migrations/`의 적용된 두 파일(`2026-09-21-background-library.sql`, `2026-10-07-background-map-3d.sql` — **머리말 주석만**. `BEGIN;` 아래는 한 글자도 바꾸지 않았고 계약 테스트 D5가 그 해시를 고정한다) / tests의 backgroundDatabaseContract, backgroundDomain, backgroundStore, backgroundPreview, backgroundPersistence, backgroundSpatial, backgroundMapStack, backgroundMapGeometry, backgroundMapPlanSelect(더하기만), backgroundMapPlanPreview, backgroundMap3dScene, backgroundMapEditorWiring / package.json, package-lock.json, DEVLOG/update-notes.json, AGENTS.md, CLAUDE.md(맨 위 안내 줄의 다시 실행 문장만), ROADMAP.md, 이 문서(§13.3·§13.5의 두 줄과 이 절), 라운드 계획. `electron/**`(같은 `domain.ts`가 묶일 뿐이다), mapCanvas.ts, mapDocument.ts, useBackgroundMapDocument.ts, mapEditSession.ts, mapWorkflow.ts, mapPlanSelect.ts, mapPlanEdit.ts, mapPlanGesture.ts, mapSnap.ts, mapGallery.ts, previewGateway.ts, BackgroundMapNameBox.tsx, BackgroundMapSelectionSummary.tsx, BackgroundMapPanels.tsx, BackgroundMapGallery.tsx, BackgroundUI.tsx, backgrounds.css, backgrounds-map-3d.css, `src/mocks/devElectronAPI.ts`, `src/features/playground/featureFlag.ts`는 건드리지 않았다.

| 파일 | 책임 |
|---|---|
| `DEVLOG/migrations/2026-10-09-background-map-elements.sql` | 검증 함수를 "3D 파일의 본문 + 다섯 줄"로 바꿔 넣는다(넓힌 세 줄, 더한 두 줄). 그 밖에는 가드와 잠금 블록뿐이다(설계 4절) |
| mapCameraColor.ts | 카메라 색 표(이름·화면 이름·어두운/밝은 값)와 `cameraColorHex` (순수, three.js·DOM 없음) |
| BackgroundMapCameraColor.tsx | 속성 칸의 색 동그라미 여섯 개와 '기본 색으로' 글자 버튼(받은 값만 그린다) |
| types.ts | `BackgroundSymbolKind`에 `'stairs'`, `BackgroundSpaceSurface`, `BackgroundCameraColor`, 공간의 `surface?`, 카메라의 `color?` |
| domain.ts | 닫힌 목록 상수 셋(`BACKGROUND_SYMBOL_KINDS`·`BACKGROUND_SPACE_SURFACES`·`BACKGROUND_CAMERA_COLORS`), 새 키와 값 검사, `BackgroundUnsupportedError`(`detail`)·`known`·`onlyKeys`의 오류 종류, 노드 종류 검사의 자리 |
| mapSpatial.ts | `SYMBOL_VOLUME_HEIGHTS.stairs`, `isRoadSpace`, `spaceWallHeight`, `roadCentreLine`, `roadCentrePlanLine` |
| mapStack.ts | `stackedSpaces`의 층(맨 앞 항), `spacesOverlap` |
| mapGeometry.ts | `setSpaceSurface`, `setCameraColor`, `addMapCamera`의 도로 규칙, `applyNodeWorldPose`가 도로에 `volumeHeight`를 쓰지 않음 |
| symbolCatalog.ts · BackgroundSymbolGlyph.tsx | 계단 항목과 이름으로 찾는 대체값 · 계단 그림 |
| mapPlanPreview.ts · BackgroundMapPlanPreview.tsx | `planKindLabel`, 도로의 읽어 주는 값과 옆 그림 · 도로의 클래스·가운데 점선·접근성 이름, 카메라의 `data-camera-color` 다섯 곳 |
| BackgroundMapPlanOverlays.tsx | 카메라 손잡이 `<g>`의 `data-camera-color` |
| map3dScene.ts | 계단 가지, 도로 가지(재질 다섯·팔레트 둘·그리는 순서·범위·`shapeKey`), `roadsUnderRooms`와 `pickMapNode`의 맨 앞 걸음, `mapSpacePile`과 `mapClickStep`의 한 줄, 카메라 색 재질(`material`의 둘째 인자, `shapeKey`) |
| BackgroundMap3D.tsx · BackgroundMapCameraGizmo.ts | `readPalette`의 `road`·`roadMark`, `applyGizmo`의 `flat`, 손잡이 위 클릭의 더미와 import · `mapGizmoSetup`의 셋째 인자, `MapGizmoTarget.flat`, `setTarget` |
| BackgroundMapEditor.tsx | 도로 도구, 공간 그리기의 도로, '공간 종류'와 `changeSpaceSurface`, 도로의 높이 칸과 안내(`ROAD_HINT`), 색 동그라미와 `changeCameraColor`, `data-camera-color` 둘, `kindLabel`·머리 글자·목록 아이콘, 기호 목록 제목. 판정과 계산은 순수 모듈에 있고 편집기에는 배선만 늘었다 |
| useBackgroundStore.ts · BackgroundLibraryView.tsx | 업데이트 안내(`updateRequired`, 저장 막기, 콘솔 기록 한 번, 안내 화면) |
| backgrounds-map.css · backgrounds-map-plan.css | 변수 블록(`--bmap-cam`·`--bmap-cam-mark`·`--bmap-road`·`--bmap-road-mark`, 숫자 셋), 도로 규칙, 호박색 글자의 변수 치환, 색 동그라미, 보조 평면도의 색(설계 9.4) |
| tests/backgroundDatabaseContract.test.ts | 정적 계약 D1~D5(요소 파일의 글자, 3D 본문과 다른 다섯 줄, 닫힌 목록과 상수의 일치, 사슬 문장, 적용된 두 파일 본문의 해시)와 PGlite 실행 P1~P4(새 모양의 저장·거절, 3D 파일 위에만 얹히는 순서, 앞 파일을 다시 돌렸을 때의 복구) |
| tests/backgroundMapElements.test.ts | 기호 목록의 대체값, 도로의 판별·가운데 선, 색 표, 색 표·도로 색과 CSS의 일치, 새 CSS 규칙이 그 변수를 실제로 쓰는지(설계 10.4·10.6) |
| tests/backgroundMapEditorWiring.test.ts | 소스 앵커 49개: ①·②의 39개(26·31은 이번에 고쳐 썼다)와 설계 10.9의 10개(40~49). 아래 17.4의 규칙 대부분을 글자로 고정한다 |

모듈 의존(새로 생긴 줄만, 한 방향): `mapStack.ts` → `mapSpatial.ts`(`isRoadSpace`·`nodePlanOutline`), `mapGeometry.ts` → `mapSpatial.ts`(`isRoadSpace`), `mapPlanPreview.ts` → `mapSpatial.ts`(`isRoadSpace`), `mapCameraColor.ts` → `types.ts`(타입만), `map3dScene.ts` → `mapCameraColor.ts`·`mapStack.ts`(`spacesOverlap`)·`mapSpatial.ts`(`isRoadSpace`·`spaceWallHeight`·`roadCentreLine`), `BackgroundMapCameraColor.tsx` → `mapCameraColor.ts`. `mapGeometry.ts`는 여전히 `mapStack.ts`를 import하지 않는다. `mapSpatial.ts`·`mapStack.ts`·`mapCameraColor.ts`·`domain.ts`는 three.js·DOM을 import하지 않고, 3D 파일(BackgroundMap3D.tsx, map3dScene.ts, BackgroundMapCameraGizmo.ts)은 `mapPlanSelect`·`mapPlanEdit`·`mapPlanGesture`·`mapSnap`을 여전히 import하지 않는다(앵커 10).

처음 설계와 다르게 지은 곳은 하나이고, 설계도 같은 날 그렇게 고쳤다(지금의 설계와 코드는 같다):

- 가운데 점선의 띠 규칙 (나)에서 안쪽 가로대의 각을 재는 기준은 앞뒤 가운데 점을 이은 줄이 아니라 **그 자리에서 만나는 두 구간의 이등분 방향**이다. 처음 기준은 긴 다리 쪽으로 기울어, 두 다리의 길이가 약 3.73배 넘게 다른 바른 ㄱ자 길이 점선을 잃었다(설계 7.4, `tests/backgroundMapElements.test.ts`).

### 17.3 운영 DB

- **사슬**: `2026-09-21-background-library.sql`(기본, 기록 이름 `background_library`, 20261008035103) → `2026-10-07-background-map-3d.sql`(3D, `background_map_3d`, 20261008035155) → `2026-10-09-background-map-elements.sql`(요소, 기록 이름 `background_map_elements`). 셋 다 같은 검증 함수(`public.background_library_validate_entity`)를 더 넓은 것으로 바꿔 넣으므로, 마지막에 돈 파일이 서버가 받는 모양을 정한다. 요소 파일은 그 함수 하나만 바꿔 넣고 표·행·다른 함수를 건드리지 않으며, 기본 파일이나 3D 파일이 먼저 적용되지 않은 DB에서는 55000으로 멈춘다.
- **다시 실행 규칙**: 앞 파일을 다시 실행하면 그 뒤 파일을 모두 순서대로 다시 실행한다(기본 파일을 다시 돌렸으면 3D 파일 → 요소 파일, 3D 파일을 다시 돌렸으면 요소 파일). 요소 파일만 다시 돌리는 것은 아무 일도 없다(멱등). 앞 파일만 다시 돌리면 좁은 검증 함수가 돌아와, 저장된 도면에 뒤 파일의 값(세로 값, 계단·도로·카메라 색)이 하나라도 있는 동안 그 도면을 남겨 두는 쓰기가 모두 22023으로 막힌다(사실상 모든 편집이다. 읽기는 되고 잃는 것은 없다). 그런 도면이 아직 없을 때는 눈에 보이는 것이 없고 새 값을 실은 저장만 막혀서 조용히 지나가기 쉽다 — 검증 함수 본문의 md5로만 알아챈다(설계 4.5의 (2)). 같은 규칙이 세 SQL 파일의 머리말, `AGENTS.md`의 데이터 경계 항목, `CLAUDE.md`·`AGENTS.md`의 맨 위 안내 줄에 적혀 있고 계약 테스트 D4가 지킨다.
- **적용하는 때와 방법**: PR 머지 뒤, 앱 빌드·배포 전에 오케스트레이터가 한다(설계 4.5와 5.4 — 적용 전 읽기 전용 확인, 적용, 적용 뒤 확인). 넣는 글자와 견주는 md5는 작업 폴더의 파일이 아니라 저장소의 blob에서 꺼낸다(새로 체크아웃한 작업 폴더의 SQL 파일은 CRLF다).
- **적용 기록**: 아직 적용하지 않았다(2026-10-10 현재). 적용 뒤 오케스트레이터가 여기에 적는다 — 적용 버전 번호와 시각 / 검증 함수 본문 md5의 적용 전·후(적용 전이 LF 값이었는지 CRLF 값이었는지)와 나머지 함수 12개의 md5가 그대로인지 / `prosecdef`·`proconfig` / 권한(`anon`·`authenticated`가 실행할 수 있는 것이 `background_library_read`·`background_library_execute` 둘뿐인지, `PUBLIC`에 없는지, 두 표의 RLS·정책·직접 권한) / 저장된 자료(종류별 행 수와 새 모양이 든 노드 수가 적용 전·후에 같은지 — 새 모양이 든 노드는 전·후 모두 0이어야 한다) / 점검 호출 결과(`background_library_validate()`, 검증 함수 직접 호출, 익명 역할의 거절) / 다시 실행했거나 되돌렸다면 그 사실과 시각 / 확인한 사람.

### 17.4 뒤 차례가 지켜야 할 것

- 저장 모양을 넓히는 법: 적용된 SQL 파일은 고치지 않고(머리말 주석만) 사슬 끝에 새 파일을 더한다. 운영 DB를 먼저 적용하고 앱을 배포한다 — 순서가 뒤집히면 새 모양이 든 저장을 서버가 22023으로 거절한다(자료는 잃지 않고 DB를 적용하면 풀린다). 서버는 검증만 하고 값을 채우거나 고쳐 쓰지 않는다. 닫힌 목록은 `domain.ts`의 상수 셋 한 곳이고 요소 파일의 IN 목록과 순서까지 같아야 한다(계약 테스트 D2·D3).
- **넓히는 migration을 운영에 적용한 뒤 그 앱 버전의 배포가 끝날 때까지 운영에 새 모양을 저장하지 않는다 — 개발 빌드로도, 검증하면서도. 첫 저장은 배포된 버전에서, 그 화면을 여는 PC를 모두 올린 뒤에 한다. 그러지 않으면 그 모양을 모르는 PC가 모두 업데이트 안내를 띄우는데 올릴 버전이 없다(④ 뒤에는 팀 전체다).** 서버는 앱 버전을 모르므로 적용한 순간부터 새 모양을 받는다. 이번 차례에서는 설계 4.5의 9번(운영에서 실제 저장 호출을 하지 않는다)과 5.4의 6번이 이것을 지킨다.
- 앞 파일만 다시 돌려 22023이 거듭 나올 때 도면을 지우거나 새 모양을 빼고 저장해 풀지 않는다(그 쓰기는 지나가고, 지운 도면은 되살릴 수 없다) — 사슬을 다시 적용한다. 좁은 검증 함수 아래에서도 지우기는 어떤 항목도 검증하지 않고 전체 재검사는 지워지지 않은 행만 보기 때문에, "깨진" 도면을 지우는 대응이 그대로 성공한다. 계약 테스트 P4의 ③이 이 동작을 고정한다(권하는 길이 아니라 그러면 안 되는 까닭이다).
- **저장 모양은 새 선택 키 또는 닫힌 목록의 새 문자열로만 넓힌다. 기존 키의 숫자 범위·값 타입·개수 한계를 넓히면 이전 버전에는 업데이트 안내가 아니라 오류로 보인다.** 읽기 장치가 "더 새 자료"로 알아보는 것은 모르는 키와 닫힌 목록 밖의 문자열 둘뿐이다(설계 5.2).
- 미리보기 저장소 키(`bflow-background-library-preview-v1`)는 그대로 두었다: v1.133.0의 미리보기가 새 모양을 저장한 주소에서 그보다 앞선 코드(v1.132.1 이하)를 미리보기로 띄우면 라이브러리 전체를 거절한다(§13.3 '프리뷰 저장소'의 3D 값과 같은 정책). 이전 코드와 견줄 일이 있으면 다른 포트를 쓴다.
- 화면을 여는 버전은 업데이트 안내가 든 버전이어야 한다: ④가 배경 화면을 다른 계정에 여는 버전은 v1.133.0 이상이고, ④를 시작하기 전에 화면을 여는 대상 PC가 v1.133.0 이상인지 확인한다(설계 5.4의 7). 안내가 뜨면 탭과 본문이 내려가므로 그 순간 저장하지 않은 편집은 사라진다.
- 닫힌 목록의 새 검사는 `known`: 닫힌 문자열 목록을 보는 검사를 더할 때는 `requireValue`가 아니라 `known`을 쓴다(목록 밖 문자열은 `BackgroundUnsupportedError`, 문자열이 아니면 지금처럼 `Error`). 모르는 키는 `onlyKeys`가 같은 종류로 던진다. 어느 쪽이든 통째로 거절하며 모르는 값을 지우고 읽지 않는다(통째 저장이 그것을 지운다). 무엇을 몰랐는지는 오류의 `detail`에 실려 안내가 켜질 때 콘솔에 한 번 남는다(문장과 화면에는 넣지 않는다). 요청의 `kind`·`type`은 그대로 `requireValue`다(저장된 자료가 아니라 이 앱이 만드는 요청이다).
- 선택 키는 지워서 되돌린다: `surface`·`color`는 없으면 지금의 동작이고, 기본으로 되돌릴 때는 키를 지운다(`null`·`undefined`로 두지 않는다 — 응답 유실 복구가 보낸 도면과 저장된 도면을 그대로 견준다). 이미 있는 노드의 이 키를 바꾸는 곳은 `setSpaceSurface`·`setCameraColor` 둘뿐이고(새 도로의 `surface`만은 `newSpace`가 넣어 만든다) `patchNode`로 쓰지 않는다(합치기만 해서 지울 수 없다 — 앵커 43).
- 도로는 `isRoadSpace`·`spaceWallHeight`·쌓임 순서의 층이다: 도로인지는 `isRoadSpace` 하나로 읽고, 벽이 없어 세로 크기는 `spaceWallHeight`(도로 0)로 읽으며(`nodeVolumeHeight`는 저장된 값이고 도로인 동안 쓰지 않는다), 쌓임 순서의 층(`mapStack.ts` 비교의 맨 앞 항 — 도로는 크기와 무관하게 모든 방 아래)으로 방과 갈린다. 쌓임 순서를 읽는 여섯 곳(평면 그리기, `planPileAt`, 보조 평면도, `pickMapFloor`, `mapFloorPile`, `placeSymbol`)의 읽는 줄은 고치지 않았다. 3D의 처음 누름은 `pickMapNode`의 맨 앞 걸음(`roadsUnderRooms`)이 맡는다: 같은 광선의 방과 `spacesOverlap`으로 겹친 도로만 진다 — 넓이를 나눠 가져야 겹친 것이고 변이나 모서리만 맞닿은 것은 아니다. 겹치지 않는 도로에는 v1.132.0의 규칙이 그대로 쓰인다(겹침 검사를 빼면 길가 건물이 길을 가로막는다). 다시 누름의 더미는 `mapSpacePile` 한 곳이고 클릭(`mapClickStep`)과 손잡이 위의 클릭(`BackgroundMap3D.tsx`의 `pick`)이 함께 쓴다 — 한쪽이라도 `mapFloorPile`을 직접 부르면 건물 밑의 도로에 닿지 못한다. `pickMapFloor`·`mapFloorPile`에는 도로 규칙을 넣지 않는다(기호를 놓는 자리, 바닥끼리의 순서). 큰 방 안에 통째로 든 도로는 몸통을 바로 누를 수 없다(천천히 다시 누르기·Shift+상자·목록과 손잡이 — 속성 칸의 `ROAD_HINT`가 그 길을 말한다): 쌓임 규칙의 결과이니 '고치지' 않는다. 새 카메라의 소속은 방이 먼저이고 방이 없을 때만 도로다.
- 가운데 점선의 띠 규칙 넷: 가운데 점선은 `roadCentreLine` 한 곳이 정하고 평면·보조 평면도·3D가 함께 읽는다. 사각형은 긴 쪽을 따라 끝에서 끝까지 그린다. 다각형은 두 옆줄의 점을 하나씩 짝지은 띠가 (가) 칸마다 볼록하고 (나) 안쪽 가로대가 그 자리의 길 방향(만나는 두 구간의 이등분 방향)과 60° 이상이고 (다) 선이 가장 긴 가로대보다 짧지 않고 (라) 선이 다각형 안에 있을 때만 그린다(설계 7.4). 타원과 점이 홀수 개인 다각형에는 없다. 점의 수가 짝수인 것만으로 그리지 않는다(한쪽 옆줄에만 점이 많으면 선이 가장자리로 빠진다). 점선이 없는 도로에는 속성 칸이 까닭을 말한다. 평면에서 도로의 이름에는 글자 테두리가 있고 그 굵기는 글자처럼 `--bmap-label-scale`을 곱한다(고정값이면 축소한 도면에서 테두리가 사라져 점선이 이름을 긋는다).
- 색은 이름(칸의 이름)으로, 동그라미는 여섯: 카메라 색은 이름으로 저장하고 값은 화면이 정한다 — 3D는 `mapCameraColor.ts`, DOM은 `backgrounds-map.css`의 `--bmap-cam`(숫자 셋)이며 두 벌은 테스트가 견준다. 저장되는 이름 여섯(`red`·`lime`·`green`·`teal`·`blue`·`pink`)은 칸의 이름이라, 칸의 색과 화면 이름은 migration 없이 고칠 수 있고 운영 DB의 여섯 이름은 다시 건드리지 않는다. 호박색은 저장하지 않는다(키가 없는 것이 호박색이고, 색이 없는 카메라의 모습은 v1.132.0과 같다). 속성 칸의 동그라미는 승인된 수인 여섯 개이고, 호박색으로 돌아가는 길은 동그라미가 아닌 '기본 색으로' 글자 버튼이다.
- 1.1의 I1~I6에 다른 답이 왔을 때 고칠 곳: 설계 1.1 끝의 표에 줄마다 적혀 있고, 여섯 다 운영 DB를 다시 건드리지 않고 고칠 수 있다 — I1 '기본 색으로' 버튼만 뺀다 / I2 `roadCentreLine`의 다각형 가지를 `null`로 / I3 `addMapCamera`의 도로 가지를 뺀다 / I4 `roadsUnderRooms`의 겹침 검사, 또는 `pickMapNode`의 그 걸음과 `mapSpacePile` / I5 쌓임의 층을 다시 정한다(`stackedSpaces`와 설계 7.6·7.7·10.3의 표) / I6 운영 DB 적용 전이면 이름까지(상수·요소 파일·CSS·색 표), 적용 뒤면 값과 화면 이름만. I6의 여섯 색 화면은 2026-10-10에 한솔에게 보였고, 답은 운영 DB를 적용하기 전에 오케스트레이터가 적는다.
- **새 모양이 저장된 뒤에는 이 화면에 관한 한 앞으로만 고친다**: 계단·도로·카메라 색이 하나라도 저장된 뒤에는, v1.133.0보다 앞선 소스로 만든 빌드는 버전 번호를 더 높게 붙여도 배경 라이브러리를 열지 못한다(빨간 오류 띠 — 설계 5.1의 표. 자료와 요소 파일은 그대로다). v1.133.0에 고칠 것이 생기면 v1.133.0이나 그 뒤의 소스에서 고쳐 더 높은 번호로 낸다. `DEVLOG/DEPLOYMENT.md`의 "이전 커밋으로 되돌려 다시 빌드"는 이 경우에 쓰지 않는다. 옛 빌드가 열리게 하려고 저장된 계단·도로·색을 지우거나 바꾸지 않는다.

### 17.5 뒤 차례가 정할 것

- ④의 migration 파일은 사슬의 넷째로 붙는다(기본 → 3D → 요소 → ④). ④는 `background_library_snapshot`·`background_library_execute`를 다시 만드는 파일이라 검증 함수의 사슬과는 독립이지만, 적용하고 다시 돌리는 순서는 하나로 적는다. ④가 자기 머리말과 앞의 세 파일의 머리말에 한 줄씩 더한다(앞의 파일은 머리말 주석만 고친다).
- **④가 `CLAUDE.md` :3·`AGENTS.md` :3의 시험 공개 안내 줄을 다시 쓸 때 사슬 문장을 옮겨 적는다.** 계약 테스트 D4는 그 두 줄의 글자를 고정하지 않는다(옛 두 파일 규칙의 문장이 남아 있지 않다는 것만 본다). 긍정 문구는 `AGENTS.md`의 데이터 경계 항목과 세 SQL 파일의 머리말에서 본다 — ④가 그 항목이나 머리말의 문장을 고치면 같은 변경에서 D4를 맞춘다(`npm run build`가 `test:background`를 돌리므로 어긋나면 배포 빌드가 멈춘다).
- ⑤의 주석 핀이 도로·계단과 어떻게 놓이는지(쌓임·누름·상자)는 ⑤가 정한다. 주석은 별도 표라 이번 저장 계약과는 무관하다.
