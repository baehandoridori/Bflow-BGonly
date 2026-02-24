# Bflow 대시보드 — 토스증권 스타일 위젯 인터랙션 구현 명세

> **이 문서를 레포 루트에 복사한 뒤, "TOSS_WIDGET_SPEC.md를 읽고 Step 1부터 순서대로 구현해줘. 각 Step 완료 후 빌드 검증해줘."라고 지시하세요.**

---

## 0. 프로젝트 컨텍스트

| 항목 | 값 |
|------|-----|
| 레포 | `Bflow-BGonly` (Bflow 레포는 참고 전용, 절대 수정 금지) |
| 프레임워크 | Electron + React 18 + TypeScript + Vite |
| 상태관리 | Zustand |
| 애니메이션 | Framer Motion (이미 설치됨) |
| **현재 그리드** | **react-grid-layout (이미 사용 중)** |
| 스타일 | Tailwind CSS |
| 빌드 검증 | `tsc --noEmit` + `vite build` 통과 필수 |

### 디자인 토큰

```typescript
// src/styles/tokens.ts (신규 생성 또는 기존에 추가)
export const tokens = {
  bg:         '#0F1117',
  cardGlass:  'rgba(26, 29, 39, 0.55)',    // 글래스모피즘 기본
  cardHover:  'rgba(30, 33, 48, 0.65)',    // 호버 시
  cardDrag:   'rgba(35, 38, 55, 0.70)',    // 드래그 시
  border:     'rgba(45, 48, 65, 0.5)',
  borderHover:'rgba(108, 92, 231, 0.2)',
  accent:     '#6C5CE7',
  text:       '#E8E8EE',
  textDim:    '#8B8DA3',
  stages: {
    LO:   '#74B9FF',
    done: '#A29BFE',
    review:'#FDCB6E',
    PNG:  '#00B894',
  }
} as const;
```

### 대상 위젯 목록

| ID | 이름 | 설명 |
|----|------|------|
| `overall-progress` | 전체 진행률 | 원형 멀티컬러 차트 |
| `stage-bars` | 단계별 진행률 | LO/완료/검수/PNG 바 차트 |
| `assignee-cards` | 담당자별 현황 | 담당자 카드 목록 |
| `episode-summary` | 에피소드 요약 | EP별 진행 상태 |
| `dept-comparison` | 부서별 비교 | BG vs 액팅 비교 |

---

## 1. 핵심 원칙

```
"그리드인데 그리드처럼 안 느껴지는 것"

① 촘촘한 그리드: cols=24, rowHeight=16px
   → 12칸×150px 대비 훨씬 세밀한 배치 가능

② 느긋한 이징: 0.35~0.4초, expo-out 커브
   → 스냅 순간이 느긋하게 녹아들어 끊김 인지 불가

③ 실시간 충돌 해결: 드래그/리사이즈 중 매 프레임 계산
   → 다른 위젯이 실시간으로 비켜남

④ 글래스모피즘: backdrop-filter: blur(20px)
   → 반투명 유리 재질, 뒤 배경 비침

⑤ 8방향 Edge Glow: 가장자리 호버 시 ㄴㄱ자 코너 + 변 glow
   → "여기 잡으면 크기 조절됨" 어포던스
```

---

## 2. 그리드 설정 변경

**파일: `Dashboard.tsx` (또는 그리드 설정 파일)**

```typescript
// 기존 설정 (대략):
// cols: 12, rowHeight: 150

// 변경:
const GRID_CONFIG = {
  cols: 24,
  rowHeight: 16,
  margin: [6, 6],           // gap
  containerPadding: [10, 8],
  compactType: 'vertical',  // 세로 방향 압축
  preventCollision: false,  // react-grid-layout이 충돌 처리
};
```

### 기존 위젯 레이아웃 매핑

기존 레이아웃을 24칸 기준으로 재매핑해야 함. 대략적인 변환:

```typescript
// 예시 (기존 12칸 → 24칸 환산)
const defaultLayout = [
  { i: 'overall-progress', x: 0,  y: 0,  w: 10, h: 8 },
  { i: 'stage-bars',       x: 10, y: 0,  w: 7,  h: 8 },
  { i: 'assignee-cards',   x: 17, y: 0,  w: 7,  h: 16 },
  { i: 'episode-summary',  x: 0,  y: 8,  w: 10, h: 8 },
  { i: 'dept-comparison',  x: 10, y: 8,  w: 7,  h: 8 },
];
```

