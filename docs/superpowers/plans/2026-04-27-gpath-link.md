# G:\ 경로 자동 링크화 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 메모/댓글/메모위젯에 입력된 `G:\` 경로를 클릭 가능한 PathBadge로 자동 변환하고, 기존 리비전(CompositingView)도 같은 공용 컴포넌트로 일괄 통합한다.

**Architecture:** 정규식 1개를 단일 상수로 export 하고 4곳(textarea 표시·댓글 renderText·TipTap Mark·CompositingView)이 공유한다. 표시 단계 변환은 `PathLinkifiedText` 컴포넌트, 편집 중에도 자동 변환은 TipTap 커스텀 Mark로 분리한다. 클릭 핸들러는 기존 IPC `shell:show-item`을 그대로 재사용한다.

**Tech Stack:** React 18 + TypeScript, TipTap 2 + tiptap-markdown, Lucide 아이콘, Vitest + @testing-library/react.

**Source spec:** [`docs/superpowers/specs/2026-04-27-gpath-link-design.md`](../specs/2026-04-27-gpath-link-design.md)

---

## File Structure

```
신규
  src/utils/pathLink.ts                                       [공용 유틸]
  src/utils/__tests__/pathLink.test.ts                        [단위 테스트]
  src/components/common/PathBadge.tsx                         [공용 컴포넌트]
  src/components/common/PathLinkifiedText.tsx                 [텍스트 합성]
  src/components/common/__tests__/PathLinkifiedText.test.tsx  [통합 테스트]
  src/components/widgets/memo/extensions/PathLinkMark.ts      [TipTap Mark]
  src/components/widgets/memo/extensions/__tests__/PathLinkMark.test.ts
  src/styles/path-link.css                                    [CSS]

수정
  src/views/CompositingView.tsx                               [PathBadge 갈아끼기]
  src/components/scenes/UnifiedSceneDetailModal.tsx           [InlineTextareaRow 표시]
  src/components/scenes/CommentPanel.tsx                      [renderText 합성]
  src/components/widgets/memo/MemoEditor.tsx                  [PathLinkMark 등록 + handleClickOn]
  src/main.tsx                                                [path-link.css import]
```

---

## Chunk 1: 공용 유틸 + 컴포넌트 (TDD)

### Task 1.1: pathLink.ts 유틸 (TDD)

**Files:**
- Create: `src/utils/pathLink.ts`
- Test: `src/utils/__tests__/pathLink.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/utils/__tests__/pathLink.test.ts
import { describe, it, expect } from 'vitest';
import { tokenizeGPaths, shortenPath } from '../pathLink';

describe('tokenizeGPaths', () => {
  it('빈 문자열은 빈 배열', () => {
    expect(tokenizeGPaths('')).toEqual([]);
  });

  it('경로 없는 텍스트는 단일 text 토큰', () => {
    expect(tokenizeGPaths('안녕')).toEqual([{ type: 'text', content: '안녕' }]);
  });

  it('단독 경로는 단일 path 토큰', () => {
    expect(tokenizeGPaths('G:\\test\\file.png')).toEqual([
      { type: 'path', content: 'G:\\test\\file.png' },
    ]);
  });

  it('텍스트 중간 경로는 [text, path, text]', () => {
    const result = tokenizeGPaths('확인 G:\\a\\b 부탁');
    expect(result).toEqual([
      { type: 'text', content: '확인 ' },
      { type: 'path', content: 'G:\\a\\b' },
      { type: 'text', content: ' 부탁' },
    ]);
  });

  it('다중 경로 분리', () => {
    const result = tokenizeGPaths('G:\\a 그리고 G:\\b 끝');
    expect(result.filter(t => t.type === 'path')).toHaveLength(2);
  });

  it('한글 경로 인식 (공백 전까지)', () => {
    const result = tokenizeGPaths('G:\\공유드라이브\\파일.png');
    expect(result).toEqual([
      { type: 'path', content: 'G:\\공유드라이브\\파일.png' },
    ]);
  });

  it('경로가 줄바꿈에서 끊김', () => {
    const result = tokenizeGPaths('G:\\a\n다음줄');
    expect(result.find(t => t.type === 'path')?.content).toBe('G:\\a');
  });

  it('소문자 g:\\ 는 매치 안 됨', () => {
    const result = tokenizeGPaths('g:\\test');
    expect(result.every(t => t.type === 'text')).toBe(true);
  });
});

describe('shortenPath', () => {
  it('백슬래시 경로 마지막 segment 추출', () => {
    expect(shortenPath('G:\\공유\\file.png')).toBe('file.png');
  });
  it('슬래시 혼용 경로', () => {
    expect(shortenPath('G:/a/b/c.png')).toBe('c.png');
  });
  it('말미 슬래시는 무시하고 직전 segment 반환', () => {
    expect(shortenPath('G:\\a\\b\\')).toBe('b');
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run src/utils/__tests__/pathLink.test.ts
```
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현 — `src/utils/pathLink.ts`**

