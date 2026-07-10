# 내 할일 개인 투두 개인화 확장 설계

> **작성일**: 2026-07-10
> **상태**: UX 확정 완료, 구현 계획 작성 전 사용자 문서 검토 대기
> **토대**: `2026-06-28-mytasks-widget-redesign-design.md`와 현재 구현된 `MyTasksWidget`
> **범위**: 개인 투두만 확장. 담당 씬·캐릭터 작업의 기존 동작과 디자인은 유지

---

## 1. 배경과 목표

현재 `내 할일` 위젯은 담당 씬·캐릭터 작업과 개인 투두를 한곳에서 보여주고, 개인 투두에는 완료 토글·수동 정렬·상세 메모·날짜·캘린더 연동을 제공한다.

이번 확장의 목표는 개인 투두를 상용 투두 앱처럼 더 빠르게 분류하고, 중요한 일을 놓치지 않으며, `할 일 → 진행 중 → 완료` 흐름을 위젯 안에서 바로 처리할 수 있게 만드는 것이다. 기존 위젯의 전체 프레임·도넛·리스트/카드 전환·완료 섹션·빠른 추가 흐름은 유지하고, 개인 투두 행 내부의 체크·메타데이터·행동 영역만 확장한다.

### 성공 기준

- 사용자가 중요한 **개인 투두만** 위젯 최상단 고정 패널에 둘 수 있다.
- 개인 투두에 여러 색상 레이블과 우선순위를 지정할 수 있다.
- 행의 다음 단계 버튼만으로 `시작하기 → 완료하기`를 처리할 수 있다.
- 완료한 항목은 기존 완료 섹션으로 이동하고 `다시 열기`로 복구할 수 있다.
- 상세 모달에서 고정·상태·우선순위·레이블을 직접 편집할 수 있다.
- 메모 입력칸은 내용에 맞춰 늘어나되 모달이 화면 밖으로 커지지 않는다.
- 대시보드·팝업·리스트·카드·다크/라이트·테스트 모드에서 같은 개인화·상태 기능이 동작한다. 드래그 정렬만 기존처럼 리스트 보기 전용이다.
- 모든 변경은 낙관적으로 즉시 보인다. DB가 명시적으로 거부한 변경은 직전 서버 확정값으로 돌아가고, 응답 유실처럼 저장 결과가 불명확한 경우에는 서버를 다시 읽어 실제 결과를 확인한 뒤 화면을 맞춘다.

---

## 2. 사용자 확정 결정

브라우저 인터랙티브 목업을 통해 다음 방향을 확정했다.

1. **상단 고정 대상**: 개인 투두만. 씬·캐릭터 작업은 고정 기능을 갖지 않는다.
2. **고정 표현**: 별도 보라색 강조 패널인 `나의 고정`으로 표시한다.
3. **레이블**: 한 투두에 여러 개를 붙일 수 있다. 위젯 행에는 최대 2개와 나머지 개수(`+N`)만 표시한다.
4. **우선순위**: `높음 / 보통 / 낮음 / 없음`. 정렬 조건이 아니라 시각 표시다.
5. **상세 모달**: 제목 바로 아래 한 줄 도구 영역에 고정·상태·우선순위·레이블을 둔다.
6. **상태 흐름**: `할 일 → 진행 중 → 완료` 3단계다.
7. **위젯 상태 조작**: 현재 상태를 작게 표시하고, 다음 행동 버튼만 크게 노출한다.
   - `할 일` → `시작하기`
   - `진행 중` → `완료하기`
   - `완료` → 완료 섹션의 `다시 열기`
8. **메모**: 3줄에서 시작해 약 10줄까지 내용에 맞춰 자동 확장하고, 이후 내부 스크롤로 전환한다.
9. **추가 버튼**: 기존 헤더 위치를 유지하되 기본 상태에서도 분명히 보이는 액센트 버튼으로 키운다.

이 문서가 확정된 구현 기준이며, 세션 중 생성한 로컬 목업 파일은 참고용일 뿐 배포 자산으로 포함하지 않는다.

---

## 3. 비목표

- 씬·캐릭터 작업에 고정·레이블·우선순위·3단계 상태를 추가하지 않는다.
- 카테고리·프로젝트·태그를 서로 다른 분류 체계로 만들지 않는다. 이번 범위에서는 모두 `레이블` 하나로 통합한다.
- 우선순위에 따라 목록을 자동 정렬하지 않는다.
- 하위 작업, 반복 작업, 알림, 칸반, 아이젠하워 매트릭스를 추가하지 않는다.
- 사용자 지정 HEX 색상은 제공하지 않는다. 검증된 고정 팔레트에서 선택한다.
- 메모를 리치 텍스트 편집기로 바꾸지 않는다.
- 레이블 전용 관리 화면이나 대규모 일괄 편집 기능을 만들지 않는다.
- 위젯 전체의 도넛·카드·모션·완료 축하 디자인을 재설계하지 않는다.

---

## 4. UX 설계

### 4.1 위젯 헤더와 빠른 추가

- 기존 헤더 오른쪽 `+` 위치는 유지한다.
- 현재 12px 아이콘과 희미한 색상 대신 약 30~32px 클릭 영역, 16px 전후 아이콘, 액센트 배경을 사용한다.
- `+` 클릭 후 나타나는 기존 `QuickAdd`의 제목 우선 흐름은 유지한다.
- `QuickAdd`, 전체 추가 모달의 개인 탭, 레거시 localStorage·`task_views` 마이그레이션을 포함한 **모든 개인 투두 생성 경로**가 같은 기본값을 채운다.
- 새 개인 투두의 기본값:
  - 상태 `할 일`
  - 고정 안 함
  - 우선순위 `없음`
  - 레이블 없음
- 고정·우선순위·레이블은 생성 후 상세 모달에서 지정한다. 빠른 추가를 복잡한 입력 폼으로 키우지 않는다.

### 4.2 목록의 전체 순서

미완료 영역은 아래 순서로 렌더한다.

1. `나의 고정`: `pinned=true`이고 상태가 `할 일` 또는 `진행 중`인 개인 투두
2. 기존 담당 씬
3. 기존 캐릭터 작업
4. 고정하지 않은 개인 투두
5. 기존 `완료된 항목` 접이식 섹션

완료된 투두는 `pinned=true`여도 고정 패널에 남지 않고 완료 섹션으로 이동한다. `다시 열기`를 누르면 상태가 `할 일`이 되며, 기존 `pinned` 값이 유지되어 원래 고정 투두였다면 다시 고정 패널로 돌아온다.

- 미완료에서 `완료`가 되면 완료 그룹의 마지막에 넣는다.
- `다시 열기` 또는 상세 모달의 `done → todo/doing`은 기존 `pinned` 값에 따라 고정/일반 미완료 그룹의 마지막에 넣는다.
- 같은 미완료 그룹 안의 `todo ↔ doing`은 현재 수동 순서를 유지한다.

### 4.3 `나의 고정` 패널

- 기존 카드 토큰과 보라색 액센트를 사용한 얇은 독립 패널이다.
- 패널 제목은 `나의 고정 N`이며 N은 현재 표시 중인 미완료 고정 개인 투두 수다.
- 같은 투두를 일반 개인 투두 목록에 중복 표시하지 않는다.
- 리스트 보기에서는 고정 항목끼리 드래그 정렬할 수 있다.
- 고정과 일반 영역 사이의 드래그 이동은 제공하지 않는다. 상세 모달의 고정 토글이 그룹 이동의 유일한 방식이다.
- 고정을 켜면 고정 그룹의 마지막으로, 끄면 일반 개인 투두 그룹의 마지막으로 이동한다.
- 저장 배열은 `미완료 고정 → 미완료 일반 → 완료` 순서로 다시 합친 뒤 기존 `sort_order`를 전체 재색인한다. 그룹별로 같은 순번이 생기거나 DB tie 순서에 기대지 않는다.
- 카드 보기에서는 기존 카드 그리드를 보라색 패널 안에 렌더하며, 현재와 같이 카드 드래그 정렬은 제공하지 않는다.

### 4.4 개인 투두 행과 카드

개인 투두 행의 정보 우선순위는 다음과 같다.

1. 우선순위 색상선
2. 제목
3. 레이블 최대 2개와 `+N`
4. 현재 상태 보조 문구
5. 다음 단계 버튼

기존의 단순 완료 원형 체크는 개인 투두 행에서 다음 단계 버튼으로 대체한다. 씬·캐릭터 작업의 기존 체크 및 단계 UI에는 영향이 없다.

- 기존 드래그 핸들은 리스트 보기에서 유지한다.
- 고정 문구 `::개인`은 제거한다. 고정 패널 또는 `개인 할 일` 섹션이 이미 개인 투두임을 설명하고, 같은 자리를 사용자 레이블에 사용한다.
- 기존 메모 미리보기는 넓은 행에서 레이블 뒤에 한 줄로 유지한다. 공간이 부족하면 메모 미리보기부터 숨기며, 전체 메모는 상세 모달에서 항상 볼 수 있다.
- 기존 hover 삭제 버튼은 데스크톱 리스트에서 유지하고, 상세 모달 하단에도 `삭제`를 제공해 키보드·좁은 팝업에서도 접근 가능하게 한다. 삭제 전에는 확인을 받는다.

#### 다음 단계 버튼

| 현재 상태 | 보조 문구 | 버튼 | 결과 |
|---|---|---|---|
| `할 일` | `현재 할 일` | `시작하기` | `진행 중`으로 변경 |
| `진행 중` | `현재 진행 중` | `완료하기` | `완료`로 변경 후 완료 섹션 이동 |
| `완료` | `완료` | `다시 열기` | `할 일`로 변경 후 미완료 영역 복귀 |

