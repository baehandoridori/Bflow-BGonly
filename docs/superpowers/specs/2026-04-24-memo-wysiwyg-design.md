# 메모 위젯 WYSIWYG 에디터 전환 (이슈 3 / v1.13.0)

- 작성일: 2026-04-24
- 브랜치: `claude/clever-heisenberg-94a6df`
- 대상 범위: 메모 위젯(`MemoWidget.tsx`) 에디터 엔진 전면 교체, 툴바 확장(4→11), 링크 버블 메뉴 신규, 미리보기 토글 제거
- PR 단위: **단일 PR** (사용자 결정)
- 전제: 메모 저장 형식은 **Markdown 문자열 유지** → 기존 Supabase `user_memos` 데이터 100% 호환, 마이그레이션 불필요

---

## 1. 배경

현재 메모 위젯은 `<textarea>` + 자체 마크다운 렌더러(`SimpleMarkdown`) 조합으로 동작한다. 즉, 쓸 때는 `**굵게**` 같은 기호가 그대로 보이고, 👁 **미리보기 토글**을 눌러야 실제 렌더링을 확인할 수 있다. 비개발자 팀원 다수가 이 위젯을 매일 사용하는데, **"마크다운 기호를 기억하고 직접 타이핑해야 한다"** 는 진입 장벽이 존재한다.

### 현재 Pain Points

| 증상 | 영향 |
|------|------|
| **마크다운 기호 노출** | `**굵게**` `__밑줄__` 같은 기호가 편집 중 계속 보여 가독성 저하 |
| **미리보기 토글 전환 필요** | 렌더링 결과 보려면 모드 전환 → "쓰면서 확인"이 불가능 |
| **제한된 서식 4개** | Bold/Italic/Underline/Strike만 툴바 지원 → 헤딩·리스트·링크는 수동 타이핑 |
| **리스트·헤딩 기호 외우기** | `- ` `1. ` `# ` `## ` 등을 외워야 사용 가능 |
| **링크 삽입 불가** | Markdown `[text](url)` 직접 타이핑 외 방법 없음 |

### 근본 방향

"**쓰는 순간 = 보이는 순간**" 원칙으로 전환 (WYSIWYG — What You See Is What You Get). 단, **저장 형식은 Markdown 문자열로 고정** → 데이터 호환성·백업 가능성·단순성 유지.

---

## 2. 해결 전략 — TipTap 기반 WYSIWYG

### 2.1 라이브러리 선택

**TipTap v2** (ProseMirror 기반). 이유:

- **React 친화적**: `@tiptap/react` 공식 패키지, hook API
- **Extension 구조**: 필요한 기능(Bold/Italic/Link/TaskList …)만 조립
- **Markdown 왕복**: `tiptap-markdown` 어댑터로 HTML ↔ Markdown 무손실 왕복
- **Active state API**: `editor.isActive('bold')` 로 툴바 버튼 상태 즉시 파악
- **BubbleMenu**: 링크 버블 UI를 확장으로 제공 (위치 계산·화면 경계 대응 내장)

### 2.2 대안 기각 근거

| 대안 | 기각 사유 |
|------|----------|
| **Lexical (Meta)** | 성능 우수하나 Markdown 직접 지원 약함, 커스텀 파서/시리얼라이저 필요 — 번들 유사한데 작업량 +2배 |
| **ContentEditable 직접 구현** | 커서/선택/undo redo 직접 다뤄야 함. 브라우저별 엣지케이스 대응 공수 과다 |
| **현행 유지 + 인라인 프리뷰** | 근본 문제(마크다운 노출) 미해결. 토큰 경제 측면에서도 반쪽 해결 |

### 2.3 번들 영향

TipTap + 필수 extension 7개 추가 시 **gzip +~110KB**. 현재 번들 기준 체감 영향 작음(Portable exe 빌드에서 무시 가능). 사용자 승인 완료(2026-04-24).

---

## 3. 저장 형식 — Markdown 유지

### 3.1 왜 Markdown?

- 기존 `user_memos.tabs[].content` 필드가 Markdown 문자열 → **마이그레이션 제로**
- 사용자가 `memo.json.bak`이나 내보내기로 열어도 여전히 읽을 수 있음
- TipTap `tiptap-markdown` 확장이 양방향 변환 제공