---

## 3. 인터랙션 상세 명세

### 3-A. 글래스모피즘 카드 (WidgetCard 래퍼)

**모든 위젯을 감싸는 공통 래퍼 컴포넌트를 신규 생성한다.**

```
파일: src/components/widgets/WidgetCard.tsx
```

#### 시각적 레이어 구조 (아래→위)

```
┌─ WidgetCard ──────────────────────────┐
│  Layer 1: backdrop-filter: blur(20px) │  ← 뒤가 비침
│           saturate(1.3)               │
│  Layer 2: background rgba(26,29,39,0.55) │ ← 반투명
│  Layer 3: 상단 하이라이트 gradient     │  ← 빛 반사
│           (rgba(255,255,255,0.04)→transparent)
│  Layer 4: 노이즈 텍스처 SVG overlay    │  ← 유리 질감
│           (opacity: 0.03)             │
│  Layer 5: 콘텐츠                       │
│  Layer 6: Edge Glow + Corner Glow     │  ← 조건부 표시
│  Layer 7: Drag border glow            │  ← 드래그 중만
│  Layer 8: Settle flash                │  ← 안착 순간만
└───────────────────────────────────────┘
```

#### 글래스모피즘 CSS

```css
.widget-card {
  background: rgba(26, 29, 39, 0.55);
  backdrop-filter: blur(20px) saturate(1.3);
  -webkit-backdrop-filter: blur(20px) saturate(1.3);
  border: 1px solid rgba(45, 48, 65, 0.5);
  border-radius: 12px;
  overflow: visible;  /* Edge glow가 밖으로 나와야 함 */
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

/* 상단 빛 반사 */
.widget-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; height: 40%;
  border-radius: 12px 12px 0 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%);
  pointer-events: none;
}
```

#### 배경 장식 (글래스에 비칠 대상)

Dashboard 컨테이너 뒤에 추가:

```css
.dashboard-bg {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
}
.dashboard-bg::before {
  content: '';
  position: absolute;
  top: -20%; left: -10%;
  width: 50%; height: 60%;
  background: radial-gradient(ellipse, rgba(108,92,231,0.07), transparent 70%);
  filter: blur(60px);
}
.dashboard-bg::after {
  content: '';
  position: absolute;
  bottom: -15%; right: -5%;
  width: 45%; height: 50%;
  background: radial-gradient(ellipse, rgba(225,112,85,0.07), transparent 70%);
  filter: blur(60px);
}
```

---

### 3-B. 위젯 호버 (Hover Feedback)

```
트리거: 마우스가 위젯 카드 위에 올라감
변화:
  - background: rgba(26,29,39,0.55) → rgba(30,33,48,0.65)
  - border-color: rgba(45,48,65,0.5) → rgba(108,92,231,0.2)
  - box-shadow: 0 4px 16px rgba(0,0,0,0.25)
  - transition: all 0.2s ease
```

---

### 3-C. 8방향 Edge Glow + ㄴㄱ자 코너

```
트리거: 마우스가 위젯의 가장자리 14px 영역에 진입
영역 구분:

  ┌──NW──────── N ────────NE──┐
  │  (14×14)              (14×14)│
  W              center         E
  │  (14×14)              (14×14)│
  └──SW──────── S ────────SE──┘

각 영역별 커서:
  n: n-resize    s: s-resize
  w: w-resize    e: e-resize
  nw: nw-resize  ne: ne-resize
  sw: sw-resize  se: se-resize
```

#### 변 Glow (Edge Line)

```
방향 N/S → 가로선: linear-gradient(90deg, transparent, #6C5CE7 50%, transparent)
방향 W/E → 세로선: linear-gradient(180deg, transparent, #6C5CE7 50%, transparent)

width/height: 2px
opacity: 0 → 0.9 (0.2s ease)
transform: scale(0.4) → scale(1)
box-shadow: 0 0 10px rgba(108,92,231,0.4)
```

#### ㄴㄱ자 코너 Glow (SVG)