- 버튼 클릭은 행의 상세 모달 열기와 분리하고 이벤트 전파를 막는다.
- 제목·메모 영역 클릭은 기존처럼 상세 모달을 연다.
- 상태 저장 실패 시 행 위치·상태·통계가 함께 이전 값으로 돌아간다.
- 카드 보기에서는 동일 버튼을 카드 하단 우측에 둔다.

### 4.5 우선순위

- 값은 `high / medium / low / none` 네 가지다.
- 표시 이름은 `높음 / 보통 / 낮음 / 없음`이다.
- 행·카드에는 왼쪽 3px 전후의 색상선으로 표시한다.
  - 높음: 붉은 계열 + 전체 높이 실선
  - 보통: 주황 계열 + 가운데가 나뉜 2단 선
  - 낮음: 파란 계열 + 짧은 하단 선
  - 없음: 색상선 없음
- 색상선에는 `높음/보통/낮음` 접근성 이름과 tooltip을 함께 제공해 색만으로 구분하지 않는다.
- 우선순위는 기존 사용자의 수동 드래그 순서를 바꾸지 않는다.
- 상세 모달에서만 값을 편집한다.

### 4.6 레이블

- 레이블은 개인별 재사용 목록이다.
- 각 레이블은 이름과 고정 팔레트 색상 키를 가진다.
- 한 투두에 여러 레이블을 선택할 수 있다.
- 행·카드에는 선택 순서 기준 앞 2개만 보여주고, 나머지는 `+N`으로 접는다.
- 상세 모달의 `+ 레이블` 버튼은 개인 레이블 선택기를 연다.
- 선택기에서 기존 레이블을 선택하거나 `이름 + 색상`으로 새 레이블을 만든다.
- 선택된 칩의 `×` 또는 선택기 재클릭으로 현재 투두에서 레이블을 제거한다.
- 선택기 안의 `편집` 액션으로 기존 레이블의 이름·색상을 수정할 수 있으며, 변경은 그 레이블을 사용한 모든 개인 투두에 반영된다.
- 레이블 이름은 앞뒤 공백을 제거하며, 같은 사용자 안에서 대소문자와 앞뒤 공백을 무시한 중복 이름 생성을 막는다.
- 레이블 이름은 1~24자로 제한한다.
- 팔레트 키와 기준색은 다음 8개로 고정한다: `violet #8B7CF6`, `blue #67A9FF`, `green #5BC5A7`, `yellow #E8C261`, `orange #EF9F55`, `red #EF6A78`, `pink #E984B4`, `gray #8B8DA3`. 실제 칩 배경·텍스트는 다크/라이트 테마별 파생 토큰으로 대비를 맞춘다.
- 첫 구현에는 별도 레이블 관리 화면과 전역 레이블 삭제를 넣지 않는다. 오타와 색상 수정은 선택기 안의 편집으로 해결한다.
- 새 레이블의 이름·색상을 입력만 한 상태에서 `취소`, Escape, 선택기 바깥 클릭을 하면 draft를 버리고 저장하지 않는다. Escape는 먼저 레이블 선택기만 닫고, 다시 누를 때 상세 모달을 닫는 중첩 순서를 지킨다.
- 선택기는 뷰포트 안으로 위치를 보정하고 최대 높이를 `min(320px, 가용 높이)`로 제한하며, 넘는 레이블 목록만 내부 스크롤한다.

### 4.7 상세 모달

기존 `TodoDetailModal`의 제목·메모·날짜·캘린더 구조를 유지하면서 제목 아래에 속성 도구줄을 추가한다.

도구줄 순서:

1. `상단 고정` 토글
2. 상태 선택: `할 일 / 진행 중 / 완료`
3. 우선순위 선택
4. 선택된 레이블 칩
5. `+ 레이블`

- 위젯 행에서는 다음 행동만 보여주지만 상세 모달에서는 세 상태를 직접 선택해 되돌릴 수 있다.
- 완료 상태를 직접 선택하면 모달이 열린 상태에서도 뒤의 목록이 완료 섹션으로 이동한다.
- 완료된 상태에서 `pinned=true`인 경우 고정 토글 아래에 `다시 열면 나의 고정으로 돌아갑니다` 보조 문구를 표시한다.
- 제목·메모는 현재처럼 입력 중 로컬 상태를 사용하고 blur 시 저장한다.
- 고정·상태·우선순위·레이블은 선택 즉시 낙관적으로 반영한다.
- 날짜·캘린더 연동 UI와 `캘린더에서 보기` 동작은 그대로 유지한다.

### 4.8 반응형 메모

- 기존 공용 `EntityAwareInput`의 `autoGrow` 기능을 사용하되 최대 높이 제어를 보강한다.
- 기본 최소 높이는 약 3줄이다.
- 값이 입력·삭제되거나 외부 동기화로 바뀔 때마다 높이를 다시 계산한다.
- 최대 높이는 `약 10줄`과 `모달 가용 높이의 40%` 중 작은 값이다.
- 최대값을 넘으면 입력칸만 세로 스크롤한다.
- 사용자가 긴 메모를 가진 투두를 열었을 때도 첫 렌더 직후 저장된 내용 높이에 맞춰 확장한다.
- 수동 resize 핸들은 노출하지 않는다.
- 메모의 `#` 자동완성은 계속 끈다. 캘린더 평문 동기화에서 직렬화 토큰이 노출되지 않게 하기 위함이다.

### 4.9 완료·통계·빈 상태

- `완료`만 완료 개수와 완료율에 포함한다.
- `할 일`과 `진행 중`은 모두 미완료 개수에 포함한다.
- 도넛 보조 문구는 `완료 N · 진행 중 N`을 표시한다. 도넛 구조와 완료율 계산 방식 자체는 바꾸지 않는다.
- 모든 미완료 항목이 0이면 기존 완료 축하와 콘페티를 유지한다.
- `할 일 → 진행 중`에는 완료 축하를 실행하지 않는다. `진행 중/할 일 → 완료`로 마지막 미완료 항목이 사라질 때만 기존 축하를 실행한다.
- 고정 항목이 없으면 고정 패널 전체를 렌더하지 않는다.
- 전체가 비어 있을 때 기존 빈 상태 문구와 강화된 `+` 버튼 안내를 유지한다.
- 캘린더에서 todo ID로 돌아오는 기존 하이라이트는 고정·일반·완료 그룹을 모두 찾는다. 완료 항목이면 완료 섹션을 자동으로 펼친 뒤 scroll/highlight한다.

### 4.10 접근성·모션·테마

- 모든 상태 버튼과 토글은 실제 `<button>` 또는 `<select>`를 사용한다.
- 현재 상태는 색만으로 구분하지 않고 텍스트를 함께 표시한다.
- 키보드 포커스 링과 `aria-label`·`aria-pressed`를 제공한다.
- `prefers-reduced-motion`에서는 그룹 이동·완료 이동을 즉시 처리하고 장식 모션을 줄인다.
- 다크·라이트 모드는 기존 의미 토큰을 사용한다. 우선순위·레이블 팔레트는 두 테마에서 WCAG AA 수준의 텍스트 대비를 확인한다.
- 좁은 팝업에서는 제목이 먼저 줄임표 처리되고 상태 버튼의 최소 폭은 유지한다.
- 위젯 콘텐츠 폭 340px 이상에서는 레이블 최대 2개를 표시한다. 340px 미만에서는 첫 레이블과 `+N`만 표시하고 메모 미리보기는 숨긴다.
- 300px 안팎의 매우 좁은 행에서는 다음 단계 버튼을 메타데이터 아래 우측으로 내려 버튼 문구가 잘리지 않게 한다.
- 팝업 상세 모달은 현재 동작처럼 가능한 경우 최소 520px로 창을 키운다. 화면 제약으로 그 폭을 확보하지 못하면 속성 도구줄을 `고정·상태·우선순위`와 `레이블` 두 줄로 감싼다.
- 위젯 행의 다음 단계 버튼을 키보드로 눌러 그룹이 이동한 뒤에도 초점을 잃지 않는다. 이동된 행의 다음 행동 버튼이 렌더돼 있으면 그 버튼으로, 완료 섹션이 접혀 있으면 완료 섹션 토글로 초점을 옮긴다. `다시 열기` 후에는 복귀한 행의 `시작하기`로 초점을 옮긴다.
- 상세 모달의 상태 select로 직접 상태를 바꿀 때는 배경 행으로 초점을 보내지 않고 select 또는 모달 안의 다음 유효 control에 유지해 focus trap을 지킨다. 배경 목록이 그룹 이동해도 모달을 닫기 전에는 초점이 모달 밖으로 나가지 않는다.
- `Reorder.Item`의 드래그는 기존 드래그 핸들에서만 시작한다. 상태·삭제·레이블 버튼의 pointer 입력은 드래그를 시작하지 않는다.

---

## 5. 데이터 모델

### 5.1 개인 투두

`PersonalTodo`에 다음 필드를 추가한다.

```ts
export type PersonalTodoStatus = 'todo' | 'doing' | 'done';
export type PersonalTodoPriority = 'none' | 'low' | 'medium' | 'high';

export interface PersonalTodo {
  // 기존 필드 유지
  status: PersonalTodoStatus;
  priority: PersonalTodoPriority;
  pinned: boolean;
  labelIds: string[];
}
```

DB `personal_todos`에는 다음 컬럼을 추가한다.

- `status text not null default 'todo'` + CHECK 제약
- `priority text not null default 'none'` + CHECK 제약
- `pinned boolean not null default false`
- `label_ids uuid[] not null default '{}'`

### 5.2 `completed` 호환

현재 DB와 구버전 앱은 `completed boolean`을 사용한다. 혼용 기간의 데이터 손상을 막기 위해 다음 원칙을 사용한다.

