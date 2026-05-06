# 글꼴 시스템 — 설계 문서

> **작성일**: 2026-05-06
> **대상 버전**: v1.20.0
> **상태**: 설계 확정, 구현 준비
> **mockup**: [`docs/superpowers/mockups/font-feature-mockup.html`](../mockups/font-feature-mockup.html)
> **선행**: v1.19.x (리비전 보드 리뉴얼 후 안정화 완료)

---

## 1. 배경과 목표

### 현재 상태

- `index.html`의 body에 `font-family: system-ui, sans-serif` 한 줄만 설정 — 윈도우에서는 사실상 맑은 고딕/Segoe UI가 강제됨
- 설정 → "글꼴" 탭 = `FontSizeSection` + `FontColorSection` (5단계 크기 프리셋 + 카테고리별 색상 프리셋)
- **사용자가 글꼴(서체) 자체는 바꿀 수 없음** — 이게 이번 작업의 출발점

### 동기 (한솔님 인터뷰 결과)

1. **가독성** — 현재 OS 기본 글꼴이 눈에 잘 안 들어옴 (특히 숫자 ·작은 텍스트)
2. **분위기/감성** — OS 기본 느낌이 사무적, 더 부드럽거나 진중한 느낌 원함
3. **팀원별 취향** — Studio JBBJ 멤버 ~20명 각자 좋아하는 글꼴이 다름 → 개인별 선택권 필요

### 목표

- 앱 전체에 한 번에 적용되는 **글꼴(서체) 선택 기능**
- 큐레이션 **9종 번들 배포** + **사용자 직접 추가**(OTF/TTF/WOFF/WOFF2) 가능
- 가독성 보조: **줄간격·자간** 슬라이더
- 대시보드 숫자 자동 정렬 (`tabular-nums` 글로벌 적용, 사용자 옵션 없음)
- 개인별 저장 (`preferences.json` 확장, Supabase 미사용)

### 비목표 (이번 범위 밖)

- 카테고리별(제목/본문)로 다른 글꼴 적용 — 한솔님이 "한 방 통일" 선택
- "느낌 묶음" 프리셋 — 한솔님이 후보에서 제외
- 굵기(weight) 슬라이더 — 한솔님이 후보에서 제외
- 공유 폴더 자동 스캔 — 한솔님이 옵션 3(개인별만) 선택

---

## 2. 핵심 사용자 흐름

### 시나리오 A — 큐레이션 글꼴 선택 (가장 흔한 흐름)

1. 사용자가 ⚙️ 설정 → "글꼴" 탭 진입
2. 새 "글꼴 (서체)" 섹션의 **기본 글꼴** 9개 칩 중 하나 클릭 (예: `Noto Sans KR`)
3. 즉시 앱 전체 글꼴 변경 (낙관적 적용 — DOM CSS 변수 즉시 갱신)
4. `preferences.json`에 저장 + `electronAPI.preferencesBroadcastChange`로 다른 창(플로팅 위젯) 동기화

### 시나리오 B — 자기 PC 글꼴 추가 (+ 버튼)

1. **내 글꼴** 그룹의 `＋ 글꼴 추가` 버튼 클릭
2. Electron `dialog.showOpenDialog` 호출 → 윈도우 탐색기 팝업 (필터: `*.otf,*.ttf,*.woff,*.woff2`, multi-select OK)
3. 사용자가 "산돌네오2.otf" 선택 → "열기"
4. 메인 프로세스가 파일을 `%APPDATA%/Bflow-BGonly/fonts/<uuid>.otf`로 복사
5. opentype.js로 메타데이터 파싱 → 폰트 이름 추출 + 한글 글리프 검증
6. preferences.json의 `customFonts[]`에 메타데이터 추가
7. "내 글꼴" 그룹에 칩으로 등장 → 사용자 클릭하면 시나리오 A의 3~4단계
8. 한글 미지원 폰트일 경우 토스트 경고 (`영문/숫자만 표시됩니다`)