```typescript
/** G:\ 경로 인식 정규식 — 본 모듈에서만 정의, 4곳이 import해 공유 */
export const G_PATH_REGEX_GLOBAL = /G:\\[^\s\n]+/g;
export const G_PATH_REGEX_INPUT_RULE = /(G:\\[^\s\n]+)\s$/;
export const G_PATH_REGEX_PASTE_RULE = /G:\\[^\s\n]+/g;

export interface PathToken {
  type: 'text' | 'path';
  content: string;
}

export function tokenizeGPaths(text: string): PathToken[] {
  if (!text) return [];
  const tokens: PathToken[] = [];
  let lastIdx = 0;
  for (const match of text.matchAll(G_PATH_REGEX_GLOBAL)) {
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

export function shortenPath(fullPath: string): string {
  const segs = fullPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return segs[segs.length - 1] || fullPath;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/utils/__tests__/pathLink.test.ts
```
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/utils/pathLink.ts src/utils/__tests__/pathLink.test.ts
git commit -m "feat(pathlink): tokenizeGPaths + shortenPath 유틸 (TDD)"
```

### Task 1.2: PathBadge 컴포넌트

**Files:**
- Create: `src/components/common/PathBadge.tsx`

- [ ] **Step 1: 작성**

```typescript
import { FolderOpen } from 'lucide-react';
import { shortenPath } from '@/utils/pathLink';

