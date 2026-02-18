# BG 진행 현황판 - 구현 계획서

> **Studio JBBJ (장삐쭈) 사코팍 배경 레이아웃 진행 현황 대시보드**
> 이 문서는 Claude Code에서 구현할 때 참조할 전체 컨텍스트 문서입니다.
> **브런치**: `bflow-이슈-f9geR` (메인 아님)
> **통합 대상**: Bflow PWA (나중에 위젯으로 통합 예정, 현재는 독립 시스템)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **앱 이름** | BG 진행 현황판 |
| **타입** | Electron 앱 (독립 실행) → 추후 Bflow PWA 위젯으로 통합 |
| **대상** | Studio JBBJ 팀 (~20명) |
| **데이터 원본** | Google Sheets (읽기/쓰기 양방향) |
| **핵심 목적** | 에피소드별 배경 레이아웃 씬의 진행 상황을 실시간 대시보드로 시각화 |
| **기존 도구** | Slack Canvas (이미지+설명 열람 전용으로 유지) |

### 핵심 동작 원리

```
┌──────────────────────┐     Google Sheets API     ┌──────────────────┐
│    Electron 앱        │ ◄═══════════════════════► │   Google Sheets   │
│                      │     읽기 + 쓰기           │  (데이터 원본)     │
│  - 대시보드 표시      │                          │                  │
│  - 체크박스 편집      │                          │  EP별 시트        │
│  - 이미지 미리보기    │                          │  담당자 시트       │
│  - 위젯 커스터마이징  │                          │                  │
└──────────────────────┘                          └──────────────────┘
         │
         │ (추후)
         ▼
┌──────────────────────┐
│   Bflow PWA           │
│   위젯으로 통합       │
└──────────────────────┘
```

---

## 2. 데이터 구조

### 2.1 슬랙 캔버스 원본 구조 (참고용)

캔버스 상단에 안내 텍스트가 있고, 테이블 형태로 씬 데이터가 나열됨.
제목 예: "애니메이터 - 프랍 유무 중요, 캐릭터 위치랑 배경위치"

| 레이아웃(No) | 씬번호 | 메모(사이즈/프랍유무) | 스토리보드 | 가이드 이미지 | 담당자 | 진행상황 |
|---|---|---|---|---|---|---|
| 1 | a001 | 담배클로즈업(애니메이트) | [이미지] | [이미지] | @원동우 | ☑LO ☑완료 ☑검수 ☑PNG |
| 2 | a002 | 밤 | [이미지] | [이미지] | @원동우 | ☑LO ... |

### 2.2 구글 시트 구조

**에피소드 1개 = 시트 1개**, 에피소드 내 **파트(A, B, C, D)**로 구분

#### 시트 탭 구성

```
📋 사용법           - 사용 가이드
👥 담당자           - 팀원 목록
📊 전체 현황         - Electron 앱이 읽는 집계 시트 (선택)
EP01_A (파트A)      - 에피소드 1, 파트 A
EP01_B (파트B)      - 에피소드 1, 파트 B
EP01_C (파트C)      - 에피소드 1, 파트 C
EP02_A (파트A)      - 에피소드 2, 파트 A
...
```

#### EP 시트 컬럼 정의

| 컬럼 | 타입 | 설명 |
|------|------|------|
| A: No | number | 레이아웃 번호 (1, 2, 3...) |
| B: 씬번호 | string | 씬 코드 (a001, a002...) |
| C: 메모 | string | 사이즈, 프랍 유무, 특이사항 |
| D: 스토리보드 URL | string | 스토리보드 이미지 URL |
| E: 가이드 이미지 URL | string | 가이드/레퍼런스 이미지 URL |
| F: 담당자 | string | 작업 담당자 이름 |
| G: LO | boolean | 레이아웃 작업 완료 여부 (TRUE/FALSE) |
| H: 완료 | boolean | 작업 완료 여부 |
| I: 검수 | boolean | 검수 완료 여부 |
| J: PNG | boolean | PNG 출력 완료 여부 |
| K: 진행률 | formula | `=COUNTIF(G{n}:J{n},TRUE)/4` (자동 계산) |

#### 진행 단계 흐름

```
LO → 완료 → 검수 → PNG
(4단계, 모든 씬 동일)
```

#### 담당자 시트 컬럼

| 이름 | 역할 | 비고 |
|------|------|------|
| 원동우 | 배경 | |
| 김하늘 | 배경 | |
| ... | ... | ... |

