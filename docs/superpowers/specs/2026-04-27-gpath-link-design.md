# 메모/댓글/메모위젯에 G:\ 경로 자동 링크화

- 작성일: 2026-04-27
- 브랜치: `claude/trusting-blackwell-722ea1`
- 대상 범위: 씬 상세 모달의 메모 + 댓글 + 메모 위젯(TipTap)에 `G:\\` 경로 자동 링크화. 기존 리비전 패턴(CompositingView)을 **공용 컴포넌트로 통합**하고 4곳에서 재사용.
- PR 단위: **단일 PR**
- 핵심 원칙: **UI 일관성 + DRY** — 한 곳에서 정의(`PathBadge`)하고 모든 위치가 import해서 사용. 디자인이나 동작 변경 시 한 파일만 수정하면 전체 일괄 적용.

---

## 1. 배경 & 목적

리비전(`CompositingView`)에서는 이미 `G:\\`로 시작하는 경로가 클릭 가능한 PathBadge로 표시되어 파일 탐색기에서 바로 열 수 있다. 같은 기능이 **씬 상세 모달의 메모·댓글·메모 위젯**에도 필요하다. 사용자(한솔)가 작업 지시를 메모/댓글에 남길 때 공유 드라이브 경로(`G:\공유 드라이브\...`)를 입력하면 클릭 한 번으로 해당 위치를 열 수 있도록 한다.

### 일관성·유지보수 요구사항 (한솔 강조)

- **시각 일관성**: 4곳(리비전/씬 메모/댓글/메모 위젯) 모두 동일한 PathBadge 외관
- **코드 통일**: 동일 컴포넌트·유틸 재사용. CompositingView의 기존 PathBadge도 공용 컴포넌트로 갈아끼움
- **유지보수**: 한 파일 수정으로 모든 위치 일괄 변경 가능

---

## 2. 결정한 디자인 (요약)

| 결정 | 값 |
|---|---|
| 변환 방식 | **인라인 토큰** — 텍스트 흐름 안에서 경로만 PathBadge로 교체 |
| 적용 위치 | 씬 메모 + 댓글 + **메모 위젯(TipTap)** + (리팩토링) 리비전 |
| 드라이브 형식 | **G:\\ 전용** (정규식 `/G:\\[^\s\n]*/g`) |
| 공용 위치 | `src/components/common/PathBadge.tsx`, `src/utils/pathLink.ts` |
| 기존 PathBadge 처리 | CompositingView의 인라인 PathBadge를 삭제하고 공용 컴포넌트 import |
| 클릭 동작 | `window.electronAPI.shellShowItem(path)` — 기존 IPC `shell:show-item` 재사용 |
| 편집 vs 표시 | 편집 모드는 raw text, 표시 모드만 변환 (textarea 기반). TipTap은 WYSIWYG으로 편집 중에도 변환 |
| TipTap 기법 | 커스텀 Mark `pathLink` + InputRule + PasteRule (PR 검토에서 Decoration 검토 가능) |

---

## 3. 공용 모듈

### 3.1 `src/utils/pathLink.ts` (신규)

```typescript
const G_PATH_REGEX = /G:\\[^\s\n]*/g;

export interface PathToken {
  type: 'text' | 'path';
  content: string;
}

/** 텍스트를 [text, path, text, path, ...] 토큰 배열로 분리 */
export function tokenizeGPaths(text: string): PathToken[] {
  if (!text) return [];
  const tokens: PathToken[] = [];
  let lastIdx = 0;
  for (const match of text.matchAll(G_PATH_REGEX)) {
    if (match.index === undefined) continue;
    if (match.index > lastIdx) {
      tokens.push({ type: 'text', content: text.slice(lastIdx, match.index) });
    }
    tokens.push({ type: 'path', content: match[0] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    tokens.push({ type: 'text', content: text.slice(lastIdx) });
  }
  return tokens;
}

/** 경로의 마지막 segment만 표시용으로 추출 */
export function shortenPath(fullPath: string): string {
  const segs = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segs[segs.length - 1] || fullPath;
}
```