```
코너에 L-shape SVG 표시:

NW = ㄱ자 (왼쪽상단에서 아래로 + 오른쪽으로)
NE = ㄱ자 미러 (오른쪽상단에서 아래로 + 왼쪽으로)
SW = ㄴ자 (왼쪽하단에서 위로 + 오른쪽으로)
SE = ㄴ자 미러 (오른쪽하단에서 위로 + 왼쪽으로)

SVG 크기: 22×22px
stroke: #6C5CE7, strokeWidth: 2.5, strokeLinecap: round
line 길이: 15px
filter: drop-shadow(0 0 6px rgba(108,92,231,0.5))

표시 전환:
  opacity: 0 → 1 (0.2s ease)
  transform: scale(0.6) → scale(1)
```

#### 활성화 조합

```
zone "n"  → 변 N만 glow
zone "s"  → 변 S만 glow
zone "nw" → 변 N + 변 W + 코너 NW 동시 glow
zone "se" → 변 S + 변 E + 코너 SE 동시 glow
(나머지 동일 패턴)
```

---

### 3-D. 드래그 (헤더에서만!)

```
드래그 핸들: 위젯 헤더 영역만 (타이틀바)
  - 헤더에 ⠿ 모양 6dot 아이콘 추가 (opacity 0.25)
  - cursor: grab (hover) → grabbing (dragging)

드래그 시작:
  - 위젯 background: rgba(35,38,55,0.7)
  - border: rgba(108,92,231,0.5)
  - box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1.5px rgba(108,92,231,0.4)
  - 전체 border에 pulse glow 애니메이션 (1.5s infinite)
  - z-index: 100
  - opacity: 0.95
  - transition: 끔 (실시간 마우스 따라감)

드래그 중:
  - 위젯이 픽셀 단위로 마우스를 따라 이동 (그리드 무시)
  - 목표 위치에 placeholder 표시 (dashed border, accent 5% 배경)
  - ★ 핵심: 다른 위젯들이 실시간으로 비켜남 (transition: 0.35s)
  - 나머지 위젯 dim: opacity 0.3 + 반투명 오버레이

드래그 놓기:
  - 가장 가까운 그리드 칸에 스냅
  - 충돌 해결 (resolveCollisions) + 빈공간 압축 (compactLayout)
  - transition: 0.45s cubic-bezier(0.34,1.56,0.64,1) — 미세한 바운스
  - 안착 순간: accent 색 border flash (0.45s fade out)
```

---

### 3-E. 리사이즈 (가장자리/코너에서)

```
리사이즈 중:
  - 위젯이 픽셀 단위로 실시간 늘어남/줄어듦 (그리드 무시!)
  - border: rgba(108,92,231,0.45)
  - box-shadow: 0 8px 32px rgba(0,0,0,0.3)
  - ★ 핵심: 다른 위젯들이 실시간으로 비켜남

리사이즈 놓기:
  - 가장 가까운 그리드 칸에 "톡" 스냅
  - 충돌 해결 + 빈공간 압축
  - settle transition: 0.45s spring
  - 안착 flash
```

---

### 3-F. 실시간 충돌 해결 알고리즘

**매 mousemove 프레임마다 다음을 계산:**

```typescript
// 1. 현재 드래그/리사이즈 중인 위젯의 "만약 지금 놓으면?" 그리드 위치 계산
const snapped = snapToGrid(pixelX, pixelY, pixelW, pixelH);

// 2. 해당 위치로 가상 레이아웃 생성
let previewLayout = layout.map(l =>
  l.id === activeId ? { ...l, ...snapped } : l
);

// 3. 충돌 해결: 겹치는 위젯을 아래로 밀어냄
previewLayout = resolveCollisions(previewLayout, activeId);

// 4. 빈공간 압축: 위로 당길 수 있으면 당김
previewLayout = compactLayout(previewLayout);

// 5. 이 previewLayout으로 다른 위젯들 렌더 → 실시간 밀림 효과
//    (다른 위젯들은 transition: 0.35s 적용되어 부드럽게 이동)
```

#### resolveCollisions 함수

```typescript
function resolveCollisions(layout: LayoutItem[], movedId: string) {
  let result = layout.map(l => ({ ...l }));
  const moved = result.find(l => l.id === movedId);
  if (!moved) return result;

  let changed = true, safety = 0;
  while (changed && safety < 50) {
    changed = false; safety++;
    // 이동된 위젯과 겹치는 위젯 → 아래로 밀기
    for (const item of result) {
      if (item.id === movedId) continue;
      if (isOverlap(moved, item)) {
        item.y = moved.y + moved.h;
        changed = true;
      }
    }
    // 밀려난 위젯끼리 또 겹치면 → 재귀적 밀기
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (isOverlap(result[i], result[j])) {
          const lower = result[i].y <= result[j].y ? result[j] : result[i];
          const upper = result[i].y <= result[j].y ? result[i] : result[j];
          if (lower.id !== movedId) {
            lower.y = upper.y + upper.h;
            changed = true;
          }
        }
      }
    }
  }
  return result;
}
```