---

## 3. UI/UX 요구사항

### 3.1 화면 구성 (탭 또는 위젯)

#### 탭 1: 전체 현황 대시보드

- **전체 완료율 (%)** - 원형 진행률 (큰 원)
- **단계별 진행률** - LO / 완료 / 검수 / PNG 각각 바 차트
  - 각 단계 컬러: LO=#74B9FF, 완료=#A29BFE, 검수=#FDCB6E, PNG=#00B894
- **담당자별 진행률** - 카드 형태, 클릭 시 상세 이동
- **에피소드별 진행률** - 각 에피소드 × 파트별 진행 현황 요약

#### 탭 2: 에피소드별 현황

- 에피소드 선택 (드롭다운 or 탭)
- **파트(A, B, C, D) 탭** - 에피소드 내 파트별 전환
- 각 파트 내 단계별 미니 바 차트
- 담당자 × 단계 매트릭스 테이블

#### 탭 3: 씬 목록 (상세)

**중요: 씬 목록에서도 전체 진행도를 항상 볼 수 있어야 함**

- 상단 고정: 현재 필터 기준 전체 진행률 바
- 에피소드 필터 (드롭다운)
- 파트 필터 (A, B, C, D)
- 담당자 필터 (버튼)
- 검색 (씬번호, 메모)
- 씬 카드 목록:
  - 스토리보드 썸네일 + 가이드 이미지 썸네일 (클릭 시 확대 모달)
  - 씬번호, 메모, 담당자
  - 4단계 체크 칩 (LO / 완료 / 검수 / PNG)
  - **체크박스 편집 가능** → Google Sheets에 즉시 반영
  - 개별 진행률 (0%, 25%, 50%, 75%, 100%)

### 3.2 위젯 커스터마이징 (Bflow 메인 브런치 참고)

**Bflow의 메인 브런치에 있는 레이아웃 편집 기능을 참고하여 구현**

- 대시보드 화면의 각 항목을 "위젯"으로 취급
- 위젯 드래그 & 드롭으로 배치 변경
- 위젯 크기 조절 (그리드 기반)
- 위젯 보이기/숨기기 토글
- 레이아웃 설정 저장 (로컬 or 시트에 저장)

**위젯 목록 (커스터마이징 가능한 단위):**

| 위젯 ID | 이름 | 기본 크기 | 설명 |
|---------|------|----------|------|
| overall-progress | 전체 진행률 | 1x1 | 원형 진행률 |
| stage-bars | 단계별 진행률 | 2x1 | LO/완료/검수/PNG 바 차트 |
| assignee-cards | 담당자별 현황 | 2x1 | 담당자 카드 목록 |
| episode-summary | 에피소드 요약 | 2x2 | EP별 × 파트별 현황 |
| matrix-table | 매트릭스 | 2x1 | 담당자 × 단계 테이블 |
| scene-list | 씬 목록 | 전체 | 상세 목록 (이미지 포함) |

### 3.3 디자인 시스템

```
배경:       #0F1117 (거의 블랙)
카드:       #1A1D27 (다크 그레이)
보더:       #2D3041
텍스트:     #E8E8EE (밝은 회색)
텍스트 약:  #8B8DA3
액센트:     #6C5CE7 (보라)

단계 컬러:
  LO    = #74B9FF (스카이블루)
  완료   = #A29BFE (라벤더)
  검수   = #FDCB6E (골드)
  PNG   = #00B894 (민트)

상태 컬러:
  80%+  = #00B894 (초록)
  50%+  = #FDCB6E (노랑)
  25%+  = #E17055 (주황)
  0%+   = #FF6B6B (빨강)
```

---

## 4. 기술 스택

### 4.1 Electron 앱

| 항목 | 기술 |
|------|------|
| **프레임워크** | Electron + React |
| **언어** | TypeScript |
| **스타일링** | Tailwind CSS |
| **상태 관리** | Zustand 또는 React Context |
| **Google API** | googleapis npm 패키지 |
| **이미지 로딩** | lazy loading + 캐싱 |
| **위젯 시스템** | react-grid-layout (드래그 & 리사이즈) |
| **빌드** | electron-builder |

### 4.2 Google Sheets API 연동

#### 인증 방식

**서비스 계정 (Service Account)** 권장
- 사용자가 매번 로그인할 필요 없음
- 시트를 서비스 계정 이메일에 공유하면 됨
- 키 파일(.json)을 앱에 포함 or 환경변수로 관리