### 3.2 `src/components/common/PathBadge.tsx` (신규)

CompositingView의 기존 PathBadge를 그대로 추출. props는 단순화.

```typescript
import { FolderOpen } from 'lucide-react';

interface PathBadgeProps {
  path: string;
  resolved?: boolean;     // 리비전용 옵션 (회색 처리). 기본 false → 청색
  className?: string;
}

export function PathBadge({ path, resolved, className }: PathBadgeProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.electronAPI?.shellShowItem?.(path);
  };
  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1 text-[11px] font-mono rounded px-1.5 py-0.5 max-w-full cursor-pointer transition-all hover:brightness-125 ${className ?? ''}`}
      style={resolved
        ? { color: '#6B7280', backgroundColor: 'rgba(107, 114, 128, 0.1)', border: '1px solid rgba(107, 114, 128, 0.2)' }
        : { color: '#74B9FF', backgroundColor: 'rgba(116, 185, 255, 0.1)', border: '1px solid rgba(116, 185, 255, 0.2)' }
      }
      title={`${path}\n(클릭하면 파일탐색기에서 열기)`}
    >
      <FolderOpen size={10} className="shrink-0" />
      <span className="truncate">{shortenPath(path)}</span>
    </button>
  );
}
```

### 3.3 `src/components/common/PathLinkifiedText.tsx` (신규)

```typescript
import { Fragment, type ReactNode } from 'react';
import { tokenizeGPaths } from '@/utils/pathLink';
import { PathBadge } from './PathBadge';

interface Props {
  text: string;
  /** 텍스트 세그먼트 추가 변환 (예: 댓글의 @멘션 처리) */
  renderTextSegment?: (segment: string, idx: number) => ReactNode;
}

export function PathLinkifiedText({ text, renderTextSegment }: Props) {
  const tokens = tokenizeGPaths(text);
  return (
    <>
      {tokens.map((tok, i) =>
        tok.type === 'path'
          ? <PathBadge key={`p${i}`} path={tok.content} />
          : <Fragment key={`t${i}`}>{renderTextSegment ? renderTextSegment(tok.content, i) : tok.content}</Fragment>
      )}
    </>
  );
}
```

---

## 4. 적용 위치

### 4.1 씬 메모 — `InlineTextareaRow`

`UnifiedSceneDetailModal.tsx:635`의 `InlineTextareaRow` 컴포넌트 내부에서 표시 모드일 때 `<PathLinkifiedText>` 사용. 편집 모드는 그대로 textarea (raw 입력).

```typescript
// 표시 모드
<div onClick={enterEditMode}>
  {value ? <PathLinkifiedText text={value} /> : <span className="text-muted">메모 추가...</span>}
</div>

// 편집 모드 (변경 없음)
<textarea ... />
```

### 4.2 댓글 — `CommentPanel.renderText`

기존 `renderText(text)` 함수가 @멘션 split만 처리. 이걸 G:\ 변환 + @멘션 변환의 합성으로 바꿈.

```typescript
const renderText = (text: string) => (
  <PathLinkifiedText
    text={text}
    renderTextSegment={(segment, baseIdx) =>
      // 기존 @멘션 split 로직을 segment에 적용
      segment.split(/(@\S+)/g).map((part, i) =>
        part.startsWith('@')
          ? <MentionChip key={`${baseIdx}-${i}`} mention={part} />
          : part
      )
    }
  />
);
```

@멘션과 G:\ 경로가 한 텍스트 안에 같이 있어도 둘 다 정상 인식 (정규식이 겹치지 않음).

### 4.3 리비전 — 기존 PathBadge 갈아끼기 (DRY)

`CompositingView.tsx`의 인라인 `PathBadge` 정의(line 75–99)를 삭제하고 공용 컴포넌트 import. `parsePathsFromText`도 그대로 유지하지만 PathBadge만 교체. 외관·동작은 픽셀 단위로 동일.

### 4.4 메모 위젯 (TipTap) — `pathLink` Mark

`src/components/widgets/memo/extensions/PathLinkMark.ts` (신규):

```typescript
import { Mark, markInputRule, markPasteRule } from '@tiptap/core';