#### compactLayout 함수

```typescript
function compactLayout(layout: LayoutItem[]) {
  let result = layout.map(l => ({ ...l }));
  result.sort((a, b) => a.y - b.y);
  for (let i = 0; i < result.length; i++) {
    let newY = 0;
    while (newY < result[i].y) {
      const test = { ...result[i], y: newY };
      if (!result.some((o, j) => j !== i && isOverlap(test, o))) {
        result[i].y = newY;
        break;
      }
      newY++;
    }
  }
  return result;
}
```

---

## 4. 구현 순서

### Step 1: 그리드 설정 변경 (15분)

1. `Dashboard.tsx`에서 react-grid-layout 설정 변경
   - `cols: 24`, `rowHeight: 16`, `margin: [6,6]`
2. 기존 위젯 레이아웃을 24칸 기준으로 재매핑
3. **빌드 검증**: `tsc --noEmit && vite build`

### Step 2: 글래스모피즘 + 배경 장식 (30분)

1. `src/styles/widget-glass.css` 생성
2. 배경 장식 (radial gradient blobs) 추가
3. WidgetCard 래퍼 컴포넌트 생성 (3-A 참조)
4. 기존 위젯들을 WidgetCard로 래핑
5. **빌드 검증**

### Step 3: 호버 + Edge Glow (30분)

1. WidgetCard에 호버 상태 추가 (3-B 참조)
2. 8방향 edge 감지 로직 추가 (14px 히트박스)
3. EdgeLine 컴포넌트 구현 (변 glow)
4. CornerGlow 컴포넌트 구현 (ㄴㄱ자 SVG)
5. 커서 매핑 적용
6. **빌드 검증**

### Step 4: 드래그 폴리싱 (45분)

1. 헤더만 드래그 핸들로 설정
   - react-grid-layout의 `draggableHandle` prop 활용
2. 드래그 시작/중/종료 시각 효과 (3-D 참조)
3. 나머지 위젯 dim 효과
4. 안착 flash 애니메이션
5. cursor: grab → grabbing
6. **빌드 검증**

### Step 5: 리사이즈 픽셀 실시간 → 스냅 (45분)

1. 리사이즈 중에는 그리드 무시, 픽셀 단위 실시간 크기 변화
   - react-grid-layout의 onResize 콜백 커스텀
   - 또는 자체 리사이즈 로직 구현 (edge 히트박스 이용)
2. 마우스 놓을 때 가장 가까운 그리드에 스냅
3. settle spring 애니메이션
4. **빌드 검증**

### Step 6: 실시간 충돌 해결 (30분)

1. 드래그/리사이즈 중 매 프레임 previewLayout 계산
2. resolveCollisions + compactLayout 구현
3. 다른 위젯들에 transition: 0.35s 적용하여 부드러운 밀림
4. **빌드 검증**

---

## 5. react-grid-layout 커스터마이징 전략

react-grid-layout은 기본적으로 그리드 기반이므로, "픽셀 실시간 리사이즈"를 구현하려면 두 가지 접근이 있음:

### 접근 A: react-grid-layout 콜백 활용 (권장)

```
- onDragStart/onDrag/onDragStop 콜백으로 시각 효과 추가
- onResizeStart/onResize/onResizeStop 콜백 활용
- CSS 오버라이드로 transition/glow 효과 추가
- 장점: 기존 코드 최소 변경
- 단점: 픽셀 실시간 리사이즈는 제한적 (그리드 단위로 움직임)
```

### 접근 B: 자체 그리드 엔진 구현 (프로토타입과 동일)

```
- react-grid-layout 제거
- 직접 absolute 포지셔닝 + 드래그/리사이즈 로직 구현
- 장점: 완전한 제어, 픽셀 리사이즈 가능
- 단점: 작업량 큼, 기존 레이아웃 저장/복원 코드 수정 필요
```