#### API 호출 패턴

```typescript
// 읽기: 전체 시트 데이터 가져오기
sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: 'EP01_A!A:K',
});

// 쓰기: 특정 셀 업데이트 (체크박스 토글)
sheets.spreadsheets.values.update({
  spreadsheetId: SHEET_ID,
  range: 'EP01_A!G3',  // LO 컬럼, 3번째 행
  valueInputOption: 'USER_ENTERED',
  requestBody: { values: [[true]] },
});

// 시트 목록 가져오기 (에피소드/파트 자동 감지)
sheets.spreadsheets.get({
  spreadsheetId: SHEET_ID,
  fields: 'sheets.properties.title',
});
```

#### 시트 이름 규칙으로 에피소드/파트 자동 감지

```
시트 이름 패턴: EP{번호}_{파트}
예: EP01_A, EP01_B, EP02_A, EP02_C

파싱:
  EP01_A → 에피소드 1, 파트 A
  EP03_D → 에피소드 3, 파트 D
```

#### 데이터 동기화 전략

```
1. 앱 시작 시: 전체 데이터 로드 (모든 EP 시트)
2. 주기적 폴링: 30초 ~ 1분 간격으로 변경 감지
3. 체크박스 토글 시: 즉시 API 호출 → 로컬 상태 먼저 업데이트 (낙관적 업데이트)
4. 충돌 처리: 마지막 쓰기가 이김 (Last-Write-Wins)
```

---

## 5. 사용자 경험 플로우

### 5.1 팀원 플로우 (체크하는 사람)

```
Electron 앱 실행
    │
    ▼
에피소드 선택 (예: EP.01)
    │
    ▼
파트 선택 (예: A파트)
    │
    ▼
내 이름으로 필터 (담당자 필터)
    │
    ▼
씬 카드에서 스토리보드/가이드 이미지 확인
    │
    ▼
해당 단계 체크 (예: "스케치 완료" → 검수 체크)
    │
    ▼
→ Google Sheets에 즉시 반영
→ 대시보드 진행률 즉시 업데이트
```

### 5.2 아트 디렉터 플로우 (현황 보는 사람)

```
Electron 앱 실행
    │
    ▼
"전체 현황" 대시보드 확인
    │
    ▼
에피소드별 진행률, 담당자별 현황 한눈에 파악
    │
    ▼
지연되는 파트 클릭 → 상세 씬 목록으로 이동
    │
    ▼
위젯 배치 커스터마이징 (필요 시)
```

### 5.3 슬랙 캔버스와의 관계

```
슬랙 캔버스 (기존 유지)        Electron 앱 (새로 만듦)
┌─────────────────┐           ┌─────────────────┐
│ 📷 이미지 열람    │           │ ☑ 체크 (원본)    │
│ 📝 메모/설명     │   ←링크→  │ 📊 대시보드      │
│ 🔗 앱 링크       │           │ 🖼 이미지 썸네일  │
│                 │           │ 📈 진행률        │
│ "비주얼 레퍼런스" │           │ "작업 현황판"     │
└─────────────────┘           └─────────────────┘

- 캔버스의 체크박스는 더 이상 사용하지 않음
- 캔버스는 고해상도 이미지 열람 + 상세 메모 용도로 유지
- 캔버스에 Electron 앱 다운로드 링크 또는 안내 추가
- 이미지 URL을 캔버스와 시트에서 공유 가능
```

---

## 6. 구현 단계 (로드맵)

### Phase 1: 기반 구축

```
[1-1] Electron + React + TypeScript + Tailwind 프로젝트 세팅
[1-2] Google Sheets API 인증 모듈 구현 (서비스 계정)
[1-3] 시트 데이터 읽기/쓰기 유틸리티 함수 구현
[1-4] 시트 이름 파싱 (EP{n}_{part} → 에피소드/파트 자동 감지)
```

### Phase 2: 핵심 UI

```
[2-1] 앱 레이아웃 (탭 네비게이션 + 에피소드 드롭다운 + 파트 탭)
[2-2] 전체 현황 대시보드 (원형 진행률 + 단계별 바 + 담당자 카드)
[2-3] 에피소드별 현황 (파트 탭 + 매트릭스 테이블)
[2-4] 씬 목록 (이미지 썸네일 + 체크박스 편집 + 필터 + 검색)
[2-5] 씬 목록 상단 고정 전체 진행도 바
[2-6] 이미지 확대 모달
```