export const PathLinkMark = Mark.create({
  name: 'pathLink',
  inclusive: false,                    // 경로 끝에서 typing 시 mark 자동 종료
  addAttributes() {
    return { href: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-path-link]' }];
  },
  renderHTML({ mark, HTMLAttributes }) {
    return ['span', {
      ...HTMLAttributes,
      'data-path-link': mark.attrs.href,
      class: 'path-link-mark',
      title: `${mark.attrs.href}\n(클릭하면 파일탐색기에서 열기)`,
    }, 0];
  },
  addInputRules() {
    return [
      markInputRule({
        find: /(G:\\[^\s]+)\s$/,                        // 경로 + 공백 입력 순간 mark 적용
        type: this.type,
        getAttributes: (match) => ({ href: match[1] }),
      }),
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({
        find: /G:\\[^\s\n]+/g,
        type: this.type,
        getAttributes: (match) => ({ href: match[0] }),
      }),
    ];
  },
});
```

`MemoEditor.tsx`에 등록:
```typescript
extensions: [...existing, PathLinkMark]
```

CSS (`src/styles/memo-editor.css` 또는 동급):
```css
.path-link-mark {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-family: monospace;
  border-radius: 4px;
  padding: 1px 6px;
  color: #74B9FF;
  background: rgba(116, 185, 255, 0.1);
  border: 1px solid rgba(116, 185, 255, 0.2);
  cursor: pointer;
}
.path-link-mark:hover { filter: brightness(1.25); }
```

클릭 핸들러는 `MemoEditor.tsx`의 `editorProps.handleClickOn`에 추가:
```typescript
handleClickOn(view, pos, node, nodePos, event) {
  const target = event.target as HTMLElement | null;
  const linkEl = target?.closest('[data-path-link]') as HTMLElement | null;
  if (linkEl) {
    event.preventDefault();
    window.electronAPI?.shellShowItem?.(linkEl.dataset.pathLink ?? '');
    return true;
  }
  return false;
}
```

---

## 5. 에지 케이스

| 케이스 | 처리 |
|---|---|
| 빈 메모/댓글 | tokenizeGPaths가 [] 반환 → 빈 렌더 |
| `G:\` 단독 (경로 없음) | 정규식 매치 안 됨 (`[^\s\n]*` 0길이 매치는 가능하지만 `\s`/`\n` 종결 필요한 컨텍스트로 발생 안 함) |
| 한글 경로 (`G:\공유 드라이브\...`) | OK — 정규식이 `\s`/`\n`만 종결자. 공백 포함되면 거기서 끊김 (파일명에 공백이 있으면 사용자가 따옴표 등을 쓰지 않는 한 짧게 끊김 — 이는 의도된 한계) |
| 매우 긴 경로 | PathBadge에서 `shortenPath`로 마지막 segment만 표시. 풀 경로는 툴팁(title) |
| 잘못된 형식·없는 파일 | `shell:show-item`이 자체 처리 — 파일/폴더 없으면 상위 폴더 시도, 그것도 없으면 무음 (현재 동작 그대로) |
| URL과 충돌 | `G:\`는 URL이 아니라 충돌 없음. http(s) 메모 링크는 `MemoLinkBubble`이 별도 처리 |
| TipTap 클릭 vs Drag-Select | `handleClickOn`은 click 한정, 드래그 선택은 영향 없음 |
| 메모 위젯 raw 모드 | 현재 메모 위젯은 WYSIWYG만 — raw 모드 없음 (Mark가 항상 활성) |
| 편집 중 textarea (씬 메모/댓글) | 의도된 동작 — 편집 시 raw 텍스트, 저장 후 표시만 변환 |

---

## 6. 테스트 전략

### 6.1 단위 테스트 — `src/utils/__tests__/pathLink.test.ts` (신규)

```typescript
describe('tokenizeGPaths', () => {
  it('빈 문자열은 빈 배열', ...);
  it('경로 없는 텍스트는 단일 text 토큰', ...);
  it('단독 경로는 단일 path 토큰', ...);
  it('텍스트 중간 경로는 [text, path, text]', ...);
  it('다중 경로 분리', ...);
  it('한글 경로 인식', ...);
  it('경로가 줄바꿈에서 끊김', ...);
  it('대소문자 g (소문자) 는 매치 안 됨', ...);  // G:\ 만 (대문자)
});