### 3.2 앱 관습(비표준) 처리

**문제**: 표준 Markdown(GFM)에서 `__text__`는 **Bold**이다. 그러나 B flow 앱은 과거부터 `__text__`를 **밑줄(underline)** 로 써왔다(`SimpleMarkdown` 구현).

**해결**: `tiptap-markdown` 의 **custom serializer/parser 오버라이드**로 앱 관습 유지. 구현 접근:

`tiptap-markdown` 은 내부적으로 **markdown-it** 을 parser로, **custom token serializer** 를 writer로 사용한다. 기본적으로 markdown-it의 `emphasis` 규칙이 `__x__`를 `<strong>` 으로 처리하므로 다음 두 가지를 수정한다:

**Parser (Markdown → HTML)**:
```typescript
// markdownExtensions.ts
export const markdownItConfigure = (md: MarkdownIt) => {
  // 1) 기본 emphasis 규칙에서 __ (언더스코어 double) 처리를 끄고
  //    __x__ 를 Underline으로 처리하는 custom inline rule 삽입
  md.inline.ruler.before('emphasis', 'underline', underlineRule);
  //    underlineRule 내부에서 __ 토큰만 소비, * / ** / ~~는 건드리지 않음
};
```
`underlineRule` 은 `state.src.slice(state.pos, state.pos+2) === '__'` 확인 후 닫는 `__` 위치를 찾아 `u_open` / `u_close` 토큰 push. 실패 시 false 반환하여 다른 규칙으로 양보.

**Serializer (HTML → Markdown)**:
```typescript
// MemoEditor 에서 Markdown extension 설정:
Markdown.configure({
  html: false,
  transformPastedText: true,
  transformCopiedText: true,
  // tiptap-markdown 은 extension별 toMarkdown 훅 제공
});

// Underline mark 정의 시 toMarkdown 지정:
Underline.extend({
  addStorage() { return { markdown: { serialize: { open: '__', close: '__', mixable: true, expelEnclosingWhitespace: true } } }; },
});
```

**결과**:

```
Markdown 저장:              HTML 렌더:
**굵게**                    <strong>굵게</strong>
*기울임*                    <em>기울임</em>
__밑줄__     ← 비GFM       <u>밑줄</u>
~~취소선~~                  <s>취소선</s>
```

**검증**: Phase A에서 단위 테스트 — 원본 Markdown 문자열 N개를 parse → serialize 왕복 시 문자열 동일성 확인 (fixture).

### 3.3 줄바꿈 처리

현재 `SimpleMarkdown`은 `\n`마다 `<div>`를 만들지만 Markdown 표준은 빈 줄(`\n\n`)만 단락 구분이다. TipTap은 `<p>` 단락 단위.

**결정**: TipTap 기본 동작(표준 Markdown) 채택. 단일 줄바꿈은 `Shift+Enter` → `<br>` (hardBreak). 기존 메모에서 `\n` 이 여러 개 연속된 경우, 렌더 결과가 현재보다 단락 간격이 살짝 달라질 수 있음(허용 범위 — 사용자에 경고 불요).

---

## 4. UI/UX 사양

### 4.1 전체 구조

```
┌────────────────────────────────────────────────────┐
│ [📝 메모]                          👁 🔠 ━●━ 14  │   ← 위젯 헤더 (폰트 슬라이더 유지, 👁 토글 제거)
├────────────────────────────────────────────────────┤
│ [메모1] [메모2] [+]                                │   ← 탭바 (변경 없음)
├────────────────────────────────────────────────────┤
│ B I U S │ H₁ H₂ H₃ │ ≡ 1≡ ☑≡ │ 🔗              │   ← 툴바 (신규, 높이 28px)
├────────────────────────────────────────────────────┤
│                                                    │
│ 에디터 본문 (TipTap)                                │
│                                                    │
└────────────────────────────────────────────────────┘
```

### 4.2 툴바 사양

**레이아웃**: 반응형. 에디터 가로폭 ≥ 320px → 11개 버튼 1행. < 320px → 헤딩 3개는 [단락▾] 드롭다운으로, 리스트 3개는 [리스트▾] 드롭다운으로 축약. `ResizeObserver` 로 감지.