### Phase 3: 양방향 동기화

```
[3-1] 체크박스 토글 → Google Sheets 즉시 업데이트
[3-2] 낙관적 업데이트 (UI 먼저 반영, API 후처리)
[3-3] 주기적 폴링으로 다른 사용자 변경 감지
[3-4] 오프라인 처리 (네트워크 끊겼을 때 큐잉)
```

### Phase 4: 위젯 커스터마이징

```
[4-1] react-grid-layout 통합
[4-2] 위젯 드래그 & 리사이즈
[4-3] 위젯 보이기/숨기기 토글
[4-4] 레이아웃 설정 저장/불러오기
[4-5] Bflow 메인 브런치의 레이아웃 편집 UI 참고하여 구현
```

### Phase 5: 마무리 & 배포

```
[5-1] electron-builder로 패키징 (Windows .exe)
[5-2] 자동 업데이트 설정
[5-3] 에러 핸들링 & 로딩 상태 UI
[5-4] 팀 배포 & 온보딩 가이드
```

### Phase 미래: Bflow 통합

```
[F-1] BG 현황판을 Bflow PWA의 위젯 컴포넌트로 추출
[F-2] Bflow의 위젯 시스템과 통합
[F-3] bflow-이슈-f9geR 브런치에 커밋
```

---

## 7. 폴더 구조 (예상)

```
bg-dashboard/
├── package.json
├── electron/
│   ├── main.ts              # Electron 메인 프로세스
│   ├── preload.ts           # 프리로드 스크립트
│   └── ipc/
│       └── sheets.ts        # Google Sheets IPC 핸들러
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── types/
│   │   └── index.ts         # 타입 정의 (Scene, Episode, Part 등)
│   ├── hooks/
│   │   ├── useSheets.ts     # Google Sheets 데이터 훅
│   │   ├── useEpisodes.ts   # 에피소드/파트 파싱 훅
│   │   └── useLayout.ts     # 위젯 레이아웃 훅
│   ├── components/
│   │   ├── layout/
│   │   │   ├── TabBar.tsx
│   │   │   ├── EpisodeSelector.tsx
│   │   │   └── PartTabs.tsx
│   │   ├── dashboard/
│   │   │   ├── OverallProgress.tsx    # 전체 원형 진행률
│   │   │   ├── StageBars.tsx          # 단계별 바 차트
│   │   │   ├── AssigneeCards.tsx      # 담당자 카드
│   │   │   └── EpisodeSummary.tsx     # 에피소드 요약
│   │   ├── scenes/
│   │   │   ├── SceneList.tsx          # 씬 목록
│   │   │   ├── SceneCard.tsx          # 씬 카드 (이미지 + 체크)
│   │   │   ├── StageChip.tsx          # 단계 체크 칩
│   │   │   ├── ImageModal.tsx         # 이미지 확대
│   │   │   └── ProgressHeader.tsx     # 목록 상단 진행도 바
│   │   ├── widgets/
│   │   │   ├── WidgetGrid.tsx         # react-grid-layout 래퍼
│   │   │   ├── WidgetWrapper.tsx      # 위젯 컨테이너
│   │   │   └── LayoutEditor.tsx       # 레이아웃 편집 모드
│   │   └── common/
│   │       ├── Ring.tsx               # 원형 진행률
│   │       ├── Bar.tsx                # 바 진행률
│   │       └── Card.tsx               # 카드 컨테이너
│   ├── services/
│   │   └── sheetsApi.ts      # Google Sheets API 래퍼
│   ├── utils/
│   │   ├── parseSheetName.ts # EP01_A → {ep: 1, part: 'A'} 파싱
│   │   ├── calcStats.ts     # 진행률 계산 유틸
│   │   └── colors.ts        # 디자인 시스템 컬러
│   └── store/
│       └── dashboardStore.ts # Zustand 스토어
├── tailwind.config.js
├── tsconfig.json
├── electron-builder.yml
└── CLAUDE.md                 # Claude Code 컨텍스트 (이 문서 요약)
```

---

## 8. 핵심 타입 정의