### 시나리오 C — 드래그 앤 드롭 추가

1. 사용자가 G드라이브 폴더(또는 어디든)에서 OTF 파일을 드래그
2. 설정 화면 위에 마우스가 올라오면 **드롭존 강조** (점선 보더 + 액센트 색 배경)
3. 떨굼 → 메인 프로세스에 파일 경로 전달 (`font:add-by-path` IPC) → 시나리오 B의 4~7단계

### 시나리오 D — 가독성 조절 (줄간격·자간)

1. "간격" 섹션의 줄간격 슬라이더 조작 (1.2 ~ 2.0)
2. 즉시 미리보기 + DOM 변수 적용 (`--text-line-height`)
3. preferences.json에 저장
4. 자간(letter-spacing) 슬라이더도 동일 흐름
5. "기본값 복원" 버튼 클릭 시 1.55 / 0 으로 복귀

### 시나리오 E — 사용자 폰트 삭제

1. "내 글꼴" 그룹의 폰트 칩 우측 휴지통(×) 클릭
2. 확인 다이얼로그 ("삭제하시겠습니까?")
3. 파일 삭제 + preferences.customFonts에서 제거
4. 만약 현재 적용 중이던 폰트라면 → 자동으로 기본값(Pretendard)으로 폴백

---

## 3. UI 변경 요약

### 3-1. "글꼴" 탭 섹션 구성 (변경 후)

| 순서 | 섹션 | 상태 | 헤더 아이콘 (lucide) |
|------|------|------|----------------------|
| 1 | 글꼴 (서체) | **NEW** | `CaseSensitive` |
| 2 | 글꼴 크기 | 기존 | `Type` |
| 3 | 글자 색상 | 기존 | `Palette` |
| 4 | 간격 | **NEW** | `AlignVerticalSpaceAround` |

### 3-2. 글꼴 (서체) 섹션 — 신규

**기본 글꼴** 그룹 (9종 칩):
- Pretendard ★ (기본값)
- Inter
- Noto Sans KR
- IBM Plex Sans KR
- Spoqa Han Sans Neo
- 나눔고딕
- 고운 도담
- 본명조 (Noto Serif KR)
- 시스템 기본

**내 글꼴** 그룹:
- 추가된 폰트 칩 (휴지통 × 아이콘 포함)
- `＋ 글꼴 추가` 버튼 (점선 보더 → 호버 시 액센트 강조)
- 드롭존 (섹션 전체)

**라이선스 안내 footnote** (AlertTriangle 아이콘 + 호박색):
> "추가하시는 글꼴의 라이선스는 본인이 확인해주세요. 추가된 글꼴은 본인 PC에만 저장됩니다."

### 3-3. 글꼴 크기 / 글자 색상 (기존)

기능 변경 없음. 단:
- 헤더 아이콘만 통일 (`Type`, `Palette`)

### 3-4. 간격 섹션 — 신규

| 항목 | 범위 | step | 기본값 |
|------|------|------|--------|
| 줄간격 | 1.2 ~ 2.0 | 0.05 | 1.55 |
| 자간 | -0.05 ~ 0.10 em | 0.005 | 0 |

"기본값 복원" 버튼 (다른 섹션과 동일 패턴).

### 3-5. 숫자 정렬 — 사용자 옵션 없음 (기본 적용)

`font-variant-numeric: tabular-nums`를 글로벌 CSS에 적용:
- body 단위 적용 시 한글 글자 폭 영향 가능성 → **숫자 영역에만 선택적 적용** (위젯 숫자, 표, 진행률, 시간 표시 등)
- 적용 대상: 위젯 차트 라벨, AssigneeCardsWidget 카드, EpisodeSummaryWidget 셀, OverallProgressWidget % 표시 등
- 구현 방식: Tailwind utility (`tabular-nums` 클래스) + 글로벌 CSS rule (`.tabular, [data-numeric], .num-stack`) 혼합

---