- 새 코드의 권위값은 `status`다.
- 기존 `completed` 컬럼은 즉시 제거하지 않고 호환 미러로 유지한다.
- 마이그레이션 시 기존 `completed IS NULL`을 먼저 `false`로 정규화하고 `completed`를 `NOT NULL DEFAULT false`로 강화한 뒤, `true`는 `done`, `false`는 `todo`로 backfill한다.
- `BEFORE INSERT OR UPDATE` DB trigger가 두 필드를 동기화한다.
  - INSERT: 구버전 입력처럼 `COALESCE(completed, false)=true`이고 `status`가 기본 `todo`면 `status=done`으로 보정한다. 그 외에는 전달된 유효 `status`를 유지하고, 최종적으로 `completed = (status = 'done')`를 맞춘다.
  - UPDATE에서 `status`가 바뀌면 `completed = (status = 'done')`로 맞춘다.
  - UPDATE에서 `status`는 그대로이고 구버전 코드가 `completed`만 바꾸면 `true → done`, `false → todo`로 맞춘다.
  - 두 필드가 동시에 바뀌고 값이 충돌하면 새 권위값인 `status`를 우선한다.
- 새 앱의 read mapper는 `status`가 없거나 비정상인 레거시 응답에 한해 `completed`로 fallback한다.
- renderer의 `completed` 호환 필드는 항상 `status === 'done'`에서 파생한다. 새 write DTO는 `completed`를 입력으로 받지 않고 Electron mapper가 `status`에서 계산해 DB에 함께 쓴다.
- 통계·그룹 분류·새 UI는 모두 `status`를 기준으로 한다.

### 5.3 개인 레이블

재사용 가능한 개인 레이블을 위해 `personal_todo_labels` 테이블을 추가한다.

```ts
export type PersonalTodoLabelColorKey =
  | 'violet' | 'blue' | 'green' | 'yellow'
  | 'orange' | 'red' | 'pink' | 'gray';

export interface PersonalTodoLabel {
  id: string;
  userId: string;
  name: string;
  colorKey: PersonalTodoLabelColorKey;
  createdAt: string;
  updatedAt: string;
}
```

```text
id          uuid primary key default gen_random_uuid()
user_id     text not null references users(id) on delete cascade
name        text not null check (char_length(btrim(name)) between 1 and 24)
color_key   text not null check (color_key in ('violet','blue','green','yellow','orange','red','pink','gray'))
created_at  timestamptz not null default now()
updated_at  timestamptz not null default now()
```

- `user_id, lower(btrim(name))` 표현식 unique index로 사용자별 중복 이름을 막는다.
- create·update 시 이름은 서버에서 `btrim(name)`으로 정규화한 값을 저장한다.
- `updated_at`은 기존 테이블 패턴과 같은 update trigger로 자동 갱신한다.
- 선택기에서는 현재 선택된 레이블을 먼저, 나머지는 `lower(name), created_at, id` 순으로 표시한다. 별도 수동 레이블 정렬은 제공하지 않는다.
- 이 앱은 Supabase Auth 세션 없이 anon key를 사용하므로 `auth.uid()` 기반 RLS를 전제로 하지 않는다. `personal_todo_labels`는 현재 `personal_todos`와 같은 내부 도구 신뢰 모델로 **RLS를 비활성화**하고 anon role에는 조회·생성·수정 권한만 준다. 삭제는 사용자 삭제 RPC 안에서만 수행한다. 실제 소유권은 Electron main의 현재 세션 사용자 ID와 모든 query의 `user_id` 필터로 강제한다.
- 허용 `color_key`는 앱의 고정 팔레트 목록으로 제한한다.
- `personal_todos.label_ids`는 선택 순서를 보존한다.
- todo patch/RPC가 `label_ids`를 받을 때 중복 UUID를 첫 등장 순서대로 제거하고, 모든 ID가 handler 진입 때 캡처한 사용자의 `personal_todo_labels`에 속하는지 set equality로 검증한다. 타 사용자·임의 ID가 하나라도 있으면 전체 변경을 거부한다.
- 첫 구현에는 레이블 삭제 UI가 없으므로 dangling ID 삭제 흐름은 만들지 않는다. 표시 resolver는 존재하지 않거나 아직 로드되지 않은 ID의 칩만 숨기되 원본 `labelIds` 배열은 그대로 보존한다. 사용자가 레이블 선택을 명시적으로 바꾸기 전에는 누락 ID를 자동 저장으로 제거하지 않는다.
- 새 레이블은 spinner가 있는 임시 칩을 먼저 보여주고, 즉시 main queue에 `create-or-reuse label + 현재 todo attach` 복합 intent를 넣는다. main의 한 트랜잭션이 서버 UUID를 확정하고 해당 UUID를 todo `label_ids`에 append-if-missing으로 붙여 둘 중 하나만 저장되는 상태와 재시도 중복을 막는다. todo가 이미 삭제됐다면 canonical label과 `todo=null`을 반환한다.
- 생성 응답 전에는 임시 칩의 `×`와 선택기 재클릭 해제를 잠시 비활성화한다. 응답이 오면 canonical UUID 칩으로 바뀌고 즉시 일반 해제가 가능하다. 오래 걸리거나 결과가 불명확하면 임시 칩을 `동기화 확인 필요` 상태로 바꾸고 `다시 확인`을 제공한다.
- `새 레이블 만들기`를 누른 순간 create+attach가 접수된다. 모달 닫기·계정 전환은 취소가 아니며, 계정 전환은 old-user queue drain 뒤 진행한다. 응답이 renderer에 도착하면 같은 `sessionEpoch`와 현재 todo 존재 여부를 확인한 뒤에만 현재 UI의 임시 칩을 canonical UUID로 치환한다. stale 응답은 새 사용자 화면에서만 무시되고 main이 캡처한 옛 사용자의 저장 결과는 유지된다.
- 상세 모달이나 popup BrowserWindow 자체가 닫혀도 main queue가 복합 intent를 끝낸다. 생성 중 todo 삭제를 눌렀다면 뒤에 접수된 delete intent가 같은 queue에서 최종 todo를 제거한다.
- 새 레이블 생성이 unique 충돌하면 같은 정규화 이름의 기존 레이블을 재사용하고 main의 같은 트랜잭션에서 그 UUID를 todo에 붙인다. 이름 수정이 다른 기존 레이블과 충돌하면 자동 병합하지 않고 선택기 안에 중복 오류를 표시한다.
- 사용자 삭제 시에는 `users(id)` 삭제에 연결된 FK `ON DELETE CASCADE`가 개인 레이블을 정리한다. anon label DELETE 권한이나 별도 label DELETE 문을 `delete_user_cascade`에 추가하지 않는다.

배열 컬럼을 택한 이유는 투두당 레이블 수가 작고, 별도 연결 테이블·다중 왕복·낙관적 롤백 복잡도를 피하면서 선택 순서를 보존하기 위해서다.

### 5.4 쓰기 계약

renderer 공개 쓰기는 목적별로 다음 계약으로 나눈다.

| 계약 | 허용 범위 | 반환 |
|---|---|---|
| `patchTodo(id, patch)` | `title, memo, startDate, endDate, addToCalendar, priority, labelIds`, `done` 경계를 넘지 않는 `todo ↔ doing` | trigger 적용 후 canonical todo 1건 |
| `applyCalendarToTodoPatch(id, patch)` | calendar sync가 보낸 `title, memo, startDate, endDate, addToCalendar` DB-only patch | canonical todo 1건 |
| `mutateTodoOrder(mutation, orderedIds)` | `create`, `delete`, `setPinned`, `setStatusAndOrder`, `reorder` | 트랜잭션 후 canonical ordered todo 전체 배열 |
| `createOrReuseLabelAndAttach({ todoId, name, colorKey })` | 같은 이름 label create-or-reuse + todo append-if-missing attach | canonical label + canonical todo 또는 `todo=null` |

- 모든 계약은 userId를 받지 않는다.
- main이 필드 allowlist, 상태 전이, label 소유권, ordered ID 소유권을 검증한다.
- UI용 전체 객체 upsert 계약은 제공하지 않는다.
- 새 todo ID는 renderer가 UUID로 먼저 만들며, create 재시도는 같은 사용자·같은 ID면 기존 canonical row를 반환한다. delete는 같은 사용자 범위에서 이미 사라진 ID도 성공으로 취급한다. `setPinned`는 목표 boolean을, `setStatusAndOrder`는 `{ id, targetStatus: 'todo' | 'doing' | 'done' }`를, reorder는 목표 ordered IDs를 보낸다. 따라서 같은 의도를 다시 보내도 결과가 달라지지 않는 멱등 계약을 유지한다.
- 상세 모달의 `todo → done`, `done → doing`처럼 `done` 경계를 넘는 모든 상태 선택은 `setStatusAndOrder`를 사용한다. 위젯의 `다시 열기`는 `targetStatus='todo'`를 보낸다. `todo ↔ doing`만 순서를 바꾸지 않는 `patchTodo`를 사용할 수 있다.
- todo UI의 `patchTodo`가 `title / memo / startDate / endDate / addToCalendar`를 바꾸고 연결된 캘린더 이벤트에도 영향이 있으면 main이 내부적으로 `applyTodoCalendarComposite` 경로로 라우팅한다. 이 경로는 복구 journal 등록과 todo DB patch를 먼저 확정하고 Google Calendar 반영은 main의 별도 todo별 worker가 이어 처리한다. renderer가 DB patch 뒤 별도 calendar IPC를 호출하지 않는다.
- Google webhook/incremental sync에서 시작한 역방향 변경은 별도 `applyCalendarToTodoPatch`를 사용한다. main은 허용 필드를 runtime validation한 뒤 todo DB만 갱신하고 Google Calendar에 다시 쓰지 않아 `GCal → todo → GCal` echo loop를 막는다.