### 권장: 접근 A를 먼저 시도, 시각적으로 부족하면 접근 B로 전환

---

## 6. CSS 글로벌 오버라이드

```css
/* src/styles/widget-animations.css */

/* 기본 아이템에 부드러운 transition */
.react-grid-item {
  transition: transform 0.35s cubic-bezier(0.16,1,0.3,1),
              box-shadow 0.2s ease,
              opacity 0.2s ease !important;
}

/* 드래그 중인 아이템 */
.react-grid-item.react-draggable-dragging {
  z-index: 100 !important;
  opacity: 0.95 !important;
  transition: box-shadow 0.15s ease !important;
}

/* 드롭 placeholder */
.react-grid-placeholder {
  background: rgba(108, 92, 231, 0.06) !important;
  border: 2px dashed rgba(108, 92, 231, 0.35) !important;
  border-radius: 12px !important;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

/* 리사이즈 중 */
.react-grid-item.resizing {
  transition: none !important;
}
```

---

## 7. 주의사항

### ❗ 기존 코드 존중
- Dashboard.tsx의 기존 위젯 로직(데이터 흐름, 비즈니스 로직) 절대 건드리지 말 것
- 순수하게 "시각적 레이어"만 추가
- 레이아웃 저장/복원 기능 정상 동작 확인 필수

### ❗ react-grid-layout + Framer Motion 충돌 방지
- react-grid-layout은 CSS transform으로 위치 제어
- Framer Motion의 layout 애니메이션은 WidgetCard 내부에만 적용
- 드래그/리사이즈 중 whileHover 비활성화

### ❗ 성능
- `backdrop-filter: blur(20px)`는 GPU 가속됨, 하지만 위젯이 많으면 부하
- `will-change: transform` 남용 금지 — 드래그 중인 위젯에만 적용
- WidgetCard는 React.memo로 래핑
- resolveCollisions/compactLayout은 throttle 적용 (16ms)

### ❗ Electron 환경
- backdrop-filter는 Chromium 기반이므로 Electron에서 정상 동작
- 별도 polyfill 불필요

---

## 8. 검증 체크리스트

구현 완료 후 하나씩 확인:

- [ ] `tsc --noEmit` 통과
- [ ] `vite build` 통과
- [ ] 위젯이 반투명 유리 재질로 표시 (뒤 배경 비침)
- [ ] 위젯 호버 시 배경색/border 미세 변화
- [ ] 위젯 가장자리 호버 시 해당 변에 보라색 glow 라인
- [ ] 위젯 코너 호버 시 ㄴㄱ자 L-shape SVG glow
- [ ] 가장자리 호버 시 커서가 리사이즈 커서로 변경
- [ ] 헤더 호버 시 cursor: grab
- [ ] 헤더 잡고 드래그 시 cursor: grabbing
- [ ] 드래그 시 위젯 전체가 보라색 border glow로 빛남
- [ ] 드래그 시 나머지 위젯들 어둡게 dim
- [ ] 드래그 중 다른 위젯들이 실시간으로 밀려남 (부드럽게)
- [ ] 드롭 시 placeholder 표시 (보라색 대시 보더)
- [ ] 드롭 시 자연스러운 안착 (spring 바운스)
- [ ] 드롭 순간 보라색 flash
- [ ] 리사이즈 중 위젯이 부드럽게 늘어남/줄어듦
- [ ] 리사이즈 놓으면 그리드에 스냅
- [ ] 위젯 겹침 없음 (어떤 조합으로 움직여도)
- [ ] 기존 레이아웃 저장/복원 정상 동작
- [ ] 기존 위젯 추가/삭제 정상 동작
- [ ] `Electron 빌드` 정상

---

## 9. 참조 프로토타입

이 명세의 모든 인터랙션이 구현된 인터랙티브 프로토타입이 별도로 제공됩니다.
(`bflow-toss-final.jsx` — Claude 아티팩트에서 실행 가능)

프로토타입에서 직접 체험하며 "이 느낌"을 확인한 후 구현하세요.

---

## 10. 추가 레퍼런스

- [토스 테크 블로그 — 이진 트리로 복잡한 프론트엔드 컴포넌트 제작하기](https://toss.tech/article/frontend-tree-structure)
- [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) (참고만, 직접 사용 X)
- Windows 11 Mica/Acrylic 디자인 시스템 (글래스모피즘 레퍼런스)