## 4. 데이터 모델 변경

### 4-1. `UserPreferences` 타입 확장

`src/services/settingsService.ts` (또는 그에 준하는 위치):

```typescript
export interface UserPreferences {
  // ... 기존 필드 (themeId, fontScale, fontCategoryScales, fontCategoryColors, ...)

  // 신규 (이번 작업)
  fontFamily?: string;          // 'pretendard' | 'inter' | 'noto-sans-kr' | ... | 'system' | `custom:${uuid}`
  lineHeight?: number;          // 1.2 ~ 2.0, 기본 1.55
  letterSpacing?: number;       // -0.05 ~ 0.10 em, 기본 0
  customFonts?: CustomFont[];   // 사용자 추가 폰트 메타데이터
}

export interface CustomFont {
  id: string;                   // `custom:${uuid}`
  name: string;                 // '산돌네오2' (opentype 메타에서 추출)
  filename: string;             // 디스크에 저장된 실제 파일명 (uuid 기반)
  format: 'otf' | 'ttf' | 'woff' | 'woff2';
  hasKorean: boolean;           // 한글 글리프 존재 여부
  addedAt: string;              // ISO 날짜
}
```

### 4-2. `typography.ts` 확장

```typescript
// 신규
export type FontFamilyId = string; // 자유 문자열 (커스텀 ID 포함)

export const FONT_FAMILIES: Array<{
  id: FontFamilyId;
  label: string;
  cssStack: string;             // CSS font-family stack (fallback 포함)
  group: 'modern' | 'soft' | 'serious' | 'character' | 'system';
}> = [
  { id: 'pretendard',      label: 'Pretendard',         cssStack: `'Pretendard Variable', Pretendard, system-ui, sans-serif`, group: 'modern' },
  { id: 'inter',           label: 'Inter',              cssStack: `Inter, 'Pretendard Variable', Pretendard, system-ui, sans-serif`, group: 'modern' },
  { id: 'noto-sans-kr',    label: 'Noto Sans KR',       cssStack: `'Noto Sans KR', system-ui, sans-serif`, group: 'modern' },
  { id: 'ibm-plex-kr',     label: 'IBM Plex Sans KR',   cssStack: `'IBM Plex Sans KR', system-ui, sans-serif`, group: 'serious' },
  { id: 'spoqa',           label: 'Spoqa Han Sans Neo', cssStack: `'Spoqa Han Sans Neo', system-ui, sans-serif`, group: 'serious' },
  { id: 'nanum-gothic',    label: '나눔고딕',           cssStack: `'Nanum Gothic', system-ui, sans-serif`, group: 'soft' },
  { id: 'gowun-dodum',     label: '고운 도담',          cssStack: `'Gowun Dodum', system-ui, sans-serif`, group: 'soft' },
  { id: 'noto-serif-kr',   label: '본명조',             cssStack: `'Noto Serif KR', serif`, group: 'character' },
  { id: 'system',          label: '시스템 기본',        cssStack: `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`, group: 'system' },
];

export const DEFAULT_FONT_FAMILY: FontFamilyId = 'pretendard';
export const DEFAULT_LINE_HEIGHT = 1.55;
export const DEFAULT_LETTER_SPACING = 0;

export const LINE_HEIGHT_MIN = 1.2;
export const LINE_HEIGHT_MAX = 2.0;
export const LINE_HEIGHT_STEP = 0.05;

export const LETTER_SPACING_MIN = -0.05;
export const LETTER_SPACING_MAX = 0.10;
export const LETTER_SPACING_STEP = 0.005;

export function applyFontFamily(
  familyId: FontFamilyId,
  customFonts: CustomFont[] = [],
): void {
  const root = document.documentElement;
  let stack: string;
  if (familyId.startsWith('custom:')) {
    const cf = customFonts.find((f) => f.id === familyId);
    stack = cf
      ? `'${cf.name}', system-ui, sans-serif`
      : DEFAULT_CSS_STACK;
  } else {
    const meta = FONT_FAMILIES.find((f) => f.id === familyId);
    stack = meta?.cssStack ?? DEFAULT_CSS_STACK;
  }
  root.style.setProperty('--font-family', stack);
}

export function applySpacing(lineHeight: number, letterSpacing: number): void {
  const root = document.documentElement;
  root.style.setProperty('--text-line-height', String(lineHeight));
  root.style.setProperty('--text-letter-spacing', `${letterSpacing}em`);
}
```

