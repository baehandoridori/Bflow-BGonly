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
import { MemoLinkBubble } from './MemoLinkBubble';

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
  /**
   * 링크 편집 버블 트리거 토큰 — 툴바 링크 버튼 또는 Ctrl+K 로 증가.
   * 비활성 탭(`isActive=false`)에는 전달되지 않아도 동작에 영향 없음.
   */
  editRequestToken?: number;
}

export function MemoEditor({
  content,
  onChange,
  fontSize,
  placeholder = '메모를 입력하세요...',
  onEditorReady,
  editRequestToken = 0,
}: MemoEditorProps) {
  // 외부에서 주입된 content 와 에디터 내부 content 비교용
  const lastExternalContentRef = useRef<string>(content);

  // 콜백을 ref 로 들고 있어, MemoEditor 가 여러 탭에 동시에 마운트된 상태에서
  // 부모가 매 렌더마다 새 wrapper 함수를 넘겨주더라도 editor/effect cycle 이 흔들리지
  // 않도록 한다 (setEditor(null) ↔ setEditor(editor) 진동 방지).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

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
        // Electron main 의 shell:open-external 핸들러는 http(s)/mailto/tel 만 허용.
        // autolink / paste / setLink 모든 경로에서 같은 화이트리스트를 강제 → 죽은 링크 방지.
        isAllowedUri: (url, { defaultValidate }) => {
          if (!defaultValidate(url)) return false;
          return /^(https?:|mailto:|tel:)/i.test(url);
        },
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
      onChangeRef.current(md);
    },
    editorProps: {
      attributes: {
        class: 'memo-prose focus:outline-none',
        spellcheck: 'false',
      },
    },
  });

  // editor 준비/해제 알림 — ref 경유로 호출하여 부모가 새 콜백을 넘겨도 재실행되지 않음
  useEffect(() => {
    onEditorReadyRef.current?.(editor);
    return () => {
      onEditorReadyRef.current?.(null);
    };
  }, [editor]);

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
      {/*
        LinkBubble 을 에디터 내부에 둔다 — 탭별로 독립된 editor 인스턴스를 쓰기 때문에
        버블도 각 editor 와 부모-자식 관계로 묶여야 unmount 순서가 보장된다 (자식 tippy
        정리 → 부모 editor destroy). 비활성 탭의 editor 는 display:none 안에 있어
        BubbleMenu 의 shouldShow 가 자연스럽게 false 를 유지한다.
      */}
      <MemoLinkBubble editor={editor} editRequestToken={editRequestToken} />
    </div>
  );
}
