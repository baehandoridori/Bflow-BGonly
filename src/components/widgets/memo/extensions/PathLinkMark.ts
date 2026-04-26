import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { G_PATH_REGEX_GLOBAL } from '@/utils/pathLink';
import { PathLinkNodeView } from './PathLinkNodeView';

/**
 * G:\ 경로를 atom inline node 로 변환하는 TipTap extension.
 *
 * 구현 방식: Node + ReactNodeViewRenderer (PathBadge 외관 + X 버튼)
 * - 자동 변환: appendTransaction 으로 매 doc 변경 시 G:\ 텍스트 → PathLinkNode 교체.
 *   사용자 입력 진행 중 selection 영역은 변환에서 제외해 typing 도중 cursor 가 튀지 않도록 보호.
 * - Markdown round-trip: addStorage().markdown.serialize 가 raw text "G:\..." 로 출력 →
 *   재로드 시 setContent → markdown 으로 들어온 raw text 를 onCreate 시점에 다시 스캔/변환.
 */
export const PathLinkMark = Node.create({
  name: 'pathLink',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      href: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-path-link]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-path-link': node.attrs.href,
        class: 'path-link-mark',
      }),
      node.attrs.href,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PathLinkNodeView);
  },

  addStorage() {
    return {
      markdown: {
        // tiptap-markdown 이 Node 를 raw text 로 직렬화 — 다음 로드 때 appendTransaction 이 다시 변환
        serialize: (state: any, node: any) => {
          state.write(node.attrs.href);
        },
        parse: { setup: () => {} },
      },
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;

    return [
      new Plugin({
        key: new PluginKey('pathLinkAutoConvert'),
        appendTransaction: (transactions, oldState, newState) => {
          // doc 변경 또는 selection 변경 시 트리거.
          //  - 입력 중(docChanged + cursor 가 path 위에 있음): selection 보호로 변환 skip
          //  - 입력 후 cursor 만 이동(selectionChanged): 이전 path 가 selection 영역 밖이므로 변환 진행
          //  → "타이핑 → cursor 이동 → 자동 변환" 흐름이 정상 작동
          const docChanged = transactions.some((tr) => tr.docChanged);
          const selectionChanged = !oldState.selection.eq(newState.selection);
          if (!docChanged && !selectionChanged) return null;

          const tr = newState.tr;
          let modified = false;

          // 사용자가 typing 중인 위치 (selection 시작/끝). 그 인접 영역은 변환 제외.
          const selFrom = newState.selection.from;
          const selTo = newState.selection.to;

          // 뒤에서부터 처리해야 인덱스가 어긋나지 않음 — 변환 후보를 먼저 모은다.
          const candidates: Array<{ from: number; to: number; href: string }> = [];

          newState.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return;
            // i 플래그 등 G_PATH_REGEX_GLOBAL 의 모든 flags 를 그대로 복사 (lowercase g:\ 인식 보장)
            const regex = new RegExp(G_PATH_REGEX_GLOBAL.source, G_PATH_REGEX_GLOBAL.flags);
            for (const match of node.text.matchAll(regex)) {
              if (match.index === undefined) continue;
              const from = pos + match.index;
              const to = from + match[0].length;
              // 사용자가 현재 입력 중인 영역 (cursor 위치가 매치 범위 안 또는 직후 1글자 이내) 은 변환 제외
              if (selFrom >= from && selFrom <= to + 1) continue;
              if (selTo >= from && selTo <= to + 1) continue;
              candidates.push({ from, to, href: match[0] });
            }
          });

          for (const c of candidates.reverse()) {
            tr.replaceWith(c.from, c.to, type.create({ href: c.href }));
            modified = true;
          }

          return modified ? tr : null;
        },
      }),
    ];
  },
});