`applyPreferencesToDOM` 확장:

```typescript
export function applyPreferencesToDOM(prefs: {
  // ... 기존
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  customFonts?: CustomFont[];
}): void {
  // ... 기존 (size + color)
  applyFontFamily(prefs.fontFamily ?? DEFAULT_FONT_FAMILY, prefs.customFonts ?? []);
  applySpacing(
    prefs.lineHeight ?? DEFAULT_LINE_HEIGHT,
    prefs.letterSpacing ?? DEFAULT_LETTER_SPACING,
  );
}
```

### 4-3. CSS 변수 (index.css)

```css
:root {
  --font-family: 'Pretendard Variable', Pretendard, system-ui, sans-serif;
  --text-line-height: 1.55;
  --text-letter-spacing: 0em;
}

html, body {
  font-family: var(--font-family);
  line-height: var(--text-line-height);
  letter-spacing: var(--text-letter-spacing);
}

/* 사용자 추가 폰트는 동적으로 @font-face 주입됨 (loadCustomFonts) */

/* 위젯 숫자 영역에 자동 tabular-nums */
[data-numeric],
.num-stack,
.tabular,
.widget-card .number,
.episode-summary-cell,
.assignee-card .count,
.progress-percentage {
  font-variant-numeric: tabular-nums;
}
```

---

## 5. IPC 구조 (사용자 폰트 추가)

CLAUDE.md 규칙 — "렌더러에서 직접 fs/dialog 호출 금지, IPC → 메인 → fs". 다음 핸들러 추가:

### 5-1. 메인 프로세스 (electron/main.ts 또는 그에 준하는 위치)

```typescript
// 사용자 폰트 디렉토리
const userFontsDir = path.join(app.getPath('userData'), 'fonts');
fs.mkdirSync(userFontsDir, { recursive: true });

// 1. 파일 선택 다이얼로그 + 추가
ipcMain.handle('font:add', async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Font Files', extensions: ['otf', 'ttf', 'woff', 'woff2'] }],
    title: '글꼴 파일 선택',
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return Promise.all(result.filePaths.map(addFontFromPath));
});

// 2. 드래그앤드롭에서 호출
ipcMain.handle('font:add-by-path', async (event, filePath: string) => {
  return addFontFromPath(filePath);
});

// 3. 삭제
ipcMain.handle('font:delete', async (event, fontId: string) => {
  // ... preferences에서 찾아 파일 삭제
});

// 핵심 로직
async function addFontFromPath(srcPath: string): Promise<CustomFont | { error: string }> {
  // - 형식 검증 (확장자)
  // - opentype.js 파싱 → 폰트 이름 추출
  // - 한글 글리프 검사 (가나다 같은 음절 코드 확인)
  // - UUID 생성 → %APPDATA%/Bflow-BGonly/fonts/<uuid>.<ext> 로 복사
  // - CustomFont 메타 반환
}
```