**버튼 11개**:

| 그룹 | 버튼 | 기능 | 단축키 |
|------|------|------|--------|
| 인라인 | **B** | Bold | Ctrl+B |
| 인라인 | *I* | Italic | Ctrl+I |
| 인라인 | U | Underline | Ctrl+U |
| 인라인 | S | Strike | Ctrl+Shift+X |
| 헤딩 | H₁ | Heading 1 | Ctrl+Alt+1 |
| 헤딩 | H₂ | Heading 2 | Ctrl+Alt+2 |
| 헤딩 | H₃ | Heading 3 | Ctrl+Alt+3 |
| 리스트 | ≡ | Bullet List | Ctrl+Shift+8 |
| 리스트 | 1≡ | Ordered List | Ctrl+Shift+7 |
| 리스트 | ☑≡ | Task List | Ctrl+Shift+9 |
| 링크 | 🔗 | Link | Ctrl+K |

**4가지 상태**:

| 상태 | 시각 |
|------|------|
| Default | `text-text-secondary/60`, 투명 배경 |
| Hover | `text-accent bg-accent/10` |
| Active (서식 적용된 위치에 커서) | `text-accent bg-accent/15` |
| Focus-visible (키보드) | `ring-1 ring-accent/40` 추가 |
| **Disabled** (editor === null, 초기 로딩 중) | `opacity-40 cursor-not-allowed`, 클릭 무시 |

**크기 & 간격**: 버튼 22×22px, 아이콘 13px (Lucide). 그룹 내 2px gap, 그룹 간 8px gap + `border-l border-bg-border/40` 세로 구분선.

**툴팁**: `<button title="...">` + `aria-label`. 예: `title="굵게 (Ctrl+B)" aria-label="굵게"`.

**제거**: 기존 `Eye/Pencil` 미리보기 토글 버튼, `previewMode` state, `SimpleMarkdown` 컴포넌트, `inlineFormat` 함수, `applyMarkdown` 함수, `FormatToolbar` 컴포넌트.

### 4.3 에디터 본문

**헤딩 크기**: 본문 폰트 크기(슬라이더 값)에 비율 연동. **`em` 단위 사용** (CSS scale/transform 제외 — 레이아웃 flow 유지).
- H1 = `1.6em` (font-semibold, leading-tight, mt-4 mb-2)
- H2 = `1.35em` (font-semibold, leading-tight, mt-3 mb-1.5)
- H3 = `1.15em` (font-medium, leading-snug, mt-2 mb-1)

구현: `style={{ fontSize: fontSize + 'px' }}` 로 에디터 컨테이너(`ProseMirror` root) 에 픽셀 단위 폰트 지정. 자식 헤딩은 CSS 클래스에 `font-size: 1.6em` 등 지정 → 상위 fontSize 기반 자동 계산. 슬라이더 변경 시 컨테이너 style만 리렌더되고 헤딩은 상대값으로 즉시 추종.

**리스트**:
- Bullet: `list-disc pl-5`, TipTap `BulletList` extension
- Ordered: `list-decimal pl-5`, TipTap `OrderedList` extension
- Task: `TaskList + TaskItem` extension
  - 체크박스 12×12, `border-bg-border/60 rounded`
  - 체크 시 `bg-accent border-accent`, 체크마크는 `text-on-accent`
  - 체크된 항목 텍스트: `text-text-secondary/50 line-through`
  - 편집 모드와 무관하게 체크박스 토글 가능

**인라인 서식**:
- Bold: `<strong>` → `font-bold`
- Italic: `<em>` → `italic`
- Underline: `<u>` → `underline underline-offset-2 decoration-text-primary/40`
- Strike: `<s>` → `line-through decoration-text-primary/50`

**링크**: `text-accent underline underline-offset-2 decoration-accent/50 cursor-pointer hover:decoration-accent`. Electron 환경에서 클릭 시 `shell.openExternal` 로 기본 브라우저에서 열림 (in-app 네비게이션 금지). 기존 프리로드 API `electronAPI.openExternal` 활용.

**Placeholder**: TipTap `Placeholder` extension, 텍스트 `"메모를 입력하세요..."`, 스타일 `text-text-secondary/30`.

### 4.4 링크 버블 메뉴