---

## 6. 컴포넌트와 책임 경계

### `MyTasksWidget.tsx`

- 전체 렌더 순서와 고정 패널 배치
- 리스트·카드·팝업 문맥 조합
- 강화된 `+` 버튼 상태
- 선택된 상세 모달 연결

### `useMyTasksData.ts`

- 개인 투두·개인 레이블 로드 및 레거시 필드 기본값 정규화
- `pinnedTodos / normalTodos / doneTodos` 파생
- 상태·고정·우선순위·레이블 낙관적 변경과 롤백
- 그룹별 드래그 순서 저장
- 캘린더 양방향 동기화
- 창 간 todo·label 변경 방송·재로드
- 신규 renderer `ensureCanonicalSession()` barrier를 await한 뒤 첫 개인 데이터 read를 시작한다. 이 helper는 main-confirmed current session 또는 in-flight login/restore Promise를 재사용하고 로그아웃 때 초기화한다. renderer의 사용자 ID를 main에 다시 주입하거나 현재 동기형 Zustand setter의 호출 순서에 의존하지 않는다.
- `sessionEpoch/loadGeneration`으로 초기 load·창 간 reload·mutation 응답을 사용자 세션에 묶는다. 응답 적용 직전 현재 epoch와 사용자를 다시 확인한다.
- renderer는 optimistic state·confirmed baseline·pending intent·reconcile만 담당한다. mutation 직렬화는 창별 hook에 두지 않고 모든 BrowserWindow가 공유하는 Electron main queue에 맡긴다.
- 계정 전환·로그아웃 요청은 main의 현재 사용자 DB queue drain과 calendar journal 영속이 성공한 뒤 canonical session을 바꾼다. 실패 시 전환을 중단하고 오류를 알린다. renderer 세션이 바뀌면 이전 snapshot·label cache·pending ID map을 비우고, 이미 실행 중이던 이전 사용자 응답은 저장 결과와 무관하게 새 renderer 상태에 적용하지 않는다.

### 표시 컴포넌트

- `TodoRow`: 우선순위선, 레이블 요약, 현재 상태, 다음 단계 버튼
- `TodoCard`: 카드 보기에서 같은 의미와 버튼 제공
- `TodoDetailModal`: 속성 도구줄, 레이블 선택기, 반응형 메모
- 신규 `PinnedTodoSection`: 고정 패널 외형과 리스트/카드 배치만 담당
- 신규 순수 helper:
  - 상태 전이와 다음 행동 문구
  - 고정/일반/완료 그룹 분류
  - 레이블 2개 + `+N` 요약
  - 우선순위 표시 설정

### 인증·세션 전환

- renderer가 넘긴 `AppUser.id`는 인증 근거로 사용하지 않는다. 로그인 UI는 `{ name, password, rememberMe }`만 awaited `auth:login-session` IPC에 보내고, main이 Supabase 또는 로컬 fallback 사용자 저장소를 직접 재조회해 비밀번호를 검증한 뒤 canonical userId를 확정한다. 비밀번호는 main 밖으로 다시 방송하지 않는다.
- 로그아웃은 인자 없는 awaited `auth:logout-session`, remembered session 복원은 main이 직접 `auth.json`을 읽고 해당 userId를 사용자 저장소에서 재검증하는 `auth:restore-session`을 사용한다. renderer가 임의 next user 객체를 넘기는 `transitionSession(nextUser)` 공개 계약은 만들지 않는다.
- main은 기존 canonical 사용자의 personal data DB queue가 drain되고 calendar intent가 recovery journal에 안전하게 기록됐는지 확인한 뒤, `auth.json` 저장/삭제·`canonicalSessionUserId`·`currentActivityUser`·sanitized full session payload를 한 순서로 갱신하고 session broadcast를 보낸다. 느린 Google network worker 자체는 캡처한 old userId로 계속될 수 있어 계정 전환을 불필요하게 막지 않는다.
- main 승인 전에 DB drain, 결과 불명 DB 확인, calendar journal 기록 중 하나라도 실패하면 auth 파일·renderer store·session broadcast를 하나도 바꾸지 않고 전환을 취소한다. `UserMenu`는 처리 중 로그아웃 버튼을 비활성화하고 실패 이유를 보여준다.
- main login/logout/restore가 성공한 뒤에만 Zustand `currentUser`를 바꾼다. `useAuthStore.setCurrentUser`와 `App.tsx` effect가 별도 fire-and-forget `authSetCurrentUser`를 호출하는 현재 중복 경로는 제거하고, 내부 동기 setter와 비동기 session action을 분리한다.
- 앱 시작의 remembered session 복원과 별도 popup session 복원도 같은 main-confirmed session을 사용한다. `ensureCanonicalSession`은 in-flight login/restore Promise 또는 main의 current session 조회를 재사용해 첫 personal data read보다 항상 먼저 완료된다.
- 비밀번호 변경, 관리자 role 변경, users Realtime처럼 **같은 사용자 메타데이터만** 바뀌는 경우에는 인자 없는 `auth:refresh-canonical-user`를 호출한다. main이 현재 canonical userId로 사용자를 다시 읽어 `role / isInitialPassword / slackId` 등 sanitized metadata만 갱신·방송하며, userId·auth 파일·personal queue는 바꾸지 않는다. 현재 사용자가 삭제돼 재조회되지 않으면 안전한 logout transition으로 보낸다.

### Supabase·Electron 경계