### 5-2. preload.ts에 노출

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... 기존
  fontAdd: () => ipcRenderer.invoke('font:add'),
  fontAddByPath: (path: string) => ipcRenderer.invoke('font:add-by-path', path),
  fontDelete: (fontId: string) => ipcRenderer.invoke('font:delete', fontId),
});
```

### 5-3. 렌더러에서 폰트 동적 로드

`applyFontFamily` 호출 시 사용자 폰트는 `@font-face` 동적 주입:

```typescript
function injectCustomFontFace(font: CustomFont): void {
  // 이미 있으면 skip
  if (document.querySelector(`style[data-font-id="${font.id}"]`)) return;

  const url = `bflow-font://${font.filename}`; // custom protocol (electron main에 등록)
  const formatHint = { otf: 'opentype', ttf: 'truetype', woff: 'woff', woff2: 'woff2' }[font.format];

  const style = document.createElement('style');
  style.setAttribute('data-font-id', font.id);
  style.textContent = `
    @font-face {
      font-family: '${font.name}';
      src: url('${url}') format('${formatHint}');
      font-display: swap;
    }
  `;
  document.head.appendChild(style);
}
```

`bflow-font://` custom protocol을 메인 프로세스에 등록하여 `userFontsDir` 안의 파일만 안전하게 로드.

---

## 6. 한글 글리프 검증

opentype.js로 폰트 파싱 후 다음 한글 음절을 샘플링하여 모두 글리프가 있는지 확인:

```typescript
const KOREAN_SAMPLE_CHARS = ['가', '나', '다', '한', '글', '안', '녕', '스', '튜', '디', '오'];

function hasKoreanSupport(font: opentype.Font): boolean {
  return KOREAN_SAMPLE_CHARS.every((c) => {
    const glyph = font.charToGlyph(c);
    return glyph && glyph.unicode === c.charCodeAt(0); // .notdef 글리프 아님
  });
}
```

한글 미지원 시 폰트는 추가하되 토스트로 안내:
> ⚠️ "산돌신영" 폰트는 한글 글리프가 없어 영문/숫자만 표시됩니다.

---

## 7. 컴포넌트 구조

### 7-1. FontFamilySection (신규)

```
src/components/settings/FontFamilySection.tsx
```

Props: `{ fontFamily, customFonts, onChange, onCustomFontAdd, onCustomFontDelete }` (또는 useAppStore 직접 접근)

내부 구조:
- 헤더 (아이콘 CaseSensitive + 라벨 + NEW 배지)
- 기본 글꼴 칩 그룹 (FONT_FAMILIES의 'system' 외 8개 + 시스템 기본)
- 내 글꼴 칩 그룹 (customFonts.map → 칩 + 휴지통)
- + 글꼴 추가 버튼 (점선 보더)
- 드롭존 (섹션 전체에 dragover 이벤트)
- 라이선스 footnote

### 7-2. SpacingSection (신규)

```
src/components/settings/SpacingSection.tsx
```

내부 구조:
- 헤더 (AlignVerticalSpaceAround + NEW)
- 줄간격 슬라이더 (FontSizeSection의 카테고리 슬라이더와 동일 패턴)
- 자간 슬라이더 (동일)
- "기본값 복원" 버튼

### 7-3. 통합 — Settings 화면

기존 `src/views/SettingsView.tsx` (또는 그에 준하는 위치)의 'font' 탭 분기에서 다음 4개 컴포넌트를 순서대로 렌더:

```tsx
{activeTab === 'font' && (
  <>
    <FontFamilySection />      {/* 신규 */}
    <FontSizeSection {...} />  {/* 기존 */}
    <FontColorSection />       {/* 기존 */}
    <SpacingSection />         {/* 신규 */}
  </>
)}
```

---

## 8. 영향 범위

### 신규 파일
- `src/components/settings/FontFamilySection.tsx`
- `src/components/settings/SpacingSection.tsx`
- `electron/fontIpc.ts` (또는 main.ts 안에 inline)

### 변경 파일
- `src/utils/typography.ts` — FontFamily 타입, FONT_FAMILIES, applyFontFamily, applySpacing, applyPreferencesToDOM 확장
- `src/services/settingsService.ts` — UserPreferences 확장
- `src/index.css` — CSS 변수 + 폰트 import + tabular-nums 글로벌
- `src/main.tsx` 또는 `src/App.tsx` — 시작 시 preferences 적용 흐름에 fontFamily/spacing 추가
- `electron/main.ts` — IPC 핸들러 + custom protocol 등록
- `electron/preload.ts` — fontAdd/fontDelete 노출
- `src/views/SettingsView.tsx` (또는 SettingsTab) — font 탭에 신규 섹션 통합
- `package.json` — 의존성 추가
- `tailwind.config.js` (필요시) — `tabular-nums` 유틸 활성화