**Trigger**:
- 새 링크: 텍스트 선택 후 툴바 🔗 클릭 또는 `Ctrl+K`
- 기존 링크 편집/제거: 링크 노드 위에 커서 진입 시 자동 노출

**2가지 모드**:

**편집 모드 (새 링크 / 편집)**:
```
┌─────────────────────────────────────┐
│ 🔗 [https://...            ] [✓]   │
└─────────────────────────────────────┘
```
- URL input 자동 포커스
- Enter 또는 [✓] → 적용
- ESC → 취소, 버블 닫힘, 에디터 포커스 복귀
- 빈 값 Enter → 무동작

**읽기 모드 (기존 링크 위)**:
```
┌─────────────────────────────────────┐
│ studiojbbj.com   [↗] [✏] [✖]       │
└─────────────────────────────────────┘
```
- [↗] = 브라우저로 열기
- [✏] = 편집 모드로 전환 (기존 URL 프리필)
- [✖] = 링크 제거 (텍스트 유지)
- URL 길면 `truncate max-w-[180px]`

**스펙**:

| 항목 | 값 |
|------|-----|
| 위치 | 선택영역/링크 상단 8px, 화면 경계 시 하단 뒤집기 (TipTap BubbleMenu 기본) |
| 배경 | `bg-bg-card` |
| 테두리 | `border border-bg-border` |
| 그림자 | `shadow-lg shadow-bg-primary/40` |
| 모서리 | `rounded-lg` |
| 패딩 | `px-2 py-1.5` |
| 최소 너비 | 240px |
| 애니메이션 | `animate-fade-in` (기존 키프레임 재사용) |
| z-index | 50 |

**URL 유효성** (화이트리스트, `shell:open-external` IPC 핸들러와 동일):
- `https?:`, `mailto:`, `tel:` **프로토콜만 허용**
- 그 외 (상대경로 `/foo`, 미지원 프로토콜 `ftp://`, 공백 포함, 프로토콜 없는 도메인에 `.tld` 없음) → `null` 반환 → 저장 거부 + sonner 토스트 노출
- 프로토콜 없는 도메인 형태 (`example.com`)는 `https://` 자동 prepend
- TipTap `Link.configure` 의 `isAllowedUri` 로도 같은 화이트리스트 강제 — autolink / paste / setLink 모든 경로에서 `ftp://` 등 차단

> 초기 설계에서는 상대경로 `/foo` 허용도 포함했으나, Electron 의 `shell.openExternal` 이 상대 경로를 열지 못해 **죽은 링크**가 생기는 문제가 발견되어(Codex 1차 리뷰) 거부로 확정. 앱 내부 라우팅이 필요한 경우 별도 기능으로 분리.

**접근성**:
- URL input: `aria-label="링크 URL"`, 자동 포커스
- Tab 순서: input → ✓ → (닫기)
- ESC로 버블 닫힘

### 4.5 색상 & 테마

**원칙**: 모든 색상은 CSS 변수 토큰만 사용. Hex/rgb 리터럴 하드코딩 금지.

허용 토큰:
- 배경: `bg-bg-primary`, `bg-bg-card`, `bg-bg-border`
- 텍스트: `text-text-primary`, `text-text-secondary`
- 강조: `bg-accent`, `text-accent`, `text-on-accent`, `bg-accent-sub`
- 시멘틱: `bg-overlay`
- Alpha: `/10`, `/15`, `/20`, `/30`, `/40`, `/50`, `/60`, `/90` 활용

이렇게 하면 6개 프리셋 테마(바이올렛/시네마 레드/미드나잇 블루/에메랄드/앰버 골드/머쉬룸) + 커스텀 테마 + 라이트/다크 모드가 자동 대응.

---

## 5. 파일 구조 & 컴포넌트 분해

### 5.1 신규 파일

| 파일 | 역할 | LOC 예상 |
|------|------|----------|
| `src/components/widgets/memo/MemoEditor.tsx` | TipTap `useEditor` 캡슐화, Extension 구성, content/onChange 프로퍼티 | ~120 |
| `src/components/widgets/memo/MemoToolbar.tsx` | 11개 버튼 + 반응형 드롭다운 + Active state 바인딩 | ~180 |
| `src/components/widgets/memo/MemoLinkBubble.tsx` | 링크 버블 메뉴 (편집/읽기 모드 전환) | ~100 |
| `src/components/widgets/memo/markdownExtensions.ts` | tiptap-markdown custom serializer/parser (`__x__` → Underline) | ~60 |