interface PathBadgeProps {
  path: string;
  /** CompositingView 전용 — 해결된 리비전 경로 회색 처리. 메모/댓글/메모위젯 사용처에선 항상 false. */
  resolved?: boolean;
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

- [ ] **Step 2: 빌드 검증**

```bash
npx tsc --noEmit
```
Expected: 에러 0

- [ ] **Step 3: 커밋**

```bash
git add src/components/common/PathBadge.tsx
git commit -m "feat(pathlink): PathBadge 공용 컴포넌트 (CompositingView 패턴 추출)"
```

### Task 1.3: PathLinkifiedText 합성 컴포넌트 (TDD)

**Files:**
- Create: `src/components/common/PathLinkifiedText.tsx`
- Test: `src/components/common/__tests__/PathLinkifiedText.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PathLinkifiedText } from '../PathLinkifiedText';

describe('PathLinkifiedText', () => {
  it('경로 없는 텍스트는 그대로 렌더', () => {
    const { container } = render(<PathLinkifiedText text="안녕하세요" />);
    expect(container.textContent).toBe('안녕하세요');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('G:\\ 경로는 button(PathBadge)으로 렌더', () => {
    const { container } = render(<PathLinkifiedText text="확인 G:\\test\\file.png" />);
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('renderTextSegment로 추가 변환 합성 가능 (멘션 시뮬레이션)', () => {
    const { container } = render(
      <PathLinkifiedText
        text="@한솔 G:\\file"
        renderTextSegment={(seg, i) =>
          seg.split(/(@\S+)/g).map((p, j) =>
            p.startsWith('@')
              ? <span key={`${i}-${j}`} data-mention={p.slice(1)}>{p}</span>
              : p
          )
        }
      />
    );
    expect(container.querySelector('[data-mention="한솔"]')).toBeTruthy();
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run src/components/common/__tests__/PathLinkifiedText.test.tsx
```
Expected: FAIL

- [ ] **Step 3: 구현**

```typescript
import { Fragment, type ReactNode } from 'react';
import { tokenizeGPaths } from '@/utils/pathLink';
import { PathBadge } from './PathBadge';

interface Props {
  text: string;
  /** 텍스트 세그먼트 추가 변환 (예: @멘션 처리). 미지정 시 그대로 렌더. */
  renderTextSegment?: (segment: string, idx: number) => ReactNode;
}

export function PathLinkifiedText({ text, renderTextSegment }: Props) {
  const tokens = tokenizeGPaths(text);
  return (
    <>
      {tokens.map((tok, i) =>
        tok.type === 'path'
          ? <PathBadge key={`p${i}`} path={tok.content} />
          : <Fragment key={`t${i}`}>
              {renderTextSegment ? renderTextSegment(tok.content, i) : tok.content}
            </Fragment>
      )}
    </>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/components/common/__tests__/PathLinkifiedText.test.tsx
```
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/components/common/PathLinkifiedText.tsx src/components/common/__tests__/PathLinkifiedText.test.tsx
git commit -m "feat(pathlink): PathLinkifiedText + 통합 테스트 (TDD)"
```

### Task 1.4: path-link.css

**Files:**
- Create: `src/styles/path-link.css`
- Modify: `src/main.tsx` (또는 `src/index.css`에서 @import)

- [ ] **Step 1: CSS 작성**

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
  transition: filter 0.15s;
}
.path-link-mark:hover {
  filter: brightness(1.25);
}
.path-link-mark::before {
  content: '';
  display: inline-block;
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%2374B9FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/></svg>');
  background-size: contain;
  background-repeat: no-repeat;
}
```

- [ ] **Step 2: src/main.tsx에 import 추가**

```typescript
// 기존 import들 아래에 추가
import './styles/path-link.css';
```

- [ ] **Step 3: 빌드 검증 + 커밋**

```bash
npx vite build
git add src/styles/path-link.css src/main.tsx
git commit -m "feat(pathlink): path-link.css (TipTap pathLink mark 스타일)"
```

---

## Chunk 2: 적용 4곳 (TipTap + 메모 + 댓글 + 리비전)

### Task 2.1: TipTap PathLinkMark

**Files:**
- Create: `src/components/widgets/memo/extensions/PathLinkMark.ts`
- Test: `src/components/widgets/memo/extensions/__tests__/PathLinkMark.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { PathLinkMark } from '../PathLinkMark';

describe('PathLinkMark', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({
      extensions: [StarterKit, Markdown.configure({ html: false }), PathLinkMark],
      content: '',
    });
  });
  afterEach(() => editor.destroy());

  it('PasteRule이 G:\\ 경로를 mark로 변환', () => {
    editor.commands.insertContent('확인 G:\\test\\file.png 부탁');
    editor.commands.selectAll();
    // PasteRule을 강제로 적용하기 위해 다시 set
    const html = editor.getHTML();
    // 직접 paste 이벤트 시뮬레이션 또는 setContent 후 InputRules 트리거
    expect(html).toContain('data-path-link');
  });

  it('Markdown round-trip — 저장된 raw 텍스트가 재로드 시 다시 mark', () => {
    editor.commands.setContent('G:\\file.png');
    const md = (editor.storage as any).markdown.getMarkdown();
    expect(md).toContain('G:\\file.png');           // raw 보존

    const fresh = new Editor({
      extensions: [StarterKit, Markdown.configure({ html: false }), PathLinkMark],
      content: md,
    });
    expect(fresh.getHTML()).toContain('data-path-link');
    fresh.destroy();
  });
});
```

> **참고**: TipTap headless 테스트가 까다로울 경우 InputRule 테스트는 일부 생략 가능. 최소 markdown round-trip 1개는 통과 필수.

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
npx vitest run src/components/widgets/memo/extensions/__tests__/PathLinkMark.test.ts
```
Expected: FAIL

- [ ] **Step 3: 구현**

```typescript
import { Mark, markInputRule, markPasteRule } from '@tiptap/core';
import { G_PATH_REGEX_INPUT_RULE, G_PATH_REGEX_PASTE_RULE } from '@/utils/pathLink';

export const PathLinkMark = Mark.create({
  name: 'pathLink',
  inclusive: false,
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
  addStorage() {
    return {
      markdown: {
        serialize: { open: '', close: '', mixable: true, expelEnclosingWhitespace: true },
        parse: { setup: () => {} },
      },
    };
  },
  addInputRules() {
    return [
      markInputRule({
        find: G_PATH_REGEX_INPUT_RULE,
        type: this.type,
        getAttributes: (match) => ({ href: match[1] }),
      }),
    ];
  },
  addPasteRules() {
    return [
      markPasteRule({
        find: G_PATH_REGEX_PASTE_RULE,
        type: this.type,
        getAttributes: (match) => ({ href: match[0] }),
      }),
    ];
  },
});
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/components/widgets/memo/extensions/__tests__/PathLinkMark.test.ts
```
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/widgets/memo/extensions/PathLinkMark.ts src/components/widgets/memo/extensions/__tests__/PathLinkMark.test.ts
git commit -m "feat(pathlink): TipTap PathLinkMark + markdown round-trip 테스트"
```

### Task 2.2: MemoEditor에 PathLinkMark 등록 + handleClickOn

**Files:**
- Modify: `src/components/widgets/memo/MemoEditor.tsx`

- [ ] **Step 1: extensions에 PathLinkMark 추가**

기존 `useEditor({ extensions: [...] })`의 배열에 `PathLinkMark` import 후 추가:

```typescript
import { PathLinkMark } from './extensions/PathLinkMark';
// ...
extensions: [
  // 기존 extensions 그대로
  PathLinkMark,
  // Markdown 은 마지막에
  Markdown.configure({...}),
]
```

- [ ] **Step 2: editorProps.handleClickOn 추가**

```typescript
editorProps: {
  // 기존 editorProps 유지
  handleClickOn(view, pos, node, nodePos, event) {
    const target = event.target as HTMLElement | null;
    const linkEl = target?.closest('[data-path-link]') as HTMLElement | null;
    if (linkEl) {
      event.preventDefault();
      window.electronAPI?.shellShowItem?.(linkEl.dataset.pathLink ?? '');
      return true;
    }
    return false;
  },
}
```

- [ ] **Step 3: 빌드 + 수동 검증**

```bash
npx tsc --noEmit
npx vite build
```

수동:
- [ ] 메모 위젯에 `G:\test\file.png` 입력 후 공백 → 즉시 청색 PathBadge로 변환
- [ ] 클릭 → 파일탐색기 열림 (또는 상위 폴더 폴백)
- [ ] 메모 저장 후 새로고침 → 여전히 PathBadge 표시 (round-trip)

- [ ] **Step 4: 커밋**

```bash
git add src/components/widgets/memo/MemoEditor.tsx
git commit -m "feat(pathlink): MemoEditor에 PathLinkMark 등록 + 클릭 핸들러"
```

### Task 2.3: 씬 메모 — InlineTextareaRow

**Files:**
- Modify: `src/components/scenes/UnifiedSceneDetailModal.tsx`

- [ ] **Step 1: InlineTextareaRow의 표시 모드를 수정**

기존 표시 div 내부 (textarea 닫혀있을 때 렌더되는 부분)를 다음으로 교체:

```typescript
import { PathLinkifiedText } from '@/components/common/PathLinkifiedText';

// 표시 모드:
<div onClick={enterEditMode} className="min-h-[1.5em] cursor-pointer ...기존 클래스">
  {value
    ? <PathLinkifiedText text={value} />
    : <span className="text-text-secondary/50">메모 추가...</span>
  }
</div>
```

`InlineTextareaRow`가 `UnifiedSceneDetailModal.tsx` 내부에 정의되어 있으면 직접 수정. 별도 파일이면 그 파일 수정.

- [ ] **Step 2: 빌드 + 수동 검증**

```bash
npx tsc --noEmit
```

수동:
- [ ] 씬 상세 모달의 메모에 `G:\test` 입력 → 저장 → PathBadge 표시
- [ ] 빈 메모 클릭 → 편집 모드 진입
- [ ] 클릭 → 파일탐색기 열림

- [ ] **Step 3: 커밋**

```bash
git add src/components/scenes/UnifiedSceneDetailModal.tsx
git commit -m "feat(pathlink): 씬 메모 표시 모드에 PathLinkifiedText 적용"
```

### Task 2.4: 댓글 — CommentPanel.renderText

**Files:**
- Modify: `src/components/scenes/CommentPanel.tsx`

- [ ] **Step 1: renderText 재작성**

기존 `renderText` 함수를 다음으로 교체 (line 258–280):

```typescript
import { PathLinkifiedText } from '@/components/common/PathLinkifiedText';

// ...
const renderMentionInSegment = (segment: string, baseIdx: number) =>
  segment.split(/(@\S+)/g).map((part, i) => {
    const key = `${baseIdx}-${i}`;
    if (part.startsWith('@')) {
      const name = part.slice(1);
      const isUser = users.some(u => u.name === name);
      if (isUser) {
        return (
          <span
            key={key}
            className="text-accent font-bold bg-accent/10 rounded px-0.5 cursor-pointer hover:bg-accent/20 transition-colors"
            onClick={() => handleMentionClick(name)}
            title={`${name} 팀원 보기`}
          >
            {part}
          </span>
        );
      }
    }
    return <span key={key}>{part}</span>;
  });

const renderText = (text: string) => (
  <PathLinkifiedText text={text} renderTextSegment={renderMentionInSegment} />
);
```

`handleMentionClick` 함수가 있는지 확인 — 기존 코드에 있을 가능성 높음. 없으면 기존 로직과 동일하게 작성.

- [ ] **Step 2: 빌드 + 수동 검증**

수동:
- [ ] 댓글 `@한솔 G:\test\file 확인` → 저장 → 멘션과 PathBadge 둘 다 표시
- [ ] 멘션 클릭 → 기존 동작 그대로
- [ ] PathBadge 클릭 → 파일탐색기 열림

- [ ] **Step 3: 커밋**

```bash
git add src/components/scenes/CommentPanel.tsx
git commit -m "feat(pathlink): CommentPanel renderText에 G:\ 경로 합성"
```

### Task 2.5: 리비전 — CompositingView 갈아끼기

**Files:**
- Modify: `src/views/CompositingView.tsx`

- [ ] **Step 1: 인라인 PathBadge 정의 삭제 + import 추가**

`src/views/CompositingView.tsx` 의 line 75–99 (인라인 PathBadge 정의)를 삭제하고 상단에 import:

```typescript
import { PathBadge } from '@/components/common/PathBadge';
```

`parsePathsFromText` 함수는 그대로 유지 (이건 줄 단위 분리 패턴, 메모/댓글의 인라인 토큰화와 다른 별개 로직).

- [ ] **Step 2: 빌드 + 회귀 테스트**

```bash
npx tsc --noEmit
npx vite build
```

수동 회귀:
- [ ] 리비전(CompositingView)에서 PathBadge 외관·동작이 변경 없이 그대로
- [ ] 청색·회색(resolved) 모두 정상 표시
- [ ] 클릭 시 파일탐색기 열림

- [ ] **Step 3: 커밋**

```bash
git add src/views/CompositingView.tsx
git commit -m "refactor(pathlink): CompositingView가 공용 PathBadge 사용 (DRY)"
```

### Task 2.6: 최종 빌드 + 통합 검증

- [ ] **Step 1: 전체 빌드**

```bash
npx tsc --noEmit
npx vite build
npx vitest run
```

모두 PASS / 에러 0.

- [ ] **Step 2: 통합 수동 체크리스트**

스펙 §6.2 항목 모두 확인:
- [ ] 씬 모달 메모: `G:\공유 드라이브\test.png` 입력·저장 → PathBadge → 클릭 → 파일탐색기
- [ ] 댓글: `@한솔 G:\test\file.png 확인` → 멘션 + PathBadge 모두 인식
- [ ] 메모 위젯: G:\ 입력 후 공백 → 즉시 청색 PathBadge로 변환
- [ ] 메모 위젯: 붙여넣기로 G:\ 경로 → 자동 변환
- [ ] 메모 위젯: 저장 → 앱 재시작 → 여전히 PathBadge 표시 (round-trip)
- [ ] 리비전(CompositingView): 외관·동작 변경 없음 (회귀)
- [ ] PathLink 클릭 시 LinkBubble이 잘못 뜨지 않음
- [ ] 빈 메모 placeholder 클릭 → 편집 모드 진입

- [ ] **Step 3: 최종 커밋 (선택)**

추가 변경 없으면 생략. 작은 마무리 정리만 있으면:

```bash
git commit -m "feat: G:\ 경로 자동 링크화 v1 출시 (메모/댓글/메모위젯/리비전 통합)"
```

---

## 완료 기준

- [ ] `tokenizeGPaths` / `shortenPath` / `PathLinkifiedText` / `PathLinkMark` 단위 테스트 모두 통과
- [ ] 4곳(메모/댓글/메모위젯/리비전) 외관·동작 일관성 확인
- [ ] Markdown round-trip 보장 (저장→재로드 시 PathBadge 유지)
- [ ] 빌드 + 빌드 검증(tsc, vite build, vitest) 모두 통과
- [ ] PR 머지 후 마이너 버전 또는 패치 (v1.13.x or v1.14.x — A 위젯과의 머지 순서에 따름)