### 추가 NPM 패키지
- `pretendard` (Pretendard 폰트)
- `@fontsource/inter`
- `@fontsource/noto-sans-kr`
- `@fontsource/ibm-plex-sans-kr`
- `@fontsource/nanum-gothic`
- `@fontsource/gowun-dodum`
- `@fontsource/noto-serif-kr`
- `spoqa-han-sans` (Spoqa Han Sans Neo, npm 패키지 존재)
- `opentype.js` (한글 검증 + 폰트 메타 파싱)
- `uuid` (커스텀 폰트 ID)

대략 추가 번들 크기: 한국어 폰트는 큰 편이라 (Noto Sans KR ~10MB) `font-display: swap` + variable font 사용으로 최적화. 실제 다운로드 크기는 첫 사용 시점에만 영향.

### 영향 받는 영역
- 앱 전체 텍스트 (글꼴 변경)
- 위젯 숫자 영역 (tabular-nums 자동 적용)
- 메모, 댓글, 씬 모달 등 (간격 설정 적용)

### 영향 안 받는 영역
- Supabase 통신 — 글꼴 설정은 개인 설정이라 Supabase 안 거침 (CLAUDE.md "Supabase 단일 경로" 규칙 위반 X — 새 분기 추가 X, preferences.json 기존 경로 그대로)
- 데이터 무결성 — 시각적 변경만, 데이터 형식 영향 X
- 기존 색상/크기 설정 — 그대로 작동

### 호환성
- 기존 사용자: `preferences.json`에 `fontFamily` 없으면 기본값 'pretendard'
- 기존 색상/크기 설정 그대로 유지 — 별도 마이그레이션 X
- 첫 실행 후 사용자가 글꼴 직접 바꾸지 않으면 = OS 기본 → Pretendard로 자동 전환됨 (체감 변화 있음)

---

## 9. 검증 / 테스트 전략

### 자동
- TypeScript: `npm run tsc -- --noEmit` (CLAUDE.md 빌드 검증 규칙)
- 빌드: `npm run build`

### 수동 (구현 후 직접 확인 필요)
- 9개 기본 글꼴 모두 클릭 → 즉시 적용 확인
- 줄간격 슬라이더 0.05 단위로 부드럽게 작동
- 자간 슬라이더 동일
- + 버튼 → 다이얼로그 → 폰트 추가 → 칩으로 등장 → 클릭하면 적용
- 드래그앤드롭 → 동일하게 추가
- 한글 미지원 폰트 (예: Roboto.ttf) → 토스트 경고
- 휴지통 클릭 → 삭제 + 적용 중이던 폰트라면 Pretendard로 폴백
- 다른 창(플로팅 위젯) 동기화 — 메인 창에서 글꼴 바꾸면 플로팅도 같이 변경
- 앱 재시작 후 마지막 선택 글꼴 유지

---

## 10. 미래 확장 (옵션, 이번 범위 X)

- **카테고리별 다른 글꼴** — 제목은 본명조, 본문은 Pretendard 같은 식
- **"느낌 묶음" 프리셋** — 글꼴+크기+색을 한 번에 적용 (정보형/감성형/독서모드)
- **G드라이브 공유 폴더 자동 스캔** — 팀 전체가 같은 글꼴 보기
- **굵기(weight) 슬라이더** — 같은 글꼴이라도 얇게/굵게
- **숫자 정렬 사용자 토글** — 만약 tabular-nums가 한글 폭에 영향을 주는 경우 옵션화

---

*디자인 doc 끝. 구현은 writing-plans → executing-plans 흐름으로 단계적 진행.*