### 5.2 기존 파일 변경

| 파일 | 변경 |
|------|------|
| `src/components/widgets/MemoWidget.tsx` | 대규모 리팩터. `SimpleMarkdown`/`inlineFormat`/`applyMarkdown`/`FormatToolbar`/`previewMode` 제거. `MemoEditor` + `MemoToolbar` + `MemoLinkBubble` 조립 |
| `package.json` | TipTap 7개 의존성 추가 |
| `src/index.css` (선택) | ProseMirror 선택 영역 스타일 토큰 override (선택/커서 색 `accent` 따라가게) |

### 5.3 컴포넌트 인터페이스

**MemoEditor**:
```typescript
interface MemoEditorProps {
  content: string;              // Markdown 문자열
  onChange: (next: string) => void;  // debounce는 상위에서 처리
  fontSize: number;             // 본문 기준 폰트 크기
  placeholder?: string;
  editorRef?: (editor: Editor | null) => void;  // 툴바/버블이 editor 인스턴스 참조
}
```

**MemoToolbar**:
```typescript
interface MemoToolbarProps {
  editor: Editor | null;        // null일 동안 disabled
  containerRef: RefObject<HTMLDivElement>;  // ResizeObserver 대상
}
```

**MemoLinkBubble**:
```typescript
interface MemoLinkBubbleProps {
  editor: Editor | null;
}
```

모두 상위 `MemoWidget` 이 `useEditor` 훅의 결과를 props로 전달. 각 컴포넌트는 editor 상태만 의존, 내부 state 최소화.

---

## 6. 데이터 흐름

```
[사용자 타이핑]
      ↓
[TipTap Editor]  ─── isActive('bold') ──→  [MemoToolbar Active state]
      ↓
[onUpdate 이벤트]
      ↓
[Markdown serialize (tiptap-markdown + custom)]
      ↓
[MemoWidget setMemoData(activeTab.content = markdown)]
      ↓
[500ms debounce]
      ↓
[supabaseService.upsertMemo]
      ↓
[Supabase user_memos]
```

**반대 방향 (로드)**:

```
[Supabase user_memos]
      ↓
[supabaseService.readMemo]
      ↓
[MemoWidget setMemoData]
      ↓
[MemoEditor.content = markdown]
      ↓
[Markdown parse (tiptap-markdown + custom)]
      ↓
[ProseMirror Document]
      ↓
[렌더]
```

탭 전환 시: 활성 탭의 `content`를 `editor.commands.setContent(markdown)` 로 주입. `key={activeTab.id}` 로 에디터 리마운트 유도(현 textarea 패턴 유지).

---

## 7. 인터랙션 — 키보드 단축키

### 7.1 에디터 내부 단축키 (TipTap이 처리)

§4.2 버튼 표의 11개 단축키는 모두 TipTap Extension 기본 바인딩 또는 커스텀 `addKeyboardShortcuts` 로 구현.

### 7.2 앱 전역 단축키와의 충돌 검증

현재 앱 글로벌 단축키(`useGlobalShortcuts.ts`):
- `Ctrl+B` = 사이드바 토글
- `Ctrl+Space` = Spotlight
- `Ctrl+1~8` = 뷰 전환
- `Ctrl+E` = 편집 모드
- `Ctrl+R` = 새로고침

**Ctrl+B 충돌**: `useGlobalShortcuts` 에서 `isEditable` 체크가 있어 **입력 필드(ContentEditable 포함) 내에서는 뷰 전환/편집 단축키 무시**. TipTap 에디터는 ContentEditable이므로 에디터 포커스 시 Ctrl+B가 사이드바를 토글하지 않고 TipTap Bold로 동작. ✅ 해결.

**Ctrl+K 충돌**: 앱 전역 바인딩 없음. ✅ 문제 없음.

**Ctrl+Alt+1/2/3**: 앱에 없음. ✅ 문제 없음.

**Ctrl+Shift+7/8/9/X**: 앱에 없음. ✅ 문제 없음.