- `electron/supabase.ts`: 새 todo 필드와 개인 레이블 조회·생성·이름/색상 수정 매핑
- `electron/main.ts`: todo·label IPC 핸들러. 소유권 전용 `canonicalSessionUserId`와 `getSessionUserIdOrThrow()`로 현재 로그인 사용자 ID를 확정한다. handler 진입 즉시 userId를 캡처해 `Map<capturedUserId, tailPromise>` 형태의 단일 `personalDataMutationQueue`에 intent를 넣고, 실행 시점의 다른 계정 세션으로 소유권을 다시 해석하지 않는다. 각 caller에는 자기 작업의 성공·실패를 그대로 반환하되 queue tail은 이전 rejection을 소비해 다음 intent가 계속 실행되게 하고, 처리 후 현재 tail identity가 같을 때만 Map entry를 제거한다. 기존 fire-and-forget `auth:set-current-user` 권위 경로는 main-verified `auth:login-session / logout-session / restore-session`으로 교체하고, `session:broadcast-change`는 main이 확정한 sanitized session을 전달하는 알림 역할만 한다.
- main personal data queue, journal intake, calendar worker의 pending Promise는 기존 앱 종료 대기 tracker에 등록한다. `before-quit`은 sheets/vacation pending과 함께 이 동적 tracker가 drain될 때까지 기존 timeout 범위에서 기다리며, 창을 먼저 닫거나 popup renderer가 파괴돼도 이미 접수된 intent는 계속 저장한다.
- 성공 broadcast는 renderer 응답에 의존하지 않고 main이 DB commit 뒤 모든 살아 있는 창에 보낸다. 따라서 요청한 popup이 먼저 닫혀도 대시보드와 다른 popup이 canonical 변경을 받는다.
- `personalDataMutationQueue`는 calendar 관련 patch의 journal 등록·DB patch까지만 직렬화한다. 느린 Google 호출은 `(capturedUserId, todoId)`별 `calendarSyncQueue`가 순서대로 처리해 무관한 todo 상태·label 저장을 막지 않는다. 같은 todo의 연속 calendar 변경은 최신 DB canonical 상태를 기준으로 합쳐 처리한다.
- calendar worker의 각 네트워크 시도는 5초가 지나면 personal data queue와 무관하게 `동기화 확인 필요`로 전환하고 background reconcile을 계속한다. worker Promise는 종료 pending tracker에 남고, 성공·보상 뒤 main이 canonical todo와 calendar payload를 broadcast한다.
- calendar composite intent는 queue 접수 전에 `path.join(app.getPath('userData'), 'personal-calendar-recovery.json')`에 atomic temp-write+rename으로 skeleton을 기록한다. 이 최초 `received` entry는 `operationId, userId, todoId, desiredPatch, targetCalendarId, candidateSourceCalendarIds, deterministicEventId, phase, createdAt, updatedAt`을 가지며 `previousCanonical`과 `dbCommittedUpdatedAt`은 `null`이다. worker가 연결 이벤트를 찾으면 실제 source calendar를 후보 배열에 보강한다.
- handler는 진입 즉시 동기적으로 `isQuitting`을 확인한다. 종료 중이 아니면 어떤 `await`보다 먼저 skeleton write부터 DB queue enqueue까지를 감싸는 `journalIntakePromise`를 dynamic pending tracker에 등록한다. atomic skeleton write와 queue enqueue가 끝난 뒤에만 intake slot을 해제해 `before-quit`이 이 짧은 구간을 pending 0으로 오판하지 않게 한다.
- `personalDataMutationQueue` 안에서 handler가 캡처한 userId로 authoritative todo row를 다시 읽은 뒤에만 `previousCanonical`을 채우고 phase를 `prepared`로 바꾼다. DB commit 뒤 반환된 canonical `updatedAt`을 `dbCommittedUpdatedAt`에 넣고 `db_committed`로 갱신한다. renderer optimistic snapshot을 복구 기준으로 journal에 쓰지 않는다.
- 이후 worker는 `calendar_unknown / compensating` phase를 갱신하고 정상 reconcile 뒤에 entry를 삭제한다. `received`나 `prepared`에서 crash가 나도 시작 복구가 current DB와 desiredPatch를 비교해 DB 적용 여부부터 판정한다.
- DB constraint·ownership validation처럼 **미적용이 확정된 실패**는 calendar worker를 시작하지 않는다. journal을 먼저 `aborted`로 atomic 갱신한 뒤 삭제하고 renderer에 확정 실패를 반환한다. 삭제만 실패하면 `aborted` entry를 다음 시작에 안전 삭제하며 desiredPatch를 재적용하지 않는다. `aborted` 기록 자체가 실패하면 sync-needed로 승격해 background cleanup을 재시도하고, 안전한 기록 전에는 session transition과 정상 종료 완료로 처리하지 않는다.
- journal의 read-modify-write는 main의 단일 journal mutex로 직렬화해 서로 다른 todo worker가 서로의 entry를 잃지 않게 한다.
- `before-quit`은 먼저 `isQuitting`을 세워 새 personal intent를 retryable `APP_QUITTING`으로 거부한 뒤, 한 번의 pending 숫자 snapshot이 아니라 동적 tracker가 0이 될 때까지 기존 종료 deadline 안에서 기다린다. deadline이 끝나도 미완료 calendar intent는 journal이 남으므로 다음 시작에 복구하며, 저장 완료로 오표시하지 않는다.
- 앱 시작 시 matching session과 Google credentials가 준비되면 journal을 읽고 현재 DB todo와 `bflow_linked_todo_id` 이벤트를 재조회한다. 목표가 이미 충족됐으면 항목을 지우고, 아니면 현재 DB canonical 상태를 우선해 멱등 재적용·조건부 보상한다. 외부 연결이 없으면 journal을 유지하고 UI에 sync-needed를 복원한다.
- 로컬 journal이 없는 다른 PC에서도 복구되도록 matching user session 시작과 온라인 복귀 시 현재 사용자의 DB todos와 접근 가능한 후보 캘린더를 audit한다. `addToCalendar=true`인데 이벤트가 0건이면 생성, 1건인데 내용이 다르면 update, 2건 이상이면 중복 정리로 보낸다. `addToCalendar=false`인데 해당 todo 연결 이벤트가 있으면 delete worker에 넣는다.
- 신규·갱신 이벤트에는 `bflow_linked_todo_id`와 함께 `bflow_todo_user_id` extended property를 저장한다. 현재 userId가 붙은 이벤트인데 대응하는 todo가 없으면 삭제된 todo의 orphan 후보로 보고 delete worker에 넣는다. userId가 없는 레거시 orphan은 임의 삭제하지 않고, 현재 사용자의 실제 todo ID와 매치될 때만 userId를 backfill한다.
- 보상 DB patch는 journal의 `dbCommittedUpdatedAt`과 현재 row가 같을 때만 적용한다. 이후 사용자의 더 최신 todo 변경이 있으면 낡은 snapshot으로 덮지 않고 현재 canonical 상태를 새 calendar 목표로 삼는다.
- renderer `localStorage`에만 있던 `personalCalendarId / lastSyncAt`은 한 번 읽어 main-owned `path.join(app.getPath('userData'), 'gcal-local-settings.json')`로 이관하고, main이 접근 가능한 calendar인지 검증한 뒤 renderer 원본을 제거한다. 이후 calendarService도 IPC로 이 설정을 읽고 쓴다.
- main의 후보 calendar set은 `primary`, Supabase team calendar metadata, main-owned personal calendar setting, journal의 target/source IDs, Google Calendar `listCalendars`에서 확인한 접근 가능한 B flow 후보를 합쳐 만든다. 따라서 worker와 시작 복구가 renderer 메모리·localStorage 없이도 같은 위치를 다시 찾을 수 있다.
- `electron/preload.ts`와 `src/types/index.ts`: 타입이 있는 브리지. 개인 todo·label API와 레거시 `task_views` API에서 `userId` 인자를 제거해 renderer가 소유권 값을 전달할 수 없게 한다.
- `src/services/supabaseService.ts`: renderer용 타입 안전 wrapper. 공개 API를 `readTodos()`, `patchTodo(id, allowlistedPatch)`, `applyCalendarToTodoPatch(id, calendarPatch)`, `mutateTodoOrder(mutation, orderedIds)`, `readTodoLabels()`, `createOrReuseLabelAndAttach(input)`, `updateTodoLabel(id, patch)`로 제한한다. 전체 객체 `upsertTodo`는 UI 공개 API로 남기지 않는다.
- 레거시 localStorage·`task_views` 마이그레이션에 전체 insert가 필요하면 main 내부 전용 `insertMigratedTodo`로 격리하고 일반 편집 경로에서 호출할 수 없게 한다.
- `src/mocks/devElectronAPI.ts`: user-scoped todo CRUD, label 조회·생성·수정, 정렬과 로그인 세션을 실제 앱과 동일하게 모사

### 캘린더 경계

`ScheduleView` 및 캘린더 역동기화는 제목·메모·날짜·캘린더 여부만 바꾸며, `status / priority / pinned / labelIds`를 절대 초기화하지 않는다. renderer는 calendar event에서 계산한 allowlist patch만 `applyCalendarToTodoPatch`로 main에 보내고, 전체 todo read-modify-write를 하지 않는다. 이 DB-only 경로는 todo commit broadcast만 보내며 Google Calendar 작업과 calendar broadcast를 다시 발생시키지 않는다.

todo와 연결된 Google Calendar 이벤트는 extended property `bflow_linked_todo_id`를 durable idempotency key로 사용한다. main의 create·응답 유실 재시도는 먼저 이 값으로 후보 캘린더를 조회해 기존 이벤트가 정확히 1건이면 update하고, 없을 때만 insert한다. update·delete도 renderer의 휘발성 event ID map이 아니라 이 연결 키로 실제 이벤트를 다시 찾을 수 있어야 한다. 시작·종료일 fallback은 main queue 접수 전에 최종 todo patch에 포함해 DB와 calendar가 같은 날짜를 사용한다.

- 조회 범위는 현재 target 하나가 아니라 사용자가 접근 가능한 B flow 후보 캘린더와 journal에 기록된 과거 source calendar를 포함한다.
- 연결 키 검색 결과가 1건이면 그 이벤트를 canonical로 사용하고, 0건이면 현재 target에 새 이벤트를 만든다.
- 신규 이벤트 ID도 todo UUID를 Google 허용 문자로 정규화한 deterministic ID를 사용해 같은 캘린더의 동시 insert·응답 유실 재시도가 중복을 만들지 않게 한다.
- 검색 결과가 2건 이상이면 임의 update·insert·delete를 하지 않고 `동기화 확인 필요`로 전환한다. `중복 일정 정리` 액션은 캘린더 이름·날짜와 함께 후보를 보여주고 사용자가 유지할 1건을 고른 뒤 나머지 삭제를 재확인한다.
- main calendar commit broadcast는 `{ userId, action: 'upsert' | 'delete', event, eventId, linkedTodoId, sourceCalendarId }` canonical payload를 보낸다. todo state merge는 current session userId가 일치할 때만 수행한다. `calendarService.applyExternalCalendarPatch`가 각 renderer의 `eventCache`와 local ID map을 먼저 patch한 뒤 기존 UI change event를 발생시킨다. payload가 불완전하거나 중복 상태면 targeted authoritative sync를 마친 뒤 UI event를 보낸다.

개인 투두의 read·patch·order mutation·delete, 개인 레이블의 read·insert·update, 레거시 `task_views` read·upsert query는 main에서 확정한 동일 `user_id` 조건을 사용한다. todo 삭제와 label 수정도 `id`만으로 처리하지 않고 `id + user_id`로 제한한다. 로그인 직후 개인 데이터 초기화는 main-verified login/restore 완료를 명시적으로 기다린 뒤 시작해 main 소유권 세션과 첫 read 사이의 경쟁을 막는다.

---

## 7. 데이터 흐름과 저장 규칙

```text
[행 다음 단계 버튼 / 상세 속성 변경]
                │
                ▼
[현재 사용자 todo 배열 + label 확정 baseline 보관]
                │
                ▼ 즉시
[React 상태 갱신 → 그룹 이동·통계·모달 동기화]
                │
                ▼ 즉시 IPC 접수, main의 사용자별 단일 mutation queue
[일반 필드 patch 또는 원자적 order RPC]
        │ 성공        │ DB 명시 거부       │ 결과 불명
        ▼             ▼                    ▼
[canonical 반영] [확정 baseline 복구] [멱등 재시도 1회 + authoritative read]
        │                                  │
        └──────────────┬───────────────────┘
                       ▼
                 [창 간 변경 방송]
```

