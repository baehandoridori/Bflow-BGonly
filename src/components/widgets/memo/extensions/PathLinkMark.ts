import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { G_PATH_REGEX_GLOBAL } from '@/utils/pathLink';

/**
 * G:\ 경로를 클릭 가능한 인라인 시각으로 변환하는 TipTap extension.
 *
 * 구현 방식: ProseMirror Decoration (Mark 아님).
 * - 데이터에는 항상 plain text "G:\..."로 저장 → Markdown round-trip 자동 보장.
 * - 매 doc 변경 시 doc 전체 스캔하여 G:\ 패턴 부분에 inline decoration 적용 (CSS 클래스 + data-path-link 속성).
 * - 사용자 입력 도중에도 즉시 시각이 적용되며, mark 분리 문제(공백에서 끊김)와 mark 충돌이 발생하지 않는다.
 *
 * 클릭 핸들러는 MemoEditor.tsx의 editorProps.handleClickOn 에서 [data-path-link] 속성을 보고 처리.
 * CSS는 src/styles/path-link.css 의 .path-link-mark.
 */
export const PathLinkMark = Extension.create({
  name: 'pathLinkDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pathLinkDecoration'),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              // /g 정규식 lastIndex 오염 방지를 위해 매번 새 인스턴스 생성.
              const regex = new RegExp(G_PATH_REGEX_GLOBAL.source, 'g');
              for (const match of node.text.matchAll(regex)) {
                if (match.index === undefined) continue;
                const from = pos + match.index;
                const to = from + match[0].length;
                decos.push(
                  Decoration.inline(from, to, {
                    class: 'path-link-mark',
                    'data-path-link': match[0],
                    title: `${match[0]}\n(클릭하면 파일탐색기에서 열기)`,
                  }),
                );
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