### 7.3 Escape 처리

에디터 포커스 상태에서 Escape → 링크 버블이 열려있으면 버블 닫기, 아니면 에디터 blur. 전역 `bflow:escape` 커스텀 이벤트는 `useGlobalShortcuts` 가 이미 발행 중이므로 부가 작업 불요.

---

## 8. 호환성 & 마이그레이션

### 8.1 데이터 마이그레이션

**없음**. Supabase `user_memos` 는 Markdown 문자열 그대로 유지.

### 8.2 기존 메모 파싱 리스크

기존 `SimpleMarkdown` 이 허용한 표기 vs TipTap 파싱 결과:

| 기존 표기 | 현재 결과 | 신규 결과 (TipTap + custom) | 호환 |
|-----------|-----------|-----------------------------|------|
| `**x**` | Bold | Bold | ✅ |
| `*x*` | Italic | Italic | ✅ |
| `__x__` | Underline (앱 관습) | Underline (custom serializer) | ✅ |
| `~~x~~` | Strike | Strike (GFM) | ✅ |
| `- item` | Bullet | Bullet | ✅ |
| `1. item` | Ordered | Ordered | ✅ |
| `1) item` | Ordered (느슨한 매칭) | 일반 텍스트 | ⚠ 희귀 케이스 (§8.2.1 검증) |
| `# heading` | 일반 텍스트 (헤딩 미구현) | H1 | 🟢 개선 |
| 빈 줄 | `<div h-1.5>` | `<p><br></p>` | 허용 오차 |
| 연속 `\n` | 각 줄마다 div | 한 단락 내 hardBreak 또는 단락 분리 | 허용 오차 |

**대응**: `1) item` 패턴은 전체 메모 내 거의 없음(추정). 발견 시 사용자가 수동 보정. 그 외 변화는 **업그레이드 방향**(헤딩 렌더 추가).

### 8.2.1 구현 착수 전 실제 빈도 검증 (단발성 SQL)

Phase A 시작 전 Supabase SQL 에디터에서 1회 실행:

```sql
-- tabs 배열 안의 content 내 '1) ' 또는 '2) ' 등 패턴 포함 카운트
SELECT COUNT(*) FROM user_memos
WHERE tabs::text ~ '\d+\) ';
```

- **결과 0~5건**: 수용 — 사용자 수동 보정 전제로 진행
- **결과 >5건**: 이 spec 에 `1)` → `1.` 정규화 one-shot 마이그레이션 step 추가 (Phase A에 포함)

검증 결과와 대응을 PR 설명에 기록.

### 8.3 롤백 경로

문제 발생 시:
1. TipTap 관련 코드를 git revert (단일 PR)
2. 사용자 데이터는 변경 없으므로 이전 버전이 그대로 읽음
3. 신규 기능(헤딩/Task/링크) 사용 기간 중 저장된 데이터도 Markdown이므로 읽기 가능 (단, 기존 `SimpleMarkdown`은 헤딩 렌더 안 함 → `# text` 로 보임)

---

## 9. 엣지 케이스 & 에러 처리