- 개인 투두·개인 레이블 변경은 Electron main의 사용자별 단일 `personalDataMutationQueue`에서 순차 실행한다. 대시보드·팝업별 renderer queue나 todo별 독립 큐 여러 개가 공통 `sort_order`를 동시에 덮어쓰는 구조는 사용하지 않는다.
- IPC handler는 호출을 받는 즉시 현재 canonical userId를 캡처하고 intent를 main queue에 넣은 뒤 처리 결과 Promise를 반환한다. popup이 닫혀 응답 대상 renderer가 사라져도 접수된 저장은 계속되며, 앱 정상 종료는 queue pending을 기다린다.
- 제목·메모·날짜·캘린더·우선순위·labelIds·`할 일 ↔ 진행 중`처럼 그룹 순서를 바꾸지 않는 변경은 허용 필드만 갱신하는 todo patch를 사용한다.
- 개인 투두 추가·삭제, 고정 변경, `완료 ↔ 미완료` 변경, 드래그 정렬은 새 트랜잭션 RPC가 **대상 mutation + 전체 개인 투두 `sort_order` 재색인**을 한 번에 처리한다. N개 upsert를 renderer에서 따로 보내지 않는다.
- order RPC는 handler 진입 때 캡처한 userId를 사용하고, ordered ID의 중복과 타 사용자 소유 ID를 거부한다. mutation 적용 후 서버의 현재 전체 row를 `미완료 고정 / 미완료 일반 / 완료`로 다시 분류하고, 각 그룹 안에서 요청 ordinal을 우선한 뒤 요청에 없던 동시 생성 row는 기존 `sort_order, created_at, id` 순으로 해당 그룹 끝에 붙인다.
- 요청 ordered ID 중 동시 삭제돼 존재하지 않는 항목이 있으면 stale conflict를 반환한다. 클라이언트는 authoritative 목록을 reload한 뒤, 이미 충족되지 않은 마지막 사용자 의도만 한 번 다시 적용한다.
- DB constraint·RPC validation처럼 서버가 적용하지 않았음을 명시한 **확정 실패**만 rollback한다. 롤백 기준은 첫 미저장 변경 직전의 최신 서버 확정 baseline이다.
- timeout·연결 종료·IPC 응답 유실처럼 DB commit 여부를 알 수 없는 **결과 불명 오류**는 즉시 rollback하지 않는다. 같은 목표값을 멱등하게 한 번 재시도하고 authoritative read로 실제 todo·순서·label을 확인해 canonical baseline과 UI를 결정한다.
- 결과 불명 뒤 authoritative read도 실패하면 해당 항목 또는 순서 영역을 `동기화 확인 필요` 상태로 표시하고 추가 충돌 변경을 잠시 막는다. 사용자의 최신 로컬 의도는 유지하되 `다시 확인` 액션과 온라인 복귀 자동 재조회를 제공하며, 서버 확인 전에는 “원복 완료”나 “저장 완료”로 안내하지 않는다.
- todo 단건은 행·카드에 작은 amber 상태 아이콘과 `다시 확인` 액션을, label 단건은 선택기 안 해당 레이블 옆에 같은 상태를 표시한다. order RPC 결과 불명은 개인 투두 영역 상단 compact banner로 표시하고 정렬·고정·완료 이동만 잠근다. 제목·메모 열람과 상세 모달 열기는 허용하며, 대시보드와 팝업에서 동일하게 표시한다.
- 필드 검증 오류는 레이블 선택기나 해당 입력 바로 아래에 표시한다. 서버가 거부한 확정 저장 실패는 기존 전역 오류 토스트를 보여주고 rollback한다. 결과 불명은 행·카드뿐 아니라 열린 상세 모달의 속성 도구줄에도 지속 표시해 사용자가 어느 화면에서도 `다시 확인`을 찾을 수 있게 한다.
- 연속 변경 중 중간 저장이 실패하면 이후 대기 변경을 최신 UI 의도 기준으로 다시 계산한다.
- 고정·완료 변경으로 그룹이 바뀌면 `미완료 고정 → 미완료 일반 → 완료` 순서로 개인 투두 배열을 재구성하고 전체 `sort_order`를 재색인한다.
- 마지막 쓰기 우선(Last-Write-Wins)이라는 기존 앱 원칙은 유지한다.
- 다른 창의 변경을 받으면 현재 포커스 중인 제목·메모 입력은 덮어쓰지 않고, 나머지 속성은 최신 서버값을 반영한다.
- main commit broadcast는 canonical todo 1건·ordered todo 배열·canonical label을 mutation 종류에 맞게 보내고 각 renderer가 ID 기준으로 merge한다. local pending mutation이 있는 entity는 optimistic 표시를 즉시 덮지 않고 confirmed baseline만 갱신하며, 해당 pending intent가 끝나면 가장 최신 canonical 값과 reconcile한다.
- 모든 queue drain마다 full reload하지 않는다. authoritative reload는 stale conflict, 결과 불명, 초기화·재접속, broadcast 누락 의심 때만 수행해 입력 draft와 화면 위치가 불필요하게 흔들리지 않게 한다.
- label 이름·색상 편집도 label ID별 `confirmedLabelBaseline`과 `pendingLabelIntent`를 둔다. 다른 창의 label 방송은 pending UI를 덮지 않고 baseline만 갱신한다. 현재 편집이 확정 실패하면 편집 시작 당시의 낡은 값이 아니라 그동안 받은 최신 confirmed baseline으로 복구하고, 결과 불명이면 authoritative label read로 확정한다.
- renderer는 intent 생성 당시 `sessionEpoch`를 캡처해 IPC 호출 직전 확인하고, main은 handler 진입 당시 canonical userId를 별도로 캡처한다. 사용자 전환 후 남은 stale renderer closure는 IPC에 들어가기 전 폐기하고, 이미 접수된 옛 사용자 intent는 캡처한 옛 userId로만 완료한다.
- 기존 catch-all `assignedTodos` 저장 effect에 정확성을 의존하지 않는다. 각 사용자 액션과 캘린더 이벤트가 최종 next snapshot을 먼저 완성한 뒤 명시적으로 main queue에 1회 접수한다.
- 캘린더가 보낸 incremental 변경은 `applyCalendarToTodoPatch`의 `title / memo / startDate / endDate / addToCalendar` allowlist만 사용한다. 전체 todo를 다시 upsert해 동시에 바뀐 상태·고정·우선순위·레이블을 덮지 않고 Google Calendar로 echo하지 않는다.
- 날짜 fallback과 `addToCalendar` 전환도 main queue에 넣기 전에 최종 next todo에 합쳐, 저장 시작 후 객체를 뒤늦게 변경하지 않는다.
- 캘린더 관련 patch의 Google side effect·보상·authoritative 확인은 renderer callback이 아니라 main calendar worker에서 실행한다. popup close·renderer 파괴·정상 앱 종료 중에도 main pending tracker와 recovery journal이 이 작업을 추적한다.
- calendar insert/update/delete의 결과 불명은 `bflow_linked_todo_id`로 Google Calendar를 다시 읽어 존재·내용을 확인한다. 목표와 같으면 성공으로 확정하고, 다르면 멱등 재적용 또는 DB 보상을 수행한다. 판정에 필요한 DB 또는 Google Calendar authoritative read 중 하나라도 실패하면 todo를 `동기화 확인 필요`로 표시한다.
- 일반 patch는 DB trigger 적용 후의 canonical todo 1건을 반환하고, order RPC는 트랜잭션 후의 canonical ordered todo 전체 배열을 반환한다. renderer의 confirmed baseline은 optimistic 객체가 아니라 이 응답 또는 후속 authoritative reload로만 갱신한다.
- label create/update도 trim·unique 처리 후의 canonical label을 반환하고 그 응답으로 label baseline을 갱신한다. create-or-reuse RPC는 attach까지 main에서 원자적으로 완료하며, renderer 검사는 todo 존재·sessionEpoch가 맞을 때 임시 칩을 canonical UUID로 치환하는 UI 적용만 gate한다.

---

## 8. 에러·경계 상황

아래의 `저장 실패`는 서버가 적용하지 않았음을 명시한 확정 실패를 뜻한다. timeout·연결 종료·응답 유실은 표의 `결과 불명` 규칙을 먼저 적용한다.

