/**
 * 메모용 TipTap WYSIWYG 에디터.
 * - 저장 형식: Markdown 문자열 (tiptap-markdown)
 * - 앱 관습 __x__ = 밑줄 (BflowUnderline)
 * - Placeholder / TaskList / Link 포함
 */
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useRef } from 'react';
import { BflowUnderline, getEditorMarkdown } from './markdownExtensions';

interface MemoEditorProps {
  /** Markdown 문자열 (초기값/외부 변경 주입용). undefined 일 때 editor 내용 변경 안 함 */
  content: string;
  /** editor 내용 변경 시 최신 Markdown 콜백 */
  onChange: (markdown: string) => void;
  /** 본문 폰트 크기 (px). 헤딩은 em 비율로 자동 계산 */
  fontSize: number;
  placeholder?: string;
  /** editor 인스턴스를 상위에 노출 (툴바/버블이 참조) */
  onEditorReady?: (editor: Editor | null) => void;
}

export function MemoEditor({
  content,
  onChange,
  fontSize,
  placeholder = '메모를 입력하세요...',
  onEditorReady,
}: MemoEditorProps) {
  // 외부에서 주입된 content 와 에디터 내부 content 비교용
  const lastExternalContentRef = useRef<string>(content);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 기본 포함: Bold, Italic, Strike, Heading, BulletList, OrderedList,
        // ListItem, Paragraph, HardBreak, History (undo/redo), Code, CodeBlock, Blockquote, HorizontalRule
        // 헤딩 레벨을 1/2/3 으로 제한
        heading: { levels: [1, 2, 3] },
      }),
      BflowUnderline,
      Link.configure({
        openOnClick: false, // 클릭 시 자동 네비게이션 금지 — 버블 메뉴에서 수동 처리
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: false,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      // Markdown 은 마지막에 (다른 extension 의 addStorage().markdown 을 읽어 serializer 구성)
      Markdown.configure({
        html: false,
        linkify: false, // Link extension 이 담당
        breaks: false,
        transformPastedText: true,
        transformCopiedText: false,
        bulletListMarker: '-',
      }),
    ],
    content,
    onUpdate({ editor: ed }) {
      const md = getEditorMarkdown(ed);
      lastExternalContentRef.current = md;
      onChange(md);
    },
    editorProps: {
      attributes: {
        class: 'memo-prose focus:outline-none',
        spellcheck: 'false',
      },
    },
  });

  // editor 준비/해제 알림
  useEffect(() => {
    onEditorReady?.(editor);
    return () => {
      onEditorReady?.(null);
    };
  }, [editor, onEditorReady]);

  // 외부 content 가 바뀌면 에디터에 주입 (탭 전환, 다른 윈도우 sync 등)
  useEffect(() => {
    if (!editor) return;
    if (content === lastExternalContentRef.current) return;
    // 현재 에디터가 직렬화한 값과 다르면 외부에서 바뀐 것
    try {
      lastExternalContentRef.current = content;
      editor.commands.setContent(content, false);
    } catch (err) {
      console.error('[MemoEditor] setContent 실패 — plain text fallback:', err);
      editor.commands.setContent(content ?? '', false, { preserveWhitespace: 'full' });
    }
  }, [content, editor]);

  return (
    <div
      className="memo-editor-root w-full h-full overflow-auto cursor-text"
      style={{ fontSize: `${fontSize}px` }}
      onClick={() => editor?.commands.focus()}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
