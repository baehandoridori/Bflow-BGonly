import { Mark, markInputRule, markPasteRule } from '@tiptap/core';
import { G_PATH_REGEX_INPUT_RULE, G_PATH_REGEX_PASTE_RULE } from '@/utils/pathLink';

/**
 * G:\ 경로를 클릭 가능한 인라인 mark로 변환하는 TipTap extension.
 *
 * - InputRule: 사용자가 G:\... 입력 후 공백 → 즉시 mark 적용
 * - PasteRule: G:\ 경로 붙여넣기 → 자동 mark 적용
 * - Markdown round-trip: addStorage().markdown 의 open/close를 빈 문자열로 두어 raw 텍스트로 직렬화. 재로드 시 PasteRule이 다시 mark 적용.
 *
 * 클릭 핸들러는 MemoEditor.tsx의 editorProps.handleClickOn 에서 처리.
 * CSS는 src/styles/path-link.css 의 .path-link-mark.
 */
export const PathLinkMark = Mark.create({
  name: 'pathLink',

  inclusive: false,

  addAttributes() {
    return {
      href: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-path-link]' }];
  },

  renderHTML({ mark, HTMLAttributes }) {
    return [
      'span',
      {
        ...HTMLAttributes,
        'data-path-link': mark.attrs.href,
        class: 'path-link-mark',
        title: `${mark.attrs.href}\n(클릭하면 파일탐색기에서 열기)`,
      },
      0,
    ];
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
        // /g 플래그 정규식은 lastIndex 오염 위험이 있으므로 매번 새 인스턴스로 전달.
        find: new RegExp(G_PATH_REGEX_PASTE_RULE.source, 'g'),
        type: this.type,
        getAttributes: (match) => ({ href: match[0] }),
      }),
    ];
  },
});