```typescript
// 진행 단계
type Stage = 'lo' | 'done' | 'review' | 'png';

// 단일 씬
interface Scene {
  no: number;           // 레이아웃 번호
  sceneId: string;      // 씬 코드 (a001 등)
  memo: string;         // 메모 (사이즈, 프랍 유무)
  storyboardUrl: string; // 스토리보드 이미지 URL
  guideUrl: string;     // 가이드 이미지 URL
  assignee: string;     // 담당자 이름
  lo: boolean;          // LO 완료
  done: boolean;        // 완료
  review: boolean;      // 검수 완료
  png: boolean;         // PNG 출력 완료
}

// 파트 (에피소드 내 A, B, C, D)
interface Part {
  partId: string;       // 'A', 'B', 'C', 'D'
  sheetName: string;    // 'EP01_A'
  scenes: Scene[];
}

// 에피소드
interface Episode {
  episodeNumber: number; // 1, 2, 3...
  title: string;        // 'EP.01'
  parts: Part[];        // 파트 배열 (3~4개)
}

// 담당자
interface Assignee {
  name: string;
  role: string;
  color: string;        // 대시보드 표시 컬러
}

// 위젯 레이아웃
interface WidgetLayout {
  i: string;            // 위젯 ID
  x: number;            // 그리드 x 좌표
  y: number;            // 그리드 y 좌표
  w: number;            // 너비 (그리드 단위)
  h: number;            // 높이 (그리드 단위)
  visible: boolean;     // 표시 여부
}

// 대시보드 통계
interface DashboardStats {
  overallPct: number;
  totalScenes: number;
  fullyDone: number;
  notStarted: number;
  stageStats: { stage: string; done: number; total: number; pct: number }[];
  assigneeStats: { name: string; count: number; pct: number; color: string }[];
  episodeStats: { ep: number; parts: { part: string; pct: number }[] }[];
}
```

---

## 9. Google Sheets 셋업 가이드 (팀용)

### 9.1 시트 생성

1. Google Drive에서 새 스프레드시트 생성
2. 제공된 `BG_진행현황_템플릿.xlsx`를 업로드하거나, 시트 구조를 복사
3. 에피소드별로 시트 탭을 복제: `EP01_A`, `EP01_B`, `EP01_C`, `EP02_A`, ...

### 9.2 서비스 계정 생성

1. Google Cloud Console → 새 프로젝트 생성
2. Google Sheets API 활성화
3. 서비스 계정 생성 → JSON 키 다운로드
4. 스프레드시트를 서비스 계정 이메일에 "편집자"로 공유

### 9.3 이미지 URL 넣기

- Google Drive: 이미지 업로드 → 공유 → "링크가 있는 모든 사용자" → URL 복사
  - `https://drive.google.com/uc?id=FILE_ID` 형식으로 변환
- Slack: 이미지 URL 직접 복사 (workspace 외부 접근 불가할 수 있음)
- 외부 호스팅: 아무 공개 이미지 URL 사용 가능

---

## 10. 참고: Bflow 기존 스펙 요약

(이전 대화에서 확인한 Bflow 핵심 정보)

| 항목 | 내용 |
|------|------|
| 타입 | PWA (Progressive Web App) |
| 기술 스택 | React + TypeScript + Tailwind |
| 핵심 기능 | 위젯 기반 대시보드, 간트 차트, 캘린더, 노드맵 |
| 위젯 시스템 | 4x4 그리드, 드래그 & 리사이즈 |
| 데이터 | Google Drive JSON |
| 브랜드 컬러 | #F0E68C (Khaki Gold) |
| **레이아웃 편집** | 메인 브런치에 위젯 배치 커스터마이징 기능 있음 |

### Bflow 통합 시 고려사항

- BG 현황판의 각 UI 블록을 Bflow 위젯 인터페이스에 맞게 래핑
- Bflow의 위젯 등록 시스템에 BG 위젯들을 추가
- 데이터 소스를 Bflow의 글로벌 스토어와 통합
- `bflow-이슈-f9geR` 브런치에서 작업

---

## 11. 체크리스트 (Claude Code 작업 전 확인)

- [ ] Google Cloud 서비스 계정 JSON 키 준비
- [ ] 스프레드시트 ID 확인
- [ ] Bflow 레포 `bflow-이슈-f9geR` 브런치 접근 확인
- [ ] Bflow 메인 브런치의 레이아웃 편집 코드 참고
- [ ] 팀 담당자 목록 확정
- [ ] 에피소드/파트 구조 확정 (몇 에피소드, 각 몇 파트)

---

*문서 버전: 2026-02-19*
*작성: Claude × 한솔 (Studio JBBJ)*