| 케이스 | 처리 |
|--------|------|
| 빈 메모 로드 | Placeholder 표시, 첫 입력 시 사라짐 |
| 긴 메모 (수천 줄) | TipTap 가상화 없음. 현재 체감 사용량(<500줄) 범위 내 문제 없음 (YAGNI) |
| URL 입력 시 프로토콜 누락 (도메인만, 예: `example.com`) | `.tld` 패턴 검증 후 `https://` 자동 prepend |
| 빈 URL로 Enter | 링크 적용 취소 (서식 변경 없음) |
| 상대경로 / 미지원 프로토콜 / 공백 포함 / 프로토콜 없는 쓰레기 입력 | `normalizeUrl` → `null` → sonner 토스트(`유효하지 않은 URL 형식입니다.`) + input 재포커스 + 버블 유지 |
| `ftp://...`, `file://...` 등 붙여넣기 / autolink | `Link.configure({ isAllowedUri })` 에서 거부 → `<a>` 마크가 생성되지 않아 평문으로 남음 |
| 링크 위 커서 + 서식 변경 | 링크 내 텍스트에 Bold 등 적용 가능 (TipTap 기본) |
| 붙여넣기로 HTML 유입 | TipTap `clipboardTextSerializer`로 plain text 또는 허용된 마크만 필터 |
| 탭 전환 중 IME 조합 중 | TipTap이 IME composition 처리 (기존 textarea 수준 이상) |
| 에디터 언마운트 시 저장 미완료 (debounce pending) | `MemoWidget` 언마운트 useEffect cleanup 에서 **pending debounce timer flush** — 마지막 `memoDataRef.current` 즉시 `upsertMemo` 호출 (기존 로직 유지). TipTap onUpdate → MemoWidget onChange → 500ms debounce 체인에서 debounce 타이머가 flush 없이 사라지는 일이 없도록 cleanup에서 `clearTimeout` 후 **한 번 더 저장 호출** 보장. |
| Supabase 로드 시 malformed Markdown (예: 레거시 데이터의 미종료 fence, 비정상 HTML 잔재) | `editor.commands.setContent(markdown)` 호출을 **try/catch 로 감쌈**. 예외 시 `console.error` + **plain text 로 fallback** (`setContent(markdown, false, { preserveWhitespace: 'full' })`). 사용자에게 "서식이 일부 단순 텍스트로 표시됩니다" 미니 토스트 (sonner) 1회 노출. 데이터는 손실 없음 (Markdown 원문은 Supabase에 그대로). |
| 사용자 전환 (로그아웃/로그인) | `useAuthStore` 변경 시 `MemoWidget` 이 `memoKey + currentUserId` useEffect로 재로드 (기존 로직 유지) |
| Realtime 수신 (`memo-sync` storage 이벤트) | 다른 윈도우에서 동일 메모 변경 시 reload (기존 로직 유지) |

---

## 10. 테스트 전략

### 10.1 자동 검증

- `tsc --noEmit` — 타입 에러 0
- `npm run build:vite` — 빌드 성공

### 10.2 수동 검증 (브라우저/Electron 실행)

**골든 패스**:
1. 메모 작성 → Bold/Italic/Underline/Strike 토글 동작
2. H1/H2/H3 버튼 클릭 → 헤딩 크기가 본문 × 1.6/1.35/1.15 로 렌더
3. 불릿/번호/체크박스 리스트 생성 및 체크박스 토글
4. 텍스트 선택 → Ctrl+K 또는 🔗 → URL 입력 → Enter → 링크 적용
5. 기존 링크 위 커서 → 버블 자동 등장 → [↗] 클릭 시 기본 브라우저에서 열림
6. 폰트 슬라이더 조절 → 본문·헤딩 모두 비율 따라 크기 변경
7. 탭 전환 → 각 탭 독립 content 유지
8. 앱 재시작 → Supabase에서 Markdown 로드 후 동일하게 렌더
9. 테마 변경 (바이올렛 → 시네마 레드) → 툴바/버블 색도 자동 변경
10. 라이트 모드 전환 → 대비 유지

**엣지 케이스**:
- 기존 메모(특히 `- ` / `1. ` / `__밑줄__` 포함)를 로드 → 모든 서식 보존
- 위젯 크기 드래그로 좁게 축소 → 툴바가 드롭다운 모드로 전환
- Ctrl+B를 에디터 밖에서 누름 → 사이드바 토글 정상 작동
- Ctrl+B를 에디터 안에서 누름 → TipTap Bold 동작, 사이드바 토글 안 됨
- Escape → 링크 버블 먼저 닫힘, 다시 Escape → 에디터 blur
- **Word/브라우저 페이지 복사 → 붙여넣기**: 서식 있는 HTML 유입 시 plain text 또는 허용 마크만 남고 inline style/className은 제거 (§9 `clipboardTextSerializer` 검증)
- **의도적 malformed Markdown**: 개발자 도구로 Supabase row 의 `content` 에 `# 제목 __mismatched` 같은 값 주입 후 로드 → §9 fallback 동작 확인 (sonner 토스트 노출 + 텍스트 보존)

### 10.3 Regression

- 기존 MemoWidget의 탭 추가/삭제/이름변경은 영향 없음 확인
- 폰트 슬라이더 Supabase 저장 유지
- 팝업 모드(`isPopup`) 레이아웃 정상
- `memo-sync` localStorage 이벤트로 멀티 윈도우 동기화 유지

