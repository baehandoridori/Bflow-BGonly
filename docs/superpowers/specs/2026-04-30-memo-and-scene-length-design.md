# BG/ACT 메모 동시 노출 + 씬 길이 변경 시각 효과 — 디자인 문서

**작성일**: 2026-04-30
**대상 브랜치**: `claude/inspiring-blackwell-d59141`
**대상 버전**: v1.16.0 (예정)
**작성자**: 한솔 × Claude
**시안 목업**: [`demo/scene-meta-mockup.html`](../../../demo/scene-meta-mockup.html) (다크/라이트 토글, 9개 섹션 비교)

---

## 배경

전체 뷰(부서 통합 모드)에서 두 가지 현장 마찰을 해결한다:

1. **메모 노출 한계**: 카드 뷰/시트 뷰 모두 `bgScene ?? actScene`로 **BG 메모만 노출**되어 ACT 메모가 가려진다. 양쪽 모두 메모를 적었어도 한쪽만 보임.
2. **씬 길이 변경 인지 부재**: 한 씬의 길이(영상 시간)가 늘어나거나 줄어들었음을 카드/시트에서 시각적으로 인지할 수단이 없음. 작업자가 변경 여부를 놓침.

---

## 결정사항 요약

| 항목 | 한솔 결정 |
|---|---|
| 카드 뷰 메모 노출 | **A1**: BG/ACT 수직 스택 (각 줄 앞 라벨 칩 `[BG]` `[ACT]`) |
| 시트 뷰 메모 노출 | **B2**: BG 메모 / ACT 메모 컬럼 분리 |
| 씬 길이 변경 데이터 | 새 필드 추가, **수치 무관**. 늘어남/줄어듦 **여부**만 |
| 입력 방식 | **수동 토글** (수치 입력 X) |
| 표시 지속 | **영구 라벨** (사용자가 수동 해제할 때까지) |
| 길이 라벨 표기 | **SVG 아이콘**: `<->` 모양(LD, 늘어남) / `>-<` 모양(SD, 줄어듦). 텍스트 아닌 라인+화살촉 SVG로 줄바꿈 안전 |
| 카드 라벨 위치 | **우상단 (% 진행률 배지 옆)** — 정보 그룹화 |
| 시트 라벨 위치 | **행 좌측 그라데이션** + **씬번호 셀 옆 SVG 칩** |
| 토글 UI | **우클릭 메뉴** (카드/시트 동일 메뉴) |
| 색상 톤 | LD = 초록(#34D399 다크 / #059669 라이트), SD = 빨강(#FB7185 다크 / #DC2626 라이트). 라이트 모드 대응 |
| 툴팁 | LD = "Long Duration · 길이 늘어남", SD = "Short Duration · 길이 줄어듦" |
| 메모 텍스트 italic | **사용 금지** (placeholder 포함) — 장기 디자인 원칙 |

---

## 섹션 1: BG/ACT 메모 동시 노출

### 1-A. 카드 뷰 (옵션 A1 수직 스택)

**현재 동작**:
- [`src/components/scenes/UnifiedSceneCard.tsx:67`](../../../src/components/scenes/UnifiedSceneCard.tsx) 에서 `const primaryScene = bgScene ?? actScene;`
- [라인 207-213](../../../src/components/scenes/UnifiedSceneCard.tsx) 에서 `primaryScene.memo` 한 줄만 렌더 (`text-[11px] text-amber-400/70 line-clamp-1`)
- 결과: BG가 있으면 BG 메모만, BG가 없을 때만 ACT 메모.

**변경 후 동작**:
- 메모 영역에 **두 줄** 렌더 (BG 있으면 BG 줄, ACT 있으면 ACT 줄). 각 줄은 라벨 칩 + 메모 텍스트.
- 한쪽만 있으면 한 줄만 표시 (양쪽 다 비어있으면 메모 영역 자체 비표시).
- 두 부서 모두 메모가 있을 때 카드 높이 약 +14px 증가.

**라벨 칩 디자인**:
- BG 라벨: 시안 컬러 (`--memo-bg-only`: 다크 #93C5FD / 라이트 #1D4ED8) + 14% 배경
- ACT 라벨: 핑크 컬러 (`--memo-act-only`: 다크 #FDA4AF / 라이트 #BE185D) + 14% 배경
- 9px / 폰트 700 / `padding: 1px 5px` / 라운드 4px

**메모 텍스트**:
- 11px / `text-amber-400/70` 톤 유지 (`--memo-soft`)
- `line-clamp: 1` (한 줄로 자름, 넘치면 ellipsis)
- **`font-style: italic` 절대 금지** (장기 원칙)

**구현 위치**: [`UnifiedSceneCard.tsx:207-213`](../../../src/components/scenes/UnifiedSceneCard.tsx)

### 1-B. 시트 뷰 (옵션 B2 컬럼 분리)

**현재 동작**:
- [`UnifiedSceneSheetView.tsx:465`](../../../src/components/scenes/UnifiedSceneSheetView.tsx) 의 `getCellValue`에서 `(m.bgScene ?? m.actScene)?.memo`
- [라인 746](../../../src/components/scenes/UnifiedSceneSheetView.tsx) 의 `SheetEditableCell` value도 동일 로직
- [라인 449-452](../../../src/components/scenes/UnifiedSceneSheetView.tsx) `saveField`도 BG 우선 저장

**변경 후 동작**:
- 시트 컬럼 정의에서 기존 단일 "메모" 컬럼을 **"BG 메모"**, **"ACT 메모"** 두 컬럼으로 분리.
- 각 컬럼의 셀 편집은 해당 부서의 Scene에만 저장 (BG 메모 셀 수정 → bgScene.memo, ACT 메모 셀 수정 → actScene.memo).
- 한쪽이 비어있는 셀은 dim 처리 (`color: var(--text-muted)`, italic 금지) + `—` 표시.
- 행 높이 변화 없음.

**컬럼 너비**:
- 기존 메모 컬럼 너비를 둘로 분할 (각 `1fr`)
- 다른 컬럼(담당자/레이아웃 등)이 좁아지므로, 컬럼 정의 재조정 필요

**구현 위치**:
- 컬럼 정의: [`UnifiedSceneSheetView.tsx`](../../../src/components/scenes/UnifiedSceneSheetView.tsx) 의 column 정의부 (구체 라인은 구현 단계 확인)
- `getCellValue`/`saveField`: 위 라인들을 `bgMemo`/`actMemo` 분기로 변경

### 1-C. 데이터 모델

**변경 없음**. 기존에도 bgScene/actScene이 별도 객체로 분리돼 있고 각각 `memo` 필드 보유 ([`src/types/index.ts:60-75`](../../../src/types/index.ts)). UI 분기만 변경.

---

## 섹션 2: 씬 길이 변경 시각 효과

### 2-A. 데이터 모델 (신규 필드)

Scene 타입에 새 필드 추가 (둘 중 하나의 nullable 값):

```typescript
// src/types/index.ts Scene 인터페이스에 추가
export interface Scene {
  // 기존 필드 …
  lengthChange?: 'LD' | 'SD' | null;  // null = 변경 없음
}
```

- **LD** = Long Duration (길이 늘어남)
- **SD** = Short Duration (길이 줄어듦)
- `null`/`undefined` = 변경 표시 없음
- 수치 입력 없음. 사용자가 우클릭 메뉴로 LD/SD/해제 토글.

**Supabase**:
- `comp_scenes` 테이블에 `length_change` 컬럼 추가 (`text` nullable, check constraint: `IN ('LD', 'SD')`).
- 마이그레이션 SQL은 구현 단계에서 작성.
- 기존 행은 NULL (변경 없음).

### 2-B. SVG 아이콘 정의

텍스트 `<->`/`>-<`는 좁은 컨테이너에서 줄바꿈으로 모양이 분해될 위험. **반드시 SVG**로 그려서 단일 atomic 단위로 처리.

```svg
<!-- LD: <-> 양옆 바깥쪽 화살촉 (길이 늘어남) -->
<symbol id="ic-ld" viewBox="0 0 20 10">
  <line x1="3" y1="5" x2="17" y2="5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
  <polyline points="6,2 3,5 6,8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="14,2 17,5 14,8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>

<!-- SD: >-< 양옆 안쪽 화살촉 (길이 줄어듦) -->
<symbol id="ic-sd" viewBox="0 0 20 10">
  <line x1="6" y1="5" x2="14" y2="5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
  <polyline points="3,2 6,5 3,8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="17,2 14,5 17,8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
</symbol>
```

**구현 방식**:
- 컴포넌트로 추출: `<LengthIcon kind="LD" />` / `<LengthIcon kind="SD" />` (React 컴포넌트로 SVG 인라인 반환)
- 또는 `<symbol>`+`<use>` 방식으로 한 번 정의 후 재사용 (성능 최적화)
- 위치: `src/components/scenes/icons/LengthIcon.tsx` (신규)

**기본 크기**: 20×10 (카드용), 16×8 (시트용 sm 변형)

### 2-C. 카드 뷰 표시 (헤더 우상단)

**위치**: 카드 헤더 우측, % 진행률 배지 *바로 왼쪽*. 즉 `[<->] [75%]` 같은 그룹.

```jsx
<div className="card-header-right" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
  {scene.lengthChange === 'LD' && <LengthBadge kind="LD" />}
  {scene.lengthChange === 'SD' && <LengthBadge kind="SD" />}
  <span className="pct-pill">{combinedPct}%</span>
</div>
```

**LengthBadge 스타일** (`.length-symbol` 클래스):
```css
.length-symbol {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 5px;
  cursor: help;          /* 툴팁 가능 */
  white-space: nowrap;   /* 줄바꿈 방지 */
  flex-shrink: 0;        /* 좁은 부모에서 줄어들지 않음 */
}
.length-symbol.up {       /* LD */
  color: #34D399;         /* --grow-up 다크 */
  background: rgba(52, 211, 153, 0.15);
  border: 1px solid color-mix(in srgb, #34D399 30%, transparent);
}
.length-symbol.down {     /* SD */
  color: #FB7185;         /* --shrink-down 다크 */
  background: rgba(251, 113, 133, 0.15);
  border: 1px solid color-mix(in srgb, #FB7185 30%, transparent);
}
/* 라이트 모드: --grow-up = #059669, --shrink-down = #DC2626 */
```

**툴팁**: `<span title="LD · Long Duration (길이 늘어남)">` (HTML title 속성).

**구현 위치**: [`UnifiedSceneCard.tsx:175-191`](../../../src/components/scenes/UnifiedSceneCard.tsx) 의 헤더 우측 그룹

### 2-D. 시트 뷰 표시 (행 좌측 그라데이션 + 씬번호 셀 SVG 칩)

**1) 씬번호 셀 안 SVG 칩** (`.length-symbol-sheet`):
```css
.length-symbol-sheet {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  border-radius: 4px;
  margin-right: 6px;
  cursor: help;
  white-space: nowrap;       /* 잘림 방지 */
  flex-shrink: 0;            /* 줄어들지 않음 */
}
.length-symbol-sheet.up { color: #34D399; background: rgba(52,211,153,0.15); border: 1px solid color-mix(in srgb, #34D399 28%, transparent); }
.length-symbol-sheet.down { color: #FB7185; background: rgba(251,113,133,0.15); border: 1px solid color-mix(in srgb, #FB7185 28%, transparent); }

.sheet-cell.no { white-space: nowrap; overflow: visible; }  /* 칩이 잘리지 않게 */
```

```jsx
<div className="sheet-cell no">
  {scene.lengthChange && <LengthBadge kind={scene.lengthChange} variant="sheet" />}
  {sceneNo}
</div>
```

**2) 행 좌측 그라데이션** (멀리서 봐도 행 인지):
```css
.sheet-row.length-up { background: linear-gradient(90deg, rgba(52,211,153,0.15) 0%, transparent 5%); }
.sheet-row.length-down { background: linear-gradient(90deg, rgba(251,113,133,0.15) 0%, transparent 5%); }
.sheet-row.length-up:hover { background: linear-gradient(90deg, rgba(52,211,153,0.15) 0%, var(--accent-hover) 5%); }
/* 라이트 모드 대응: 색상 변수 자동 전환 */
```

**구현 위치**: [`UnifiedSceneSheetView.tsx`](../../../src/components/scenes/UnifiedSceneSheetView.tsx) 의 시트 행 렌더, 씬번호 셀.

### 2-E. 우클릭 토글 메뉴 (카드/시트 동일)

**현재 패턴 참고**:
- 우클릭 메뉴 패턴은 [`src/components/scenes/EpisodeTreeNav.tsx`](../../../src/components/scenes/EpisodeTreeNav.tsx) 에 이미 구현되어 있음. 동일 패턴 활용.
- 새 컴포넌트: `src/components/scenes/SceneContextMenu.tsx` 만들어서 카드/시트 양쪽에서 재사용.

**메뉴 항목**:
```
─ 씬 길이 변경 ──────
  <-> 길이 늘어남 (LD)    ← scene.lengthChange='LD'
  >-< 길이 줄어듦 (SD)    ← scene.lengthChange='SD'
  ──
  -- -- 표시 해제          ← scene.lengthChange=null
─────────────────
  씬 상세 열기            (기존 액션, 추가 시)
  씬 삭제                 (기존 액션, 추가 시)
```

**Click 동작**:
- LD/SD 클릭 시 즉시 `scene.lengthChange = 'LD'/'SD'` 낙관적 업데이트 (`useDataStore` 액션) → Supabase 동기화 → 실패 시 롤백.
- 다른 클라이언트는 Realtime으로 ~100ms 내 수신.

**위치**: 카드 [`UnifiedSceneCard.tsx`](../../../src/components/scenes/UnifiedSceneCard.tsx) 의 root motion.div + 시트 [`UnifiedSceneSheetView.tsx`](../../../src/components/scenes/UnifiedSceneSheetView.tsx) 의 행 root에 `onContextMenu` 핸들러 부착.

### 2-F. Supabase 동기화

**테이블 변경**:
```sql
-- migration: add length_change to comp_scenes
ALTER TABLE comp_scenes ADD COLUMN length_change text NULL
  CHECK (length_change IS NULL OR length_change IN ('LD', 'SD'));
```

**RPC/직접 update**: 기존 `supabaseService.updateSceneField` 패턴에 `length_change` 추가.

**Realtime**: 기존 `comp_scenes` 채널에 `length_change` 컬럼 변경도 자동 포함됨.

---

## 섹션 3: 디자인 토큰 & 시스템

### 3-A. 색상 토큰 추가

[`src/index.css`](../../../src/index.css) 의 `:root` / `[data-color-mode="light"]`에 추가:

```css
:root {
  --grow-up: #34D399;             /* LD 다크 */
  --grow-up-soft: rgba(52, 211, 153, 0.15);
  --shrink-down: #FB7185;          /* SD 다크 */
  --shrink-down-soft: rgba(251, 113, 133, 0.15);
}
[data-color-mode="light"] {
  --grow-up: #059669;
  --grow-up-soft: rgba(5, 150, 105, 0.14);
  --shrink-down: #DC2626;
  --shrink-down-soft: rgba(220, 38, 38, 0.12);
}
```

[`tailwind.config.js`](../../../tailwind.config.js) 의 colors 확장에 추가:
```js
colors: {
  // 기존 …
  'length-up': 'var(--grow-up)',
  'length-up-soft': 'var(--grow-up-soft)',
  'length-down': 'var(--shrink-down)',
  'length-down-soft': 'var(--shrink-down-soft)',
}
```

### 3-B. SVG `<defs>` 마운트 위치

`src/App.tsx` 또는 별도 `<SvgIconDefs>` 컴포넌트 → 앱 root에 한 번만 마운트:
```tsx
<svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
  <defs>
    <symbol id="ic-ld">{/* … */}</symbol>
    <symbol id="ic-sd">{/* … */}</symbol>
  </defs>
</svg>
```

이후 어디서든 `<svg className="length-icon"><use href="#ic-ld" /></svg>` 로 참조.

### 3-C. 메모 텍스트 italic 금지 (장기 원칙)

- 메모 관련 모든 텍스트(`.memo-text`, `.sheet-cell.memo`, 댓글 등)에 **`font-style: italic` 사용 금지**.
- 빈/placeholder는 색상(`--text-muted`)이나 opacity로만 약화.
- 한솔 명시 결정 (2026-04-30, "향후에도 빼줘"). [`feedback_memo_italic.md`](../../../../../Users/user/.claude/projects/C--Bflow-BGonly/memory/feedback_memo_italic.md) 메모리에 보존.

---

## 섹션 4: 영향 받는 파일

| 파일 | 변경 내용 |
|---|---|
| [`src/types/index.ts`](../../../src/types/index.ts) | `Scene` 인터페이스에 `lengthChange?: 'LD' \| 'SD' \| null` 추가 |
| [`src/components/scenes/UnifiedSceneCard.tsx`](../../../src/components/scenes/UnifiedSceneCard.tsx) | 메모 영역 두 줄 렌더(A1) + 헤더 우상단 LD/SD 칩 + onContextMenu |
| [`src/components/scenes/UnifiedSceneSheetView.tsx`](../../../src/components/scenes/UnifiedSceneSheetView.tsx) | 메모 컬럼 분리(B2) + 행 좌측 그라데이션 + 씬번호 옆 SVG 칩 + onContextMenu + getCellValue/saveField 분기 |
| `src/components/scenes/SceneContextMenu.tsx` | 신규 — 카드/시트 공용 우클릭 메뉴 |
| `src/components/scenes/icons/LengthIcon.tsx` | 신규 — `<LengthIcon kind="LD\|SD" />` 컴포넌트 |
| `src/components/SvgIconDefs.tsx` (또는 App에 인라인) | 신규 — 페이지 root SVG defs |
| [`src/index.css`](../../../src/index.css) | `--grow-up*`, `--shrink-down*` 토큰 + `.length-symbol*` / `.sheet-row.length-up/down` 클래스 |
| [`tailwind.config.js`](../../../tailwind.config.js) | colors 확장 |
| [`src/stores/useDataStore.ts`](../../../src/stores/useDataStore.ts) | `setSceneLengthChange(sceneUuid, value)` 액션 추가 (낙관적) |
| [`electron/supabase.ts`](../../../electron/supabase.ts) | `length_change` 컬럼 read/write 처리 |
| `DEVLOG/migrations/<날짜>-add-length-change.sql` | DB 마이그레이션 SQL |

---

## 섹션 5: 미해결 사항 / 추후 결정

- **부서별 길이 변경 분리 여부**: 현재는 씬 단위 한 값(LD/SD/null). 만약 BG만 길이 늘어나고 ACT는 그대로인 케이스를 구분하고 싶다면 데이터 모델 확장 필요(`bgLengthChange`, `actLengthChange`). v1.16.0에서는 단일 값으로 시작, 필요 시 후속 버전에서 확장.
- **길이 변경 이력 로깅**: Activity 로그(`comp_activities`)에 LD/SD 토글을 기록할지. 토글 빈도가 잦을 수 있으므로 v1.16.0에서는 일단 로깅 X, 향후 검토.
- **자동 해제 트리거**: PNG 단계 완료 시 자동으로 lengthChange 해제 등은 도입하지 않음 (한솔 결정: "영구 라벨, 수동 해제까지").

---

## 참고 자료

- 시안 목업 (다크/라이트 토글, 9개 섹션, 카드/시트 비교): [`demo/scene-meta-mockup.html`](../../../demo/scene-meta-mockup.html)
- 미리보기 서버: `python -m http.server 5558` → http://localhost:5558/demo/scene-meta-mockup.html
- 기존 컨텍스트 메뉴 패턴 참고: [`src/components/scenes/EpisodeTreeNav.tsx`](../../../src/components/scenes/EpisodeTreeNav.tsx)
- 기존 카드/시트 구조: [`src/components/scenes/UnifiedSceneCard.tsx`](../../../src/components/scenes/UnifiedSceneCard.tsx) / [`src/components/scenes/UnifiedSceneSheetView.tsx`](../../../src/components/scenes/UnifiedSceneSheetView.tsx)
- 디자인 토큰 정의 위치: [`src/index.css:59-99`](../../../src/index.css), [`tailwind.config.js`](../../../tailwind.config.js)