| 상황 | 처리 |
|---|---|
| 개인 투두 추가 저장 실패 | 낙관적으로 추가한 행을 제거하고 원래 통계로 롤백 |
| 개인 투두 삭제 실패 | 같은 그룹·순서·상태로 행을 복원하고 오류 토스트 |
| 제목·메모 저장 실패 | 편집 시작 전 값으로 입력과 행 미리보기를 롤백 |
| 날짜·캘린더 연동 확정 실패 | main calendar worker가 todo와 캘린더 이벤트 양쪽에 조건부 보상 작업을 수행. 이후 변경이 없을 때만 이전 confirmed baseline으로 복구하고, 보상도 실패하면 journal 유지·authoritative reload·지속 오류 안내 |
| 캘린더 API 응답 유실 | `bflow_linked_todo_id`로 실제 이벤트를 재조회해 적용 여부를 확정한 뒤 DB와 UI baseline을 맞춤 |
| Google Calendar 호출이 5초를 넘김 | 무관한 personal data queue는 계속 진행. 해당 todo만 sync-needed로 표시하고 todo별 background worker·journal로 재확인 지속 |
| 연결 키로 캘린더 이벤트 2건 이상 발견 | 임의 변경 중단, `중복 일정 정리`에서 유지할 1건 선택과 나머지 삭제 재확인 |
| 종료 deadline에 calendar worker 미완료 | atomic recovery journal을 남기고 종료, 다음 시작 matching session에서 DB·calendar authoritative reconcile 후 제거 |
| 드래그 정렬 RPC 실패 | 전체 개인 투두 순서를 직전 서버 확정 배열로 롤백 |
| 상태 저장 실패 | 원래 상태·그룹 위치·통계로 롤백하고 오류 토스트 |
| 고정 저장 실패 | 원래 패널/일반 목록 위치와 순서로 롤백 |
| 우선순위·레이블 저장 실패 | 칩·색상선을 원복하고 오류 토스트 |
| 새 레이블 생성 실패 | 임시 레이블을 선택기와 todo에서 제거하고 오류 토스트 |
| 두 창에서 같은 레이블 동시 생성 | unique 충돌 후 기존 레이블을 재사용해 create+attach 트랜잭션을 완료. 명시적 해제 intent가 뒤따르면 canonical UUID를 다시 detach |
| 새 레이블 생성 직후 todo 저장 | create-or-reuse+attach 복합 RPC가 서버 UUID만 사용해 원자 저장하므로 임시 ID는 todo patch에 전달하지 않음 |
| 레이블 생성 응답 전 칩 해제 시도 | 임시 칩 spinner와 함께 해제를 비활성화. canonical 응답 뒤 즉시 일반 해제 가능 |
| 레이블 생성 중 todo 삭제 | 같은 main queue의 뒤선 delete가 todo를 제거. create RPC가 먼저 todo 없음으로 끝나면 label 정의만 남김 |
| 레이블 생성 중 계정 전환 | old-user DB queue drain 뒤 전환. attach 저장은 유지하고 stale renderer 응답만 새 사용자 UI에서 무시 |
| 레이블 생성 중 상세 모달 닫기 | pending 선택 의도를 hook에 유지하고, 명시적 해제가 없으면 생성 완료 뒤 todo에 attach |
| 레이블 이름·색상 수정 실패 | 다른 창 변경까지 포함한 최신 confirmed label baseline으로 모든 칩 표시를 복구하고 오류 토스트 |
| label 편집 pending 중 다른 창 변경 수신 | optimistic 표시를 유지하고 confirmed baseline만 갱신. 현재 편집 성공 후 canonical 값으로 정리하거나 실패 시 최신 baseline으로 복구 |
| 중복 레이블 이름으로 수정 | 저장하지 않고 선택기 안에 중복 안내 표시 |
| 빠른 상태 연속 클릭 | main의 사용자별 mutation queue로 순서를 직렬화하고 마지막 의도를 보존 |
| order RPC stale conflict | authoritative 목록 reload 후 아직 충족되지 않은 마지막 사용자 의도만 1회 재적용 |
| main canonical session 미준비 | `ensureCanonicalSession` barrier를 다시 확인하고 read/mutation을 시작하지 않음 |
| 완료 직후 다시 열기 | `done → todo`로 저장하며 기존 `pinned` 값에 따라 원래 그룹 복귀 |
| 레이블 ID가 로드되지 않음 | 해당 칩만 생략하고 picker에 로드 오류 표시. 원본 labelIds는 보존하며 자동 저장으로 제거하지 않음 |
| 구버전 앱이 `completed`를 변경 | DB 호환 trigger가 `status`를 `done/todo`로 동기화 |
| 캘린더에서 제목·메모 수정 | 새 개인화 필드는 그대로 보존 |
| 팝업 폭이 좁음 | 제목·레이블을 먼저 줄이고 행동 버튼 최소 폭은 유지 |
| 메모가 매우 김 | 최대 높이 이후 입력칸 내부 스크롤, 모달 전체는 뷰포트 안 유지 |
| 고정 투두가 모두 완료 | 고정 패널 숨김, 완료 섹션에만 표시 |
| 새 사용자의 레이블이 없음 | 빈 선택기와 `새 레이블 만들기` 액션 표시 |
| 사용자 전환 중 이전 load 응답 도착 | sessionEpoch 불일치 응답 폐기, 새 사용자 상태에 적용하지 않음 |
| 로그아웃·계정 전환 시 mutation 대기 중 | main transition이 기존 사용자 DB queue를 drain하고 calendar intent journal 영속을 확인. 이 단계가 실패하면 auth.json·main session·renderer store를 그대로 두고 전환 취소. journal된 Google worker는 old userId로 계속 가능 |
| popup 닫기 직전 mutation 접수 | renderer와 무관하게 main queue가 저장·commit broadcast를 끝냄 |
| 앱 종료 직전 mutation 접수 | before-quit이 새 intent를 거부하고 동적 tracker의 todo·label queue와 calendar worker를 deadline까지 기다림. 미완료 calendar 작업은 journal로 다음 시작에 복구 |
| todo·순서·label 쓰기 결과 불명 | 같은 목표값을 멱등 재시도 1회 후 authoritative read. 서버값이 목표와 같으면 성공 확정, 다르면 canonical 서버값 반영 |
| 결과 불명 뒤 authoritative read도 실패 | 최신 로컬 의도를 유지. todo/label은 해당 항목 amber 표시, order는 개인 투두 상단 banner와 이동 액션 잠금. `다시 확인`·온라인 복귀 자동 재조회 제공 |

---

## 9. 테스트 전략

### 순수 로직 테스트

- `todo → doing → done`, `done → todo` 전이
- 상태별 보조 문구와 다음 행동 버튼
- `pinned / normal / done` 그룹 분류와 중복 없음
- 완료된 고정 투두 숨김 및 다시 열 때 고정 패널 복귀
- 그룹별 sort order 유지
- 레이블 최대 2개 + `+N`
- 우선순위 값과 표시 설정
- 레거시 `completed` fallback
- Supabase·localStorage·`task_views`에서 새 필드가 없는 투두의 기본값 정규화
- 실제 구버전 upsert 형태처럼 새 컬럼을 완전히 누락한 payload로 신규 insert, 기존 `doing` 투두의 메모 수정, 완료·재열기를 수행해 trigger 호환 검증

### 데이터 왕복 테스트

- renderer → preload → main → todo patch/order RPC와 label insert/update에 허용 필드 누락·초과 없음
- Supabase row → `PersonalTodo` mapper에 새 필드 누락 없음
- 개인 레이블 조회·생성·이름/색상 수정, 중복 이름 방지·색상 키 검증
- labelIds 중복 제거 순서 보존, 타 사용자·존재하지 않는 label ID 전체 거부
- 레이블 이름·색상 수정이 이를 사용하는 모든 todo 칩 표시를 갱신
- 캘린더 역동기화 후 새 필드 보존
- eventId 없는 캘린더 incremental 역동기화도 `applyCalendarToTodoPatch`의 title·memo·dates allowlist를 명시적으로 main queue에 넣고 catch-all effect에 의존하지 않음
- calendar-sync origin patch는 DB와 todo broadcast만 갱신하고 GCal update·calendar broadcast를 호출하지 않아 webhook/incremental echo loop가 생기지 않음
- 날짜 fallback·캘린더 토글의 최종 snapshot을 먼저 만든 뒤 저장 1회만 enqueue
- 로그인 직후 App session effect보다 `useMyTasksData`가 먼저 마운트돼도 canonical session 설정 완료 뒤 첫 todo read가 실행됨
- 로그아웃·계정 전환 시 main의 `currentActivityUser`와 `canonicalSessionUserId`가 같은 사용자/null로 함께 바뀌고, sanitized session payload가 role 등 필요한 사용자 메타데이터를 보존함
- 로그인·로그아웃 session action 실패 시 `auth.json`, main canonical session, renderer Zustand session이 모두 이전 사용자로 유지되고 성공 시에만 세 상태가 함께 전환됨
- renderer가 임의 AppUser ID를 보낼 공개 IPC가 없고, main login은 실제 저장소의 name/password를 검증하며 restore는 main이 직접 읽은 auth.json userId만 재검증함
- `UserMenu`, login UI, startup restore가 awaited main session action만 사용하며 `setCurrentUser`·`App.tsx`에서 fire-and-forget auth IPC를 중복 호출하지 않음
- 비밀번호·role·users Realtime 변경 후 `auth:refresh-canonical-user`가 같은 canonical ID의 sanitized metadata만 갱신해 대시보드·popup에 방송하고 auth 파일·personal queue는 건드리지 않음
- old user의 느린 Google worker가 있어도 journal 영속과 DB queue drain 뒤 계정 전환은 성공하고, worker는 캡처한 old userId로만 완료되며 새 사용자 todo state를 갱신하지 않음
- A 사용자의 느린 load/reload/mutation 응답이 B 사용자 전환 뒤 도착해도 B state를 덮지 않음
- A queue가 남은 상태의 계정 전환은 flush 성공 뒤 진행하고 stale queued closure가 B 세션으로 IPC를 호출하지 않음
- 대시보드와 popup이 동시에 보낸 todo·label intent가 main의 같은 사용자 tail에서 순차 처리되고 하나의 실패가 다음 intent를 막지 않음
- popup이 intent 접수 직후 닫혀도 main 저장과 다른 창 commit broadcast가 완료됨
- 앱 종료 요청 직전 todo·label·calendar composite intent가 있으면 before-quit pending count에 포함되고 drain 또는 timeout 기록 전 프로세스가 종료되지 않음
- 상태·고정·레이블 실패 시 낙관적 롤백
- 개인 투두 추가·삭제·제목·메모·날짜·캘린더·드래그 정렬 실패 시 snapshot·통계·그룹 위치 롤백
- todo 저장 성공 후 캘린더 side effect 실패 시 보상 저장, 보상 실패 시 강제 reload 경로
- calendar 연결 patch 직후 popup을 닫아도 main worker가 계속되고, 앱 종료 deadline을 넘기면 journal이 다음 시작에서 DB·Google 적용/보상을 재개함
- 5초를 넘는 GCal worker가 있어도 무관한 todo 상태·label mutation과 다른 todo calendar worker가 완료됨
- journal `received/prepared/db_committed/calendar_unknown/compensating/aborted` 각 phase에서 강제 종료한 뒤 current DB canonical을 존중해 멱등 복구하고, aborted는 재적용 없이 정리함
- journal skeleton은 queue 밖에서 `previousCanonical/dbCommittedUpdatedAt=null`이고, 둘은 main queue 안 authoritative read와 DB commit 반환 뒤에만 각각 채워짐
- skeleton fs write를 지연한 상태에서 quit을 요청해도 동기 등록된 `journalIntakePromise` 때문에 pending 0으로 종료하지 않고 write+enqueue 또는 deadline까지 기다림
- prepared 뒤 DB가 명시 거부되면 calendar worker를 시작하지 않고 `aborted` 기록·삭제하며, 삭제만 실패한 aborted entry는 재시작 시 desiredPatch 재적용 없이 정리됨
- aborted phase 기록 자체 실패는 sync-needed와 cleanup 재시도로 승격되고 session transition·정상 종료 완료가 차단됨
- journal skeleton의 target/source calendar IDs와 deterministic event ID만으로 renderer가 없는 app-start recovery도 같은 calendar 후보를 재조회함
- renderer localStorage의 기존 personal calendar setting을 main AppData로 1회 이관·접근 검증하고 이후 main/renderer가 IPC로 같은 설정을 사용함
- PC A가 DB commit 뒤 사라지고 local journal이 없는 PC B로 로그인해도 session-start audit가 missing/mismatch event를 create/update하고, `bflow_todo_user_id`가 같은 orphan을 delete worker로 보냄
- userId 없는 레거시 orphan은 자동 삭제하지 않고 current user의 실제 todo와 매치되는 이벤트만 userId를 backfill
- `before-quit` 이후 새 personal intent는 `APP_QUITTING`으로 거부되고, 종료 대기는 한 번의 count snapshot이 아니라 늦게 정리되는 worker까지 동적으로 추적
- calendar insert 응답 유실 뒤 후보 캘린더의 `bflow_linked_todo_id`와 deterministic event ID로 기존 이벤트를 찾아 중복 insert 없이 canonical 성공 처리
- 연결 이벤트 0건/1건/2건 이상 각각 insert/canonical reuse/sync-needed+중복 정리로 분기
- main calendar upsert/delete broadcast를 받은 대시보드·popup renderer가 `eventCache`와 local ID map을 먼저 patch한 뒤 UI를 갱신하고, 불완전 payload는 targeted sync 후 반영
- main의 사용자별 mutation queue에서 빠른 상태 연속 변경의 최종값 보존
- create는 같은 renderer UUID, pin/status는 목표 boolean/status, reorder는 목표 ordered IDs로 재시도해도 중복 생성·이중 toggle 없이 같은 canonical 결과를 반환
- DB 명시 거부는 최신 confirmed baseline으로 rollback하고, commit 뒤 응답 유실은 멱등 재시도·authoritative read로 성공 상태를 보존
- 결과 불명 뒤 authoritative read도 실패하면 todo 행·card, label picker, order banner의 `동기화 확인 필요`가 유지되고 재조회 성공 전 저장·원복 완료로 오표시하지 않음
- label 편집 pending 중 다른 창의 canonical 변경을 받으면 baseline만 갱신하며, 현재 편집 실패 시 편집 시작값이 아닌 최신 baseline으로 복구
- 레이블 create 응답 전 임시 칩은 spinner와 disabled 해제를 표시하고, canonical 응답 뒤 일반 해제가 가능함
- 레이블 create 응답 전에 todo를 삭제했을 때 최종적으로 todo는 없고 label 정의만 남음
- 레이블 create 응답 전에 계정 전환했을 때 old-user 저장은 queue drain으로 완료되며 stale 응답이 새 사용자 UI를 덮지 않음
- 레이블 create 응답 전에 모달만 닫고 선택을 해제하지 않았을 때 pending 의도가 유지되어 생성 완료 뒤 원래 todo에 attach
- 레이블 create 입력 draft에서 취소·바깥 클릭·첫 Escape가 저장 없이 picker만 닫고, 다음 Escape가 상세 모달을 닫음

