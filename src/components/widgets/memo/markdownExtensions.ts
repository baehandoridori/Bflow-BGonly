/**
 * 메모 위젯용 Markdown ↔ HTML 변환 규칙
 *
 * B flow 앱 관습:
 *   __text__  →  <u>text</u>   (비표준: GFM은 bold로 처리)
 *   **text**  →  <strong>text</strong>
 *   *text*    →  <em>text</em>
 *   _text_    →  <em>text</em>
 *   ~~text~~  →  <s>text</s>
 *
 * 구현 전략:
 *  - markdown-it 기본 emphasis 규칙을 유지하되
 *  - renderer.rules.strong_open/close 를 override 하여 markup 이 "__" 인 경우
 *    <u> 태그로 출력. "**" 는 <strong> 유지.
 *  - ProseMirror → Markdown 직렬화 시 Underline mark 를 "__" 로 감쌈.
 */
import Underline from '@tiptap/extension-underline';
import type { Editor } from '@tiptap/core';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarkdownIt = any;

/**
 * markdown-it 인스턴스에 이미 underline 렌더러 패치가 적용됐는지 표시하는 고유 키.
 * 같은 인스턴스에 여러 번 install 이 호출돼도 wrapper 가 누적되지 않도록 가드.
 */
const PATCHED_KEY = '__bflowUnderlinePatched__';

/** strong_open/close 렌더러를 markup 기준으로 분기 (idempotent) */
function installUnderlineRenderer(md: MarkdownIt) {
  if (md[PATCHED_KEY]) return;
  md[PATCHED_KEY] = true;

  const defaultStrongOpen = md.renderer.rules.strong_open
    ?? ((tokens: unknown[], idx: number, opts: unknown, _env: unknown, self: { renderToken: (...a: unknown[]) => string }) =>
      self.renderToken(tokens, idx, opts));
  const defaultStrongClose = md.renderer.rules.strong_close
    ?? ((tokens: unknown[], idx: number, opts: unknown, _env: unknown, self: { renderToken: (...a: unknown[]) => string }) =>
      self.renderToken(tokens, idx, opts));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.strong_open = function (tokens: any[], idx: number, opts: unknown, env: unknown, self: any) {
    if (tokens[idx]?.markup === '__') return '<u>';
    return defaultStrongOpen(tokens, idx, opts, env, self);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  md.renderer.rules.strong_close = function (tokens: any[], idx: number, opts: unknown, env: unknown, self: any) {
    if (tokens[idx]?.markup === '__') return '</u>';
    return defaultStrongClose(tokens, idx, opts, env, self);
  };
}

/**
 * B flow 관습을 보존하는 Underline 확장.
 * - parse: markdown-it renderer override 로 __x__ → <u>x</u>
 * - serialize: __ 로 감싸서 Markdown 출력
 */
export const BflowUnderline = Underline.extend({
  addStorage() {
    return {
      markdown: {
        serialize: { open: '__', close: '__', mixable: true, expelEnclosingWhitespace: true },
        parse: {
          setup(markdownit: MarkdownIt) {
            installUnderlineRenderer(markdownit);
          },
        },
      },
    };
  },
});

/**
 * editor 에 저장된 markdown 문자열을 안전하게 꺼낸다.
 * tiptap-markdown 의 `editor.storage.markdown.getMarkdown()` 래퍼.
 */
export function getEditorMarkdown(editor: Editor | null): string {
  if (!editor) return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storage = (editor.storage as any)?.markdown;
  if (storage?.getMarkdown) return storage.getMarkdown();
  return '';
}