describe('shortenPath', () => {
  it('백슬래시 경로 마지막 segment 추출', ...);
  it('슬래시 혼용', ...);
  it('말미 슬래시 무시', ...);
});
```

### 6.2 수동 검증

- [ ] 씬 모달에서 메모에 `G:\공유 드라이브\test.png` 입력·저장 → PathBadge 표시 → 클릭 → 파일탐색기 열림
- [ ] 댓글에 `@한솔 G:\test\file.png 확인` → @멘션과 PathBadge 둘 다 인식
- [ ] 메모 위젯에 G:\ 입력 후 공백 → 즉시 청색 PathBadge로 변환
- [ ] 메모 위젯에 G:\ 경로 붙여넣기 → 자동 변환
- [ ] 리비전(CompositingView)에서 PathBadge 외관·동작 변경 없이 그대로 (회귀 테스트)

### 6.3 빌드 검증

- `npx tsc --noEmit` 통과
- `npx vite build` 통과
- `npx vitest run` 통과

---

## 7. 작업 범위

### 신규 파일

| 경로 | 책임 |
|---|---|
| `src/utils/pathLink.ts` | `tokenizeGPaths`, `shortenPath` |
| `src/utils/__tests__/pathLink.test.ts` | 유닛 테스트 |
| `src/components/common/PathBadge.tsx` | 공용 PathBadge |
| `src/components/common/PathLinkifiedText.tsx` | 텍스트 + 경로 합성 렌더 |
| `src/components/widgets/memo/extensions/PathLinkMark.ts` | TipTap Mark |

### 수정 파일

| 경로 | 변경 |
|---|---|
| `src/views/CompositingView.tsx` | 인라인 PathBadge 삭제, 공용 import. `parsePathsFromText`는 유지 |
| `src/components/scenes/UnifiedSceneDetailModal.tsx` | `InlineTextareaRow` 표시 모드에 `PathLinkifiedText` 사용 |
| `src/components/scenes/CommentPanel.tsx` | `renderText` → `PathLinkifiedText`로 합성 |
| `src/components/widgets/memo/MemoEditor.tsx` | extensions에 `PathLinkMark` 등록 + `handleClickOn` 추가 |
| `src/styles/memo-editor.css` (또는 인접 css) | `.path-link-mark` 스타일 |

---

## 8. 결정 이력 (Q&A)

1. **변환 방식**: 인라인 토큰 / 줄 단위 분리 / 하이브리드 → **인라인 토큰**
2. **적용 범위**: 씬 모달만 / + 메모 위젯 / + 그 외 텍스트 → **+ 메모 위젯 포함**
3. **드라이브 형식**: G:\\만 / 모든 드라이브 / + UNC → **G:\\ 전용**
4. **추가 강조** (한솔): UI 일관성 + 유지보수성 — 공용 컴포넌트 1곳에서 정의, 4곳 재사용

---

## 9. 후속 작업 (out of scope)

- 다른 드라이브(`X:\`, `D:\`) 또는 UNC 경로 (`\\\\server\\...`) 인식 — 필요해지면 정규식 확장
- 화이트보드/개인 일정 메모 등 다른 텍스트 영역 — 같은 공용 컴포넌트 import 한 줄이면 됨
- 깨진 경로 표시 처리 (파일이 없는 경로를 시각적으로 회색 표시) — 사전 검증이 비싸 v1엔 제외