### 컴포넌트·배선 테스트

- 개인 투두 행과 카드에만 상태 버튼이 나타남
- `시작하기 / 완료하기 / 다시 열기` 클릭이 올바른 상태 액션 호출
- 버튼 클릭이 상세 모달을 열지 않음
- 상태 버튼 pointer 입력이 Reorder drag를 시작하지 않고 드래그 핸들만 정렬 시작
- 고정 패널이 씬보다 먼저 렌더되고 일반 목록에 중복되지 않음
- 행 레이블 2개 + `+N`
- 340px 미만 첫 레이블 + `+N`, 300px 안팎 2단 행동 버튼 배치
- 우선순위 색상선의 실선/2단/짧은선 패턴, 접근성 이름과 tooltip
- 상세 모달 속성 도구줄과 메모 `autoGrow`·최대 높이 배선
- 강화된 `+` 버튼의 접근성 이름과 키보드 동작
- 상태 변경 뒤 키보드 초점 이동, 완료 섹션 접힘 fallback
- 상세 모달 상태 select로 그룹을 이동해도 focus가 배경 행으로 빠지지 않고 모달 trap 안에 유지
- 완료 이동은 완료 그룹 마지막, 다시 열기와 `done → todo/doing`은 pinned 값에 따른 대상 그룹 마지막, `todo ↔ doing`은 기존 위치 유지
- 완료된 `pinned=true` todo 모달에 `다시 열면 나의 고정으로 돌아갑니다` 보조 문구 표시
- 검증 오류는 해당 입력 아래, 확정 실패는 rollback+전역 토스트, 결과 불명은 행·카드와 열린 모달 도구줄에 지속 표시
- 레이블 선택기가 뷰포트에 clamp되고 최대 높이 이후 목록만 내부 스크롤
- 캘린더 todo ID 점프 시 고정·일반·완료 항목 탐색과 완료 섹션 자동 펼침
- `할 일 → 진행 중`에는 축하 없음, 마지막 미완료 → 완료에서만 기존 축하 실행

### 개발 프리뷰 동등성

현재 `src/mocks/devElectronAPI.ts`의 todo API는 빈 배열·고정 ID를 반환하고 auth IPC도 세션을 보관하지 않는다. 이를 같은 origin의 preview 탭들이 공유하는 `localStorage` 저장소와 `BroadcastChannel` 변경 알림으로 교체한다.

- 추가·업데이트·삭제·정렬
- 상태·고정·우선순위·labelIds 보존
- 개인 레이블 생성·조회·이름/색상 수정
- todo calendar composite를 localStorage의 mock calendar event와 함께 적용하고, 실패 주입 시 양쪽 rollback·결과 불명 표시를 실제 앱과 같은 계약으로 모사
- mock awaited login/logout/restore action이 name/password 검증과 현재 사용자 ID 저장을 모사하고 todo·label API는 그 세션 사용자 영역만 사용
- `sessionBroadcastChange / sessionRequestCurrent / onSessionChanged`도 같은 localStorage·BroadcastChannel 세션을 사용해 별도 팝업 탭이 현재 사용자를 복원
- 같은 preview 세션의 재렌더, 대시보드 탭, 별도 팝업 탭 사이에서 데이터와 변경 이벤트 공유
- 로그아웃 시 세션 사용자만 지우고 사용자별 저장 데이터는 유지
- `?preview=1`에서 해당 mock 사용자 저장소가 처음 비어 있을 때만 고정/진행 중/완료/여러 레이블/긴 메모를 모두 볼 수 있는 deterministic 예시 데이터를 seed한다. versioned preview namespace와 reset helper를 사용하며 production 데이터 경로에는 절대 기록하지 않는다.

### 수동 확인

1. `npm run dev:renderer`
2. `http://127.0.0.1:5173/?preview=1`
3. `배한솔 / 1234` 로그인
4. 대시보드 `내 할일`에서 리스트·카드·좁은 폭 확인
5. `+` 가시성, 고정 패널, 레이블 오버플로, 우선순위선 확인
6. `시작하기 → 완료하기 → 다시 열기`와 통계·그룹 이동 확인
7. 상세 모달 상태 직접 변경과 긴 메모 자동 높이 확인
8. 다크·라이트·모션 최소화 확인

### 빌드 게이트

- `npm run typecheck`
- 관련 `node --test` 테스트
- `npm run build:vite`
- 정식 배포 단계에서만 `npm run build`

### 배포 순서 게이트

새 앱의 write DTO와 order RPC는 새 DB 컬럼·trigger·함수에 의존하므로 배포 순서는 아래와 같이 고정한다.

1. DB migration을 먼저 적용한다.
2. 구버전 payload 신규 insert·메모 수정·완료·다시 열기 smoke test와 새 RPC 권한·trigger·canonical 반환을 확인한다.
3. 신버전 앱에서 todo·label 왕복 테스트와 표준 빌드 게이트를 통과한다.
4. 앱 빌드 파일을 배포 위치에 먼저 올리고 `manifest.json`은 마지막에 갱신한다.

1~3 중 하나라도 실패하면 신버전 `manifest.json`을 올리지 않는다. migration 뒤 구버전 앱은 호환 trigger로 계속 동작하지만, 앱을 migration보다 먼저 배포하면 신버전 저장이 모두 실패할 수 있으므로 역순 배포를 금지한다.

---

## 10. 구현 범위 분해 원칙

구현 계획은 다음 순서를 따른다.

1. DB 마이그레이션·타입·순수 helper·호환 trigger
2. Electron/renderer 매핑·개인 레이블 서비스·개발 mock
3. main의 개인 데이터 저장 큐·calendar composite와 `useMyTasksData` 상태 전이·그룹·optimistic baseline·reconcile
4. 고정 패널·행·카드·다음 단계 버튼
5. 상세 모달 속성 도구줄·레이블 선택기·메모 자동 높이
6. 통계·캘린더 보존·팝업·테마·접근성 마무리
7. 전체 검증과 독립 리뷰

구체적인 파일·함수·테스트 단위와 커밋 순서는 사용자 문서 검토 후 `writing-plans` 단계에서 확정한다.

---

## 11. 설계 완료 조건

- 이 문서에 미정 항목이나 선택 대기 항목이 없다.
- 확정 목업과 문서의 고정·레이블·우선순위·상태·모달 배치가 일치한다.
- 구버전 `completed`와 새 `status`의 혼용 규칙이 명시되어 있다.
- 모든 데이터 경계와 캘린더 역동기화에서 새 필드 보존 책임이 명시되어 있다.
- 실패 롤백·연속 클릭·테스트 모드 동등성이 구현 범위에 포함되어 있다.

*이 문서는 승인된 UX를 구현 가능한 경계로 고정한 설계 문서다. 구현 계획은 이 문서를 변경하지 않고 세부 작업으로 분해해야 한다.*