---

## 11. 수용 기준 (Acceptance Criteria)

- [ ] `<textarea>` 기반 입력이 TipTap ContentEditable로 완전 교체
- [ ] 미리보기 토글 버튼 UI 및 `previewMode` state 제거
- [ ] 툴바 버튼 11개 노출 (넓은 모드 기준)
- [ ] 각 버튼 Active state가 커서 위치 서식에 따라 자동 전환
- [ ] 모든 단축키(§4.2 버튼 표) 동작
- [ ] 링크 버블 메뉴 — 새 링크/기존 링크 2가지 모드 동작
- [ ] Markdown 저장 형식 유지, Supabase 필드 스키마 변경 없음
- [ ] `__x__` 가 Underline으로 저장/로드 (custom serializer 작동)
- [ ] 6개 테마 + 라이트/다크 모드에서 시각적 일관성
- [ ] 기존 메모 로드 시 모든 서식 보존 (Regression)
- [ ] `tsc --noEmit` + `vite build` 통과
- [ ] 색상 하드코딩 0건 (`grep -E '#[0-9a-fA-F]{6}' src/components/widgets/memo/` 결과 없음)

---

## 12. Non-goals (YAGNI)

- **이미지/동영상 삽입**: 메모는 텍스트 중심. 씬 이미지 기능은 별도 위젯 존재.
- **표 삽입**: 수요 없음. 필요 시 차기 버전 별도 이슈.
- **코드 블록 / 인라인 코드**: 현재 앱 맥락(팀 메모)에서 희귀. 기본 TipTap Starter Kit이 코드 블록을 포함하지만 **툴바 버튼은 노출하지 않음** (단축키만 우발 사용 허용).
- **Undo/Redo UI 버튼**: Ctrl+Z/Y 단축키(TipTap 기본)로 충분. 툴바 공간 절약.
- **실시간 협업(Yjs/CRDT)**: 현 앱 동시편집 모델은 Last-Write-Wins + Realtime 에코. 변경 불요.
- **텍스트 정렬/색/하이라이트**: 요구 없음.
- **마크다운 원문 보기 토글**: WYSIWYG 전환의 전제 자체와 모순.

---

## 13. 구현 단계 개요 (Phase Breakdown)

세부 plan은 writing-plans 스킬로 별도 작성. 예상 순서:

1. **Phase A — 기반**: 의존성 설치, `markdownExtensions.ts` 작성, 단위 테스트(파서/시리얼라이저 왕복). 왕복 fixture 는 최소 12개 케이스 (plain / bold / italic / underline / strike / 중첩 / H1-3 / bullet / ordered / task / link / 실제 Supabase 샘플 3건 복사). `1)` 패턴 §8.2.1 SQL 결과 반영 여부 결정
2. **Phase B — 에디터 코어**: `MemoEditor.tsx` 구현, `MemoWidget` textarea를 임시로 MemoEditor 로 교체 (툴바는 기존 FormatToolbar 일단 유지)
3. **Phase C — 툴바 확장**: `MemoToolbar.tsx` 작성 (11버튼 + 반응형), Active state 바인딩
4. **Phase D — 링크 버블**: `MemoLinkBubble.tsx` 작성
5. **Phase E — 정리**: 기존 `SimpleMarkdown`/`inlineFormat`/`applyMarkdown`/`FormatToolbar`/`previewMode` 제거, tsc + build 검증
6. **Phase F — 검증**: 수동 테스트, 테마/라이트모드 확인, 기존 메모 regression

예상 소요: ~1.5시간 (memory 기준).

---

## 14. 참고

- 기존 설계 메모: `C:\Users\user\.claude\projects\C--Bflow-BGonly\memory\project_issue3_wysiwyg_design.md` (2026-04-24 승인)
- 현 구현: `src/components/widgets/MemoWidget.tsx` (673 lines)
- 테마 시스템: `src/themes.ts`, `tailwind.config.js`
- 글로벌 단축키: `src/hooks/useGlobalShortcuts.ts`
- TipTap 공식 문서: https://tiptap.dev/docs (v2 기준, context7 MCP로 최신 API 확인 권장)
